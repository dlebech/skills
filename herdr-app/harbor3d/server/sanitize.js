// Facts → scene. Pure. The scene is built field by field from an allow-list: nothing is spread, copied
// or passed through, so a field nobody listed here can never reach a browser. Every enum is checked and
// falls back to a safe default; every free string is a label, stripped and cut to 60 characters.
import { hmacId, seaName } from "./names.js"
import { assignSlots, createSlots, MAX_BERTHS, MAX_ADRIFT } from "./slots.js"
export { createSlots }

const E = {
  captain: ["none", "watching", "idle", "working"],
  type: ["feat", "fix", "rev", "expl"],
  phase: ["planning", "running", "finished"],
  need: ["question", "gone", "stalled", "red-ci", "request-review", "changes-requested", "merge", "review-proof", "finished", "other"],
  pathKey: ["spec", "build", "proven", "review", "human", "merge"],
  pathState: ["done", "current", "you", "look", "fail", "todo"],
  task: ["planned", "implement", "review", "fix", "done", "blocked"],
  prState: ["open", "draft", "merged", "closed", "unknown"],
  checks: ["green", "red", "running", "none"],
  orch: ["working", "idle", "blocked", "done", "gone"],
  kind: ["claude", "pi", "opencode", "other"],
  worker: ["working", "idle", "blocked", "done"],
  adrift: ["working", "idle", "blocked", "done"],
}
const MAX = { runs: 50, path: 8, tasks: 60, prs: 10, workers: 30, adrift: 30 }

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v)
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : [])
// An enum value, or the fallback when it is anything else (including a non-string).
const pick = (v, allowed, fallback) => (typeof v === "string" && allowed.includes(v) ? v : fallback)
// A label: control characters out, at most 60 code points. "" when not a string.
const label = v => (typeof v === "string" ? [...v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "")].slice(0, 60).join("").trim() : "")
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const sizeOf = tokens => (tokens < 10e6 ? "S" : tokens < 50e6 ? "M" : tokens < 150e6 ? "L" : "XL")

// Build the scene for one mode ("private" shows real names, "shared" does not unless `realNames` is true,
// which `share --real-names` asks for). `names` is the listener's key -> sea name map (kept for the server's
// lifetime, see seaName).
export function sanitize(facts, { mode, realNames = mode === "private", secret, now, viewers = 0, stale = false, names = new Map(), slots = createSlots() }) {
  const priv = realNames === true
  const f = isObj(facts) ? facts : {}
  const runs = [], runKeys = []
  for (const r of list(f.runs, MAX.runs)) {
    if (!isObj(r) || typeof r.key !== "string") continue
    const sea = seaName(secret, r.key, names)
    const run = { id: hmacId(secret, "r", r.key), label: priv ? label(r.name) || sea : sea }
    if (priv) run.sub = label(r.repo)
    run.type = pick(r.type, E.type, null)
    run.phase = pick(r.phase, E.phase, "running")
    run.parked = r.parked === true
    run.needsYou = r.needsYou === true
    run.need = typeof r.need === "string" ? pick(r.need, E.need, "other") : null
    run.path = []
    for (const p of list(r.path, MAX.path)) if (isObj(p) && E.pathKey.includes(p.key)) run.path.push({ key: p.key, state: pick(p.state, E.pathState, "todo") })
    const tasks = list(r.tasks, MAX.tasks)
    run.tasks = tasks.map(t => pick(t, E.task, "planned"))
    run.prs = []
    for (const p of list(r.prs, MAX.prs)) {
      if (!isObj(p)) continue
      const pr = { state: pick(p.state, E.prState, "unknown"), checks: pick(p.checks, E.checks, "none") }
      if (priv && Number.isSafeInteger(p.number) && p.number > 0) pr.label = `#${p.number}`
      run.prs.push(pr)
    }
    run.ciRunning = r.ciRunning === true
    run.orchestrator = isObj(r.orchestrator) ? { id: hmacId(secret, "a", `orch:${r.key}`), state: pick(r.orchestrator.state, E.orch, "gone"), kind: pick(r.orchestrator.kind, E.kind, "other") } : null
    run.workers = []
    for (const w of list(r.workers, MAX.workers)) {
      if (!isObj(w) || typeof w.id !== "string") continue
      const out = { id: hmacId(secret, "a", w.id), state: pick(w.state, E.worker, "idle"), kind: pick(w.kind, E.kind, "other"), task: Number.isInteger(w.task) && w.task >= 0 && w.task < tasks.length ? w.task : null }
      if (priv) out.label = label(w.name)
      run.workers.push(out)
    }
    run.size = sizeOf(num(r.tokens))
    const age = Math.max(0, Math.floor((now - num(r.startedMs)) / 60000))
    run.ageMinutes = r.startedMs === undefined || num(r.startedMs) === 0 ? 0 : priv ? age : Math.round(age / 5) * 5
    runs.push(run); runKeys.push(r.key)
  }
  // Slots: kept while the run stays in the facts, the lowest free one for a new run, freed when it leaves. -1: no room.
  const quayKeys = runKeys.filter((k, i) => !runs[i].parked), parkedKeys = runKeys.filter((k, i) => runs[i].parked)
  slots.quay = assignSlots(slots.quay, quayKeys, MAX_BERTHS)
  slots.parked = assignSlots(slots.parked, parkedKeys, MAX_BERTHS)
  runs.forEach((run, i) => { run.slot = (run.parked ? slots.parked : slots.quay).get(runKeys[i]) ?? -1 })
  const adrift = [], adriftKeys = []
  for (const a of list(f.adrift, MAX.adrift)) {
    if (!isObj(a) || typeof a.id !== "string") continue
    const out = { id: hmacId(secret, "a", a.id), state: pick(a.state, E.adrift, "idle"), kind: pick(a.kind, E.kind, "other") }
    if (priv) out.label = label(a.name)
    adrift.push(out); adriftKeys.push(a.id)
  }
  slots.adrift = assignSlots(slots.adrift, adriftKeys, MAX_ADRIFT)
  adrift.forEach((a, i) => { a.slot = slots.adrift.get(adriftKeys[i]) ?? -1 })
  return { v: 1, at: num(f.at), mode: mode === "private" ? "private" : "shared", stale: stale === true, viewers, captain: { state: pick(isObj(f.captain) ? f.captain.state : null, E.captain, "none") }, runs, adrift }
}
