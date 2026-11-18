// The Harbor 3D facts (sceneexport.js): enum mappings, which runs go out, the exact key sets, and when to write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneFacts, shouldWrite, needOf, phaseOf, prState, checksOf, kindOf } from "../../herdr-app/mods/harbormaster/sceneexport.js";

const term = (address, name, key = "claude", status = "working") => ({ address, name, status, program: { key, name: key } });
const run = (o = {}) => ({ key: ":/runs/a", branch: "issue-12", topic: "Fix it", repo: "snev", type: "feat", phase: "running", terminal: "t1",
  tasks: [{ id: "t1", name: "one", state: "merged" }, { id: "t2", name: "two", state: "implementing" }], tokens: { total: 5 }, started: 10, updated: 20, ...o });
const facts = (o = {}) => ({ orch: "working", parked: false, need: false, closed: false, att: { reasons: [] }, counts: { done: 1, planned: 2 },
  prs: [{ number: 7, state: "OPEN", checks: { pass: 2, fail: 0, pending: 0 } }], workers: [term("w1", "impl-t2")],
  stages: [{ stage: "done", agents: [] }, { stage: "implement", agents: [{ agent: term("w1", "impl-t2"), stage: "implement" }] }], ...o });
const path = [{ key: "build", label: "Build", value: "1/2", state: "current", tip: "x", fold: null }];
const extras = (o = {}) => ({ now: 99, captain: { terminal: null, watching: false }, adrift: [], agentState: (t) => t.status, ...o });
const row = (r = {}, f = {}) => ({ r: run(r), f: facts(f), path });
const keys = (o) => Object.keys(o).sort().join();

test("exact key sets of every object", () => {
  const out = sceneFacts([row()], extras({ adrift: [{ address: "a1", name: "x", program: { key: "pi" }, status: "idle", secret: 1 }] }));
  assert.equal(keys(out), "adrift,at,captain,runs,v");
  assert.equal(out.v, 1); assert.equal(out.at, 99);
  assert.equal(keys(out.captain), "state");
  const r = out.runs[0];
  assert.equal(keys(r), "ciRunning,key,name,need,needsYou,orchestrator,parked,path,phase,prs,repo,startedMs,tasks,tokens,type,updatedMs,workers");
  assert.equal(keys(r.path[0]), "key,state");
  assert.equal(keys(r.prs[0]), "checks,number,state");
  assert.equal(keys(r.orchestrator), "kind,state");
  assert.equal(keys(r.workers[0]), "id,kind,name,state,task");
  assert.equal(keys(out.adrift[0]), "id,kind,name,state");
  assert.equal(r.name, "#12 · Fix it");
});

test("phase", () => {
  assert.equal(phaseOf({ phase: "running" }, 0), "planning");
  assert.equal(phaseOf({ phase: "running" }, 3), "running");
  assert.equal(phaseOf({ phase: "finished" }, 0), "finished");
  assert.equal(phaseOf({ phase: "weird" }, 2), "running");
});

test("need from the first reason key", () => {
  const att = (key) => ({ reasons: [{ key }, { key: "stalled" }] });
  const want = { question: "question", gone: "gone", stalled: "stalled", "red-ci": "red-ci", "request review": "request-review", "changes requested": "changes-requested",
    "approved — merge": "merge", "review proof → merge": "review-proof", finished: "finished", "review-pending": "other", "idle-ask": "question", "something new": "other", constructor: "other", __proto__: "other" };
  for (const [k, v] of Object.entries(want)) assert.equal(needOf(true, att(k)), v, k);
  assert.equal(needOf(true, { reasons: [] }), "other");
  assert.equal(needOf(false, att("question")), null);
});

test("PR state, checks, program kind", () => {
  assert.deepEqual(["OPEN", "DRAFT", "MERGED", "CLOSED", "UNKNOWN", "x", undefined].map(prState), ["open", "draft", "merged", "closed", "unknown", "unknown", "unknown"]);
  assert.equal(checksOf({ checks: { pass: 3, fail: 1, pending: 1 } }), "red");
  assert.equal(checksOf({ checks: { pass: 3, fail: 0, pending: 1 } }), "running");
  assert.equal(checksOf({ checks: { pass: 3, fail: 0, pending: 0 } }), "green");
  assert.equal(checksOf({ checks: { pass: 0, fail: 0, pending: 0 } }), "none");
  assert.equal(checksOf({}), "none");
  assert.deepEqual([{ key: "claude" }, { name: "Claude Code" }, { key: "pi" }, { key: "opencode" }, { key: "bash" }, null].map(kindOf), ["claude", "claude", "pi", "opencode", "other", "other"]);
});

test("task stages, with a dropped task left out and workers re-indexed", () => {
  const tasks = [{ id: "a", state: "dropped" }, { id: "b", state: "in review" }, { id: "c", state: "validating" }, { id: "d", state: "blocked" }, { id: "e", state: "planned" }, { id: "f", state: "fix round" }];
  const w = term("w9", "rev-c");
  const f = facts({ workers: [w, term("w8", "impl-a")], stages: [
    { agents: [{ agent: term("w8", "impl-a") }] }, { agents: [] }, { agents: [{ agent: w }] }, { agents: [] }, { agents: [] }, { agents: [] }] });
  const r = sceneFacts([{ r: run({ tasks }), f, path }], extras()).runs[0];
  assert.deepEqual(r.tasks, ["review", "implement", "blocked", "planned", "fix"]);
  assert.equal(r.workers.find((x) => x.id === "w9").task, 1);
  assert.equal(r.workers.find((x) => x.id === "w8").task, null);
});

test("orchestrator state: a finished run's idle orchestrator is done", () => {
  const o = (orch, phase) => sceneFacts([row({ phase }, { orch })], extras()).runs[0].orchestrator.state;
  assert.equal(o("idle", "finished"), "done");
  assert.equal(o("idle", "running"), "idle");
  assert.equal(o("working", "finished"), "working");
  assert.equal(o("gone", "finished"), "gone");
  assert.equal(o("blocked", "running"), "blocked");
  assert.equal(o("surprise", "running"), "idle");
});

test("remote and closed runs are left out; a parked run stays and says so", () => {
  const out = sceneFacts([row({ key: "a" }), row({ key: "b", machine: "mac" }), row({ key: "c" }, { closed: true }), row({ key: "d" }, { parked: true })], extras());
  assert.deepEqual(out.runs.map((r) => [r.key, r.parked]), [["a", false], ["d", true]]);
});

test("unknown enums fall back; path keys and states are filtered", () => {
  const p = [{ key: "spec", state: "done" }, { key: "nope", state: "done" }, { key: "merge", state: "weird" }];
  const out = sceneFacts([{ r: run({ type: "odd" }), f: facts({ workers: [term("w1", "n", "zzz", "sleeping")] }), path: p }], extras()).runs[0];
  assert.equal(out.type, null);
  assert.deepEqual(out.path, [{ key: "spec", state: "done" }, { key: "merge", state: "todo" }]);
  assert.equal(out.workers[0].kind, "other");
  assert.equal(out.workers[0].state, "idle");
});

test("captain state and adrift cap", () => {
  const c = (captain, st) => sceneFacts([], extras({ captain, agentState: () => st })).captain.state;
  assert.equal(c({ terminal: null, watching: false }), "none");
  assert.equal(c({ terminal: {}, watching: true }, "idle"), "watching");
  assert.equal(c({ terminal: {}, watching: false }, "working"), "working");
  assert.equal(c({ terminal: {}, watching: false }, "idle"), "idle");
  const many = Array.from({ length: 20 }, (_, i) => ({ address: `a${i}`, name: `n${i}`, status: "idle" }));
  assert.equal(sceneFacts([], extras({ adrift: many })).adrift.length, 12);
});

test("shouldWrite", () => {
  const base = { wantAgeMs: 5000, lastJson: "a", json: "a", sinceLastMs: 1000 };
  assert.equal(shouldWrite(base), false);
  assert.equal(shouldWrite({ ...base, json: "b" }), true);
  assert.equal(shouldWrite({ ...base, sinceLastMs: 15000 }), true);
  assert.equal(shouldWrite({ ...base, lastJson: null }), true);
  assert.equal(shouldWrite({ ...base, json: "b", wantAgeMs: 60000 }), false);
  assert.equal(shouldWrite({ ...base, json: "b", wantAgeMs: null }), false);
});

test("a run whose plan.md lists no parsed tasks gets its tasks from the card's counts: done first, then planned, capped at 40", () => {
  const tasksOf = (counts, tasks = []) => sceneFacts([row({ tasks }, { counts })], extras()).runs[0].tasks;
  assert.deepEqual(tasksOf({ done: 3, planned: 3 }), ["done", "done", "done"]);
  assert.deepEqual(tasksOf({ done: 1, planned: 3 }), ["done", "planned", "planned"]);
  assert.deepEqual(tasksOf({ done: 0, planned: 0 }), []);
  assert.equal(tasksOf({ done: 90, planned: 100 }).length, 40);
  assert.deepEqual(tasksOf({ done: 45, planned: 50 }), Array(40).fill("done"));
  // a run that does list its tasks keeps them
  assert.deepEqual(tasksOf({ done: 9, planned: 9 }, [{ id: "t1", name: "x", state: "merged" }]), ["done"]);
  // workers stay without a task in the counts case
  assert.equal(sceneFacts([row({ tasks: [] }, { counts: { done: 2, planned: 4 } })], extras()).runs[0].workers[0].task, null);
});

test("ciRunning is true whenever any PR's checks are pending, even when another reason comes first", () => {
  const f = { att: { reasons: [{ key: "question" }, { key: "ci-running" }] }, prs: [{ number: 1, state: "OPEN", checks: { pass: 1, fail: 0, pending: 0 } }, { number: 2, state: "OPEN", checks: { pass: 0, fail: 0, pending: 2 } }] };
  assert.equal(sceneFacts([row({}, f)], extras()).runs[0].ciRunning, true);
  assert.equal(sceneFacts([row({}, { att: { reasons: [{ key: "ci-running" }] }, prs: [] })], extras()).runs[0].ciRunning, false);
});

test("what the mod writes goes through the server's sanitizer whole: no enum falls back to its default", async () => {
  const { sanitize } = await import("../../herdr-app/harbor3d/server/sanitize.js");
  const reasons = ["question", "gone", "stalled", "red-ci", "request review", "changes requested", "approved — merge", "review proof → merge", "finished", "review-pending"];
  const stages = ["merged", "implementing", "in review", "fixing review", "not started", "blocked"];
  const prStates = ["OPEN", "DRAFT", "MERGED", "CLOSED"], checks = [{ pass: 1 }, { fail: 1 }, { pending: 1 }, {}];
  const pathStates = ["done", "current", "you", "look", "fail", "todo"], pathKeys = ["spec", "build", "proven", "review", "human", "merge"];
  const kinds = ["claude", "pi", "opencode", "other"], states = ["working", "idle", "blocked", "done"];
  const rows = reasons.map((key, i) => ({
    r: run({ key: `:/runs/${i}`, type: ["feat", "fix", "rev", "expl"][i % 4], phase: i === 0 ? "finished" : "running", tasks: stages.map((state, k) => ({ id: `t${k}`, name: "x", state })) }),
    f: facts({ need: true, att: { reasons: [{ key }] }, orch: ["working", "idle", "blocked", "done", "gone"][i % 5],
      prs: prStates.map((state, k) => ({ number: k + 1, state, checks: checks[(k + i) % 4] })),
      workers: kinds.map((k, n) => term(`w${i}${n}`, `impl-${n}`, k, states[n])), stages: [] }),
    path: pathKeys.map((k, n) => ({ key: k, state: pathStates[(n + i) % 6] })),
  }));
  const out = sceneFacts(rows, extras({ captain: { terminal: term("c1", "cap"), watching: false }, adrift: kinds.map((k, n) => term(`a${n}`, "x", k, states[n])) }));
  const scene = sanitize(out, { mode: "private", secret: Buffer.from("s"), now: 99 });
  assert.equal(scene.runs.length, rows.length);
  scene.runs.forEach((s, i) => {
    const o = out.runs[i];
    assert.deepEqual([s.type, s.phase, s.need, s.needsYou, s.ciRunning], [o.type, o.phase, o.need, o.needsYou, o.ciRunning]);
    assert.deepEqual(s.path, o.path);
    assert.deepEqual(s.tasks, o.tasks);
    assert.deepEqual(s.prs.map(({ state, checks }) => ({ state, checks })), o.prs.map(({ state, checks }) => ({ state, checks })));
    assert.deepEqual([s.orchestrator.state, s.orchestrator.kind], [o.orchestrator.state, o.orchestrator.kind]);
    assert.deepEqual(s.workers.map((w) => [w.state, w.kind, w.task]), o.workers.map((w) => [w.state, w.kind, w.task]));
  });
  // every value of every enum was really exercised, so a rename on either side shows here
  const seen = (f) => new Set(scene.runs.flatMap(f));
  assert.equal(seen((s) => [s.need]).size, 10);
  assert.deepEqual([...seen((s) => s.tasks)].sort(), ["blocked", "done", "fix", "implement", "planned", "review"]);
  assert.equal(seen((s) => s.path.map((p) => p.state)).size, 6);
  assert.equal(seen((s) => s.prs.map((p) => p.state)).size, 4);
  assert.equal(seen((s) => s.prs.map((p) => p.checks)).size, 4);
  assert.equal(seen((s) => [s.orchestrator.state]).size, 5);
  assert.equal(seen((s) => s.workers.map((w) => w.kind)).size, 4);
  assert.deepEqual(scene.adrift.map((a) => [a.state, a.kind]), out.adrift.map((a) => [a.state, a.kind]));
  assert.equal(scene.captain.state, out.captain.state);
});
