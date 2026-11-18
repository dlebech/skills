import test from "node:test"
import assert from "node:assert/strict"
import * as C from "../public/assets/crew.js"
import * as G from "../public/assets/life.js"

const run = (over = {}) => ({ phase: "running", needsYou: false, parked: false, tasks: ["implement", "planned"], prs: [], orchestrator: { id: "o", state: "working" },
  workers: [{ id: "a", state: "working" }, { id: "b", state: "idle" }], ...over })

test("crewEvents: a worker joining or leaving, or a task changing stage, is a roll call; nothing else is", () => {
  const a = run()
  assert.deepEqual(C.crewEvents(null, a), { rollCall: false, done: [], castOff: false }, "first sight")
  assert.equal(C.crewEvents(a, run()).rollCall, false)
  assert.equal(C.crewEvents(a, run({ workers: [...a.workers, { id: "c", state: "idle" }] })).rollCall, true)
  assert.equal(C.crewEvents(a, run({ workers: [a.workers[0]] })).rollCall, true)
  assert.equal(C.crewEvents(a, run({ tasks: ["review", "planned"] })).rollCall, true)
  assert.equal(C.crewEvents(a, run({ workers: [{ id: "a", state: "idle" }, { id: "b", state: "working" }] })).rollCall, false, "a worker's own state is not a roll call")
  assert.equal(C.crewEvents(a, run({ workers: [{ id: "b", state: "idle" }, { id: "a", state: "working" }] })).rollCall, false, "the order of workers is not")
})

test("crewEvents: a task becoming done is a cheer, a ship that casts off is a wave-off", () => {
  const a = run({ tasks: ["implement", "done", "review"] })
  assert.deepEqual(C.crewEvents(a, run({ tasks: ["done", "done", "review"] })).done, [0])
  assert.deepEqual(C.crewEvents(a, run({ tasks: ["done", "done", "done"] })).done, [0, 2])
  assert.deepEqual(C.crewEvents(a, run({ tasks: ["implement", "done", "review", "done"] })).done, [], "a new task that is already done is not a cheer")
  assert.deepEqual(C.crewEvents(a, run({ tasks: ["implement", "review", "review"] })).done, [])
  const open = run({ prs: [{ state: "open" }] }), merged = run({ prs: [{ state: "merged" }] })
  assert.equal(C.crewEvents(open, merged).castOff, true); assert.equal(C.crewEvents(merged, merged).castOff, false)
  assert.equal(C.crewEvents(open, run({ prs: [] })).castOff, false); assert.equal(C.crewEvents(merged, open).castOff, false)
  for (const odd of [undefined, {}, { tasks: "x", workers: 3, prs: null }]) assert.doesNotThrow(() => C.crewEvents(odd, odd))
})

test("crewStances: working walks, blocked hops, idle and done check in and then potter while the run goes on, and stand when it is finished", () => {
  const r = run({ workers: [{ id: "a", state: "working" }, { id: "b", state: "blocked" }, { id: "c", state: "idle" }, { id: "d", state: "done" }, { id: "e", state: "idle" }] })
  assert.deepEqual(C.crewStances(r).map(s => s.stance), ["work", "hop", "busy", "busy", "busy"], "nobody checking in: everyone at work")
  const checking = new Set(["c", "e", "a"])
  assert.deepEqual(C.crewStances(r, false, checking).map(s => s.stance), ["work", "hop", "gather", "busy", "gather"], "a working crab never checks in")
  assert.deepEqual(C.crewStances(r, false, checking).filter(s => s.spot).map(s => s.spot), [0, 1].map(C.gatherSpot), "the crabs checking in take spots 0, 1 in order")
  assert.deepEqual(C.crewStances({ ...r, phase: "finished" }, false, checking).map(s => s.stance), ["work", "hop", "stand", "stand", "stand"])
  const rolled = C.crewStances(r, true, checking)
  assert.deepEqual(rolled.map(s => s.stance), Array(5).fill("roll"))
  assert.deepEqual(rolled.map(s => s.spot ?? null), [null, null, C.gatherSpot(0), null, C.gatherSpot(1)], "a roll call keeps a crab checking in at its spot")
  assert.deepEqual(C.crewStances(null), []); assert.deepEqual(C.crewStances({ workers: "x" }), [])
})

test("checksIn: a crab checks in when it has just gone idle or done, and a new one only on a berth already on screen", () => {
  assert.equal(C.checksIn("working", "idle"), true); assert.equal(C.checksIn("working", "done"), true); assert.equal(C.checksIn("blocked", "done"), true)
  assert.equal(C.checksIn("idle", "done"), false, "already resting"); assert.equal(C.checksIn("idle", "idle"), false)
  assert.equal(C.checksIn("idle", "working"), false); assert.equal(C.checksIn(undefined, "working"), false)
  assert.equal(C.checksIn(undefined, "idle", true), true); assert.equal(C.checksIn(undefined, "idle", false), false, "first sight of the berth")
})

test("crewStances: needs you stops everyone facing +Z; a blocked crab still hops; a parked run needs nobody", () => {
  const r = run({ needsYou: true, workers: [{ id: "a", state: "working" }, { id: "b", state: "blocked" }, { id: "c", state: "idle" }] })
  assert.deepEqual(C.crewStances(r).map(s => s.stance), ["facing", "facing", "facing"])
  assert.deepEqual(C.crewStances(r).map(s => !!s.hop), [false, true, false])
  assert.deepEqual(C.crewStances(r, true).map(s => s.stance), ["facing", "facing", "facing"], "needs you beats a roll call")
  assert.equal(C.crewStances({ ...r, parked: true })[0].stance, "work")
})

test("gather spots are at the pier's tip, distinct, on the pier and in front of the crane; crabs face the octopus", () => {
  const spots = Array.from({ length: 8 }, (_, i) => C.gatherSpot(i))
  assert.equal(new Set(spots.map(s => `${s.x},${s.z}`)).size, 8)
  for (const s of spots) { assert.ok(s.x >= -8 && s.x <= -4); assert.ok(s.z > 17 && s.z <= 24) }
  assert.ok(spots[0].z > spots[7].z, "the first one is nearest the tip")
  assert.ok(Math.abs(C.faceOctopus(-6, 23)) < 1e-9, "straight ahead from the pier's centre"); assert.ok(C.faceOctopus(-7, 20) > 0); assert.ok(C.faceOctopus(-5, 20) < 0)
})

test("the beat and the walk share one clock: a crab turns round exactly at the extremes of the beat, every 1.2 s", () => {
  const ph = 0.7
  for (let k = 0; k < 6; k++) {
    // the beat's extremes (|beat| = 1) are where the walk's offset is also at its end and its heading has just flipped
    const t = ((Math.PI / 2 - ph) / (2 * Math.PI)) * C.BEAT + (k * C.BEAT) / 2
    assert.ok(Math.abs(Math.abs(C.beat(t, ph)) - 1) < 1e-9, "beat at an extreme")
    assert.ok(Math.abs(Math.abs(C.walk(t, ph, 2).oz) - 2) < 1e-9, "walk at the end of the lane")
    assert.notEqual(C.walk(t - 0.05, ph).yaw === C.walk(t + 0.05, ph).yaw, true, "heading flips there")
  }
  assert.equal(C.BEAT, 2.4)
})

test("cheer and clap: one hop per crab, 80 ms apart; the clap lifts, closes, and is gone after 0.9 s", () => {
  assert.equal(C.cheer(9.9, 10, 0), 0); assert.ok(C.cheer(10.2, 10, 0) > 0.3); assert.equal(C.cheer(10.6, 10, 0), 0)
  assert.equal(C.cheer(10.07, 10, 1), 0, "crab 1 starts at 80 ms"); assert.ok(C.cheer(10.28, 10, 1) > 0.3)
  assert.ok(Math.abs(C.cheer(10.2, 10, 0) - C.cheer(10.28, 10, 1)) < 1e-9, "the same hop, 80 ms later")
  assert.deepEqual(C.clap(5, 10), { raise: 0, close: 0 }); assert.deepEqual(C.clap(11, 10), { raise: 0, close: 0 })
  assert.ok(Math.abs(C.clap(10.36, 10).raise - 1) < 0.05); assert.ok(C.clap(10.499, 10).close > 0.99); assert.ok(C.clap(10.7, 10).raise < 1)
})

test("blockedWorker: the first blocked crab, or -1", () => {
  assert.equal(C.blockedWorker(run()), -1)
  assert.equal(C.blockedWorker(run({ workers: [{ id: "a", state: "idle" }, { id: "b", state: "blocked" }, { id: "c", state: "blocked" }] })), 1)
  assert.equal(C.blockedWorker(null), -1)
})

// ---- life ----
test("blinking: every 3 to 6 s, shut for 0.2 s", () => {
  assert.equal(G.nextBlink(10, 0), 13); assert.equal(G.nextBlink(10, 1), 16); assert.equal(G.nextBlink(10, 5), 16); assert.equal(G.nextBlink(10, -1), 13)
  assert.equal(G.lidClosed(9, 10), 0); assert.ok(G.lidClosed(10.1, 10) > 0.99); assert.ok(G.lidClosed(10.2, 10) < 0.01); assert.equal(G.lidClosed(11, 10), 0)
})

test("the head follows the camera within 50° of its rest heading", () => {
  assert.equal(G.headTarget(0, 10), 0)
  assert.ok(Math.abs(G.headTarget(10, 10) - Math.PI / 4) < 1e-9)
  assert.equal(G.headTarget(100, 1), G.HEAD_LIMIT); assert.equal(G.headTarget(-100, 1), -G.HEAD_LIMIT); assert.equal(G.headTarget(0, -10), G.HEAD_LIMIT === 0 ? 0 : G.headTarget(0, -10))
  assert.ok(Math.abs(G.headTarget(0, -10)) <= G.HEAD_LIMIT)
  assert.ok(Math.abs(G.HEAD_LIMIT - (50 * Math.PI) / 180) < 1e-12)
  assert.equal(G.headTarget(0, -10, 2.2), 2.2, "a wider limit for looking at a blocked crab behind")
  for (const bad of [[NaN, 1], [0, 0], [Infinity, 1]]) assert.equal(G.headTarget(...bad), 0)
})

test("a fish jumps every 20 to 40 s in an arc that starts and ends at the water", () => {
  assert.equal(G.nextFish(0, 0), 20); assert.equal(G.nextFish(0, 1), 40)
  assert.equal(G.fishArc(0).y, 0); assert.equal(G.fishArc(1).y, 0); assert.ok(Math.abs(G.fishArc(0.5).y - G.FISH.height) < 1e-9)
  assert.ok(G.fishArc(0.1).pitch > 0 && G.fishArc(0.9).pitch < 0, "up then down"); assert.equal(G.fishArc(1).along, G.FISH.reach)
  assert.ok(G.splash(0.5).opacity > 0 && G.splash(1.2).opacity === 0 && G.splash(-1).scale === 0)
})

test("gulls: circle 20-40 s, land, perch 10-20 s, leave", () => {
  assert.deepEqual(G.gullCycle(0, 0), [20, 10]); assert.deepEqual(G.gullCycle(1, 1), [40, 20])
  const c = G.gullCycle(0.5, 0.5)
  assert.equal(G.gullState(0, c).s, "circle"); assert.equal(G.gullState(c[0] + 1, c).s, "land"); assert.equal(G.gullState(c[0] + 3, c).s, "perch")
  assert.equal(G.gullState(c[0] + 2.5 + c[1] + 1, c).s, "leave"); assert.equal(G.gullState(c[0] + 5 + c[1] + 0.1, c).s, "done")
})

test("lights flicker on one by one within a second and then stay on", () => {
  assert.equal(G.flickerOn(0, 0.3), 0); assert.equal(G.flickerOn(-1, 0.3), 0); assert.equal(G.flickerOn(1, 0.3), 1); assert.equal(G.flickerOn(5, 0.3), 1)
  const seq = Array.from({ length: 40 }, (_, i) => G.flickerOn((i + 1) / 41, 0.37))
  assert.ok(seq.includes(0) && seq.includes(1), "it flickers"); assert.equal(seq[39], 1)
  assert.deepEqual([0, 1, 2, 3].map(i => G.lightDelay(i, 4)), [0, 0.2, 0.4, 0.6].map(x => +x.toFixed(10)).map((x, i) => G.lightDelay(i, 4)))
  assert.ok(G.lightDelay(0, 4) < G.lightDelay(3, 4) && G.lightDelay(3, 4) <= 0.6); assert.equal(G.lightDelay(0, 1), 0)
})
