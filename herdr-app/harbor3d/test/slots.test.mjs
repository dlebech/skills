import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assignSlots, MAX_BERTHS, MAX_ADRIFT } from "../server/slots.js"
import * as L from "../public/assets/layout.js"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

test("assignSlots keeps ids where they are, frees the slots of ids that left, and fills the lowest free slot", () => {
  let m = assignSlots(new Map(), ["a", "b", "c"])
  assert.deepEqual([...m], [["a", 0], ["b", 1], ["c", 2]])
  m = assignSlots(m, ["c", "a", "d"])
  assert.equal(m.get("a"), 0); assert.equal(m.get("c"), 2)
  assert.equal(m.get("d"), 1, "d takes the slot b left")
  assert.equal(m.has("b"), false)
  m = assignSlots(m, ["e", "a", "c", "d"])
  assert.equal(m.get("e"), 3); assert.equal(m.get("d"), 1)
})

test("a parked run is simply left out of the ids: it frees its slot and takes the lowest free one when it returns", () => {
  let m = assignSlots(new Map(), ["a", "b", "c"])
  m = assignSlots(m, ["a", "c"])                // b parked
  assert.equal(m.has("b"), false); assert.equal(m.get("c"), 2)
  m = assignSlots(m, ["a", "c", "d"])           // d takes the free slot 1
  assert.equal(m.get("d"), 1)
  m = assignSlots(m, ["a", "b", "c", "d"])      // b is back: next free
  assert.equal(m.get("b"), 3)
})

test("more than 12 runs: the first 12 are drawn, the rest get no slot, and nobody moves", () => {
  const ids = Array.from({ length: 16 }, (_, i) => `r${i}`)
  const m = assignSlots(new Map(), ids)
  assert.equal(m.size, 12); assert.equal(new Set(m.values()).size, 12); assert.equal(m.has("r12"), false)
  const m2 = assignSlots(m, ids.filter(id => id !== "r3"))
  assert.equal(m2.get("r12"), m.get("r3"), "the first undrawn run takes the freed slot")
  for (const id of ids.slice(0, 12)) if (id !== "r3") assert.equal(m2.get(id), m.get(id))
})

test("the server's capacities equal the page's", () => {
  assert.equal(MAX_BERTHS, L.MAX_BERTHS); assert.equal(MAX_ADRIFT, L.MAX_ADRIFT)
})

test("every relative import in server/ and bin/ resolves to a file the source scan covers", () => {
  const scanned = new Set(["server", "bin"].flatMap(d => fs.readdirSync(path.join(root, d)).filter(f => f.endsWith(".js")).map(f => path.join(root, d, f))))
  for (const f of scanned) {
    const src = fs.readFileSync(f, "utf8")
    for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']*)["']/g)) {
      assert.ok(scanned.has(path.resolve(path.dirname(f), m[1])), `${path.relative(root, f)} imports ${m[1]}, which the source scan does not cover`)
    }
  }
})
