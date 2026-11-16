// Review comments on approved or changes-requested PRs (comments.js; attention.js nextStep and
// nextStepText; crewrows.js reviewCommentLines; data.js withComments and askComments): what is
// counted, the labels ("approved · 3 comments", unknown never zero), the Address comments message,
// when it reads "asked…", and that the message answers no question.
// Run: node --import ./loader.mjs --test comments.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { commentSummary, commentText, commentsArgs, commentsRequest, pendingComments, commentsAsked, commentsSig, defaultMode, commentLines, COMMENTS, AI_PREFIX } from "../../herdr-app/mods/harbormaster/comments.js";
import { nextStep, nextStepText, assess, prStep } from "../../herdr-app/mods/harbormaster/attention.js";
import { reviewCommentLines, badgeOf, rowTip } from "../../herdr-app/mods/harbormaster/crewrows.js";
import { loadRuns, askComments, withComments } from "../../herdr-app/mods/harbormaster/data.js";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "https://github.com/o/api/pull/1799";

// A gh graphql answer, as COMMENTS_QUERY asks for it.
const thread = (id, who, body, extra = {}) => ({ id, isResolved: false, path: "app/X.php", line: 42, originalLine: 40,
  first: { nodes: [{ author: { login: who }, body, url: `${URL}#discussion_${id}` }] }, last: { nodes: [{ author: { login: who }, body }] }, ...extra });
const answer = (threads, reviews = [], comments = []) => ({ data: { repository: { pullRequest: {
  author: { login: "me" }, reviewThreads: { nodes: threads }, reviews: { nodes: reviews }, comments: { nodes: comments } } } } });

test("counted: unresolved threads by others and reviewers' review text; not resolved, own, answered or bot summaries", () => {
  const s = commentSummary(answer([
    thread("T1", "anna", "**1. Errors never reach Sentry**\n\nWhen it fails…"),
    thread("T2", "anna", "fixed already", { isResolved: true }),
    thread("T3", "me", "note to self"),
    thread("T4", "anna", "rename this", { last: { nodes: [{ author: { login: "me" }, body: `${AI_PREFIX} renamed in abc123` }] } }),
    thread("T5", "coderabbitai", "<!-- x -->\n\n**<picture><img src=x></picture> Minor** · **Correctness**\n\n**Fall back when out of order.**\n\nIf…", { line: null }),
  ], [
    { state: "APPROVED", body: "Approved, but #1 and #2 should be looked at.\nMore.", url: `${URL}#pullrequestreview-1`, submittedAt: "2026-11-16T21:39:31Z", author: { login: "anna" } },
    { state: "APPROVED", body: "", url: "u", submittedAt: "2026-11-16T21:39:31Z", author: { login: "bo" } },
    { state: "COMMENTED", body: "**Actionable comments posted: 9**", url: "u", submittedAt: "2026-11-16T21:00:00Z", author: { login: "coderabbitai" } },
    { state: "COMMENTED", body: "own words", url: "u", submittedAt: "2026-11-16T21:00:00Z", author: { login: "me" } },
    { state: "COMMENTED", body: "Two more findings, none blocking.", url: `${URL}#pullrequestreview-0`, submittedAt: "2026-11-16T10:00:00Z", author: { login: "anna" } },
  ], [{ body: `${AI_PREFIX} answered the review`, createdAt: "2026-11-16T12:00:00Z", author: { login: "me" } }]));
  assert.equal(s.count, 3);
  assert.equal(s.answered, 2);
  assert.deepEqual(s.items.map((x) => [x.kind, x.who, x.text, x.where, x.thread]), [
    ["thread", "anna", "1. Errors never reach Sentry", "app/X.php:42", "T1"],
    ["thread", "coderabbitai", "Fall back when out of order.", "app/X.php:40", "T5"],
    ["review", "anna", "Approved, but #1 and #2 should be looked at.", null, null],
  ]);
  assert.equal(commentSummary({ data: { repository: null } }), null);
  assert.equal(commentText(`${"x".repeat(200)}`).length, 120);
});

test("the gh call asks GitHub's GraphQL API for the PR by owner, name and number", () => {
  const args = commentsArgs(URL);
  assert.deepEqual([args[0], args[1], args.slice(-6)], ["api", "graphql", ["-F", "owner=o", "-F", "name=api", "-F", "number=1799"]]);
  assert.match(args[3], /^query=query\(/);
  assert.equal(commentsArgs("https://example.com/x"), null);
});

test("withComments reads only open approved or changes-requested PRs, and a failure is unknown, never zero", async () => {
  const calls = [];
  globalThis.__herdrExec = async (cmd, args, opts) => {
    calls.push([cmd, args[0], opts?.on]);
    return { code: 0, stdout: JSON.stringify(answer([thread("T1", "anna", "rename")])), stderr: "" };
  };
  try {
    const pr = { url: URL, state: "OPEN", review: "APPROVED" };
    assert.equal((await withComments(pr, { machine: "box" })).comments.count, 1);
    assert.deepEqual(calls, [["gh", "api", "box"]]);
    assert.equal(await withComments({ ...pr, review: null }, {}).then((p) => p.comments), undefined);
    assert.equal(await withComments({ ...pr, state: "MERGED" }, {}).then((p) => p.comments), undefined);
    assert.equal(calls.length, 1);
    globalThis.__herdrExec = async () => ({ code: 1, stdout: "", stderr: "HTTP 502: Bad gateway\nmore" });
    assert.deepEqual((await withComments({ ...pr, review: "CHANGES_REQUESTED" }, {})).comments, { error: "HTTP 502: Bad gateway" });
  } finally { delete globalThis.__herdrExec; }
});

const pr = (n, review, comments, extra = {}) => ({ number: n, url: `https://github.com/o/r/pull/${n}`, state: "OPEN", review,
  approvedBy: review === "APPROVED" ? ["anna"] : [], changesBy: review === "CHANGES_REQUESTED" ? ["anna"] : [], requested: [], comments, ...extra });
const some = (n) => ({ count: n, answered: 0, items: Array.from({ length: n }, (_, i) => ({ kind: "thread", who: "anna", text: `point ${i + 1}`, where: `a.ts:${i + 1}`, thread: `T${i}`, url: null })) });

test("labels: approved · N comments replaces approved — merge; changes requested adds them; unknown says so", () => {
  assert.equal(nextStepText(nextStep([pr(1, "APPROVED", some(0))], "peer")), "approved — merge");
  assert.equal(nextStepText(nextStep([pr(1, "APPROVED", undefined)], "peer")), "approved — merge");
  assert.equal(nextStepText(nextStep([pr(1, "APPROVED", some(3))], "peer")), "approved · 3 comments");
  assert.equal(nextStepText(nextStep([pr(1, "APPROVED", some(1))], "peer")), "approved · 1 comment");
  assert.equal(nextStepText(nextStep([pr(1, "CHANGES_REQUESTED", some(2))], "peer")), "changes requested · 2 comments");
  assert.equal(nextStepText(nextStep([pr(1, "CHANGES_REQUESTED", some(2))], "self")), "changes requested · 2 comments");
  assert.equal(nextStepText(nextStep([pr(1, "APPROVED", { error: "HTTP 502" })], "peer")), "approved · comments ?");
  // Two approved PRs: their comments summed, then the PR count.
  assert.equal(nextStepText(nextStep([pr(1, "APPROVED", some(17)), pr(2, "APPROVED", some(12))], "peer")), "approved · 29 comments · 2 PRs");
  // Comments on a less urgent PR do not change the top label's.
  assert.equal(nextStepText(nextStep([pr(1, "CHANGES_REQUESTED", some(0)), pr(2, "APPROVED", some(4))], "peer")), "changes requested · 2 PRs");
  // Self flow: an approval is still review proof → merge, comments or not.
  assert.equal(nextStepText(nextStep([pr(1, "APPROVED", some(3))], "self")), "review proof → merge");
  // Same urgency as approved — merge.
  assert.equal(prStep(pr(1, "APPROVED", some(3)), "peer").label, "approved — merge");
});

test("an approved run with comments is in Needs you with the label, its hover says who said what", () => {
  const run = { phase: "finished", prs: [{ url: "x" }], tasks: [], updated: 1000 };
  const now = 10_000_000;
  const a = assess(run, { orch: "idle", pr: { list: [pr(1799, "APPROVED", some(2), { reviewedAt: 5000 })], readable: true }, flow: "peer", now });
  assert.equal(a.group, "needs");
  assert.deepEqual(a.reasons.map((r) => [r.key, r.text]), [["approved — merge", "approved · 2 comments"]]);
  assert.deepEqual(badgeOf(a, true), { label: "approved · 2 comments", tone: "blocked", tip: "Review comments (2):\n  anna on a.ts:1: point 1\n  anna on a.ts:2: point 2" });
  assert.ok(rowTip(a, now).includes("  anna on a.ts:2: point 2"));
  // Unknown comments: still Needs you on the approval (that was read), the hover says why.
  const u = assess(run, { orch: "idle", pr: { list: [pr(1799, "APPROVED", { error: "HTTP 502" })], readable: true }, flow: "peer", now });
  assert.equal(u.group, "needs");
  assert.deepEqual(reviewCommentLines(u.next), ["Review comments: could not be read", "  comments could not be read: HTTP 502"]);
  // No comments: no hover lines, no tip.
  const n = assess(run, { orch: "idle", pr: { list: [pr(1799, "APPROVED", some(0))], readable: true }, flow: "peer", now });
  assert.deepEqual(reviewCommentLines(n.next), []);
  assert.equal(badgeOf(n, true).tip, undefined);
  // Several PRs: each line says which.
  assert.deepEqual(commentLines([pr(1, "APPROVED", some(2)), pr(2, "APPROVED", some(1))], 2), ["#1 anna on a.ts:1: point 1", "#1 anna on a.ts:2: point 2", "+1 more"]);
});

test("the message: the PR and mode first, every comment with its thread, then what to do", () => {
  const p = pr(1799, "APPROVED", { count: 2, answered: 0, items: [
    { kind: "thread", who: "anna", text: "Errors never reach Sentry", where: "app/X.php:42", thread: "PRRT_1", url: "u1" },
    { kind: "review", who: "anna", text: "Approved, but look at #1", where: null, thread: null, url: "u2" },
  ] });
  const ask = commentsRequest(p, "ask").split("\n");
  assert.deepEqual(ask.slice(0, 4), [
    "address comments on https://github.com/o/r/pull/1799: ask",
    "Harbormaster sees 2 open review comments on PR #1799 (approved):",
    "- anna on app/X.php:42: Errors never reach Sentry (thread PRRT_1)",
    "- anna in a review: Approved, but look at #1 (u2)",
  ]);
  assert.match(ask[4], /^Asked from Harbormaster: .*question\.md.*"Do as proposed", "Let me pick" \(free text\) and "Leave them"/);
  const handle = commentsRequest({ ...p, review: "CHANGES_REQUESTED" }, "handle");
  assert.match(handle, /^address comments on \S+: handle\n.*\(changes requested\):/);
  assert.match(handle, /starting "🤖 AI:".*resolve the threads you addressed.*Never merge, never dismiss a review\.$/);
  assert.equal(COMMENTS.exec(handle.split("\n")[0])[2], "handle");
  assert.equal(defaultMode("L2"), "handle");
  assert.equal(defaultMode("L1"), "ask");
  assert.equal(defaultMode(undefined), "ask");
});

test("asked… holds while the message is unread, or until the PR's comments or the run's status change", () => {
  assert.deepEqual(pendingComments("set autonomy to L2\naddress comments on https://x/pull/1: ask\nwhat is blocking? y"), ["https://x/pull/1"]);
  assert.deepEqual(pendingComments(null), []);
  const p = pr(1, "APPROVED", some(2));
  const r = { statusLine: "finished", commentsAsked: [] };
  const asked = { sig: commentsSig(r, p) };
  assert.equal(commentsAsked(r, p, asked), true);
  assert.equal(commentsAsked(r, { ...p, comments: some(1) }, asked), false);
  assert.equal(commentsAsked({ ...r, statusLine: "running" }, p, asked), false);
  assert.equal(commentsAsked({ ...r, commentsAsked: [p.url] }, p, null), true);
  assert.equal(commentsAsked(r, p, null), false);
});

test("the captain watcher does not take an address comments message as an answer", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-cmt-"));
  try {
    mkdirSync(join(dir, "inbox"));
    writeFileSync(join(dir, "inbox", "a-harbormaster-comments.message"), `${commentsRequest(pr(1, "APPROVED", some(1)), "ask")}\n`);
    writeFileSync(join(dir, "inbox", "b-captain.message"), 'Answer to "Q": Yes\naddress comments on x: ask\n');
    const lib = join(here, "../../skills/herdr-app-captain/scripts/lib.sh");
    const r = spawnSync("bash", ["-c", 'source "$1"; answer_messages "$2"', "bash", lib, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split("\n").map((p) => p.split("/").pop()), ["b-captain.message"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("askComments writes the message to the run's inbox; the next read shows it asked, not as an answer", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cmt-root-"));
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  const read = async (dir) => { skew += 5000; return (await loadRuns()).runs.find((r) => r.dir === dir); };
  try {
    // Only sh runs for real, with the throwaway root; hc and gh are not called.
    globalThis.__herdrExec = async (cmd, args) => {
      if (cmd !== "sh") return { code: 1, stdout: "", stderr: "not in this test" };
      const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, HERDR_ORCHESTRATION_ROOT: root } });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const dir = join(root, "skills", "feat-x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orchestrator.json"), JSON.stringify({ branch: "feat-x", terminal: "t99", folder: "skills" }));
    writeFileSync(join(dir, "status.json"), JSON.stringify({ status: "finished", progress: "PR approved" }));
    writeFileSync(join(dir, "plan.md"), "Status: finished\n");
    writeFileSync(join(dir, "question.md"), "# Go on?\n");
    let r = await read(dir);
    assert.deepEqual(r.commentsAsked, []);
    const p = pr(1799, "APPROVED", some(2));
    // The orchestrator t99 is not running here, so the ask only waits in the inbox.
    assert.deepEqual(await askComments(r, p, "handle"), { blocked: false, waits: true });
    const [msg] = readdirSync(join(dir, "inbox"));
    assert.match(msg, /^\d{8}T\d{6}Z-\d{3}-harbormaster-comments\.message$/);
    assert.match(readFileSync(join(dir, "inbox", msg), "utf8"), /^address comments on https:\/\/github\.com\/o\/r\/pull\/1799: handle\n/);
    r = await read(dir);
    assert.deepEqual(r.commentsAsked, [p.url]);
    // Not an answer: the open question must not read as answered.
    assert.equal(r.unhandled, 0);
    renameSync(join(dir, "inbox", msg), join(dir, "inbox", `${msg}.handled`));
    r = await read(dir);
    assert.deepEqual(r.commentsAsked, []);
  } finally {
    Date.now = realNow;
    rmSync(root, { recursive: true, force: true });
    delete globalThis.__herdrExec;
  }
});
