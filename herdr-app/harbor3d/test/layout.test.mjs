import test from "node:test"
import assert from "node:assert/strict"
import * as L from "../public/assets/layout.js"

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)
const radius = p => Math.hypot(p.x, p.z)

test("30 slots on three rings at radius 18, 31 and 44", () => {
  assert.equal(L.MAX_SLOTS, 30)
  const rings = [0, 0, 0]
  for (let i = 0; i < 30; i++) { const p = L.slotPosition(i); rings[p.ring]++; close(radius(p), [18, 31, 44][p.ring]) }
  assert.deepEqual(rings, [6, 10, 14])
  assert.equal(L.slotPosition(30), null)
  assert.equal(L.slotPosition(-1), null)
})

test("slots are evenly spaced and each ring is offset by half a slot", () => {
  const ang = i => Math.atan2(L.slotPosition(i).z, L.slotPosition(i).x)
  const gap = (a, b) => ((b - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
  close(gap(ang(0), ang(1)), (2 * Math.PI) / 6)
  close(gap(ang(6), ang(7)), (2 * Math.PI) / 10)
  close(gap(ang(16), ang(17)), (2 * Math.PI) / 14)
  close(gap(ang(0), ang(6)), Math.PI / 10)
  close(gap(ang(6), ang(16)), Math.PI / 14)
})

test("a reef's +Z points at the lighthouse", () => {
  for (const i of [0, 3, 8, 20, 29]) {
    const s = L.slotPosition(i), w = L.toWorld(s, { x: 0, y: 0, z: 1 })
    assert.ok(radius(w) < radius(s))
    close(radius(w), radius(s) - 1, 1e-9)
  }
})

test("assignSlots keeps ids where they are, frees the slots of ids that left, and fills the lowest free slot", () => {
  let m = L.assignSlots(new Map(), ["a", "b", "c"])
  assert.deepEqual([...m], [["a", 0], ["b", 1], ["c", 2]])
  m = L.assignSlots(m, ["c", "a", "d"])
  assert.equal(m.get("a"), 0)
  assert.equal(m.get("c"), 2)
  assert.equal(m.get("d"), 1, "d takes the slot b left")
  assert.equal(m.has("b"), false)
  m = L.assignSlots(m, ["e", "a", "c", "d"])
  assert.equal(m.get("e"), 3)
  assert.equal(m.get("d"), 1)
})

test("more than 30 runs: the first 30 are drawn, the rest get no slot, and nobody moves", () => {
  const ids = Array.from({ length: 34 }, (_, i) => `r${i}`)
  const m = L.assignSlots(new Map(), ids)
  assert.equal(m.size, 30)
  assert.equal(new Set(m.values()).size, 30)
  assert.equal(m.has("r30"), false)
  const m2 = L.assignSlots(m, ids.filter(id => id !== "r3"))
  assert.equal(m2.get("r30"), m.get("r3"), "the first undrawn run takes the freed slot")
  for (const id of ids.slice(0, 30)) if (id !== "r3") assert.equal(m2.get(id), m.get(id))
})

test("worker positions: 8 on radius 2.1, 8 more on radius 3.0, none after 16", () => {
  for (let i = 0; i < 8; i++) close(Math.hypot(L.workerPosition(i).x, L.workerPosition(i).z), 2.1)
  for (let i = 8; i < 16; i++) close(Math.hypot(L.workerPosition(i).x, L.workerPosition(i).z), 3.0)
  assert.equal(L.workerPosition(16), null)
  assert.equal(L.workerPosition(0).y, 0.6)
  const seen = new Set(Array.from({ length: 16 }, (_, i) => L.workerPosition(i)).map(p => `${p.x.toFixed(3)},${p.z.toFixed(3)}`))
  assert.equal(seen.size, 16)
})

test("the dock starts at z 3.6 and runs 4 m; buoys are 0.9 m apart beyond its end, at most 16", () => {
  close(L.dockPosition().z - 2, 3.6)
  close(L.cranePosition().z, 7.0)
  const row = Array.from({ length: 5 }, (_, i) => L.buoyPosition(i, 5))
  for (let i = 1; i < 5; i++) close(row[i].x - row[i - 1].x, 0.9)
  assert.ok(row.every(p => p.z > 7.6))
  close(row[0].x, -row[4].x)
  assert.equal(L.buoyPosition(0, 1).x, 0)
  assert.ok(L.buoyPosition(15, 20))
  assert.equal(L.buoyPosition(16, 20), null)
  assert.equal(L.buoyPosition(0, 0), null)
})

test("flag, pole, palm and adrift positions", () => {
  assert.deepEqual([L.POLE.x, L.POLE.y, L.POLE.z], [-2.6, 0.6, -1.5])
  assert.deepEqual([L.PALM.x, L.PALM.y, L.PALM.z], [2.4, 0.6, -2.0])
  close(L.flagPosition(0).y - L.flagPosition(1).y, 0.7)
  close(L.flagPosition(2).y - L.flagPosition(3).y, 0.7)
  assert.equal(L.flagPosition(4), null)
  for (let i = 0; i < 12; i++) close(radius(L.adriftPosition(i)), 10)
  assert.equal(L.adriftPosition(12), null)
  assert.deepEqual([L.BOAT.x, L.BOAT.z], [6, 6])
})
