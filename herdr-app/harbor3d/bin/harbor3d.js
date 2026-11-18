#!/usr/bin/env node
// harbor3d CLI: `serve` (private, localhost) and `share` (private plus a shared listener and a tunnel).
import fs from "node:fs"
import path from "node:path"
import { createApp, VENDOR_DIR } from "../server/app.js"
import { startShare, stopAll } from "../server/share.js"

const HELP = `harbor3d: a 3D harbor of your Herdr runs.

  harbor3d [serve] [--port 4173]    private listener on 127.0.0.1, real names
  harbor3d share [--minutes 60]     also a shared listener (pseudonyms only) behind a cloudflared tunnel
      --no-tunnel                   shared listener on 127.0.0.1 only, no cloudflared
  harbor3d --help

Reads <runs root>/.harbor3d.json (runs root: $HERDR_ORCHESTRATION_ROOT or ~/.herdr/hc-orchestration).`

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : Number(args[i + 1]) }
if (flag("--help") || flag("-h")) { console.log(HELP); process.exit(0) }
const cmd = args[0] && !args[0].startsWith("-") ? args[0] : "serve"
if (cmd !== "serve" && cmd !== "share") { console.error(`harbor3d: unknown command "${cmd}"\n\n${HELP}`); process.exit(2) }
const port = value("--port", 4173), minutes = value("--minutes", 60)
if (!Number.isInteger(port) || port < 0 || port > 65535 || !(minutes > 0)) { console.error("harbor3d: bad --port or --minutes"); process.exit(2) }

// The page imports three.js from node_modules/three; without it the page would load blank, so say so and stop.
if (!fs.existsSync(path.join(VENDOR_DIR, "build", "three.module.js"))) {
  console.error(`harbor3d: three.js is missing (${VENDOR_DIR}). Run npm install in ${path.dirname(path.dirname(VENDOR_DIR))}.`)
  process.exit(1)
}

const app = createApp()
const priv = app.listener({ mode: "private", base: "/" })
try {
  const p = await priv.listen(port, 11)
  console.log(`Harbor 3D: http://127.0.0.1:${p}/`)
} catch (e) { console.error(`harbor3d: cannot listen: ${e.message}`); process.exit(1) }
app.start()

let share = null
const quit = async () => { app.stop(); await stopAll(); await priv.close(); process.exit(0) }
process.on("SIGINT", quit)
process.on("SIGTERM", quit)

if (cmd === "share") {
  try {
    share = await startShare(app, { minutes, tunnel: !flag("--no-tunnel"), log: m => console.log(m) })
  } catch (e) { console.error(`harbor3d: ${e.message}`); app.stop(); await priv.close(); process.exit(1) }
  if (flag("--no-tunnel")) console.log(`Shared (local only): ${share.localUrl}`)
  else console.log(`Share: ${share.shareUrl}\nStops in ${minutes} min or on Ctrl-C.`)
  share.done.then(why => console.log(`Sharing ended (${why}). The private harbor keeps running.`))
}
