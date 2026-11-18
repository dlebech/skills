// Where to look next: which group a run is in (Needs you, Working, Waiting on others, Can't
// tell, Done), its next-step label from its pull requests and its project's review flow, its
// current step and age, and whether it has stalled. Pure rules only, so the tests drive every one;
// tracking.js keeps the times and stores they read, attend.js puts them together for a run.
//
// Reliability first: a run whose state cannot be read (gh failing, its machine offline, a
// read gone stale) is never put in Needs you on the grounds it could not read. It goes
// under Can't tell (group "cant", cantTell), shown grey. A question read from the run's own
// files still counts: that file was read, whatever happened to the PR read.

import { needsYou, needReason } from "./live.js";
import { stepComments, commentsText, hasComments } from "./comments.js";
import { plural, andList } from "./words.js";
import { planOpen, taskCounts } from "./tasks.js";

// No new progress line, no change in the run's agents and no new terminal output for this
// long, and the run has stalled.
export const STALL_MS = 30 * 60000;
// An orchestrator idle this long in a running run, with nothing asked through Harbormaster and
// none of its agents at work, has most likely asked in its own tab: it needs you (idle-ask).
// Matches the captain's idle_grace (skills/herdr-app-captain/scripts/watch-runs.sh).
export const IDLE_ASK_MS = 2 * 60000;
export const IDLE_ASK_TEXT = "orchestrator idle — may be asking in its tab";

// Whether a run's orchestrator stopped without asking through Harbormaster: its own status idle
// or done (not working, blocked, gone or unknown), nothing of the run working, the run running
// (not finished, waiting, blocked, parked or closed), no open question, and so for at least
// IDLE_ASK_MS. `orchIdleMs`: how long its agents have looked as they do now (tracking.js
// agentsSince), null when unknown or while one of its agents works or is blocked (attend.js).
// `budget`: Harbormaster asks the run's budget question itself (data.js budgetPending): then the
// orchestrator waits on that item, not on something in its tab.
export function idleAsking(run, { orch = null, working = false, orchIdleMs = null, budget = false } = {}) {
  if (!run || run.away || run.phase !== "running" || working || budget) return false;
  if (orch !== "idle" && orch !== "done") return false;
  if (needsYou(run, orch)) return false;
  return orchIdleMs != null && orchIdleMs >= IDLE_ASK_MS;
}
// How often a run's PRs are read (data.js refreshPrs): every minute while the run is open,
// every 15 minutes once it is closed (data.js isClosed).
export const prTtl = (closed) => (closed ? 15 * 60000 : 60000);
// A PR read older than its ttl plus this no longer tells: its refresh is stuck.
export const PR_READ_MARGIN = 10 * 60000;
export const prMaxAge = (closed) => prTtl(closed) + PR_READ_MARGIN;
// A CI watch past this many times the repository's usual CI time has stalled.
export const CI_STALL_FACTOR = 2;
// The fewest finished CI runs a repository needs before its usual time is trusted.
export const CI_MIN_SAMPLES = 3;

// ---- review flow ----

// Projects reviewed by a colleague on GitHub; every other one is "self" (the user reviews
// the proof and merges). The user's own settings (tracking.js reviewFlows) override these.
export const DEFAULT_FLOWS = { snevagten: "peer" };

// The key a run's review flow is stored under: its repository folder's name
// ("/home/david/projects/snevagten" → "snevagten"), else the run directory's folder segment.
export const flowKey = (run) => (run?.folder ?? "").replace(/\/+$/, "").split("/").pop() || run?.repo || "";

// "peer" | "self" for a run: the user's setting for its folder, else the built-in default, else self.
export function reviewFlow(run, settings = {}) {
  const key = flowKey(run);
  const v = settings?.[key] ?? DEFAULT_FLOWS[key];
  return v === "peer" ? "peer" : "self";
}

// What a run card's review-flow toggle shows: {key, flow, fallback, isDefault}. `fallback` is
// what the folder gets without a setting of the user's (the built-in default, else self).
export function flowState(run, settings = {}) {
  const key = flowKey(run);
  const fallback = DEFAULT_FLOWS[key] === "peer" ? "peer" : "self";
  const flow = reviewFlow(run, settings);
  return { key, flow, fallback, isDefault: flow === fallback };
}

// The value to store when the user picks `flow` for a folder whose default is `fallback`:
// null when it is the default, so a later change of the built-in default reaches it too.
export const flowSetting = (flow, fallback) => (flow === fallback ? null : flow);

// ---- next-step labels ----

// The labels, most urgent first: what the user must act on before what they wait on.
// Changes requested first (work is blocked on a fix), then the merges one click away, then
// the review the user has yet to ask for, then the reviewer they wait on, then cleanup.
// What a finished run with no PR shows in Needs you.
export const FINISHED_LABEL = "finished — read and close";
export const LABELS = ["changes requested", "approved — merge", "review proof → merge", "request review", "review from", "merged — close run", "reviewed — close run"];
// A finished review run (type "rev", no PR of its own, the PR it reviewed in `related`) by what
// became of that review: submitted (or the PR is merged or closed) → Done; still pending on
// GitHub → Needs you, the user submits it there.
export const REVIEWED_LABEL = "reviewed — close run";
export const PENDING_LABEL = "submit your pending review";
// The labels that put a run in Needs you (when nothing is still working on it).
const NEEDS_LABELS = new Set(["changes requested", "approved — merge", "review proof → merge", "request review"]);
// The steps the run's own plan comes before: its PR is not the user's to review or merge while
// tasks are still planned. An approval, a change request and red CI count anyway: a reviewer acted.
const AFTER_PLAN = new Set(["review proof → merge", "request review"]);
const rank = (label) => LABELS.indexOf(label);

// ---- waiting on someone (the user's mark) ----

// The Needs-you steps the user may mark "waiting on <someone>" (a person outside GitHub, say,
// checking a preview): the run then sits in Waiting on others until something needs the user again.
export const WAIT_LABELS = new Set(["request review", "review proof → merge"]);

// What a next step's PRs look like, as far as a waiting-on mark cares: its label and, per PR, its
// state, requested reviewers, standing reviews, the latest review's time, head commit and review
// comments. A reviewer requested, a review or comment arriving, a push or a merge changes it, and
// the mark lets go. Not `updatedAt`: a preview bot editing its comment would let it go for nothing.
export function waitSig(next) {
  if (!next) return "";
  const sorted = (xs) => [...(xs ?? [])].sort();
  const prs = [...(next.prs ?? [])].sort((a, b) => String(a.url).localeCompare(String(b.url)))
    .map((p) => [p.url, p.number, p.state, sorted(p.requested), sorted(p.approvedBy), sorted(p.changesBy), p.reviewedAt ?? null, p.sha ?? null]);
  return JSON.stringify([next.label, next.count, prs, next.comments?.count ?? null]);
}

// Whether the run's next step is held back by its open plan (tasks.js planOpen): a self-flow PR
// is not the user's to review or merge yet. The one check every view that words the step shares.
export const heldByPlan = (run, next) => Boolean(next) && AFTER_PLAN.has(next.label) && planOpen(run);

export const isOpenPr = (pr) => pr?.state === "OPEN" || pr?.state === "DRAFT";
const isShut = (pr) => pr?.state === "MERGED" || pr?.state === "CLOSED";

// What became of a finished review run's review, from the PR it reviewed (`related`: PR summaries,
// data.js prSummary, whose `mine` is the viewer's latest review state): {kind: "reviewed", pr} when
// the PR is merged or closed or the viewer's review is submitted (anything but PENDING),
// {kind: "pending", pr} while it is still pending, or null when nothing tells (not a review run,
// the PR or the viewer unread, or no review by the viewer at all: its drafts may be in Herdr).
export function reviewRunStep(run, related) {
  if (run?.type !== "rev") return null;
  const pr = (related ?? []).find((p) => p && p.state !== "UNKNOWN" && p.number != null);
  if (!pr) return null;
  if (isShut(pr)) return { kind: "reviewed", pr };
  if (!pr.mine) return null;
  return { kind: pr.mine === "PENDING" ? "pending" : "reviewed", pr };
}

// One PR's next step: {label, rank, who}, or null when its state is unknown. `who` is the
// requested reviewers' names for "review from" (the user waits for their review).
// Peer: a draft, or no reviewer requested and no standing review → request review; a change
// request → changes requested; an approval → approved — merge; a reviewer requested who
// has not answered → review from <name>; only comments, nobody requested → request review
// (the review is back with the user). Self: changes requested if someone asked for them,
// else review proof → merge. Merged or closed → merged — close run, either flow.
// A reviewer asked again (back in `requested`) has no standing review: their change request
// or approval was before the re-request, so the PR waits for them. GitHub's own
// reviewDecision counts only when no reviewer's review stands and nobody is asked.
export function prStep(pr, flow) {
  if (isShut(pr)) return { label: "merged — close run", rank: rank("merged — close run"), who: [] };
  if (!isOpenPr(pr)) return null;
  const requested = pr.requested ?? [];
  const live = (who) => (who ?? []).filter((w) => !requested.includes(w));
  const decision = !pr.changesBy?.length && !pr.approvedBy?.length && !requested.length ? pr.review : null;
  const changes = live(pr.changesBy).length > 0 || decision === "CHANGES_REQUESTED";
  const step = (label, who = []) => ({ label, rank: rank(label), who });
  if (flow !== "peer") return step(changes ? "changes requested" : "review proof → merge");
  if (pr.state === "DRAFT") return step("request review");
  if (changes) return step("changes requested");
  if (live(pr.approvedBy).length > 0 || decision === "APPROVED") return step("approved — merge");
  if (pr.requested?.length > 0) return step("review from", pr.requested);
  return step("request review");
}

// The labels whose PRs' review comments are read (data.js) and counted: an approval or a change
// request often comes with comments that still want a fix, a reply or a reason to leave them.
export const COMMENT_LABELS = new Set(["approved — merge", "changes requested"]);

// The run's next step from its PRs: the most urgent PR's {label, rank, who, count, same, pr, prs,
// comments}, where `count` is how many PRs the run has, `same` how many share that label, `prs`
// those PRs and `comments` their review comments summed (comments.js stepComments; null for a
// label that does not count them) and `draft` (any of those PRs is a draft); or null without a PR
// (the run's own step applies) or when no PR's state is known.
export function nextStep(prs, flow) {
  const steps = (prs ?? []).map((pr) => ({ pr, s: prStep(pr, flow) })).filter((x) => x.s);
  if (!steps.length) return null;
  const top = steps.reduce((a, b) => (b.s.rank < a.s.rank ? b : a));
  const same = steps.filter((x) => x.s.label === top.s.label);
  const who = [...new Set(same.flatMap((x) => x.s.who))];
  const list = same.map((x) => x.pr);
  const comments = COMMENT_LABELS.has(top.s.label) ? stepComments(list) : null;
  return { label: top.s.label, rank: top.s.rank, who, count: (prs ?? []).length, same: same.length, pr: top.pr, prs: list, comments, draft: list.some((p) => p.state === "DRAFT") };
}

// nextStep with the PRs whose comments are being handled (`asked`: a Set of PR URLs) set aside
// while the others wait on you: {next, partial}. With some, not all, of an approval's or change
// request's PRs asked, the step is recomputed over the rest (its counts and words follow) and
// carries `asked`, the PRs set aside, for the box's rows, and `all`, every PR of the step in the
// run's order; `partial` is true. Otherwise the plain
// step (every PR asked, or none, or the rest wait on something else).
export function nextStepAsking(prs, flow, asked) {
  const full = nextStep(prs, flow);
  if (!full || !asked?.size) return { next: full, partial: false };
  // The asked PRs on an approval or a change request, whichever step tops the run's.
  const done = (prs ?? []).filter((p) => asked.has(p.url) && COMMENT_LABELS.has(prStep(p, flow)?.label));
  const rest = (prs ?? []).filter((p) => !done.includes(p));
  if (!done.length || !rest.length) return { next: full, partial: false };
  const left = nextStep(rest, flow);
  if (!left || !COMMENT_LABELS.has(left.label)) return { next: full, partial: false };
  // `all`: the step's PRs, asked or not, in the run's own order, so a toast's id never changes.
  return { next: { ...left, asked: done, all: (prs ?? []).filter((p) => done.includes(p) || left.prs.includes(p)) }, partial: true };
}

// A next step as the Crew shows it: "review from anna, bo", then "· 3 PRs" with several PRs.
// Short, for the narrow sidebar; reviewWaitText says it in full. With review comments,
// "approved · 3 comments" in place of "approved — merge" (merging comes after them), and
// "changes requested · 3 comments"; "· comments ?" when they could not be read. Options:
//   comments  false leaves the comment count out (the narrow sidebar, so the age survives); an
//             approval with comments still reads "approved", not "approved — merge"
//   red       CI is red on the run: "review proof", no "→ merge" (needaction.js says the same)
//   failed    a proof task failed: "proof failed", never "→ merge" (the box says to read it first)
//   ready     the run is ready to merge (assess's `ready`): "ready to merge"
//   changes   an Ask for changes is still unread (assess's `changesAsked`): "changes asked…"
//   plan      the run's plan is still open (tasks.js planOpen): an approval reads "approved · plan open",
//             never "→ merge", since the run's own tasks come before the merge
// A self-flow draft reads "review proof → ready": it is marked ready before it is merged.
export function nextStepText(step, { comments = true, red = false, failed = false, plan = false, ready = false, changes = false } = {}) {
  if (!step) return "";
  const said = commentsText(step.comments);
  const label = step.label === "review from" ? `review from ${step.who.join(", ") || "a reviewer"}`
    : step.label === "review proof → merge" ? (changes ? "changes asked…" : ready ? "ready to merge" : failed ? "proof failed" : red ? "review proof" : step.draft ? "review proof → ready" : step.label)
    : said && step.label === "approved — merge" ? (comments ? `approved · ${said}` : "approved")
    : plan && step.label === "approved — merge" ? "approved · plan open"
    : said && comments ? `${step.label} · ${said}`
    : step.label;
  return step.count > 1 ? `${label} · ${step.count} PRs` : label;
}

// nextStepText for an assessed run (assess), with what it knows beside the step: red CI and a
// failed proof. One rule for the views that word the step outside assess (parkedLabel, toasts).
export const stepTextOf = (att, opts = {}) => nextStepText(att?.next, {
  red: Boolean(att?.reasons?.some((r) => r.key === "red-ci")), failed: Boolean(att?.proofFailed), plan: Boolean(att?.planOpen), ready: Boolean(att?.ready), changes: Boolean(att?.changesAsked), ...opts,
});


// A review wait in full, for a hover: "Waiting for anna to review PR #1799 and #1372", or null
// when the step is not a review wait.
export function reviewWaitText(step) {
  if (step?.label !== "review from") return null;
  const nums = (step.prs ?? []).map((p) => p.number).filter(Boolean).map((n) => `#${n}`);
  const who = andList(step.who ?? []) || "a reviewer";
  return `Waiting for ${who} to review ${nums.length ? `PR ${andList(nums)}` : "its PR"}`;
}

// ---- reading state ----

// What a run's PR read tells: {list, readable, why}. `entry` is its harbormaster.prs entry
// ({at, list, okAt, error}), or null before the first read. Unreadable when the run has PRs
// but none was read yet, the last read failed for any PR (gh failing, offline), or the
// entry is older than prMaxAge for the schedule its PRs are read on (`closed`: data.js
// isClosed, as refreshPrs is given it), when the refresh is stuck.
export function prRead(run, entry, now, closed = false) {
  if (!run?.prs?.length) return { list: [], readable: true, why: null };
  if (!entry) return { list: null, readable: false, why: "pull requests not read yet" };
  const list = entry.list ?? [];
  if (entry.error) return { list, readable: false, why: entry.error };
  if (list.some((p) => p.state === "UNKNOWN" || p.stale)) return { list, readable: false, why: "a pull request could not be read" };
  if (now - (entry.at ?? 0) > prMaxAge(closed)) return { list, readable: false, why: "the pull request read is stale" };
  return { list, readable: true, why: null };
}

// ---- CI ----

// One check of a PR's statusCheckRollup: "pass" | "fail" | "pending".
const PASS = ["SUCCESS", "NEUTRAL", "SKIPPED"];
const FAIL = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"];
export function checkKind(x) {
  const v = (x?.conclusion || x?.state || x?.status || "").toUpperCase();
  return PASS.includes(v) ? "pass" : FAIL.includes(v) ? "fail" : "pending";
}

// A rollup's start and end in ms. While checks are pending, the start is the earliest start
// among the pending ones, so a failed job re-run long after the rest is aged from its re-run;
// once none is pending, the first check's start and the last one's completion. GitHub sends
// "0001-01-01T00:00:00Z" for a check not started yet.
const time = (s) => { const t = Date.parse(s ?? ""); return t > 946684800000 ? t : null; };
export function ciTimes(rollup) {
  const list = rollup ?? [];
  const pending = list.some((x) => checkKind(x) === "pending");
  const starts = list.filter((x) => !pending || checkKind(x) === "pending").map((x) => time(x.startedAt)).filter(Boolean);
  const ends = list.map((x) => time(x.completedAt)).filter(Boolean);
  return { startedAt: starts.length ? Math.min(...starts) : null, finishedAt: !pending && ends.length ? Math.max(...ends) : null };
}

// The CI state across a run's open PRs: {state: "running" | "red" | "green" | null, pr,
// startedAt, finishedAt}. Running wins over red (a fix may be on its way), red over green.
export function ciState(prs) {
  const open = (prs ?? []).filter((p) => isOpenPr(p) && p.checks);
  const total = (p) => p.checks.pass + p.checks.fail + p.checks.pending;
  const running = open.find((p) => p.checks.pending > 0);
  if (running) return { state: "running", pr: running, startedAt: running.ci?.startedAt ?? null, finishedAt: null };
  const red = open.find((p) => p.checks.fail > 0);
  if (red) return { state: "red", pr: red, startedAt: red.ci?.startedAt ?? null, finishedAt: red.ci?.finishedAt ?? null };
  const green = open.find((p) => total(p) > 0);
  if (green) return { state: "green", pr: green, startedAt: green.ci?.startedAt ?? null, finishedAt: green.ci?.finishedAt ?? null };
  return { state: null, pr: null, startedAt: null, finishedAt: null };
}

// A repository's usual CI time in ms: the median of its recorded CI durations (ms), or null
// with fewer than CI_MIN_SAMPLES, when there is no baseline to call a CI watch long.
export function usualCi(samples) {
  const s = (samples ?? []).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (s.length < CI_MIN_SAMPLES) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---- the current step and its age ----

// "34m", "1h12m", "2d3h"; under a minute "<1m", as Herdr's Agents list says it.
export function ageText(ms) {
  const m = Math.max(0, Math.floor((ms ?? 0) / 60000));
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h${m % 60}m` : `${Math.floor(h / 24)}d${h % 24}h`;
}

// What changes a run's step: its progress line and its plan's task states. tracking.js
// keeps when this last changed.
export const stepSig = (run) => [run?.progress ?? "", ...(run?.tasks ?? []).map((k) => `${k.id}:${k.state}`)].join("\n");

// Keeps `since` while `sig` stays the same: {sig, since}. A first sight takes `seed` (the
// best guess at when it last changed, such as status.json's updated), else now.
export function trackSince(prev, sig, now, seed = null) {
  if (!prev) return { sig, since: seed && seed <= now ? seed : now };
  return prev.sig === sig ? prev : { sig, since: now };
}

const VERB = { implement: "implementing", review: "in review", fix: "fixing" };

// The parts of a run's step that each keep their own age (tracking.js): its progress line, and
// each task at work by its state and shown stage, so one task moving on does not reset another's
// age. Keys: "p:<progress line>", "t:<id>:<state>:<stage>".
export const progressKey = (text) => `p:${text ?? ""}`;
export const taskKey = (task, stage) => `t:${task.id}:${task.state ?? ""}:${stage ?? ""}`;
export const stepParts = (run, stages = []) =>
  [progressKey(run?.progress), ...(run?.tasks ?? []).flatMap((k, i) => (VERB[stages[i]] ? [taskKey(k, stages[i])] : []))];

// Keeps each part's since: {[key]: ms} for exactly `keys`, a part seen before keeping its own,
// a new one taking now. A first sight (`prev` null) takes `seed` (as trackSince) for every part.
// The same object when nothing changed, so the caller writes only on a change.
export function trackParts(prev, keys, now, seed = null) {
  const first = seed && seed <= now ? seed : now;
  const out = {};
  for (const k of keys) out[k] = prev?.[k] ?? (prev ? now : first);
  const same = prev && Object.keys(prev).length === keys.length && keys.every((k) => prev[k] === out[k]);
  return same ? prev : out;
}

// The run's current step, {text, since, more}: tasks at work, named by the longest-running one
// with its own age ("t3 implementing", `more` the other tasks at work), else CI running on a PR
// ("CI on #42", since its first check started), else its progress line with its own age, else
// its phase. `stages` are the tasks' shown stages (data.js shownStage), in run.tasks order;
// `ages` the parts' since (trackParts, by taskKey and progressKey); `since` is when anything in
// the step last changed, the fallback for a part not dated yet; since is null when not known.
export function stepOf(run, { prs = [], stages = [], since = null, ages = null } = {}) {
  const active = (run?.tasks ?? []).map((k, i) => ({ k, stage: stages[i], since: ages?.[taskKey(k, stages[i])] ?? since }))
    .filter((x) => VERB[x.stage]);
  if (active.length) {
    const first = active.reduce((a, b) => ((b.since ?? Infinity) < (a.since ?? Infinity) ? b : a));
    return { text: `${first.k.id} ${VERB[first.stage]}`, since: first.since, more: active.length - 1, task: true };
  }
  const ci = ciState(prs);
  if (ci.state === "running") return { text: `CI on ${ci.pr.number ? `#${ci.pr.number}` : "the PR"}`, since: ci.startedAt ?? since, more: 0 };
  if (run?.progress) return { text: run.progress, since: ages?.[progressKey(run.progress)] ?? since, more: 0 };
  return { text: run?.statusLine || run?.phase || "", since, more: 0 };
}

// "t4 implementing 1h05m · +2 tasks" (a task's verb reads its age as how long), "CI on #42 · 34m",
// "writing docs · 3m".
export function stepText(step, now = Date.now()) {
  if (!step?.text) return "";
  const age = step.since ? ageText(now - step.since) : null;
  const head = age ? `${step.text}${step.task ? " " : " · "}${age}` : step.text;
  return step.more > 0 ? `${head} · +${plural(step.more, "task")}` : head;
}

// ---- stalled ----

// Whether the run has stalled: {quietMs, by: "quiet" | "ci"}, or false. Quiet: no change in
// its step, its agents or their terminal output for STALL_MS (lastActivity, the latest of
// them; null when not known yet, which never stalls). CI: a CI run on an open PR past
// CI_STALL_FACTOR times the repository's usual CI time (ciUsual, ms; null: no baseline, no
// CI stall). While CI runs, only the CI rule judges: a quiet wait on CI inside its usual time,
// or with no usual time to judge it by, is not a stall. Only a running run with its
// orchestrator there stalls: a finished, waiting, blocked, parked or closed one, one with an
// open question, or one whose orchestrator is gone (assess says so) already shows why it
// waits. A wait on a reviewer is not a stall either; assess drops a quiet stall then.
export function stalled(run, { now, lastActivity = null, prs = [], ciUsual = null, orch = null } = {}) {
  if (!run || run.away || run.phase === "finished" || orch === "gone" || needsYou(run, orch)) return false;
  const ci = ciState(prs);
  if (ci.state === "running") {
    return ciUsual && ci.startedAt && now - ci.startedAt > CI_STALL_FACTOR * ciUsual ? { quietMs: now - ci.startedAt, by: "ci" } : false;
  }
  if (lastActivity && now - lastActivity >= STALL_MS) return { quietMs: now - lastActivity, by: "quiet" };
  return false;
}

// "quiet 34m", for a stalled run.
export const quietText = (stall) => (stall ? `quiet ${ageText(stall.quietMs)}` : "");

// ---- the group ----

// Which group a run is in, and why. `run` is data.js's run, or null when its files could not
// be read (its machine is offline, or the orchestrator has no run directory). Input:
//   orch      the orchestrator's status (live.js orchestratorState), or null when unknown
//   working   true while the orchestrator or any of its agents is working
//   orchIdleMs  how long its agents have looked as they do now (idleAsking), or null
//   budgetPending  Harbormaster asks its budget question itself (idleAsking), so no idle-ask
//   pr        prRead() of the run
//   flow      reviewFlow() of the run
//   stall     stalled() of the run
//   stages, since, ages   for stepOf
//   filesOk   false when the run's files are a stale read (its machine did not answer)
//   closed    data.js isClosed: a finished run whose tab the user closed waits on nothing
//   proofFailed  a proof task failed (attend.js): the review-proof step reads "proof failed"
//   proofRead, proofClean  the user opened the proof as it is now; every claim is proven or accepted (attend.js):
//             together with green or no checks and nothing else needing the user, the run is `ready`
//   waitOn    the user's waiting-on mark of the run ({text, at, label, sig}, tracking.js), or null
//   now
// Returns {group: "needs" | "working" | "waiting" | "cant" | "done", cantTell, why, held (the plan holds
// the step back), planOpen (an approval whose plan is still open: told without "merge"), reasons: [{key, text, since}],
// next (nextStep), step (stepOf), stall, proofFailed, proofRead, ready (ready to merge), waitSince (ms: the longest-waiting reason's anchor,
// for sorting; oldest first), waitingOn ({text, at} while the user's mark holds the run in
// Waiting on others), dropWait (true when the mark no longer applies and should be deleted)}. Reason keys: question, gone (an unfinished run whose
// orchestrator is gone or lost: Resume is what it needs), idle-ask (idleAsking: its orchestrator
// stopped without asking through Harbormaster, most likely asking in its tab), stalled, red-ci, and the next-step
// labels in Needs you, and finished (a finished run with no PR: its report is read and the
// run closed); working, ci-running, idle in Working (idle: briefly quiet, not
// stalled yet); waiting-for and waiting-on in Waiting on others; cant-tell in Can't tell. A Needs you run
// may still have cantTell: a question read from its files, its PRs unreadable.
export function assess(run, { related = null, orch = null, working = false, pr = null, flow = "self", stall = false, stages = [], since = null, ages = null, filesOk = true, closed = false, proofFailed = false, proofRead = false, proofClean = false, changesAsked = false, askedPrs = null, waitOn = null, orchIdleMs = null, budgetPending = false, now = Date.now() } = {}) {
  const readable = Boolean(run) && filesOk !== false;
  const prs = pr?.readable ? pr.list : [];
  const step = stepOf(run, { prs, stages, since, ages });
  const base = { held: false, planOpen: false, cantTell: false, why: null, next: null, step, stall: false, reasons: [], proofFailed: Boolean(proofFailed), proofRead: Boolean(proofRead), changesAsked: Boolean(changesAsked), tasksShort: false, ready: false, working: Boolean(working), askedPrs: askedPrs ?? new Set() };
  // Whether the mark is judged: only once the PRs were read, and then on PR grounds only while
  // nothing works on the run or its CI (a working run is in Working whatever the mark says, and
  // keeps it for when it settles); a question or a gone orchestrator lets it go even while agents work.
  let judgeWait = false;
  const out = (group, extra) => {
    const r = { ...base, ...extra, group };
    if (waitOn && judgeWait && !r.waitingOn) r.dropWait = true;
    const anchors = r.reasons.map((x) => x.since).filter(Boolean);
    // Done waits since the run last changed (its closing, or its last status update).
    r.waitSince = anchors.length ? Math.min(...anchors)
      : group === "done" ? run?.away?.at ?? run?.updated ?? null
      : step.since ?? run?.updated ?? run?.started ?? null;
    return r;
  };
  // A blocked orchestrator is a live fact, read from the window, so it counts without its files.
  if (!readable) {
    if (orch === "blocked") return out("needs", { reasons: [{ key: "question", text: "blocked on a dialog", since: null }] });
    return out("cant", { cantTell: true, why: run ? "its machine did not answer" : "its run files could not be read", reasons: [{ key: "cant-tell", text: "can't tell", since: null }] });
  }
  if (run.away?.how === "closed") return out("done", {});
  const reasons = [];
  if (needsYou(run, orch)) reasons.push({ key: "question", text: needReason(run, orch), since: run.askedAt ?? run.updated ?? null });
  // Nobody carries an unfinished run on once its orchestrator is gone: a live fact, so it
  // counts whatever the PR read says. A finished one waits on its PRs as before.
  if (orch === "gone" && run.phase !== "finished") reasons.push({ key: "gone", text: "orchestrator gone", since: run.updated ?? null });
  // Also a live fact (its terminal's status): it counts whatever the PR read says.
  const idleAsk = idleAsking(run, { orch, working, orchIdleMs, budget: budgetPending });
  if (idleAsk) reasons.push({ key: "idle-ask", text: IDLE_ASK_TEXT, short: "idle — asking in its tab?", since: now - orchIdleMs });
  if (!pr?.readable) {
    // The question was read from its file, so it still counts; nothing is said on PR grounds.
    if (reasons.length) return out("needs", { reasons, cantTell: true, why: pr?.why ?? null });
    return out("cant", { cantTell: true, why: pr?.why ?? null, reasons: [{ key: "cant-tell", text: "can't tell", since: null }] });
  }
  // PRs whose comments are being handled leave the step while the others wait on you (nextStepAsking).
  const { next, partial } = nextStepAsking(prs, flow, askedPrs);
  const ci = ciState(prs);
  judgeWait = reasons.some((x) => x.key === "question" || x.key === "gone" || x.key === "idle-ask") || (!working && ci.state !== "running");
  // The user's mark holds while the step and its PRs are as they were when it was set.
  const marked = Boolean(waitOn) && WAIT_LABELS.has(waitOn.label) && next?.label === waitOn.label && waitSig(next) === waitOn.sig;
  base.next = next;
  base.held = heldByPlan(run, next);
  // An approval stays (a reviewer acted) but is not told to merge while the run's own plan is open.
  base.planOpen = next?.label === "approved — merge" && planOpen(run);
  // Only an un-asked PR with something to address (comments, or changes requested) pulls a
  // working run into Needs you: a plain approval can wait until the run stops.
  const urgent = partial && (next.label === "changes requested" || hasComments(next.comments));
  // Done: a finished run with every PR merged or closed, and nothing still at work or asking.
  // A running run between PRs is not done, however idle it looks.
  if (run.phase === "finished" && prs.length && prs.every(isShut) && !working && !reasons.length) return out("done", { next });
  // A finished review run whose review was submitted (or whose PR is gone) is done; one whose
  // review is still pending asks the user to submit it. Without a reading it stays "finished".
  const reviewed = run.phase === "finished" && !prs.length && !working && !closed ? reviewRunStep(run, related) : null;
  if (reviewed?.kind === "reviewed" && !reasons.length) {
    const label = REVIEWED_LABEL;
    return out("done", { next: { label, rank: rank(label), who: [], count: 1, same: 1, pr: reviewed.pr, prs: [reviewed.pr], comments: null, draft: false } });
  }
  if (reviewed?.kind === "pending") reasons.push({ key: "review-pending", text: PENDING_LABEL, pr: reviewed.pr, since: run.updated ?? null });
  // Waiting on a reviewer, or on whoever the user's mark names, is a wait on a person, not a
  // stall (only CI past its usual time stalls while CI runs).
  if (stall && stall.by !== "ci" && (next?.label === "review from" || ci.state === "running" || marked)) stall = false;
  // An idle orchestrator past IDLE_ASK_MS is told as idle-ask: a quiet stall then would say the
  // same thing less precisely (an idle orchestrator is quiet), so only one of them shows.
  if (stall && stall.by !== "ci" && idleAsk) stall = false;
  if (stall) reasons.push({ key: "stalled", text: quietText(stall), since: now - stall.quietMs });
  // PR grounds only once nothing works on the run any more and CI is not running: while it
  // works, it is the run's turn, not the user's. The exception: PRs of an approval or change
  // request nobody was asked about, while the others' comments are being handled (`partial`).
  // While the asked PRs' CI runs (the orchestrator pushed its fix), the others still wait on you.
  const gate = partial ? ciState(next.prs) : ci;
  if ((!working || urgent) && gate.state !== "running") {
    const settled = Math.max(run.updated ?? 0, ci.finishedAt ?? 0) || null;
    if (!working && ci.state === "red") reasons.push({ key: "red-ci", text: `red CI on #${ci.pr.number}`, since: ci.finishedAt ?? settled });
    if (next && NEEDS_LABELS.has(next.label) && !heldByPlan(run, next)) {
      const reviewed = next.label === "changes requested" || next.label === "approved — merge" ? next.pr.reviewedAt ?? null : null;
      // `short`: without the comment count, for the narrow sidebar (crewrows.js rowLead).
      // Ready to merge: a self-flow PR whose proof was read and passes in full, with green (or no)
      // checks, no draft to mark ready first, and nothing else the run waits on you for.
      // Every listed task done too (a finished run's plan is never "open", planOpen), and no ask for
      // changes still unread: the orchestrator is about to work on it.
      const tc = taskCounts(run);
      base.tasksShort = tc.planned > 0 && tc.done < tc.planned;
      base.ready = next.label === "review proof → merge" && proofRead && proofClean && !proofFailed && !next.draft && !reasons.length
        && !base.tasksShort && !changesAsked && (ci.state === "green" || ci.state === null);
      const opts = { red: ci.state === "red", failed: Boolean(proofFailed), plan: base.planOpen, ready: base.ready, changes: base.changesAsked && next.label === "review proof → merge" };
      reasons.push({ key: next.label, text: nextStepText(next, opts), short: nextStepText(next, { ...opts, comments: false }), since: reviewed ?? settled });
    }
  }
  // A finished run with no PR (a review or an exploration) leaves a report: reading it and
  // closing the run is the user's to do. Not Done: Done is merged PRs, which it has none of.
  if (run.phase === "finished" && !prs.length && !working && !closed && !reviewed) reasons.push({ key: "finished", text: FINISHED_LABEL, since: run.updated ?? null });
  // Marked "waiting on <someone>": while its step is the only thing it needs the user for, it waits on them.
  if (marked && reasons.length === 1 && reasons[0].key === waitOn.label) {
    const waitingOn = { text: waitOn.text, at: waitOn.at ?? null };
    return out("waiting", { reasons: [{ key: "waiting-on", text: `waiting on ${waitOn.text}`, since: waitingOn.at }], next, waitingOn, ready: false });
  }
  if (reasons.length) return out("needs", { reasons, next, stall });
  const why = working ? { key: "working", text: "agents working" }
    : ci.state === "running" ? { key: "ci-running", text: "CI running" }
    : next?.label === "review from" ? { key: "waiting-for", text: nextStepText(next) }
    : { key: "idle", text: "idle" };
  return out(why.key === "waiting-for" ? "waiting" : "working", { reasons: [{ ...why, since: step.since }], next });
}

// Longest wait first: the older waitSince sorts first; an unknown one last.
export const byWait = (a, b) => (a.waitSince ?? Infinity) - (b.waitSince ?? Infinity);

// The status a run's dot shows (Crew row, card, pane): its orchestrator's own status lifted by
// its agents', since the orchestrator sits idle between its turns while its agents implement.
// Blocked if it or any agent is blocked on a dialog, else working if it or any agent works (or,
// with `ciRunning`, while CI runs: the run is at work, just not in a terminal), else its own.
export function runDot(own, agents = [], { ciRunning = false } = {}) {
  const all = [own, ...agents];
  if (all.includes("blocked")) return "blocked";
  if (all.includes("working") || (ciRunning && own !== "gone")) return "working";
  return own;
}
