import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import http from "node:http"
import zlib from "node:zlib"
import { createHash } from "node:crypto"
import { start, sse, fixture, tmp } from "./helpers.mjs"
import { createRateLimiter, writeTo, acceptsGzip } from "../server/http.js"

const TOKEN = "0123456789abcdef0123456789abcdef"
const post = (url, body, headers = {}) => fetch(url + "poke", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) })
// Raw request with a chosen Host header (fetch will not let us set it).
const raw = (port, p, { method = "GET", headers = {} } = {}) => new Promise((ok, bad) => {
  const r = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { res.resume(); res.on("end", () => ok(res)) })
  r.on("error", bad); r.end()
})
const HEADER_NAMES = ["content-security-policy", "x-content-type-options", "referrer-policy", "cache-control"]
const MAP = /<script type="importmap">([\s\S]*?)<\/script>/.exec(fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8"))[1]
const MAP_HASH = `'sha256-${createHash("sha256").update(MAP).digest("base64")}'`
const checkHeaders = r => {
  const res = { headers: typeof r.headers.get === "function" ? Object.fromEntries(r.headers) : r.headers }
  assert.equal(res.headers["content-security-policy"], `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' ${MAP_HASH}; connect-src 'self'; frame-ancestors 'none'`)
  assert.equal(res.headers["x-content-type-options"], "nosniff")
  assert.equal(res.headers["referrer-policy"], "no-referrer")
  assert.equal(res.headers["cache-control"], "no-store")
}

test("index and assets are served, with the security headers", async () => {
  const s = await start()
  try {
    const r = await fetch(s.url)
    assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type"), /text\/html/)
    assert.match(await r.text(), /Harbor 3D/)
    checkHeaders(r)
    const js = await fetch(s.url + "assets/app.js")
    assert.equal(js.status, 200)
    assert.match(js.headers.get("content-type"), /javascript/)
    assert.equal((await fetch(s.url + "vendor/three/build/three.module.js")).status, 200)
    assert.equal((await fetch(s.url + "vendor/three/examples/jsm/controls/OrbitControls.js")).status, 200)
  } finally { await s.close() }
})

test("the contract headers are on every response, errors included", async () => {
  for (const mode of ["private", "shared"]) {
    const s = await start(mode === "shared" ? { mode, base: `/s/${TOKEN}/` } : {})
    try {
      const calls = [
        fetch(s.url), fetch(s.url + "nope"), fetch(s.url + "events").then(async r => { s.l.server.closeAllConnections(); return r }),
        fetch(s.url + "poke"), post(s.url, "{bad"), fetch(`http://127.0.0.1:${s.port}/other`),
        fetch(s.url + "assets/..%2fserver/http.js"), fetch(s.url, { method: "DELETE" }),
      ]
      for (const r of await Promise.allSettled(calls)) if (r.status === "fulfilled") checkHeaders(r.value)
      const forbidden = await raw(s.port, "/", { headers: { host: "evil.example" } })
      checkHeaders(forbidden)
    } finally { await s.close() }
  }
})

test("static: traversal, encoded traversal, dotfiles, symlink escape and unknown extensions are all 404", async () => {
  const dir = tmp(), pub = path.join(dir, "public"), outside = path.join(dir, "secret.json")
  const A = path.join(pub, "assets")
  fs.mkdirSync(A, { recursive: true }); fs.writeFileSync(path.join(A, "ok.js"), "1"); fs.writeFileSync(path.join(A, ".hidden.js"), "1")
  fs.writeFileSync(path.join(A, "data.txt"), "1"); fs.writeFileSync(path.join(pub, "index.html"), "<p>hi"); fs.writeFileSync(path.join(pub, "top.js"), "1")
  fs.writeFileSync(outside, "{}"); fs.symlinkSync(outside, path.join(A, "link.json")); fs.symlinkSync(dir, path.join(A, "up"))
  fs.mkdirSync(path.join(A, ".git")); fs.writeFileSync(path.join(A, ".git", "x.js"), "1")
  const s = await start({ publicDir: pub })
  try {
    assert.equal((await fetch(s.url + "assets/ok.js")).status, 200)
    assert.equal((await fetch(s.url + "top.js")).status, 404, "only assets/ is served from public/")
    for (const p of ["assets/../secret.json", "assets/%2e%2e/secret.json", "assets/%2E%2E%2Fsecret.json", "assets/..%2fsecret.json", "assets/%2e%2e%5csecret.json",
      "assets/.hidden.js", "assets/.git/x.js", "assets/data.txt", "assets/link.json", "assets/up/secret.json", "assets/ok.js%00.png", "assets/", "assets//ok.js", "assets/ok.js/",
      "vendor/three/", "vendor/three/package.json", "vendor/three/build/../package.json", "vendor/three/build/%2e%2e/package.json", "vendor/other/x.js", "assets/missing.js"]) {
      const r = await raw(s.port, "/" + p)
      assert.equal(r.statusCode, 404, p)
    }
    // dot segments are collapsed by clients; send them raw
    assert.equal((await raw(s.port, "/assets/../../secret.json")).statusCode, 404)
  } finally { await s.close() }
})

test("shared: everything outside /s/<token>/ is 404, wrong token is 404, right token works", async () => {
  const s = await start({ mode: "shared", base: `/s/${TOKEN}/` })
  try {
    for (const p of ["/", "/events", "/poke", "/assets/app.js", "/s/", `/s/${TOKEN}`, `/s/${TOKEN.replace(/.$/, "0")}/`, `/s/${TOKEN.toUpperCase()}/`, `/s/${TOKEN}x/`, "/s/short/", `/x/s/${TOKEN}/`, "/%2fs/" + TOKEN + "/"]) {
      for (const method of ["GET", "POST"]) assert.equal((await raw(s.port, p, { method })).statusCode, 404, `${method} ${p}`)
      const r = await fetch(`http://127.0.0.1:${s.port}${p}`)
      assert.equal(r.status, 404); assert.equal(await r.text(), "")
    }
    assert.equal((await fetch(s.url)).status, 200)
    assert.equal((await fetch(s.url + "events", { signal: AbortSignal.timeout(300) }).then(r => r.status, () => 200)), 200)
  } finally { await s.close() }
})

test("shared: the mode is fixed, so a request cannot ask for a private scene", async () => {
  const s = await start({ mode: "shared", base: `/s/${TOKEN}/` })
  const e = await sse(s.url + "events?mode=private", { "x-mode": "private" })
  try {
    const ev = await e.waitFor(x => x.event === "scene")
    assert.equal(ev.data.mode, "shared")
    assert.ok(!JSON.stringify(ev.data).includes("Checkout"))
  } finally { e.close(); await s.close() }
})

test("private: Host and Origin checks", async () => {
  const s = await start()
  try {
    for (const host of ["evil.example", `evil.example:${s.port}`, "127.0.0.1", `127.0.0.1:${s.port + 1}`, `127.0.0.1.evil.example:${s.port}`])
      assert.equal((await raw(s.port, "/", { headers: { host } })).statusCode, 403, String(host))
    assert.equal((await raw(s.port, "/", { headers: { host: `localhost:${s.port}` } })).statusCode, 200)
    assert.equal((await raw(s.port, "/", { headers: { host: `127.0.0.1:${s.port}`, origin: "http://evil.example" } })).statusCode, 200, "Origin is only checked on POST")
    const ok = (origin, id) => post(s.url, { kind: "feed", target: "harbor" }, { origin, "x-viewer": id })
    assert.equal((await ok("http://evil.example", "a".repeat(16))).status, 403)
    assert.equal((await ok("null", "b".repeat(16))).status, 403)
    assert.equal((await ok(`http://127.0.0.1:${s.port}`, "c".repeat(16))).status, 204)
    assert.equal((await ok(`http://localhost:${s.port}`, "d".repeat(16))).status, 204)
    assert.equal((await post(s.url, { kind: "feed", target: "harbor" }, { "x-viewer": "e".repeat(16) })).status, 204, "no Origin is fine")
  } finally { await s.close() }
})

test("poke: 204 and broadcast to every viewer, rebuilt from validated values", async () => {
  const clock = { t: 1000 }
  const s = await start({ now: () => (clock.t += 1100) })
  const a = await sse(s.url + "events"), b = await sse(s.url + "events")
  try {
    const scene = (await a.waitFor(e => e.event === "scene")).data
    const target = scene.runs[1].orchestrator.id
    const r = await post(s.url, { kind: "wave", target, extra: "<script>", __proto__: { x: 1 }, nested: { a: 1 } }, { "x-viewer": "1".repeat(16) })
    assert.equal(r.status, 204)
    for (const c of [a, b]) {
      const p = await c.waitFor(e => e.event === "poke")
      assert.deepEqual(Object.keys(p.data).sort(), ["at", "kind", "target"])
      assert.equal(p.data.kind, "wave"); assert.equal(p.data.target, target)
      assert.equal(typeof p.data.at, "number")
    }
    // worker, orchestrator, adrift and "harbor" are valid targets too
    const w = scene.runs[0].workers[0].id
    assert.equal((await post(s.url, { kind: "wave", target: w }, { "x-viewer": "2".repeat(16) })).status, 204)
    assert.equal((await post(s.url, { kind: "feed", target: "harbor" }, { "x-viewer": "3".repeat(16) })).status, 204)
    assert.equal((await post(s.url, { kind: "wave", target: scene.adrift[0].id }, { "x-viewer": "4".repeat(16) })).status, 204)
    // the kinds are tied to their targets: feed takes only the harbor, wave takes creatures and the captain (state is "watching" here)
    assert.equal((await post(s.url, { kind: "feed", target: scene.adrift[0].id }, { "x-viewer": "5".repeat(16) })).status, 400)
    assert.equal((await post(s.url, { kind: "wave", target: "harbor" }, { "x-viewer": "6".repeat(16) })).status, 400)
    assert.equal((await post(s.url, { kind: "feed", target: "captain" }, { "x-viewer": "7".repeat(16) })).status, 400)
    assert.equal((await post(s.url, { kind: "wave", target: "captain" }, { "x-viewer": "8".repeat(16) })).status, 204)
  } finally { a.close(); b.close(); await s.close() }
})

test("poke: unknown kind, unknown target, bad bodies and wrong content are 400", async () => {
  const clock = { t: 1000 }
  const s = await start({ now: () => (clock.t += 1100) })
  try {
    const run = (await (async () => { const e = await sse(s.url + "events"); const sc = (await e.waitFor(x => x.event === "scene")).data; e.close(); return sc })()).runs[0]
    const oid = run.orchestrator.id, id = run.id
    let n = 0
    const go = (body, headers = {}) => post(s.url, body, { "x-viewer": (n++).toString(16).padStart(16, "0"), ...headers })
    for (const body of [{ kind: "horn", target: id }, { kind: "fireworks", target: id }, { kind: "nope", target: id }, { kind: "wave", target: "r0000" }, { kind: "wave", target: id }, { kind: "feed", target: id }, { kind: "wave" }, { kind: "feed" }, { target: id }, { kind: ["feed"], target: id }, { kind: "feed", target: [id] },
      { kind: "feed", target: { id } }, { kind: "constructor", target: id }, { kind: "__proto__", target: id }, "[]", "null", "42", '"feed"', "{bad", ""])
      assert.equal((await go(body)).status, 400, JSON.stringify(body))
    assert.equal((await go({ kind: "wave", target: oid }, { "content-type": "text/plain" })).status, 400)
    assert.equal((await fetch(s.url + "poke", { method: "POST", headers: { "x-viewer": "f".repeat(16) }, body: JSON.stringify({ kind: "wave", target: oid }) })).status, 400, "no content-type")
    assert.equal((await go({ kind: "wave", target: oid }, { "content-type": "application/json; charset=utf-8" })).status, 204)
    assert.equal((await fetch(s.url + "poke")).status, 405)
  } finally { await s.close() }
})

test("poke: a body over 200 bytes is refused and the connection dropped", async () => {
  const s = await start()
  try {
    const big = JSON.stringify({ kind: "feed", target: "harbor", pad: "x".repeat(300) })
    const r = await post(s.url, big, { "x-viewer": "a".repeat(16) }).then(r => r.status, () => "reset")
    assert.ok(r === 400 || r === "reset", String(r))
    // chunked, no content-length
    const res = await new Promise(ok => {
      const req = http.request({ host: "127.0.0.1", port: s.port, path: "/poke", method: "POST", headers: { "content-type": "application/json", "x-viewer": "b".repeat(16), "transfer-encoding": "chunked" } }, r => { r.resume(); ok(r.statusCode) })
      req.on("error", () => ok("reset"))
      req.write("{" + " ".repeat(250)); setTimeout(() => req.write(" ".repeat(250)), 20)
    })
    assert.ok(res === 400 || res === "reset", String(res))
    assert.equal((await post(s.url, { kind: "feed", target: "harbor" }, { "x-viewer": "c".repeat(16) })).status, 204, "the server is fine afterwards")
  } finally { await s.close() }
})

test("poke rate limit: 1 per second per viewer, 5 per second in all (injected clock)", async () => {
  let t = 1000
  const lim = createRateLimiter({ now: () => t })
  assert.equal(lim("a"), true); assert.equal(lim("a"), false)
  t += 999; assert.equal(lim("a"), false)
  t += 1; assert.equal(lim("a"), true)
  t = 10000
  const lim2 = createRateLimiter({ now: () => t })
  assert.deepEqual(["a", "b", "c", "d", "e", "f"].map(k => lim2(k)), [true, true, true, true, true, false])
  t += 1000
  assert.equal(lim2("f"), true)

  // through the listener
  const clock = { t: 5000 }
  const s = await start({ now: () => clock.t })
  try {
    const p = id => post(s.url, { kind: "feed", target: "harbor" }, { "x-viewer": id.repeat(16) }).then(r => r.status)
    assert.equal(await p("a"), 204)
    assert.equal(await p("a"), 429, "same viewer within a second")
    assert.deepEqual([await p("b"), await p("c"), await p("d"), await p("e")], [204, 204, 204, 204])
    assert.equal(await p("f"), 429, "sixth in the same second")
    clock.t += 1001
    assert.equal(await p("a"), 204)
    // without x-viewer (or with a malformed one) the key is the remote address
    clock.t += 1001
    assert.equal(await post(s.url, { kind: "feed", target: "harbor" }, { "x-viewer": "ZZ" }).then(r => r.status), 204)
    assert.equal(await post(s.url, { kind: "feed", target: "harbor" }).then(r => r.status), 429)
  } finally { await s.close() }
})

test("SSE: first scene on connect, change pushes, viewers counts own connections, cleanup on close", async () => {
  const s = await start()
  const a = await sse(s.url + "events")
  try {
    const first = (await a.waitFor(e => e.event === "scene")).data
    assert.equal(first.viewers, 1)
    assert.equal(first.mode, "private")
    const b = await sse(s.url + "events")
    await a.waitFor(e => e.event === "scene" && e.data.viewers === 2)
    assert.equal(s.l.viewers(), 2)
    // a facts change is pushed
    const f = structuredClone(fixture("facts-basic.json")); f.captain.state = "idle"
    s.set(f)
    await a.waitFor(e => e.data.captain?.state === "idle")
    // an unchanged refresh is silent
    const n = a.events.length; s.l.refresh(); await new Promise(r => setTimeout(r, 50)); assert.equal(a.events.length, n)
    b.close()
    await a.waitFor(e => e.event === "scene" && e.data.viewers === 1 && e.data.captain.state === "idle")
    assert.equal(s.l.viewers(), 1)
    // stale flips push too
    s.set(f, true)
    await a.waitFor(e => e.data.stale === true)
  } finally { a.close(); await s.close() }
  assert.equal(s.l.viewers(), 0)
})

test("SSE caps: the 9th private and the 21st shared connection get 503, and a closed one frees its slot", async () => {
  for (const [mode, cap, base] of [["private", 8, "/"], ["shared", 20, `/s/${TOKEN}/`]]) {
    const s = await start({ mode, base })
    const open = []
    try {
      for (let i = 0; i < cap; i++) { const e = await sse(s.url + "events"); assert.equal(e.res.status, 200); open.push(e) }
      const over = await fetch(s.url + "events"); assert.equal(over.status, 503); checkHeaders(over)
      assert.equal(s.l.viewers(), cap)
      open.pop().close()
      for (let i = 0; i < 100 && s.l.viewers() === cap; i++) await new Promise(r => setTimeout(r, 20))
      const again = await sse(s.url + "events"); assert.equal(again.res.status, 200); open.push(again)
    } finally { open.forEach(e => e.close()); await s.close() }
    const left = await new Promise(ok => s.l.server.getConnections((_, n) => ok(n)))
    assert.equal(left, 0)
    assert.equal(s.l.server.listenerCount("request"), 1, "no listener piled up")
  }
})

test("SSE keep-alive comment is sent", async () => {
  const s = await start({ keepAliveMs: 30 })
  try {
    const res = await fetch(s.url + "events")
    const reader = res.body.getReader(); let text = ""
    for (let i = 0; i < 20 && !text.includes(": keep-alive"); i++) text += Buffer.from((await reader.read()).value).toString()
    assert.match(text, /: keep-alive/)
    await reader.cancel()
  } finally { await s.close() }
})

test("a stale scene is flagged for viewers and the page has no inline script but the import map", async () => {
  const s = await start({ stale: true, facts: null, now: () => 1 })
  const e = await sse(s.url + "events")
  try {
    const sc = (await e.waitFor(x => x.event === "scene")).data
    assert.equal(sc.stale, true); assert.deepEqual(sc.runs, [])
    const html = await (await fetch(s.url)).text()
    assert.ok(!/<script(?![^>]*\b(src=|type="importmap"))/i.test(html) && !/\son\w+=/i.test(html) && !/<style|style=/i.test(html))
  } finally { e.close(); await s.close() }
})

test("HEAD on events is 405 and takes no SSE slot", async () => {
  const s = await start({ mode: "shared", base: `/s/${TOKEN}/` })
  try {
    for (let i = 0; i < 25; i++) { const r = await raw(s.port, `/s/${TOKEN}/events`, { method: "HEAD" }); assert.equal(r.statusCode, 405); assert.equal(r.headers.allow, "GET") }
    assert.equal(s.l.viewers(), 0)
    const e = await sse(s.url + "events"); assert.equal(e.res.status, 200); e.close()
  } finally { await s.close() }
})

test("socket limits are set, and a client that does not read is dropped", async () => {
  const a = await start(), b = await start({ mode: "shared", base: `/s/${TOKEN}/` })
  try {
    assert.deepEqual([a.l.server.maxConnections, b.l.server.maxConnections], [32, 64])
    for (const x of [a, b]) assert.deepEqual([x.l.server.requestTimeout, x.l.server.headersTimeout], [10000, 5000])
  } finally { await a.close(); await b.close() }
  const fake = n => ({ writableLength: n, writes: 0, destroyed: false, write() { this.writes++ }, destroy() { this.destroyed = true } })
  const ok = fake(1000), slow = fake(256 * 1024 + 1)
  writeTo(ok, "x"); writeTo(slow, "x")
  assert.deepEqual([ok.destroyed, slow.destroyed, slow.writes], [false, true, 1])
  assert.equal(fake(5000).destroyed, false)
  const small = fake(5000); writeTo(small, "x", 1024); assert.equal(small.destroyed, true)
})

test("the CSP carries the hash of the page's import map, and index.html has no other inline script", async () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8")
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  assert.equal(inline.length, 1, "exactly one inline script")
  assert.match(inline[0][0], /^<script type="importmap">/)
  assert.equal(inline[0][1], MAP)
  assert.ok(!/<style|\sstyle=|\sonclick=|\sonload=|javascript:/i.test(html), "no inline style or handler")
  for (const mode of ["private", "shared"]) {
    const s = await start(mode === "shared" ? { mode, base: `/s/${TOKEN}/` } : {})
    try {
      const csp = (await fetch(s.url)).headers.get("content-security-policy")
      assert.equal(csp.match(/script-src ([^;]*)/)[1], `'self' ${MAP_HASH}`)
      // nothing else in the policy changed
      assert.equal(csp.replace(` ${MAP_HASH}`, ""), "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
    } finally { await s.close() }
  }
  // a listener over a page with no import map adds no hash; one with a changed map gets another hash
  const dir = tmp()
  fs.writeFileSync(path.join(dir, "index.html"), "<p>x</p>")
  const a = await start({ publicDir: dir })
  try { assert.equal((await fetch(a.url)).headers.get("content-security-policy").match(/script-src ([^;]*)/)[1], "'self'") } finally { await a.close() }
  fs.writeFileSync(path.join(dir, "index.html"), '<script type="importmap">{"imports":{}}</script><script>alert(1)</script>')
  const b = await start({ publicDir: dir })
  try {
    const got = (await fetch(b.url)).headers.get("content-security-policy").match(/script-src ([^;]*)/)[1]
    assert.notEqual(got, `'self' ${MAP_HASH}`)
    assert.equal(got, `'self' 'sha256-${createHash("sha256").update('{"imports":{}}').digest("base64")}'`, "the second inline script is not covered: only the map's hash is allowed")
  } finally { await b.close() }
})

test("models are served from models/out at assets/models/<name>.glb, and nothing else is", async () => {
  const s = await start()
  try {
    const r = await fetch(s.url + "assets/models/octopus.glb")
    assert.equal(r.status, 200)
    assert.equal(r.headers.get("content-type"), "model/gltf-binary")
    const buf = Buffer.from(await r.arrayBuffer())
    assert.equal(buf.subarray(0, 4).toString(), "glTF")
    checkHeaders(r)
    for (const p of ["assets/models/nope.glb", "assets/models/octopus.js", "assets/models/", "assets/models/..%2fbuild.py", "assets/models/%2e%2e/out/octopus.glb", "assets/models/.octopus.glb", "assets/models/sub/octopus.glb", "assets/models/octopus.glb%00.js", "assets/models%5coctopus.glb", "assets/models/octopus.GLB.txt"]) {
      assert.equal((await fetch(s.url + p)).status, 404, p)
    }
    assert.equal((await fetch(s.url + "assets/octopus.glb")).status, 404, "not under the plain assets root")
    const raw = await new Promise((ok, bad) => http.get({ host: "127.0.0.1", port: s.port, path: "/assets/models/../../server/http.js" }, res => { res.resume(); ok(res.statusCode) }).on("error", bad))
    assert.equal(raw, 404)
  } finally { await s.close() }
  // a symlink in the models folder that leaves it is refused
  const dir = tmp(), out = path.join(dir, "out")
  fs.mkdirSync(out); fs.writeFileSync(path.join(dir, "secret.glb"), "secret"); fs.writeFileSync(path.join(out, "ok.glb"), "glTFok")
  fs.symlinkSync(path.join(dir, "secret.glb"), path.join(out, "link.glb"))
  const t = await start({ modelsDir: out })
  try {
    assert.equal((await fetch(t.url + "assets/models/ok.glb")).status, 200)
    assert.equal((await fetch(t.url + "assets/models/link.glb")).status, 404)
  } finally { await t.close() }
})

test("gzip: text files are compressed when accepted, with Vary; SSE and plain requests are not", async () => {
  const s = await start()
  try {
    const raw = await fetch(s.url + "assets/look.js", { headers: { "accept-encoding": "identity" } })
    assert.equal(raw.headers.get("content-encoding"), null)
    assert.equal(raw.headers.get("vary"), "Accept-Encoding")
    const plain = await raw.text()
    const gz = await new Promise((ok, bad) => http.get({ host: "127.0.0.1", port: s.port, path: "/assets/look.js", headers: { "accept-encoding": "gzip" } }, r => {
      const ch = []; r.on("data", c => ch.push(c)); r.on("end", () => ok({ r, body: Buffer.concat(ch) })); r.on("error", bad)
    }))
    assert.equal(gz.r.headers["content-encoding"], "gzip")
    assert.equal(gz.r.headers.vary, "Accept-Encoding")
    assert.equal(Number(gz.r.headers["content-length"]), gz.body.length)
    assert.ok(gz.body.length < plain.length)
    assert.equal(zlib.gunzipSync(gz.body).toString(), plain)
    const ev = await new Promise(ok => http.get({ host: "127.0.0.1", port: s.port, path: "/events", headers: { "accept-encoding": "gzip" } }, r => { ok(r.headers); r.destroy() }))
    assert.equal(ev["content-encoding"], undefined)
  } finally { await s.close() }
})

test("accept-encoding: gzip;q=0 refuses, a q above 0 or * accepts, gzip named beats *", () => {
  for (const [h, want] of [["gzip", true], ["gzip, deflate, br", true], ["GZIP;q=0.5", true], ["gzip;q=0", false], ["gzip; q=0.0, deflate", false], ["*", true], ["*;q=0", false], ["gzip;q=0, *", false], ["gzip, *;q=0", true], ["deflate", false], ["", false], [undefined, false]]) assert.equal(acceptsGzip(h), want, String(h))
})

// Get a url with raw http (fetch would decode gzip and hide the headers), optionally HEAD.
const rawGet = (port, p, headers, method = "GET") => new Promise((ok, bad) => http.request({ host: "127.0.0.1", port, path: p, method, headers }, r => {
  const ch = []; r.on("data", c => ch.push(c)); r.on("end", () => ok({ r, body: Buffer.concat(ch) })); r.on("error", bad)
}).on("error", bad).end())

test("gzip: gzip;q=0 gets the plain file; the cache follows a changed file; .glb only when it shrinks; HEAD says so without a body", async () => {
  const pub = tmp(), models = tmp()
  fs.mkdirSync(path.join(pub, "assets"))
  fs.writeFileSync(path.join(pub, "index.html"), "<!doctype html><title>x</title>")
  const js = path.join(pub, "assets", "x.js")
  fs.writeFileSync(js, "const a = 1\n".repeat(200))
  fs.writeFileSync(path.join(models, "squash.glb"), Buffer.alloc(20000, 7))
  fs.writeFileSync(path.join(models, "noise.glb"), (await import("node:crypto")).randomBytes(20000))
  const s = await start({ publicDir: pub, modelsDir: models })
  try {
    const gz = { "accept-encoding": "gzip" }
    assert.equal((await rawGet(s.port, "/assets/x.js", { "accept-encoding": "gzip;q=0" })).r.headers["content-encoding"], undefined)
    const a = await rawGet(s.port, "/assets/x.js", gz)
    assert.equal(zlib.gunzipSync(a.body).toString(), "const a = 1\n".repeat(200))
    // the file changes (new size and mtime): the next gzip response is the new content
    fs.writeFileSync(js, "const b = 2\n".repeat(300))
    fs.utimesSync(js, new Date(Date.now() + 5000), new Date(Date.now() + 5000))
    const b = await rawGet(s.port, "/assets/x.js", gz)
    assert.equal(zlib.gunzipSync(b.body).toString(), "const b = 2\n".repeat(300))
    // concurrent first requests all get a good body
    const many = await Promise.all(Array.from({ length: 5 }, () => rawGet(s.port, "/assets/x.js", gz)))
    for (const m of many) assert.equal(zlib.gunzipSync(m.body).toString(), "const b = 2\n".repeat(300))
    // .glb: compressed when it shrinks a lot, plain when it does not
    const sq = await rawGet(s.port, "/assets/models/squash.glb", gz)
    assert.equal(sq.r.headers["content-encoding"], "gzip"); assert.equal(zlib.gunzipSync(sq.body).length, 20000)
    const nz = await rawGet(s.port, "/assets/models/noise.glb", gz)
    assert.equal(nz.r.headers["content-encoding"], undefined); assert.equal(nz.body.length, 20000)
    // HEAD: the same headers, no body
    const h = await rawGet(s.port, "/assets/x.js", gz, "HEAD")
    assert.equal(h.r.headers["content-encoding"], "gzip"); assert.equal(h.body.length, 0)
    assert.equal(Number(h.r.headers["content-length"]), zlib.gzipSync(Buffer.from("const b = 2\n".repeat(300)), { level: 9 }).length)
  } finally { await s.close() }
})

test("poke: the captain can be waved at only while the tug is out (state is not none)", async () => {
  const clock = { t: 1000 }
  const s = await start({ now: () => (clock.t += 1100) })
  const a = await sse(s.url + "events")
  try {
    await a.waitFor(e => e.event === "scene")
    const f = structuredClone(fixture("facts-basic.json")); f.captain.state = "none"
    s.set(f)
    await a.waitFor(e => e.event === "scene" && e.data.captain.state === "none")
    assert.equal((await post(s.url, { kind: "wave", target: "captain" }, { "x-viewer": "a".repeat(16) })).status, 400, "moored tug: refused")
    f.captain.state = "working"; s.set(f)
    await a.waitFor(e => e.event === "scene" && e.data.captain.state === "working")
    assert.equal((await post(s.url, { kind: "wave", target: "captain" }, { "x-viewer": "b".repeat(16) })).status, 204)
    assert.equal((await a.waitFor(e => e.event === "poke")).data.target, "captain")
  } finally { a.close(); await s.close() }
})
