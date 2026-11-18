// One listener: static files, /events (SSE), /poke, the security headers and the limits.
// The mode and the base are fixed when it is created and never read from a request.
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { timingSafeEqual } from "node:crypto"
import { sanitize } from "./sanitize.js"

export const POKE_KINDS = ["horn", "wave", "feed", "fireworks"]
const MAX_BODY = 200
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".glb": "model/gltf-binary", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" }
const HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
}

// Poke limits: 1 per second per viewer, 5 per second in all. Only allowed attempts are recorded.
export function createRateLimiter({ now = Date.now, perViewerMs = 1000, globalMax = 5, windowMs = 1000 } = {}) {
  const byViewer = new Map()
  let recent = []
  return key => {
    const t = now()
    recent = recent.filter(x => t - x < windowMs)
    for (const [k, x] of byViewer) if (t - x >= perViewerMs) byViewer.delete(k)
    if (byViewer.has(key) || recent.length >= globalMax) return false
    byViewer.set(key, t)
    recent.push(t)
    return true
  }
}

// Write a chunk to an SSE client; a client that does not read (more than maxBuffer queued) is dropped.
export function writeTo(res, chunk, maxBuffer = 256 * 1024) {
  res.write(chunk)
  if (res.writableLength > maxBuffer) res.destroy()
}

// Every id a poke may target: "harbor" and all ids in the current scene.
function sceneIds(scene) {
  const ids = new Set(["harbor"])
  for (const r of scene.runs) {
    ids.add(r.id)
    if (r.orchestrator) ids.add(r.orchestrator.id)
    for (const w of r.workers) ids.add(w.id)
  }
  for (const a of scene.adrift) ids.add(a.id)
  return ids
}

// A path inside `root` for a request-relative path, or null. Strict: no %-escapes, no backslashes, no
// empty or dot segments (so no `..` and no dotfiles), and only the listed extensions.
function resolveStatic(root, rel) {
  if (!rel || /[%\\\0]/.test(rel)) return null
  const segs = rel.split("/")
  if (segs.some(s => s === "" || s.startsWith("."))) return null
  if (!(path.extname(rel).toLowerCase() in TYPES)) return null
  const full = path.resolve(root, rel)
  return full.startsWith(path.resolve(root) + path.sep) ? full : null
}

// Create a listener. `snapshot()` gives { facts, stale }. mode "private" or "shared"; base "/" or "/s/<token>/".
export function createListener({ base = "/", mode, secret, snapshot, now = Date.now, publicDir, vendorDir, maxSse = mode === "shared" ? 20 : 8, keepAliveMs = 20000, maxBuffer = 256 * 1024 }) {
  const clients = new Set()
  const allow = createRateLimiter({ now })
  const baseBuf = Buffer.from(base)
  let scene = null, json = ""
  let timer = null

  // Rebuild the scene; true when it differs from the last one sent.
  function rebuild() {
    const { facts, stale } = snapshot()
    scene = sanitize(facts, { mode, secret, now: now(), viewers: clients.size, stale })
    const next = JSON.stringify(scene)
    const changed = next !== json
    json = next
    return changed
  }
  const send = (res, event, data) => writeTo(res, `event: ${event}\ndata: ${data}\n\n`, maxBuffer)
  const broadcast = (event, data, skip) => { for (const c of clients) if (c !== skip) send(c, event, data) }
  // Called by the poll loop: push the scene to everyone if it changed.
  function refresh() { if (rebuild()) broadcast("scene", json) }

  function reply(res, status, headers = {}, body = "") {
    res.writeHead(status, { ...HEADERS, ...headers })
    res.end(body)
  }

  function events(req, res) {
    if (clients.size >= maxSse) return reply(res, 503)
    res.writeHead(200, { ...HEADERS, "Content-Type": "text/event-stream", Connection: "keep-alive" })
    res.write("retry: 3000\n\n")
    clients.add(res)
    res.on("close", () => { clients.delete(res); refresh() })
    const changed = rebuild()
    send(res, "scene", json)
    if (changed) broadcast("scene", json, res)
  }

  function poke(req, res) {
    const type = req.headers["content-type"] || ""
    const vid = req.headers["x-viewer"]
    const key = typeof vid === "string" && /^[a-f0-9]{16}$/.test(vid) ? `v:${vid}` : `ip:${req.socket.remoteAddress}`
    if (!allow(key)) return reply(res, 429)
    if (!/^application\/json\s*(;|$)/i.test(type)) return reply(res, 400)
    if (Number(req.headers["content-length"]) > MAX_BODY) return tooBig(req, res)
    let size = 0
    const chunks = []
    req.on("data", c => {
      size += c.length
      if (size > MAX_BODY) return tooBig(req, res)
      chunks.push(c)
    })
    req.on("end", () => {
      if (res.headersSent) return
      let b
      try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { return reply(res, 400) }
      if (b === null || typeof b !== "object" || Array.isArray(b)) return reply(res, 400)
      const { kind, target } = b
      if (typeof kind !== "string" || !POKE_KINDS.includes(kind)) return reply(res, 400)
      if (typeof target !== "string" || !sceneIds(scene).has(target)) return reply(res, 400)
      broadcast("poke", JSON.stringify({ kind, target, at: now() }))
      reply(res, 204)
    })
  }
  // Answer 400 and drop the connection: the rest of an oversized body is never read.
  function tooBig(req, res) {
    if (res.headersSent) return
    res.writeHead(400, { ...HEADERS, Connection: "close" })
    res.end(() => req.destroy())
  }

  async function file(req, res, full, root) {
    try {
      const real = await fs.promises.realpath(full)
      const realRoot = await fs.promises.realpath(root)
      if (!real.startsWith(realRoot + path.sep)) return reply(res, 404)
      if (!(await fs.promises.stat(real)).isFile()) return reply(res, 404)
      res.writeHead(200, { ...HEADERS, "Content-Type": TYPES[path.extname(real).toLowerCase()] })
      if (req.method === "HEAD") return res.end()
      fs.createReadStream(real).on("error", () => res.destroy()).pipe(res)
    } catch { reply(res, 404) }
  }

  function route(req, res) {
    const port = server.address()?.port
    if (mode === "private") {
      const ok = [`127.0.0.1:${port}`, `localhost:${port}`]
      if (!ok.includes(req.headers.host)) return reply(res, 403)
      const o = req.headers.origin
      if (req.method === "POST" && o !== undefined && !ok.some(h => o === `http://${h}`)) return reply(res, 403)
    }
    const url = req.url || ""
    const q = url.indexOf("?")
    const p = q < 0 ? url : url.slice(0, q)
    const head = Buffer.from(p.slice(0, base.length))
    if (head.length !== baseBuf.length || !timingSafeEqual(head, baseBuf)) return reply(res, 404)
    const rest = p.slice(base.length)
    const get = req.method === "GET" || req.method === "HEAD"
    if (rest === "poke") return req.method === "POST" ? poke(req, res) : reply(res, 405, { Allow: "POST" })
    if (!get) return reply(res, 405, { Allow: "GET, HEAD" })
    if (rest === "events") return req.method === "GET" ? events(req, res) : reply(res, 405, { Allow: "GET" })
    let root = null, rel = null
    if (rest === "") [root, rel] = [publicDir, "index.html"]
    else if (rest.startsWith("assets/")) [root, rel] = [publicDir, rest.slice(7)]
    else if (/^vendor\/three\/(build|examples\/jsm)\//.test(rest)) [root, rel] = [vendorDir, rest.slice(13)]
    const full = root && resolveStatic(root, rel)
    if (!full) return reply(res, 404)
    file(req, res, full, root)
  }

  const server = http.createServer((req, res) => {
    try { route(req, res) } catch { if (!res.headersSent) reply(res, 500); else res.destroy() }
  })

  // Socket limits: few connections, and no slow request can hold a socket (SSE responses are not affected).
  server.maxConnections = mode === "shared" ? 64 : 32
  server.requestTimeout = 10000
  server.headersTimeout = 5000

  return {
    server, refresh,
    scene: () => scene,
    viewers: () => clients.size,
    // Listen on 127.0.0.1; with `tries` > 1 a taken port moves on to the next one.
    async listen(port = 0, tries = 1) {
      for (let i = 0; ; i++) {
        try {
          await new Promise((ok, bad) => { server.once("error", bad); server.listen(port ? port + i : 0, "127.0.0.1", () => { server.off("error", bad); ok() }) })
          break
        } catch (e) { if (e.code !== "EADDRINUSE" || i + 1 >= tries) throw e }
      }
      rebuild()
      timer = setInterval(() => { for (const c of clients) writeTo(c, ": keep-alive\n\n", maxBuffer) }, keepAliveMs)
      timer.unref()
      return server.address().port
    },
    close() {
      clearInterval(timer)
      for (const c of clients) c.end()
      clients.clear()
      return new Promise(ok => { server.close(() => ok()); server.closeAllConnections() })
    },
  }
}
