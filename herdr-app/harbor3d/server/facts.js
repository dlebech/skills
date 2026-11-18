// Reads the facts file Harbormaster writes, and touches `.harbor3d.want` so it keeps writing it.
// The want file is the only file this server ever writes: a fixed path, no viewer input.
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export const MAX_BYTES = 1024 * 1024
export const STALE_MS = 45000

// The runs root: $HERDR_ORCHESTRATION_ROOT or ~/.herdr/hc-orchestration.
export const runsRoot = () => process.env.HERDR_ORCHESTRATION_ROOT || path.join(os.homedir(), ".herdr", "hc-orchestration")

// A reader with poll() (stat first, parse only when mtime or size changed), snapshot() and touchWant().
// A bad file (too big, invalid JSON, wrong shape) is ignored: the last good facts stay, and go stale.
export function createFactsReader({ root = runsRoot(), now = Date.now } = {}) {
  const file = path.join(root, ".harbor3d.json")
  const want = path.join(root, ".harbor3d.want")
  let last = null, seen = "", missing = true
  return {
    file, want,
    // Look at the file once; true when the good facts changed.
    poll() {
      let st
      try { st = fs.statSync(file) } catch { missing = true; return false }
      missing = false
      const sig = `${st.mtimeMs}:${st.size}`
      if (sig === seen) return false
      seen = sig
      if (!st.isFile() || st.size > MAX_BYTES) return false
      try {
        const text = fs.readFileSync(file, "utf8")
        if (text.length > MAX_BYTES) return false
        const j = JSON.parse(text)
        if (j === null || typeof j !== "object" || Array.isArray(j) || j.v !== 1 || typeof j.at !== "number" || !Number.isFinite(j.at)) return false
        last = j
        return true
      } catch { return false }
    },
    // The last good facts (or null) and whether they are stale: missing file, no facts, or `at` older than 45 s.
    snapshot() { return { facts: last, stale: missing || !last || now() - last.at > STALE_MS } },
    // Touch the want file: a fresh mtime, never a truncate and never through a link, created
    // empty with O_NOFOLLOW when missing. Never throws: no runs root just means no facts.
    touchWant() {
      const t = new Date()
      try { fs.lutimesSync(want, t, t) } catch {
        try { fs.closeSync(fs.openSync(want, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW)) } catch {}
      }
    },
  }
}
