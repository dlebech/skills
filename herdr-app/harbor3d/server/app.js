// The server's moving parts: one facts reader, a fresh secret, and any number of listeners that
// share them but not state. start() polls the facts file every 2 s and touches the want file every 20 s.
import { randomBytes } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createFactsReader, runsRoot } from "./facts.js"
import { createListener } from "./http.js"
import { createSlots } from "./sanitize.js"

const here = path.dirname(fileURLToPath(import.meta.url))
export const PUBLIC_DIR = path.join(here, "..", "public")
export const VENDOR_DIR = path.join(here, "..", "node_modules", "three")

// Create the app. `root` is the runs root (tests pass a temp dir).
export function createApp({ root = runsRoot(), now = Date.now, secret = randomBytes(32), publicDir = PUBLIC_DIR, vendorDir = VENDOR_DIR } = {}) {
  const reader = createFactsReader({ root, now })
  const listeners = new Set()
  // One berth memory and one sea-name map for the server's lifetime, shared by every listener, so every viewer sees the same order.
  const slots = createSlots(), names = new Map()
  // Both listeners meet here: an accepted poke (only its rebuilt {kind, target, at}) reaches every viewer of
  // both, and `viewers` counts both. Nothing else crosses: each listener still builds its own scene.
  const hub = {
    broadcastPoke(data) { for (const l of listeners) l.deliver(data) },
    viewerCount() { let n = 0; for (const l of listeners) n += l.viewers(); return n },
    // a viewer came or went: every listener rebuilds its scene (one that finds no change sends nothing)
    refreshAll() { for (const l of listeners) l.refresh() },
  }
  let timers = []
  const app = {
    reader, secret,
    // A listener of its own; `mode` and `base` are fixed here.
    listener(opts) {
      const l = createListener({ hub, secret, slots, names, snapshot: reader.snapshot, now, publicDir, vendorDir, ...opts })
      listeners.add(l)
      return l
    },
    // Read the facts file and push to every listener (stale can change without the file changing).
    poll() { reader.poll(); for (const l of listeners) l.refresh() },
    start() {
      app.poll()
      reader.touchWant()
      timers = [setInterval(app.poll, 2000), setInterval(reader.touchWant, 20000)]
      return app
    },
    forget(l) { listeners.delete(l) },
    stop() { timers.forEach(clearInterval); timers = [] },
  }
  return app
}
