// The shared listener (random port, base /s/<token>/) and the cloudflared tunnel pointed at it.
// The tunnel only ever points at the shared listener's port, never the private one.
import { randomBytes } from "node:crypto"
import { spawn } from "node:child_process"

// Every running share's stop(), so a signal handler can reach it even before the tunnel URL has arrived.
const live = new Set()
export const stopAll = () => Promise.all([...live].map(stop => stop("signal")))

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

// Start sharing. Returns { token, port, localUrl, shareUrl, stop, done }. `done` resolves when sharing
// ended (time limit, stop(), or cloudflared exiting). With tunnel false there is no cloudflared.
// With realNames the shared page shows real names, repos, PR numbers and agent names, like the private one.
export async function startShare(app, { minutes = 60, tunnel = true, realNames = false, urlTimeoutMs = 30000, log = () => {}, setTimer = setTimeout } = {}) {
  const token = randomBytes(16).toString("hex")
  const base = `/s/${token}/`
  const listener = app.listener({ mode: "shared", base, realNames: realNames === true })
  const port = await listener.listen(0)
  const localUrl = `http://127.0.0.1:${port}${base}`
  let child = null, timer = null, ended = false, finish
  const kill = () => child?.kill()
  const done = new Promise(r => (finish = r))
  // Close the shared listener and kill cloudflared; safe to call twice.
  async function stop(why = "stopped") {
    if (ended) return
    ended = true
    clearTimeout(timer)
    if (child) child.kill()
    live.delete(stop)
    process.off("exit", kill)
    app.forget(listener)
    await listener.close()
    finish(why)
  }
  live.add(stop)
  const out = { token, port, localUrl, shareUrl: null, stop, done }
  if (!tunnel) return out
  child = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] })
  process.once("exit", kill)
  const url = await new Promise((ok, bad) => {
    let buf = ""
    setTimeout(() => bad(new Error(`cloudflared gave no URL within ${Math.round(urlTimeoutMs / 1000)} s`)), urlTimeoutMs).unref()
    const read = d => {
      buf = (buf + d).slice(-4000)
      const m = buf.match(URL_RE)
      if (m) ok(m[0])
    }
    child.stdout.on("data", read)
    child.stderr.on("data", read)
    child.on("error", e => bad(e.code === "ENOENT" ? new Error("cloudflared is not installed") : e))
    child.on("exit", () => bad(new Error("cloudflared exited before it gave a URL")))
  }).catch(async e => { await stop("failed"); throw e })
  out.shareUrl = `${url}${base}`
  child.removeAllListeners("exit")
  child.on("exit", () => { log("cloudflared exited; sharing stopped."); stop("cloudflared exited") })
  timer = setTimer(() => stop("time limit"), minutes * 60000)
  timer.unref?.()
  return out
}
