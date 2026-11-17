// How the Crew block shows a run's attention (crewrows.js): groups, order, detail line, edge and hover.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, runDot, STALL_MS } from "../../herdr-app/mods/harbormaster/attention.js";
import { needsYouNow } from "../../herdr-app/mods/harbormaster/attend.js";
import { decisionQueue } from "../../herdr-app/mods/harbormaster/data.js";
import { GROUPS, groupRows, rowLead, rowEdge, rowTip, badgeOf, needLine, closableDone, emptyNote, cantWhy, crewEntries, expandedNeed, canExpand, needKey, needCount, needRunsOf, runlessNeeds, captainNeedNote, watchingText, workerTree } from "../../herdr-app/mods/harbormaster/crewrows.js";

const MIN = 60000;
const now = Date.parse("2026-11-16T12:00:00Z");
const ago = (m) => now - m * MIN;

const run = (o = {}) => ({
  key: ":/r/x", dir: "/r/x", folder: "/p/skills", repo: "skills", phase: "running", statusLine: "running",
  progress: "watching CI", tasks: [], prs: [{ url: "u1" }], question: null, ask: null, askedAt: null, away: null,
  updated: ago(60), started: ago(300), ...o,
});
const pr = (o = {}) => ({
  number: 42, state: "OPEN", review: null, approvedBy: [], changesBy: [], requested: [], checks: { pass: 3, fail: 0, pending: 0 },
  url: "u1", repo: "o/skills", ci: { startedAt: ago(90), finishedAt: ago(80) }, reviewedAt: null, ...o,
});
const read = (list) => ({ list, readable: true, why: null });
const at = (r, o = {}) => assess(r, { orch: "idle", working: false, pr: read([pr()]), now, since: ago(20), ...o });

test("groups come in order Needs you, Working, Waiting on others, Can't tell, Done, and only Done folds", () => {
  assert.deepEqual(GROUPS.map((g) => g.key), ["needs", "working", "waiting", "cant", "done"]);
  assert.deepEqual(GROUPS.map((g) => g.title), ["Needs you", "Working", "Waiting on others", "Can't tell", "Done"]);
  assert.deepEqual(GROUPS.filter((g) => g.folded).map((g) => g.key), ["done"]);
});

test("groupRows sorts each group longest wait first and puts a row without a result under Can't tell", () => {
  const rows = [
    { id: "new", a: { group: "needs", waitSince: ago(5) } },
    { id: "old", a: { group: "needs", waitSince: ago(50) } },
    { id: "unknown", a: { group: "needs", waitSince: null } },
    { id: "w", a: { group: "working", waitSince: ago(1) } },
    { id: "r", a: { group: "waiting", waitSince: ago(1) } },
    { id: "c", a: { group: "cant", waitSince: ago(1) } },
    { id: "none", a: null },
    { id: "d", a: { group: "done", waitSince: ago(1) } },
  ];
  const g = groupRows(rows);
  assert.deepEqual(g.needs.map((x) => x.id), ["old", "new", "unknown"]);
  assert.deepEqual(g.working.map((x) => x.id), ["w"]);
  assert.deepEqual(g.waiting.map((x) => x.id), ["r"]);
  assert.deepEqual(g.cant.map((x) => x.id), ["c", "none"]);
  assert.deepEqual(g.done.map((x) => x.id), ["d"]);
});

test("a Needs you row leads with its reasons and how long the longest has waited, red", () => {
  const a = at(run({ phase: "finished" }), { pr: read([pr({ checks: { pass: 1, fail: 1, pending: 0 } })]) });
  assert.equal(a.group, "needs");
  const l = rowLead(a, now);
  // Red since its CI finished, 80 minutes ago.
  assert.equal(l.lead, "red CI on #42 · review proof · 1h20m");
  assert.equal(l.tone, "blocked");
  assert.equal(rowEdge(a), "blocked");
});

test("a question leads with its text", () => {
  const a = at(run({ question: "Which?", ask: { title: "Which database?" }, askedAt: ago(10), prs: [] }), { pr: read([]) });
  assert.equal(rowLead(a, now).lead, "Which database? · 10m");
  assert.match(rowTip(a, now)[0], /^Needs you: Which database\?, since 10m ago$/);
});

test("a stalled run is amber, says how quiet and what it was doing", () => {
  const stall = { quietMs: 34 * MIN, by: "quiet" };
  const a = at(run(), { working: true, stall, since: ago(34) });
  assert.equal(a.group, "needs");
  const l = rowLead(a, now);
  assert.equal(l.lead, "quiet 34m");
  assert.equal(l.rest, "watching CI");
  assert.equal(l.tone, "amber");
  assert.equal(rowEdge(a), "amber");
});

test("stalled with red CI as well stays red", () => {
  const stall = { quietMs: STALL_MS, by: "quiet" };
  const a = at(run(), { stall, pr: read([pr({ checks: { pass: 0, fail: 1, pending: 0 } })]) });
  assert.equal(rowEdge(a), "blocked");
  assert.equal(rowLead(a, now).tone, "blocked");
});

test("can't tell is grey, in a group of its own, with why in the hover", () => {
  const a = at(run(), { pr: { list: null, readable: false, why: "gh: could not resolve host" } });
  assert.equal(a.group, "cant");
  assert.deepEqual(rowLead(a, now), { lead: "can't tell: GitHub unreadable", rest: null, tone: "dim" });
  assert.equal(rowEdge(a), "dim");
  assert.ok(rowTip(a, now).includes("Can't tell: gh: could not resolve host"));
  const offline = at(run(), { filesOk: false });
  assert.equal(offline.group, "cant");
  assert.equal(rowLead(offline, now).lead, "can't tell: machine offline");
  assert.ok(rowTip(offline, now).includes("Can't tell: its machine did not answer"));
});

test("a question with unreadable PRs still needs you, and the hover says what can't be read", () => {
  const a = at(run({ question: "?", ask: { title: "Go on?" } }), { pr: { list: null, readable: false, why: "gh failed" } });
  assert.equal(a.group, "needs");
  assert.ok(rowTip(a, now).includes("Can't tell its pull requests: gh failed"));
});

test("while agents work, the step and its age lead, with no colour", () => {
  const a = at(run({ tasks: [{ id: "t3", state: "implementing" }] }), { working: true, stages: ["implement"], since: ago(72) });
  assert.equal(a.group, "working");
  assert.deepEqual(rowLead(a, now), { lead: "t3 implementing 1h12m", rest: null, tone: "muted" });
  assert.equal(rowEdge(a), "neutral");
  assert.ok(rowTip(a, now).includes("Current step: t3 implementing, for 1h12m"));
});

test("CI running leads with CI on the PR and its age", () => {
  const a = at(run(), { pr: read([pr({ checks: { pass: 1, fail: 0, pending: 2 }, ci: { startedAt: ago(34), finishedAt: null } })]) });
  assert.equal(rowLead(a, now).lead, "CI on #42 · 34m");
});

test("waiting on a reviewer: the label, then the step", () => {
  const a = at(run({ phase: "finished", progress: "done" }), { flow: "peer", pr: read([pr({ requested: ["anna"] })]) });
  assert.equal(a.group, "waiting");
  const l = rowLead(a, now);
  assert.equal(l.lead, "review from anna");
  assert.equal(l.rest, "done · 20m");
});

test("a review wait has a colour of its own, and its hover names the reviewers and the PRs", () => {
  const a = at(run({ phase: "finished", progress: "done" }), { flow: "peer",
    pr: read([pr({ number: 1799, requested: ["mfalkenbrink"] }), pr({ number: 1372, url: "u2", requested: ["mfalkenbrink"] })]) });
  assert.equal(a.group, "waiting");
  assert.equal(rowLead(a, now).lead, "review from mfalkenbrink · 2 PRs");
  assert.equal(rowEdge(a), "review");
  assert.equal(rowTip(a, now)[0], "Waiting for mfalkenbrink to review PR #1799 and #1372, since 20m ago");
  const two = at(run({ phase: "finished" }), { flow: "peer", pr: read([pr({ requested: ["anna", "bo"] })]) });
  assert.match(rowTip(two, now)[0], /^Waiting for anna and bo to review PR #42/);
});

test("one meaning per colour: work, CI and a brief idle are neutral; amber only for a stall", () => {
  const idle = at(run({ phase: "running" }), { flow: "peer", pr: read([]) , orch: "idle" });
  assert.equal(idle.reasons[0].key, "idle");
  assert.equal(idle.group, "working");
  assert.equal(rowEdge(idle), "neutral");
  // Briefly idle, not stalled yet: its step and age show how quiet it is.
  assert.equal(rowLead(idle, now).lead, "watching CI · 20m");
  const ci = at(run(), { pr: read([pr({ checks: { pass: 1, fail: 0, pending: 2 }, ci: { startedAt: ago(34), finishedAt: null } })]) });
  assert.equal(rowEdge(ci), "neutral");
  assert.equal(rowEdge(at(run(), { working: true })), "neutral");
  // CI past twice its usual time is a stall: amber, look soon.
  const slow = at(run(), { stall: { quietMs: 70 * MIN, by: "ci" }, pr: read([pr({ checks: { pass: 1, fail: 0, pending: 2 }, ci: { startedAt: ago(70), finishedAt: null } })]) });
  assert.equal(slow.group, "needs");
  assert.equal(rowEdge(slow), "amber");
  assert.equal(rowLead(slow, now).tone, "amber");
  // Red only where you must act; cyan for a reviewer.
  assert.equal(rowEdge(at(run({ phase: "finished" }), { pr: read([pr()]) })), "blocked");
  assert.equal(rowEdge(at(run({ phase: "finished" }), { flow: "peer", pr: read([pr({ requested: ["anna"] })]) })), "review");
});

test("Done shows merged — close run with the PR count", () => {
  const a = at(run({ phase: "finished" }), { pr: read([pr({ state: "MERGED" }), pr({ number: 43, state: "CLOSED" })]) });
  assert.equal(a.group, "done");
  assert.deepEqual(rowLead(a, now), { lead: "merged — close run · 2 PRs", rest: null, tone: "muted" });
  assert.equal(rowEdge(a), "done");
  assert.match(rowTip(a, now)[0], /^Done: every pull request merged or closed/);
  const closed = at(run({ away: { how: "closed", at: ago(5) } }));
  assert.equal(rowLead(closed, now).lead, "closed");
});

test("a card's pill says the next step in Needs you and Done, and keeps its phase otherwise", () => {
  const needs = at(run(), { pr: read([pr()]) });
  assert.equal(needs.group, "needs");
  assert.deepEqual(badgeOf(needs), { label: "review proof → merge", tone: "blocked" });
  const done = at(run({ phase: "finished" }), { pr: read([pr({ state: "MERGED" })]) });
  assert.deepEqual(badgeOf(done), { label: "merged — close run", tone: "done" });
  assert.equal(badgeOf(at(run(), { working: true })), null);
  const question = at(run({ question: "?", ask: { title: "Go?" }, prs: [] }), { pr: read([]) });
  assert.equal(badgeOf(question), null);
  assert.equal(badgeOf(null), null);
});

test("needLine says why a run needs you, and nothing outside Needs you", () => {
  const a = at(run(), { pr: read([pr({ checks: { pass: 0, fail: 1, pending: 0 } })]) });
  assert.equal(needLine(a), "red CI on #42 · review proof");
  assert.equal(needLine(at(run(), { working: true })), null);
});

test("a finished run waiting on a reviewer says so on its pill, in a neutral colour", () => {
  const a = at(run({ phase: "finished" }), { flow: "peer", pr: read([pr({ requested: ["anna"] }), pr({ number: 43, requested: ["anna"] })]) });
  assert.equal(a.group, "waiting");
  assert.deepEqual(badgeOf(a, true), { label: "review from anna · 2 PRs", tone: "muted" });
  // A run still running keeps its phase.
  assert.equal(badgeOf(a, false), null);
  // Can't tell: no label to show, so the pill keeps "Finished".
  assert.equal(badgeOf(at(run({ phase: "finished" }), { pr: { list: null, readable: false, why: "gh failed" } }), true), null);
});

test("Close all merged takes only Done runs whose PRs are all merged or closed, open, without a question, not busy", () => {
  const merged = (o = {}) => ({ r: run({ phase: "finished", ...o }), a: null });
  const rows = [merged({ key: "a" }), merged({ key: "b" }), merged({ key: "c", away: { how: "closed", at: ago(5) } }), merged({ key: "d" })]
    .map((x) => ({ ...x, a: at(x.r, { pr: read([pr({ state: "MERGED" })]) }) }));
  rows.push({ r: null, a: rows[0].a });
  rows[3].r.question = "?";
  // A question keeps it out of Done altogether; closableDone also refuses it.
  rows[3].a = { ...rows[0].a };
  assert.deepEqual(closableDone(rows).map((r) => r.key), ["a", "b"]);
  assert.deepEqual(closableDone(rows, { b: { label: "Closing…" } }).map((r) => r.key), ["a"]);
  // Not Done, or Done only because it is closed: never.
  assert.deepEqual(closableDone([{ r: run(), a: at(run(), { pr: read([pr()]) }) }]), []);
  // A finished run with no PR is in Needs you, not Done: never closed by it.
  const report = run({ key: "f", phase: "finished", prs: [] });
  const ra = at(report, { pr: read([]) });
  assert.equal(ra.group, "needs");
  assert.deepEqual(closableDone([{ r: report, a: ra }]), []);
  assert.deepEqual(rowLead(ra, now), { lead: "finished — read and close · 1h0m", rest: null, tone: "blocked" });
  assert.deepEqual(badgeOf(ra, true), { label: "finished — read and close", tone: "blocked" });
  // A running run is never closed by it, even if something hands it a Done result.
  assert.deepEqual(closableDone([{ r: run({ key: "e" }), a: rows[0].a }]), []);
  assert.notEqual(at(run(), { pr: read([pr({ state: "MERGED" })]) }).group, "done");
});

test("an empty Needs you says nothing is for you, only while there are orchestrators and nothing counts", () => {
  const needs = GROUPS[0];
  assert.equal(emptyNote(needs, 0, 2), "nothing for you right now 🎉");
  assert.equal(emptyNote(needs, 1, 2), null);
  assert.equal(emptyNote(needs, 0, 0), null);
  assert.equal(emptyNote(GROUPS[1], 0, 2), null);
  assert.equal(emptyNote(GROUPS[2], 0, 2), null);
});

test("can't tell says why in a few words", () => {
  assert.equal(cantWhy({ why: "its machine did not answer" }), "machine offline");
  assert.equal(cantWhy({ why: "its run files could not be read" }), "no run files");
  assert.equal(cantWhy({ why: "pull requests not read yet" }), "PRs not read yet");
  assert.equal(cantWhy({ why: "gh: could not resolve host" }), "GitHub unreadable");
  assert.equal(cantWhy({ why: "the pull request read is stale" }), "GitHub unreadable");
  assert.equal(cantWhy({}), "GitHub unreadable");
});

test("the Crew's Needs you count is the overview's, for the same facts", () => {
  // The overview's header: needCount(the runs needsYouNow picks, the orchestrators, the
  // captain's open decisions). The Crew: its Needs you rows plus the same decisions.
  const live = run({ key: "live", terminal: "w:1", tasks: [{ id: "t1", state: "implementing" }] });
  const gone = run({ key: "gone", terminal: "w:2" });
  const asked = run({ key: "asked", terminal: "w:3", question: "?", ask: { title: "Go?" }, prs: [] });
  const parked = run({ key: "parked", terminal: "w:4", away: { how: "parked", at: ago(5) } });
  // A question read from a stale read (its machine missed a poll): Can't tell, counted nowhere.
  const stale = run({ key: "box:/stale", machine: "box", terminal: "w:5", stale: true, question: "?", ask: { title: "Which DB?", options: [] }, prs: [] });
  const atts = new Map([
    [live, at(live, { working: true, stages: ["implement"] })],
    [gone, at(gone, { orch: "gone", pr: read([]) })],
    [asked, at(asked, { pr: read([]) })],
    [parked, at(parked, { pr: read([pr({ checks: { pass: 0, fail: 1, pending: 0 } })]) })],
    [stale, at(stale, { orch: "gone", pr: read([]), filesOk: false })],
  ]);
  assert.equal(atts.get(gone).group, "needs");
  assert.equal(atts.get(parked).group, "needs", "assess judges its PRs whether parked or not");
  assert.equal(atts.get(stale).group, "cant");
  // As the overview's cards, header and the Crew all pick them (crewrows.js needRunsOf), the
  // same rule as attend.js needsYouNow for each run.
  const needRuns = needRunsOf([...atts.keys()], (r) => atts.get(r));
  for (const [r, a] of atts) assert.equal(needsYouNow(r, null, a), needRuns.includes(r), r.key);
  assert.deepEqual(needRuns.map((r) => r.key).sort(), ["asked", "gone"]);
  // The overview's Waiting on you queue doesn't list the stale run's question either (no
  // terminals: every orchestrator reads as gone; `fresh` stands in for attend.js filesFresh).
  const queued = decisionQueue([...atts.keys()], [], { terminals: [], agents: [] }, (r) => !r.stale);
  assert.deepEqual(queued.filter((x) => x.kind === "run").map((x) => x.run.key), ["asked"]);
  const blockedTerm = { term: { address: "w:9" }, r: null, a: assess(null, { orch: "blocked", now }) };
  // Live orchestrators: the gone run's is not among them.
  const orchs = [live, asked, parked].map((r) => ({ term: { address: r.terminal }, r, a: atts.get(r) })).concat([blockedTerm]);
  const entries = crewEntries(orchs, needRuns, (r) => atts.get(r));
  const groups = groupRows(entries);
  for (const decisions of [0, 2]) {
    assert.equal(groups.needs.length + decisions, needCount(needRuns, orchs, decisions));
  }
  assert.deepEqual(groups.needs.map((x) => x.r?.key ?? x.term.address).sort(), ["asked", "gone", "w:9"]);
  // The gone run has a row of its own, with no terminal, leading with why.
  const goneRow = entries.find((x) => x.r === gone);
  assert.equal(goneRow.term, null);
  assert.match(rowLead(goneRow.a, now).lead, /^orchestrator gone · /);
  // A parked run's orchestrator row is not counted, so it is not under Needs you either.
  assert.equal(entries.find((x) => x.r === parked).a.group, "working");
  assert.deepEqual(runlessNeeds(orchs), [blockedTerm]);
  // No run needs you, but the captain asks: the heading counts it, and says where it is.
  assert.equal(needCount([], [], 1), 1);
  assert.equal(emptyNote(GROUPS[0], needCount([], [], 1), 3), null);
  assert.equal(captainNeedNote(1), "+ the captain's decision, above");
  assert.equal(captainNeedNote(2), "+ the captain's 2 decisions, above");
  assert.equal(captainNeedNote(0), null);
});

test("the captain says how many runs it watches, then how many of them are finished", () => {
  assert.equal(watchingText(1, 1), "watching 2 runs · 1 finished");
  assert.equal(watchingText(1, 0), "watching 1 run");
  assert.equal(watchingText(0, 0), "watching 0 runs");
});

test("a working row names its longest-running task with its own age, and the rest as tasks", () => {
  const tasks = [{ id: "t4", state: "implementing" }, { id: "t9", state: "implementing" }, { id: "t10", state: "review" }];
  const ages = { "t:t4:implementing:implement": ago(65), "t:t9:implementing:implement": ago(5), "t:t10:review:review": ago(2) };
  const a = at(run({ tasks }), { working: true, stages: ["implement", "implement", "review"], since: ago(0), ages });
  assert.equal(rowLead(a, now).lead, "t4 implementing 1h5m · +2 tasks");
  assert.ok(rowTip(a, now).includes("Current step: t4 implementing, for 1h5m (2 more tasks at work)"));
  // Working sorts by that age: the run whose task is at it longest first.
  assert.equal(a.waitSince, ago(65));
});

test("the group split: working (agents, CI, briefly idle), waiting on a reviewer, can't tell", () => {
  const ciPr = pr({ checks: { pass: 1, fail: 0, pending: 2 }, ci: { startedAt: ago(34), finishedAt: null } });
  const cases = [
    [at(run(), { working: true }), "working", "working"],
    [at(run(), { pr: read([ciPr]) }), "working", "ci-running"],
    [at(run(), { pr: read([]) }), "working", "idle"],
    [at(run({ phase: "finished" }), { flow: "peer", pr: read([pr({ requested: ["anna"] })]) }), "waiting", "waiting-for"],
    [at(run(), { pr: { list: null, readable: false, why: "gh failed" } }), "cant", "cant-tell"],
    [at(run(), { filesOk: false }), "cant", "cant-tell"],
    [assess(null, { now }), "cant", "cant-tell"],
  ];
  for (const [a, group, key] of cases) assert.deepEqual([a.group, a.reasons[0].key], [group, key]);
  // Agents working beat a reviewer request: it is the run's turn.
  assert.equal(at(run(), { working: true, flow: "peer", pr: read([pr({ requested: ["anna"] })]) }).group, "working");
  // Unreadable state never goes under Needs you on that account, and never mixes into Working.
  assert.equal(at(run(), { working: true, pr: { list: null, readable: false, why: "x" } }).group, "cant");
});

test("a run's dot works while its orchestrator or any agent works, and is blocked if any is blocked", () => {
  // The regression: the orchestrator idle between turns while five agents implement.
  assert.equal(runDot("idle", ["working", "working", "working", "working", "working"]), "working");
  assert.equal(runDot("working", []), "working");
  assert.equal(runDot("idle", ["idle", "done"]), "idle");
  assert.equal(runDot("idle", ["working", "blocked"]), "blocked");
  assert.equal(runDot("blocked", ["working"]), "blocked");
  assert.equal(runDot("idle", [], { ciRunning: true }), "working");
  assert.equal(runDot("gone", [], { ciRunning: true }), "gone");
  assert.equal(runDot("gone", ["working"]), "working");
  assert.equal(runDot("done"), "done");
});

test("the Needs-you box opens the clicked entry while it still needs you, else the first with a run directory, else none", () => {
  const e = (key, dir = "/r/" + key) => ({ r: { key, dir }, term: { address: "t" + key }, a: {} });
  const list = [e("a"), e("b"), e("c")];
  assert.equal(expandedNeed(list, "b"), list[1]);
  assert.equal(expandedNeed(list, "gone"), list[0], "a clicked run that left Needs you falls back to the first");
  assert.equal(expandedNeed(list, undefined), list[0]);
  const runless = { r: null, term: { address: "t9" }, a: {} };
  assert.equal(expandedNeed([runless, list[1]], null), list[1], "an orchestrator without a run directory stays a compact row");
  assert.equal(expandedNeed([runless], "t9"), null);
  assert.equal(expandedNeed([], "a"), null);
  assert.equal(needKey(runless), "t9");
  assert.equal(needKey(list[0]), "a");
});

test("only entries with a run directory open on click in the Needs-you box; a runless orchestrator keeps its focus click", () => {
  assert.equal(canExpand({ r: { key: "a", dir: "/r/a" }, term: { address: "t1" } }), true);
  assert.equal(canExpand({ r: null, term: { address: "t9" } }), false, "blocked on a dialog: no run to open");
  assert.equal(canExpand({ r: { key: "b" }, term: null }), false);
});

test("workerTree: each parent is followed by its children, with depth, guides and last", () => {
  const w = (address, parent) => ({ address, parent });
  // Depth-first from workersOf: a, its server b and build c (c has a child d), then e; orphan f.
  const list = [w("a", "O"), w("b", "a"), w("c", "a"), w("d", "c"), w("e", "O"), w("f", "gone")];
  const rows = workerTree(list, "O").map((x) => [x.w.address, x.depth, x.last, x.guides]);
  assert.deepEqual(rows, [
    ["a", 0, false, []], ["b", 1, false, []], ["c", 1, true, []], ["d", 2, true, [false]],
    ["e", 0, false, []], ["f", 0, true, []],
  ]);
});

test("workerTree: a guide continues past an ancestor that has later siblings", () => {
  const w = (address, parent) => ({ address, parent });
  const rows = workerTree([w("a", "O"), w("b", "a"), w("c", "b"), w("d", "a")], "O");
  assert.deepEqual(rows.map((x) => [x.w.address, x.depth, x.guides]), [["a", 0, []], ["b", 1, []], ["c", 2, [true]], ["d", 1, []]]);
});
