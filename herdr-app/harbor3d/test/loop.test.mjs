import test from "node:test"
import assert from "node:assert/strict"
import { createLoop } from "../public/assets/loop.js"

// A fake requestAnimationFrame: callbacks wait in a map until the test runs a frame.
function fakeRaf() {
  const q = new Map(); let id = 0
  return { raf: cb => { q.set(++id, cb); return id }, caf: h => q.delete(h), pending: () => q.size, frame(t = 0) { const cbs = [...q.values()]; q.clear(); cbs.forEach(cb => cb(t)) } }
}

test("start queues one frame, and every frame queues the next before it runs", () => {
  const f = fakeRaf(); let ran = 0
  const loop = createLoop(f.raf, f.caf, () => { ran++; assert.equal(f.pending(), 1, "next frame already queued") })
  assert.equal(f.pending(), 0); loop.start(); loop.start(); loop.start()
  assert.equal(f.pending(), 1, "start twice is still one")
  f.frame(); f.frame(); f.frame()
  assert.equal(ran, 3); assert.equal(f.pending(), 1)
})

test("hide then show leaves exactly one pending callback, however many times it happens", () => {
  const f = fakeRaf(); let ran = 0
  const loop = createLoop(f.raf, f.caf, () => ran++)
  loop.start(); f.frame()
  for (let i = 0; i < 50; i++) { loop.stop(); assert.equal(f.pending(), 0); assert.equal(loop.running(), false); loop.start(); assert.equal(f.pending(), 1) }
  const before = ran; f.frame()
  assert.equal(ran - before, 1, "one callback per display frame after 50 cycles")
  assert.equal(f.pending(), 1)
})

test("stop when nothing is queued, and an error in the frame function, do not break the loop", () => {
  const f = fakeRaf(); let n = 0
  const loop = createLoop(f.raf, f.caf, () => { if (++n === 1) throw new Error("boom") })
  loop.stop(); loop.start()
  assert.throws(() => f.frame(), /boom/)
  assert.equal(f.pending(), 1, "the next frame was queued before the error"); f.frame(); assert.equal(n, 2)
})
