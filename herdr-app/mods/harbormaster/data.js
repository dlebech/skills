// Run facts for Harbormaster: herdr-app-orchestrator run directories, read on
// every machine (this one and each one added with `hc machine add`), plus each
// run's pull requests from `gh`, asked on the machine that owns the run.
// Live facts from herdr-core are in live.js; text helpers in ui.js.
//
// Run directory protocol (herdr-app-captain's lib.sh):
//   <root>/<folder>/<branch>/orchestrator.json  {terminal, tab_id, folder, branch}
//   <root>/<folder>/<branch>/plan.md            "Status: <status>" first, then "### t1 name ... — <state>" tasks
//   <root>/<folder>/<branch>/status.json        {status, progress, tasks:{merged,planned}, issues, prs:[{repo,url}], related:[{repo,url}], waiting, updated}
//   <root>/<folder>/<branch>/question.md        the orchestrator's open question to the user
//   <root>/<folder>/<branch>/inbox/*.message    relayed messages not yet handled
//   <root>/<folder>/<branch>/parked, closed     the person put the run away: "<time>\t<status then>"
//   <root>/.captain-decisions.json              the captain's open decisions: [{id, question, run, asked}]

import { exec, machines, shared, setShared, run as command } from "herdr";
import { orchestratorState, workersOf, needsYou, tabOf, homeSpace } from "./live.js";

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
  '  [ -e "$d/parked" ] && { printf +; head -c 400 "$d/parked"; }; printf \'\\037\'',
  '  [ -e "$d/closed" ] && { printf +; head -c 400 "$d/closed"; }; printf \'\\037\'',
  '  n=0; for m in "$d"/inbox/*.message; do [ -e "$m" ] && n=$((n+1)); done; echo "$n"',
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

// "### t1 pin-spread (Del 2) — merged (45e5) (branch ...)" → {id, name, state}
function tasksOf(plan) {
  const out = [];
  for (const line of (plan ?? "").split("\n")) {
    const m = /^###\s+(\S+)\s+(\S+)[^\n]*?\s[—–-]\s+([A-Za-z][^()\n]*?)\s*(?:\(|$)/.exec(line);
    if (m) out.push({ id: m[1], name: m[2], state: m[3].toLowerCase() });
  }
  return out;
}

// The captain's open decisions, oldest first: {key, id, question, run, asked, machine}.
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
  }));
}

function parse(machine, stdout) {
  return stdout.split(RS).slice(1).filter((s) => s.trim()).map((chunk) => {
    const [dir, orchFile, statusFile, plan, question, parkedFile, closedFile, inbox] = chunk.split(US);
    const orch = json(orchFile) ?? {};
    const status = json(statusFile) ?? {};
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
      tab: onMachine(orch.tab_id),
      kind: orch.kind ?? null,
      away: marker("closed", closedFile) ?? marker("parked", parkedFile),
      statusLine,
      phase: runPhase(statusLine ?? status.status),
      progress: status.progress ?? null,
      merged: status.tasks?.merged ?? null,
      planned: status.tasks?.planned ?? null,
      issues: status.issues ?? [],
      prs: (status.prs ?? []).map((p) => (typeof p === "string" ? { url: p } : p)),
      // PRs the run is about but did not open, such as the one a review-only run reviews.
      related: (status.related ?? []).map((p) => (typeof p === "string" ? { url: p } : p)),
      waiting: status.waiting ?? [],
      updated: status.updated ? Date.parse(status.updated) : null,
      question: question?.trim() || null,
      unhandled: Number(inbox?.trim() || 0),
      tasks: tasksOf(plan),
    };
  });
}

// A parked or closed marker, "+" and its first line: { how, at, was }, or null without one.
function marker(how, text) {
  if (!text?.startsWith("+")) return null;
  const [at, was] = text.slice(1).split("\n")[0].split("\t");
  return { how, at: Date.parse(at) || null, was: was?.trim() || null };
}

// Every copy asks through one cache, so a layout with several copies reads once.
let cache = { at: 0, runs: [], decisions: [], errors: [], pending: null };

export function cachedRuns() {
  return cache;
}

export function loadRuns() {
  if (Date.now() - cache.at < 2500) return Promise.resolve(cache);
  if (cache.pending) return cache.pending;
  cache.pending = (async () => {
    const names = machines().filter((m) => m.layout !== "unavailable").map((m) => m.name);
    if (!names.includes(null)) names.unshift(null);
    const runs = [], decisions = [], errors = [];
    await Promise.all(names.map(async (on) => {
      try {
        const out = await exec("sh", ["-c", SCRIPT], { on });
        decisions.push(...parseDecisions(on, out.stdout.split(RS)[0]));
        runs.push(...parse(on, out.stdout));
      } catch (e) {
        errors.push(`${on ?? "this machine"}: ${e?.message ?? e}`);
      }
    }));
    runs.sort((a, b) => (a.machine ?? "").localeCompare(b.machine ?? "") || a.dir.localeCompare(b.dir));
    decisions.sort((a, b) => (a.asked ?? 0) - (b.asked ?? 0));
    cache = { at: Date.now(), runs, decisions, errors, pending: null };
    return cache;
  })().catch((e) => {
    cache = { ...cache, pending: null, errors: [String(e)] };
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

// A task's state as Harbormaster shows it: "merged" reads "done", since a task merges
// into the run's integration branch, not into main, and "merged" suggests the latter.
export const stateText = (state) => (state ?? "").replace(/^merged\b/, "done");

// How many tasks a run has merged and planned, from status.json, else plan.md.
export function taskCounts(run) {
  return {
    merged: run.merged ?? run.tasks.filter((task) => task.state === "merged").length,
    planned: Math.max(run.planned ?? 0, run.tasks.length),
  };
}

// ---- pull requests (gh), cached in shared state so every copy and layout reuses them ----

const PR_FIELDS = "number,title,state,isDraft,reviewDecision,statusCheckRollup,url,headRefName";
const prBusy = new Set();

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

// What the views need from `gh pr view --json` output.
const prSummary = (p, repo) => ({
  number: p.number,
  title: p.title,
  state: p.isDraft && p.state === "OPEN" ? "DRAFT" : p.state,
  review: p.reviewDecision || null,
  checks: checks(p.statusCheckRollup),
  url: p.url,
  repo: repo ?? (/github\.com\/([^/]+\/[^/]+)\//.exec(p.url ?? "")?.[1] ?? null),
});

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
  if (prBusy.has(run.key) || (have && Date.now() - have.at < ttl)) return;
  prBusy.add(run.key);
  try {
    const seen = new Set(run.related.map((p) => p.url));
    const view = async (recorded) => {
      const out = [];
      for (const pr of recorded) {
        if (!pr.url) continue;
        const res = await exec("gh", ["pr", "view", pr.url, "--json", PR_FIELDS], { on: run.machine }).catch(() => null);
        const p = res?.code === 0 ? json(res.stdout) : null;
        if (p) { out.push(prSummary(p, pr.repo)); seen.add(p.url); }
        else out.push(unknownPr(pr.url, pr.repo));
      }
      return out;
    };
    const related = await view(run.related);
    const list = await view(run.prs);
    // Before the orchestrator records one: a PR from the run's branch.
    if (run.folder && run.branch) {
      const out = await exec("gh", ["pr", "list", "--head", run.branch, "--state", "all", "--limit", "3", "--json", PR_FIELDS], { cwd: run.folder, on: run.machine }).catch(() => null);
      for (const p of (out?.code === 0 ? json(out.stdout) : null) ?? []) if (!seen.has(p.url)) list.push(prSummary(p));
    }
    const next = { ...(shared("harbormaster.prs") ?? {}) };
    next[run.key] = { at: Date.now(), list, related };
    // Forget runs that are gone.
    for (const key of Object.keys(next)) if (cache.runs.length && !cache.runs.some((r) => r.key === key)) delete next[key];
    setShared("harbormaster.prs", next);
  } finally {
    prBusy.delete(run.key);
  }
}

// ---- totals ----

// A run is closed when the person closed it for good (a closed marker), or once it is
// finished and its orchestrator's terminal is gone: they closed its tab. A finished run
// whose orchestrator is still there stays open, with its PR up. An unfinished run whose
// terminal is gone is not closed: it is parked if they set it aside, else gone, which
// the captain asks about and the run's card offers to resume.
export function isClosed(run, ctx) {
  if (run.away) return run.away.how === "closed";
  return run.phase === "finished" && orchestratorState(run, ctx) === "gone";
}
export const isParked = (run) => run.away?.how === "parked";

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

// ---- putting runs away and bringing them back ----
// The marker line herdr-app-captain's lib.sh writes with mark_run, written here on the
// run's machine: the mod is installed on its own, without the captain's scripts.

const MARK = 'd=$1 m=$2; { date -u +%Y-%m-%dT%H:%M:%SZ | tr -d "\\n"; printf "\\t"; sed -n "1s/^Status: *//p" "$d/plan.md"; } >"$d/.$m.tmp" && mv "$d/.$m.tmp" "$d/$m"';

// Parks the run (for later) or closes it for good: writes the marker, then closes the
// orchestrator's tab, which ends it and its agents. The run directory, worktrees,
// branches, spaces and PRs stay. how: "parked" | "closed"; orch: orchestratorState().
// A finished run needs no marker to close: closing its tab does. With the orchestrator
// still there but no tab to close, it refuses, so a marker never hides a live run.
export async function putAway(run, how, orch) {
  const tab = tabOf(run);
  if (!tab && orch !== "gone") throw new Error("cannot find the orchestrator's tab; close it by hand");
  if (how === "parked" || run.phase !== "finished") {
    const out = await exec("sh", ["-c", MARK, "sh", run.dir, how], { on: run.machine });
    if (out.code !== 0) throw new Error(out.stderr || `could not write ${how}`);
  }
  if (tab) command("tab.close", { id: tab, confirmed: true });
  cache.at = 0;
}

// Resumes the run with a new orchestrator of its kind, in the repository's space, or in a
// new one for it when none is open. The orchestrator's init-run.sh deletes the markers
// and it reopens the integration worktree under that space.
export function resumeRun(run) {
  const kind = run.kind || "claude";
  const prompt = `${kind === "pi" ? "/skill:" : "/"}herdr-app-orchestrator ${run.dir}/spec.md`;
  const space = homeSpace(run);
  if (space) command("tab.new", { space: space.id, folder: run.folder, argv: [kind], task: prompt });
  else command("space.new", { folder: run.folder, argv: [kind], task: prompt, machine: run.machine ?? "" });
  cache.at = 0;
}
