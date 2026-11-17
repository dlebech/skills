// The views agree (t15): a run's pill, its Crew row's lead and its parked label say the same
// first thing; the header, the card and a confirm count tasks done the same way; the facts
// line says identical PRs once; the task strip's colours; a "1, …" recommendation.
// Run: node --import ./loader.mjs --test agree.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, nextStepText, ageText } from "../../herdr-app/mods/harbormaster/attention.js";
import { rowLead, badgeOf, pillReason } from "../../herdr-app/mods/harbormaster/crewrows.js";
import { parkedLabel, toastParts } from "../../herdr-app/mods/harbormaster/tell.js";
import { prFacts } from "../../herdr-app/mods/harbormaster/prfacts.js";
import { proofFailed } from "../../herdr-app/mods/harbormaster/attend.js";
import { summaryOf } from "../../herdr-app/mods/harbormaster/statsdata.js";
import { buildLine } from "../../herdr-app/mods/harbormaster/history.js";
import { taskCounts, stats } from "../../herdr-app/mods/harbormaster/data.js";
import { segmentLook, parseProofMd } from "../../herdr-app/mods/harbormaster/proof.js";
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

test("toasts word the step as the pill does: red CI, a draft", () => {
  const texts = (list) => toastParts(run(), at(run(), list)).parts.map((p) => p.text);
  assert.deepEqual(texts([pr({ checks: red })]), ["Red CI on #42", "#42 review proof"]);
  assert.deepEqual(texts([pr({ state: "DRAFT" })]), ["#42 review proof → ready"]);
  assert.deepEqual(texts([pr()]), ["#42 review proof → merge"]);
  // The id keeps the key, so a toast already told is not told again for the new wording.
  assert.deepEqual(toastParts(run(), at(run(), [pr({ checks: red })])).parts.map((p) => p.id), ["pr/red-ci:red CI on #42", "pr/review proof → merge:#42"]);
});

test("a failing proof: no view says merge, as the box says to read it first", () => {
  const md = parseProofMd("Tier: T1\n\n## t1 core\nResult: pass — tests\n\n## t2 polish\nResult: fail — the shot is blank\n");
  const tasks = [{ id: "t1", name: "core", state: "done" }, { id: "t2", name: "polish", state: "done" }];
  const failing = run({ tasks, proof: { md, files: null, accepted: {} } });
  assert.equal(proofFailed(failing), true);
  // Accepted, it is not a fail; under way again, a fail still is (as the box counts it).
  assert.equal(proofFailed({ ...failing, proof: { md, files: null, accepted: { t2: { result: "fail — the shot is blank" } } } }), false);
  assert.equal(proofFailed({ ...failing, phase: "running", tasks: [tasks[0], { ...tasks[1], state: "implementing" }] }, ["done", "implementing"]), true);
  assert.equal(proofFailed(run({ tasks })), false);
  const a = at(run(), [pr()], { proofFailed: true });
  assert.equal(a.reasons[0].key, "review proof → merge");
  assert.equal(badgeOf(a, true).label, "proof failed");
  assert.equal(rowLead(a, now).lead, "proof failed · 1h0m");
  const parked = { how: "parked", at: ago(120) };
  const p = at(run({ away: parked }), [pr()], { proofFailed: true });
  assert.equal(parkedLabel(p, parked, now), "proof failed · 2h0m");
  assert.deepEqual(toastParts(run(), a).parts.map((x) => x.text), ["#42 proof failed"]);
  // Over red CI too.
  const both = at(run(), [pr({ checks: red })], { proofFailed: true });
  for (const s of [badgeOf(a, true).label, rowLead(a, now).lead, parkedLabel(p, parked, now), rowLead(both, now).lead, parkedLabel(at(run({ away: parked }), [pr({ checks: red })], { proofFailed: true }), parked, now), ...toastParts(run(), both).parts.map((x) => x.text)]) {
    assert.ok(!/merge/.test(s), s);
  }
});

test("the stats view and the history line count tasks as the header and the card do", () => {
  const tasks = [...Array(13)].map((_, i) => ({ id: `t${i + 1}`, state: "done" })).concat([{ id: "t14", state: "implementing" }]);
  const r = run({ phase: "running", tasks, merged: 7, planned: 9, branch: "b" });
  const s = summaryOf(r, null, null);
  assert.equal(`${s.tasks_merged}/${s.tasks_planned}`, "13/14");
  const l = buildLine(r, null, null, now, now);
  assert.equal(`${l.tasks_merged}/${l.tasks_planned}`, "13/14");
  // Without a plan, status.json's; with neither, nothing.
  assert.equal(summaryOf(run({ merged: 3, planned: 5 }), null, null).tasks_merged, 3);
  assert.equal(summaryOf(run({ merged: undefined, planned: undefined }), null, null).tasks_merged, null);
});

test("a question run's pill names its PR step, not the question (its box shows that)", () => {
  const a = at(run({ phase: "running", question: "?", ask: { title: "Which database?" }, statusLine: "waiting for user" }), [pr({ checks: red })]);
  assert.equal(a.reasons[0].key, "question");
  assert.equal(badgeOf(a).label, "red CI on #42");
});

test("the narrow sidebar's lead leaves out the comment count so the age survives; the pill keeps it", () => {
  const comments = { count: 24, threads: 23, notes: 1, bots: {}, items: [] };
  const list = [pr({ review: "APPROVED", approvedBy: ["m"], reviewedAt: ago(85), comments }), pr({ number: 43, url: "u2", review: "APPROVED", approvedBy: ["m"], reviewedAt: ago(80), comments: { count: 0, threads: 0, notes: 0, bots: {}, items: [] } })];
  const a = at(run({ folder: "/p/snevagten" }), list, { flow: "peer" });
  assert.equal(rowLead(a, now).lead, "approved · 23 threads, 1 note · 2 PRs · 1h25m");
  assert.equal(rowLead(a, now, { narrow: true }).lead, "approved · 2 PRs · 1h25m");
  assert.equal(badgeOf(a, true).label, "approved · 23 threads, 1 note · 2 PRs");
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
  assert.deepEqual(taskCounts(r), { done: 13, planned: 14 });
  assert.deepEqual(taskCounts(run({ tasks: [], merged: 3, planned: 5 })), { done: 3, planned: 5 });
  assert.deepEqual(taskCounts(run({ tasks: [], merged: null, planned: null })), { done: 0, planned: 0 });
  // The overview header sums the same counts.
  const s = stats([r], { agents: [], terminals: [], spaces: [], panes: [] });
  assert.equal(`${s.done}/${s.planned}`, "13/14");
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

test("a run whose plan is still open is told nothing about merging: pill, Crew lead, toast and parked label agree", () => {
  const open = run({ phase: "running", tasks: [{ id: "t1", state: "done" }, { id: "t2", state: "planned" }], planned: 2 });
  const a = at(open, [pr()]);
  assert.equal(a.group, "working");
  assert.equal(a.held, true);
  assert.equal(badgeOf(a, false), null);
  assert.doesNotMatch(rowLead(a, now).lead, /merge|review proof/);
  assert.deepEqual(toastParts(open, a).parts, []);
  assert.equal(parkedLabel(a, { at: ago(3 * 1440) }, now), null);
  // The same run parked with its orchestrator gone: still no merge.
  const gone = at(open, [pr()], { orch: "gone" });
  assert.deepEqual(gone.reasons.map((r) => r.key), ["gone"]);
  assert.equal(parkedLabel(gone, { at: ago(3 * 1440) }, now), null);
  assert.doesNotMatch(badgeOf(gone, false)?.label ?? "", /merge/);
  // Once its tasks are done the same PR reads as before.
  const done = run({ phase: "running", tasks: [{ id: "t1", state: "done" }, { id: "t2", state: "merged" }], planned: 2 });
  assert.equal(parkedLabel(at(done, [pr()]), { at: ago(3 * 1440) }, now), "review proof → merge · 3d");
});

test("tasks the plan dropped are neither open nor done, on the strip's count and in the plan rule alike", async () => {
  const { taskCounts: counts, planOpen } = await import("../../herdr-app/mods/harbormaster/tasks.js");
  const r = { phase: "running", planned: 4, tasks: [{ state: "done" }, { state: "merged" }, { state: "skipped" }, { state: "dropped — superseded" }] };
  assert.deepEqual(counts(r), { done: 2, planned: 2 });
  assert.equal(taskCounts(r).planned, 2);
  assert.equal(planOpen(r), false);
  assert.equal(planOpen({ ...r, tasks: [...r.tasks, { state: "planned" }], planned: 5 }), true);
  assert.equal(planOpen({ ...r, phase: "finished", tasks: [{ state: "planned" }], planned: 1 }), false);
});
