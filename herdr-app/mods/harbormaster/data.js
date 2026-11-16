// Run facts for Harbormaster: herdr-app-orchestrator run directories, read on
// every machine (this one and each one added with `hc machine add`), plus each
// run's pull requests from `gh`, asked on the machine that owns the run.
// Live facts from herdr-core are in live.js; text helpers in ui.js.
//
// The run directory files it reads and writes are documented in
// skills/herdr-app-orchestrator/references/run-files.md. In short, per run, under
// <root>/<folder>/<branch>/: orchestrator.json, plan.md, status.json (with the token
// totals tokens.sh counts into it; this mod never reads session files for them), question.md,
// inbox/*.message (written here on an answer or Close), parked and closed markers;
// and <root>/.captain-decisions.json for the captain's open decisions.

import { exec, machines, spaces, shared, setShared, run as command } from "herdr";
import { parseQuestion, answerMessage } from "./question.js";
import { parseDecidedLines } from "./decided.js";
import { tokenText } from "./context.js";
import { dropCache } from "./viewer.js";
import { proofOf, runTier, parseProofMd } from "./proof.js";
import { exactStatus, orchestratorState, orchestratorLost, workersOf, needsYou, needReason, tabOf, liveTabOf, tabOfTerminal, tabInfo, homeSpace, worktreeSpaces, leftoverSpaces, captainOf, facts } from "./live.js";

const RS = "\u001e", US = "\u001f";

// One sh script per machine: the captain's decisions, then every run, its files
// separated by \x1f, runs by \x1e.
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
  '  n=0; for m in "$d"/inbox/*.message; do [ -e "$m" ] && n=$((n+1)); done; printf "%s\\037" "$n"',
  // proof.md (a "+" before it when there is one), then the names of the files in shared/proof/, capped.
  '  [ -e "$d/proof.md" ] && { printf +; head -c 12000 "$d/proof.md"; }; printf \'\\037\'',
  '  ls -p "$d/shared/proof" 2>/dev/null | grep -v / | head -40; printf \'\\037\'',
  // decisions.md: the last 60 lines of its own decisions and the user's, capped.
  '  grep -a -E "^- \\[(decided|user)\\] " "$d/decisions.md" 2>/dev/null | tail -n 60 | tail -c 20000',
  "done",
].join("\n");

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
//     "| id | repo | scope | ... | status |" and "| api | snevagten-api | ... | merged d3c8862d |";
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

function parse(machine, stdout) {
  return stdout.split(RS).slice(1).filter((s) => s.trim()).map((chunk) => {
    const [dir, orchFile, statusFile, plan, question, asked, parkedFile, closedFile, inbox, proofFile, proofNames, decidedFile] = chunk.split(US);
    const orch = json(orchFile) ?? {};
    const status = json(statusFile) ?? {};
    const tasks = tasksOf(plan);
    const statusLine = /^Status:\s*(.*)$/m.exec(plan ?? "")?.[1]?.trim() ?? null;
    const folder = orch.folder ?? status.folder ?? "";
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
      autonomy: /^L[0-2]$/.test(status.autonomy) ? status.autonomy : "L0",
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
      // When the run was created (init-run.sh); null for runs from before it recorded that.
      started: Date.parse(orch.started ?? "") || null,
      question: question?.trim() || null,
      // The question read into its sections (question.js), and when it was asked, in ms.
      ask: parseQuestion(question),
      askedAt: Number(asked?.trim()) * 1000 || null,
      unhandled: Number(inbox?.trim() || 0),
      tasks,
      // The run's proof: its tier, proof.md's results by task id, and the file names in shared/proof/.
      proof: {
        tier: runTier(plan, tasks),
        md: proofFile?.startsWith("+") ? parseProofMd(proofFile.slice(1)) : null,
        files: (proofNames ?? "").split("\n").map((f) => f.trim()).filter(Boolean),
      },
      // What every agent name of the run starts with after its role: impl-<prefix>-<task>.
      prefix: /^Prefix:\s*`?([\w-]+)/m.exec(plan ?? "")?.[1]?.toLowerCase() ?? null,
    };
  });
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
// orchestrator's own question is: Continue when most tasks are merged, else Compact.
function budgetItem(r, tokenText) {
  const mostlyDone = r.planned > 0 && (r.merged ?? 0) / r.planned >= 0.5;
  const top = r.tokens.byAgent.slice(0, 3).map((a) => `${a.name} ${tokenText(a.total)}`).join(", ");
  return {
    id: `need-${r.key}`, kind: "budget", title: `Over budget: ${tokenText(r.tokens.total)} of ${tokenText(r.budget)} tokens`,
    options: BUDGET_OPTIONS, recommended: mostlyDone ? 0 : 1,
    why: mostlyDone ? "most tasks are merged" : "much work is left; a smaller context is cheaper",
    evidence: `${tokenText(r.tokens.total)} used${r.planned ? `, ${r.merged ?? 0}/${r.planned} tasks done` : ""}${top ? `; largest: ${top}` : ""}`,
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
let cache = { at: 0, runs: [], decisions: [], errors: [], pending: null, pendingAt: 0 };
const STALE_READ = 45000;
let reads = 0;

export function cachedRuns() {
  return cache;
}

export function loadRuns() {
  if (Date.now() - cache.at < 2500) return Promise.resolve(cache);
  if (cache.pending && Date.now() - cache.pendingAt < STALE_READ) return cache.pending;
  const read = ++reads;
  cache.pendingAt = Date.now();
  cache.pending = (async () => {
    const names = machines().filter((m) => m.layout !== "unavailable").map((m) => m.name);
    if (!names.includes(null)) names.unshift(null);
    const runs = [], decisions = [], errors = [], answered = new Set();
    await Promise.all(names.map(async (on) => {
      try {
        const out = await exec("sh", ["-c", SCRIPT], { on });
        decisions.push(...parseDecisions(on, out.stdout.split(RS)[0]));
        runs.push(...parse(on, out.stdout));
        answered.add(on ?? "");
      } catch (e) {
        errors.push(`${on ?? "this machine"}: ${e?.message ?? e}`);
      }
    }));
    runs.sort((a, b) => (a.machine ?? "").localeCompare(b.machine ?? "") || a.dir.localeCompare(b.dir));
    decisions.sort((a, b) => (a.asked ?? 0) - (b.asked ?? 0));
    if (read !== reads) return cache;
    cache = { at: Date.now(), runs, decisions, errors, pending: null, pendingAt: 0 };
    const ctx = facts();
    for (const r of runs) if (r.away?.how === "closed") tidyClosed(r, ctx).catch(() => {});
    for (const r of runs) if (r.machine && !r.away) nameTab(r);
    nameCaptainTab(ctx);
    showWorktrees(runs, ctx, answered).catch(() => {});
    return cache;
  })().catch((e) => {
    if (read !== reads) return cache;
    cache = { ...cache, pending: null, pendingAt: 0, errors: [String(e)] };
    return cache;
  });
  return cache.pending;
}

// ---- tasks ----

// A task's state word(s) → "done" | "working" | "blocked" | null (not started).
export function taskTone(state) {
  const s = state ?? "";
  if (/^(merged|done|finished|complete)/.test(s)) return "done";
  if (/block|fail|stuck/.test(s)) return "blocked";
  if (/^(planned|todo|pending|queued|not started|waiting to start)/.test(s) || !s) return null;
  return "working";
}

// Where a task is in its life cycle, from its state words: "planned" | "implement" |
// "review" | "fix" | "done" | "blocked", or null for a state that names no stage
// ("validating"). Agrees with taskTone on done, blocked and not started.
export function taskStage(state) {
  const tone = taskTone(state);
  if (tone === "done" || tone === "blocked") return tone;
  if (!tone) return "planned";
  if (/\bfix/.test(state)) return "fix";
  if (/review/.test(state)) return "review";
  if (/implement|in progress|working|started|coding|building/.test(state)) return "implement";
  return null;
}

// The stage an agent works on, from its role in its name: impl-, rev-, fix-.
const ROLE_STAGE = { impl: "implement", rev: "review", fix: "fix" };

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
    .map((t) => ({ agent: t, m: /^(impl|rev|fix)-(.+)$/.exec(t.name.toLowerCase()) }))
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

// How many tasks a run has merged and planned, from status.json, else plan.md.
export function taskCounts(run) {
  return {
    merged: run.merged ?? run.tasks.filter((task) => task.state === "merged").length,
    planned: Math.max(run.planned ?? 0, run.tasks.length),
  };
}

// ---- pull requests (gh), cached in shared state so every copy and layout reuses them ----

const PR_FIELDS = "number,title,state,isDraft,reviewDecision,reviews,author,statusCheckRollup,url,headRefName,body";
// Run key → when its refresh started. Like a run read, a refresh whose task is cancelled
// never ends, so one older than PR_STALE no longer holds the run back.
const prBusy = new Map();
const PR_STALE = 5 * 60000;

// A PR's state → a theme tone; the harbor maps the same tones to its own colors.
export const PR_TONE = { OPEN: "working", DRAFT: "dim", MERGED: "done", CLOSED: "blocked" };
const isOpen = (pr) => pr.state === "OPEN" || pr.state === "DRAFT";

function checks(rollup) {
  const c = { pass: 0, fail: 0, pending: 0 };
  for (const x of rollup ?? []) {
    const v = (x.conclusion || x.state || x.status || "").toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(v)) c.pass++;
    else if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(v)) c.fail++;
    else c.pending++;
  }
  return c;
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
  return { approvedBy: with_("APPROVED"), changesBy: with_("CHANGES_REQUESTED") };
}

// The first line of a PR body's `## Merge danger` section ("Two-way door — …"), or null.
// Only this line is kept, so the cached PR stays small.
export function mergeDanger(body) {
  const m = /^##[ \t]+Merge danger[ \t]*\r?\n([\s\S]*?)(?=^#{1,2}[ \t]|(?![\s\S]))/im.exec(body ?? "");
  const line = m?.[1].split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("```"));
  const clean = line?.replace(/^[-*>]\s+/, "").replace(/\*\*|__|`/g, "").replace(/^[*_]+([^*_]+?)[*_]+/, "$1").trim();
  return clean ? clean.slice(0, 600) : null;
}

// What the views need from `gh pr view --json` output. GitHub only sets reviewDecision
// where the repo requires a review, so the review comes from the reviews themselves,
// falling back to reviewDecision ("Review needed") when nobody has approved or objected.
function prSummary(p, repo) {
  const { approvedBy, changesBy } = standing(p);
  return {
    number: p.number,
    title: p.title,
    state: p.isDraft && p.state === "OPEN" ? "DRAFT" : p.state,
    review: changesBy.length ? "CHANGES_REQUESTED" : approvedBy.length ? "APPROVED" : p.reviewDecision || null,
    approvedBy,
    changesBy,
    checks: checks(p.statusCheckRollup),
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

// The run's related PRs: shown beside its issues, never counted as its own.
export function relatedOf(run) {
  return shared("harbormaster.prs")?.[run.key]?.related ?? run.related.map((p) => unknownPr(p.url, p.repo));
}

// Refreshes a run's PRs when stale: every 60 s while the run is open, every 15 min once closed.
export async function refreshPrs(run, closed = false) {
  const have = (shared("harbormaster.prs") ?? {})[run.key];
  const ttl = closed ? 15 * 60000 : 60000;
  if (Date.now() - (prBusy.get(run.key) ?? 0) < PR_STALE || (have && Date.now() - have.at < ttl)) return;
  const started = Date.now();
  prBusy.set(run.key, started);
  try {
    const view = async (recorded) => {
      const out = [];
      for (const pr of recorded) {
        if (!pr.url) continue;
        const res = await exec("gh", ["pr", "view", pr.url, "--json", PR_FIELDS], { on: run.machine }).catch(() => null);
        const p = res?.code === 0 ? json(res.stdout) : null;
        if (p) out.push(prSummary(p, pr.repo));
        else out.push(unknownPr(pr.url, pr.repo));
      }
      return out;
    };
    const related = await view(run.related);
    const list = await view(run.prs);
    const next = { ...(shared("harbormaster.prs") ?? {}) };
    next[run.key] = { at: Date.now(), list, related };
    // Forget runs that are gone.
    for (const key of Object.keys(next)) if (cache.runs.length && !cache.runs.some((r) => r.key === key)) delete next[key];
    setShared("harbormaster.prs", next);
  } finally {
    if (prBusy.get(run.key) === started) prBusy.delete(run.key);
  }
}

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

// Totals across runs, for the summary bar, the overview header, the Crew block and the harbor.
// `live`: runs still working (not finished, not put away); `docked`: finished but still
// open; `parked`: set aside for later; `shown`: live and docked, the runs the captain
// keeps watching; `closed`: the rest.
// The run, need-you and task counts are of `live` only: a finished run's tasks are done.
export function stats(runs, ctx) {
  const live = runs.filter((r) => r.phase !== "finished" && !r.away);
  const docked = runs.filter((r) => r.phase === "finished" && !r.away && !isClosed(r, ctx));
  const parked = runs.filter(isParked);
  const shown = [...live, ...docked];
  const open = shown.flatMap((r) => prsOf(r) ?? []).filter(isOpen);
  const tasks = live.map(taskCounts);
  return {
    live,
    docked,
    parked,
    shown,
    closed: runs.filter((r) => isClosed(r, ctx)),
    need: live.filter((r) => needsYou(r, orchestratorState(r, ctx))),
    open,
    failing: open.filter((p) => p.checks?.fail).length,
    merged: tasks.reduce((n, c) => n + c.merged, 0),
    planned: tasks.reduce((n, c) => n + c.planned, 0),
    workers: shown.reduce((n, r) => n + workersOf(r.terminal, ctx).length, 0),
  };
}

// ---- the decision queue ----

// Everything waiting on the person, across all runs and machines, oldest first (the work
// blocked longest): each run's question.md, the captain's open decisions and the runs that
// need them without a question (a dialog, a blocked status), which click through only.
// An item: {id, kind: "run"|"decision"|"attention", title, options [{label, text}],
// recommended (index or null), why, evidence, risk, blocks, since (ms or null), run,
// decision, answered}. `answered` is set while a message waits in the run's inbox.
export function decisionQueue(runs, decisions, ctx) {
  const items = [];
  for (const r of runs) {
    const orch = orchestratorState(r, ctx);
    // Over budget without an open question: its own item, answered through the inbox. With a
    // question.md that question is the item (the orchestrator asked it), never both.
    // It waits for the orchestrator to be gone, or idle or done: a working one may be about to ask
    // its own question, and one that needsYou for another reason (a dialog, a waiting or blocked
    // status, `blocked: stopped at budget` among them) shows that reason instead. Answered or not
    // is the orchestrator's `set-status.sh --budget-answered`.
    const settled = orch === "gone" || exactStatus(r.terminal, ctx) === "idle" || exactStatus(r.terminal, ctx) === "done";
    if (overBudget(r) && r.askedAt === null && !r.question && !r.away && r.phase !== "finished" && r.budgetAnswered !== r.budget
      && settled && !needsYou(r, orch)) { items.push(budgetItem(r, tokenText)); continue; }
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
  for (const d of decisions) {
    items.push({
      id: `dec-${d.key}`, kind: "decision", title: d.question, options: d.options, recommended: d.recommended, why: d.why,
      evidence: d.evidence, risk: d.risk, blocks: d.blocks, since: d.asked, decision: d,
      run: d.run ? runs.find((r) => r.dir === d.run && r.machine === d.machine) ?? null : null,
    });
  }
  return items.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity));
}

// ---- putting runs away and bringing them back ----
// The marker line herdr-app-captain's lib.sh writes with mark_run, written here on the
// run's machine: the mod is installed on its own, without the captain's scripts.

const MARK = 'd=$1 m=$2; { date -u +%Y-%m-%dT%H:%M:%SZ | tr -d "\\n"; printf "\\t"; sed -n "1s/^Status: *//p" "$d/plan.md"; } >"$d/.$m.tmp" && mv "$d/.$m.tmp" "$d/$m"';

// A message in the run's inbox, as herdr-app-captain relays them: written beside, then
// moved in, so the orchestrator never reads half of it.
const POST = 'd=$1 f=$2; mkdir -p "$d/inbox" && printf "%s\\n" "$3" >"$d/inbox/.$f.tmp" && mv "$d/inbox/.$f.tmp" "$d/inbox/$f"';

// Writes `text` to the run's inbox as <UTC yyyymmddThhmmssZ>-<source>.message and wakes the
// orchestrator: the one path Close and an answer from the queue share (run-files.md).
// Resolves to {blocked}: true when the orchestrator is on a dialog and reads the message
// once that is answered. Throws when the message could not be written, or the wake failed
// (the message then still waits in the inbox).
async function tellOrchestrator(run, source, text) {
  return wakeOrchestrator(run, await writeInbox(run, source, text));
}

// Writes the message to the run's inbox and returns its file name.
async function writeInbox(run, source, text) {
  // Milliseconds after the seconds, so two answers in one second are two files.
  const now = new Date().toISOString();
  const file = `${now.replace(/[-:]|\.\d+/g, "")}-${now.slice(20, 23)}-${source}.message`;
  const out = await exec("sh", ["-c", POST, "sh", run.dir, file, text], { on: run.machine });
  if (out.code !== 0) throw new Error(out.stderr || "could not write to its inbox");
  return file;
}

// Tells the orchestrator to read an inbox message (see tellOrchestrator for what it resolves to).
async function wakeOrchestrator(run, file) {
  const sent = await exec("hc", ["send", run.localTerminal, `Read and act on ${run.dir}/inbox/${file}.`], { on: run.machine }).catch((e) => ({ code: -1, stderr: e?.message ?? String(e) }));
  if (sent.code === 9) return { blocked: true };
  if (sent.code !== 0) throw Object.assign(new Error(`the message is in its inbox, but its orchestrator could not be told: ${(sent.stderr || sent.stdout || "hc send failed").trim()}`), { inInbox: true });
  return { blocked: false };
}

// Removes a captain decision from .captain-decisions.json on its machine, atomically, once
// its answer went to a run's inbox instead of the captain: nobody else would clear it.
const DROP = 'f="${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}/.captain-decisions.json"; [ -s "$f" ] && jq --arg id "$1" \'map(select(.id != $id))\' "$f" >"$f.tmp" && mv "$f.tmp" "$f"';
export const dropDecision = (d) => exec("sh", ["-c", DROP, "sh", d.id], { on: d.machine });

// Answers a run's question (or a captain decision that names the run) from the queue:
// `answer` is an option's label or the person's own words.
// A gone or lost orchestrator is never told: its terminal is gone, or only a shell, which
// would run the wake-up line as a command. The message waits in the inbox until the run is
// resumed, and this resolves to {blocked: false, waits: true}.
export async function answerRun(run, title, answer, free = "") {
  const text = answerMessage(title, answer, free);
  if (orchestratorState(run, facts()) === "gone") {
    await writeInbox(run, "harbormaster", text);
    return { blocked: false, waits: true };
  }
  return tellOrchestrator(run, "harbormaster", text);
}

// Compacts the orchestrator's context: the answer goes into its inbox first, then /compact is
// typed into its terminal (Claude Code and pi both take it as input), and only once the
// compaction is over (the terminal idle or done again) is it woken to read the answer: text
// typed while it compacts may be queued, left in the prompt or dropped. /compact goes in only
// while the orchestrator reports idle or done, checked here again just before sending, since
// the click may be seconds after the screen was drawn; an unknown status is not idle. Throws
// when it is not, or when the send fails; the answer then waits in the inbox, to be read as
// any other when the orchestrator is next woken.
export async function compactRun(run, title, answer) {
  const ok = () => ["idle", "done"].includes(exactStatus(run.terminal, facts()));
  if (!ok()) throw new Error("not compacted: its orchestrator is not idle or done");
  const file = await writeInbox(run, "harbormaster", answerMessage(title, answer));
  const sent = await exec("hc", ["send", run.localTerminal, "/compact"], { on: run.machine }).catch((e) => ({ code: -1, stderr: e?.message ?? String(e) }));
  if (sent.code === 9) throw new Error("not compacted: its orchestrator is blocked on a dialog; the answer is in its inbox");
  if (sent.code !== 0) throw new Error(`could not send /compact (the answer is in its inbox): ${(sent.stderr || sent.stdout || "hc send failed").trim()}`);
  // Compaction starts working, then ends: wait for working (up to 20 s; a very quick one may be
  // over before we look), then for idle or done again, for at most 10 minutes.
  const sleep = (s) => exec("sleep", [String(s)]).catch(() => {});
  for (let i = 0; i < 10 && ok(); i++) await sleep(2);
  for (let i = 0; i < 300 && !ok(); i++) await sleep(2);
  if (!ok()) throw new Error("compaction is still running after 10 minutes; the answer waits in its inbox");
  return wakeOrchestrator(run, file);
}

// Closing a run whose orchestrator is there asks it to clean up: it ends its agents,
// pushes what is not on the remote, deletes the run's worktrees, writes the closed
// marker and closes its own tab (herdr-app-orchestrator's section 9). Resolves to a note
// for the card, and whether it is blocked. A blocked orchestrator reads it once its dialog is answered.
async function askToClose(run) {
  const { blocked } = await tellOrchestrator(run, "harbormaster-close",
    "The user closed this run in Harbormaster. Clean up and close your tab, as in your skill's section 9 (Close).");
  return blocked
    ? { blocked: true, note: "its orchestrator is blocked on a dialog: answer it in its tab, and it then cleans up and closes" }
    : { blocked: false, note: "its orchestrator is cleaning up, and its tab closes when done" };
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

export async function deleteRun(run) {
  const out = await exec("sh", ["-c", DELETE, "sh", run.dir, run.folder ?? "", run.branch,
    run.localTerminal ?? "", run.away?.how === "closed" ? "1" : ""], { on: run.machine });
  if (out.code !== 0) throw new Error((out.stderr || "could not delete the run directory").trim());
  // The run's copied proof images go with it (they are on this computer whichever machine it ran on).
  await dropCache(run).catch(() => {});
  const prs = { ...(shared("harbormaster.prs") ?? {}) };
  delete prs[run.key];
  setShared("harbormaster.prs", prs);
  const seen = { ...(shared(WORKTREES_KEY) ?? {}) };
  if (seen[run.key]) { delete seen[run.key]; setShared(WORKTREES_KEY, seen); }
  cache.at = 0;
}

// Deletes several closed runs, one at a time per machine and the machines at once, each as
// deleteRun does, guards and all. Returns the runs it could not delete, each with why.
export async function deleteRuns(runs) {
  const byMachine = new Map();
  for (const r of runs) byMachine.set(r.machine ?? "", [...(byMachine.get(r.machine ?? "") ?? []), r]);
  const failed = [];
  await Promise.all([...byMachine.values()].map(async (list) => {
    for (const run of list) {
      try { await deleteRun(run); } catch (e) { failed.push({ run, error: e?.message ?? String(e) }); }
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
