// Run facts for Harbormaster: herdr-app-orchestrator run directories, read on
// every machine (this one and each one added with `hc machine add`), plus each
// run's pull requests from `gh`, asked on the machine that owns the run.
//
// Run directory protocol (herdr-app-captain's lib.sh):
//   <root>/<folder>/<branch>/orchestrator.json  {terminal, tab_id, folder, branch}
//   <root>/<folder>/<branch>/plan.md            "Status: <status>" first, then "### t1 name ... — <state>" tasks
//   <root>/<folder>/<branch>/status.json        {status, progress, tasks:{merged,planned}, issues, prs:[{repo,url}], waiting, updated}
//   <root>/<folder>/<branch>/question.md        the orchestrator's open question to the user
//   <root>/<folder>/<branch>/inbox/*.message    relayed messages not yet handled

import { exec, machines, terminals, agents, panes, run, shared, setShared, window } from "herdr";

const RS = "\u001e", US = "\u001f";

// One sh script per machine: every run, its files separated by \x1f, runs by \x1e.
const SCRIPT = [
  'root="${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}"',
  'for f in "$root"/*/*/orchestrator.json; do',
  '  [ -e "$f" ] || continue',
  '  d="${f%/orchestrator.json}"',
  "  printf '\\036%s\\037' \"$d\"",
  '  cat "$f"; printf \'\\037\'',
  '  cat "$d/status.json" 2>/dev/null; printf \'\\037\'',
  '  head -c 60000 "$d/plan.md" 2>/dev/null; printf \'\\037\'',
  '  [ -e "$d/question.md" ] && head -c 4000 "$d/question.md"; printf \'\\037\'',
  '  n=0; for m in "$d"/inbox/*.message; do [ -e "$m" ] && n=$((n+1)); done; echo "$n"',
  "done",
].join("\n");

const json = (s) => {
  try { return JSON.parse(s); } catch { return null; }
};

// "running" | "waiting" | "blocked" | "finished", from plan.md's Status line.
function phase(line, fallback) {
  const s = (line ?? fallback ?? "").toLowerCase();
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

function parse(machine, stdout) {
  return stdout.split(RS).filter((s) => s.trim()).map((chunk) => {
    const [dir, orch, status, plan, question, inbox] = chunk.split(US);
    const o = json(orch) ?? {};
    const st = json(status) ?? {};
    const statusLine = /^Status:\s*(.*)$/m.exec(plan ?? "")?.[1]?.trim() ?? null;
    const folder = o.folder ?? st.folder ?? "";
    const parts = dir.split("/");
    return {
      key: `${machine ?? ""}:${dir}`,
      machine,
      dir,
      repo: parts.at(-2) ?? folder.split("/").pop(),
      folder,
      branch: o.branch ?? st.branch ?? parts.at(-1),
      terminal: o.terminal ? (machine ? `${machine}/${o.terminal}` : o.terminal) : null,
      tab: o.tab_id ? (machine ? `${machine}/${o.tab_id}` : o.tab_id) : null,
      statusLine,
      phase: phase(statusLine, st.status),
      progress: st.progress ?? null,
      merged: st.tasks?.merged ?? null,
      planned: st.tasks?.planned ?? null,
      issues: st.issues ?? [],
      prs: (st.prs ?? []).map((p) => (typeof p === "string" ? { url: p } : p)),
      waiting: st.waiting ?? [],
      updated: st.updated ? Date.parse(st.updated) : null,
      question: question?.trim() || null,
      unhandled: Number(inbox?.trim() || 0),
      tasks: tasksOf(plan),
    };
  });
}

// Every copy asks through one cache, so a layout with several copies reads once.
let cache = { at: 0, runs: [], errors: [], pending: null };

export function cachedRuns() {
  return cache;
}

export function loadRuns() {
  if (Date.now() - cache.at < 2500) return Promise.resolve(cache);
  if (cache.pending) return cache.pending;
  cache.pending = (async () => {
    const names = machines().filter((m) => m.layout !== "unavailable").map((m) => m.name);
    if (!names.includes(null)) names.unshift(null);
    const runs = [], errors = [];
    await Promise.all(names.map(async (on) => {
      try {
        const r = await exec("sh", ["-c", SCRIPT], { on });
        runs.push(...parse(on, r.stdout));
      } catch (e) {
        errors.push(`${on ?? "this machine"}: ${e?.message ?? e}`);
      }
    }));
    runs.sort((a, b) => (a.machine ?? "").localeCompare(b.machine ?? "") || a.dir.localeCompare(b.dir));
    cache = { at: Date.now(), runs, errors, pending: null };
    return cache;
  })().catch((e) => {
    cache = { ...cache, pending: null, errors: [String(e)] };
    return cache;
  });
  return cache.pending;
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

// Refreshes a run's PRs when stale: every 60 s while it runs, every 15 min once finished.
export async function refreshPrs(run) {
  const all = shared("harbormaster.prs") ?? {};
  const have = all[run.key];
  const ttl = run.phase === "finished" ? 15 * 60000 : 60000;
  if (prBusy.has(run.key) || (have && Date.now() - have.at < ttl)) return;
  prBusy.add(run.key);
  try {
    const list = [];
    const seen = new Set();
    for (const pr of run.prs) {
      if (!pr.url) continue;
      const out = await exec("gh", ["pr", "view", pr.url, "--json", PR_FIELDS], { on: run.machine }).catch(() => null);
      const p = out?.code === 0 ? json(out.stdout) : null;
      if (p) { list.push(prSummary(p, pr.repo)); seen.add(p.url); }
      else list.push(unknownPr(pr.url, pr.repo));
    }
    // Before the orchestrator records one: a PR from the run's branch.
    if (run.folder && run.branch) {
      const out = await exec("gh", ["pr", "list", "--head", run.branch, "--state", "all", "--limit", "3", "--json", PR_FIELDS], { cwd: run.folder, on: run.machine }).catch(() => null);
      for (const p of (out?.code === 0 ? json(out.stdout) : null) ?? []) if (!seen.has(p.url)) list.push(prSummary(p));
    }
    const next = { ...(shared("harbormaster.prs") ?? {}) };
    next[run.key] = { at: Date.now(), list };
    // Forget runs that are gone.
    for (const key of Object.keys(next)) if (cache.runs.length && !cache.runs.some((r) => r.key === key)) delete next[key];
    setShared("harbormaster.prs", next);
  } finally {
    prBusy.delete(run.key);
  }
}

// ---- live facts from herdr-core ----

// The terminal and agent lists every helper below reads, taken once per render.
export const facts = () => ({ terminals: terminals(), agents: agents() });

// One status rule for any agent: its agent status, else its terminal's ("error" means
// blocked), else idle. Values: working, blocked, done, idle.
export function agentStatus(term, ctx) {
  const s = ctx.agents.find((a) => a.address === term.address)?.status ?? term.status;
  return s === "error" ? "blocked" : s ?? "idle";
}

// The orchestrator's status, or "gone" when its terminal has ended.
export function orchestratorState(run, ctx) {
  const term = run.terminal && ctx.terminals.find((t) => t.address === run.terminal);
  if (!ctx.agents.some((a) => a.address === run.terminal) && (!term || term.state !== "live")) return "gone";
  return agentStatus(term ?? { address: run.terminal }, ctx);
}

// Live sub-agents of an address, depth first.
export function workersOf(address, ctx) {
  if (!address) return [];
  const kids = ctx.terminals.filter((t) => t.parent === address && t.state === "live");
  return kids.flatMap((t) => [t, ...workersOf(t.address, ctx)]);
}

export function captainOf(ctx) {
  const live = ctx.terminals.filter((t) => t.state === "live");
  const terminal = live.find((t) => t.labels?.role === "captain") ?? null;
  const watching = live.some((t) => t.name === "captain-watch" || t.address?.endsWith("/captain-watch"));
  return { terminal, watching };
}

// The captain's pane, and the Harbormaster pane pinned beside it in the same tab, if any.
export function captainPane(ctx) {
  const cap = captainOf(ctx).terminal;
  const all = panes();
  const own = cap && all.find((p) => p.terminal === cap.address);
  if (!own) return null;
  return { pane: own.pane, pinned: all.find((p) => p.tab === own.tab && p.mod === "harbormaster")?.pane ?? null };
}

// Shows the runs overview as a pane right of the captain, or closes it again.
export function togglePin(captain) {
  if (captain.pinned) run("pane.close", { pane: captain.pinned });
  else run("pane.split", { pane: captain.pane, direction: "right", mod: "harbormaster" });
}

// Does this run need the person? An open question, a blocked plan, or a blocked orchestrator.
export function needsYou(run, orchState) {
  return Boolean(run.question) || run.phase === "waiting" || run.phase === "blocked" || orchState === "blocked";
}

// Totals across runs, for the summary bar, the overview header and the harbor.
export function stats(runs, ctx) {
  const live = runs.filter((r) => r.phase !== "finished");
  const open = runs.flatMap((r) => prsOf(r) ?? []).filter(isOpen);
  return {
    live,
    finished: runs.filter((r) => r.phase === "finished"),
    need: live.filter((r) => needsYou(r, orchestratorState(r, ctx))),
    open,
    failing: open.filter((p) => p.checks?.fail).length,
    merged: live.reduce((n, r) => n + (r.merged ?? 0), 0),
    planned: live.reduce((n, r) => n + (r.planned ?? 0), 0),
    workers: live.reduce((n, r) => n + workersOf(r.terminal, ctx).length, 0),
  };
}

// A task's state word(s) → "done" | "working" | "blocked" | null (not started).
export function taskTone(state) {
  const s = state ?? "";
  if (/^(merged|done|finished|complete)/.test(s)) return "done";
  if (/block|fail|stuck/.test(s)) return "blocked";
  if (/^(planned|todo|pending|queued|not started|waiting to start)/.test(s) || !s) return null;
  return "working";
}

// "1 run", "2 runs"; pass the plural when it isn't word + "s".
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function openUrl(url) {
  const platform = window()?.platform;
  const cmd = platform === "macos" ? "open" : platform === "windows" ? "explorer" : "xdg-open";
  exec(cmd, [url]).catch(() => {});
}

export function ago(ms) {
  if (!ms) return "";
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// "https://github.com/o/repo/issues/12" → "repo#12".
export const shortRef = (url) => {
  const m = /github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/.exec(url ?? "");
  return m ? `${m[2]}#${m[4]}` : url;
};
