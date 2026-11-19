// Run facts for Harbormaster: herdr-app-orchestrator run directories, read on
// every machine (this one and each one added with `hc machine add`), plus each
// run's pull requests from `gh`, asked on the machine that owns the run.
// Live facts from herdr-core are in live.js; text helpers in ui.js.
//
// The run directory files it reads and writes are documented in
// skills/herdr-app-orchestrator/references/run-files.md. In short, per run, under
// <root>/<folder>/<branch>/: orchestrator.json, plan.md, status.json (with the token
// totals tokens.sh counts into it; this mod never reads session files for them), question.md,
// inbox/*.message (written here on an answer, Close or a level request from a tag), parked and closed markers;
// and <root>/.captain-decisions.json for the captain's open decisions. The same poll takes a
// process snapshot for CPU and memory (resources.js), kept per run in .resources.json.

import { exec, appHome, machines, spaces, run as command } from "herdr";
import { shared, setShared } from "./store.js";
import { parseQuestion } from "./question.js";
import { parseDecidedLines } from "./decided.js";
import { pendingLevels } from "./levels.js";
import { tokenText } from "./context.js";
import { dropCacheArgs } from "./media.js";
import { proofOf, runTier, parseProofMd, parseAccepted, acceptedFile, pendingProofs, withAcceptance } from "./proof.js";
import { parsePlanClaims, claimResultLine, finalReviews, pickFinal } from "./claims.js";
import { SAMPLER, ingest, recordRuns, setStored } from "./resources.js";
import { writeHistory, writeHistoryBeforeDelete, deleteWait, historyWritten } from "./history.js";
import { taskTone, taskCounts, taskStage } from "./tasks.js";
// taskStage moved to tasks.js (claims.js reads it without herdr); still exported from here.
export { taskStage };
export { taskTone, taskCounts };
import { checkKind, ciTimes, prTtl, isOpenPr, prOffset, fnv1a, PR_EVENT_FLOOR_MS, PR_OPENED_MS } from "./attention.js";
import { NOT_ANSWERS, blockingPending, changesPending, rereviewPending, send, writeMessage, wakeRun } from "./inbox.js";
import { reviewerCandidates, reviewersArgs, requestArgs } from "./reviewers.js";
import { commentsArgs, commentSummary, pendingComments } from "./comments.js";
import { observeRuns, recordCi } from "./tracking.js";
import { detachedSend } from "./wake.js";
import { exactStatus, reportedStatus, orchestratorState, orchestratorLost, workersOf, needsYou, needReason, tabOf, liveTabOf, tabOfTerminal, tabInfo, homeSpace, worktreeSpaces, leftoverSpaces, captainOf, facts } from "./live.js";

const RS = "\u001e", US = "\u001f", GS = "\u001d";

// NOT_ANSWERS (inbox.js) is the ERE of the first lines of inbox messages that answer no question.

// One sh script per machine: the captain's decisions, then every run, its files
// separated by \x1f, runs by \x1e; then, after a \x1d, the process snapshot.
const SCRIPT = [
  'root="${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}"',
  'head -c 60000 "$root/.captain-decisions.json" 2>/dev/null',
  'for f in "$root"/*/*/orchestrator.json; do',
  '  [ -e "$f" ] || continue',
  '  d="${f%/orchestrator.json}"',
  "  printf '\\036%s\\037' \"$d\"",
  '  cat "$f"; printf \'\\037\'',
  '  cat "$d/status.json" 2>/dev/null; printf \'\\037\'',
  '  head -c 60000 "$d/plan.md" 2>/dev/null; printf \'\\037\'',
  '  [ -e "$d/question.md" ] && head -c 4000 "$d/question.md"; printf \'\\037\'',
  // When it was asked: question.md's mtime (GNU stat, then BSD/macOS).
  '  [ -e "$d/question.md" ] && { stat -c %Y "$d/question.md" 2>/dev/null || stat -f %m "$d/question.md" 2>/dev/null; }; printf \'\\037\'',
  '  [ -e "$d/parked" ] && { printf +; head -c 400 "$d/parked"; }; printf \'\\037\'',
  '  [ -e "$d/closed" ] && { printf +; head -c 400 "$d/closed"; }; printf \'\\037\'',
  // Unhandled messages, but for level requests, asks to prove, asks what is blocking and asks to address comments (below),
  // which the tags, the Proof rows and "asked…" show instead: one must not make a queued question read as answered.
  `  n=0; for m in "$d"/inbox/*.message; do [ -e "$m" ] && ! head -n 1 "$m" | grep -qE '${NOT_ANSWERS}' && n=$((n+1)); done; printf "%s\\037" "$n"`,
  // proof.md (a "+" before it when there is one, "!" when it was cut at 64 kB), then the names of the files in shared/proof/, capped.
  '  [ -e "$d/proof.md" ] && { [ "$(wc -c < "$d/proof.md")" -gt 64000 ] && printf \'!\' || printf +; head -c 64000 "$d/proof.md"; }; printf \'\\037\'',
  '  ls -p "$d/shared/proof" 2>/dev/null | grep -v / | head -40; printf \'\\037\'',
  // decisions.md: the last 60 lines of its own decisions and the user's, capped.
  '  grep -a -E "^- \\[(decided|user)\\] " "$d/decisions.md" 2>/dev/null | tail -n 60 | tail -c 20000; printf \'\\037\'',
  // Level requests (levels.js), asks to prove (proof.js), asks what is blocking (inbox.js) and
  // asks to address comments (comments.js) in the inbox's unhandled messages,
  // oldest first: what is pending. Only a message's first line, so an answer's free text that
  // reads like one is not one.
  `  for m in "$d"/inbox/*.message; do [ -e "$m" ] && head -n 1 "$m"; done | grep -a -E '${NOT_ANSWERS}' | tail -c 8000; printf '\\037'`,
  // The user's acceptances of proof as it is (Accept on a Proof row), capped.
  '  head -c 20000 "$d/proof-accepted.json" 2>/dev/null; printf \'\\037\'',
  // shared/'s Markdown file names, capped, for a finished run's Needs-you box: needaction.js
  // runReports picks the run's reports among them (one rule, so the two never drift apart).
  '  ls "$d/shared" 2>/dev/null | grep -iE "\\.md$" | head -200; printf \'\\037\'',
  // The run's CPU and memory totals so far (resources.js adds each sample to them).
  '  head -c 1000000 "$d/.resources.json" 2>/dev/null',
  "done",
  SAMPLER,
].join("\n");

// A short hash of a text (FNV-1a), to tell that it changed without keeping it.
export const textSig = (text) => `${text.length}:${fnv1a(text).toString(36)}`;

// A fingerprint of what in a run's files bears on its PRs: status.json's prs, related, status and
// task counts, plan.md's Status line and proof.md's Checks line. Not its progress, waiting, tokens or
// `updated`: set-status.sh stamps those at every step of a busy run, and reading its PRs each time
// would cost more than the backstop saves (prpolling.test.mjs, the active budget).
export function prFilesSig(status, plan, proofFile) {
  const s = status ?? {};
  const line = (re, text) => re.exec(text ?? "")?.[1]?.trim() ?? "";
  return textSig(JSON.stringify([s.prs ?? [], s.related ?? [], s.status ?? null, s.tasks?.merged ?? null, s.tasks?.planned ?? null,
    line(/^Status:(.*)$/m, plan), line(/^Checks:(.*)$/m, proofFile)]));
}

const json = (s) => {
  try { return JSON.parse(s); } catch { return null; }
};

// A run's state, from plan.md's Status line, status.json's status, or an
// orchestrator's run.status label: "running" | "waiting" | "blocked" | "finished" | "unknown".
export function runPhase(text) {
  const s = (text ?? "").toLowerCase();
  if (s.startsWith("finished")) return "finished";
  if (s.startsWith("waiting")) return "waiting";
  if (s.startsWith("blocked")) return "blocked";
  return s ? "running" : "unknown";
}

// plan.md's tasks, as {id, name, state, about}. The orchestrator writes them freely, so
// three shapes are read:
//   a heading, "### t1 pin-spread — merged (45e5)", or with "status: merged" in it or in
//     a "- Status: merged (595a5bd1)" line below it; else the words after its first dash;
//   a table under a header row naming an `id` and a `status` column, such as
//     "| id | repo | scope | ... | status |" and "| api | acme-api | ... | merged d3c8862d |";
//     its `scope`, `task` or `name` column is what the task is about. Without an `id`
//     column, a `#` column is the id ("| # | task | ... | status |"; a "deal-assoc: what"
//     task cell gives the name), else a `task` column is id and name ("| t14 dashboard + nav |");
//   a list item under "## Tasks" with a "Status:", "1. ui — what it does. Status: merged (9eefaf1)".
// Each task also has proof: {tier, text} from its "Proof: T1 — the evidence" (a "- Proof:" line
// below a heading, a `proof` column, or "Proof:" in a list item), else null: not scoped yet.
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
// "merged (9eefaf1); worktree removed" → "merged"; "**done** here" → "done"; "merged d3c8862d" → "merged".
const stateWords = (s) => s.replace(/[*_`]/g, "").replace(/[(;,.].*$/, "").replace(/\s+[0-9a-f]{6,}\b.*$/i, "").trim().toLowerCase();
// The status text runs to the end of the line, or to a Proof: that follows it in a list item.
const statusIn = (text) => /\bstatus:\s*((?:(?!\bproof:)[^\n])+)/i.exec(text)?.[1] ?? null;
const DASH = /\s[—–-]\s+/;
function tasksOf(plan) {
  const out = [];
  let head = null; // the current table's columns, until the next ## heading
  let inTasks = false; // under a "## Tasks" heading
  let open = null; // the heading task still looking for a Status line below it
  let last = null; // the latest heading task, for a Proof line below it
  for (const line of (plan ?? "").split("\n")) {
    const h = /^###\s+(\S+)\s+(.*)$/.exec(line);
    if (h) {
      const [first, ...rest] = h[2].split(DASH);
      const word = first.trim().split(/\s+/)[0] ?? "";
      const after = rest.join(" — ").replace(/\s*\(.*$/, "").trim();
      const status = statusIn(h[2]);
      // Without a Status, words after the dash are the state ("merged") or, with a Status
      // line to come, what the task is about ("pending-approval notifications").
      const task = { id: h[1], name: /^[\w-]+$/.test(word) ? word : "", state: status ? stateWords(status) : stateWords(after), about: null, proof: null };
      out.push(task);
      last = task;
      open = status ? null : { task, after };
      continue;
    }
    if (/^##\s/.test(line)) { head = null; open = null; last = null; inTasks = /^##\s+tasks\b/i.test(line); continue; }
    if (open && /^\s*[-*]\s+status:/i.test(line)) {
      open.task.state = stateWords(statusIn(line));
      open.task.about = open.after || null;
      open = null;
      continue;
    }
    const proofLine = last && /^\s*[-*]\s+[*_]*proof:?[*_]*\s*(.*)$/i.exec(line);
    if (proofLine) { last.proof = proofOf(proofLine[1]); continue; }
    if (line.trim().startsWith("|")) {
      const row = cells(line);
      if (row.every((c) => /^:?-+:?$/.test(c))) continue;
      const lower = row.map((c) => c.toLowerCase());
      const idAt = ["id", "#", "task"].map((n) => lower.indexOf(n)).find((i) => i >= 0) ?? -1;
      if (idAt >= 0 && lower.includes("status")) {
        const about = ["scope", "task", "name", "what"].map((n) => lower.indexOf(n)).find((i) => i >= 0 && i !== idAt) ?? -1;
        head = { id: idAt, status: lower.indexOf("status"), proof: lower.indexOf("proof"), about, named: lower[idAt] === "task" };
      } else if (head && row[head.id]) {
        let id = row[head.id], name = "", about = row[head.about] || null;
        if (head.named) [, id, name] = /^(\S+)\s*(.*)$/.exec(id);
        const slug = !head.named && about && /^([\w-]+):\s+(.*)$/.exec(about);
        if (slug) [, name, about] = slug;
        out.push({ id, name, state: stateWords(row[head.status] ?? ""), about, proof: head.proof >= 0 ? proofOf(row[head.proof]) : null });
      }
      continue;
    }
    const li = inTasks && !open ? /^(?:\d+\.|[-*])\s+(\S+)\s+(.*)$/.exec(line) : null;
    const status = li && statusIn(li[2]);
    if (status) {
      const cut = li[2].search(/\b(?:status|proof):/i);
      const about = li[2].slice(0, cut).split(DASH).slice(1).join(" — ").replace(/[\s.;,]+$/, "");
      out.push({ id: li[1].replace(/[:—–-]+$/, ""), name: "", state: stateWords(status), about: about || null, proof: proofOf(/\bproof:\s*(.*?)(?=\s*\bstatus:|$)/i.exec(li[2])?.[1]) });
    }
  }
  return out;
}

// The captain's open decisions, oldest first: {key, id, question, run, asked, machine} and,
// when decisions.sh was given them, options [{label, text}], recommended (an index into
// options, or null), why, evidence, risk and blocks.
const str = (v) => (typeof v === "string" ? v.trim() : "");
function parseDecisions(machine, text) {
  const list = json(text);
  if (!Array.isArray(list)) return [];
  return list.filter((d) => d && d.id && d.question).map((d) => ({
    key: `${machine ?? ""}:${d.id}`,
    id: String(d.id),
    question: String(d.question),
    run: typeof d.run === "string" ? d.run : null,
    asked: Date.parse(d.asked) || null,
    machine,
    options: (Array.isArray(d.options) ? d.options : []).filter((o) => o && str(o.label)).map((o) => ({ label: str(o.label), text: str(o.text) })),
    evidence: str(d.evidence),
    risk: str(d.risk),
    blocks: str(d.blocks),
    rec: str(d.recommended),
  })).map(({ rec, ...d }) => {
    // `recommended` names an option by label (case-insensitive) or number, then maybe why.
    const n = /^(?:option\s+)?#?(\d+)\b/i.exec(rec);
    const at = n ? Number(n[1]) - 1 : d.options.findIndex((o) => rec.toLowerCase().startsWith(o.label.toLowerCase()));
    const known = at >= 0 && at < d.options.length;
    return { ...d, recommended: known ? at : null, why: /^[^:—–]*[:—–]\s*(.*)$/s.exec(rec)?.[1] ?? (known ? "" : rec) };
  });
}

// The last parse of each run, by its machine, directory and files' text (all but
// .resources.json, which changes with every sample). Most polls find every run as it was, and
// then hand back the same object: no parsing, and the views see by identity that nothing changed.
let parsed = new Map();
function parse(machine, stdout) {
  const keep = new Map();
  const runs = stdout.split(RS).slice(1).filter((s) => s.trim()).map((chunk) => {
    const cut = chunk.lastIndexOf(US);
    const files = cut < 0 ? chunk : chunk.slice(0, cut);
    const key = `${machine ?? ""}:${chunk.slice(0, chunk.indexOf(US))}`;
    setStored(key, cut < 0 ? "" : chunk.slice(cut + 1));
    const hit = parsed.get(key);
    const run = hit?.files === files ? hit.run : parseRun(machine, chunk);
    keep.set(key, { files, run });
    return run;
  });
  // Runs of other machines stay; this machine's are now exactly the ones just read.
  for (const [key, v] of parsed) if (!key.startsWith(`${machine ?? ""}:`) && !keep.has(key)) keep.set(key, v);
  parsed = keep;
  return runs;
}

function parseRun(machine, chunk) {
  const [dir, orchFile, statusFile, plan, question, asked, parkedFile, closedFile, inbox, proofFile, proofNames, decidedFile, requests, acceptedFile, reportNames] = chunk.split(US);
  const orch = json(orchFile) ?? {};
  const status = json(statusFile) ?? {};
  const tasks = tasksOf(plan);
  const statusLine = /^Status:\s*(.*)$/m.exec(plan ?? "")?.[1]?.trim() ?? null;
  const folder = orch.folder ?? status.folder ?? "";
  const autonomy = /^L[0-2]$/.test(status.autonomy) ? status.autonomy : "L0";
  const tier = runTier(plan, tasks);
  const parts = dir.split("/");
  const onMachine = (id) => (id ? (machine ? `${machine}/${id}` : id) : null);
  return {
    key: `${machine ?? ""}:${dir}`,
    machine,
    dir,
    repo: parts.at(-2) ?? folder.split("/").pop(),
    folder,
    branch: orch.branch ?? status.branch ?? parts.at(-1),
    terminal: onMachine(orch.terminal),
    // The terminal as its own machine names it, for hc run there (`on: machine`),
    // which does not know the window's name for itself.
    localTerminal: orch.terminal ?? null,
    tab: onMachine(orch.tab_id),
    kind: orch.kind ?? null,
    away: marker("closed", closedFile) ?? marker("parked", parkedFile),
    statusLine,
    phase: runPhase(statusLine ?? status.status),
    // What kind of run: feat, fix, rev or expl (set-status.sh --type).
    type: status.type ?? null,
    topic: status.topic ?? null,
    // How much the orchestrator decides itself (set-status.sh --autonomy); a missing one is L0.
    autonomy,
    // Levels asked for from a tag's popover and not applied yet: {autonomy: "L2" | null, tier: 2 | null}.
    pending: pendingLevels(requests, { autonomy, tier: tier?.tier ?? null }),
    // Decisions it made itself, newest first (decisions.md).
    decided: parseDecidedLines(decidedFile),
    progress: status.progress ?? null,
    merged: status.tasks?.merged ?? null,
    planned: status.tasks?.planned ?? null,
    issues: status.issues ?? [],
    prs: (status.prs ?? []).map((p) => (typeof p === "string" ? { url: p } : p)),
    // PRs the run is about but did not open, such as the one a review-only run reviews.
    related: (status.related ?? []).map((p) => (typeof p === "string" ? { url: p } : p)),
    waiting: status.waiting ?? [],
    tokens: tokensOf(status.tokens),
    // The soft token budget (set-status.sh --budget), or null; `over` once tokens.total reaches it.
    budget: Number(status.budget) > 0 ? Number(status.budget) : null,
    // The budget the question was answered for (set-status.sh --budget-answered).
    budgetAnswered: Number(status.budget_answered) || null,
    updated: status.updated ? Date.parse(status.updated) : null,
    // What of the run's files bears on its PRs (prFilesSig): when it changes, its PRs are read soon
    // (refreshPrs), not at the backstop.
    filesSig: prFilesSig(status, plan, proofFile),
    // When the run was created (init-run.sh); null for runs from before it recorded that.
    started: Date.parse(orch.started ?? "") || null,
    question: question?.trim() || null,
    // The question read into its sections (question.js), and when it was asked, in ms.
    ask: parseQuestion(question),
    askedAt: Number(asked?.trim()) * 1000 || null,
    unhandled: Number(inbox?.trim() || 0),
    // An ask what is blocking (inbox.js) still unread in the inbox.
    blockingAsked: blockingPending(requests),
    // An Ask for changes (inbox.js) still unread: the run is not ready to merge until it is handled.
    changesAsked: changesPending(requests),
    // The PRs an Address comments (comments.js) is still unread for, by URL.
    commentsAsked: pendingComments(requests),
    // A Re-review first (inbox.js) still unread.
    rereviewAsked: rereviewPending(requests),
    tasks,
    // How far the branch is past its last Reviewed commit (refreshReviewed), null until read.
    reviewedGap: reviewGaps.get(`${machine ?? ""}:${dir}`) ?? null,
    // The run's proof: its tier, its claims (plan.md's `## Claims`; [] for an old run), proof.md's
    // results by claim and task id, and the file names in shared/proof/.
    proof: {
      tier,
      claims: parsePlanClaims(plan),
      md: /^[+!]/.test(proofFile ?? "") ? { ...parseProofMd(proofFile.slice(1)), cut: proofFile[0] === "!" } : null,
      files: (proofNames ?? "").split("\n").map((f) => f.trim()).filter(Boolean),
      // Tasks the user accepted as they are (proof-accepted.json), and asks to prove still unread.
      accepted: parseAccepted(acceptedFile),
      asks: pendingProofs(requests),
    },
    // shared/'s Markdown files (names, as ls sorts them); needaction.js runReports picks its reports.
    reports: (reportNames ?? "").split("\n").map((f) => f.trim()).filter(Boolean),
    // What every agent name of the run starts with after its role: impl-<prefix>-<task>.
    prefix: /^Prefix:\s*`?([\w-]+)/m.exec(plan ?? "")?.[1]?.toLowerCase() ?? null,
  };
}

// The run's token use, as tokens.sh counted it into status.json: totals and each
// agent's share (orchestrator first, then by size), or null before the first count.
function tokensOf(x) {
  const n = (v) => Number(v) || 0;
  if (!(n(x?.total) > 0)) return null;
  return {
    total: n(x.total), input: n(x.input), output: n(x.output), cacheRead: n(x.cache_read), cacheWrite: n(x.cache_write),
    byAgent: (Array.isArray(x.by_agent) ? x.by_agent : []).filter((a) => a?.name && n(a.total) > 0).map((a) => ({
      name: String(a.name), total: n(a.total), input: n(a.input), output: n(a.output), cacheRead: n(a.cache_read), cacheWrite: n(a.cache_write),
      // A count from before tokens.sh split them has only a total: its bar is all one colour.
      split: a.cache_read !== undefined,
    })),
    updated: Date.parse(x.updated ?? "") || null,
  };
}

// Whether a run has used its soft budget, from status.json alone (so also for a run whose
// orchestrator is gone, or on another machine).
export const overBudget = (r) => Boolean(r.budget && r.tokens && r.tokens.total >= r.budget);

// Whether Harbormaster asks a run's budget question itself (decisionQueue's budget item): over
// budget, no question.md, not parked, closed or finished, and that budget not answered yet. The
// queue also waits for its orchestrator to settle; attend.js reads this so an idle orchestrator
// is not also said to be asking in its tab (attention.js idleAsking).
export const budgetPending = (r) => overBudget(r) && r.askedAt === null && !r.question && !r.away && r.phase !== "finished" && r.budgetAnswered !== r.budget;

// The budget question's options, as run-files.md's template words them. Compact is the one
// button that does more than write the answer: compactRun sends /compact first.
export const BUDGET_OPTIONS = [
  { label: "Continue", text: "raise the budget (the answer may carry a new number, else it doubles) and carry on" },
  { label: "Compact", text: "compact the orchestrator's context, then carry on" },
  { label: "Stop", text: "finish the current step, commit and push everything, then park the run" },
];
export const isCompact = (label) => /^compact$/i.test(label ?? "");
// Whether a queue item is the budget question, by kind or by the template's title (run-files.md).
// Narrow on purpose: Compact types /compact, so a question about some other "budget" must not match.
export const isBudgetQuestion = (it) => it.kind === "budget" || /^Over the token budget/i.test(it.title ?? "");

// A budget item for the queue, for a run over budget with no question.md (the orchestrator
// is gone, or has not asked yet): the same three options, recommended the way the
// orchestrator's own question is: Continue when most tasks are done, else Compact.
function budgetItem(r, tokenText) {
  const { done, planned } = taskCounts(r);
  const mostlyDone = planned > 0 && done / planned >= 0.5;
  const top = r.tokens.byAgent.slice(0, 3).map((a) => `${a.name} ${tokenText(a.total)}`).join(", ");
  return {
    id: `need-${r.key}`, kind: "budget", title: `Over budget: ${tokenText(r.tokens.total)} of ${tokenText(r.budget)} tokens`,
    options: BUDGET_OPTIONS, recommended: mostlyDone ? 0 : 1,
    why: mostlyDone ? "most tasks are done" : "much work is left; a smaller context is cheaper",
    evidence: `${tokenText(r.tokens.total)} used${planned ? `, ${done}/${planned} tasks done` : ""}${top ? `; largest: ${top}` : ""}`,
    risk: "Continue keeps spending; Stop parks the run until you resume it; Compact drops the orchestrator's context, which it re-reads from the run files.",
    blocks: "nothing is blocked: it is a soft budget", since: r.updated ?? r.started, run: r, answered: r.unhandled > 0,
  };
}

// A parked or closed marker, "+" and its first line: { how, at, was }, or null without one.
function marker(how, text) {
  if (!text?.startsWith("+")) return null;
  const [at, was] = text.slice(1).split("\n")[0].split("\t");
  return { how, at: Date.parse(at) || null, was: was?.trim() || null };
}

// Every copy asks through one cache, so a layout with several copies reads once.
// The cache is module state, so it outlives every copy. A read whose task is cancelled
// (its view closed) never settles, so a read pending longer than STALE_READ is given up
// and a new one started; the abandoned one, should it ever settle, is ignored.
let cache = { at: 0, runs: [], decisions: [], errors: [], failed: [], pending: null, pendingAt: 0 };
const STALE_READ = 45000;
let reads = 0;

export function cachedRuns() {
  return cache;
}

// A run read older than this no longer counts as read: the polls have stopped answering.
const FILES_MAX_AGE = 2 * 60000;

// Whether the run's files are a fresh read in `c` (cachedRuns): not carried from an earlier
// read of a machine that failed (carryRuns), its machine answered the last poll, and that poll
// is recent.
export function filesFresh(run, now = Date.now(), c = cache) {
  return !run.stale && now - c.at < FILES_MAX_AGE && !(c.failed ?? []).includes(run.machine ?? null);
}

// The runs of machines that failed this read (`failed`: their names, null for this one), from
// the last read, marked `stale: true`, so they still show, as "can't tell", instead of
// vanishing; and their PR entries are kept, since refreshPrs forgets only runs not in the
// cache. A run already marked stays the same object.
export function carryRuns(prev, failed) {
  const out = new Set(failed.map((m) => m ?? null));
  return (prev ?? []).filter((r) => out.has(r.machine ?? null)).map((r) => (r.stale ? r : { ...r, stale: true }));
}

export function loadRuns() {
  if (Date.now() - cache.at < 2500) return Promise.resolve(cache);
  if (cache.pending && Date.now() - cache.pendingAt < STALE_READ) return cache.pending;
  const read = ++reads;
  cache.pendingAt = Date.now();
  cache.pending = (async () => {
    const all = machines();
    const names = all.filter((m) => m.layout !== "unavailable").map((m) => m.name);
    if (!names.includes(null)) names.unshift(null);
    // An unavailable (offline) machine is not asked, and counts as failed: its runs are carried.
    const failed = all.filter((m) => m.layout === "unavailable" && m.name !== null).map((m) => m.name);
    const runs = [], decisions = [], errors = [], answered = new Set(), samples = [];
    await Promise.all(names.map(async (on) => {
      try {
        const out = await exec("sh", ["-c", SCRIPT], { on });
        // A machine that could not be reached prints nothing and fails.
        if (out.code !== 0 && !out.stdout.trim()) throw new Error((out.stderr || `exit ${out.code}`).trim());
        const [files, sample] = out.stdout.split(GS);
        decisions.push(...parseDecisions(on, files.split(RS)[0]));
        runs.push(...parse(on, files));
        samples.push([on, sample]);
        answered.add(on ?? "");
      } catch (e) {
        errors.push(`${on ?? "this machine"}: ${e?.message ?? e}`);
        failed.push(on);
      }
    }));
    const fresh = [...runs];
    runs.push(...carryRuns(cache.runs, failed));
    runs.sort((a, b) => (a.machine ?? "").localeCompare(b.machine ?? "") || a.dir.localeCompare(b.dir));
    decisions.sort((a, b) => (a.asked ?? 0) - (b.asked ?? 0));
    if (read !== reads) return cache;
    // `failed`: the machines (null for this one) whose runs could not be read this time; their
    // runs from the last read stay in `runs`, marked `stale` (carryRuns). Only the runs just
    // read (`fresh`) are acted on below: nothing is done on a stale read.
    cache = { at: Date.now(), runs, decisions, errors, failed, pending: null, pendingAt: 0 };
    const ctx = facts();
    observeRuns(runs, ctx, answered, (r) => r.tasks.map((k) => shownStage(k, taskAgents(k, r, ctx))));
    for (const [on, sample] of samples) ingest(on, sample);
    recordRuns(fresh.filter((r) => !r.away && orchestratorState(r, ctx) !== "gone"), (r) => runTerminals(r, ctx), answered).catch(() => {});
    for (const r of fresh) if (r.away?.how === "closed") tidyClosed(r, ctx).catch(() => {});
    for (const r of fresh) if (r.machine && !r.away) nameTab(r);
    nameCaptainTab(ctx);
    showWorktrees(fresh, ctx, answered).catch(() => {});
    return cache;
  })().catch((e) => {
    if (read !== reads) return cache;
    cache = { ...cache, pending: null, pendingAt: 0, errors: [String(e)] };
    return cache;
  });
  return cache.pending;
}

// The run's terminals for its CPU and memory totals: its orchestrator and every live terminal
// under it (agents, and the commands they started with hc run), each with its name and its
// parent's (its name, else address), so the totals group by agent and task.
function runTerminals(r, ctx) {
  const nameOf = (address) => ctx.terminals.find((t) => t.address === address)?.name || address;
  return [{ address: r.terminal, name: nameOf(r.terminal), parent: null },
    ...workersOf(r.terminal, ctx).map((w) => ({ address: w.address, name: w.name || w.address, parent: nameOf(w.parent) }))];
}

// ---- tasks ----


// The stage an agent works on, from its role in its name: impl-, rev-, fix-, grunt-.
const ROLE_STAGE = { impl: "implement", rev: "review", fix: "fix", grunt: "implement" };

// A task's live agents among the orchestrator's own (not their helpers, such as a dev
// server), by name: <role>-<prefix>-<task id or name>, with an optional -<round>. Without
// a prefix in plan.md, a name ending in the task's id or name; a number alone is too
// loose for that ("rev-1088-final-1"). As [{agent, stage}], reviewers first.
export function taskAgents(task, run, ctx) {
  if (!run.terminal) return [];
  const keys = [task.id, task.name].map((k) => (k ?? "").toLowerCase()).filter((k) => /^[\w-]+$/.test(k));
  const fits = (rest) => keys.some((k) => (run.prefix
    ? rest === `${run.prefix}-${k}` || new RegExp(`^${run.prefix}-${k}-\\d+$`).test(rest)
    : !/^\d+$/.test(k) && (rest.endsWith(`-${k}`) || new RegExp(`-${k}-\\d+$`).test(rest))));
  const order = ["review", "fix", "implement"];
  return ctx.terminals
    .filter((t) => t.parent === run.terminal && t.state === "live" && t.name)
    .map((t) => ({ agent: t, m: /^(impl|rev|fix|grunt)-(.+)$/.exec(t.name.toLowerCase()) }))
    .filter(({ m }) => m && fits(m[2]))
    .map(({ agent, m }) => ({ agent, stage: ROLE_STAGE[m[1]] }))
    .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
}

// The stage a task shows: plan.md's, else, when plan.md names none or not yet, what its
// live agents do (a reviewer at work means review). Never a live agent's over a done task.
export function shownStage(task, agents) {
  const stage = taskStage(task.state);
  if (stage && stage !== "planned") return stage;
  return agents[0]?.stage ?? stage;
}

// taskCounts for a record (the stats view, the history line), so a run's row says what its card
// said; nulls when neither plan.md nor status.json says anything. The record keeps the field's
// old name, tasks_merged (run-files.md says what it counts since when).
export function recordedCounts(run) {
  if (!run.tasks?.length && run.merged == null && run.planned == null) return { done: null, planned: null };
  return taskCounts(run);
}

// ---- pull requests (gh), cached in shared state so every copy and layout reuses them ----

// reviewRequests for "review from <name>"; headRefOid so each CI run is recorded once (tracking.js recordCi).
export const PR_FIELDS = "number,title,state,isDraft,reviewDecision,reviews,reviewRequests,author,statusCheckRollup,url,headRefName,headRefOid,body,updatedAt";
// Run key → when its refresh started. Like a run read, a refresh whose task is cancelled
// never ends, so one older than PR_STALE no longer holds the run back.
const prBusy = new Map();
// Run key → start of the newest read that wrote its PRs: an older read finishing later must not overwrite it.
const prWritten = new Map();
const PR_STALE = 5 * 60000;
// Run key → {files, heads}: the run's filesSig and pushed heads (headsMoved) as of its last read that
// had no error, so refreshPrs reads again only when they change (and tries again after a failed read).
// Module memory, like prReads: every Harbormaster copy shares this module, so the floor holds across copies.
const prSeen = new Map();
// Run key → when the user last opened the run in Harbormaster (markOpened), until a poll's refreshPrs
// has decided on it. Module memory too, so a click in one copy is read by whichever copy polls next.
const opened = new Map();

// A PR's state → a theme tone; the harbor maps the same tones to its own colors. An open PR is
// muted: no colour means fine (see cardparts.js AMBER); what it waits on has a colour of its own.
export const PR_TONE = { OPEN: "muted", DRAFT: "dim", MERGED: "done", CLOSED: "blocked" };

function checks(rollup) {
  const c = { pass: 0, fail: 0, pending: 0 };
  for (const x of rollup ?? []) c[checkKind(x)]++;
  return c;
}

// A rollup's first failing check, {name, url}, for what a red CI's Needs-you line names and its
// Open the failing check opens: a check run's name and details page, or a status's context and
// target; null when none fails. url is null when GitHub gave none (the PR's checks tab then).
export function firstFailing(rollup) {
  const x = (rollup ?? []).find((c) => checkKind(c) === "fail");
  if (!x) return null;
  return { name: x.name || x.context || x.workflowName || null, url: x.detailsUrl || x.targetUrl || null };
}

// Each reviewer's standing review, as the GH mod reads it: a later comment doesn't
// undo an approval or a change request. Leaves out the PR's author and bots.
function standing(p) {
  const by = {};
  for (const r of p.reviews ?? []) {
    const who = r.author?.login;
    if (!who || who === p.author?.login || who.endsWith("[bot]") || who === "coderabbitai") continue;
    if (r.state === "PENDING" || (r.state === "COMMENTED" && by[who] && by[who] !== "COMMENTED")) continue;
    by[who] = r.state;
  }
  const with_ = (state) => Object.keys(by).filter((who) => by[who] === state);
  // When the latest of those reviews came, for how long the run has waited on the user since.
  const counted = (p.reviews ?? []).filter((r) => by[r.author?.login] && r.state !== "PENDING");
  const times = counted.map((r) => Date.parse(r.submittedAt ?? "")).filter(Boolean);
  return { approvedBy: with_("APPROVED"), changesBy: with_("CHANGES_REQUESTED"), reviewedAt: times.length ? Math.max(...times) : null };
}

// The first line of a PR body's `## Merge danger` section ("Two-way door — …"), or null.
// Only this line is kept, so the cached PR stays small.
export function mergeDanger(body) {
  const m = /^##[ \t]+Merge danger[ \t]*\r?\n([\s\S]*?)(?=^#{1,2}[ \t]|(?![\s\S]))/im.exec(body ?? "");
  const line = m?.[1].split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("```"));
  const clean = line?.replace(/^[-*>]\s+/, "").replace(/\*\*|__|`/g, "").replace(/^[*_]+([^*_]+?)[*_]+/, "$1").trim();
  return clean ? clean.slice(0, 600) : null;
}

// The viewer's own latest review on a PR: "PENDING" while they have one unsubmitted (GitHub allows
// one, and it is the newest), else the state of their last submitted review, or null.
export function viewerReview(reviews, viewer) {
  const mine = (reviews ?? []).filter((r) => r.author?.login === viewer);
  if (mine.some((r) => r.state === "PENDING")) return "PENDING";
  return mine.length ? mine[mine.length - 1].state : null;
}

// Who the viewer is on a machine (`gh api user`), asked once per machine; null when gh cannot say
// (asked again next refresh).
const viewers = new Map();
async function viewerOf(run) {
  const key = run.machine ?? "";
  if (viewers.has(key)) return viewers.get(key);
  const res = await exec("gh", ["api", "user", "-q", ".login"], { on: run.machine }).catch(() => null);
  const login = res?.code === 0 ? res.stdout.trim() : "";
  if (login) viewers.set(key, login);
  return login || null;
}

// What the views need from `gh pr view --json` output. GitHub only sets reviewDecision
// where the repo requires a review, so the review comes from the reviews themselves,
// falling back to reviewDecision ("Review needed") when nobody has approved or objected.
// `requested`: the reviewers asked and yet to answer (a user's login, a team's name);
// GitHub drops one from reviewRequests once they review. `ci`: when its checks started and,
// once none is pending, finished (attention.js ciTimes).
export function prSummary(p, repo, viewer = null) {
  const { approvedBy, changesBy, reviewedAt } = standing(p);
  return {
    number: p.number,
    title: p.title,
    state: p.isDraft && p.state === "OPEN" ? "DRAFT" : p.state,
    review: changesBy.length ? "CHANGES_REQUESTED" : approvedBy.length ? "APPROVED" : p.reviewDecision || null,
    approvedBy,
    changesBy,
    reviewedAt,
    mine: viewer ? viewerReview(p.reviews, viewer) : null,
    requested: (p.reviewRequests ?? []).map((r) => r?.login ?? r?.name ?? r?.slug).filter(Boolean),
    checks: checks(p.statusCheckRollup),
    failed: firstFailing(p.statusCheckRollup),
    ci: ciTimes(p.statusCheckRollup),
    sha: p.headRefOid ?? null,
    // The head branch: its remote-tracking ref tells a push before GitHub is asked (refreshPrs headsMoved).
    head: p.headRefName ?? null,
    // Who opened it, for the reviewers to ask (reviewers.js leaves them out).
    author: p.author?.login ?? null,
    // When anything on the PR last changed: its review comments are read again only then (withComments).
    updatedAt: p.updatedAt ?? null,
    url: p.url,
    danger: mergeDanger(p.body),
    repo: repo ?? (/github\.com\/([^/]+\/[^/]+)\//.exec(p.url ?? "")?.[1] ?? null),
  };
}

// True for a "One-way door — …" line.
export const oneWay = (danger) => /^\W*one[- ]way/i.test(danger ?? "");

// A PR recorded in status.json that gh hasn't described (yet).
export const unknownPr = (url, repo = null) =>
  ({ number: null, title: url, state: "UNKNOWN", review: null, checks: { pass: 0, fail: 0, pending: 0 }, url, repo });

export function prsOf(run) {
  return shared("harbormaster.prs")?.[run.key]?.list ?? null;
}

// When each run's PRs were last read, {at, okAt} by run key. Module memory, not shared state:
// it changes with every read, and a shared write redraws every Harbormaster copy, so
// harbormaster.prs is written only when what a read found changes (prEntrySame). After a reload
// it is empty until the first read, which comes as soon as one is due by the shared entry's own `at`,
// the time of its last change (at most PR_BACKSTOP_CAP runs per poll).
const prReads = new Map();

// The entry with the latest read times: the later of the shared entry's and module memory's.
export function withReadTimes(entry, read) {
  if (!entry) return null;
  if (!read) return entry;
  return { ...entry, at: Math.max(entry.at ?? 0, read.at ?? 0), okAt: Math.max(entry.okAt ?? 0, read.okAt ?? 0) || null };
}

// Whether a new read found what the stored entry holds: the same PRs, related PRs and errors.
export const prEntrySame = (a, b) => Boolean(a && b) && JSON.stringify([a.list, a.related, a.error ?? null, a.relatedError ?? null])
  === JSON.stringify([b.list, b.related, b.error ?? null, b.relatedError ?? null]);

// The run's whole PR read, {at, okAt, error, list, related}, or null before the first: for
// attention.js prRead, which needs to know whether the list can be trusted.
export function prEntryOf(run) {
  return withReadTimes(shared("harbormaster.prs")?.[run.key] ?? null, prReads.get(run.key));
}

// The run's related PRs: shown beside its issues, never counted as its own.
export function relatedOf(run) {
  return shared("harbormaster.prs")?.[run.key]?.related ?? run.related.map((p) => unknownPr(p.url, p.repo));
}

// The pushed head commits of the run's open PRs, from its repositories: for each head branch, its
// remote-tracking ref, which moves on a push (or a fetch of someone else's). Not the local branch: a
// commit that is only local (a task merged into the integration branch before it is validated and
// pushed) can't change anything GitHub shows. One line per branch and repository,
// "<repo>\t<branch>\t<origin sha>". One cheap git call, no gh.
const HEADS = [
  'folder=$1; shift',
  'for r in "$folder" "$folder"/*/; do',
  '  [ -e "$r/.git" ] || continue',
  '  for b in "$@"; do',
  '    if o=$(git -C "$r" rev-parse -q --verify "refs/remotes/origin/$b^{commit}" 2>/dev/null); then printf "%s\\t%s\\t%s\\n" "$r" "$b" "$o"; fi',
  '  done',
  'done',
].join("\n");
const HEADS_TTL = 15_000;
const headChecks = new Map(); // run key → when its heads were last looked at
const headsNow = new Map(); // run key → what headsMoved last found

// The open PRs of a read list whose head branch is known: the ones a push can move.
const movable = (list) => (list ?? []).filter((p) => (p.state === "OPEN" || p.state === "DRAFT") && p.head && p.sha);

// Looks at the pushed head commits of the run's open PRs, at most every HEADS_TTL: the sorted list
// of the remote-tracking refs at a sha other than the ones last read from GitHub
// ("<repo>/<branch>:<sha>"), as one string ("" when none differs), or null when it was not looked at
// (too soon, nothing to look at, git failed).
export async function headsMoved(run, list) {
  const open = movable(list);
  if (!open.length || !run.folder) return null;
  if (Date.now() - (headChecks.get(run.key) ?? 0) < HEADS_TTL) return null;
  headChecks.set(run.key, Date.now());
  const branches = [...new Set(open.map((p) => p.head))];
  const out = await exec("sh", ["-c", HEADS, "sh", run.folder, ...branches], { on: run.machine, timeout: 8000 }).catch(() => null);
  if (out?.code !== 0) return null;
  const read = new Set(open.map((p) => p.sha));
  const moved = new Set();
  for (const line of out.stdout.split("\n")) {
    const [repo, b, sha] = line.split("\t").map((x) => x?.trim());
    if (!b || !branches.includes(b)) continue;
    if (/^[0-9a-f]{40}$/.test(sha ?? "") && !read.has(sha)) moved.add(`${repo.replace(/\/+$/, "")}/${b}:${sha}`);
  }
  const found = [...moved].sort().join(",");
  headsNow.set(run.key, found);
  return found;
}

// First and backstop reads started lately, so at most PR_BACKSTOP_CAP of them start per poll
// (PR_BACKSTOP_WINDOW_MS). After a reload every run's read is due at once (the mod's memory is gone,
// and the shared entry's `at` is its last change), and 20 runs would read in one pass; capped, they
// take a few polls. The run's own events and force are not capped: they are few and floored.
export const PR_BACKSTOP_CAP = 3, PR_BACKSTOP_WINDOW_MS = 5000;
let backstopStarts = [];
function backstopSlot() {
  const now = Date.now();
  backstopStarts = backstopStarts.filter((t) => now - t < PR_BACKSTOP_WINDOW_MS && t <= now);
  if (backstopStarts.length >= PR_BACKSTOP_CAP) return false;
  backstopStarts.push(now);
  return true;
}

// Why a run's PRs are read now, or null when not: "forced" (after an action), "first" (no read yet),
// "backstop" (prTtl plus the run's prOffset; both capped per poll, backstopSlot), "opened" (the user
// opened the run, markOpened, and the last read is over PR_OPENED_MS), "files" (the run's files changed
// since the last read) or "head" (a push moved a PR's remote-tracking ref, and that state of the refs
// was not read yet). The run's own events and "opened" wait out PR_EVENT_FLOOR_MS since the last read,
// whatever fires. A push read before GitHub has it leaves the ref differing from what was read, so
// "head" fires once per state of the refs (`last.heads`), not on every look (the backstop catches up).
export async function prTrigger(run, closed, have, last, { force = false, reason = null } = {}) {
  if (force) return "forced";
  if (!have) return backstopSlot() ? "first" : null;
  const age = Date.now() - (have.at ?? 0);
  if (age >= prTtl(closed) + prOffset(run.key) && backstopSlot()) return "backstop";
  if (age < PR_EVENT_FLOOR_MS) return null;
  if (reason === "opened" && age >= PR_OPENED_MS) return "opened";
  if (run.filesSig && last?.files && last.files !== run.filesSig) return "files";
  if (closed) return null;
  const heads = await headsMoved(run, have.list);
  if (heads && heads !== (last?.heads ?? "")) return "head";
  return null;
}

// Refreshes a run's PRs when something calls for it (prTrigger): its own events within ~30 s
// (PR_EVENT_FLOOR_MS), else the backstop: every 5 min while the run is open, every 30 min once
// closed or parked (`closed`), each put off by the run's prOffset. On a closed or parked run a PR
// last read as merged or closed keeps its summary and is not read again: a run whose PRs are all
// done makes no gh calls once put away. An open run still reads them (a PR may be reopened).
// A PR gh could not read keeps its last summary, marked `stale`, or is unknownPr; the
// entry's `error` says why (null when every PR was read) and `okAt` is the last read
// that got them all, so a failing gh shows as "can't tell" instead of old data passing as new.
// `opts`: `true` (or {force: true}) reads at once, whatever its age or a read in progress (after an
// action changed a PR). A run the user opened (markOpened) is asked with reason "opened"; the mark
// is used up once this has decided, not while another read or decision holds the run.
// Returns why it read (prTrigger), null when it decided not to, or "busy" when it did not decide.
export async function refreshPrs(run, closed = false, opts = false) {
  const { force = false } = opts === true ? { force: true } : (opts || {});
  const have = withReadTimes((shared("harbormaster.prs") ?? {})[run.key], prReads.get(run.key));
  const last = prSeen.get(run.key);
  // The first look after a reload knows no earlier files: they are taken as read.
  if (!last && run.filesSig) prSeen.set(run.key, { files: run.filesSig, heads: "" });
  if (force) prBusy.delete(run.key);
  else if (Date.now() - (prBusy.get(run.key) ?? 0) < PR_STALE) return "busy";
  // Claimed before deciding: deciding may wait on git, and another copy must not start a read meanwhile.
  const started = Date.now();
  prBusy.set(run.key, started);
  const mark = opened.get(run.key);
  try {
    const why = await prTrigger(run, closed, have, last ?? prSeen.get(run.key), { force, reason: mark != null ? "opened" : null });
    // A newer opening during the decision is a new mark, kept for the next poll.
    if (mark != null && opened.get(run.key) === mark) opened.delete(run.key);
    if (!why) return null;
    // What this read is about to see, kept once it had no error, so the same files or pushed heads do
    // not fire it again, while a failed read is tried again at the next poll past the floor.
    const seen = { files: run.filesSig ?? null, heads: headsNow.get(run.key) ?? (last ?? prSeen.get(run.key))?.heads ?? "" };
    let error = null;
    // Only a review run's related PR needs the viewer: whether their review there is submitted.
    const viewer = run.type === "rev" ? await viewerOf(run) : null;
    const view = async (recorded, before, own = false) => {
      const out = [];
      for (const pr of recorded) {
        if (!pr.url) continue;
        const done = closed ? before?.find((x) => x.url === pr.url && (x.state === "MERGED" || x.state === "CLOSED")) : null;
        if (done) { const { stale, ...kept } = done; out.push(kept); continue; }
        const res = await exec("gh", ["pr", "view", pr.url, "--json", PR_FIELDS], { on: run.machine }).catch((e) => ({ code: -1, stderr: e?.message ?? String(e) }));
        const p = res?.code === 0 ? json(res.stdout) : null;
        if (p) { out.push(own ? await withComments(prSummary(p, pr.repo), run, before?.find((x) => x.url === pr.url)) : prSummary(p, pr.repo, own ? null : viewer)); continue; }
        error ??= `gh could not read ${pr.url}: ${(res?.stderr || res?.stdout || `exit ${res?.code}`).trim().split("\n")[0].slice(0, 200)}`;
        const old = before?.find((x) => x.url === pr.url && x.state !== "UNKNOWN");
        out.push(old ? { ...old, stale: true } : unknownPr(pr.url, pr.repo));
      }
      return out;
    };
    const related = await view(run.related, have?.related);
    const relatedError = error;
    error = null;
    const list = await view(run.prs, have?.list, true);
    if (!error && !relatedError) prSeen.set(run.key, seen);
    if ((prWritten.get(run.key) ?? 0) > started) return why;
    prWritten.set(run.key, started);
    const stored = shared("harbormaster.prs") ?? {};
    const next = { ...stored };
    const at = Date.now();
    const entry = { at, okAt: error ? have?.okAt ?? null : at, error, relatedError, list, related };
    prReads.set(run.key, { at, okAt: entry.okAt });
    let changed = !prEntrySame(stored[run.key], entry);
    if (changed) next[run.key] = entry;
    // Forget runs that are gone.
    for (const key of Object.keys(next)) {
      if (cache.runs.length && !cache.runs.some((r) => r.key === key)) { delete next[key]; for (const m of [prReads, prSeen, headChecks, headsNow, opened]) m.delete(key); changed = true; }
    }
    if (changed) setShared("harbormaster.prs", next);
    recordCi(list);
    return why;
  } finally {
    if (prBusy.get(run.key) === started) prBusy.delete(run.key);
  }
}

// The user opened a run in Harbormaster (a Crew row, a card, the harbor, a toast, a run pane showing
// it): the next poll's refreshPrs, in whichever copy, reads its PRs when the last read is over
// PR_OPENED_MS old, else does nothing. Synchronous and cheap, for click handlers; never reads itself.
// Each opening is one mark, so a pane left open reads only through the other triggers, not by
// itself every minute: the user asked for "when you open". `run` is a run or its key.
export function markOpened(run) {
  const key = typeof run === "string" ? run : run?.key;
  if (key) opened.set(key, Date.now());
}

// ---- who could review (reviewers.js) ----
// Earlier reviewers by "owner/repo", {at, list}: module memory, 30 minutes (a failed read, one).
const reviewerCache = new Map();
const reviewerBusy = new Set();
const REVIEWERS_TTL = 30 * 60000, REVIEWERS_FAILED_TTL = 60000;

// The earlier reviewers of `repo` for a PR by `author` as read, or null while unread or being read.
export function cachedReviewers(run, repo, author = null) {
  const e = reviewerCache.get(`${run.machine ?? ""}:${repo}`);
  return e && Date.now() - e.at < (e.ok ? REVIEWERS_TTL : REVIEWERS_FAILED_TTL) ? reviewerCandidates(e.prs, { viewer: e.viewer, author }) : null;
}

// Reads the repository's recent PRs (`gh pr list`) and keeps them for cachedReviewers; quietly
// reads nothing when gh fails. Resolves when done, so the caller can redraw.
export async function loadReviewers(run, repo) {
  const id = `${run.machine ?? ""}:${repo}`;
  if (!repo || reviewerBusy.has(id) || cachedReviewers(run, repo) !== null) return;
  reviewerBusy.add(id);
  try {
    const res = await exec("gh", reviewersArgs(repo), { on: run.machine }).catch(() => null);
    const prs = res?.code === 0 ? json(res.stdout) : null;
    reviewerCache.set(id, { at: Date.now(), ok: Array.isArray(prs), prs: Array.isArray(prs) ? prs : [], viewer: await viewerOf(run).catch(() => null) });
  } finally { reviewerBusy.delete(id); }
}

// Asks `login` to review the PR at `url` with `gh pr edit --add-reviewer` (a draft is marked ready
// first). Resolves to {} on success, else {error: gh's first line}. Never throws; the login is
// checked here too (reviewers.js requestArgs). When the PR was marked ready but the request then
// failed, the error carries `readied: true`, so the view says the PR left draft.
export async function requestReview(run, url, login, { draft = false } = {}) {
  const args = requestArgs(url, login);
  if (!args) return { error: "not a reviewer to ask" };
  const gh = (a) => exec("gh", a, { on: run.machine }).catch((e) => ({ code: -1, stderr: e?.message ?? String(e) }));
  const why = (res) => (res?.stderr || res?.stdout || `gh exited ${res?.code}`).trim().split("\n")[0].slice(0, 200);
  if (draft) { const ready = await gh(["pr", "ready", url]); if (ready.code !== 0) return { error: why(ready) }; }
  const res = await gh(args);
  if (res.code === 0) return {};
  return draft ? { error: `Marked ready; requesting review failed: ${why(res)}`, readied: true } : { error: why(res) };
}

// Whether the repository's earlier reviewers are being read now.
export const loadingReviewers = (run, repo) => reviewerBusy.has(`${run.machine ?? ""}:${repo}`);

// An approved or changes-requested open PR with its review comments read (comments.js
// commentSummary) as `comments`; {error} when gh could not read them, so they show as unknown,
// never as none. Other PRs are returned as they are. The answer is large (a busy PR's runs to
// 140 kB), so `old` (the PR as last read) keeps its summary while the PR's updatedAt is the same,
// and otherwise for COMMENTS_TTL; a failed read is tried again at the next refresh.
export async function withComments(pr, run, old = null) {
  if (pr.state !== "OPEN" && pr.state !== "DRAFT") return pr;
  if (pr.review !== "APPROVED" && pr.review !== "CHANGES_REQUESTED") return pr;
  const args = commentsArgs(pr.url);
  if (!args) return pr;
  // A summary stored before comments were classed (no `threads`) is read again once.
  const prev = old?.url === pr.url && old.comments && !old.comments.error && old.comments.threads != null ? old.comments : null;
  if (prev && ((pr.updatedAt && prev.updatedAt === pr.updatedAt) || Date.now() - (prev.at ?? 0) < COMMENTS_TTL)) return { ...pr, comments: prev };
  const res = await exec("gh", args, { on: run.machine }).catch((e) => ({ code: -1, stderr: e?.message ?? String(e) }));
  const summary = res?.code === 0 ? commentSummary(json(res.stdout)) : null;
  const error = summary ? null : (res?.code === 0 ? "gh gave no pull request" : (res?.stderr || res?.stdout || `exit ${res?.code}`).trim().split("\n")[0].slice(0, 200));
  return { ...pr, comments: summary ? { ...summary, updatedAt: pr.updatedAt ?? null, at: Date.now() } : { error } };
}

// How often a PR whose updatedAt moved has its review comments read again, at most.
export const COMMENTS_TTL = 5 * 60_000;

// ---- totals ----

// A run is closed when the person closed it for good (a closed marker), or once it is
// finished and its orchestrator's terminal is gone: they closed its tab. A lost
// orchestrator (only a shell left in its terminal) still has its tab, so is not closed. A finished run
// whose orchestrator is still there stays open, with its PR up. An unfinished run whose
// terminal is gone is not closed: it is parked if they set it aside, else gone, which
// the captain asks about and the run's card offers to resume.
export function isClosed(run, ctx) {
  if (run.away) return run.away.how === "closed";
  return run.phase === "finished" && orchestratorState(run, ctx) === "gone" && !orchestratorLost(run, ctx);
}
export const isParked = (run) => run.away?.how === "parked";

// The time a run sorts by in its section, newest first: when it was parked or closed,
// else for an unfinished run when it started, which stays put while it works (its last
// update would reorder the cards under the pointer), else its last update.
export function runTime(run) {
  if (run.away?.at) return run.away.at;
  if (run.phase !== "finished" && run.started) return run.started;
  return run.updated ?? run.started ?? 0;
}
export const newestFirst = (a, b) => runTime(b) - runTime(a);

// Totals across runs, for the summary bar, the Bridge header, the Crew block and the harbor.
// `live`: runs still working (not finished, not put away); `docked`: finished but still
// open; `parked`: set aside for later; `shown`: live and docked, the runs the captain
// keeps watching; `closed`: the rest.
// The run and task counts are of `live` only: a finished run's tasks are done. Who needs you
// is attend.js needsYouNow, one rule for every view.
export function stats(runs, ctx) {
  const live = runs.filter((r) => r.phase !== "finished" && !r.away);
  const docked = runs.filter((r) => r.phase === "finished" && !r.away && !isClosed(r, ctx));
  const parked = runs.filter(isParked);
  const shown = [...live, ...docked];
  const open = shown.flatMap((r) => prsOf(r) ?? []).filter(isOpenPr);
  // Parked runs' open PRs, apart: the header says them beside the open ones ("+4 parked").
  const parkedOpen = parked.map((r) => (prsOf(r) ?? []).filter(isOpenPr).length);
  const tasks = live.map(taskCounts);
  return {
    live,
    docked,
    parked,
    shown,
    closed: runs.filter((r) => isClosed(r, ctx)),
    open,
    parkedOpen: parkedOpen.reduce((n, x) => n + x, 0),
    parkedWithOpen: parkedOpen.filter(Boolean).length,
    failing: open.filter((p) => p.checks?.fail).length,
    done: tasks.reduce((n, c) => n + c.done, 0),
    planned: tasks.reduce((n, c) => n + c.planned, 0),
  };
}

// ---- the decision queue ----

// Everything waiting on the person, across all runs and machines, oldest first (the work
// blocked longest): each run's question.md, the captain's open decisions and the runs that
// need them without a question (a dialog, a blocked status), which click through only.
// An item: {id, kind: "run"|"decision"|"attention", title, options [{label, text}],
// recommended (index or null), why, evidence, risk, blocks, since (ms or null), run,
// decision, answered}. `answered` is set while a message waits in the run's inbox.
// `fresh(run)`: whether the run's files are a fresh read (filesFresh); a question read
// from a stale read is under Can't tell, as everywhere else, so not queued here either.
export function decisionQueue(runs, decisions, ctx, fresh = filesFresh) {
  const items = [];
  for (const r of runs) {
    if (!fresh(r)) continue;
    const orch = orchestratorState(r, ctx);
    // Over budget without an open question: its own item, answered through the inbox. With a
    // question.md that question is the item (the orchestrator asked it), never both.
    // It waits for the orchestrator to be gone, or idle or done: a working one may be about to ask
    // its own question, and one that needsYou for another reason (a dialog, a waiting or blocked
    // status, `blocked: stopped at budget` among them) shows that reason instead. Answered or not
    // is the orchestrator's `set-status.sh --budget-answered`.
    const settled = orch === "gone" || exactStatus(r.terminal, ctx) === "idle" || exactStatus(r.terminal, ctx) === "done";
    if (budgetPending(r) && settled && !needsYou(r, orch)) { items.push(budgetItem(r, tokenText)); continue; }
    if (!needsYou(r, orch)) continue;
    const q = r.ask;
    items.push(q ? {
      id: `need-${r.key}`, kind: "run", title: q.title, options: q.options, recommended: q.recommended, why: q.why,
      evidence: q.evidence, risk: q.risk, blocks: q.blocks, since: r.askedAt ?? r.updated ?? r.started, run: r,
      answered: r.unhandled > 0,
    } : {
      id: `need-${r.key}`, kind: "attention", title: needReason(r, orch) ?? "needs you", options: [], recommended: null, why: "",
      evidence: "", risk: "", blocks: "", since: r.updated ?? r.started, run: r,
    });
  }
  items.push(...decisionItems(decisions, runs));
  return items.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity));
}

// The captain's open decisions as queue items (kind "decision"), each with the run it names, if any.
// Alone, for the sidebar and the Bridge, which draw only these and need nothing of the runs' own items.
export const decisionItems = (decisions, runs) => decisions.map((d) => ({
  id: `dec-${d.key}`, kind: "decision", title: d.question, options: d.options, recommended: d.recommended, why: d.why,
  evidence: d.evidence, risk: d.risk, blocks: d.blocks, since: d.asked, decision: d,
  run: decisionRun(d, runs),
}));

// The run a captain decision is about, or null. Its `run` is a directory on the decision's own
// machine, or "<machine>:<directory>" for a run on another (as herdr-app-captain's runs.sh names
// it); a directory is absolute, so a leading "/" is never a machine name.
export function decisionRun(d, runs) {
  if (!d.run) return null;
  const m = /^([^/:][^:]*):(\/.*)$/.exec(d.run);
  const [machine, dir] = m ? [m[1], m[2]] : [d.machine ?? null, d.run];
  return runs.find((r) => r.dir === dir && (r.machine ?? null) === machine) ?? null;
}

// ---- putting runs away and bringing them back ----
// The marker line herdr-app-captain's lib.sh writes with mark_run, written here on the
// run's machine: the mod is installed on its own, without the captain's scripts.

const MARK = 'd=$1 m=$2; { date -u +%Y-%m-%dT%H:%M:%SZ | tr -d "\\n"; printf "\\t"; sed -n "1s/^Status: *//p" "$d/plan.md"; } >"$d/.$m.tmp" && mv "$d/.$m.tmp" "$d/$m"';

// Removes a captain decision from .captain-decisions.json on its machine, atomically, once
// its answer went to a run's inbox instead of the captain: nobody else would clear it.
const DROP = 'f="${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}/.captain-decisions.json"; [ -s "$f" ] && jq --arg id "$1" \'map(select(.id != $id))\' "$f" >"$f.tmp" && mv "$f.tmp" "$f"';
export const dropDecision = (d) => exec("sh", ["-c", DROP, "sh", d.id], { on: d.machine });

// proof-accepted.json in the run directory, which Harbormaster owns: read on the run's machine,
// changed here, and written back only if it still holds what was read (else exit 3, and it is
// read again), under a mkdir lock, through a temporary file of its own and mv, so two windows
// accepting at once lose neither. A lock left by a killed writer is broken after a minute, as
// resources.js does for .resources.json. Every value is an argument, never part of the script.
// A failed read, or a file that is not a JSON object, is never overwritten: that throws.
const READ_ACCEPTED = '[ -e "$1/proof-accepted.json" ] || exit 0; cat "$1/proof-accepted.json"';
export const WRITE_ACCEPTED = [
  'f="$1/proof-accepted.json" l="$1/proof-accepted.json.lock"',
  'if ! mkdir "$l" 2>/dev/null; then',
  '  if [ -n "$(find "$l" -maxdepth 0 -mmin +1 2>/dev/null)" ] && mv "$l" "$l.$$" 2>/dev/null; then',
  '    if [ -n "$(find "$l.$$" -maxdepth 0 -mmin +1 2>/dev/null)" ] || [ -e "$l" ]; then rmdir "$l.$$"; else mv "$l.$$" "$l"; fi',
  '  fi',
  '  exit 3',
  'fi',
  "trap 'rmdir \"$l\" 2>/dev/null' EXIT",
  // $(…) drops trailing newlines; the caller passes what it read without them too.
  'have=$(cat "$f" 2>/dev/null)',
  '[ "$have" = "$2" ] || exit 3',
  'printf "%s" "$3" >"$f.tmp.$$" && mv "$f.tmp.$$" "$f"',
].join("\n");
async function changeAccepted(run, id, entry) {
  for (let i = 0; i < 5; i++) {
    if (i > 0) await exec("sleep", ["0.3"]).catch(() => {});
    const got = await exec("sh", ["-c", READ_ACCEPTED, "sh", run.dir], { on: run.machine });
    if (got.code !== 0) throw new Error(`could not read proof-accepted.json: ${(got.stderr || "").trim() || `exit ${got.code}`}`);
    let file;
    try { file = acceptedFile(got.stdout); } catch { throw new Error("proof-accepted.json is not a JSON object; fix or delete it, then try again"); }
    const was = got.stdout.replace(/\n+$/, "");
    const out = await exec("sh", ["-c", WRITE_ACCEPTED, "sh", run.dir, was, withAcceptance(file, id, entry)], { on: run.machine });
    if (out.code === 0) return;
    if (out.code !== 3) throw new Error(out.stderr || "could not write proof-accepted.json");
  }
  throw new Error("proof-accepted.json is being changed elsewhere; try again");
}

// Accepts a claim as it is (a Claims row's Accept), for its current result line only; works
// with the orchestrator gone, since nothing but this file changes.
export const acceptProof = (run, row) => changeAccepted(run, row.id, { at: new Date().toISOString(), result: claimResultLine(row) });
// Takes an acceptance back (Unaccept): the row needs a look again.
export const unacceptProof = (run, row) => changeAccepted(run, row.id, null);

// Compacts the orchestrator's context: the answer goes into its inbox first, then /compact is
// typed into its terminal (Claude Code and pi both take it as input), and only once the
// compaction is over (the terminal idle or done again) is it woken to read the answer: text
// typed while it compacts may be queued, left in the prompt or dropped. /compact goes in only
// while the orchestrator reports idle or done, checked here again just before sending, since
// the click may be seconds after the screen was drawn; an unknown status is not idle. Throws
// when it is not, or when the send fails; the answer then waits in the inbox, to be read as
// any other when the orchestrator is next woken.
export async function compactRun(run, title, answer) {
  if (orchestratorState(run, facts()) === "gone") throw new Error("not compacted: its orchestrator is gone or lost; the answer waits for a resume");
  const ok = () => ["idle", "done"].includes(exactStatus(run.terminal, facts()));
  if (!ok()) throw new Error("not compacted: its orchestrator is not idle or done");
  const file = await writeMessage(run, "answer", { title, answer });
  // Detached like the wake (a held draft must not fail it). The dialog case was ruled out by the
  // status check above, and the wait below outlasts the draft hold (60 s) before it goes on.
  const sent = await exec("hc", detachedSend(run.localTerminal, "/compact"), { on: run.machine }).catch((e) => ({ code: -1, stderr: e?.message ?? String(e) }));
  if (sent.code !== 0) throw new Error(`could not send /compact (the answer is in its inbox): ${(sent.stderr || sent.stdout || "hc send failed").trim()}`);
  // Compaction starts working, then ends: wait for working (up to 70 s, longer than a held send; a very quick one may be
  // over before we look), then for idle or done again, for at most 10 minutes.
  const sleep = (s) => exec("sleep", [String(s)]).catch(() => {});
  for (let i = 0; i < 35 && ok(); i++) await sleep(2);
  for (let i = 0; i < 300 && !ok(); i++) await sleep(2);
  if (!ok()) throw new Error("compaction is still running after 10 minutes; the answer waits in its inbox");
  return wakeRun(run, file);
}

// Closing a run whose orchestrator is there asks it to clean up: it ends its agents,
// pushes what is not on the remote, deletes the run's worktrees, writes the closed
// marker and closes its own tab (herdr-app-orchestrator's section 9). Resolves to a note
// for the card, and whether it is blocked. A blocked orchestrator reads it once its dialog is answered.
async function askToClose(run) {
  const { outcome } = await send(run, "close");
  return outcome === "blocked"
    ? { blocked: true, note: "its orchestrator is blocked on a dialog: answer it in its tab, and it then cleans up and closes" }
    : { blocked: false, note: "its orchestrator is cleaning up, and its tab closes when done" };
}

// ---- reviewed ----

// For proof.md's `Reviewed: <sha> …` lines: for each sha given, how many commits the run's branch has
// past it, whether the sha is an ancestor of the branch, and whether the branch's tree is still that
// commit's. One git pass for all shas, in the run's folder or its repositories, on the run's machine;
// prints one line per sha: "<sha> <count> <1 when the trees match> <1 when an ancestor>", or "<sha> ?"
// when git cannot tell (a sha unknown to it). claims.js pickFinal chooses among them.
const SINCE = [
  'folder=$1 branch=$2; shift 2; shas=" $* "; seen=" "',
  'for r in "$folder" "$folder"/*/; do',
  '  [ -e "$r/.git" ] || continue',
  '  git -C "$r" rev-parse -q --verify "$branch^{commit}" >/dev/null || continue',
  '  for sha in $shas; do',
  '    case "$seen" in *" $sha "*) continue;; esac',
  '    git -C "$r" rev-parse -q --verify "$sha^{commit}" >/dev/null || continue',
  '    seen="$seen$sha "',
  '    n=$(git -C "$r" rev-list --count "$sha..$branch") || { echo "$sha ?"; continue; }',
  '    if git -C "$r" diff --quiet "$sha" "$branch"; then s=1; else s=0; fi',
  '    if git -C "$r" merge-base --is-ancestor "$sha" "$branch"; then a=1; else a=0; fi',
  '    echo "$sha $n $s $a"',
  '  done',
  'done',
  'for sha in $shas; do case "$seen" in *" $sha "*) ;; *) echo "$sha ?";; esac; done',
].join("\n");

const reviewGaps = new Map(); // run key → {sha, count, same, at}
const reviewBusy = new Map();
const REVIEW_TTL = 15_000, REVIEW_TTL_DONE = 5 * 60_000;

// Reads the commits since the run's last Reviewed sha when stale (every 15 s while open, 5 min once
// finished); one cheap git call with a timeout. Unreadable: same is null (shown dim as unknown, never as current).
// True when what the line shows changed.
export async function refreshReviewed(run, done = false) {
  const finals = finalReviews(run.proof?.md); // task shas are not on the branch (claims.js finalReviews)
  if (!finals.length || !run.folder) { reviewGaps.delete(run.key); return false; }
  const have = reviewGaps.get(run.key);
  const key = finals.map((x) => x.sha).join(" ");
  if (Date.now() - (reviewBusy.get(run.key) ?? 0) < 30_000) return false;
  if (have && have.key === key && Date.now() - have.at < (done ? REVIEW_TTL_DONE : REVIEW_TTL)) return false;
  const started = Date.now();
  reviewBusy.set(run.key, started);
  try {
    const out = await exec("sh", ["-c", SINCE, "sh", run.folder, run.branch, ...new Set(finals.map((x) => x.sha))], { on: run.machine, timeout: 8000 }).catch(() => null);
    const measured = {};
    if (out?.code === 0) for (const line of out.stdout.split("\n")) {
      const m = /^(\S+) (\d+) ([01]) ([01])$/.exec(line.trim());
      if (m) measured[m[1]] = { count: Number(m[2]), same: m[3] === "1", anc: m[4] === "1" };
    }
    const last = pickFinal(finals, measured), m = measured[last.sha];
    const next = { sha: last.sha, key, count: m ? m.count : 0, same: m ? m.same : null, at: Date.now() };
    reviewGaps.set(run.key, next);
    run.reviewedGap = next;
    return !have || have.sha !== next.sha || have.count !== next.count || have.same !== next.same;
  } finally {
    if (reviewBusy.get(run.key) === started) reviewBusy.delete(run.key);
  }
}

// The run's integration worktrees: each linked worktree with the run's branch checked
// out, in the run's repository or any repository in its folder. One path per line.
const WORKTREES = [
  'folder=$1 branch=$2',
  'for r in "$folder" "$folder"/*/; do',
  '  [ -e "$r/.git" ] || continue',
  '  git -C "$r" worktree list --porcelain 2>/dev/null | awk -v b="branch refs/heads/$branch" \'/^worktree /{p=substr($0,10); n++} $0==b && n>1{print p}\'',
  'done',
].join("\n");

// The integration worktrees' paths, or null when git could not be asked (or the run
// has no folder to ask in).
async function integrationWorktrees(run) {
  if (!run.folder) return null;
  const out = await exec("sh", ["-c", WORKTREES, "sh", run.folder, run.branch], { on: run.machine }).catch(() => null);
  return out?.code === 0 ? out.stdout.split("\n").filter(Boolean) : null;
}

// Closes the spaces that show the run's integration worktrees: to declutter the
// sidebar while the run is parked (the worktrees stay, and the resumed orchestrator's
// integration-worktree.sh opens their spaces again), or before its orchestrator
// deletes them on Close, since a space whose folder is gone can no longer be placed
// under its repository and shows as a space of its own. Best effort: never fails.
async function closeWorktreeSpaces(run, paths) {
  paths ??= (await integrationWorktrees(run)) ?? [];
  if (paths.length) for (const s of worktreeSpaces(run, paths)) command("space.close", { id: s.id, confirmed: true });
}

// The window commands Harbormaster sends on its own, for a closed run or to name a
// remote orchestrator's tab, at most once a minute per tab or space (per name, for a
// rename), so the 5 s refresh does not repeat them while they land.
const sent = new Map();
function once(id, fn) {
  if (Date.now() - (sent.get(id) ?? 0) < 60000) return;
  sent.set(id, Date.now());
  fn();
}

// Prints those of the given paths that no longer exist.
const MISSING = 'for p; do [ -e "$p" ] || printf "%s\\n" "$p"; done';

// Finishes closing a closed run in the window. Its orchestrator closes its own
// worktree space and tab through herdr-app, which only reaches a window on its own
// computer: when Herdr runs on another one, connected over ssh, it cannot, and leaves
// them. Harbormaster draws in the window, so it closes what is left: spaces still on
// a worktree folder of the run that is gone, and, once the orchestrator has ended its
// turn, its tab, which ends it. Never while it is working or blocked, so it can still
// report or ask; and only the tab its terminal is in now, so a resumed run, whose
// orchestrator.json still names the old terminal until init-run.sh runs, is safe.
async function tidyClosed(run, ctx) {
  // Whoever wrote the marker, the run's time summary goes to the history once (a failure just waits for a later poll).
  writeHistory(run, "closed");
  const spaces = leftoverSpaces(run);
  if (spaces.length) {
    const out = await exec("sh", ["-c", MISSING, "sh", ...new Set(spaces.map((s) => s.path))], { on: run.machine }).catch(() => null);
    const gone = new Set(out?.code === 0 ? out.stdout.split("\n").filter(Boolean) : []);
    for (const s of spaces) if (gone.has(s.path)) once(s.id, () => command("space.close", { id: s.id, confirmed: true }));
  }
  const tab = liveTabOf(run);
  const state = orchestratorState(run, ctx);
  if (tab && state !== "working" && state !== "blocked") once(tab, () => command("tab.close", { id: tab, confirmed: true }));
}

// The orchestrator's tab name for a run, as set-status.sh names it: its phase's mark,
// then its type and topic, or its branch without a topic ("🐙 ✋ rev · Triage decision").
const TAB_MARK = { waiting: "✋ ", blocked: "✋ ", finished: "✓ " };
export const orchestratorTabName = (run) =>
  `🐙 ${TAB_MARK[run.phase] ?? ""}${[run.type, run.topic || run.branch].filter(Boolean).join(" · ")}`;

// Names an orchestrator's tab after its run's status, for a run on another machine.
// Its set-status.sh renames its own tab through herdr-app, which only reaches a window
// on its own computer: when Herdr runs on another one, connected over ssh, it cannot,
// and the tab keeps its old name. Harbormaster draws in the window, so it renames the
// tab from plan.md's status and status.json's type and topic, which set-status.sh writes first. Only the tab its terminal
// is in now, as in tidyClosed, and only while the tab is unnamed or carries one of the
// orchestrator's own names (🐙 ...), so a name the person gave it stays. Each name is
// sent at most once a minute, so a rename that does not land is not repeated every 5 s.
function nameTab(run) {
  if (run.phase === "unknown") return;
  const tab = tabInfo(liveTabOf(run));
  if (!tab || (tab.named && !tab.name.startsWith("🐙"))) return;
  const name = orchestratorTabName(run);
  if (tab.name !== name) once(`${tab.id}\u001f${name}`, () => command("tab.rename", { id: tab.id, name }));
}

// Names the captain's tab "⚓ captain" when the captain runs on another machine and the
// tab has no name yet. herdr-app-captain names its own tab through herdr-app, which
// cannot reach a window on another computer, so the tab kept its number. A name
// anyone gave the tab stays.
function nameCaptainTab(ctx) {
  const address = captainOf(ctx).terminal?.address;
  if (!address?.includes("/")) return; // on this computer, the captain names it itself
  const tab = tabInfo(tabOfTerminal(address));
  if (tab && !tab.named) once(`${tab.id}\u001f⚓`, () => command("tab.rename", { id: tab.id, name: "⚓ captain" }));
}

// Finishes parking a run on another machine that herdr-app-captain parked there: the
// captain writes the parked marker, but cannot reach the window to close the run's
// integration worktree spaces and the orchestrator's tab, as Park does. Only for a run
// this window had seen open, with its orchestrator there (it has a harbormaster.worktrees
// entry, `paths` its worktrees), so that runs parked long ago, whose spaces the person
// may have opened again on purpose, are left alone. Harbormaster's own Park has closed
// both already. Closing the tab ends the orchestrator and its agents, as Park does.
function tidyParked(run, paths) {
  if (paths.length) for (const sp of worktreeSpaces(run, paths)) command("space.close", { id: sp.id, confirmed: true });
  const tab = liveTabOf(run);
  if (tab) command("tab.close", { id: tab, confirmed: true });
}

// Shows the integration worktrees of runs on other machines as spaces in the window.
// The orchestrator's integration-worktree.sh opens the space through herdr-app, which
// only reaches a window on its own computer: when Herdr runs on another one, connected
// over ssh, it cannot, and the worktree has no space. So Harbormaster opens it, as the
// script does: space.new on the worktree's folder on the run's machine, unnamed, so the
// sidebar nests it under the repository's space, then shows the space that was showing
// again. Only for an open run whose orchestrator is there and not closing.
// A worktree gets a space once per orchestrator: the ones Harbormaster opened or saw
// open are kept in shared state (harbormaster.worktrees, {[run key]: {terminal, paths}},
// persisted), so a space the person closes stays closed. Every such run has an entry, with or without
// worktrees. A parked or closed run's entry is dropped, since parking closes its
// spaces, and the resumed orchestrator, which cannot open them either, needs them
// opened again; a parked one is first tidied (tidyParked). Asks git on the run's
// machine at most every 30 s.
const WORKTREES_KEY = "harbormaster.worktrees";
const asked = new Map();
let showing = false; // one pass at a time, so a slow git does not open a space twice
async function showWorktrees(runs, ctx, answered) {
  if (showing) return;
  showing = true;
  try { await showWorktreesOnce(runs, ctx, answered); } finally { showing = false; }
}
async function showWorktreesOnce(runs, ctx, answered) {
  const seen = { ...(shared(WORKTREES_KEY) ?? {}) };
  let changed = false;
  // A run directory that is gone, deleted or moved, from a machine that answered (one
  // that did not may only be offline): a new run there must get its space again.
  const listed = new Set(runs.map((r) => r.key));
  for (const key of Object.keys(seen)) {
    if (!listed.has(key) && answered.has(key.slice(0, key.indexOf(":")))) { delete seen[key]; changed = true; }
  }
  for (const r of runs) {
    if (!seen[r.key] || !(r.away || isClosed(r, ctx))) continue;
    if (r.machine && r.away?.how === "parked") tidyParked(r, seen[r.key].paths ?? []);
    delete seen[r.key];
    changed = true;
  }
  const open = runs.filter((r) => r.machine && !r.away && !isClosed(r, ctx) && r.progress !== "closing"
    && orchestratorState(r, ctx) !== "gone" && Date.now() - (asked.get(r.key) ?? 0) >= 30000);
  for (const r of open) {
    asked.set(r.key, Date.now());
    const paths = await integrationWorktrees(r);
    if (!paths) continue;
    // Each orchestrator gets the spaces once, as integration-worktree.sh runs once when
    // one starts or resumes: a new orchestrator, of a resumed run or a new run under the
    // same name, gets them again.
    const entry = seen[r.key]?.terminal === r.terminal ? seen[r.key] : null;
    const known = new Set(entry?.paths ?? []);
    for (const path of paths) {
      if (known.has(path)) continue;
      known.add(path);
      if (worktreeSpaces(r, [path]).length) continue;
      const before = spaces().find((sp) => sp.active)?.id;
      command("space.new", { folder: path, machine: r.machine });
      if (before) command("space.select", { id: before });
    }
    if (!entry || known.size !== entry.paths.length) { seen[r.key] = { terminal: r.terminal, paths: [...known] }; changed = true; }
  }
  if (changed) setShared(WORKTREES_KEY, seen);
}

// Parks the run for later: writes the marker, closes the spaces of its integration
// worktrees, then closes the orchestrator's tab, which ends it and its agents; the
// worktrees, branches and everything else stay. Or closes it for good: an orchestrator
// that is there cleans up and ends itself (askToClose), and once it has the message and
// is not blocked, Harbormaster closes the worktrees' spaces before it deletes them (a
// blocked one may yet stop short, so its spaces stay; tidyClosed closes them once the
// run is closed and their folders are gone); one that is finished, idle and has no worktree left has nothing to
// clean up, so the run is marked closed and its tab closed here; for one that is gone
// it writes the marker, and the worktrees stay until the run is resumed and closed again.
// how: "parked" | "closed"; orch: orchestratorState(). Resolves to a note, or null.
// A finished run with its orchestrator gone needs no marker to close: closing its tab
// does. With the orchestrator still there but no tab to close, parking refuses, so a
// marker never hides a live run.
export async function putAway(run, how, orch) {
  if (how === "closed" && orch !== "gone") {
    const paths = await integrationWorktrees(run);
    if (run.phase === "finished" && (orch === "done" || orch === "idle") && paths?.length === 0) {
      await mark(run, "closed");
      await tidyClosed(run, facts());
      cache.at = 0;
      return null;
    }
    const { note, blocked } = await askToClose(run);
    if (!blocked) await closeWorktreeSpaces(run, paths ?? []);
    cache.at = 0;
    return note;
  }
  const tab = tabOf(run);
  if (!tab && orch !== "gone") throw new Error("cannot find the orchestrator's tab; close it by hand");
  if (how === "parked" || run.phase !== "finished") await mark(run, how);
  if (how === "parked") await closeWorktreeSpaces(run);
  if (tab) command("tab.close", { id: tab, confirmed: true });
  cache.at = 0;
  return null;
}

async function mark(run, how) {
  const out = await exec("sh", ["-c", MARK, "sh", run.dir, how], { on: run.machine });
  if (out.code !== 0) throw new Error(out.stderr || `could not write ${how}`);
}

// Deletes a closed run for good: its run directory, so it leaves every view and the
// captain's lists and can no longer be resumed. Branches and PRs are git's and GitHub's,
// and stay. It refuses while a worktree still has the integration branch checked out,
// in the run's repository or any repository in its folder, since that means the run
// was closed without cleaning up: resume it and close it again first. It also refuses
// once the run was resumed since it was read (its orchestrator.json names another
// terminal, or its closed marker is gone), so a delete confirmed earlier, as a bulk one
// working through a machine's runs, never takes a run that is active again. The rm is
// guarded so it only ever removes a run directory under the runs root.
const DELETE = [
  'd=$1 folder=$2 branch=$3 terminal=$4 marked=$5',
  'root="${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}"',
  'case "$d" in "$root"/*/*) ;; *) echo "not a run directory: $d" >&2; exit 2;; esac',
  '[ -f "$d/orchestrator.json" ] || { echo "not a run directory: $d" >&2; exit 2; }',
  'resumed() { echo "it was resumed since; it is no longer closed" >&2; exit 4; }',
  '[ -z "$marked" ] || [ -e "$d/closed" ] || resumed',
  '[ -z "$terminal" ] || [ "$(jq -r ".terminal // empty" "$d/orchestrator.json" 2>/dev/null)" = "$terminal" ] || resumed',
  'for r in "$folder" "$folder"/*/; do',
  '  [ -e "$r/.git" ] || continue',
  '  if git -C "$r" worktree list --porcelain 2>/dev/null | grep -qxF "branch refs/heads/$branch"; then',
  '    echo "its worktrees are still there: resume it and close it again to clean them up, then delete it" >&2; exit 3',
  '  fi',
  'done',
  'rm -rf -- "$d" && rmdir -- "${d%/*}" 2>/dev/null; exit 0',
].join("\n");

// cx: the caller's spawn cx, which times the wait for the history (see deleteWait). `historyTried`:
// deleteRuns already waited for it, so it is not waited on again.
export async function deleteRun(run, { cx = null, historyTried = false } = {}) {
  // Its summary goes to the history first, if not there; the delete goes ahead if that fails or takes too long.
  if (!historyTried) await writeHistoryBeforeDelete(run, { cx });
  const out = await exec("sh", ["-c", DELETE, "sh", run.dir, run.folder ?? "", run.branch,
    run.localTerminal ?? "", run.away?.how === "closed" ? "1" : ""], { on: run.machine });
  if (out.code !== 0) throw new Error((out.stderr || "could not delete the run directory").trim());
  // The run's copied proof images go with it (they are on this computer whichever machine it ran on).
  await exec("sh", dropCacheArgs(appHome(), run.machine, run.dir)).catch(() => {});
  const prs = { ...(shared("harbormaster.prs") ?? {}) };
  delete prs[run.key];
  setShared("harbormaster.prs", prs);
  const seen = { ...(shared(WORKTREES_KEY) ?? {}) };
  if (seen[run.key]) { delete seen[run.key]; setShared(WORKTREES_KEY, seen); }
  cache.at = 0;
}

// Deletes several closed runs, one at a time per machine and the machines at once, each as
// deleteRun does, guards and all. Returns the runs it could not delete, each with why.
export async function deleteRuns(runs, { cx = null } = {}) {
  // Start every history write first, under one wait, so the waits overlap instead of adding up per run;
  // a run whose write failed is not waited on again. No wait when every line is already there.
  const unwritten = runs.filter((r) => !historyWritten(r));
  if (unwritten.length) {
    const late = deleteWait(cx);
    await Promise.all(unwritten.map((r) => writeHistoryBeforeDelete(r, { late })));
    late.cancel();
  }
  const byMachine = new Map();
  for (const r of runs) byMachine.set(r.machine ?? "", [...(byMachine.get(r.machine ?? "") ?? []), r]);
  const failed = [];
  await Promise.all([...byMachine.values()].map(async (list) => {
    for (const run of list) {
      try { await deleteRun(run, { historyTried: true }); } catch (e) { failed.push({ run, error: e?.message ?? String(e) }); }
    }
  }));
  return failed;
}

// Resumes the run with a new orchestrator of its kind, in the repository's space, or in a
// new one for it when none is open. The orchestrator's init-run.sh deletes the markers
// and it reopens the integration worktree under that space. A lost orchestrator's tab,
// only a shell now, is closed once the new one is started, so it does not linger.
export function resumeRun(run) {
  const kind = run.kind || "claude";
  const prompt = `${kind === "pi" ? "/skill:" : "/"}herdr-app-orchestrator ${run.dir}/spec.md`;
  const lostTab = orchestratorLost(run, facts()) ? tabOf(run) : null;
  const space = homeSpace(run);
  if (space) command("tab.new", { space: space.id, folder: run.folder, argv: [kind], task: prompt });
  else command("space.new", { folder: run.folder, argv: [kind], task: prompt, machine: run.machine ?? "" });
  if (lostTab) command("tab.close", { id: lostTab, confirmed: true });
  cache.at = 0;
}
