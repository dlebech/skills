// The views agree (t15): a run's pill, its Crew row's lead and its parked label say the same
// first thing; the header, the card and a confirm count tasks done the same way; the facts
// line says identical PRs once; the task strip's colours; a "1, …" recommendation.
// Run: node --import ./loader.mjs --test agree.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, nextStepText, ageText } from "../../herdr-app/mods/harbormaster/attention.js";
import { rowLead, badgeOf, pillReason } from "../../herdr-app/mods/harbormaster/crewrows.js";
import { parkedLabel, prFacts } from "../../herdr-app/mods/harbormaster/tell.js";
import { taskCounts, stats } from "../../herdr-app/mods/harbormaster/data.js";
import { segmentLook } from "../../herdr-app/mods/harbormaster/proof.js";
import { parseQuestion } from "../../herdr-app/mods/harbormaster/question.js";

const MIN = 60000;
const now = Date.parse("2026-11-16T12:00:00Z");
const ago = (m) => now - m * MIN;

const run = (o = {}) => ({
  key: ":/r/x", dir: "/r/x", folder: "/p/skills", repo: "skills", phase: "finished", statusLine: "finished",
  progress: null, tasks: [], prs: [{ url: "u1" }], question: null, ask: null, askedAt: null, away: null,
  updated: ago(60), started: ago(300), ...o,
});
const pr = (o = {}) => ({
  number: 42, state: "OPEN", review: null, approvedBy: [], changesBy: [], requested: [], checks: { pass: 3, fail: 0, pending: 0 },
  url: "u1", repo: "o/skills", ci: { startedAt: ago(90), finishedAt: ago(80) }, reviewedAt: null, ...o,
});
const read = (list) => ({ list, readable: true, why: null });
const at = (r, list, o = {}) => assess(r, { orch: "idle", working: false, pr: read(list), now, ...o });
const red = { pass: 1, fail: 1, pending: 0 };

test("red CI: the pill, the Crew lead and the parked label all lead with it, none says merge", () => {
  const list = [pr({ checks: red })];
  const a = at(run(), list);
  assert.equal(pillReason(a).key, "red-ci");
  assert.equal(badgeOf(a, true).label, "red CI on #42");
  assert.equal(rowLead(a, now).lead, "red CI on #42 · review proof · 1h20m");
  const parked = { how: "parked", at: ago(3 * 24 * 60) };
  assert.equal(parkedLabel(at(run({ away: parked }), list), parked, now), "red CI · review proof · 3d");
  for (const s of [badgeOf(a, true).label, rowLead(a, now).lead, parkedLabel(at(run({ away: parked }), list), parked, now)]) {
    assert.ok(!/merge/.test(s), s);
  }
});

test("a self-flow draft reads review proof → ready in the pill, the Crew lead and the parked label", () => {
  const list = [pr({ state: "DRAFT" })];
  const a = at(run(), list);
  assert.equal(badgeOf(a, true).label, "review proof → ready");
  assert.equal(rowLead(a, now).lead.split(" · ")[0], "review proof → ready");
  const parked = { how: "parked", at: ago(120) };
  assert.equal(parkedLabel(at(run({ away: parked }), list), parked, now), "review proof → ready · 2h0m");
  // A draft with red CI: red first, no step past the proof.
  const both = [pr({ state: "DRAFT", checks: red })];
  assert.equal(badgeOf(at(run(), both), true).label, "red CI on #42");
  assert.equal(parkedLabel(at(run({ away: parked }), both), parked, now), "red CI · review proof · 2h0m");
  // An open PR keeps → merge.
  assert.equal(badgeOf(at(run(), [pr()]), true).label, "review proof → merge");
});

test("a question run's pill names its PR step, not the question (its box shows that)", () => {
  const a = at(run({ phase: "running", question: "?", ask: { title: "Which database?" }, statusLine: "waiting for user" }), [pr({ checks: red })]);
  assert.equal(a.reasons[0].key, "question");
  assert.equal(badgeOf(a).label, "red CI on #42");
});

test("the narrow sidebar's lead leaves out the comment count so the age survives; the pill keeps it", () => {
  const comments = { count: 24, bots: {}, items: [] };
  const list = [pr({ review: "APPROVED", approvedBy: ["m"], reviewedAt: ago(85), comments }), pr({ number: 43, url: "u2", review: "APPROVED", approvedBy: ["m"], reviewedAt: ago(80), comments: { count: 0, bots: {}, items: [] } })];
  const a = at(run({ folder: "/p/snevagten" }), list, { flow: "peer" });
  assert.equal(rowLead(a, now).lead, "approved · 24 comments · 2 PRs · 1h25m");
  assert.equal(rowLead(a, now, { narrow: true }).lead, "approved · 2 PRs · 1h25m");
  assert.equal(badgeOf(a, true).label, "approved · 24 comments · 2 PRs");
  assert.equal(nextStepText(a.next, { comments: false }), "approved · 2 PRs");
});

test("ages under a minute read <1m, as Herdr's Agents list says", () => {
  assert.equal(ageText(30000), "<1m");
  assert.equal(ageText(0), "<1m");
  assert.equal(ageText(MIN), "1m");
});

test("tasks done count plan.md's done tasks, status.json's merged only without any", () => {
  const tasks = [...Array(13)].map((_, i) => ({ id: `t${i + 1}`, state: i % 2 ? "done" : "merged" })).concat([{ id: "t14", state: "implementing" }]);
  // status.json says 7 merged of 9 planned; plan.md lists 14, 13 of them done.
  const r = run({ phase: "running", tasks, merged: 7, planned: 9 });
  assert.deepEqual(taskCounts(r), { merged: 13, planned: 14 });
  assert.deepEqual(taskCounts(run({ tasks: [], merged: 3, planned: 5 })), { merged: 3, planned: 5 });
  assert.deepEqual(taskCounts(run({ tasks: [], merged: null, planned: null })), { merged: 0, planned: 0 });
  // The overview header sums the same counts.
  const s = stats([r], { agents: [], terminals: [], spaces: [], panes: [] });
  assert.equal(`${s.merged}/${s.planned}`, "13/14");
});

test("PRs that all say the same are said once; any difference keeps them apart", () => {
  const approved = (o = {}) => pr({ review: "APPROVED", approvedBy: ["mfalkenbrink"], ...o });
  const two = [approved(), approved({ number: 1372, url: "u2" })];
  const f = prFacts(two);
  assert.deepEqual(f.map((x) => x.text), ["2 PRs open", "checks ✓", "Approved by mfalkenbrink"]);
  assert.equal(f[0].kind, "prs");
  assert.deepEqual(f[0].prs, two);
  // Different checks: each PR on its own.
  const apart = prFacts([approved(), approved({ number: 1372, url: "u2", checks: { pass: 2, fail: 1, pending: 0 } })]);
  assert.deepEqual(apart.map((x) => x.text), ["PR #42 open", "checks ✓", "Approved by mfalkenbrink", "PR #1372 open", "checks ✗ 1 failing", "Approved by mfalkenbrink"]);
  // A one-way door is never folded away.
  const door = prFacts(two.map((p) => ({ ...p, danger: "one-way: drops a table" })), { oneWay: (d) => /^one-way/.test(d) });
  assert.equal(door.filter((x) => x.text === "one-way door").length, 2);
  // One PR is as before.
  assert.deepEqual(prFacts([pr()]).map((x) => x.text), ["PR #42 open", "checks ✓"]);
});

test("failing checks are red on a live run, dim on a parked one", () => {
  const p = [pr({ checks: red })];
  assert.deepEqual(prFacts(p).find((x) => /failing/.test(x.text ?? "")).tone, "blocked");
  assert.deepEqual(prFacts(p, { away: true }).find((x) => /failing/.test(x.text ?? "")).tone, "dim");
});

test("the task strip: amber only for proof wanting a look, done keeps its colour with a pass mark", () => {
  assert.deepEqual(segmentLook(null), { color: "stage", mark: null });
  assert.deepEqual(segmentLook("pass"), { color: "stage", mark: "pass" });
  assert.deepEqual(segmentLook("accepted"), { color: "stage", mark: "pass" });
  assert.deepEqual(segmentLook("fail"), { color: "blocked", mark: null });
  assert.deepEqual(segmentLook("partial"), { color: "amber", mark: null });
  assert.deepEqual(segmentLook("unchecked"), { color: "amber", mark: null });
});

test("## Recommended may give its option's number with a comma", () => {
  const q = parseQuestion("# Which?\n\n## Options\n1. Postgres: what production runs\n2. SQLite: simpler\n\n## Recommended\n1, it is what production runs.\n");
  assert.equal(q.recommended, 0);
  assert.equal(q.why, "it is what production runs.");
  // A label with a comma is not a number.
  const l = parseQuestion("# Which?\n\n## Options\n1. Postgres, managed: costs\n2. SQLite: simpler\n\n## Recommended\nPostgres, managed: it scales\n");
  assert.equal(l.recommended, 0);
});
