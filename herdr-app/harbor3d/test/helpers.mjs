// Shared test helpers: fixtures, temp dirs, and a listener on an ephemeral port.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createListener } from "../server/http.js"

const here = path.dirname(fileURLToPath(import.meta.url))
export const fixture = name => JSON.parse(fs.readFileSync(path.join(here, "fixtures", name), "utf8"))
export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "harbor3d-test-"))
export const SECRET = Buffer.from("test-secret-test-secret-test-secret")
export const publicDir = path.join(here, "..", "public")
export const vendorDir = path.join(here, "..", "node_modules", "three")

// Start a listener over fixed facts. Returns { l, url, port, close, set(facts, stale) }.
export async function start({ mode = "private", base = "/", facts = fixture("facts-basic.json"), stale = false, now = () => facts.at, ...rest } = {}) {
  const state = { facts, stale }
  const l = createListener({ base, mode, secret: SECRET, snapshot: () => state, now, publicDir, vendorDir, ...rest })
  const port = await l.listen(0)
  return { l, port, url: `http://127.0.0.1:${port}${base}`, set(f, s = false) { state.facts = f; state.stale = s; l.refresh() }, close: () => l.close() }
}

// Open an SSE connection and collect events; resolves once the connection is open.
export async function sse(url, headers = {}) {
  const ac = new AbortController()
  const res = await fetch(url, { headers, signal: ac.signal })
  const events = [], waiters = []
  let buf = ""
  ;(async () => {
    try {
      for await (const chunk of res.body) {
        buf += Buffer.from(chunk).toString()
        let i
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2)
          const ev = /^event: (.*)$/m.exec(block), data = /^data: (.*)$/m.exec(block)
          if (ev) { events.push({ event: ev[1], data: JSON.parse(data[1]) }); waiters.splice(0).forEach(w => w()) }
        }
      }
    } catch {}
  })()
  // Wait until `pred` finds an event in the list.
  const waitFor = async pred => {
    for (let i = 0; i < 100; i++) { const e = events.find(pred); if (e) return e; await new Promise(r => { waiters.push(r); setTimeout(r, 50) }) }
    throw new Error("timed out waiting for an event")
  }
  return { res, events, waitFor, close: () => ac.abort() }
}
