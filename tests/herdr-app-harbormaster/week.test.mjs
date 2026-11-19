// The "This week" figures (statsdata.js weekOf) and the block drawn with the test stubs (bridgeweek.js).
// Run: node --import ./loader.mjs --test week.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { find } from "gpui-kit";
import { weekOf } from "../../herdr-app/mods/harbormaster/statsdata.js";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
const run = (o) => ({ live: false, started: null, ended: null, closed: null, wall: 0, critical_path: {}, agents: [], tokens: null, timed: true, ...o });

test("weekOf: a run closed 6 days ago counts, one closed 8 days ago does not, a live one from 20 days ago does", () => {
  const runs = [run({ started: ago(7.5), closed: ago(6) }), run({ started: ago(9), ended: ago(8.5), closed: ago(8) }), run({ live: true, started: ago(20) }), run({ started: ago(1) })];
  assert.equal(weekOf(runs, NOW).runs, 3);
  assert.equal(weekOf([runs[1]], NOW).runs, 0);
  assert.equal(weekOf(runs, NOW, 30).runs, 4);
});

test("weekOf: sums agent time (less agent wait), tokens, waited time and the split", () => {
  const a = run({ started: ago(1), critical_path: { model: 60, user_wait: 30, idle: 10 }, tokens: { total: 1000 },
    agents: [{ name: "orchestrator", role: "orchestrator", total: 130, categories: { model: 60, agent_wait: 40, user_wait: 30 } }, { name: "impl", role: "impl", total: 50, categories: { model: 50 } }] });
  const b = run({ started: ago(2), critical_path: { model: 40, user_wait: 10 }, tokens: { total: 500 }, agents: [{ total: 20, categories: { model: 20 } }] });
  const w = weekOf([a, b], NOW);
  assert.equal(w.runs, 2);
  assert.equal(w.agentSecs, 60 + 50 + 20); // the orchestrator's agent_wait and user_wait are left out
  assert.equal(w.tokens, 1500);
  assert.equal(w.waitedSecs, 40);
  assert.equal(w.split.working, 140);
  assert.equal(w.split.idle, 10);
  assert.deepEqual(w.split.shown.map((p) => p.key), ["model", "user_wait"]);
  assert.equal(w.untimed, 0);
});

test("weekOf: a run with no tokens or no timing adds nothing and is counted as untimed", () => {
  const w = weekOf([run({ started: ago(1), timed: false }), run({ started: ago(1), agents: [{ total: 30, categories: {} }] })], NOW);
  assert.equal(w.runs, 2);
  assert.equal(w.tokens, 0);
  assert.equal(w.agentSecs, 30);
  assert.equal(w.untimed, 1);
});

test("weekOf: another agent's agent_wait is its sub-agents' work and stays in agent time", () => {
  const w = weekOf([run({ started: ago(1), agents: [{ name: "impl-t1", role: "impl", total: 100, categories: { model: 60, agent_wait: 40 } }] })], NOW);
  assert.equal(w.agentSecs, 100);
});

test("weekOf: an empty list", () => {
  assert.deepEqual(weekOf([], NOW), { runs: 0, agentSecs: 0, tokens: 0, waitedSecs: 0, split: { working: 0, idle: 0, parts: [], shown: [], hidden: [] }, untimed: 0 });
  assert.equal(weekOf(undefined, NOW).runs, 0);
});

// ---- the block ----
import { weekBlock } from "../../herdr-app/mods/harbormaster/bridgeweek.js";
import { mergeRuns, cachedHistory } from "../../herdr-app/mods/harbormaster/statsdata.js";
const t = new Proxy({}, { get: () => "#888" });
const text = (e) => (e && typeof e === "object" && "kids" in e ? e.kids.map(text).join(" ") : typeof e === "string" ? e : "");
const open = (o) => ({ key: "k", source: "open", live: true, machine: null, run: "/r", folder: "/p", branch: "b", started: new Date().toISOString(), ended: null, closed: null,
  wall: 100, critical_path: { model: 60, user_wait: 20, idle: 20 }, categories: {}, tasks: [], agents: [{ total: 90, categories: {} }], tokens: { total: 2500000 }, timed: true, ...o });

// statsRuns builds from view.runs (raw runs) and the caches: an empty list here, with the figures from the memo.
test("weekBlock: figures, no runs, some untimed: four labels and the Stats link", () => {
  for (const [runs, want] of [
    [[open({})], /runs.*agent time.*tokens.*waited on you.*model 60% · user wait 20% · idle 20%.*Stats/],
    [[], /No runs in the last 7 days.*Stats/],
    [[open({}), open({ key: "j", run: "/s", timed: false, critical_path: {} })], /1 run not timed.*Stats/],
  ]) {
    const view = { runs: [] };
    // Make statsRuns return the prepared data: its memo is kept while the refs are the same.
    view.statsMemo = { refs: [view.runs, cachedHistory()], data: { runs: mergeRuns(runs, []), across: {} } };
    const e = weekBlock(view, t);
    const s = text(e);
    assert.match(s, /This week/);
    assert.match(s, want);
    assert.ok(find(e, "week-stats"));
    if (runs.length) for (const l of ["runs", "agent time", "tokens", "waited on you"]) assert.ok(s.includes(l), l);
  }
});

test("weekReads: nothing unless the block was drawn, one read per 30 s, redraws through the spawned cx", async () => {
  const { weekReads } = await import("../../herdr-app/mods/harbormaster/bridgeweek.js");
  let spawns = 0, dead = 0, live = 0;
  const inner = { notify() { live++; } };
  const cx = { notify() { dead++; throw new Error("dead"); }, spawn(f) { spawns++; return f(inner); } };
  const view = { runs: [] };
  await weekReads(view, cx);
  assert.equal(spawns, 0);
  view.weekDrawn = true;
  weekReads(view, cx);
  assert.equal(spawns, 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(live >= 1);
  assert.equal(dead, 0);
  view.weekDrawn = true;
  weekReads(view, cx);
  assert.equal(spawns, 1);
  assert.equal(view.weekDrawn, false);
});
