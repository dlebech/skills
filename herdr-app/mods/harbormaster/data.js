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
import { orchestratorState, orchestratorLost, workersOf, needsYou, tabOf, liveTabOf, homeSpace, worktreeSpaces, leftoverSpaces, facts } from "./live.js";

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
    const ctx = facts();
    for (const r of runs) if (r.away?.how === "closed") tidyClosed(r, ctx).catch(() => {});
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

// A message in the run's inbox, as herdr-app-captain relays them: written beside, then
// moved in, so the orchestrator never reads half of it.
const POST = 'd=$1 f=$2; printf "%s\\n" "$3" >"$d/inbox/.$f.tmp" && mv "$d/inbox/.$f.tmp" "$d/inbox/$f"';

// Closing a run whose orchestrator is there asks it to clean up: it ends its agents,
// pushes what is not on the remote, deletes the run's worktrees, writes the closed
// marker and closes its own tab (herdr-app-orchestrator's section 9). Resolves to a note
// for the card, and whether it is blocked. A blocked orchestrator reads it once its dialog is answered.
async function askToClose(run) {
  const file = `harbormaster-close-${Math.floor(Date.now() / 1000)}.message`;
  const text = "The user closed this run in Harbormaster. Clean up and close your tab, as in your skill's section 9 (Close).";
  const out = await exec("sh", ["-c", POST, "sh", run.dir, file, text], { on: run.machine });
  if (out.code !== 0) throw new Error(out.stderr || "could not write to its inbox");
  const sent = await exec("hc", ["send", run.terminal, `Read and act on ${run.dir}/inbox/${file}.`], { on: run.machine }).catch(() => null);
  if (sent?.code === 9) return { blocked: true, note: "its orchestrator is blocked on a dialog: answer it in its tab, and it then cleans up and closes" };
  return { blocked: false, note: "its orchestrator is cleaning up, and its tab closes when done" };
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

// The window commands Harbormaster sends for a closed run on its own, at most once a
// minute per tab or space, so the 5 s refresh does not repeat them while they land.
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
// was closed without cleaning up: resume it and close it again first. The rm is guarded
// so it only ever removes a run directory under the runs root.
const DELETE = [
  'd=$1 folder=$2 branch=$3',
  'root="${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}"',
  'case "$d" in "$root"/*/*) ;; *) echo "not a run directory: $d" >&2; exit 2;; esac',
  '[ -f "$d/orchestrator.json" ] || { echo "not a run directory: $d" >&2; exit 2; }',
  'for r in "$folder" "$folder"/*/; do',
  '  [ -e "$r/.git" ] || continue',
  '  if git -C "$r" worktree list --porcelain 2>/dev/null | grep -qxF "branch refs/heads/$branch"; then',
  '    echo "its worktrees are still there: resume it and close it again to clean them up, then delete it" >&2; exit 3',
  '  fi',
  'done',
  'rm -rf -- "$d" && rmdir -- "${d%/*}" 2>/dev/null; exit 0',
].join("\n");

export async function deleteRun(run) {
  const out = await exec("sh", ["-c", DELETE, "sh", run.dir, run.folder ?? "", run.branch], { on: run.machine });
  if (out.code !== 0) throw new Error((out.stderr || "could not delete the run directory").trim());
  const prs = { ...(shared("harbormaster.prs") ?? {}) };
  delete prs[run.key];
  setShared("harbormaster.prs", prs);
  cache.at = 0;
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
