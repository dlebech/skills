import test from "node:test"
import assert from "node:assert/strict"
import { fixture, SECRET } from "./helpers.mjs"
import { sanitize } from "../server/sanitize.js"
import * as K from "../public/assets/look.js"

const facts = fixture("facts-basic.json")
const scene = mode => sanitize(facts, { mode, secret: SECRET, now: facts.at, viewers: 2 })
const run = (over = {}) => ({ id: "r1", label: "X", type: "feat", phase: "running", parked: false, needsYou: false, need: null, path: [], tasks: [], prs: [], ciRunning: false, orchestrator: { id: "a1", state: "idle", kind: "claude" }, workers: [], size: "M", ageMinutes: 0, ...over })
const orch = (state, over) => K.orchestratorLook(run({ orchestrator: { state }, ...over }))

test("orchestrator: working bobs 0.15 m at 1.5 s and sways; idle bobs at 3.2 s", () => {
  const w = orch("working")
  assert.deepEqual(w.bob, { amp: 0.15, period: 1.5 }); assert.equal(w.sway, true); assert.equal(w.eyelids, 0); assert.equal(w.opacity, 1)
  const i = orch("idle")
  assert.equal(i.bob.period, 3.2); assert.equal(i.sway, false); assert.equal(i.wave, false)
})
test("orchestrator: blocked or needsYou waves Tentacle.0 and leans", () => {
  for (const o of [orch("blocked"), orch("idle", { needsYou: true }), orch("working", { needsYou: true })]) { assert.equal(o.wave, true); assert.equal(o.lean, true); assert.equal(o.eyelids, 0) }
})
test("orchestrator: done closes the eyelids with no bob; gone is 40% with closed eyelids", () => {
  const d = orch("done"); assert.equal(d.eyelids, 1); assert.equal(d.bob, null); assert.equal(d.opacity, 1)
  const g = orch("gone", { needsYou: true }); assert.equal(g.eyelids, 1); assert.equal(g.opacity, 0.4); assert.equal(g.wave, false)
})
test("orchestrator: unknown or missing state is a quiet idle, never a throw", () => {
  for (const r of [run({ orchestrator: { state: "dancing" } }), run({ orchestrator: null }), {}, null, undefined]) {
    const o = K.orchestratorLook(r); assert.equal(o.bob.period, 3.2); assert.equal(o.opacity, 1)
  }
})

test("workers: working walks 2 m along the lane in 2.4 s, hop 0.25 m, done is still and tilted 12°, idle opens the claws", () => {
  assert.deepEqual(K.workerLook("working"), { motion: "walk", amp: 2, period: 2.4, tilt: 0 })
  assert.equal(K.workerLook("blocked").motion, "hop"); assert.equal(K.workerLook("blocked").amp, 0.25)
  assert.equal(K.workerLook("done").motion, "still"); assert.equal(K.workerLook("done").tilt, 12)
  assert.equal(K.workerLook("idle").motion, "claws")
  assert.equal(K.workerLook("???").motion, "claws"); assert.equal(K.workerLook(undefined).motion, "claws")
})

test("containers: a colour per stage, blocked tilted 8°, done in the five cargo colours by task index, unknown is planned", () => {
  const want = { planned: "#9aa7b1", implement: "#f2c94c", review: "#3f8fd2", fix: "#f08a5d", blocked: "#d4553e" }
  for (const [k, c] of Object.entries(want)) assert.equal(K.containerLook(k, 3).color, c)
  assert.ok(Math.abs(K.containerLook("blocked").tilt - (8 * Math.PI) / 180) < 1e-12)
  for (const k of ["planned", "implement", "review", "fix", "done"]) assert.equal(K.containerLook(k).tilt, 0)
  const cargo = ["#3f8f8a", "#b5653a", "#2f4f6f", "#d9b44a", "#8a5a9c"]
  assert.deepEqual([0, 1, 2, 3, 4, 5, 11].map(i => K.containerLook("done", i).color), [...cargo, cargo[0], cargo[1]])
  for (const bad of ["nope", "__proto__", "toString", null, undefined, 3]) assert.equal(K.containerLook(bad).color, "#9aa7b1")
  assert.equal(K.containerLook("done", -2).color, cargo[0]); assert.equal(K.containerLook("done", NaN).color, cargo[0])
})

test("container plan: zones by stage, colours, done colour from the task's own index, cast off hides the pier row", () => {
  const tasks = ["planned", "implement", "done", "blocked", "done", "review", "weird"]
  const p = K.containerPlan(tasks)
  assert.deepEqual(p.map(x => x.zone), ["yard", "pier", "deck", "pier", "deck", "pier", "yard"])
  assert.deepEqual(p.map(x => x.color), ["#9aa7b1", "#f2c94c", "#2f4f6f", "#d4553e", "#8a5a9c", "#3f8fd2", "#9aa7b1"])
  assert.equal(p[3].tilt > 0, true); assert.equal(p[1].tilt, 0)
  assert.deepEqual(p.filter(x => x.zone === "deck").map(x => x.index), [0, 1])
  const c = K.containerPlan(tasks, true)
  assert.deepEqual(c.map(x => x.zone), ["yard", "none", "deck", "none", "deck", "none", "yard"])
  assert.deepEqual(K.containerPlan(null), []); assert.deepEqual(K.containerPlan(undefined), [])
  assert.equal(K.containerPlan(Array(30).fill("done")).filter(x => x.zone === "none").length, 6, "deck takes 24")
})

test("flags: colour by PR state, red checks make it red, running checks wave twice as fast", () => {
  const want = { open: "#3f8fd2", draft: "#9aa1a8", merged: "#8256d0", closed: "#5d6770", unknown: "#9aa1a8" }
  for (const [k, c] of Object.entries(want)) assert.deepEqual(K.flagLook({ state: k, checks: "green" }), { color: c, speed: 1 })
  assert.equal(K.flagLook({ state: "merged", checks: "red" }).color, "#d4553e")
  assert.equal(K.flagLook({ state: "open", checks: "running" }).speed, 2)
  assert.equal(K.flagLook({ state: "weird" }).color, "#9aa1a8"); assert.equal(K.flagLook(null).speed, 1)
})

test("signal: red for needsYou, green while anything works or CI runs, dark when parked or finished, amber otherwise", () => {
  assert.deepEqual(K.signalLook(run({ needsYou: true })), { lamp: "red" })
  assert.deepEqual(K.signalLook(run({ needsYou: true, orchestrator: { state: "working" } })), { lamp: "red" }, "red beats green")
  assert.deepEqual(K.signalLook(run({ orchestrator: { state: "working" } })), { lamp: "green" })
  assert.equal(K.signalLook(run({ workers: [{ state: "idle" }, { state: "working" }] })).lamp, "green")
  assert.equal(K.signalLook(run({ ciRunning: true })).lamp, "green")
  assert.equal(K.signalLook(run()).lamp, "amber"); assert.equal(K.signalLook(run({ workers: [{ state: "blocked" }, { state: "done" }] })).lamp, "amber")
  assert.equal(K.signalLook(run({ parked: true, needsYou: true, ciRunning: true })).lamp, "dark")
  const done = [{ key: "build", state: "done" }, { key: "merge", state: "done" }]
  assert.equal(K.signalLook(run({ phase: "finished", path: done })).lamp, "dark")
  assert.equal(K.signalLook(run({ phase: "finished", path: [...done, { key: "human", state: "you" }] })).lamp, "amber", "finished but the path is not all done")
  assert.equal(K.signalLook(run({ phase: "finished", path: [] })).lamp, "amber")
  assert.equal(K.signalLook(run({ phase: "running", path: done })).lamp, "amber")
  assert.equal(K.signalLook(run({ phase: "finished", path: done, ciRunning: true })).lamp, "green", "something still runs")
  for (const bad of [null, undefined, {}, run({ workers: [null] }), run({ path: "x" })]) assert.doesNotThrow(() => K.signalLook(bad))
})

test("ship state: anchored when parked, castoff when it has PRs and all are merged, berthed otherwise", () => {
  const m = { state: "merged" }, o = { state: "open" }
  assert.equal(K.shipState(run({ parked: true, prs: [m] })), "anchored")
  assert.equal(K.shipState(run({ prs: [m, m] })), "castoff")
  assert.equal(K.shipState(run({ prs: [m, o] })), "berthed")
  assert.equal(K.shipState(run({ prs: [] })), "berthed")
  assert.equal(K.shipState(run({ prs: [{ state: "closed" }] })), "berthed")
  assert.equal(K.shipState(null), "berthed")
})

test("berth look: lights when finished, smoke with CI, crane busy needs an active task and a working worker, scale by size, flags at most 4", () => {
  const busy = run({ tasks: ["implement"], workers: [{ state: "working" }] })
  assert.equal(K.berthLook(busy).craneBusy, true)
  assert.equal(K.berthLook(run({ tasks: ["implement"], workers: [{ state: "idle" }] })).craneBusy, false)
  assert.equal(K.berthLook(run({ tasks: ["planned", "done", "blocked"], workers: [{ state: "working" }] })).craneBusy, false)
  for (const t of ["review", "fix"]) assert.equal(K.berthLook(run({ tasks: [t], workers: [{ state: "working" }] })).craneBusy, true)
  assert.equal(K.berthLook({ ...busy, prs: [{ state: "merged" }] }).craneBusy, false, "a cast-off ship's crane rests")
  assert.equal(K.berthLook(run({ phase: "finished" })).lights, true); assert.equal(K.berthLook(run({ phase: "running" })).lights, false)
  assert.equal(K.berthLook(run({ ciRunning: true })).smoke, true); assert.equal(K.berthLook(run({ ciRunning: false })).smoke, false)
  assert.equal(K.berthLook(run({ ciRunning: true, parked: true })).smoke, false)
  assert.equal(K.berthLook(run({ prs: Array(7).fill({ state: "open" }) })).flags, 4); assert.equal(K.berthLook(run()).flags, 0)
  const p = K.berthLook(run({ parked: true, orchestrator: { state: "working" }, needsYou: true }))
  assert.equal(p.state, "anchored"); assert.equal(p.parked, true); assert.equal(p.orchestrator.bob, null); assert.equal(p.orchestrator.wave, false)
  assert.equal(K.berthLook(run({ prs: [{ state: "merged" }] })).castOff, true)
  assert.equal(K.berthLook(run({ needsYou: true })).beacon, true); assert.equal(K.berthLook(run()).beacon, false)
  assert.equal(K.berthLook(run({ needsYou: true, parked: true })).beacon, false, "no beacon on a parked ship")
  assert.doesNotThrow(() => K.berthLook(null))
})
test("ship scale by size: S 0.8, M 1.0, L 1.2, XL 1.4, unknown 1.0", () => {
  assert.deepEqual(["S", "M", "L", "XL", "XXL", undefined].map(K.sizeScale), [0.8, 1, 1.2, 1.4, 1, 1])
  assert.equal(K.berthLook(run({ size: "XL" })).scale, 1.4)
})

test("tug: none is moored and 40% opaque, idle moored, watching patrols in 90 s, working in 45 s", () => {
  assert.deepEqual(K.captainLook("none"), { opacity: 0.4, patrol: false, period: 90 })
  assert.deepEqual(K.captainLook("idle"), { opacity: 1, patrol: false, period: 90 })
  assert.deepEqual(K.captainLook("watching"), { opacity: 1, patrol: true, period: 90 })
  assert.deepEqual(K.captainLook("working"), { opacity: 1, patrol: true, period: 45 })
  assert.deepEqual(K.captainLook("zzz"), K.captainLook("none")); assert.deepEqual(K.captainLook(undefined), K.captainLook("none"))
})
test("gulls: one per viewer, at most 20", () => {
  assert.deepEqual([0, 3, 20, 99, -4, NaN, undefined].map(K.gullCount), [0, 3, 20, 20, 0, 0, 0])
})

test("sky follows the hour: dawn 6, day 8 to 17, dusk 19, night 21; modes force day or night", () => {
  assert.equal(K.skyLook(12).night, 0); assert.equal(K.skyLook(8).night, 0); assert.equal(K.skyLook(17).night, 0)
  assert.equal(K.skyLook(23).night, 1); assert.ok(K.skyLook(2).night > 0.5); assert.equal(K.skyLook(21).night, 1)
  assert.ok(K.skyLook(6).night > 0 && K.skyLook(19).night > 0)
  assert.ok(K.skyLook(12).sunIntensity > K.skyLook(6).sunIntensity && K.skyLook(6).sunIntensity > K.skyLook(23).sunIntensity)
  assert.equal(K.skyLook(3, "day").night, 0); assert.equal(K.skyLook(12, "night").night, 1)
  assert.equal(K.skyLook(NaN).night, 0)
  for (const h of [0, 5.9, 7, 18, 20, 24, 30]) { const s = K.skyLook(h); assert.match(s.sky, /^#[0-9a-f]{6}$/); assert.ok(Math.abs(Math.hypot(...s.sunDir) - 1) < 1e-9); assert.ok(s.sunDir[1] > 0) }
})
test("a stale scene is greyer and dimmer", () => {
  const a = K.skyLook(12), b = K.skyLook(12, "auto", true)
  assert.ok(b.sunIntensity < a.sunIntensity && b.hemiIntensity < a.hemiIntensity)
  const sat = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return Math.max(...c) - Math.min(...c) }
  assert.ok(sat(b.sky) < sat(a.sky))
})

test("label line: every phase, needs table, and unknown values", () => {
  const needs = { question: "has a question", gone: "orchestrator gone", stalled: "stalled", "red-ci": "CI is red", "request-review": "request review", "changes-requested": "changes requested", merge: "ready to merge", "review-proof": "review the proof", finished: "read and close", other: "needs a look" }
  for (const [k, t] of Object.entries(needs)) assert.equal(K.labelLine(run({ needsYou: true, need: k })), `Needs you · ${t}`)
  assert.equal(K.labelLine(run({ needsYou: true, need: "bogus" })), "Needs you · needs a look")
  assert.equal(K.labelLine(run({ needsYou: true, need: null })), "Needs you · needs a look")
  assert.equal(K.labelLine(run({ parked: true })), "Parked")
  assert.equal(K.labelLine(run({ phase: "finished" })), "Finished")
  assert.equal(K.labelLine(run({ phase: "planning" })), "Planning")
  assert.equal(K.labelLine(run({ tasks: ["done", "done", "implement", "review", "planned"] })), "Building 2/5")
  assert.equal(K.labelLine(run({ tasks: [] })), "Building")
  assert.equal(K.labelLine(run({ phase: "mystery" })), "Underway")
  assert.equal(K.labelLine(null), "Underway")
})

test("path row: fixed labels and marks, todo dim, unknown keys dropped", () => {
  const row = K.pathRow([{ key: "build", state: "done" }, { key: "proven", state: "done" }, { key: "review", state: "look" }, { key: "human", state: "you" }, { key: "merge", state: "todo" }])
  assert.equal(K.pathText([{ key: "build", state: "done" }, { key: "proven", state: "done" }, { key: "review", state: "look" }, { key: "human", state: "you" }, { key: "merge", state: "todo" }]), "Build ✓ › Proven ✓ › AI review ⚠ › Review ● › Merge")
  assert.deepEqual(row.map(r => r.dim), [false, false, false, false, true])
  assert.equal(K.pathText([{ key: "spec", state: "fail" }, { key: "x", state: "done" }, { key: "build", state: "current" }, { key: "merge", state: "??" }]), "Spec ✗ › Build › Merge")
  assert.equal(K.pathRow([{ key: "build", state: "current" }])[0].current, true)
  assert.deepEqual(K.pathRow(null), [])
})

test("age text", () => {
  assert.deepEqual([0, 45, 60, 190, 1500, 1440, NaN].map(K.ageText), ["just started", "45 min", "1 h", "3 h 10 min", "1 d 1 h", "1 d", "just started"])
})

test("basic fixture, private mode: labels, lines, path row, card", () => {
  const s = scene("private"), [a, b, c] = s.runs
  assert.equal(K.labelLine(a), "Building 1/5")
  assert.equal(K.labelLine(b), "Needs you · request review")
  assert.equal(K.labelLine(c), "Parked")
  assert.equal(K.pathText(a.path), "Spec ✓ › Build › Proven › AI review › Review › Merge")
  assert.equal(K.pathText(b.path), "Spec ✓ › Build ✓ › Proven ✓ › AI review ● › Review › Merge")
  const m = K.cardModel(a)
  assert.equal(m.title, "#1371 · Ruter steder"); assert.equal(m.sub, "snevagten"); assert.equal(m.type, "Feature")
  assert.equal(m.tasks, "1 planned · 2 implement · 1 review · 1 done")
  assert.deepEqual(m.prs, ["#1397 · draft · checks running"])
  assert.deepEqual(m.workers, ["impl-1371-t2 · claude · working", "impl-1371-t3 · pi · working"])
  assert.equal(m.age, "2 h 46 min"); assert.equal(m.size, "L"); assert.deepEqual(m.notes, [])
})
test("basic fixture, shared mode: no sub, PRs without a label, workers are Crab n", () => {
  const s = scene("shared"), a = s.runs[0], m = K.cardModel(a)
  assert.equal(m.sub, ""); assert.equal(m.title, a.label); assert.match(m.title, /^[A-Z][a-z]+ [A-Z][a-z]+/)
  assert.deepEqual(m.prs, ["PR · draft · checks running"])
  assert.deepEqual(m.workers, ["Crab 1 · claude · working", "Crab 2 · pi · working"])
  assert.equal(K.labelLine(a), "Building 1/5")
  assert.equal(m.age, "2 h 45 min")
})
test("card: caps are announced, odd values get safe words", () => {
  const m = K.cardModel(run({ workers: Array.from({ length: 12 }, () => ({ id: "x", state: "weird", kind: "weird" })), tasks: Array(26).fill("done"), prs: Array(6).fill({ state: "weird", checks: "weird" }), type: "zzz", size: "Q" }))
  assert.deepEqual(m.notes, ["4 more workers are not drawn", "2 more tasks are not drawn", "2 more PRs are not drawn"])
  assert.equal(m.workers[0], "Crab 1 · agent · idle"); assert.equal(m.prs[0], "PR · unknown · checks none"); assert.equal(m.type, "Run"); assert.equal(m.size, "M")
  assert.doesNotThrow(() => K.cardModel(null))
})
