// Run facts for the runs mod: herdr-app-orchestrator run directories, read on
// every machine (this one and each one added with `hc machine add`), plus each
// run's pull requests from `gh`, asked on the machine that owns the run.
//
// Run directory protocol (herdr-app-captain's lib.sh):
//   <root>/<folder>/<branch>/orchestrator.json  {terminal, tab_id, folder, branch}
//   <root>/<folder>/<branch>/plan.md            "Status: <status>" first, then "### t1 name ... — <state>" tasks
//   <root>/<folder>/<branch>/status.json        {status, progress, tasks:{merged,planned}, issues, prs:[{repo,url}], waiting, updated}
//   <root>/<folder>/<branch>/question.md        the orchestrator's open question to the user
//   <root>/<folder>/<branch>/inbox/*.message    relayed messages not yet handled

import { exec, machines, terminals, agents, shared, setShared, window } from "herdr";

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
let cache = { at: 0, runs: [], errors: [], p: null };

export function cachedRuns() {
  return cache;
}

export function loadRuns() {
  if (Date.now() - cache.at < 2500) return Promise.resolve(cache);
  if (cache.p) return cache.p;
  cache.p = (async () => {
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
    cache = { at: Date.now(), runs, errors, p: null };
    return cache;
  })().catch((e) => {
    cache = { ...cache, p: null, errors: [String(e)] };
    return cache;
  });
  return cache.p;
}

// ---- pull requests (gh), cached in shared state so every copy and layout reuses them ----

const PR_FIELDS = "number,title,state,isDraft,reviewDecision,statusCheckRollup,url,headRefName";
let prBusy = new Set();

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

const slim = (p, repo) => ({
  number: p.number,
  title: p.title,
  state: p.isDraft && p.state === "OPEN" ? "DRAFT" : p.state,
  review: p.reviewDecision || null,
  checks: checks(p.statusCheckRollup),
  url: p.url,
  repo: repo ?? (/github\.com\/([^/]+\/[^/]+)\//.exec(p.url ?? "")?.[1] ?? null),
});

export function prsOf(run) {
  return shared("harbormaster.prs")?.[run.key]?.list ?? null;
}

// Refreshes a run's PRs when stale: every 60 s while it runs, every 15 min once finished.
export async function refreshPrs(run) {
  const all = shared("harbormaster.prs") ?? {};
  const have = all[run.key];
  const ttl = run.phase === "finished" ? 15 * 60000 : 60000;
  if (prBusy.has(run.key) || (have && Date.now() - have.at < ttl)) return false;
  prBusy.add(run.key);
  try {
    const list = [];
    const seen = new Set();
    for (const pr of run.prs) {
      if (!pr.url) continue;
      const r = await exec("gh", ["pr", "view", pr.url, "--json", PR_FIELDS], { on: run.machine }).catch(() => null);
      const p = r?.code === 0 ? json(r.stdout) : null;
      if (p) { list.push(slim(p, pr.repo)); seen.add(p.url); }
      else list.push({ number: null, title: pr.url, state: "UNKNOWN", review: null, checks: { pass: 0, fail: 0, pending: 0 }, url: pr.url, repo: pr.repo ?? null });
    }
    // Before the orchestrator records one: a PR from the run's branch.
    if (run.folder && run.branch) {
      const r = await exec("gh", ["pr", "list", "--head", run.branch, "--state", "all", "--limit", "3", "--json", PR_FIELDS], { cwd: run.folder, on: run.machine }).catch(() => null);
      for (const p of (r?.code === 0 ? json(r.stdout) : null) ?? []) if (!seen.has(p.url)) list.push(slim(p));
    }
    const next = { ...(shared("harbormaster.prs") ?? {}) };
    next[run.key] = { at: Date.now(), list };
    // Forget runs that are gone.
    for (const k of Object.keys(next)) if (!cache.runs.some((r) => r.key === k) && cache.runs.length) delete next[k];
    if (JSON.stringify(next[run.key]?.list) !== JSON.stringify(have?.list) || !have) setShared("harbormaster.prs", next);
    else { all[run.key] = { ...have, at: Date.now() }; setShared("harbormaster.prs", { ...all }); }
    return true;
  } finally {
    prBusy.delete(run.key);
  }
}

// ---- live facts from herdr-core ----

export function termOf(address, all = terminals()) {
  return address ? all.find((t) => t.address === address) ?? null : null;
}

// The orchestrator's own agent status (working, blocked, idle, done) or "gone".
export function orchestratorState(run, all = terminals(), listed = agents()) {
  const a = listed.find((x) => x.address === run.terminal);
  if (a) return a.status;
  const t = termOf(run.terminal, all);
  if (!t || t.state !== "live") return "gone";
  return t.status === "error" ? "blocked" : t.status ?? "idle";
}

// Live sub-agents of an address, depth first.
export function workersOf(address, all = terminals()) {
  const kids = all.filter((k) => k.parent === address && k.state === "live");
  return kids.flatMap((k) => [k, ...workersOf(k.address, all)]);
}

export function workerStatus(k, listed = agents()) {
  const s = listed.find((a) => a.address === k.address)?.status ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s ?? "idle";
}

export function captainOf(all = terminals()) {
  const cap = all.find((t) => t.state === "live" && t.labels?.role === "captain") ?? null;
  const watch = all.find((t) => t.state === "live" && (t.name === "captain-watch" || t.address?.endsWith("/captain-watch")));
  return { terminal: cap, watching: Boolean(watch) };
}

// Does this run need the person? An open question, a blocked plan, or a blocked orchestrator.
export function needsYou(run, oState) {
  return Boolean(run.question) || run.phase === "waiting" || run.phase === "blocked" || oState === "blocked";
}

// A task's state word(s) → "done" | "working" | "blocked" | null (not started).
export function taskTone(state) {
  const s = state ?? "";
  if (/^(merged|done|finished|complete)/.test(s)) return "done";
  if (/block|fail|stuck/.test(s)) return "blocked";
  if (/^(planned|todo|pending|queued|not started|waiting to start)/.test(s) || !s) return null;
  return "working";
}

export function openUrl(url) {
  const cmd = window()?.platform === "macos" ? "open" : window()?.platform === "windows" ? "explorer" : "xdg-open";
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

export const short = (url) => {
  const m = /github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/.exec(url ?? "");
  return m ? `${m[2]}#${m[4]}` : url;
};
