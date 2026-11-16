// The Needs you rules (attention.js), the stores behind them (tracking.js) and the PR summary
// fields they read (data.js prSummary).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reviewFlow, flowKey, prStep, nextStep, nextStepText, prRead, ciState, ciTimes, usualCi, ageText, stepOf, stepText,
  trackSince, stepSig, stalled, quietText, assess, byWait, STALL_MS, prMaxAge, prTtl,
} from "../../herdr-app/mods/harbormaster/attention.js";
import { addCiSample, nextSteps, screenSig, CI_KEEP, probeEvery } from "../../herdr-app/mods/harbormaster/tracking.js";
import { prSummary, PR_FIELDS, carryRuns } from "../../herdr-app/mods/harbormaster/data.js";
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

test("the review flow defaults to self, snevagten to peer, and a setting overrides both", () => {
  assert.equal(reviewFlow(run()), "self");
  assert.equal(reviewFlow(run({ folder: "/home/u/projects/snevagten" })), "peer");
  assert.equal(reviewFlow(run({ folder: "/home/u/projects/snevagten/" }), { snevagten: "self" }), "self");
  assert.equal(reviewFlow(run(), { skills: "peer" }), "peer");
  assert.equal(reviewFlow(run(), { skills: "bogus" }), "self");
  assert.equal(flowKey({ folder: "", repo: "omhu" }), "omhu");
});

// ---- labels ----

test("peer labels: request review, waiting for, changes requested, approved — merge", () => {
  assert.equal(prStep(pr({ state: "DRAFT", requested: ["anna"] }), "peer").label, "request review");
  assert.equal(prStep(pr(), "peer").label, "request review");
  const w = prStep(pr({ requested: ["anna"] }), "peer");
  assert.deepEqual([w.label, w.who], ["waiting for", ["anna"]]);
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
  assert.equal(nextStepText(w), "waiting for anna, bo · 2 PRs");
  assert.equal(nextStepText(nextStep([pr({ requested: ["anna"] })], "peer")), "waiting for anna");
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

test("Everything else: agents working, a reviewer requested and not answered, CI running, idle", () => {
  const r = run();
  const w = assess(r, { orch: "working", working: true, pr: read([pr()]), now, flow: "peer" });
  assert.deepEqual([w.group, w.reasons[0].key], ["else", "working"]);
  // Working wins over PR grounds and red CI: it is the run's turn.
  assert.equal(assess(r, { working: true, pr: read([pr({ checks: checks(0, 1) })]), now }).group, "else");
  const wf = settled(run({ phase: "finished" }), [pr({ requested: ["anna"] })], { flow: "peer" });
  assert.deepEqual([wf.group, wf.reasons[0].key, wf.reasons[0].text], ["else", "waiting-for", "waiting for anna"]);
  const ci = settled(run({ phase: "finished" }), [pr({ checks: checks(2, 0, 1), ci: { startedAt: ago(10), finishedAt: null } })], { flow: "self" });
  assert.deepEqual([ci.group, ci.reasons[0].key], ["else", "ci-running"]);
  assert.equal(settled(run({ prs: [] }), []).reasons[0].key, "idle");
});

test("can't tell: gh failing, never in Needs you on PR grounds", () => {
  const fin = run({ phase: "finished" });
  const a = assess(fin, { orch: "idle", pr: { list: [pr({ approvedBy: ["a"], stale: true })], readable: false, why: "gh could not read u1" }, now, flow: "peer" });
  assert.deepEqual([a.group, a.cantTell, a.why, a.reasons[0].key], ["else", true, "gh could not read u1", "cant-tell"]);
  const red = assess(fin, { orch: "idle", pr: { list: [pr({ checks: checks(0, 2) })], readable: false, why: "stale" }, now });
  assert.equal(red.group, "else");
});

test("can't tell: the machine is offline or the run files are a stale read", () => {
  const off = assess(run(), { orch: "idle", pr: read([pr({ approvedBy: ["a"] })]), filesOk: false, now, flow: "peer" });
  assert.deepEqual([off.group, off.cantTell], ["else", true]);
  const none = assess(null, { orch: null, now });
  assert.deepEqual([none.group, none.cantTell], ["else", true]);
  // A dialog on screen is a live fact: it still needs you.
  assert.equal(assess(null, { orch: "blocked", now }).group, "needs");
});

test("Done: every PR merged or closed and nothing at work; a closed run", () => {
  const fin = run({ phase: "finished", updated: ago(100) });
  const d = settled(fin, [pr({ state: "MERGED" }), pr({ number: 43, state: "CLOSED" })]);
  assert.deepEqual([d.group, d.next.label, d.next.count, d.waitSince], ["done", "merged — close run", 2, ago(100)]);
  // Still working (a next PR may come), or asking: not done.
  assert.equal(assess(run(), { working: true, pr: read([pr({ state: "MERGED" })]), now }).group, "else");
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
  assert.equal(ageText(-5), "0m");
});

test("the current step: tasks at work, else CI on a PR, else the progress line", () => {
  const tasks = [{ id: "t1", state: "merged" }, { id: "t3", state: "implementing" }, { id: "t4", state: "review" }];
  const s = stepOf(run({ tasks }), { stages: ["done", "implement", "review"], since: ago(72) });
  assert.equal(stepText(s, now), "t3 implementing +1 · 1h12m");
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

test("a closed run's PRs, read every 15 minutes, do not go stale between reads", () => {
  assert.equal(prTtl(true), 15 * MIN);
  const entry = { at: ago(14), list: [pr({ state: "MERGED" })] };
  // Open, a 14-minute-old read means the refresh is stuck; closed, it is on schedule.
  assert.equal(prRead(run(), entry, now, false).readable, false);
  assert.equal(prRead(run({ phase: "finished" }), entry, now, true).readable, true);
  assert.equal(prRead(run(), { ...entry, at: now - prMaxAge(true) - 1 }, now, true).readable, false);
});

test("peer: a reviewer asked again waits, even after their change request or approval", () => {
  const again = pr({ review: "CHANGES_REQUESTED", changesBy: ["anna"], requested: ["anna"] });
  const s = prStep(again, "peer");
  assert.deepEqual([s.label, s.who], ["waiting for", ["anna"]]);
  assert.equal(prStep(pr({ review: "APPROVED", approvedBy: ["anna"], requested: ["anna"] }), "peer").label, "waiting for");
  // Someone else's change request still stands.
  assert.equal(prStep(pr({ changesBy: ["anna", "bo"], requested: ["anna"] }), "peer").label, "changes requested");
  // The repo's reviewDecision counts when no reviewer's review stands and nobody is asked.
  assert.equal(prStep(pr({ review: "CHANGES_REQUESTED" }), "peer").label, "changes requested");
  const g = settled(run({ phase: "finished" }), [again], { flow: "peer" });
  assert.deepEqual([g.group, g.reasons[0].text], ["else", "waiting for anna"]);
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
  assert.deepEqual([g.group, g.cantTell], ["else", true]);
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

test("a quiet wait on CI inside its usual time is not a stall; without a baseline the quiet rule applies", () => {
  const prs = [pr({ checks: checks(0, 0, 3), ci: { startedAt: ago(35), finishedAt: null } })];
  assert.equal(stalled(run(), { now, lastActivity: ago(35), prs, ciUsual: 40 * MIN }), false);
  assert.deepEqual(stalled(run(), { now, lastActivity: ago(35), prs, ciUsual: null }), { quietMs: 35 * MIN, by: "quiet" });
});

test("screens of a stalled run are read every 5 minutes, not every minute", () => {
  assert.equal(probeEvery(26 * MIN), MIN);
  assert.equal(probeEvery(STALL_MS), 5 * MIN);
});
