// Long-polling (GET poll?after=<n>): the fallback for proxies that buffer SSE, such as Cloudflare quick tunnels.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createApp } from "../server/app.js"
import { startShare } from "../server/share.js"
import { start, sse, fixture, tmp, publicDir, vendorDir } from "./helpers.mjs"

const TOKEN = "0123456789abcdef0123456789abcdef"
const vid = c => c.repeat(16)
const poll = (url, after, id = vid("a")) => fetch(`${url}poll${after === undefined ? "" : `?after=${after}`}`, { headers: id ? { "x-viewer": id } : {} })
const post = (url, body, id) => fetch(url + "poke", { method: "POST", headers: { "content-type": "application/json", "x-viewer": id }, body: JSON.stringify(body) })
const wait = ms => new Promise(r => setTimeout(r, ms))

test("poll: behind → the scene at once; up to date → held, then {n} at the timeout", async () => {
  const s = await start({ pollHoldMs: 100 })
  try {
    const r = await poll(s.url); assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type"), /application\/json/); assert.equal(r.headers.get("cache-control"), "no-store")
    assert.ok(!r.headers.get("content-encoding"))
    const b = await r.json()
    assert.equal(b.scene.mode, "private"); assert.deepEqual(b.pokes, []); assert.ok(b.n >= 1)
    const t0 = Date.now()
    const held = await (await poll(s.url, b.n)).json()
    assert.deepEqual(held, { n: b.n }); assert.ok(Date.now() - t0 >= 90, "held for the hold time")
  } finally { await s.close() }
})

test("poll: a held poll is answered by a scene change and by a poke", async () => {
  const s = await start({ pollHoldMs: 5000, now: Date.now })
  try {
    const first = await (await poll(s.url, 0, vid("a"))).json()
    await wait(1100)   // the 2-per-second limit is per viewer id
    const p1 = poll(s.url, first.n, vid("a")).then(r => r.json())
    await wait(50)
    const f = structuredClone(fixture("facts-basic.json")); f.captain.state = "idle"
    s.set(f)
    const b = await p1
    assert.equal(b.scene.captain.state, "idle"); assert.ok(b.n > first.n)
    await wait(1100)
    // a poke: no scene (unchanged since after), one poke
    const p2 = poll(s.url, b.n, vid("a")).then(r => r.json())
    await wait(50)
    assert.equal((await post(s.url, { kind: "feed", target: "harbor" }, vid("b"))).status, 204)
    const c = await p2
    assert.ok(!("scene" in c)); assert.equal(c.n, b.n + 1)
    assert.deepEqual(Object.keys(c.pokes[0]).sort(), ["at", "kind", "target"]); assert.equal(c.pokes[0].kind, "feed")
    // a late client gets the older pokes oldest first, and only the ones it has not seen
    await wait(1100)
    await post(s.url, { kind: "feed", target: "harbor" }, vid("c"))
    const late = await (await poll(s.url, b.n, vid("d"))).json()
    assert.deepEqual(late.pokes.map(p => p.kind), ["feed", "feed"])
    assert.deepEqual((await (await poll(s.url, c.n, vid("e"))).json()).pokes.map(p => p.kind), ["feed"])
  } finally { await s.close() }
})

test("poll: after and x-viewer are validated", async () => {
  const s = await start({ pollHoldMs: 50 })
  try {
    for (const a of ["abc", "-1", "1.5", "", "1234567890123456", "0x10", "1%20", "1e3"]) assert.equal((await poll(s.url, a)).status, 400, `after=${a}`)
    assert.equal((await fetch(s.url + "poll?after=1&after=2", { headers: { "x-viewer": vid("a") } })).status, 400)
    assert.equal((await poll(s.url, 0, null)).status, 400, "no x-viewer")
    for (const id of ["short", "G".repeat(16), "A".repeat(16), "a".repeat(17)]) assert.equal((await poll(s.url, 0, id)).status, 400, id)
    assert.equal((await poll(s.url, "999999999999999", vid("b"))).status, 200, "15 digits is fine")
    assert.equal((await poll(s.url, undefined, vid("c"))).status, 200, "missing after means 0")
    assert.equal((await fetch(s.url + "poll", { method: "POST" })).status, 405)
  } finally { await s.close() }
})

test("poll: one held poll per viewer id; at most 2 polls a second per id", async () => {
  const c = { v: 1000 }
  const s = await start({ pollHoldMs: 5000, now: () => c.v })
  try {
    const n = (await (await poll(s.url, 0, vid("a"))).json()).n
    c.v += 1000
    const p1 = poll(s.url, n, vid("a")).then(r => r.json())
    await wait(50)
    const p2 = poll(s.url, n, vid("a")).then(r => r.json())   // a second concurrent poll from the same viewer: the first ends with {n}
    assert.deepEqual(await p1, { n })
    await wait(50)
    assert.equal((await poll(s.url, n, vid("a"))).status, 429, "third start within a second")
    s.l.server.closeAllConnections(); await p2.catch(() => {})
  } finally { await s.close() }
  const t = { v: 1000 }
  const s2 = await start({ pollHoldMs: 20, now: () => t.v })
  try {
    const codes = []
    for (let i = 0; i < 4; i++) codes.push((await poll(s2.url, 0)).status)
    assert.deepEqual(codes, [200, 200, 429, 429])
    t.v += 1000
    assert.equal((await poll(s2.url, 0)).status, 200)
  } finally { await s2.close() }
})

test("poll: viewers count SSE and polling viewers, the cap counts them together, and a polling viewer expires after 30 s", async () => {
  for (const [mode, cap, base] of [["private", 8, "/"], ["shared", 20, `/s/${TOKEN}/`]]) {
    const t = { v: 5000 }
    const s = await start({ mode, base, now: () => t.v, pollHoldMs: 10 })
    const open = []
    try {
      for (let i = 0; i < 3; i++) open.push(await sse(s.url + "events"))
      const ids = Array.from({ length: cap - 3 }, (_, i) => i.toString(16).padStart(16, "0"))
      for (const id of ids) assert.equal((await poll(s.url, 0, id)).status, 200)
      assert.equal(s.l.viewers(), cap)
      const full = await poll(s.url, 0, vid("f")); assert.equal(full.status, 503)
      assert.equal(full.headers.get("cache-control"), "no-store")
      assert.equal((await fetch(s.url + "events")).status, 503, "SSE is full too")
      assert.equal((await poll(s.url, 0, ids[0])).status, 200, "a viewer already counted may poll on")
      assert.equal((await (await poll(s.url, 0, ids[1])).json()).scene.viewers, cap)
      // 31 s later every polling viewer has expired
      t.v += 31000
      assert.equal(s.l.viewers(), 3)
      assert.equal((await poll(s.url, 0, vid("f"))).status, 200)
      assert.equal(s.l.viewers(), 4)
    } finally { open.forEach(e => e.close()); await s.close() }
  }
})

test("poll: a polling viewer shows in the scene's viewers; one that is ahead of the server gets the full scene", async () => {
  const s = await start({ pollHoldMs: 20 })
  const e = await sse(s.url + "events")
  try {
    await e.waitFor(x => x.event === "scene")
    const b = await (await poll(s.url, 0, vid("a"))).json()
    assert.equal(b.scene.viewers, 2)
    await e.waitFor(x => x.event === "scene" && x.data.viewers === 2)
    const ahead = await (await poll(s.url, 900000, vid("a"))).json()
    assert.equal(ahead.n, b.n); assert.equal(ahead.scene.mode, "private"); assert.deepEqual(ahead.pokes, [])
  } finally { e.close(); await s.close() }
})

const mkApp = () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, ".harbor3d.json"), JSON.stringify({ ...fixture("facts-basic.json"), at: Date.now() }))
  return createApp({ root, publicDir, vendorDir }).start()
}

test("poll: the shared listener never holds a private label; pokes cross between listeners for polling viewers", async () => {
  const app = mkApp()
  const priv = app.listener({ mode: "private", base: "/", pollHoldMs: 3000 }); const pport = await priv.listen(0)
  const sh = await startShare(app, { tunnel: false })
  const purl = `http://127.0.0.1:${pport}/`
  try {
    const sb = await (await poll(sh.localUrl, 0, vid("a"))).json()
    const pb = await (await poll(purl, 0, vid("b"))).json()
    assert.equal(sb.scene.mode, "shared"); assert.equal(pb.scene.mode, "private")
    const facts = fixture("facts-basic.json")
    const secret = [...facts.runs.flatMap(r => [r.name, r.repo, ...r.workers.map(w => w.name), ...r.prs.map(p => "#" + p.number)]), ...facts.adrift.map(a => a.name)]
    const text = JSON.stringify(sb)
    for (const x of secret) assert.ok(!text.includes(x), `private text ${x} in a shared poll answer`)
    for (const r of sb.scene.runs) {
      assert.ok(!("sub" in r)); assert.ok(typeof r.label === "string" && r.label.length > 0)
      for (const w of r.workers) assert.ok(!("label" in w))
      for (const q of r.prs) assert.ok(!("label" in q))
    }
    for (const a of sb.scene.adrift) assert.ok(!("label" in a))
    assert.equal(pb.scene.viewers, 2, "viewers sums polling viewers over both listeners")
    // private poke → shared polling viewer, and the reverse
    const target = pb.scene.runs[0].orchestrator.id
    const sn = (await (await poll(sh.localUrl, 0, vid("e"))).json()).n   // the private viewer's arrival changed this scene too
    const held = poll(sh.localUrl, sn, vid("a")).then(r => r.json())
    await wait(50)
    assert.equal((await post(purl, { kind: "wave", target }, vid("c"))).status, 204)
    const got = await held
    assert.deepEqual(got.pokes.map(p => [p.kind, p.target]), [["wave", target]])
    const gn = (await (await poll(purl, 0, vid("9"))).json()).n
    const held2 = poll(purl, gn, vid("b")).then(r => r.json())
    await wait(50)
    assert.equal((await post(sh.localUrl, { kind: "feed", target: "harbor" }, vid("d"))).status, 204)
    const back = await held2
    assert.ok(back.pokes.some(p => p.kind === "feed"))
    for (const b of [got, back]) for (const p of b.pokes) assert.deepEqual(Object.keys(p).sort(), ["at", "kind", "target"])
  } finally { await sh.stop(); await priv.close(); app.stop() }
})
