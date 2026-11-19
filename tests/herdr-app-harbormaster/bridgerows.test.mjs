// The Bridge's pure pieces (bridgerows.js): columns, which block a run is in, the words on its line, the totals, the fold state.
// Run: node --import ./loader.mjs --test bridgerows.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { bridgeColumns, bridgeGroups, runLineText, parkedRowText, totalsText, toggleOpen, unfoldAll, foldAll, allUnfolded } from "../../herdr-app/mods/harbormaster/bridgerows.js";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const run = (key, o = {}) => ({ key, started: NOW - 1000 * Number(key.replace(/\D/g, "") || 0), progress: null, statusLine: null, away: null, ...o });
const newest = (a, b) => b.started - a.started;
const att = { needs: { group: "needs", reasons: [{ key: "question", text: "asks a question" }], waitSince: NOW - 4 * 60000 }, working: { group: "working", reasons: [] }, done: { group: "done", reasons: [], next: { kind: "merge" } } };

test("bridgeColumns: two from 700, one below", () => {
  assert.equal(bridgeColumns(860), 2);
  assert.equal(bridgeColumns(700), 2);
  assert.equal(bridgeColumns(699), 1);
  assert.equal(bridgeColumns(300), 1);
});

test("bridgeGroups: every run in exactly one block, needing you first, each newest first", () => {
  const a = run("r1"), b = run("r2"), c = run("r3"), d = run("r4"), p = run("r5", { away: { how: "parked", at: NOW } }), q = run("r6", { away: { how: "closed", at: NOW } });
  const of = { r1: att.working, r2: att.needs, r3: att.working, r4: att.done };
  const s = { shown: [a, b, c, d], parked: [p], closed: [q] };
  const g = bridgeGroups(s, (r) => of[r.key], newest);
  assert.deepEqual(g.open.map((r) => r.key), ["r2", "r1", "r3"]);
  assert.deepEqual(g.done.map((r) => r.key), ["r4"]);
  assert.deepEqual(g.parked.map((r) => r.key), ["r5"]);
  assert.deepEqual(g.closed.map((r) => r.key), ["r6"]);
  assert.equal([...g.open, ...g.done, ...g.parked, ...g.closed].length, 6);
});

test("bridgeGroups: a run listed twice appears once", () => {
  const a = run("r1", { away: { how: "closed", at: 1 } });
  const g = bridgeGroups({ shown: [a], parked: [], closed: [a] }, () => att.working, newest);
  assert.equal(g.open.length + g.done.length + g.parked.length + g.closed.length, 1);
});

test("runLineText: the lead in red for a run that needs you, else what it does now", () => {
  const n = runLineText(run("r1", { progress: "t3 coding" }), att.needs, NOW);
  assert.equal(n.red, true);
  assert.match(n.text, /asks a question · 4m/);
  assert.deepEqual(runLineText(run("r1", { progress: "t3  coding\nnext" }), att.working, NOW), { text: "t3 coding next", red: false });
  assert.deepEqual(runLineText(run("r1", { statusLine: "final review" }), att.working, NOW), { text: "final review", red: false });
  assert.equal(runLineText(run("r1"), att.working, NOW).red, false);
});

test("parkedRowText: parked age in days and what it waits on, without the age twice", () => {
  const r = run("r1", { away: { how: "parked", at: NOW - 3 * 86400000 - 5000 } });
  const w = { group: "done", reasons: [], next: { kind: "merge" }, step: null };
  const p = parkedRowText(r, w, NOW);
  assert.equal(p.age, "parked 3d");
  assert.doesNotMatch(p.waits, /3d/);
  assert.equal(parkedRowText(run("r2", { away: { how: "parked", at: NOW - 3 * 3600000 } }), { group: "working", reasons: [] }, NOW).age, "parked 3h");
  assert.equal(parkedRowText(run("r3", { away: { how: "parked" } }), { group: "working", reasons: [] }, NOW).age, "parked");
  assert.equal(parkedRowText(r, { group: "working", reasons: [], cantTell: true }, NOW).waits, "no pull request waiting");
});

test("totalsText: open runs, parked and open PRs, the last red when one fails; zero ones left out", () => {
  const s = { shown: [1, 2, 3, 4, 5], parked: [1, 2, 3], open: [1, 2], failing: 0 };
  assert.deepEqual(totalsText(s), [{ text: "5 open runs", tone: null }, { text: "3 parked", tone: null }, { text: "2 open PRs", tone: null }]);
  assert.deepEqual(totalsText({ shown: [1], parked: [], open: [], failing: 0 }, 1), [{ text: "1 open run", tone: null }]);
  const f = totalsText({ shown: [], parked: [], open: [1, 2], failing: 1 }, 0);
  assert.equal(f[1].tone, "blocked");
  assert.match(f[1].text, /2 open PRs · 1 failing/);
});

test("fold state: toggle one, unfold all, fold all; each leaves the other keys alone", () => {
  const runs = [{ key: "a" }, { key: "b" }];
  let s = toggleOpen(undefined, "open:a");
  assert.deepEqual([...s], ["open:a"]);
  assert.equal(allUnfolded(s, runs), false);
  s = unfoldAll(toggleOpen(s, "parked:p"), runs);
  assert.deepEqual([...s].sort(), ["open:a", "open:b", "parked:p"]);
  assert.equal(allUnfolded(s, runs), true);
  assert.deepEqual([...foldAll(s, runs)], ["parked:p"]);
  assert.deepEqual([...toggleOpen(s, "open:a")].sort(), ["open:b", "parked:p"]);
  assert.equal(allUnfolded(s, []), false);
});

import { pruneFolds, foldKey } from "../../herdr-app/mods/harbormaster/bridgerows.js";
test("fold keys are per block; pruneFolds drops keys of runs no longer in that block", () => {
  const a = { key: "a" }, b = { key: "b" };
  const set = new Set([foldKey("open", a), foldKey("open", b), foldKey("parked", a), "open:gone"]);
  const pruned = pruneFolds(set, { open: [b], done: [], parked: [a], closed: [] });
  assert.deepEqual([...pruned].sort(), ["open:b", "parked:a"]);
  assert.deepEqual([...unfoldAll(new Set(), [a, b])].sort(), ["open:a", "open:b"]);
  assert.deepEqual([...foldAll(new Set(["open:a", "parked:a"]), [a])], ["parked:a"]);
});
