// The Needs you rules (attention.js), the stores behind them (tracking.js) and the PR summary
// fields they read (data.js prSummary).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reviewFlow, flowKey, prStep, nextStep, nextStepText, prRead, ciState, ciTimes, usualCi, ageText, stepOf, stepText,
  trackSince, stepSig, stalled, quietText, assess, byWait, STALL_MS, prMaxAge, prTtl, trackParts, stepParts, taskKey, progressKey, reviewRunStep,
  waitSig, IDLE_ASK_MS, IDLE_ASK_TEXT, idleAsking,
} from "../../herdr-app/mods/harbormaster/attention.js";
import { addCiSample, nextSteps, screenSig, CI_KEEP, probeEvery, withWait, prunedWaits } from "../../herdr-app/mods/harbormaster/tracking.js";
import { prSummary, viewerReview, PR_FIELDS, carryRuns, withReadTimes, prEntrySame, rereadRuns } from "../../herdr-app/mods/harbormaster/data.js";
import { filesFresh } from "../../herdr-app/mods/harbormaster/attend.js";

const MIN = 60000;
const now = Date.parse("2026-11-16T12:00:00Z");
const ago = (m) => now - m * MIN;

const run = (o = {}) => ({
  key: ":/r/skills/x", dir: "/r/skills/x", folder: "/home/u/projects/skills", repo: "skills", phase: "running",
  statusLine: "running", progress: "t1 implementing", tasks: [], prs: [{ url: "u1" }], question: null, ask: null,
  askedAt: null, away: null, updated: ago(60), started: ago(300), ...o,
});
const checks = (pass = 0, fail = 0, pending = 0) => ({ pass, fail, pending });
const pr = (o = {}) => ({
  number: 42, state: "OPEN", review: null, approvedBy: [], changesBy: [], requested: [], checks: checks(3), url: "u1",
  repo: "o/skills", ci: { startedAt: ago(90), finishedAt: ago(80) }, reviewedAt: null, ...o,
});
const read = (list, o = {}) => ({ list, readable: true, why: null, ...o });
const settled = (r, list, o = {}) => assess(r, { orch: "idle", working: false, pr: read(list), now, ...o });

// ---- review flow ----

test("the review flow defaults to self for every folder, and a setting overrides it", () => {
  assert.equal(reviewFlow(run()), "self");
  assert.equal(reviewFlow(run({ folder: "/home/u/projects/acme" })), "self", "no folder is peer built in");
  assert.equal(reviewFlow(run({ folder: "/home/u/projects/acme/" }), { acme: "peer" }), "peer");
  assert.equal(reviewFlow(run(), { skills: "peer" }), "peer");
  assert.equal(reviewFlow(run(), { skills: "bogus" }), "self");
  assert.equal(flowKey({ folder: "", repo: "widgets" }), "widgets");
});

// ---- labels ----

test("peer labels: request review, review from, changes requested, approved — merge", () => {
  assert.equal(prStep(pr({ state: "DRAFT", requested: ["anna"] }), "peer").label, "request review");
  assert.equal(prStep(pr(), "peer").label, "request review");
  const w = prStep(pr({ requested: ["anna"] }), "peer");
  assert.deepEqual([w.label, w.who], ["review from", ["anna"]]);
  assert.equal(prStep(pr({ review: "CHANGES_REQUESTED", changesBy: ["anna"] }), "peer").label, "changes requested");
  assert.equal(prStep(pr({ review: "APPROVED", approvedBy: ["anna"] }), "peer").label, "approved — merge");
  // A later reviewer requested does not hide an approval or a change request.
  assert.equal(prStep(pr({ approvedBy: ["anna"], requested: ["bo"] }), "peer").label, "approved — merge");
});

test("self labels: review proof → merge, or changes requested", () => {
  assert.equal(prStep(pr(), "self").label, "review proof → merge");
  assert.equal(prStep(pr({ state: "DRAFT" }), "self").label, "review proof → merge");
  assert.equal(prStep(pr({ changesBy: ["anna"] }), "self").label, "changes requested");
});

test("merged or closed reads merged — close run in either flow; an unknown PR has no label", () => {
  assert.equal(prStep(pr({ state: "MERGED" }), "peer").label, "merged — close run");
  assert.equal(prStep(pr({ state: "CLOSED" }), "self").label, "merged — close run");
  assert.equal(prStep(pr({ state: "UNKNOWN" }), "self"), null);
  assert.equal(nextStep([], "self"), null);
});

test("several PRs: the most urgent label plus a count", () => {
  const list = [pr({ number: 1, state: "MERGED" }), pr({ number: 2, requested: ["anna"] }), pr({ number: 3, approvedBy: ["bo"] })];
  const s = nextStep(list, "peer");
  assert.deepEqual([s.label, s.count, s.same, s.pr.number], ["approved — merge", 3, 1, 3]);
  assert.equal(nextStepText(s), "approved — merge · 3 PRs");
  const w = nextStep([pr({ number: 1, requested: ["anna"] }), pr({ number: 2, requested: ["bo", "anna"] })], "peer");
  assert.equal(nextStepText(w), "review from anna, bo · 2 PRs");
  assert.equal(nextStepText(nextStep([pr({ requested: ["anna"] })], "peer")), "review from anna");
});

// ---- reading state ----

test("a PR read is unreadable before the first read, after a gh failure, with a stale PR or a stuck refresh", () => {
  assert.equal(prRead(run({ prs: [] }), null, now).readable, true);
  assert.equal(prRead(run(), null, now).readable, false);
  assert.equal(prRead(run(), { at: now, list: [pr()], error: "gh: offline" }, now).why, "gh: offline");
  assert.equal(prRead(run(), { at: now, list: [pr({ state: "UNKNOWN" })] }, now).readable, false);
  assert.equal(prRead(run(), { at: now, list: [pr({ stale: true })] }, now).readable, false);
  assert.equal(prRead(run(), { at: now - prMaxAge(false) - 1, list: [pr()] }, now).readable, false);
  assert.equal(prRead(run(), { at: ago(1), list: [pr()] }, now).readable, true);
});

// ---- groups ----

test("Needs you: an open question, also when the PR read failed", () => {
  const q = run({ question: "Which way?", ask: { title: "Which way?" }, askedAt: ago(20) });
  const a = assess({ ...q, prs: [] }, { orch: "idle", pr: read([]), now });
  assert.equal(a.group, "needs");
  assert.equal(a.reasons[0].key, "question");
  assert.equal(a.waitSince, ago(20));
  const b = assess(q, { orch: "idle", pr: { list: null, readable: false, why: "gh failed" }, now });
  assert.deepEqual([b.group, b.cantTell, b.reasons.map((x) => x.key)], ["needs", true, ["question"]]);
  // With other reasons too, the run waits since the oldest of them.
  const c = assess(q, { orch: "idle", pr: read([pr()]), now });
  assert.deepEqual([c.reasons.map((x) => x.key), c.waitSince], [["question", "review proof → merge"], ago(60)]);
});

test("Needs you: a waiting or blocked plan, or an orchestrator blocked on a dialog", () => {
  assert.equal(assess(run({ phase: "waiting" }), { orch: "idle", pr: read([]), now }).group, "needs");
  assert.equal(assess(run({ phase: "blocked" }), { orch: "idle", pr: read([]), now }).group, "needs");
  assert.equal(assess(run(), { orch: "blocked", working: false, pr: read([]), now }).group, "needs");
});

test("Needs you on PR grounds once nothing works on the run: request review (peer), review proof (self)", () => {
  const fin = run({ phase: "finished" });
  const peer = settled(fin, [pr()], { flow: "peer" });
  assert.deepEqual([peer.group, peer.reasons[0].key], ["needs", "request review"]);
  assert.equal(settled(fin, [pr({ state: "DRAFT" })], { flow: "peer" }).reasons[0].key, "request review");
  const self = settled(fin, [pr()], { flow: "self" });
  assert.deepEqual([self.group, self.reasons[0].key, self.next.label], ["needs", "review proof → merge", "review proof → merge"]);
});

test("Needs you: changes requested, approved — merge, red CI", () => {
  const fin = run({ phase: "finished" });
  assert.equal(settled(fin, [pr({ changesBy: ["a"], reviewedAt: ago(5) })], { flow: "peer" }).reasons[0].key, "changes requested");
  const ap = settled(fin, [pr({ approvedBy: ["a"], reviewedAt: ago(5) })], { flow: "peer" });
  assert.deepEqual([ap.reasons[0].key, ap.waitSince], ["approved — merge", ago(5)]);
  const red = settled(fin, [pr({ checks: checks(2, 1), ci: { startedAt: ago(40), finishedAt: ago(30) } })], { flow: "self" });
  assert.equal(red.group, "needs");
  assert.ok(red.reasons.some((x) => x.key === "red-ci" && x.text === "red CI on #42"));
  assert.equal(red.waitSince, ago(30));
});

test("Needs you: a stalled run", () => {
  const a = assess(run(), { orch: "idle", pr: read([]), stall: { quietMs: 45 * MIN, by: "quiet" }, now });
  assert.deepEqual([a.group, a.reasons[0].key, a.reasons[0].text, a.waitSince], ["needs", "stalled", "quiet 45m", ago(45)]);
});

test("Working (agents, CI running, idle) and Waiting on others (a reviewer requested and not answered)", () => {
  const r = run();
  const w = assess(r, { orch: "working", working: true, pr: read([pr()]), now, flow: "peer" });
  assert.deepEqual([w.group, w.reasons[0].key], ["working", "working"]);
  // Working wins over PR grounds and red CI: it is the run's turn.
  assert.equal(assess(r, { working: true, pr: read([pr({ checks: checks(0, 1) })]), now }).group, "working");
  const wf = settled(run({ phase: "finished" }), [pr({ requested: ["anna"] })], { flow: "peer" });
  assert.deepEqual([wf.group, wf.reasons[0].key, wf.reasons[0].text], ["waiting", "waiting-for", "review from anna"]);
  const ci = settled(run({ phase: "finished" }), [pr({ checks: checks(2, 0, 1), ci: { startedAt: ago(10), finishedAt: null } })], { flow: "self" });
  assert.deepEqual([ci.group, ci.reasons[0].key], ["working", "ci-running"]);
  assert.equal(settled(run({ prs: [] }), []).reasons[0].key, "idle");
});

test("can't tell: gh failing, never in Needs you on PR grounds", () => {
  const fin = run({ phase: "finished" });
  const a = assess(fin, { orch: "idle", pr: { list: [pr({ approvedBy: ["a"], stale: true })], readable: false, why: "gh could not read u1" }, now, flow: "peer" });
  assert.deepEqual([a.group, a.cantTell, a.why, a.reasons[0].key], ["cant", true, "gh could not read u1", "cant-tell"]);
  const red = assess(fin, { orch: "idle", pr: { list: [pr({ checks: checks(0, 2) })], readable: false, why: "stale" }, now });
  assert.equal(red.group, "cant");
});

test("can't tell: the machine is offline or the run files are a stale read", () => {
  const off = assess(run(), { orch: "idle", pr: read([pr({ approvedBy: ["a"] })]), filesOk: false, now, flow: "peer" });
  assert.deepEqual([off.group, off.cantTell], ["cant", true]);
  const none = assess(null, { orch: null, now });
  assert.deepEqual([none.group, none.cantTell], ["cant", true]);
  // A dialog on screen is a live fact: it still needs you.
  assert.equal(assess(null, { orch: "blocked", now }).group, "needs");
});

test("Done: a finished run with every PR merged or closed and nothing at work; a closed run", () => {
  const fin = run({ phase: "finished", updated: ago(100) });
  const d = settled(fin, [pr({ state: "MERGED" }), pr({ number: 43, state: "CLOSED" })]);
  assert.deepEqual([d.group, d.next.label, d.next.count, d.waitSince], ["done", "merged — close run", 2, ago(100)]);
  // Still working (a next PR may come), or asking: not done.
  assert.equal(assess(run(), { working: true, pr: read([pr({ state: "MERGED" })]), now }).group, "working");
  // A running run between turns, its PR merged, is not done either: it may open another.
  const between = settled(run(), [pr({ state: "MERGED" })]);
  assert.deepEqual([between.group, between.reasons[0].key, between.next.label], ["working", "idle", "merged — close run"]);
  assert.equal(settled(run({ question: "q?", ask: { title: "q?" } }), [pr({ state: "MERGED" })]).group, "needs");
  assert.equal(assess(run({ away: { how: "closed", at: ago(1) } }), { pr: read([]), now }).group, "done");
  // No PR at all is never done.
  assert.notEqual(settled(fin, []).group, "done");
});

test("longest wait first within a group", () => {
  const list = [{ waitSince: ago(5) }, { waitSince: null }, { waitSince: ago(50) }].sort(byWait);
  assert.deepEqual(list.map((x) => x.waitSince), [ago(50), ago(5), null]);
});

// ---- step and age ----

test("ages read 34m, 1h12m, 2d3h", () => {
  assert.equal(ageText(34 * MIN), "34m");
  assert.equal(ageText(72 * MIN), "1h12m");
  assert.equal(ageText((51 * 60) * MIN), "2d3h");
  assert.equal(ageText(-5), "<1m");
});

test("the current step: tasks at work, else CI on a PR, else the progress line", () => {
  const tasks = [{ id: "t1", state: "merged" }, { id: "t3", state: "implementing" }, { id: "t4", state: "review" }];
  const s = stepOf(run({ tasks }), { stages: ["done", "implement", "review"], since: ago(72) });
  assert.equal(stepText(s, now), "t3 implementing 1h12m · +1 task");
  const ci = stepOf(run(), { prs: [pr({ checks: checks(1, 0, 2), ci: { startedAt: ago(34), finishedAt: null } })], since: ago(90) });
  assert.equal(stepText(ci, now), "CI on #42 · 34m");
  assert.equal(stepText(stepOf(run({ progress: "writing docs" }), { since: ago(3) }), now), "writing docs · 3m");
  assert.equal(stepText(stepOf(run({ progress: "writing docs" }), {}), now), "writing docs");
});

test("the step anchor moves only when the progress line or a task state changes", () => {
  const r = run({ tasks: [{ id: "t1", state: "planned" }] });
  const first = trackSince(null, stepSig(r), now, ago(10));
  assert.equal(first.since, ago(10));
  assert.equal(trackSince(first, stepSig(r), now + MIN), first);
  const moved = trackSince(first, stepSig({ ...r, tasks: [{ id: "t1", state: "implementing" }] }), now + MIN);
  assert.equal(moved.since, now + MIN);
  // A seed in the future (a clock off) is not trusted.
  assert.equal(trackSince(null, "x", now, now + MIN).since, now);
});

test("step anchors: new runs seeded from updated, gone runs forgotten only from machines that answered", () => {
  const a = run({ key: ":/a", updated: ago(10) }), b = run({ key: "box:/b" });
  const s1 = nextSteps({}, [a, b], new Set(["", "box"]), now);
  assert.equal(s1[":/a"].since, ago(10));
  assert.equal(nextSteps(s1, [a, b], new Set(["", "box"]), now + MIN), s1);
  const s2 = nextSteps(s1, [a], new Set([""]), now + MIN);
  assert.ok(s2["box:/b"], "box did not answer: kept");
  assert.equal(nextSteps(s1, [a], new Set(["", "box"]), now + MIN)["box:/b"], undefined);
});

test("each task at work keeps its own age: a progress change or another task does not reset it", () => {
  const tasks = (t4, t9) => [{ id: "t4", state: t4 }, { id: "t9", state: t9 }];
  const stagesOf = (r) => r.tasks.map((k) => (k.state === "implementing" ? "implement" : k.state === "planned" ? null : "done"));
  const r0 = run({ key: ":/a", updated: ago(70), progress: "t4 started", tasks: tasks("implementing", "planned") });
  const s1 = nextSteps({}, [r0], new Set([""]), ago(60), stagesOf);
  // First sight: dated by status.json's updated.
  assert.equal(s1[":/a"].parts[taskKey(r0.tasks[0], "implement")], ago(70));
  // t9 starts and the progress line moves on: the run's anchor resets, t4's age does not.
  const r1 = { ...r0, progress: "t9 started too", tasks: tasks("implementing", "implementing") };
  const s2 = nextSteps(s1, [r1], new Set([""]), ago(10), stagesOf);
  assert.equal(s2[":/a"].since, ago(10));
  assert.equal(s2[":/a"].parts[taskKey(r1.tasks[0], "implement")], ago(70));
  assert.equal(s2[":/a"].parts[taskKey(r1.tasks[1], "implement")], ago(10));
  assert.equal(s2[":/a"].parts[progressKey("t9 started too")], ago(10));
  // Only the current parts are kept: the old progress line is pruned.
  assert.equal(s2[":/a"].parts[progressKey("t4 started")], undefined);
  const step = stepOf(r1, { stages: stagesOf(r1), since: s2[":/a"].since, ages: s2[":/a"].parts });
  assert.equal(stepText(step, now), "t4 implementing 1h10m · +1 task");
  // Nothing changed: the same store, so nothing is written.
  assert.equal(nextSteps(s2, [r1], new Set([""]), now, stagesOf), s2);
  // The progress line, when it is the step, has its own age too.
  const quiet = { ...r1, tasks: tasks("merged", "merged") };
  const s3 = nextSteps(s2, [quiet], new Set([""]), ago(5), stagesOf);
  assert.equal(stepText(stepOf(quiet, { stages: stagesOf(quiet), since: s3[":/a"].since, ages: s3[":/a"].parts }), now), "t9 started too · 10m");
  // An entry from before parts were kept dates its parts by its own since.
  const old = { ":/a": { sig: s1[":/a"].sig, since: ago(40) } };
  assert.equal(nextSteps(old, [r0], new Set([""]), now, stagesOf)[":/a"].parts[progressKey("t4 started")], ago(40));
});

test("a stale run read keeps its task ages: its agents are missing, not gone", () => {
  // t3 is planned in plan.md; its agent implementing it makes the shown stage "implement".
  const r = run({ key: "box:/a", updated: ago(70), tasks: [{ id: "t3", state: "planned" }] });
  const withAgent = () => ["implement"], noAgents = () => [null];
  const s1 = nextSteps({}, [r], new Set(["box"]), ago(60), withAgent);
  const key = taskKey(r.tasks[0], "implement");
  assert.equal(s1["box:/a"].parts[key], ago(70));
  // box misses a poll: the run is carried stale and its agents are not in the facts.
  assert.equal(nextSteps(s1, [{ ...r, stale: true }], new Set([""]), ago(5), noAgents), s1);
  // The next good poll finds the agent again: t3's age is its own, not 0m.
  assert.equal(nextSteps(s1, [r], new Set(["box"]), now, withAgent)["box:/a"].parts[key], ago(70));
});

test("step parts: the progress line and the tasks at work only; trackParts keeps unchanged parts as they are", () => {
  const r = run({ progress: "p", tasks: [{ id: "t1", state: "merged" }, { id: "t2", state: "planned" }] });
  assert.deepEqual(stepParts(r, ["done", "implement"]), ["p:p", "t:t2:planned:implement"]);
  const a = trackParts(null, ["x", "y"], now, ago(3));
  assert.deepEqual(a, { x: ago(3), y: ago(3) });
  assert.equal(trackParts(a, ["x", "y"], now + MIN), a);
  assert.deepEqual(trackParts(a, ["y", "z"], now + MIN), { y: ago(3), z: now + MIN });
});

test("screen words ignore spinners and ticking timers", () => {
  assert.equal(screenSig("✻ Working… (34s · esc to interrupt)"), screenSig("✽ Working… (1m 2s · esc to interrupt)"));
  assert.notEqual(screenSig("Working"), screenSig("Working\nRan tests"));
});

// ---- stalled ----

test("stalled by quiet time: 30 minutes without a sign of life", () => {
  assert.deepEqual(stalled(run(), { now, lastActivity: ago(30) }), { quietMs: STALL_MS, by: "quiet" });
  assert.equal(stalled(run(), { now, lastActivity: ago(29) }), false);
  assert.equal(quietText(stalled(run(), { now, lastActivity: ago(95) })), "quiet 1h35m");
  // Not known yet: never stalled.
  assert.equal(stalled(run(), { now, lastActivity: null }), false);
});

test("never stalled: finished, parked, waiting, or with an open question", () => {
  const quiet = { now, lastActivity: ago(120) };
  assert.equal(stalled(run({ phase: "finished" }), quiet), false);
  assert.equal(stalled(run({ away: { how: "parked" } }), quiet), false);
  assert.equal(stalled(run({ phase: "waiting" }), quiet), false);
  assert.equal(stalled(run({ question: "q?" }), quiet), false);
  assert.equal(stalled(run(), { ...quiet, orch: "blocked" }), false);
});

test("stalled by CI time: past twice the repository's usual CI time", () => {
  const prs = [pr({ checks: checks(1, 0, 1), ci: { startedAt: ago(25), finishedAt: null } })];
  const s = stalled(run(), { now, lastActivity: ago(1), prs, ciUsual: 12 * MIN });
  assert.deepEqual(s, { quietMs: 25 * MIN, by: "ci" });
  assert.equal(stalled(run(), { now, lastActivity: ago(1), prs, ciUsual: 13 * MIN }), false);
});

test("no CI baseline: no CI stall", () => {
  const prs = [pr({ checks: checks(1, 0, 1), ci: { startedAt: ago(500), finishedAt: null } })];
  assert.equal(stalled(run(), { now, lastActivity: ago(1), prs, ciUsual: null }), false);
  assert.equal(usualCi([5 * MIN, 6 * MIN]), null);
  assert.equal(usualCi([]), null);
});

test("the usual CI time is the median of the repository's finished CI runs", () => {
  assert.equal(usualCi([4, 10, 6]), 6);
  assert.equal(usualCi([4, 10, 6, 8]), 7);
});

test("CI samples: once per head commit, the last ones kept", () => {
  const done = (sha, s, f) => pr({ sha, ci: { startedAt: s, finishedAt: f } });
  let store = addCiSample({}, done("a", ago(10), ago(4)));
  assert.deepEqual(store, { "o/skills": [{ sha: "a", ms: 6 * MIN }] });
  assert.equal(addCiSample(store, done("a", ago(10), ago(2))), store);
  assert.equal(addCiSample(store, done("b", ago(10), null)), store, "still running");
  for (let i = 0; i < CI_KEEP + 5; i++) store = addCiSample(store, done(`s${i}`, ago(10), ago(5)));
  assert.equal(store["o/skills"].length, CI_KEEP);
  assert.equal(store["o/skills"].at(-1).sha, `s${CI_KEEP + 4}`);
});

// ---- CI state from the rollup ----

test("CI times: first start to last completion, none while a check is pending", () => {
  const t = (m) => new Date(ago(m)).toISOString();
  const done = [
    { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS", startedAt: t(10), completedAt: t(6) },
    { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", startedAt: t(9), completedAt: t(4) },
  ];
  assert.deepEqual(ciTimes(done), { startedAt: ago(10), finishedAt: ago(4) });
  const running = [...done, { status: "QUEUED", conclusion: "", startedAt: "0001-01-01T00:00:00Z", completedAt: "0001-01-01T00:00:00Z" }];
  // Only a queued check is pending and it has not started: no start to age CI from yet.
  assert.deepEqual(ciTimes(running), { startedAt: null, finishedAt: null });
  assert.deepEqual(ciTimes([]), { startedAt: null, finishedAt: null });
});

test("CI state across open PRs: running over red over green; merged PRs do not count", () => {
  assert.equal(ciState([pr({ checks: checks(0, 1) }), pr({ number: 2, checks: checks(0, 0, 1) })]).state, "running");
  assert.equal(ciState([pr({ checks: checks(1, 1) })]).state, "red");
  assert.equal(ciState([pr()]).state, "green");
  assert.equal(ciState([pr({ state: "MERGED", checks: checks(0, 1) })]).state, null);
});

// ---- the PR summary ----

test("PR reads ask for reviewRequests, and the summary names who is requested", () => {
  assert.match(PR_FIELDS, /\breviewRequests\b/);
  const s = prSummary({
    number: 7, state: "OPEN", isDraft: false, url: "https://github.com/o/r/pull/7", author: { login: "me" },
    reviewRequests: [{ __typename: "User", login: "anna" }, { __typename: "Team", name: "backend" }],
    reviews: [{ author: { login: "bo" }, state: "APPROVED", submittedAt: "2026-11-16T11:00:00Z" }],
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-11-16T10:00:00Z", completedAt: "2026-11-16T10:05:00Z" }],
    headRefOid: "abc",
  });
  assert.deepEqual(s.requested, ["anna", "backend"]);
  assert.deepEqual(s.approvedBy, ["bo"]);
  assert.equal(s.reviewedAt, Date.parse("2026-11-16T11:00:00Z"));
  assert.deepEqual(s.ci, { startedAt: Date.parse("2026-11-16T10:00:00Z"), finishedAt: Date.parse("2026-11-16T10:05:00Z") });
  assert.deepEqual([s.sha, s.repo, s.checks.pass], ["abc", "o/r", 1]);
});

// ---- review round 1 ----

test("an open run's PRs are read every 5 minutes, so a few open runs stay within GitHub's rate limits", () => {
  assert.equal(prTtl(false), 5 * MIN);
  // A read one interval old is on schedule, not stuck.
  assert.equal(prRead(run(), { at: now - prTtl(false), list: [pr()] }, now).readable, true);
});

test("a closed run's PRs, read every 30 minutes, do not go stale between reads", () => {
  assert.equal(prTtl(true), 30 * MIN);
  const entry = { at: ago(31), list: [pr({ state: "MERGED" })] };
  // Open, a 31-minute-old read means the refresh is stuck; closed, it is on schedule.
  assert.equal(prRead(run(), entry, now, false).readable, false);
  assert.equal(prRead(run({ phase: "finished" }), entry, now, true).readable, true);
  assert.equal(prRead(run(), { ...entry, at: now - prMaxAge(true) - 1 }, now, true).readable, false);
});

test("peer: a reviewer asked again waits, even after their change request or approval", () => {
  const again = pr({ review: "CHANGES_REQUESTED", changesBy: ["anna"], requested: ["anna"] });
  const s = prStep(again, "peer");
  assert.deepEqual([s.label, s.who], ["review from", ["anna"]]);
  assert.equal(prStep(pr({ review: "APPROVED", approvedBy: ["anna"], requested: ["anna"] }), "peer").label, "review from");
  // Someone else's change request still stands.
  assert.equal(prStep(pr({ changesBy: ["anna", "bo"], requested: ["anna"] }), "peer").label, "changes requested");
  // The repo's reviewDecision counts when no reviewer's review stands and nobody is asked.
  assert.equal(prStep(pr({ review: "CHANGES_REQUESTED" }), "peer").label, "changes requested");
  const g = settled(run({ phase: "finished" }), [again], { flow: "peer" });
  assert.deepEqual([g.group, g.reasons[0].text], ["waiting", "review from anna"]);
});

test("an offline machine's runs are carried, marked stale, and read as can't tell", () => {
  const a = run({ key: ":/a", machine: null }), b = run({ key: "box:/b", machine: "box", prs: [], phase: "waiting" });
  const carried = carryRuns([a, b], ["box"]);
  assert.deepEqual(carried.map((r) => [r.key, r.stale]), [["box:/b", true]]);
  // Carried again, the same object.
  assert.equal(carryRuns(carried, ["box"])[0], carried[0]);
  assert.deepEqual(carryRuns([a], [null]).map((r) => r.key), [":/a"]);
  const cache = { at: now - 1000, failed: ["box"] };
  assert.equal(filesFresh(carried[0], now, cache), false);
  assert.equal(filesFresh(a, now, cache), true);
  assert.equal(filesFresh(a, now, { at: ago(3), failed: [] }), false, "a poll over 2 minutes old");
  // Even its waiting plan, read before the machine went away, is not Needs you now.
  const g = assess(carried[0], { orch: null, pr: read([]), filesOk: filesFresh(carried[0], now, cache), now });
  assert.deepEqual([g.group, g.cantTell], ["cant", true]);
});

test("asking for a reread after closing a run leaves the other runs' files fresh", () => {
  // Closing one run used to zero the read time, putting every other run under Can't tell.
  const a = run({ key: ":/a", machine: null });
  const cache = { at: now - 1000, failed: [] };
  rereadRuns(cache);
  assert.equal(cache.due, true);
  assert.equal(filesFresh(a, now, cache), true);
});

test("a re-run failed job is aged from its re-run, not from the first checks", () => {
  const t = (m) => new Date(ago(m)).toISOString();
  const rollup = [
    { status: "COMPLETED", conclusion: "SUCCESS", startedAt: t(50), completedAt: t(40) },
    { status: "IN_PROGRESS", conclusion: "", startedAt: t(2), completedAt: null },
  ];
  assert.deepEqual(ciTimes(rollup), { startedAt: ago(2), finishedAt: null });
  const prs = [pr({ checks: checks(1, 0, 1), ci: ciTimes(rollup) })];
  assert.equal(stalled(run(), { now, lastActivity: ago(1), prs, ciUsual: 10 * MIN }), false);
  assert.equal(stepText(stepOf(run(), { prs }), now), "CI on #42 · 2m");
});

test("a quiet wait on CI is not a stall, inside its usual time or without a baseline to judge it by", () => {
  const prs = [pr({ checks: checks(0, 0, 3), ci: { startedAt: ago(35), finishedAt: null } })];
  assert.equal(stalled(run(), { now, lastActivity: ago(35), prs, ciUsual: 40 * MIN }), false);
  assert.equal(stalled(run(), { now, lastActivity: ago(35), prs, ciUsual: null }), false);
  // assess drops a quiet stall while CI runs; a CI stall stays.
  const quiet = assess(run(), { orch: "idle", pr: read(prs), stall: { quietMs: 35 * MIN, by: "quiet" }, now });
  assert.deepEqual([quiet.group, quiet.stall, quiet.reasons[0].key], ["working", false, "ci-running"]);
  const ci = assess(run(), { orch: "idle", pr: read(prs), stall: { quietMs: 90 * MIN, by: "ci" }, now });
  assert.deepEqual([ci.group, ci.reasons[0].key], ["needs", "stalled"]);
});

test("a finished run with no PR needs you: finished — read and close; closed, it waits on nothing", () => {
  const fin = run({ phase: "finished", prs: [], progress: "report written", updated: ago(180) });
  const a = settled(fin, []);
  assert.deepEqual([a.group, a.reasons.map((x) => x.key), a.reasons[0].text, a.waitSince], ["needs", ["finished"], "finished — read and close", ago(180)]);
  // Its tab closed (data.js isClosed) or a closed marker: no longer.
  assert.notEqual(settled(fin, [], { closed: true }).group, "needs");
  assert.equal(settled({ ...fin, away: { how: "closed", at: ago(1) } }, []).group, "done");
  // Still at work: not yet.
  assert.equal(settled(fin, [], { working: true }).group, "working");
});

test("a run waiting on a reviewer is not stalled: it stays in Waiting on others", () => {
  const a = assess(run(), { orch: "idle", flow: "peer", pr: read([pr({ requested: ["anna"] })]), stall: { quietMs: 40 * MIN, by: "quiet" }, now });
  assert.deepEqual([a.group, a.stall, a.reasons.map((x) => x.key)], ["waiting", false, ["waiting-for"]]);
});

test("a run whose orchestrator is gone or lost never stalls; it needs you to resume it", () => {
  assert.equal(stalled(run(), { now, lastActivity: ago(120), orch: "gone" }), false);
  const a = assess(run(), { orch: "gone", pr: read([pr({ requested: ["anna"] })]), flow: "peer", now });
  assert.deepEqual([a.group, a.stall, a.reasons.map((x) => x.key), a.reasons[0].text], ["needs", false, ["gone"], "orchestrator gone"]);
  // A live fact: it counts even when the PRs can't be read.
  const b = assess(run(), { orch: "gone", pr: { list: null, readable: false, why: "gh failed" }, now });
  assert.deepEqual([b.group, b.cantTell, b.reasons[0].key], ["needs", true, "gone"]);
  // A finished run whose orchestrator is gone waits on its PRs as before.
  assert.equal(settled(run({ phase: "finished" }), [pr({ state: "MERGED" })], { orch: "gone" }).group, "done");
  assert.equal(settled(run({ phase: "finished" }), [pr({ requested: ["anna"] })], { orch: "gone", flow: "peer" }).group, "waiting");
});

test("screens of a stalled run are read every 5 minutes, not every minute", () => {
  assert.equal(probeEvery(26 * MIN), MIN);
  assert.equal(probeEvery(STALL_MS), 5 * MIN);
});

test("a PR read that found nothing new is not written; its read time still keeps it fresh", () => {
  const old = { at: ago(30), okAt: ago(30), error: null, relatedError: null, list: [pr()], related: [] };
  const again = { ...old, at: ago(1), okAt: ago(1) };
  assert.equal(prEntrySame(old, again), true);
  assert.equal(prEntrySame(old, { ...again, list: [pr({ state: "MERGED" })] }), false);
  assert.equal(prEntrySame(old, { ...again, error: "gh could not read u1" }), false);
  assert.equal(prEntrySame(old, { ...again, related: [pr({ number: 7 })] }), false);
  assert.equal(prEntrySame(null, again), false);
  // The stored entry alone is stale; with the read time kept in memory it is fresh.
  assert.equal(prRead(run(), old, now).readable, false);
  const seen = withReadTimes(old, { at: again.at, okAt: again.okAt });
  assert.deepEqual([seen.at, seen.okAt, prRead(run(), seen, now).readable], [ago(1), ago(1), true]);
  assert.equal(withReadTimes(old, null), old);
  assert.equal(withReadTimes(null, { at: ago(1) }), null);
});

// ---- no merge while work is planned ----

test("a run with planned tasks left is not told to review proof or request a review until its plan is done", () => {
  const open = run({ tasks: [{ id: "t1", state: "done" }, { id: "t2", state: "implementing" }], planned: 3 });
  const a = settled(open, [pr()]);
  assert.equal(a.reasons.some((r) => r.key === "review proof → merge"), false);
  assert.notEqual(a.group, "needs");
  // Peer flow's "request review" waits the same way.
  assert.equal(settled(open, [pr({ state: "DRAFT" })], { flow: "peer" }).reasons.some((r) => r.key === "request review"), false);
  // Every planned task done: it counts again, finished or not.
  const all = run({ tasks: [{ id: "t1", state: "done" }, { id: "t2", state: "merged" }], planned: 2 });
  assert.deepEqual(settled(all, [pr()]).reasons.map((r) => r.key), ["review proof → merge"]);
  // Finished, whatever the task list says.
  assert.deepEqual(settled(run({ ...open, phase: "finished" }), [pr()]).reasons.map((r) => r.key), ["review proof → merge"]);
  // Nothing planned (no plan.md): as before.
  assert.deepEqual(settled(run(), [pr()]).reasons.map((r) => r.key), ["review proof → merge"]);
});

test("an approval, a change request and red CI count while the plan is still open", () => {
  const open = run({ tasks: [{ id: "t1", state: "implementing" }], planned: 2 });
  assert.deepEqual(settled(open, [pr({ review: "APPROVED", approvedBy: ["anna"] })], { flow: "peer" }).reasons.map((r) => r.key), ["approved — merge"]);
  assert.deepEqual(settled(open, [pr({ review: "CHANGES_REQUESTED", changesBy: ["anna"] })]).reasons.map((r) => r.key), ["changes requested"]);
  const red = settled(open, [pr({ checks: checks(1, 1) })]);
  assert.deepEqual(red.reasons.map((r) => r.key), ["red-ci"]);
});

// ---- finished review runs: what became of the review ----

// The three real runs (acme-login#1394, acme-api#1821 approved; #1831 pending), as gh's reviews list gave them.
const REV = { 1394: [["coderabbitai", "COMMENTED"], ["noor", "COMMENTED"], ["kim", "APPROVED"]], 1821: [["coderabbitai", "COMMENTED"], ["kim", "APPROVED"]],
  1831: [["kim", "PENDING"], ["coderabbitai", "COMMENTED"], ["noor", "COMMENTED"]] };
const revPr = (n, state = "OPEN") => prSummary({ number: n, state, url: `https://github.com/o/r/pull/${n}`, author: { login: "x" },
  reviews: REV[n].map(([login, st]) => ({ author: { login }, state: st })) }, "o/r", "kim");
const revRun = (o = {}) => run({ type: "rev", phase: "finished", prs: [], ...o });
const revAssess = (n, state, o = {}) => assess(revRun(), { related: [revPr(n, state)], orch: "idle", pr: read([]), now, ...o });

test("viewerReview: the viewer's pending review wins, else their last submitted one, else none", () => {
  const rs = REV[1831].map(([login, state]) => ({ author: { login }, state }));
  assert.equal(viewerReview(rs, "kim"), "PENDING");
  assert.equal(viewerReview(rs, "nobody"), null);
  assert.equal(viewerReview([{ author: { login: "d" }, state: "COMMENTED" }, { author: { login: "d" }, state: "APPROVED" }], "d"), "APPROVED");
  assert.equal(prSummary({ number: 1, state: "OPEN", url: "u", reviews: [] }, "o/r").mine, null);
});

test("an approved review run is Done: reviewed — close run, and Close all merged can take it", () => {
  for (const n of [1394, 1821]) {
    const a = revAssess(n);
    assert.deepEqual([a.group, a.next.label, a.reasons.length], ["done", "reviewed — close run", 0]);
  }
});

test("a review run with a pending review needs you: submit your pending review, with the PR to open", () => {
  const a = revAssess(1831);
  assert.deepEqual([a.group, a.reasons.map((r) => r.text)], ["needs", ["submit your pending review"]]);
  assert.equal(a.reasons[0].pr.number, 1831);
});

test("a review run whose PR is merged or closed is Done whatever the review; no review at all stays finished", () => {
  assert.equal(revAssess(1831, "MERGED").group, "done");
  assert.equal(revAssess(1831, "CLOSED").next.label, "reviewed — close run");
  const none = assess(revRun(), { related: [prSummary({ number: 5, state: "OPEN", url: "u", reviews: [] }, "o/r", "kim")], orch: "idle", pr: read([]), now });
  assert.deepEqual([none.group, none.reasons[0].text], ["needs", "finished — read and close"]);
  assert.equal(reviewRunStep(revRun(), [{ state: "UNKNOWN", number: null }]), null);
  assert.equal(reviewRunStep(run({ prs: [] }), [revPr(1394)]), null);
});

// ---- waiting on someone (the user's mark) ----

// A finished peer-flow run with one open PR and no reviewer: `request review`, as in the user's world.
const peerRun = (o = {}) => run({ phase: "finished", statusLine: "finished", progress: "", folder: "/home/u/projects/acme", repo: "acme", ...o });
const peer = (r, list, o = {}) => settled(r, list, { flow: "peer", ...o });
// The mark as Waiting on someone… sets it: the step's label and signature as they are now.
const markOf = (a, text = "Kari — preview check", at = ago(120)) => ({ text, at, label: a.next.label, sig: waitSig(a.next) });

test("a run marked waiting on someone is in Waiting on others, with the text and its age", () => {
  const before = peer(peerRun(), [pr()]);
  assert.equal(before.group, "needs");
  assert.deepEqual(before.reasons.map((x) => x.key), ["request review"]);
  const a = peer(peerRun(), [pr()], { waitOn: markOf(before) });
  assert.equal(a.group, "waiting");
  assert.deepEqual(a.reasons, [{ key: "waiting-on", text: "waiting on Kari — preview check", since: ago(120) }]);
  assert.deepEqual(a.waitingOn, { text: "Kari — preview check", at: ago(120) });
  assert.equal(a.dropWait, undefined);
  assert.equal(a.waitSince, ago(120));
  // Review proof → merge too (self flow), and a ready run is no longer drawn as ready.
  const self = settled(run({ phase: "finished" }), [pr()], { proofRead: true, proofClean: true });
  assert.equal(self.reasons[0].key, "review proof → merge");
  const s = settled(run({ phase: "finished" }), [pr()], { proofRead: true, proofClean: true, waitOn: markOf(self) });
  assert.deepEqual([s.group, s.ready, s.reasons[0].key], ["waiting", false, "waiting-on"]);
});

test("each let-go event drops the mark and puts the run back where the rules say", () => {
  const mark = markOf(peer(peerRun(), [pr()]));
  const back = (list, o = {}, r = peerRun()) => peer(r, list, { waitOn: mark, ...o });
  const cases = {
    "reviewer requested": [back([pr({ requested: ["anna"] })]), "waiting"],
    "approval": [back([pr({ approvedBy: ["anna"], reviewedAt: ago(5) })]), "needs"],
    "change request": [back([pr({ changesBy: ["anna"], reviewedAt: ago(5) })]), "needs"],
    "a review comment": [back([pr({ reviewedAt: ago(5) })]), "needs"],
    "a new push": [back([pr({ sha: "beef" })]), "needs"],
    "red CI": [back([pr({ checks: checks(2, 1), ci: { startedAt: ago(20), finishedAt: ago(10) } })]), "needs"],
    "a question": [back([pr()], {}, peerRun({ phase: "waiting", question: "q.md", statusLine: "waiting for user" })), "needs"],
    "merged": [back([pr({ state: "MERGED" })]), "done"],
    "closed": [back([pr({ state: "CLOSED" })]), "done"],
  };
  for (const [what, [a, group]] of Object.entries(cases)) {
    assert.equal(a.dropWait, true, what);
    assert.equal(a.waitingOn, undefined, what);
    assert.equal(a.group, group, what);
  }
  // A reviewer requested lets go into review from, as without a mark.
  assert.equal(cases["reviewer requested"][0].reasons[0].key, "waiting-for");
  // An orchestrator gone on an unfinished run.
  const r = run({ phase: "running" });
  const own = markOf(peer(r, [pr()], { orch: "idle" }));
  assert.equal(peer(r, [pr()], { orch: "gone", waitOn: own }).dropWait, true);
});

test("the mark is never revived: a let-go is a delete, and the same step without it is Needs you", () => {
  const before = peer(peerRun(), [pr()]);
  const store = withWait({}, peerRun().key, markOf(before));
  // The reviewer request comes and goes again: the poll deleted the mark at the first read.
  const gone = peer(peerRun(), [pr({ requested: ["anna"] })], { waitOn: store[peerRun().key] });
  assert.equal(gone.dropWait, true);
  const after = prunedWaits(store, new Set([peerRun().key]), [peerRun().key]);
  assert.deepEqual(after, {});
  assert.equal(peer(peerRun(), [pr()], { waitOn: after[peerRun().key] ?? null }).group, "needs");
});

test("an unreadable PR read neither applies nor drops the mark; nor does a working run", () => {
  const mark = markOf(peer(peerRun(), [pr()]));
  const cant = peer(peerRun(), [], { pr: { list: [], readable: false, why: "gh failed" }, waitOn: mark });
  assert.deepEqual([cant.group, cant.dropWait, cant.waitingOn], ["cant", undefined, undefined]);
  // A question read from the files, PRs unreadable: Needs you, the mark kept for later.
  const q = peer(peerRun({ phase: "waiting", question: "q.md", statusLine: "waiting for user" }), [], { pr: { list: [], readable: false, why: "gh failed" }, waitOn: mark });
  assert.deepEqual([q.group, q.dropWait], ["needs", undefined]);
  // Stale run files: nothing is judged either.
  assert.equal(peer(peerRun(), [pr()], { filesOk: false, waitOn: mark }).dropWait, undefined);
  // Agents working, or CI running: Working, mark kept, even when the PR changed meanwhile.
  const w = peer(peerRun(), [pr({ sha: "beef" })], { working: true, waitOn: mark });
  assert.deepEqual([w.group, w.dropWait], ["working", undefined]);
  const ci = peer(peerRun(), [pr({ checks: checks(1, 0, 2), ci: { startedAt: ago(2), finishedAt: null } })], { waitOn: mark });
  assert.deepEqual([ci.group, ci.dropWait], ["working", undefined]);
});

test("a question or a gone orchestrator lets the mark go even while agents still work", () => {
  const r = run({ phase: "running" });
  const mark = markOf(peer(r, [pr()]));
  const asking = run({ phase: "running", question: "q.md", statusLine: "waiting for user" });
  const q = peer(asking, [pr()], { working: true, waitOn: mark });
  assert.deepEqual([q.group, q.dropWait], ["needs", true]);
  assert.equal(peer(r, [pr()], { orch: "blocked", working: true, waitOn: mark }).dropWait, true);
  assert.equal(peer(r, [pr()], { orch: "gone", working: true, waitOn: mark }).dropWait, true);
  // PR-ground changes still wait for the run to settle.
  assert.equal(peer(r, [pr({ sha: "beef" })], { working: true, waitOn: mark }).dropWait, undefined);
});

test("a question or red CI wins over the mark; a quiet stall does not", () => {
  const r = run({ phase: "running" });
  const mark = markOf(peer(r, [pr()]));
  const q = peer(run({ phase: "running", question: "q.md", statusLine: "waiting for user" }), [pr()], { waitOn: mark });
  assert.equal(q.group, "needs");
  assert.ok(q.reasons.some((x) => x.key === "question"));
  const red = peer(r, [pr({ checks: checks(1, 1), ci: { startedAt: ago(20), finishedAt: ago(10) } })], { waitOn: mark });
  assert.ok(red.reasons.some((x) => x.key === "red-ci"));
  // Waiting on a person is not a stall.
  const quiet = { quietMs: 40 * MIN, by: "quiet" };
  assert.equal(peer(r, [pr()], { stall: quiet }).reasons.some((x) => x.key === "stalled"), true);
  const held = peer(r, [pr()], { stall: quiet, waitOn: mark });
  assert.deepEqual([held.group, held.reasons[0].key], ["waiting", "waiting-on"]);
});

test("the waiting-on store: set, clear, prune unlisted and dropped runs", () => {
  const m = { text: "  Kari — preview check ", at: 5, label: "request review", sig: "s" };
  const one = withWait({}, "a", m);
  assert.deepEqual(one, { a: { text: "Kari — preview check", at: 5, label: "request review", sig: "s" } });
  assert.deepEqual(withWait(one, "a", { ...m, text: "   " }), {});
  assert.deepEqual(withWait(one, "a", null), {});
  const none = {};
  assert.equal(withWait(none, "b", null), none);
  assert.equal(withWait(one, "", m), one);
  const two = withWait(one, "b", m);
  assert.equal(prunedWaits(two, new Set(["a", "b"])), two);
  assert.deepEqual(Object.keys(prunedWaits(two, new Set(["a"]))), ["a"]);
  assert.deepEqual(Object.keys(prunedWaits(two, new Set(["a", "b"]), ["a"])), ["b"]);
  // An unread run (its machine did not answer) keeps its mark though it is not listed; a drop still goes.
  assert.equal(prunedWaits(two, new Set(), [], () => true), two);
  assert.deepEqual(Object.keys(prunedWaits(two, new Set(), ["a"], () => true)), ["b"]);
});

// ---- idle-ask: an orchestrator that stopped without asking through Harbormaster ----

const idle = (r, o = {}) => assess(r, { orch: "done", working: false, pr: read([]), orchIdleMs: IDLE_ASK_MS, since: ago(5), now, ...o });

test("idle-ask: an idle or done orchestrator in a running run, no question, idle 2 minutes: Needs you", () => {
  for (const orch of ["idle", "done"]) {
    const a = idle(run({ prs: [] }), { orch });
    assert.deepEqual([a.group, a.reasons.map((x) => x.key)], ["needs", ["idle-ask"]], orch);
    assert.equal(a.reasons[0].text, IDLE_ASK_TEXT);
    assert.equal(a.reasons[0].since, now - IDLE_ASK_MS);
    assert.ok(a.reasons[0].short);
  }
  // Its PRs unreadable: still a live fact, told with can't-tell beside it.
  const b = idle(run(), { pr: { list: null, readable: false, why: "gh failed" } });
  assert.deepEqual([b.group, b.cantTell, b.reasons[0].key], ["needs", true, "idle-ask"]);
});

test("idle-ask: under the grace, or with the idle time unknown, it stays Working with reason idle", () => {
  for (const orchIdleMs of [IDLE_ASK_MS - 1, MIN, 0, null]) {
    const a = idle(run({ prs: [] }), { orchIdleMs });
    assert.deepEqual([a.group, a.reasons.map((x) => x.key)], ["working", ["idle"]], String(orchIdleMs));
  }
});

test("idle-ask: a working, blocked, gone or unknown orchestrator, or a working agent, never triggers it", () => {
  const r = run({ prs: [] });
  const keys = (o) => idle(r, { orchIdleMs: 60 * MIN, ...o }).reasons.map((x) => x.key);
  assert.deepEqual(keys({ orch: "working", working: true }), ["working"]);
  assert.deepEqual(keys({ orch: "blocked" }), ["question"]);
  assert.deepEqual(keys({ orch: "gone" }), ["gone"]);
  assert.deepEqual(keys({ orch: null }), ["idle"]);
  assert.deepEqual(keys({ working: true }), ["working"]);
  assert.equal(idleAsking(r, { orch: "idle", working: true, orchIdleMs: 60 * MIN }), false);
  // Harbormaster asks the budget question itself (data.js budgetPending).
  assert.deepEqual(keys({ budgetPending: true }), ["idle"]);
});

test("idle-ask: a waiting, blocked, finished, parked or closed run, or an open question, never triggers it", () => {
  const no = (r) => assert.equal(idle(r, { orchIdleMs: 60 * MIN }).reasons.some((x) => x.key === "idle-ask"), false, JSON.stringify(r.phase ?? r.away));
  no(run({ prs: [], phase: "waiting", statusLine: "waiting for user: which branch?" }));
  no(run({ prs: [], phase: "blocked", statusLine: "blocked: no access" }));
  no(run({ prs: [], phase: "finished", statusLine: "finished" }));
  no(run({ prs: [], away: { how: "parked", at: ago(10) } }));
  no(run({ prs: [], away: { how: "closed", at: ago(10) } }));
  no(run({ prs: [], question: "Which groups?", ask: { title: "Which groups?" }, askedAt: ago(3) }));
});

test("idle-ask with a quiet stall shows one entry, idle-ask; a CI stall stays beside it", () => {
  const a = idle(run({ prs: [] }), { orchIdleMs: 40 * MIN, stall: { quietMs: 40 * MIN, by: "quiet" } });
  assert.deepEqual([a.group, a.stall, a.reasons.map((x) => x.key)], ["needs", false, ["idle-ask"]]);
  const b = idle(run({ prs: [] }), { orchIdleMs: 40 * MIN, stall: { quietMs: 40 * MIN, by: "ci" } });
  assert.deepEqual(b.reasons.map((x) => x.key), ["idle-ask", "stalled"]);
});
