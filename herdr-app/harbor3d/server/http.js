// One listener: static files, /events (SSE), /poke, the security headers and the limits.
// The mode and the base are fixed when it is created and never read from a request.
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { timingSafeEqual, createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"
import { promisify } from "node:util"
import { sanitize } from "./sanitize.js"

export const POKE_KINDS = ["wave", "feed", "fireworks"]
const MAX_BODY = 200
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".glb": "model/gltf-binary", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" }
export const MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "models", "out")
const HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
}

// The CSP source for the page's one inline script (the import map): 'sha256-<base64>' of its exact text, or
// "" when the page has none. Read once, when a listener is created.
export function importMapHash(publicDir) {
  try {
    const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8")
    const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)
    return m ? `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'` : ""
  } catch { return "" }
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

const GZIP_TYPES = new Set([".html", ".js", ".css", ".json", ".svg"])
const gzip = promisify(zlib.gzip)
// Compress each file once: path -> { mtime, size, p } where p is the promise of the gzip body (null when it is
// not worth sending compressed). Concurrent first requests share one compression, off the event loop.
const gzCache = new Map()

// The gzip body for a file, or null when the type is not compressed or (for .glb) it shrinks by 10 % or less.
async function gzipped(real, st) {
  const ext = path.extname(real).toLowerCase()
  if (!GZIP_TYPES.has(ext) && ext !== ".glb") return null
  let hit = gzCache.get(real)
  if (!hit || hit.mtime !== st.mtimeMs || hit.size !== st.size) {
    const p = fs.promises.readFile(real).then(async raw => {
      const gz = await gzip(raw, { level: 9 })
      return ext === ".glb" && gz.length > raw.length * 0.9 ? null : gz
    })
    hit = { mtime: st.mtimeMs, size: st.size, p }
    gzCache.set(real, hit)
    p.catch(() => { if (gzCache.get(real) === hit) gzCache.delete(real) })
  }
  return hit.p
}

// Does an Accept-Encoding header allow gzip? An explicit gzip;q=0 refuses it, and "*" allows it unless gzip is named.
export function acceptsGzip(header) {
  let star = null, gz = null
  for (const part of String(header || "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";")
    const q = params.map(x => x.trim()).find(x => x.startsWith("q="))
    const v = q === undefined ? 1 : Number(q.slice(2))
    if (name === "gzip") gz = v
    else if (name === "*") star = v
  }
  return (gz ?? star ?? 0) > 0
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
// `pollHoldMs` is how long a long-poll waits for news (12 s; tests shorten it).
export function createListener({ base = "/", mode, secret, snapshot, now = Date.now, publicDir, vendorDir, modelsDir = MODELS_DIR, hub, maxSse = mode === "shared" ? 20 : 8, keepAliveMs = 20000, maxBuffer = 256 * 1024, pollHoldMs = 12000 }) {
  const hash = importMapHash(publicDir)
  const HEAD = { ...HEADERS, "Content-Security-Policy": HEADERS["Content-Security-Policy"].replace("script-src 'self'", `script-src 'self'${hash ? " " + hash : ""}`) }
  const clients = new Set()
  const allow = createRateLimiter({ now })
  const baseBuf = Buffer.from(base)
  // Pokes and viewer counts cross listeners through the hub; alone, a listener is its own hub.
  const self = { deliver: data => deliverPoke(data) }
  hub ??= { broadcastPoke: data => self.deliver(data), viewerCount: () => viewers(), refreshAll: () => refresh() }
  let scene = null, json = ""
  const names = new Map()   // run key -> sea name, only ever added to, so names stay put when the order changes
  let timer = null
  // The event log long-polling readers use (for proxies that buffer SSE): `n` counts every scene change and every
  // poke delivered here, `sceneN` is the `n` the current scene was built at, and `log` holds the last 50 pokes.
  let n = 0, sceneN = 0
  const log = []
  // Polling viewers by their x-viewer id: when they last polled, the start times of their last polls (for the
  // 2 per second limit) and the poll being held for them right now, if any. They count as viewers for 30 s.
  const pollers = new Map()
  const POLLER_TTL = 30000
  const livePoller = (e, t) => e.held || t - e.seen < POLLER_TTL
  function pollViewers() {
    const t = now()
    for (const [id, e] of pollers) if (!livePoller(e, t)) pollers.delete(id)
    return pollers.size
  }
  const viewers = () => clients.size + pollViewers()

  // Rebuild the scene; true when it differs from the last one sent.
  function rebuild() {
    const { facts, stale } = snapshot()
    scene = sanitize(facts, { mode, secret, now: now(), viewers: hub.viewerCount(), stale, names })
    const next = JSON.stringify(scene)
    const changed = next !== json
    json = next
    if (changed) { n++; sceneN = n; wake() }
    return changed
  }
  // Is there anything a client that has seen up to `after` has not seen? (A client ahead of us means we restarted.)
  const hasNews = after => after > n || sceneN > after || (log.length > 0 && log[log.length - 1].n > after)
  // The poll answer: the scene when it is newer than `after` (or the client is ahead of us), and the pokes newer than `after`.
  function pollBody(after) {
    const pokes = log.filter(p => p.n > after).map(({ kind, target, at }) => ({ kind, target, at }))
    return `{"n":${n},${after > n || sceneN > after ? `"scene":${json},` : ""}"pokes":${JSON.stringify(pokes)}}`
  }
  // End a held poll: with the answer when there is news, else with just `n`.
  function finishPoll(e, news = true) {
    const h = e.held
    if (!h) return
    clearTimeout(h.timer)
    e.held = null; e.seen = now()
    if (!h.res.destroyed && !h.res.writableEnded) reply(h.res, 200, { "Content-Type": "application/json" }, news ? pollBody(h.after) : `{"n":${n}}`)
  }
  // Something happened: answer every held poll it matters to.
  function wake() { for (const e of pollers.values()) if (e.held && hasNews(e.held.after)) finishPoll(e) }
  const deliverPoke = data => {
    let p; try { p = JSON.parse(data) } catch { return }
    log.push({ n: ++n, kind: p.kind, target: p.target, at: p.at })
    if (log.length > 50) log.shift()
    broadcast("poke", data)
    wake()
  }
  const send = (res, event, data) => writeTo(res, `event: ${event}\ndata: ${data}\n\n`, maxBuffer)
  const broadcast = (event, data, skip) => { for (const c of clients) if (c !== skip) send(c, event, data) }
  // Called by the poll loop: push the scene to everyone if it changed.
  function refresh() { if (rebuild()) broadcast("scene", json) }

  function reply(res, status, headers = {}, body = "") {
    res.writeHead(status, { ...HEAD, ...headers })
    res.end(body)
  }

  function events(req, res) {
    if (viewers() >= maxSse) return reply(res, 503)
    res.writeHead(200, { ...HEAD, "Content-Type": "text/event-stream", Connection: "keep-alive" })
    res.write("retry: 3000\n\n")
    clients.add(res)
    res.on("close", () => { clients.delete(res); refresh(); hub.refreshAll() })
    const changed = rebuild()
    send(res, "scene", json)
    if (changed) broadcast("scene", json, res)
    hub.refreshAll()
  }

  // GET poll?after=<n>: long-polling for viewers behind a proxy that buffers SSE (Cloudflare quick tunnels do).
  function poll(req, res, query) {
    const afters = new URLSearchParams(query).getAll("after"), raw = afters.length ? afters[0] : "0"
    const vid = req.headers["x-viewer"]
    if (afters.length > 1 || !/^\d{1,15}$/.test(raw) || typeof vid !== "string" || !/^[a-f0-9]{16}$/.test(vid)) return reply(res, 400)
    const after = Number(raw), t = now()
    pollViewers()
    let e = pollers.get(vid)
    if (!e && viewers() >= maxSse) return reply(res, 503)
    if (e) {
      e.starts = e.starts.filter(x => t - x < 1000)
      if (e.starts.length >= 2) return reply(res, 429)
    }
    const fresh = !e
    if (fresh) { e = { seen: t, starts: [], held: null }; pollers.set(vid, e) }
    finishPoll(e, false)   // a second poll from the same viewer ends the first
    e.seen = t; e.starts.push(t)
    if (fresh) hub.refreshAll()   // the viewer count changed
    if (hasNews(after)) return reply(res, 200, { "Content-Type": "application/json" }, pollBody(after))
    const held = { res, after, timer: setTimeout(() => finishPoll(e, false), pollHoldMs) }
    e.held = held
    res.on("close", () => { if (e.held === held) { clearTimeout(held.timer); e.held = null; e.seen = now() } })
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
      hub.broadcastPoke(JSON.stringify({ kind, target, at: now() }))
      reply(res, 204)
    })
  }
  // Answer 400 and drop the connection: the rest of an oversized body is never read.
  function tooBig(req, res) {
    if (res.headersSent) return
    res.writeHead(400, { ...HEAD, Connection: "close" })
    res.end(() => req.destroy())
  }

  async function file(req, res, full, root) {
    try {
      const real = await fs.promises.realpath(full)
      const realRoot = await fs.promises.realpath(root)
      if (!real.startsWith(realRoot + path.sep)) return reply(res, 404)
      if (!(await fs.promises.stat(real)).isFile()) return reply(res, 404)
      const st = await fs.promises.stat(real)
      const headers = { ...HEAD, "Content-Type": TYPES[path.extname(real).toLowerCase()], Vary: "Accept-Encoding" }
      const gz = acceptsGzip(req.headers["accept-encoding"]) ? await gzipped(real, st) : null
      if (gz) { headers["Content-Encoding"] = "gzip"; headers["Content-Length"] = gz.length }
      res.writeHead(200, headers)
      if (req.method === "HEAD") return res.end()
      if (gz) return res.end(gz)
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
    if (rest === "poll") return req.method === "GET" ? poll(req, res, q < 0 ? "" : url.slice(q + 1)) : reply(res, 405, { Allow: "GET" })
    if (rest === "events") return req.method === "GET" ? events(req, res) : reply(res, 405, { Allow: "GET" })
    let root = null, rel = null
    if (rest === "") [root, rel] = [publicDir, "index.html"]
    else if (rest.startsWith("assets/models/")) { rel = rest.slice(14); root = /^[\w.-]+\.glb$/i.test(rel) ? modelsDir : null }
    else if (rest.startsWith("assets/")) [root, rel] = [publicDir, rest]
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
    server, refresh, deliver: self.deliver,
    scene: () => scene,
    viewers,
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
      for (const e of pollers.values()) finishPoll(e, false)
      return new Promise(ok => { server.close(() => ok()); server.closeAllConnections() })
    },
  }
}
