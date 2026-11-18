import test from "node:test"
import assert from "node:assert/strict"
import { sanitize } from "../server/sanitize.js"
import { SEA_NAMES, seaName, hmacId } from "../server/names.js"
import { fixture, SECRET } from "./helpers.mjs"

const base = { secret: SECRET, now: 1795000000000 }
const priv = (f, o = {}) => sanitize(f, { ...base, mode: "private", ...o })
const shared = (f, o = {}) => sanitize(f, { ...base, mode: "shared", ...o })
const run = (over = {}) => ({ key: "k1", name: "N", repo: "R", ...over })

test("shared scene of the leak fixture contains no LEAK_ marker", () => {
  const s = JSON.stringify(shared(fixture("facts-leak.json")))
  assert.ok(!s.includes("LEAK_"), s.match(/LEAK_\d+/)?.[0])
})

test("private scene of the leak fixture only holds name, repo, worker and adrift name markers", () => {
  const f = fixture("facts-leak.json")
  const allowed = new Set()
  for (const r of f.runs) { allowed.add(r.name); allowed.add(r.repo); for (const w of r.workers) allowed.add(w.name) }
  for (const a of f.adrift) allowed.add(a.name)
  const found = JSON.stringify(priv(f)).match(/LEAK_\d+/g) || []
  assert.ok(found.length >= 8)
  for (const m of found) assert.ok(allowed.has(m), `${m} leaked in private mode`)
  // every allowed marker really does show up (the fixture exercised the fields)
  for (const m of allowed) assert.ok(found.includes(m), `${m} missing`)
})

test("shared mode has no sub, no pr labels, no worker or adrift labels (keys absent)", () => {
  const s = shared(fixture("facts-basic.json"))
  for (const r of s.runs) {
    assert.ok(!("sub" in r))
    for (const p of r.prs) assert.ok(!("label" in p))
    for (const w of r.workers) assert.ok(!("label" in w))
    assert.ok(SEA_NAMES.some(n => r.label.startsWith(n)))
  }
  for (const a of s.adrift) assert.ok(!("label" in a))
  assert.equal(s.mode, "shared")
})

test("private mode carries the real labels", () => {
  const s = priv(fixture("facts-basic.json"))
  assert.equal(s.runs[0].label, "#1371 · Ruter steder")
  assert.equal(s.runs[0].sub, "snevagten")
  assert.equal(s.runs[0].prs[0].label, "#1397")
  assert.equal(s.runs[0].workers[0].label, "impl-1371-t2")
  assert.equal(s.adrift[0].label, "skills · Claude Code")
})

test("ids are keyed hashes: same in both modes, never the real key, different with another secret", () => {
  const f = fixture("facts-basic.json")
  const a = priv(f), b = shared(f), c = priv(f, { secret: Buffer.from("other") })
  assert.deepEqual(a.runs.map(r => r.id), b.runs.map(r => r.id))
  assert.deepEqual(a.runs[0].workers.map(w => w.id), b.runs[0].workers.map(w => w.id))
  assert.notEqual(a.runs[0].id, c.runs[0].id)
  assert.match(a.runs[0].id, /^r[0-9a-f]{4}$/)
  assert.match(a.adrift[0].id, /^a[0-9a-f]{4}$/)
  const s = JSON.stringify(a)
  assert.ok(!s.includes("t69c") && !s.includes("t68w") && !s.includes("/home/u"))
  assert.equal(hmacId(SECRET, "r", "x"), hmacId(SECRET, "r", "x"))
})

test("sea names: stable per key, collisions get II and III", () => {
  const used = new Set()
  const keys = []
  // find three keys that map to the same sea name
  const first = seaName(SECRET, "seed", new Set())
  for (let i = 0; keys.length < 3 && i < 5000; i++) if (seaName(SECRET, `k${i}`, new Set()) === first) keys.push(`k${i}`)
  const names = keys.map(k => seaName(SECRET, k, used))
  assert.deepEqual(names, [first, `${first} II`, `${first} III`])
  const s = shared({ runs: keys.map(key => ({ key })) })
  assert.deepEqual(s.runs.map(r => r.label), names)
})

test("size buckets, age (rounded to 5 in shared mode)", () => {
  const at = base.now
  const f = { runs: [9e6, 49e6, 149e6, 150e6].map((tokens, i) => run({ key: `s${i}`, tokens, startedMs: at - 188 * 60000 })) }
  assert.deepEqual(priv(f).runs.map(r => r.size), ["S", "M", "L", "XL"])
  assert.equal(priv(f).runs[0].ageMinutes, 188)
  assert.equal(shared(f).runs[0].ageMinutes, 190)
})

test("every enum falls back to its safe default", () => {
  const f = {
    captain: { state: "bogus" },
    runs: [run({ type: "x", phase: "x", need: "x", path: [{ key: "build", state: "x" }, { key: "x", state: "done" }], tasks: ["x", "done"],
      prs: [{ state: "x", checks: "x", number: 5 }], orchestrator: { state: "x", kind: "x" }, workers: [{ id: "w", state: "x", kind: "x", task: 0 }] })],
    adrift: [{ id: "a", state: "x", kind: "x" }],
  }
  const s = priv(f), r = s.runs[0]
  assert.equal(s.captain.state, "none")
  assert.equal(r.type, null)
  assert.equal(r.phase, "running")
  assert.equal(r.need, "other")
  assert.deepEqual(r.path, [{ key: "build", state: "todo" }])
  assert.deepEqual(r.tasks, ["planned", "done"])
  assert.deepEqual(r.prs, [{ state: "unknown", checks: "none", label: "#5" }])
  assert.deepEqual([r.orchestrator.state, r.orchestrator.kind], ["gone", "other"])
  assert.deepEqual([r.workers[0].state, r.workers[0].kind], ["idle", "other"])
  assert.deepEqual([s.adrift[0].state, s.adrift[0].kind], ["idle", "other"])
})

test("every enum keeps its valid values", () => {
  const f = fixture("facts-basic.json")
  const s = priv(f)
  assert.equal(s.captain.state, "watching")
  assert.deepEqual(s.runs.map(r => r.type), ["feat", "fix", "expl"])
  assert.deepEqual(s.runs.map(r => r.need), [null, "request-review", null])
  assert.deepEqual(s.runs[1].prs[0], { state: "open", checks: "green", label: "#1405" })
  assert.equal(s.runs[0].workers[1].kind, "pi")
  assert.equal(s.runs[0].workers[1].task, 2)
  assert.equal(s.runs[2].parked, true)
})

test("numbers that are not numbers, arrays that are objects, and junk facts", () => {
  assert.doesNotThrow(() => priv(null))
  assert.deepEqual(priv("x").runs, [])
  assert.deepEqual(priv({ runs: { 0: run() }, adrift: "no" }).runs, [])
  const s = priv({ at: "now", runs: [run({ tokens: "9", startedMs: "x", tasks: { a: 1 }, path: "no", prs: { a: 1 }, workers: { a: 1 }, orchestrator: [], parked: "true", needsYou: 1 }), 5, null, { key: 7 }],
    captain: [] })
  assert.equal(s.at, 0)
  const r = s.runs[0]
  assert.equal(s.runs.length, 1)
  assert.deepEqual([r.size, r.ageMinutes, r.tasks, r.path, r.prs, r.workers, r.orchestrator, r.parked, r.needsYou], ["S", 0, [], [], [], [], null, false, false])
  assert.equal(s.captain.state, "none")
  // worker task index outside the tasks list
  assert.equal(priv({ runs: [run({ tasks: ["done"], workers: [{ id: "w", task: 1 }, { id: "x", task: -1 }, { id: "y", task: 1.5 }] })] }).runs[0].workers.every(w => w.task === null), true)
})

test("labels: control characters stripped, cut to 60", () => {
  const s = priv({ runs: [run({ name: "a\u0000b\nc‮" + "x".repeat(100), repo: "r\u0007" })] })
  assert.ok(!/[\u0000-\u001f]/.test(s.runs[0].label))
  assert.equal([...s.runs[0].label].length, 60)
  assert.equal(s.runs[0].sub, "r")
})

test("stale and viewers pass through; the scene never holds __proto__ junk", () => {
  const s = shared(JSON.parse('{"runs":[{"key":"k","__proto__":{"x":1},"name":"n"}]}'), { stale: true, viewers: 3 })
  assert.equal(s.stale, true)
  assert.equal(s.viewers, 3)
  assert.deepEqual(Object.keys(s.runs[0]).sort(), ["ageMinutes", "ciRunning", "id", "label", "need", "needsYou", "orchestrator", "parked", "path", "phase", "prs", "size", "tasks", "type", "workers"])
})
