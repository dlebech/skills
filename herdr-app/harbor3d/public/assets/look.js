// What a scene fact looks like. Pure: scene model in, plain descriptions out (numbers, colours as hex,
// and short strings built only from fixed tables). berths.js and world.js apply them. Every function has
// a safe default for a value outside its enum, and none throws on odd input.
import { containerSlots, deckAssign, CARGO_COLORS, MAX_WORKERS } from "./layout.js"

const has = (t, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(t, k)
const pick = (t, k, d) => (has(t, k) ? t[k] : d)

export const STAGE_COLORS = { planned: "#9aa7b1", implement: "#f2c94c", review: "#3f8fd2", fix: "#f08a5d", blocked: "#d4553e" }
export const PR_COLORS = { open: "#3f8fd2", draft: "#9aa1a8", merged: "#8256d0", closed: "#5d6770", unknown: "#9aa1a8" }
export const RED = "#d4553e"
export const SIZE_SCALE = { S: 0.8, M: 1.0, L: 1.2, XL: 1.4 }
export const NEED_TEXT = {
  question: "has a question", gone: "orchestrator gone", stalled: "stalled", "red-ci": "CI is red", "request-review": "request review",
  "changes-requested": "changes requested", merge: "ready to merge", "review-proof": "review the proof", finished: "read and close", other: "needs a look",
}
export const PATH_LABEL = { spec: "Spec", build: "Build", proven: "Proven", review: "AI review", human: "Review", merge: "Merge" }
export const PATH_MARK = { done: "✓", you: "●", look: "⚠", fail: "✗", current: "", todo: "" }
export const TYPE_TEXT = { feat: "Feature", fix: "Fix", rev: "Review", expl: "Explore" }
export const TASK_ORDER = ["planned", "implement", "review", "fix", "blocked", "done"]

// The orchestrator octopus. Order matters: gone and done beat the rest; blocked or "needs you" beats working.
export function orchestratorLook(run) {
  const state = run && run.orchestrator && typeof run.orchestrator.state === "string" ? run.orchestrator.state : "idle"
  const base = { bob: null, sway: false, wave: false, lean: false, eyelids: 0, opacity: 1 }
  if (state === "gone") return { ...base, eyelids: 1, opacity: 0.4 }
  if (state === "blocked" || (run && run.needsYou === true)) return { ...base, wave: true, lean: true, bob: { amp: 0.1, period: 2.4 } }
  if (state === "done") return { ...base, eyelids: 1 }
  if (state === "working") return { ...base, bob: { amp: 0.15, period: 1.5 }, sway: true }
  return { ...base, bob: { amp: 0.08, period: 3.2 } }
}

// A worker crab. Working: walks along its lane on the pier (2 m each way, one lap in 2.4 s).
export function workerLook(state) {
  if (state === "working") return { motion: "walk", amp: 2, period: 2.4, tilt: 0 }
  if (state === "blocked") return { motion: "hop", amp: 0.25, period: 0.8, tilt: 0 }
  if (state === "done") return { motion: "still", amp: 0, period: 1, tilt: 12 }
  return { motion: "claws", amp: 0, period: 2.4, tilt: 0 }
}

// A task's stage, with anything unknown read as planned.
export const stageOf = t => (has(STAGE_COLORS, t) || t === "done" ? t : "planned")

// One container for one task: its colour and tilt (radians) from its stage. `index` is the task's place
// in the run's task list (done containers take a cargo colour from it).
export function containerLook(stage, index = 0) {
  const s = stageOf(stage)
  if (s === "done") return { color: CARGO_COLORS[(Number.isInteger(index) && index >= 0 ? index : 0) % CARGO_COLORS.length], tilt: 0 }
  return { color: STAGE_COLORS[s], tilt: s === "blocked" ? (8 * Math.PI) / 180 : 0 }
}

// Where each task's container goes and what it looks like: [{ zone, index, x, y, z, angle, color, tilt }].
// zone: yard (planned), pier (implement, review, fix, blocked), deck (done) or none (over a cap).
// With `castOff` the pier shows no containers. `deckSlots` is the previous plan's deck slot per task
// (`plan.map(p => p.zone === "deck" ? p.index : null)`), so a done container keeps its place.
export function containerPlan(tasks, castOff = false, deckSlots = null) {
  const stages = (Array.isArray(tasks) ? tasks : []).map(stageOf)
  return containerSlots(stages, deckAssign(deckSlots, stages)).map((slot, i) => {
    const l = containerLook(stages[i], i)
    return { ...slot, color: l.color, tilt: l.tilt, zone: castOff && slot.zone === "pier" ? "none" : slot.zone }
  })
}

// A flag for one PR. Red checks make it red; running checks make it wave twice as fast.
export function flagLook(pr) {
  const state = pr && pr.state, checks = pr && pr.checks
  return { color: checks === "red" ? RED : pick(PR_COLORS, state, PR_COLORS.unknown), speed: checks === "running" ? 2 : 1 }
}

export const sizeScale = size => pick(SIZE_SCALE, size, 1)

const busyStages = ["implement", "review", "fix"]
const isWorking = s => s === "working"

// The signal lamp (the page blinks the red one): red when the run needs you; green while the orchestrator or any worker is
// working or CI runs; dark when parked, or finished with every stage of the path done; amber otherwise.
export function signalLook(run) {
  const r = run || {}
  const path = Array.isArray(r.path) ? r.path : []
  if (r.parked === true) return { lamp: "dark" }
  if (r.needsYou === true) return { lamp: "red" }
  const workers = Array.isArray(r.workers) ? r.workers : []
  if (isWorking(r.orchestrator && r.orchestrator.state) || workers.some(w => w && isWorking(w.state)) || r.ciRunning === true) return { lamp: "green" }
  if (r.phase === "finished" && path.length > 0 && path.every(p => p && p.state === "done")) return { lamp: "dark" }
  return { lamp: "amber" }
}

// The ship's state: anchored (parked), castoff (it has PRs and all are merged) or berthed.
export function shipState(run) {
  const r = run || {}
  if (r.parked === true) return "anchored"
  const prs = Array.isArray(r.prs) ? r.prs : []
  return prs.length > 0 && prs.every(p => p && p.state === "merged") ? "castoff" : "berthed"
}

// Everything about one berth that is not a creature or a container: the ship's state and size, lights,
// smoke, the crane, the signal, flags, opacity, and the octopus.
export function berthLook(run) {
  const r = run || {}
  const parked = r.parked === true
  const state = shipState(r)
  const tasks = Array.isArray(r.tasks) ? r.tasks : []
  const workers = Array.isArray(r.workers) ? r.workers : []
  const orch = orchestratorLook(r)
  const o = parked ? { ...orch, bob: null, sway: false, wave: false, lean: false } : orch
  return {
    parked, state,
    castOff: state === "castoff",
    scale: sizeScale(r.size),
    lights: r.phase === "finished",
    smoke: r.ciRunning === true && !parked,
    craneBusy: state === "berthed" && tasks.some(t => busyStages.includes(t)) && workers.some(w => w && isWorking(w.state)),
    signal: signalLook(r),
    beacon: r.needsYou === true && !parked,
    flags: Array.isArray(r.prs) ? Math.min(r.prs.length, 4) : 0,
    orchestrator: o,
  }
}

// The tug. `none`: moored and 40 % opaque; `idle`: moored; `watching`: patrols (one lap in 90 s);
// `working`: patrols at double speed (45 s).
export function captainLook(state) {
  if (state === "watching") return { opacity: 1, patrol: true, period: 90 }
  if (state === "working") return { opacity: 1, patrol: true, period: 45 }
  if (state === "idle") return { opacity: 1, patrol: false, period: 90 }
  return { opacity: 0.4, patrol: false, period: 90 }
}

export const gullCount = viewers => (Number.isFinite(viewers) ? Math.max(0, Math.min(20, Math.floor(viewers))) : 0)

// ---- sky ----
const hex2 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
const toHex = c => "#" + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const KEYS = [
  [0, "night"], [6, "dawn"], [8, "day"], [17, "day"], [19, "dusk"], [21, "night"], [24, "night"],
]
const SKY = {
  night: { sky: "#0b1530", ground: "#101c33", sun: "#8fa8e6", sunI: 0.9, hemiI: 1.5, night: 1 },
  dawn: { sky: "#f0b58f", ground: "#6d7c91", sun: "#ffc490", sunI: 1.0, hemiI: 0.75, night: 0.2 },
  day: { sky: "#9fd2f0", ground: "#6f8fa8", sun: "#fff4dc", sunI: 2.2, hemiI: 1.1, night: 0 },
  dusk: { sky: "#e48a6b", ground: "#5b5f82", sun: "#ffa66f", sunI: 1.1, hemiI: 0.7, night: 0.35 },
}
const SKY_RGB = Object.fromEntries(Object.entries(SKY).map(([k, v]) => [k, { ...v, sky: hex2(v.sky), ground: hex2(v.ground), sun: hex2(v.sun) }]))

// Sky, light and sun direction for an hour of the viewer's clock (0 to 24, fractions allowed).
// `mode` is "auto" (the hour), "day" or "night". A stale scene is greyer and dimmer.
export function skyLook(hour, mode = "auto", stale = false) {
  const h = mode === "day" ? 13 : mode === "night" ? 0 : Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 12
  let i = 0
  while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++
  const [h0, k0] = KEYS[i], [h1, k1] = KEYS[i + 1]
  const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0)
  const a = SKY_RGB[k0], b = SKY_RGB[k1]
  let sky = mix(a.sky, b.sky, t), ground = mix(a.ground, b.ground, t), sun = mix(a.sun, b.sun, t)
  let sunI = a.sunI + (b.sunI - a.sunI) * t, hemiI = a.hemiI + (b.hemiI - a.hemiI) * t
  const night = a.night + (b.night - a.night) * t
  if (stale) {
    const grey = c => { const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return mix(c, [l, l, l], 0.45) }
    sky = grey(sky); ground = grey(ground); sun = grey(sun)
    sunI *= 0.8; hemiI *= 0.8
  }
  // The sun rises in the east (+X side) at 6, is highest at 12 and sets in the west at 18; at night the
  // same light is a moon high in the south-west.
  const day = h >= 6 && h <= 18
  const ang = day ? ((h - 6) / 12) * Math.PI : 0.8
  const elev = day ? Math.max(0.12, Math.sin(ang)) : 0.55
  const az = day ? Math.PI - ang : 3.9
  const sunDir = [Math.cos(az) * Math.sqrt(1 - elev * elev), elev, Math.sin(az) * Math.sqrt(1 - elev * elev) * 0.6 + 0.3]
  const n = Math.hypot(...sunDir)
  return { sky: toHex(sky), ground: toHex(ground), sun: toHex(sun), sunIntensity: sunI, hemiIntensity: hemiI, night, grey: stale ? 0.45 : 0, sunDir: sunDir.map(v => v / n) }
}

// ---- text ----
// Counts of tasks per state.
export function taskCounts(tasks) {
  const c = Object.fromEntries(TASK_ORDER.map(k => [k, 0]))
  for (const t of Array.isArray(tasks) ? tasks : []) c[has(c, t) ? t : "planned"]++
  return c
}

// The short line under a berth's name, built only from fixed tables and counts.
export function labelLine(run) {
  const r = run || {}
  if (r.needsYou === true) return `Needs you · ${pick(NEED_TEXT, r.need, NEED_TEXT.other)}`
  if (r.parked === true) return "Parked"
  if (r.phase === "finished") return "Finished"
  if (r.phase === "planning") return "Planning"
  if (r.phase === "running") {
    const tasks = Array.isArray(r.tasks) ? r.tasks : []
    return tasks.length ? `Building ${taskCounts(tasks).done}/${tasks.length}` : "Building"
  }
  return "Underway"
}

// The path to merge as a row of { label, mark, dim } (mark is "" for current and todo; todo is dim).
export function pathRow(path) {
  const out = []
  for (const p of Array.isArray(path) ? path : []) {
    if (!p || !has(PATH_LABEL, p.key)) continue
    const state = p.state
    out.push({ label: PATH_LABEL[p.key], mark: pick(PATH_MARK, state, ""), dim: state === "todo" || !has(PATH_MARK, state), current: state === "current" })
  }
  return out
}
// The same row as one string: "Build ✓ › Proven ✓ › AI review ⚠ › Review ● › Merge".
export const pathText = path => pathRow(path).map(p => (p.mark ? `${p.label} ${p.mark}` : p.label)).join(" › ")

// "3 h 10 min", "45 min", "1 d 2 h", or "just started" for zero.
export function ageText(min) {
  const m = Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0
  if (m < 1) return "just started"
  if (m < 60) return `${m} min`
  if (m < 1440) return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`
  const h = Math.floor((m % 1440) / 60)
  return h ? `${Math.floor(m / 1440)} d ${h} h` : `${Math.floor(m / 1440)} d`
}

export const workerName = (w, i) => (w && typeof w.label === "string" && w.label ? w.label : `Crab ${i + 1}`)

// Everything the info card shows, as plain strings and lists (ui.js puts them in with textContent).
export function cardModel(run) {
  const r = run || {}
  const workers = Array.isArray(r.workers) ? r.workers : []
  const prs = Array.isArray(r.prs) ? r.prs : []
  const counts = taskCounts(r.tasks)
  const notes = []
  if (workers.length > MAX_WORKERS) notes.push(`${workers.length - MAX_WORKERS} more workers are not drawn`)
  const stages = (Array.isArray(r.tasks) ? r.tasks : []).map(stageOf)
  const undrawn = containerSlots(stages).filter(s => s.zone === "none").length
  if (undrawn > 0) notes.push(`+${undrawn} more task${undrawn === 1 ? "" : "s"} not drawn`)
  if (prs.length > 4) notes.push(`${prs.length - 4} more PRs are not drawn`)
  return {
    title: typeof r.label === "string" ? r.label : "",
    sub: typeof r.sub === "string" && r.sub ? r.sub : "",
    type: pick(TYPE_TEXT, r.type, "Run"),
    phase: labelLine(r),
    path: pathRow(r.path),
    tasks: TASK_ORDER.filter(k => counts[k] > 0).map(k => `${counts[k]} ${k}`).join(" · ") || "no tasks yet",
    prs: prs.map(p => [p && typeof p.label === "string" ? p.label : "PR", pick(PR_COLORS, p && p.state, null) ? p.state : "unknown", `checks ${["green", "red", "running"].includes(p && p.checks) ? p.checks : "none"}`].join(" · ")),
    workers: workers.map((w, i) => [workerName(w, i), ["claude", "pi", "opencode"].includes(w && w.kind) ? w.kind : "agent", ["working", "idle", "blocked", "done"].includes(w && w.state) ? w.state : "idle"].join(" · ")),
    age: ageText(r.ageMinutes),
    size: has(SIZE_SCALE, r.size) ? r.size : "M",
    notes,
  }
}
