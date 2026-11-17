// What a Needs-you box says to do (needaction.js needActions), one line and its buttons per
// reason, from real assess() results; the first failing check data.js keeps for it; and the
// red-CI ask's message (blocking.js ciRequest).
// Run: node --import ./loader.mjs --test needaction.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess } from "../../herdr-app/mods/harbormaster/attention.js";
import { needActions, doLine, proofText, runReports, MAX_OPEN, ownAddressRows } from "../../herdr-app/mods/harbormaster/needaction.js";
import { firstFailing, prSummary } from "../../herdr-app/mods/harbormaster/data.js";
import { ciRequest, BLOCKING } from "../../herdr-app/mods/harbormaster/blocking.js";

const MIN = 60000;
const now = Date.parse("2026-11-16T12:00:00Z");
const ago = (m) => now - m * MIN;

const run = (o = {}) => ({
  key: ":/r/skills/x", dir: "/r/skills/x", folder: "/home/u/projects/skills", repo: "skills", phase: "running",
  statusLine: "running", progress: "t1 implementing", tasks: [], prs: [{ url: "u1" }], question: null, ask: null,
  askedAt: null, away: null, updated: ago(60), started: ago(300), terminal: "w/orch", ...o,
});
const checks = (pass = 0, fail = 0, pending = 0) => ({ pass, fail, pending });
const pr = (o = {}) => ({
  number: 42, state: "OPEN", review: null, approvedBy: [], changesBy: [], requested: [], checks: checks(3),
  url: "https://github.com/o/skills/pull/42", repo: "o/skills", ci: { startedAt: ago(90), finishedAt: ago(80) }, reviewedAt: null, ...o,
});
const read = (list) => ({ list, readable: true, why: null });
// A run's attention, as attend.js gives it, and its box's items.
const att = (r, list, o = {}) => assess(r, { orch: "idle", working: false, pr: read(list), now, ...o });
const items = (r, list, o = {}, ctx = {}) => needActions(att(r, list, o), { run: r, prs: list, now, ...ctx });
const kinds = (it) => it.actions.map((a) => a.kind);

test("approved — merge names the PRs, who approved and when, with a Merge on GitHub button for each", () => {
  const list = [pr({ approvedBy: ["mfalkenbrink"], review: "APPROVED", reviewedAt: ago(65) }),
    pr({ number: 1372, url: "https://github.com/o/skills/pull/1372", approvedBy: ["mfalkenbrink"], review: "APPROVED", reviewedAt: ago(70) })];
  const [it] = items(run({ folder: "/p/snevagten" }), list, { flow: "peer" });
  assert.equal(it.key, "approved — merge");
  assert.equal(it.line, "Merge #42 and #1372 · approved by mfalkenbrink 1h5m ago");
  assert.deepEqual(it.actions, [
    { kind: "open", label: "Merge #42 on GitHub", url: list[0].url, primary: true },
    { kind: "open", label: "Merge #1372 on GitHub", url: list[1].url, primary: true },
  ]);
});

test("approved with open comments says to address them, then merge", () => {
  const comments = { count: 2, threads: 1, notes: 1, bots: {}, items: [] };
  const [it] = items(run(), [pr({ approvedBy: ["anna"], review: "APPROVED", comments })], { flow: "peer" });
  assert.equal(it.line, "Approved by anna with 1 thread, 1 note on #42: address them, then merge");
  assert.deepEqual(kinds(it), ["open"]);
});

test("review proof → merge points at the proof first, then the PR", () => {
  const [it] = items(run(), [pr()], { flow: "self" }, { proof: { tier: 2, pass: 5, total: 10 } });
  assert.equal(it.line, "Read the proof (T2 · 5/10 pass), then merge #42");
  assert.deepEqual(it.actions.map((a) => a.label), ["Proof", "Open #42"]);
  // Without proof to read, the PR is what there is to review.
  const [bare] = items(run(), [pr()], { flow: "self" });
  assert.equal(bare.line, "Review #42, then merge it");
  assert.deepEqual(kinds(bare), ["open"]);
});

test("review proof never says merge while CI is red, and a draft is marked ready first", () => {
  const proof = { proof: { tier: 1, pass: 0, total: 2 } };
  const red = items(run(), [pr({ checks: checks(2, 1), failed: { name: "lint", url: null } })], { flow: "self" }, proof);
  assert.deepEqual(red.map((x) => x.key), ["red-ci", "review proof → merge"]);
  assert.equal(red[1].line, "Read the proof (T1 · 0/2 pass)");
  const draft = items(run(), [pr({ state: "DRAFT" })], { flow: "self" }, proof);
  assert.equal(draft[0].line, "Read the proof (T1 · 0/2 pass), then mark #42 ready and merge");
  const [bare] = items(run(), [pr({ state: "DRAFT" })], { flow: "self" });
  assert.equal(bare.line, "Review #42, then mark it ready and merge");
});

test("request review says why: a draft, or nobody requested", () => {
  const [draft] = items(run(), [pr({ state: "DRAFT" })], { flow: "peer" });
  assert.equal(draft.line, "Ask for a review on #42 (a draft)");
  const [none] = items(run(), [pr()], { flow: "peer" });
  assert.equal(none.line, "Ask for a review on #42 (nobody requested)");
  assert.deepEqual(none.actions, [{ kind: "open", label: "Open #42", url: pr().url }]);
});

test("changes requested names who asked, with their comments, and opens the PR", () => {
  const [it] = items(run(), [pr({ changesBy: ["anna"], review: "CHANGES_REQUESTED", reviewedAt: ago(30), comments: { count: 2, threads: 1, notes: 1, bots: {}, items: [] } })], { flow: "peer" });
  assert.equal(it.line, "anna asked for changes on #42 · 1 thread, 1 note · 30m ago");
  assert.deepEqual(kinds(it), ["open"]);
  // An unknown reviewer (GitHub's own decision only) is "A reviewer".
  const [anon] = items(run(), [pr({ review: "CHANGES_REQUESTED" })], { flow: "peer" });
  assert.match(anon.line, /^A reviewer asked for changes on #42/);
});

test("red CI names the first failing check, opens it and offers to ask the orchestrator", () => {
  const red = pr({ checks: checks(2, 3), failed: { name: "lint", url: "https://github.com/o/skills/actions/runs/1" } });
  const list = items(run(), [red], { flow: "self" });
  assert.equal(list[0].key, "red-ci");
  assert.equal(list[0].line, "CI failed on #42: lint (+2 more)");
  assert.deepEqual(list[0].actions, [
    { kind: "open", label: "Open the failing check", url: "https://github.com/o/skills/actions/runs/1" },
    { kind: "ask-ci", label: "Ask the orchestrator", pr: red, check: "lint" },
  ]);
  // Its PR's label comes after it.
  assert.equal(list[1].key, "review proof → merge");
});

test("red CI without a check URL opens the PR's checks tab; without a name says only CI failed", () => {
  const [it] = items(run(), [pr({ checks: checks(0, 1), failed: { name: null, url: null } })], { flow: "self" });
  assert.equal(it.line, "CI failed on #42");
  assert.equal(it.actions[0].url, "https://github.com/o/skills/pull/42/checks");
});

test("a stalled run says how long it is quiet and at what, with Ask what's blocking", () => {
  const r = run({ updated: ago(40) });
  const [it] = needActions(assess(r, { orch: "idle", working: false, pr: read([]), now, stall: { quietMs: 34 * MIN, by: "quiet" } }), { run: r, now });
  assert.equal(it.line, "Quiet 34m at t1 implementing: ask what's blocking it");
  assert.deepEqual(kinds(it), ["ask-blocking"]);
});

test("finished with no PR: read the run's report, then close; without one, the orchestrator's final report", () => {
  const r = run({ phase: "finished", prs: [] });
  const [it] = items(r, [], {}, { reports: ["/r/skills/x/shared/final-report.md"] });
  assert.equal(it.line, "Finished: read its report, then close the run");
  assert.deepEqual(it.actions, [{ kind: "report", label: "Report", path: "/r/skills/x/shared/final-report.md" }, { kind: "close", label: "Close" }]);
  const [bare] = items(r, []);
  assert.equal(bare.line, "Finished: read its final report in the orchestrator, then close the run");
  assert.deepEqual(bare.actions, [{ kind: "focus", label: "Open the orchestrator", address: "w/orch" }, { kind: "close", label: "Close" }]);
  // Only task reports in shared/ (as every orchestrator run leaves): not the run's report.
  const [tasks] = items(r, [], {}, { reports: ["shared/t1-report.md", "shared/t10-report.md", "shared/t11-review-1.md"] });
  assert.equal(tasks.line, bare.line);
  assert.deepEqual(kinds(tasks), ["focus", "close"]);
  // No terminal known: Close alone.
  const [lost] = items(run({ phase: "finished", prs: [], terminal: null }), []);
  assert.deepEqual(kinds(lost), ["close"]);
});

test("runReports keeps the run's own reports, the final one first, never a task's", () => {
  assert.deepEqual(runReports(["shared/t1-report.md", "shared/report.md", "shared/t2_report.md", "shared/final-report.md", "shared/notes.md", "shared/review-2.md", "shared/T3.report.md", "shared/report.txt"]),
    ["shared/final-report.md", "shared/report.md", "shared/review-2.md"]);
  assert.deepEqual(runReports(["shared/run-final-report.md"]), ["shared/run-final-report.md"]);
  assert.deepEqual(runReports(undefined), []);
});

test("a gone orchestrator says to resume, park or close, with Resume", () => {
  const [it] = items(run(), [], { orch: "gone" });
  assert.equal(it.key, "gone");
  assert.deepEqual(kinds(it), ["resume"]);
});

test("a dialog names the agent it waits in and opens that agent", () => {
  const r = run();
  const [it] = needActions(assess(r, { orch: "blocked", pr: read([]), now }), { run: r, now, blocked: { name: "impl-x-t3", address: "w/t3" } });
  assert.equal(it.line, "impl-x-t3 is waiting on a prompt");
  assert.deepEqual(it.actions, [{ kind: "focus", label: "Open impl-x-t3", address: "w/t3" }]);
  // Not known which: the orchestrator.
  const [orch] = needActions(assess(r, { orch: "blocked", pr: read([]), now }), { run: r, now });
  assert.equal(orch.line, "The orchestrator is waiting on a prompt");
  assert.deepEqual(orch.actions, [{ kind: "focus", label: "Open the orchestrator", address: "w/orch" }]);
});

test("a plan waiting for the user without a question.md says its reason", () => {
  const r = run({ phase: "waiting", statusLine: "waiting for user: pick a name" });
  const [it] = items(r, []);
  assert.equal(it.line, "Waiting for you: pick a name");
  assert.deepEqual(kinds(it), ["focus"]);
});

test("missing data: a PR without a number or URL still reads, and gets no Open button", () => {
  const [it] = items(run(), [pr({ number: null, url: null, approvedBy: [], review: "APPROVED" })], { flow: "peer" });
  assert.equal(it.line, "Merge the PR · approved");
  assert.deepEqual(it.actions, []);
});

test("several PRs: at most MAX_OPEN Open buttons", () => {
  const list = [1, 2, 3, 4, 5].map((n) => pr({ number: n, url: `https://github.com/o/skills/pull/${n}` }));
  const [it] = items(run(), list, { flow: "self" });
  assert.equal(it.line, "Review #1, #2, #3, #4 and #5, then merge them");
  assert.equal(it.actions.length, MAX_OPEN);
});

test("a run not in Needs you has no items; the Crew hover's line is the first item's", () => {
  assert.deepEqual(items(run(), [pr({ requested: ["anna"] })], { flow: "peer" }), []);
  assert.deepEqual(needActions(null), []);
  const list = items(run(), [pr()], { flow: "peer" });
  assert.equal(doLine(list), "Do: Ask for a review on #42 (nobody requested)");
  assert.equal(doLine([]), null);
});

test("proofText: tier and pass count, either alone, or null", () => {
  assert.equal(proofText({ tier: 2, pass: 5, total: 10 }), "T2 · 5/10 pass");
  assert.equal(proofText({ tier: null, pass: 0, total: 3 }), "0/3 pass");
  assert.equal(proofText({ tier: 1, pass: 0, total: 0 }), "T1");
  assert.equal(proofText({ tier: null, pass: 0, total: 0 }), null);
  assert.equal(proofText(null), null);
});

test("the first failing check: a check run's name and page, a status's context and target", () => {
  assert.deepEqual(firstFailing([{ name: "ok", conclusion: "SUCCESS" }, { name: "lint", conclusion: "FAILURE", detailsUrl: "https://x/1" }]), { name: "lint", url: "https://x/1" });
  assert.deepEqual(firstFailing([{ context: "ci/legacy", state: "ERROR", targetUrl: "https://x/2" }]), { name: "ci/legacy", url: "https://x/2" });
  assert.deepEqual(firstFailing([{ conclusion: "FAILURE" }]), { name: null, url: null });
  assert.equal(firstFailing([{ name: "ok", conclusion: "SUCCESS" }]), null);
  assert.equal(firstFailing(null), null);
  const s = prSummary({ number: 1, state: "OPEN", url: "https://github.com/o/r/pull/1", statusCheckRollup: [{ name: "test", conclusion: "FAILURE", detailsUrl: "https://x/3" }] });
  assert.deepEqual(s.failed, { name: "test", url: "https://x/3" });
});

test("the red-CI ask is a what-is-blocking message naming the PR, the check and its page", () => {
  const m = ciRequest({ pr: 42, check: "lint", url: "https://x/1" });
  assert.ok(BLOCKING.test(m));
  assert.equal(m.split("\n")[0], "what is blocking? Harbormaster sees CI red on #42 (failing: lint): https://x/1.");
  assert.equal(ciRequest({ pr: null }).split("\n")[0], "what is blocking? Harbormaster sees CI red on the PR.");
});

// ---- t15: the box carries Address comments, a failed proof is never merged past ----

const here = (o = {}) => run({ localTerminal: "w/orch", ...o });
const said = (count, notes = 0) => ({ count, threads: count - notes, notes, bots: {}, items: [] });

test("approved with comments: the box has Ask me and Handle them, the autonomy's default first-class, then Open, and the age", () => {
  const p = pr({ approvedBy: ["anna"], review: "APPROVED", reviewedAt: ago(85), comments: said(3, 1) });
  const [it] = items(here(), [p], { flow: "peer" });
  assert.equal(it.line, "Approved by anna 1h25m ago with 2 threads, 1 note on #42: address them, then merge");
  assert.deepEqual(it.actions.map((a) => [a.kind, a.label, a.primary ?? null]),
    [["address", "Ask me", true], ["address", "Handle them", false], ["open", "Open #42", null]]);
  assert.deepEqual(it.actions.slice(0, 2).map((a) => [a.mode, a.pr]), [["ask", p], ["handle", p]]);
  // At L2 the orchestrator handles them by default.
  const [l2] = items(here({ autonomy: "L2" }), [p], { flow: "peer" });
  assert.deepEqual(l2.actions.filter((a) => a.primary).map((a) => a.label), ["Handle them"]);
});

test("with several PRs each one's buttons carry the PR they are about; one without comments only opens", () => {
  const list = [pr({ approvedBy: ["anna"], review: "APPROVED", comments: said(15) }),
    pr({ number: 1372, url: "https://github.com/o/skills/pull/1372", approvedBy: ["anna"], review: "APPROVED", comments: said(0) })];
  const [it] = items(here(), list, { flow: "peer" });
  assert.deepEqual(it.actions.map((a) => [a.label, a.row]), [
    ["Ask me", "#42 · 15 threads"], ["Handle them", "#42 · 15 threads"], ["Open #42", "#42 · 15 threads"], ["Open #1372", "#1372"],
  ]);
});

test("changes requested with comments offers Address too; a run that can't be asked only opens", () => {
  const p = pr({ changesBy: ["bo"], review: "CHANGES_REQUESTED", comments: said(2) });
  const [it] = items(here(), [p], { flow: "peer" });
  assert.equal(it.key, "changes requested");
  assert.deepEqual(kinds(it), ["address", "address", "open"]);
  // Not here (no local terminal), put away, or with an open question: Open only.
  assert.deepEqual(kinds(items(run(), [p], { flow: "peer" })[0]), ["open"]);
  const asking = here({ question: "?", ask: { title: "Go?" }, statusLine: "waiting for user" });
  assert.deepEqual(kinds(items(asking, [p], { flow: "peer" }).find((x) => x.key === "changes requested")), ["open"]);
});

test("a failed proof task is named and read before any merge", () => {
  const proof = { tier: 1, pass: 1, total: 2, fail: 1, failed: "t2 polish" };
  assert.equal(proofText(proof), "T1 · 1/2 pass · 1 fail");
  const [it] = items(run(), [pr({ number: 1 })], { flow: "self" }, { proof });
  assert.equal(it.line, "Proof: t2 polish failed — read it before merging #1");
  assert.deepEqual(it.actions.map((a) => a.label), ["Proof", "Open #1"]);
  const [two] = items(run(), [pr({ number: 1 })], { flow: "self" }, { proof: { ...proof, fail: 2, pass: 0 } });
  assert.equal(two.line, "Proof: t2 polish and 1 more failed — read it before merging #1");
  const [draft] = items(run(), [pr({ number: 1, state: "DRAFT" })], { flow: "self" }, { proof });
  assert.equal(draft.line, "Proof: t2 polish failed — read it before marking #1 ready");
});

test("after an ask, a working run offers no Address buttons anywhere: not in a box, not on its card", () => {
  const p = pr({ approvedBy: ["anna"], review: "APPROVED", comments: said(15) });
  // In Needs you: the box carries them, so the card and pane do not repeat them.
  const a = att(here(), [p], { flow: "peer" });
  assert.equal(a.group, "needs");
  const box = needActions(a, { run: here(), prs: [p], now });
  assert.equal(ownAddressRows(true, box), false);
  // Its orchestrator read the ask and started a fix agent: the run is working, out of Needs you.
  const busy = here({ statusLine: "t3 addressing comments" });
  const w = att(busy, [p], { flow: "peer", working: true });
  assert.notEqual(w.group, "needs");
  assert.deepEqual(needActions(w, { run: busy, prs: [p], now }), []);
  assert.equal(ownAddressRows(false, []), false);
  // In Needs you for another reason, with no Address in its box: the card's own rows.
  assert.equal(ownAddressRows(true, [{ actions: [{ kind: "open" }] }]), true);
});

// ---- a question box: what is primary, what the fold says ----

test("while a question is open its options are the primary action, and no other reason's button is", async () => {
  const { isPrimary } = await import("../../herdr-app/mods/harbormaster/needaction.js");
  // No question: the first item's first button, or the one the action names.
  assert.equal(isPrimary({}, 0, 0), true);
  assert.equal(isPrimary({}, 0, 1), false);
  assert.equal(isPrimary({ primary: true }, 1, 2), true);
  assert.equal(isPrimary({ primary: false }, 0, 0), false);
  // Under a question: never, even where the action says so.
  assert.equal(isPrimary({}, 0, 0, true), false);
  assert.equal(isPrimary({ primary: true }, 0, 0, true), false);
});

test("the Details fold names what is in it, and is left out when it holds nothing", async () => {
  const { detailsLabel } = await import("../../herdr-app/mods/harbormaster/needaction.js");
  const secs = [{ label: "" }, { label: "Question" }, { label: "Evidence" }, { label: "Risk" }];
  const opts = [{ label: "Accept", text: "Accept the prompt and go on" }, { label: "Skip", text: "" }];
  assert.equal(detailsLabel(secs, opts), "Details: question, evidence, risk, what each option does");
  assert.equal(detailsLabel(secs, []), "Details: question, evidence, risk");
  // A title-only question has no sections; options that only repeat their buttons add nothing.
  assert.equal(detailsLabel([], []), null);
  assert.equal(detailsLabel([], [{ label: "Yes", text: "Yes" }, { label: "No", text: "" }]), null);
  // "question" only when a Question or untitled section exists.
  assert.equal(detailsLabel([{ label: "Evidence" }], []), "Details: evidence");
  assert.equal(detailsLabel([{ label: "Evidence" }], opts), "Details: evidence, what each option does");
});

test("the failing check opens only from an https URL; any other scheme falls back to the PR's checks tab", () => {
  for (const url of ["file:///etc/passwd", "smb://host/share", "x-app://run", "http://example.com/c", "javascript:alert(1)"]) {
    const [it] = items(run(), [pr({ checks: checks(0, 1), failed: { name: "lint", url } })], { flow: "self" });
    assert.equal(it.actions[0].url, "https://github.com/o/skills/pull/42/checks", url);
  }
});
