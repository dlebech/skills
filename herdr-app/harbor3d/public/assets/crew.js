// The octopus is the foreman of its crabs. Pure decisions (no three.js) so they can be tested; berths.js plays them.
// Metres, the berth's local frame (+Z towards the sea, the octopus off the pier's tip at z = 30). A crab's yaw 0 faces +Z.
import { OCTOPUS, MAX_WORKERS } from "./layout.js"
import { stageOf } from "./look.js"

const TAU = Math.PI * 2
export const BEAT = 2.4           // seconds: the octopus's slow beat while it works, and the crabs' walk lap
export const ROLL_CALL = 1.5      // seconds the octopus points at the pier
export const CHEER_STAGGER = 0.08 // seconds between one crab's cheer hop and the next
export const CLAP = 0.9           // seconds for one clap
export const WAVE_OFF = 3         // seconds the octopus waves a ship off
export const CHECK_IN = 4         // seconds a crab that has just gone idle or done reports to the octopus before it goes back to work

const ids = run => (Array.isArray(run && run.workers) ? run.workers : []).map(w => (w && typeof w.id === "string" ? w.id : "")).sort().join(",")
const stages = run => (Array.isArray(run && run.tasks) ? run.tasks : []).map(stageOf)
const castOff = run => { const p = Array.isArray(run && run.prs) ? run.prs : []; return !(run && run.parked === true) && p.length > 0 && p.every(x => x && x.state === "merged") }

// What changed between two scene pushes of one run: { rollCall, done, castOff }. `rollCall` when workers joined or left or a
// task changed stage; `done` lists the tasks that just became done; `castOff` when the ship has just cast off.
// With no previous run (first sight) nothing happened.
export function crewEvents(prev, next) {
  const none = { rollCall: false, done: [], castOff: false }
  if (!prev || !next) return none
  const a = stages(prev), b = stages(next)
  const changed = ids(prev) !== ids(next) || a.length !== b.length || a.some((s, i) => s !== b[i])
  const done = b.map((s, i) => (s === "done" && i < a.length && a[i] !== "done" ? i : -1)).filter(i => i >= 0)
  return { rollCall: changed, done, castOff: !castOff(prev) && castOff(next) }
}

// The worker whose container is blocked, or -1: the octopus leans towards the first blocked crab.
export const blockedWorker = run => (Array.isArray(run && run.workers) ? run.workers : []).findIndex(w => w && w.state === "blocked")

// A spot at the pier's tip nearest the octopus for the k-th waiting crab: two columns, rows going back from the tip.
export function gatherSpot(k) {
  const row = Math.floor(k / 2)
  return { x: -6 + (k % 2 ? 0.7 : -0.7), z: 23.4 - row * 1.6 }
}

// The yaw (0 faces +Z) from a spot to the octopus.
export const faceOctopus = (x, z) => Math.atan2(OCTOPUS.x - x, OCTOPUS.z - z)

// What each crab does right now: { stance, spot? } by worker index (at most MAX_WORKERS). `checking` holds the ids of
// the crabs that are checking in with the octopus (they went idle or done a moment ago; berths.js keeps the clock).
//   facing   needs you: stand and face the camera side (+Z) with the octopus; a blocked crab still hops
//   roll     the octopus pointed at the pier: stop where it is (a crab checking in keeps its spot), turn to it
//   work     working: walk the lane in step with the octopus's beat
//   hop      blocked
//   gather   checking in: at the tip facing the octopus, for CHECK_IN seconds
//   busy     idle or done while the run is not finished, once checked in: potter along its lane at its own pace
//   stand    idle or done in a finished run: where it was, as before
export function crewStances(run, rolling = false, checking = null) {
  const ws = (Array.isArray(run && run.workers) ? run.workers : []).slice(0, MAX_WORKERS)
  const needs = !!run && run.needsYou === true && run.parked !== true
  const finished = !!run && run.phase === "finished"
  let rank = 0
  return ws.map(w => {
    const st = w && typeof w.state === "string" ? w.state : "idle"
    const resting = !finished && (st === "idle" || st === "done")
    const spot = resting && checking && checking.has(w && w.id) ? gatherSpot(rank++) : null
    if (needs) return { stance: "facing", hop: st === "blocked" }
    if (rolling) return spot ? { stance: "roll", spot } : { stance: "roll" }
    if (st === "working") return { stance: "work" }
    if (st === "blocked") return { stance: "hop" }
    if (spot) return { stance: "gather", spot }
    if (resting) return { stance: "busy" }
    return { stance: "stand" }
  })
}

// Whether a crab whose state went from `prev` to `next` checks in with the octopus: when it has just gone idle or done.
// A crab seen for the first time (`prev` undefined) checks in only when `fresh` (it joined a berth already on screen).
export function checksIn(prev, next, fresh = true) {
  const rest = s => s === "idle" || s === "done"
  if (!rest(next)) return false
  return prev === undefined ? fresh : !rest(prev)
}

// The slow beat while the orchestrator works: -1..1 with one cycle every BEAT seconds, shifted by the berth's own phase.
export const beat = (t, ph = 0) => Math.sin((TAU * t) / BEAT + ph)

// A working crab's walk: its offset along the lane and the way it faces, locked to the same beat, so it turns round
// exactly when the tentacle reaches the end of its stroke (the beat's extremes).
export function walk(t, ph, amp = 2) {
  const a = (TAU * t) / BEAT + ph
  return { oz: Math.sin(a) * amp, yaw: Math.cos(a) >= 0 ? 0 : Math.PI }
}

// One cheer hop: a crab's height at time t for a cheer that began at `at`, crab number `i` (80 ms apart), 0.4 s long, 0.35 m high.
export function cheer(t, at, i) {
  const k = (t - at - i * CHEER_STAGGER) / 0.4
  return k > 0 && k < 1 ? Math.sin(k * Math.PI) * 0.35 : 0
}

// The clap: how far the two tentacles are raised (0..1) and how close they are brought together (0..1) at t, for a clap that began at `at`.
// Up over 0.35 s, together in 0.15 s, down over 0.4 s.
export function clap(t, at) {
  const k = t - at
  if (k <= 0 || k >= CLAP) return { raise: 0, close: 0 }
  if (k < 0.35) return { raise: k / 0.35, close: 0 }
  if (k < 0.5) return { raise: 1, close: (k - 0.35) / 0.15 }
  return { raise: 1 - (k - 0.5) / 0.4, close: Math.max(0, 1 - (k - 0.5) / 0.2) }
}
