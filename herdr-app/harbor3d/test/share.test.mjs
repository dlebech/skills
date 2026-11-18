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
    assert.ok(!JSON.stringify(scene).includes("Ruter") && !JSON.stringify(scene).includes("snevagten"))
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
