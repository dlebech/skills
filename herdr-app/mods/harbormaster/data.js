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

import { exec, machines, spaces, shared, setShared, run as command } from "herdr";
import { orchestratorState, orchestratorLost, workersOf, needsYou, tabOf, liveTabOf, tabOfTerminal, tabInfo, homeSpace, worktreeSpaces, leftoverSpaces, captainOf, facts } from "./live.js";

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

// plan.md's tasks, as {id, name, state, about}. The orchestrator writes them freely, so
// three shapes are read:
//   a heading, "### t1 pin-spread — merged (45e5)", or with "status: merged" in it or in
//     a "- Status: merged (595a5bd1)" line below it; else the words after its first dash;
//   a table under a header row naming an `id` and a `status` column, such as
//     "| id | repo | scope | ... | status |" and "| api | snevagten-api | ... | merged d3c8862d |";
//     its `scope`, `task` or `name` column is what the task is about;
//   a list item under "## Tasks" with a "Status:", "1. ui — what it does. Status: merged (9eefaf1)".
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
// "merged (9eefaf1); worktree removed" → "merged"; "**done** here" → "done"; "merged d3c8862d" → "merged".
const stateWords = (s) => s.replace(/[*_`]/g, "").replace(/[(;,.].*$/, "").replace(/\s+[0-9a-f]{6,}\b.*$/i, "").trim().toLowerCase();
const statusIn = (text) => /\bstatus:\s*([^\n]+)/i.exec(text)?.[1] ?? null;
const DASH = /\s[—–-]\s+/;
function tasksOf(plan) {
  const out = [];
  let head = null; // the current table's columns, until the next ## heading
  let inTasks = false; // under a "## Tasks" heading
  let open = null; // the heading task still looking for a Status line below it
  for (const line of (plan ?? "").split("\n")) {
    const h = /^###\s+(\S+)\s+(.*)$/.exec(line);
    if (h) {
      const [first, ...rest] = h[2].split(DASH);
      const word = first.trim().split(/\s+/)[0] ?? "";
      const after = rest.join(" — ").replace(/\s*\(.*$/, "").trim();
      const status = statusIn(h[2]);
      // Without a Status, words after the dash are the state ("merged") or, with a Status
      // line to come, what the task is about ("pending-approval notifications").
      const task = { id: h[1], name: /^[\w-]+$/.test(word) ? word : "", state: status ? stateWords(status) : stateWords(after), about: null };
      out.push(task);
      open = status ? null : { task, after };
      continue;
    }
    if (/^##\s/.test(line)) { head = null; open = null; inTasks = /^##\s+tasks\b/i.test(line); continue; }
    if (open && /^\s*[-*]\s+status:/i.test(line)) {
      open.task.state = stateWords(statusIn(line));
      open.task.about = open.after || null;
      open = null;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const row = cells(line);
      if (row.every((c) => /^:?-+:?$/.test(c))) continue;
      const lower = row.map((c) => c.toLowerCase());
      if (lower.includes("id") && lower.includes("status")) {
        head = { id: lower.indexOf("id"), status: lower.indexOf("status"), about: ["scope", "task", "name", "what"].map((n) => lower.indexOf(n)).find((i) => i >= 0) ?? -1 };
      } else if (head && row[head.id]) {
        out.push({ id: row[head.id], name: "", state: stateWords(row[head.status] ?? ""), about: row[head.about] || null });
      }
      continue;
    }
    const li = inTasks && !open ? /^(?:\d+\.|[-*])\s+(\S+)\s+(.*)$/.exec(line) : null;
    const status = li && statusIn(li[2]);
    if (status) {
      const about = li[2].slice(0, li[2].search(/\bstatus:/i)).split(DASH).slice(1).join(" — ").replace(/[\s.;,]+$/, "");
      out.push({ id: li[1].replace(/[:—–-]+$/, ""), name: "", state: stateWords(status), about: about || null });
    }
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
      // The terminal as its own machine names it, for hc run there (`on: machine`),
      // which does not know the window's name for itself.
      localTerminal: orch.terminal ?? null,
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
    cache = { at: Date.now(), runs, decisions, errors, pending: null };
    const ctx = facts();
    for (const r of runs) if (r.away?.how === "closed") tidyClosed(r, ctx).catch(() => {});
    for (const r of runs) if (r.machine && !r.away) nameTab(r);
    nameCaptainTab(ctx);
    showWorktrees(runs, ctx, answered).catch(() => {});
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
  const sent = await exec("hc", ["send", run.localTerminal, `Read and act on ${run.dir}/inbox/${file}.`], { on: run.machine }).catch((e) => ({ code: -1, stderr: e?.message ?? String(e) }));
  if (sent.code === 9) return { blocked: true, note: "its orchestrator is blocked on a dialog: answer it in its tab, and it then cleans up and closes" };
  if (sent.code !== 0) throw new Error(`the message is in its inbox, but its orchestrator could not be told: ${(sent.stderr || sent.stdout || "hc send failed").trim()}`);
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

// The orchestrator's tab name for a run phase, as set-status.sh names it.
const TAB_MARK = { waiting: "✋ ", blocked: "✋ ", finished: "✓ " };
export const orchestratorTabName = (branch, phase) => `🐙 ${TAB_MARK[phase] ?? ""}${branch}`;

// Names an orchestrator's tab after its run's status, for a run on another machine.
// Its set-status.sh renames its own tab through herdr-app, which only reaches a window
// on its own computer: when Herdr runs on another one, connected over ssh, it cannot,
// and the tab keeps its old name. Harbormaster draws in the window, so it renames the
// tab from plan.md's status, which set-status.sh writes first. Only the tab its terminal
// is in now, as in tidyClosed, and only while the tab is unnamed or carries one of the
// orchestrator's own names (🐙 ...), so a name the person gave it stays. Each name is
// sent at most once a minute, so a rename that does not land is not repeated every 5 s.
function nameTab(run) {
  if (run.phase === "unknown") return;
  const tab = tabInfo(liveTabOf(run));
  if (!tab || (tab.named && !tab.name.startsWith("🐙"))) return;
  const name = orchestratorTabName(run.branch, run.phase);
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
  const seen = { ...(shared(WORKTREES_KEY) ?? {}) };
  if (seen[run.key]) { delete seen[run.key]; setShared(WORKTREES_KEY, seen); }
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
