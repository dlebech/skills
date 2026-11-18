import test from "node:test"
import assert from "node:assert/strict"
import * as L from "../public/assets/layout.js"

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test("slot offsets run 0, +1, -1, +2, -2, ... and berths sit 22 m apart on the quay edge", () => {
  assert.equal(L.MAX_BERTHS, 12)
  assert.deepEqual(Array.from({ length: 12 }, (_, i) => L.slotOffset(i)), [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6])
  assert.deepEqual(L.berthPosition(0), { x: 0, y: 0, z: -10, offset: 0 })
  assert.equal(L.berthPosition(1).x, 22); assert.equal(L.berthPosition(2).x, -22); assert.equal(L.berthPosition(11).x, 132)
  for (const bad of [-1, 12, 1.5, "1", null, undefined, NaN]) { assert.equal(L.slotOffset(bad), null); assert.equal(L.berthPosition(bad), null) }
})

test("assignSlots keeps ids where they are, frees the slots of ids that left, and fills the lowest free slot", () => {
  let m = L.assignSlots(new Map(), ["a", "b", "c"])
  assert.deepEqual([...m], [["a", 0], ["b", 1], ["c", 2]])
  m = L.assignSlots(m, ["c", "a", "d"])
  assert.equal(m.get("a"), 0); assert.equal(m.get("c"), 2)
  assert.equal(m.get("d"), 1, "d takes the slot b left")
  assert.equal(m.has("b"), false)
  m = L.assignSlots(m, ["e", "a", "c", "d"])
  assert.equal(m.get("e"), 3); assert.equal(m.get("d"), 1)
})

test("a parked run is simply left out of the ids: it frees its slot and takes the lowest free one when it returns", () => {
  let m = L.assignSlots(new Map(), ["a", "b", "c"])
  m = L.assignSlots(m, ["a", "c"])                // b parked
  assert.equal(m.has("b"), false); assert.equal(m.get("c"), 2)
  m = L.assignSlots(m, ["a", "c", "d"])           // d takes the free slot 1
  assert.equal(m.get("d"), 1)
  m = L.assignSlots(m, ["a", "b", "c", "d"])      // b is back: next free
  assert.equal(m.get("b"), 3)
})

test("more than 12 runs: the first 12 are drawn, the rest get no slot, and nobody moves", () => {
  const ids = Array.from({ length: 16 }, (_, i) => `r${i}`)
  const m = L.assignSlots(new Map(), ids)
  assert.equal(m.size, 12); assert.equal(new Set(m.values()).size, 12); assert.equal(m.has("r12"), false)
  const m2 = L.assignSlots(m, ids.filter(id => id !== "r3"))
  assert.equal(m2.get("r12"), m.get("r3"), "the first undrawn run takes the freed slot")
  for (const id of ids.slice(0, 12)) if (id !== "r3") assert.equal(m2.get(id), m.get(id))
})

test("offset range, breakwater width, quay segments and floodlights follow the slots in use", () => {
  assert.deepEqual(L.offsetRange([]), { lo: 0, hi: 0 })
  assert.deepEqual(L.offsetRange([0, 1, 2]), { lo: -1, hi: 1 })
  assert.equal(L.breakwaterWidth([0]), 36)           // (0 + 1) * 22 + 14
  assert.equal(L.breakwaterWidth([0, 1, 2]), 58)
  assert.equal(L.breakwaterWidth([11]), 168)
  assert.equal(L.breakwaterWidth([]), 36)
  assert.deepEqual(L.quaySegments([0]), [-22, 0, 22], "one at each end")
  assert.deepEqual(L.quaySegments([0, 1, 2]), [-44, -22, 0, 22, 44])
  assert.deepEqual(L.floodlightPositions([0, 1]).map(p => p.x), [-11, 11, 33], "between slots and beyond each end")
  for (const p of L.floodlightPositions([0, 1])) { assert.equal(p.z, -12); assert.equal(p.y, 1.2) }
  assert.equal(L.floodlightPositions([0, 1, 2]).length, 4)
})

test("fixed local positions from the design", () => {
  assert.deepEqual(L.pierPosition(), { x: -6, y: 0, z: 0 })
  assert.deepEqual(L.shipPosition(), { x: -1.35, y: 0, z: 13 })
  assert.deepEqual(L.shipPosition(true), { x: -1.35, y: 0, z: 46 })
  // the hull's west side stays 0.15 m off the pier's east edge (x = -4) at every size
  for (const sc of [0.8, 1, 1.2, 1.4]) close(L.shipPosition(false, sc).x - 2.5 * sc, -3.85)
  assert.deepEqual(L.cranePosition(), { x: -6, y: 1.2, z: 14 })
  assert.deepEqual(L.signalPosition(), { x: -6, y: 1.2, z: 25 })
  const o = L.octopusPosition(); assert.deepEqual([o.x, o.y, o.z], [-6, -1.4, 30]); assert.equal(o.angle, 0)
})

test("yard: 4 across at x -3, -0.4, 2.2, 4.8, 2 high, then a second row behind; 24 at most, all behind the quay edge", () => {
  assert.deepEqual([0, 1, 2, 3].map(i => L.yardPosition(i).x), [-3, -0.4, 2.2, 4.8])
  assert.deepEqual([0, 3, 4, 7].map(i => Math.round(L.yardPosition(i).y * 100) / 100), [1.2, 1.2, 2.35, 2.35])
  assert.equal(L.yardPosition(7).z, -5); assert.equal(L.yardPosition(8).z, -7.6); assert.equal(L.yardPosition(8).y, 1.2)
  assert.equal(L.yardPosition(23).z, -10.2)
  assert.equal(L.yardPosition(24), null); assert.equal(L.yardPosition(-1), null)
  for (let i = 0; i < 24; i++) { const p = L.yardPosition(i); assert.ok(p.z <= -5 && p.z >= -10.2) }
  const seen = new Set(Array.from({ length: 24 }, (_, i) => JSON.stringify(L.yardPosition(i)))); assert.equal(seen.size, 24)
})

test("in progress: one row on the pier's west side (z 4, 6.8, 9.6, then past the crane), a second tier after 6; 12 at most", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => L.progressPosition(i).z), [4, 6.8, 9.6, 17.4, 20.2, 23])
  for (let i = 0; i < 6; i++) assert.ok(Math.abs(L.progressPosition(i).z - 14) > 2.7, "clear of the crane legs")
  for (let i = 0; i < 6; i++) { assert.equal(L.progressPosition(i).x, -7.2); assert.equal(L.progressPosition(i).y, 1.2) }
  assert.equal(L.progressPosition(6).z, 4); close(L.progressPosition(6).y, 2.35)
  assert.equal(L.progressPosition(12), null)
})

test("deck: 3 across, 4 rows stern to bow, tier 1 first then tier 2 at +1.15; 24 at most", () => {
  assert.deepEqual([0, 1, 2].map(i => L.deckPosition(i).x), [-1.3, 0, 1.3])
  assert.deepEqual([0, 3, 6, 9].map(i => L.deckPosition(i).z), [-3.5, -0.9, 1.7, 4.3])
  assert.equal(L.deckPosition(0).y, 1.6); assert.equal(L.deckPosition(11).y, 1.6)
  close(L.deckPosition(12).y, 2.75); assert.equal(L.deckPosition(12).z, -3.5)
  assert.equal(L.deckPosition(23).z, 4.3); assert.equal(L.deckPosition(24), null)
  assert.equal(new Set(Array.from({ length: 24 }, (_, i) => JSON.stringify(L.deckPosition(i)))).size, 24)
  // in the berth's frame: scaled with the ship, on its position
  const p = L.deckToBerth(L.deckPosition(0), L.shipPosition(false, 1.2), 1.2)
  close(p.x, L.shipPosition(false, 1.2).x - 1.3 * 1.2); close(p.y, 1.6 * 1.2); close(p.z, 13 - 3.5 * 1.2)
})

test("containerSlots: each stage goes to its zone, counted in task order, over the caps gets none", () => {
  const s = L.containerSlots(["planned", "implement", "done", "blocked", "planned", "review", "fix", "done"])
  assert.deepEqual(s.map(x => x.zone), ["yard", "pier", "deck", "pier", "yard", "pier", "pier", "deck"])
  assert.deepEqual(s.map(x => x.index), [0, 0, 0, 1, 1, 2, 3, 1])
  assert.equal(s[0].x, -3); assert.equal(s[4].x, -0.4); assert.equal(s[3].z, 6.8); assert.equal(s[7].x, 0)
  const many = L.containerSlots([...Array(26).fill("planned"), ...Array(14).fill("fix"), ...Array(26).fill("done")])
  assert.equal(many.filter(x => x.zone === "yard").length, 24); assert.equal(many.filter(x => x.zone === "pier").length, 12); assert.equal(many.filter(x => x.zone === "deck").length, 24)
  assert.equal(many.filter(x => x.zone === "none").length, 2 + 2 + 2)
  assert.deepEqual(L.containerSlots([]), [])
})

test("crab lane: one lane at x -6 along the pier deck, 8 at most", () => {
  assert.deepEqual([0, 1, 7].map(i => L.crabLane(i).z), [1.5, 4.5, 22.5])
  for (let i = 0; i < 8; i++) { assert.equal(L.crabLane(i).x, -6); assert.equal(L.crabLane(i).y, 1.2) }
  assert.equal(L.crabLane(8), null); assert.equal(L.crabLane(-1), null)
  assert.equal(L.MAX_WORKERS, 8)
  assert.equal(new Set(Array.from({ length: 8 }, (_, i) => L.crabLane(i).z)).size, 8)
})

test("flags stack down from y 7.6 on the mast, 0.7 m apart, 4 at most", () => {
  for (const [i, y] of [[0, 7.6], [1, 6.9], [3, 5.5]]) close(L.flagPosition(i).y, y)
  assert.equal(L.flagPosition(4), null)
})

test("parked ships anchor at z 78, 20 m apart and centred, bow to the east", () => {
  assert.equal(L.roadsteadPosition(0, 1).x, 0); assert.equal(L.roadsteadPosition(0, 1).z, 78)
  assert.deepEqual([0, 1, 2].map(i => L.roadsteadPosition(i, 3).x), [-20, 0, 20])
  assert.deepEqual([0, 1].map(i => L.roadsteadPosition(i, 2).x), [-10, 10])
  close(L.roadsteadPosition(0, 1).angle, Math.PI / 2)
  assert.equal(L.roadsteadPosition(1, 1), null); assert.equal(L.roadsteadPosition(12, 13), null)
  assert.equal(L.hazePosition(0).y, 3)
})

test("breakwater: rocks along z 56 from x ±14 out to ±W on both arms, the same every time; markers red west, green east", () => {
  const r = L.rockPositions(58), again = L.rockPositions(58)
  assert.deepEqual(r, again)
  assert.ok(r.some(p => p.x < 0) && r.some(p => p.x > 0))
  for (const p of r) { assert.ok(Math.abs(p.z - 56) < 1); assert.ok(Math.abs(p.x) > 13 && Math.abs(p.x) < 59); assert.ok(p.scale > 0.8 && p.scale < 1.3) }
  assert.ok(Math.max(...r.map(p => Math.abs(p.x))) > 55)
  assert.ok(L.rockPositions(168).length > L.rockPositions(36).length)
  assert.deepEqual(L.markerPositions().map(m => [m.x, m.color]), [[-14, "red"], [14, "green"]])
  const b = L.buoyPositions(); assert.equal(b.length, 4); assert.equal(b.filter(x => x.color === "red").length, 2)
})

test("adrift rafts: z 50, 5.5 m apart from the middle, inside the narrowest breakwater; 12 at most", () => {
  assert.deepEqual([0, 1, 2].map(i => L.adriftPosition(i).x), [0, 5.5, -5.5])
  for (let i = 0; i < 12; i++) { const p = L.adriftPosition(i); assert.equal(p.z, 50); assert.ok(Math.abs(p.x) < 36) }
  assert.equal(L.adriftPosition(12), null); assert.equal(L.adriftPosition(-1), null)
})

test("tug: moored alongside the quay, or on an ellipse (centre (0, 34), radii W * 0.6 and 10) that closes after one lap", () => {
  assert.deepEqual(L.TUG_MOORED, { x: 10, y: 0, z: -7.5, angle: Math.PI / 2 })
  const W = 58, a = L.tugPosition(0, 90, W), b = L.tugPosition(90, 90, W), c = L.tugPosition(22.5, 90, W)
  close(a.x, 34.8); close(a.z, 34); close(b.x, a.x); close(b.z, a.z); close(c.x, 0); close(c.z, 44)
  for (let t = 0; t < 90; t += 7) { const p = L.tugPosition(t, 90, W); close(((p.x / (W * 0.6)) ** 2) + (((p.z - 34) / 10) ** 2), 1) }
  // at angle 0 it heads towards +z (south, the model's front); a quarter lap later towards -x
  close(a.angle, 0); close(c.angle, -Math.PI / 2)
})

test("decor behind the quay: office, warehouses, silos, and the yard clutter in fixed spots", () => {
  assert.deepEqual(L.OFFICE, { x: 0, y: 1.2, z: -34 })
  assert.deepEqual(L.WAREHOUSES.map(w => w.x), [-26, 26]); assert.equal(L.SILO.x, -48)
  assert.deepEqual(L.clutterStacks(), L.clutterStacks())
  for (const s of L.clutterStacks()) assert.ok(s.z <= -22 && s.z >= -24)
})

test("the crew is drawn bigger than life: octopus 3.2, crabs 2.6; the octopus floats off the pier's tip, head above the water, facing the sea", () => {
  assert.equal(L.OCTOPUS_SCALE, 3.2); assert.equal(L.CRAB_SCALE, 2.6)
  const o = L.octopusPosition()
  assert.ok(o.z > 26, "beyond the pier's tip (z 26)"); assert.equal(o.x, -6)
  // the octopus model's eyes are about 0.9 m above its origin
  assert.ok(o.y + 0.9 * L.OCTOPUS_SCALE > 0.5); assert.ok(o.y < 0)
})

test("label declutter: sorted by x, a label that would cover another is raised by its height, up to 3 levels, with an anchor", () => {
  const box = (id, x, y, a = 1) => ({ id, x, y, w: 100, h: 30, a })
  const apart = L.declutterLabels([box("a", 0, 100), box("b", 200, 100)])
  assert.deepEqual(apart.map(l => [l.y, l.raised]), [[100, 0], [100, 0]])
  const two = L.declutterLabels([box("b", 40, 100), box("a", 0, 100)])
  assert.deepEqual(two.map(l => l.id), ["a", "b"], "sorted by x")
  assert.deepEqual(two.map(l => [l.y, l.raised, l.anchorY]), [[100, 0, 100], [70, 1, 100]])
  const four = L.declutterLabels([0, 1, 2, 3, 4].map(i => box("n" + i, i * 10, 100)))
  assert.deepEqual(four.map(l => l.raised), [0, 1, 2, 3, 3], "at most 3 levels")
  const hidden = L.declutterLabels([box("a", 0, 100), box("h", 0, 100, 0), box("c", 0, 100)])
  assert.deepEqual(hidden.map(l => [l.id, l.raised]), [["a", 0], ["h", 0], ["c", 1]], "hidden labels neither move nor block")
  const touch = L.declutterLabels([box("a", 0, 100), box("b", 100, 100)])
  assert.equal(touch[1].raised, 0, "boxes that only touch do not collide")
  assert.deepEqual(L.declutterLabels([]), [])
})

test("a label is under the card when its box, not just its centre, touches the card's rectangle", () => {
  const card = { left: 1000, right: 1300, top: 10, bottom: 600 }
  const l = (x, y) => ({ x, y, w: 160, h: 32 })
  assert.equal(L.labelUnderCard(l(500, 300), card), false)
  assert.equal(L.labelUnderCard(l(1000, 300), card), true, "centre on the card")
  assert.equal(L.labelUnderCard(l(930, 300), card), true, "centre left of the card, box reaches in (930 + 80 > 1000)")
  assert.equal(L.labelUnderCard(l(900, 300), card), false, "box ends at 980, more than 8 px clear")
  assert.equal(L.labelUnderCard(l(1370, 300), card), true, "box reaches in from the right")
  assert.equal(L.labelUnderCard(l(1000, 0), card), false, "above the card: the box (y - h .. y) ends at 0, more than 8 px above the card")
  assert.equal(L.labelUnderCard(l(1000, 638), card), true, "box top 606 is inside the 8 px margin below the card")
  assert.equal(L.labelUnderCard(l(1000, 300), null), false, "no card")
})

// ---- containers never touch ----
const SHIPS = { S: 0.8, M: 1, L: 1.2, XL: 1.4 }
// Every pair of boxes must be apart by 4 cm sideways (x or z) or 2 cm up (y); returns the first offending pair.
function touching(boxes) {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    const apart = [0, 1, 2].map(k => Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k]))
    if (apart[0] < 0.04 && apart[2] < 0.04 && apart[1] < 0.02) return [a, b]
  }
  return null
}
const shuffled = (n, seed) => { const a = Array.from({ length: n }, (_, i) => i); let s = seed; for (let i = n - 1; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]] } return a }

test("containerBoxes: for every ship size and 1 to 40 done tasks no two containers touch", () => {
  for (const [size, scale] of Object.entries(SHIPS)) for (let n = 1; n <= 40; n++) {
    const boxes = L.containerBoxes(Array(n).fill("done"), { scale })
    assert.equal(boxes.length, Math.min(n, 24), `${size} ${n}`)
    assert.equal(touching(boxes), null, `${size} ${n} done`)
  }
})

test("containerBoxes: tasks that become done in any order take distinct slots and never touch, at every size", () => {
  for (const [size, scale] of Object.entries(SHIPS)) for (const seed of [3, 17, 99, 1234]) for (const n of [5, 12, 13, 24, 30, 40]) {
    const order = shuffled(n, seed)
    let stages = Array(n).fill("planned"), slots = null
    for (const t of order) {
      stages = stages.map((s, i) => (i === t ? "done" : s))
      slots = L.deckAssign(slots, stages)
      const used = slots.filter(s => s !== null)
      assert.equal(new Set(used).size, used.length, "a slot is used twice")
      assert.equal(used.length, Math.min(stages.filter(s => s === "done").length, 24))
      // tier 2 never has a gap under it
      for (const s of used) if (s >= 12) assert.ok(used.includes(s - 12), "a floating container")
      assert.equal(touching(L.containerBoxes(stages, { scale, deckSlots: slots })), null, `${size} ${n} seed ${seed}`)
    }
  }
})

test("deckAssign: a done task keeps its slot when others finish, a freed slot is reused, over 24 gets null", () => {
  let s = L.deckAssign(null, ["planned", "done", "planned", "done"]); assert.deepEqual(s, [null, 0, null, 1])
  s = L.deckAssign(s, ["done", "done", "planned", "done"]); assert.deepEqual(s, [2, 0, null, 1], "the first two keep 0 and 1")
  s = L.deckAssign(s, ["planned", "done", "done", "done"]); assert.deepEqual(s, [null, 0, 2, 1], "task 0's slot is freed, task 2 takes the lowest free one")
  const full = L.deckAssign(null, Array(26).fill("done")); assert.equal(full.filter(x => x === null).length, 2)
  assert.equal(L.deckOverflow(Array(26).fill("done")), 2); assert.equal(L.deckOverflow(Array(24).fill("done")), 0)
})

test("containerBoxes: the yard and the pier rows do not touch either, in every task mix", () => {
  const mixes = []
  for (let n = 1; n <= 40; n++) { mixes.push(Array(n).fill("planned")); mixes.push(Array(n).fill("implement")); mixes.push(Array.from({ length: n }, (_, i) => ["planned", "fix", "done", "blocked", "review"][i % 5])) }
  for (const m of mixes) for (const castOff of [false, true]) for (const slot of [0, 1, 2]) {
    const boxes = L.containerBoxes(m, { scale: 1.2, castOff, slot })
    assert.equal(touching(boxes), null, m.join(","))
    for (const b of boxes) if (b.zone === "pier") assert.ok(b.min[0] >= L.berthPosition(slot).x + L.PIER.x - 2 && b.max[0] <= L.berthPosition(slot).x + L.PIER.x + 2, "on the pier")
  }
})

test("containerBoxes: the pier row stays on the pier and the yard behind the quay edge", () => {
  const b = L.containerBoxes([...Array(12).fill("implement"), ...Array(24).fill("planned")], { slot: 0 })
  for (const x of b.filter(y => y.zone === "pier")) { assert.ok(x.min[2] >= -10 && x.max[2] <= -10 + 26, "within the pier's length") }
  for (const x of b.filter(y => y.zone === "yard")) assert.ok(x.max[2] <= -10 - 3.7 && x.min[2] >= -10 - 14, "on the quay")
})
