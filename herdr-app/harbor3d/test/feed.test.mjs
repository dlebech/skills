import test from "node:test"
import assert from "node:assert/strict"
import { createFeed } from "../public/assets/feed.js"

const tick = () => new Promise(r => setImmediate(r))
// A fake world: a stream we drive by hand, timers we fire by hand, and a poll function answered from a queue.
function world() {
  const w = { streams: [], timers: [], polls: [], scenes: [], pokes: [], states: [], closed: 0 }
  w.openEvents = h => { const s = { h, close() { w.closed++ } }; w.streams.push(s); return s }
  w.setTimer = (fn, ms) => { const t = { fn, ms, off: false }; w.timers.push(t); return () => { t.off = true } }
  w.poll = after => new Promise((ok, bad) => w.polls.push({ after, ok, bad }))
  w.fire = ms => { for (const t of w.timers.filter(t => !t.off && (ms === undefined || t.ms === ms))) { t.off = true; t.fn() } }
  w.feed = createFeed({ openEvents: w.openEvents, poll: w.poll, now: () => 0, setTimer: w.setTimer, onScene: s => w.scenes.push(s), onPoke: p => w.pokes.push(p), onState: (t, ok) => w.states.push([t, ok]) })
  return w
}

test("SSE works: a scene before 4 s means the stream is kept and nothing is ever polled", async () => {
  const w = world(); w.feed.start()
  w.streams[0].h.scene({ id: 1 }); w.streams[0].h.poke({ kind: "horn" })
  w.fire(4000); await tick()
  assert.deepEqual(w.scenes, [{ id: 1 }]); assert.deepEqual(w.pokes, [{ kind: "horn" }])
  assert.equal(w.polls.length, 0); assert.equal(w.feed.transport(), "sse"); assert.equal(w.closed, 0)
  assert.deepEqual(w.states.at(-1), ["sse", true])
})

test("no scene in 4 s: the stream is closed and polling starts; scenes apply and pokes play once, in order", async () => {
  const w = world(); w.feed.start()
  assert.equal(w.timers[0].ms, 4000)
  w.fire(4000); await tick()
  assert.equal(w.feed.transport(), "poll"); assert.equal(w.closed, 1)
  assert.equal(w.polls.length, 1); assert.equal(w.polls[0].after, 0)
  w.polls[0].ok({ n: 3, scene: { id: "a" }, pokes: [{ kind: "horn" }, { kind: "feed" }] }); await tick()
  assert.deepEqual(w.scenes, [{ id: "a" }]); assert.deepEqual(w.pokes.map(p => p.kind), ["horn", "feed"])
  assert.equal(w.polls.length, 2, "polls again at once"); assert.equal(w.polls[1].after, 3)
  w.polls[1].ok({ n: 4, pokes: [{ kind: "wave" }] }); await tick()
  assert.equal(w.scenes.length, 1, "no scene key, no scene"); assert.deepEqual(w.pokes.map(p => p.kind), ["horn", "feed", "wave"])
  assert.equal(w.polls[2].after, 4)
  w.polls[2].ok({ n: 4 }); await tick()
  assert.equal(w.pokes.length, 3); assert.equal(w.polls.length, 4)
  // a late event from the dead stream does nothing
  w.streams[0].h.error(true); await tick(); assert.equal(w.polls.length, 4)
})

test("a stream error before the first scene switches to polling at once", async () => {
  const w = world(); w.feed.start()
  w.streams[0].h.error(false); await tick()
  assert.equal(w.feed.transport(), "poll"); assert.equal(w.polls.length, 1); assert.equal(w.closed, 1)
  assert.equal(w.timers.filter(t => !t.off).length, 0, "the 4 s timer is cancelled")
})

test("a poll failure backs off 1 s, 2 s, 4 s … up to 15 s, and a success resets it", async () => {
  const w = world(); w.feed.start(); w.fire(4000); await tick()
  const waits = []
  for (let i = 0; i < 7; i++) {
    w.polls.at(-1).bad(new Error("x")); await tick()
    const t = w.timers.filter(t => !t.off).at(-1); waits.push(t.ms)
    assert.equal(w.polls.length, i + 1, "no poll during the pause")
    t.off = true; t.fn(); await tick()
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 15000, 15000, 15000])
  w.polls.at(-1).ok({ n: 1 }); await tick()
  w.polls.at(-1).bad(new Error("x")); await tick()
  assert.equal(w.timers.filter(t => !t.off).at(-1).ms, 1000)
})

test("a hidden tab stops polling after the poll in flight; showing it polls once", async () => {
  const w = world(); w.feed.start(); w.fire(4000); await tick()
  w.feed.setHidden(true)
  w.polls[0].ok({ n: 2, scene: { id: 1 } }); await tick()
  assert.equal(w.polls.length, 1, "no next poll while hidden"); assert.equal(w.scenes.length, 1)
  w.feed.setHidden(false); await tick()
  assert.equal(w.polls.length, 2); assert.equal(w.polls[1].after, 2)
  w.feed.setHidden(false); await tick(); assert.equal(w.polls.length, 2, "never two polls at once")
  w.feed.setHidden(true); w.feed.setHidden(false); await tick(); assert.equal(w.polls.length, 2, "still the one in flight")
})

test("SSE that was working and then closed is reopened after 5 s, then 10 s", async () => {
  const w = world(); w.feed.start(); w.streams[0].h.scene({ id: 1 })
  w.streams[0].h.error(true)
  assert.equal(w.timers.filter(t => !t.off).at(-1).ms, 5000); assert.deepEqual(w.states.at(-1), ["sse", false])
  w.fire(5000); assert.equal(w.streams.length, 2)
  w.streams[1].h.error(true)
  assert.equal(w.timers.filter(t => !t.off).at(-1).ms, 10000)
  assert.equal(w.polls.length, 0)
})
