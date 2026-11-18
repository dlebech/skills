import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createApp } from "../server/app.js"
import { startShare, stopAll } from "../server/share.js"
import { fixture, tmp, publicDir, vendorDir } from "./helpers.mjs"

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "harbor3d.js")
const mkApp = () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, ".harbor3d.json"), JSON.stringify({ ...fixture("facts-basic.json"), at: Date.now() }))
  return createApp({ root, publicDir, vendorDir }).start()
}
// A fake cloudflared on PATH: prints a URL (or not) and then waits.
function fakeCloudflared(script) {
  const dir = tmp(), f = path.join(dir, "cloudflared")
  fs.writeFileSync(f, `#!/bin/sh\n${script}\n`, { mode: 0o755 })
  return dir
}
const withPath = async (dir, fn) => { const old = process.env.PATH; process.env.PATH = `${dir}:${old}`; try { return await fn() } finally { process.env.PATH = old } }

test("share --no-tunnel: shared listener under /s/<token>/ only, shared scene, token is 32 hex", async () => {
  const app = mkApp()
  const priv = app.listener({ mode: "private", base: "/" }); await priv.listen(0)
  const sh = await startShare(app, { tunnel: false })
  try {
    assert.match(sh.token, /^[0-9a-f]{32}$/)
    assert.notEqual(sh.port, priv.server.address().port)
    assert.equal((await fetch(`http://127.0.0.1:${sh.port}/`)).status, 404)
    const r = await fetch(sh.localUrl + "events"), rd = r.body.getReader(); let t = ""; while (!t.includes("data: ")) t += Buffer.from((await rd.read()).value).toString()
    const scene = JSON.parse(/data: (.*)/.exec(t)[1])
    assert.equal(scene.mode, "shared"); assert.equal(scene.stale, false)
    assert.ok(!JSON.stringify(scene).includes("Checkout") && !JSON.stringify(scene).includes("shop"))
    await rd.cancel()
  } finally { await sh.stop(); await priv.close(); app.stop() }
  await assert.rejects(fetch(sh.localUrl), "the shared listener is closed after stop")
})

test("share with a tunnel: cloudflared is started on the shared port only, URL printed, killed on stop", async () => {
  const app = mkApp()
  const dir = fakeCloudflared('echo "$@" > "$0.args"\necho "INF |  https://fake-name-1.trycloudflare.com  |" >&2\nexec sleep 30')
  try {
    const sh = await withPath(dir, () => startShare(app, {}))
    assert.equal(sh.shareUrl, `https://fake-name-1.trycloudflare.com/s/${sh.token}/`)
    assert.equal(fs.readFileSync(path.join(dir, "cloudflared.args"), "utf8").trim(), `tunnel --url http://127.0.0.1:${sh.port} --no-autoupdate`)
    await sh.stop()
    assert.equal(await sh.done, "stopped")
  } finally { app.stop() }
})

test("share: the time limit closes the shared listener; cloudflared exiting does too", async () => {
  const app = mkApp()
  try {
    let fire
    const dir = fakeCloudflared('echo "https://a-b.trycloudflare.com"\nexec sleep 30')
    const sh = await withPath(dir, () => startShare(app, { setTimer: fn => { fire = fn; return {} } }))
    fire()
    assert.equal(await sh.done, "time limit")
    await assert.rejects(fetch(sh.localUrl))
    const dir2 = fakeCloudflared('echo "https://c-d.trycloudflare.com"\nsleep 0.3')
    const sh2 = await withPath(dir2, () => startShare(app, {}))
    assert.equal(await sh2.done, "cloudflared exited")
    await assert.rejects(fetch(sh2.localUrl))
  } finally { app.stop() }
})

test("share: cloudflared missing or dying early is an error and leaves no listener", async () => {
  const app = mkApp()
  try {
    const old = process.env.PATH
    process.env.PATH = tmp()
    await assert.rejects(startShare(app, {}), /cloudflared is not installed/)
    process.env.PATH = old
    await assert.rejects(withPath(fakeCloudflared("exit 3"), () => startShare(app, {})), /exited before/)
  } finally { app.stop() }
})

const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const until = async (fn, ms = 3000) => { for (let t = 0; t < ms && !fn(); t += 25) await new Promise(r => setTimeout(r, 25)) }

test("share: a cloudflared that never prints a URL times out and is killed", async () => {
  const app = mkApp()
  try {
    const dir = fakeCloudflared('echo $$ > "$0.pid"\nexec sleep 30')
    await assert.rejects(withPath(dir, () => startShare(app, { urlTimeoutMs: 300 })), /no URL within/)
    const pid = Number(fs.readFileSync(path.join(dir, "cloudflared.pid"), "utf8"))
    await until(() => !alive(pid))
    assert.equal(alive(pid), false)
  } finally { app.stop() }
})

test("share: stopAll (the signal path) kills cloudflared even before its URL arrived", async () => {
  const app = mkApp()
  try {
    const dir = fakeCloudflared('echo $$ > "$0.pid"\nexec sleep 30')
    const pending = withPath(dir, () => startShare(app, { urlTimeoutMs: 20000 }))
    const settled = pending.then(() => "up", e => e.message)
    const pidFile = path.join(dir, "cloudflared.pid")
    await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8").trim())
    const pid = Number(fs.readFileSync(pidFile, "utf8"))
    assert.equal(alive(pid), true)
    await stopAll()
    await until(() => !alive(pid))
    assert.equal(alive(pid), false)
    assert.match(await settled, /exited before|no URL/)
  } finally { app.stop() }
})

// Run the CLI and resolve with its stdout lines once `until` matches.
function cli(args, env, until) {
  const p = spawn(process.execPath, [bin, ...args], { env: { ...process.env, ...env } })
  let out = "", err = ""
  return new Promise((ok, bad) => {
    const check = () => { if (until.test(out)) ok({ p, out }) }
    p.stdout.on("data", d => { out += d; check() }); p.stderr.on("data", d => (err += d))
    p.on("exit", c => { if (!until.test(out)) ok({ p, out, err, code: c }) })
    setTimeout(() => bad(new Error("cli timeout: " + out + err)), 8000).unref()
  })
}

test("CLI: serve picks the next free port, share --no-tunnel prints both URLs, SIGTERM exits", async () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, ".harbor3d.json"), JSON.stringify({ ...fixture("facts-basic.json"), at: Date.now() }))
  const a = await cli(["serve", "--port", "0"], { HERDR_ORCHESTRATION_ROOT: root }, /Harbor 3D: http:\/\/127\.0\.0\.1:\d+\//)
  const port = Number(/:(\d+)\//.exec(a.out)[1])
  const b = await cli(["share", "--no-tunnel", "--port", String(port)], { HERDR_ORCHESTRATION_ROOT: root }, /Shared \(local only\): \S+/)
  try {
    assert.match(b.out, new RegExp(`Harbor 3D: http://127.0.0.1:${port + 1}/`), "taken port → next one")
    const url = /Shared \(local only\): (\S+)/.exec(b.out)[1]
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]{32}\/$/)
    assert.equal((await fetch(url)).status, 200)
    assert.ok(fs.existsSync(path.join(root, ".harbor3d.want")), "want file is touched on start")
  } finally {
    for (const x of [a, b]) { x.p.kill("SIGTERM"); await new Promise(r => x.p.once("exit", r)) }
  }
})

test("CLI: --help, unknown command, and cloudflared missing exits 1", async () => {
  const h = await cli(["--help"], {}, /harbor3d share/)
  assert.equal((await new Promise(r => h.p.once("exit", r)) ?? 0), 0)
  const bad = await cli(["nope"], {}, /never/)
  assert.equal(bad.code, 2)
  const miss = await cli(["share", "--port", "0"], { HERDR_ORCHESTRATION_ROOT: tmp(), PATH: tmp() }, /never/)
  assert.equal(miss.code, 1)
  assert.match(miss.err, /cloudflared is not installed/)
})

// Read the SSE stream of a url into a list of parsed events; waitFor polls it.
async function events(url) {
  const ac = new AbortController(), list = []
  const res = await fetch(url, { signal: ac.signal })
  ;(async () => {
    let buf = ""
    try {
      for await (const c of res.body) {
        buf += Buffer.from(c).toString()
        let i
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const b = buf.slice(0, i); buf = buf.slice(i + 2)
          const ev = /^event: (.*)$/m.exec(b), d = /^data: (.*)$/m.exec(b)
          if (ev) list.push({ event: ev[1], data: JSON.parse(d[1]) })
        }
      }
    } catch {}
  })()
  const waitFor = async pred => { for (let i = 0; i < 100; i++) { const e = list.find(pred); if (e) return e; await new Promise(r => setTimeout(r, 30)) } throw new Error("timed out") }
  return { list, waitFor, close: () => ac.abort() }
}

test("pokes cross between the private and the shared listener; viewers counts both; labels do not cross", async () => {
  const app = mkApp()
  const priv = app.listener({ mode: "private", base: "/" }); const pport = await priv.listen(0)
  const sh = await startShare(app, { tunnel: false })
  const purl = `http://127.0.0.1:${pport}/`
  const post = (url, body, id) => fetch(url + "poke", { method: "POST", headers: { "content-type": "application/json", "x-viewer": id.repeat(16) }, body: JSON.stringify(body) })
  const p = await events(purl + "events"), s = await events(sh.localUrl + "events")
  try {
    const ps = (await p.waitFor(e => e.event === "scene")).data
    // both counts reach both pages
    await p.waitFor(e => e.event === "scene" && e.data.viewers === 2)
    await s.waitFor(e => e.event === "scene" && e.data.viewers === 2)
    // shared -> private, and private -> shared
    assert.equal((await post(sh.localUrl, { kind: "feed", target: "harbor" }, "a")).status, 204)
    const got = await p.waitFor(e => e.event === "poke")
    assert.deepEqual(Object.keys(got.data).sort(), ["at", "kind", "target"])
    await s.waitFor(e => e.event === "poke")
    const target = ps.runs[0].id
    assert.equal((await post(purl, { kind: "wave", target }, "b")).status, 204)
    const back = await s.waitFor(e => e.event === "poke" && e.data.kind === "wave")
    assert.equal(back.data.target, target)
    // a shared scene carries no private text at all after a private viewer joined: no sub, no worker, adrift or PR
    // label, and no run label that is a real name
    const facts = fixture("facts-basic.json")
    const secret = [...facts.runs.flatMap(r => [r.name, r.repo, ...r.workers.map(w => w.name), ...r.prs.map(p => "#" + p.number)]), ...facts.adrift.map(a => a.name)]
    for (const e of s.list.filter(e => e.event === "scene")) {
      const t = JSON.stringify(e.data)
      for (const x of secret) assert.ok(!t.includes(x), `private text ${x} in a shared scene`)
      for (const r of e.data.runs) {
        assert.ok(!("sub" in r), "no sub"); assert.ok(typeof r.label === "string" && r.label.length > 0)
        for (const w of r.workers) assert.ok(!("label" in w), "no worker label")
        for (const q of r.prs) assert.ok(!("label" in q), "no PR label")
      }
      for (const a of e.data.adrift) assert.ok(!("label" in a), "no adrift label")
      assert.equal(e.data.mode, "shared")
    }
    assert.ok(s.list.some(e => e.event === "scene" && e.data.viewers === 2), "the scenes were seen with both viewers")
    // leaving lowers the count on the other listener
    p.close()
    await s.waitFor(e => e.event === "scene" && e.data.viewers === 1 && s.list.at(-1) === e)
  } finally { p.close(); s.close(); await sh.stop(); await priv.close(); app.stop() }
})

test("rate limits stay per listener: the shared limit does not use up the private one, and each accepted poke reaches both streams", async () => {
  const app = mkApp()
  const priv = app.listener({ mode: "private", base: "/" }); const pport = await priv.listen(0)
  const sh = await startShare(app, { tunnel: false })
  const purl = `http://127.0.0.1:${pport}/`
  const post = (url, id) => fetch(url + "poke", { method: "POST", headers: { "content-type": "application/json", "x-viewer": id.repeat(16) }, body: JSON.stringify({ kind: "feed", target: "harbor" }) })
  const p = await events(purl + "events"), s = await events(sh.localUrl + "events")
  try {
    await p.waitFor(e => e.event === "scene")
    const codes = []
    for (const id of "abcdef") codes.push((await post(sh.localUrl, id)).status)   // six different viewers within one second
    assert.deepEqual(codes, [204, 204, 204, 204, 204, 429], "5 per second on the shared listener, then 429")
    assert.equal((await post(purl, "9")).status, 204, "the private listener has its own count")
    await p.waitFor(e => e.event === "poke" && p.list.filter(x => x.event === "poke").length === 6)
    await s.waitFor(e => e.event === "poke" && s.list.filter(x => x.event === "poke").length === 6)
  } finally { p.close(); s.close(); await sh.stop(); await priv.close(); app.stop() }
})

test("the private and the shared listener of one app give every run and raft the same slot", async () => {
  const app = mkApp()
  const priv = app.listener({ mode: "private", base: "/" }); await priv.listen(0)
  const sh = await startShare(app, { tunnel: false })
  const scene = async url => { const r = await fetch(url + "events"), rd = r.body.getReader(); let t = ""; while (!t.includes("data: ")) t += Buffer.from((await rd.read()).value).toString(); await rd.cancel(); return JSON.parse(/data: (.*)/.exec(t)[1]) }
  try {
    const a = await scene(`http://127.0.0.1:${priv.server.address().port}/`), b = await scene(sh.localUrl)
    assert.equal(a.mode, "private"); assert.equal(b.mode, "shared")
    assert.deepEqual(a.runs.map(r => [r.id, r.slot]), b.runs.map(r => [r.id, r.slot]))
    assert.deepEqual(a.adrift.map(r => [r.id, r.slot]), b.adrift.map(r => [r.id, r.slot]))
    assert.ok(a.runs.length > 0 && a.runs.every(r => r.slot >= 0))
  } finally { await sh.stop(); await priv.close(); app.stop() }
})
