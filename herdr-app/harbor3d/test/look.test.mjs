import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
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

test("workers: scuttle ±0.5 m in 0.9 s, hop 0.25 m, done is still and tilted 12°, idle opens the claws", () => {
  assert.deepEqual(K.workerLook("working"), { motion: "scuttle", amp: 0.5, period: 0.9, tilt: 0 })
  assert.equal(K.workerLook("blocked").motion, "hop"); assert.equal(K.workerLook("blocked").amp, 0.25)
  assert.equal(K.workerLook("done").motion, "still"); assert.equal(K.workerLook("done").tilt, 12)
  assert.equal(K.workerLook("idle").motion, "claws")
  assert.equal(K.workerLook("???").motion, "claws"); assert.equal(K.workerLook(undefined).motion, "claws")
})

test("buoys: a colour per task state; implement, review, fix and blocked bob faster; unknown is planned", () => {
  const want = { planned: "#c9cfd4", implement: "#f2c94c", review: "#3f8fd2", fix: "#f08a5d", done: "#3fa66b", blocked: "#d4553e" }
  for (const [k, c] of Object.entries(want)) assert.equal(K.buoyLook(k).color, c)
  assert.deepEqual(Object.keys(want).filter(k => K.buoyLook(k).fast), ["implement", "review", "fix", "blocked"])
  assert.equal(K.buoyLook("nope").color, "#c9cfd4"); assert.equal(K.buoyLook("nope").fast, false)
  assert.equal(K.buoyLook("__proto__").color, "#c9cfd4"); assert.equal(K.buoyLook(null).color, "#c9cfd4")
})

test("flags: colour by PR state, red checks make it red, running checks wave twice as fast", () => {
  const want = { open: "#3f8fd2", draft: "#9aa1a8", merged: "#8256d0", closed: "#5d6770", unknown: "#9aa1a8" }
  for (const [k, c] of Object.entries(want)) assert.deepEqual(K.flagLook({ state: k, checks: "green" }), { color: c, speed: 1 })
  assert.equal(K.flagLook({ state: "merged", checks: "red" }).color, "#d4553e")
  assert.equal(K.flagLook({ state: "open", checks: "running" }).speed, 2)
  assert.equal(K.flagLook({ state: "weird" }).color, "#9aa1a8"); assert.equal(K.flagLook(null).speed, 1)
})

test("reef: flare for needsYou, fog and 55% for parked (no flare, no motion), lanterns when finished, crane only with a PR", () => {
  assert.equal(K.reefLook(run({ needsYou: true })).flare, true)
  const p = K.reefLook(run({ parked: true, needsYou: true, ciRunning: true, orchestrator: { state: "working" } }))
  assert.equal(p.fog, true); assert.equal(p.opacity, 0.55); assert.equal(p.flare, false); assert.equal(p.craneSpin, false)
  assert.equal(p.orchestrator.bob, null); assert.equal(p.orchestrator.sway, false); assert.equal(p.orchestrator.wave, false)
  assert.equal(K.reefLook(run({ phase: "finished" })).lanterns, true)
  assert.equal(K.reefLook(run({ phase: "running" })).lanterns, false)
  const noPr = K.reefLook(run({ ciRunning: true })); assert.equal(noPr.crane, false); assert.equal(noPr.hasPr, false)
  const pr = K.reefLook(run({ ciRunning: true, prs: [{ state: "open", checks: "running" }] })); assert.equal(pr.crane, true); assert.equal(pr.craneSpin, true)
  assert.equal(K.reefLook(run({ prs: Array(7).fill({ state: "open", checks: "none" }) })).flags, 4)
  assert.equal(K.reefLook(run({ ciRunning: false, prs: [{ state: "open" }] })).craneSpin, false)
})
test("palm scale by size: S 0.7, M 1.0, L 1.3, XL 1.6, unknown 1.0", () => {
  assert.deepEqual(["S", "M", "L", "XL", "XXL", undefined].map(K.sizeScale), [0.7, 1, 1.3, 1.6, 1, 1])
})

test("captain: none 40% with sail down, watching and working anchor 2 m (working rocks more), idle anchor up", () => {
  const n = K.captainLook("none"); assert.equal(n.opacity, 0.4); assert.equal(n.sail, false)
  assert.equal(K.captainLook("watching").anchor, 2); assert.equal(K.captainLook("working").anchor, 2)
  assert.ok(K.captainLook("working").rock > K.captainLook("watching").rock)
  const i = K.captainLook("idle"); assert.equal(i.anchor, 0); assert.equal(i.sail, true); assert.equal(i.opacity, 1)
  assert.deepEqual(K.captainLook("zzz"), n)
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
  const m = K.cardModel(run({ workers: Array.from({ length: 20 }, () => ({ id: "x", state: "weird", kind: "weird" })), tasks: Array(18).fill("done"), prs: Array(6).fill({ state: "weird", checks: "weird" }), type: "zzz", size: "Q" }))
  assert.deepEqual(m.notes, ["4 more workers are not drawn", "2 more tasks are not drawn", "2 more PRs are not drawn"])
  assert.equal(m.workers[0], "Crab 1 · agent · idle"); assert.equal(m.prs[0], "PR · unknown · checks none"); assert.equal(m.type, "Run"); assert.equal(m.size, "M")
  assert.doesNotThrow(() => K.cardModel(null))
})

test("beam: one turn takes 12 s with no target, and holds 1.5 s on each target", () => {
  const run = (targets, secs, dt = 0.05) => { let s = { theta: 0, hold: 0, last: null }; const log = []; for (let t = 0; t < secs; t += dt) { s = K.stepBeam(s, targets, dt); log.push(s) } return log }
  const free = run([], 12)
  assert.ok(Math.abs(free.at(-1).theta - 0) < 0.03 || Math.abs(free.at(-1).theta - Math.PI * 2) < 0.03)
  assert.ok(free.every(s => s.hold === 0))
  const log = run([1, 3], 15.5)
  assert.equal(log.filter(s => s.hold > 0 && s.theta === 1).length > 25, true)
  const holds = [1, 3].map(a => log.filter(s => s.hold > 0 && s.theta === a).length * 0.05)
  for (const h of holds) assert.ok(Math.abs(h - 1.5) < 0.12, `${h}`)
  // after resting on a target it moves on instead of stopping again at once
  const i = log.findIndex(s => s.theta === 1 && s.hold === 0.0 && log[log.indexOf(s) - 1]?.hold > 0)
  assert.ok(log[i + 5].theta > 1)
  // a full turn with two targets takes 12 + 3 s
  const firstAt = log.findIndex(s => s.theta === 1 && s.hold > 0), again = log.findIndex((s, j) => j > firstAt + 40 && s.theta === 1 && s.hold > 0)
  assert.ok(again < 0 || Math.abs((again - firstAt) * 0.05 - 15) < 0.3)
  assert.doesNotThrow(() => K.stepBeam({ theta: 0, hold: 0, last: null }, [NaN, -1, 99], 0.05))
})
