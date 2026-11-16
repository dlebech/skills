// The run history: one summary line per closed run, appended to .history.jsonl in the runs
// root of the run's machine, so the stats view can show runs whose directory is gone. The
// line's format is in skills/herdr-app-orchestrator/references/run-files.md.
//
// Nothing here may block closing or deleting a run: every failure resolves, never rejects.

import { exec } from "herdr";
import { loadTiming } from "./timing.js";
import { resourcesOf, chunks } from "./resources.js";

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

// The history line for a run, from its timing (timing.sh's JSON, or null), its resources
// (.resources.json, or null) and the run read by data.js. Missing pieces are null.
// `closedMs` is the closed marker's time, or the delete time. Pure, for tests.
export function buildLine(run, timing, resources, closedMs, now = Date.now()) {
  const res = resources?.agents ?? {};
  const resNames = Object.keys(res);
  // A timing agent's resources: by the name its brief gave it, else its worktree name; the
  // orchestrator is the one terminal that has no parent among the others.
  const matchRes = (a) => {
    if (a.role === "orchestrator") return resNames.find((n) => !res[n].parent || !res[res[n].parent]) ?? null;
    return [a.label, a.name].find((n) => n && res[n]) ?? null;
  };
  const agents = (timing?.agents ?? []).map((a) => {
    const r = res[matchRes(a)];
    return {
      name: a.label || a.name, role: a.role ?? null, task: a.task ?? null, kind: a.kind ?? null,
      total: a.total ?? null, categories: a.categories ?? {},
      cpu_s: r?.cpu_s ?? null, peak_rss_mb: r?.peak_rss_mb ?? null, avg_rss_mb: r?.avg_rss_mb ?? null,
    };
  });
  const tasks = (timing?.tasks ?? []).map((t) => {
    const own = agents.filter((a) => a.task === t.id && a.cpu_s != null);
    return {
      id: t.id, total: t.total ?? null, categories: t.categories ?? {},
      cpu_s: own.length ? r1(own.reduce((s, a) => s + a.cpu_s, 0)) : null,
      // The agents of a task need not have run together, so this is the largest one's.
      peak_rss_mb: own.length ? Math.max(...own.map((a) => a.peak_rss_mb ?? 0)) : null,
    };
  });
  const programs = {};
  for (const a of Object.values(res)) {
    for (const [p, v] of Object.entries(a.programs ?? {})) {
      const x = (programs[p] ??= { cpu_s: 0, peak_rss_mb: 0 });
      x.cpu_s = r1(x.cpu_s + (v.cpu_s ?? 0));
      x.peak_rss_mb = Math.max(x.peak_rss_mb, v.peak_rss_mb ?? 0);
    }
  }
  for (const [p, v] of Object.entries(resources?.programs ?? {})) programs[p] ??= { cpu_s: v.cpu_s ?? null, peak_rss_mb: null };
  const t = timing?.tokens ?? null;
  const tokens = t && Number(t.total) > 0
    ? { total: Number(t.total), input: Number(t.input) || 0, output: Number(t.output) || 0, cache_read: Number(t.cache_read) || 0, cache_write: Number(t.cache_write) || 0 }
    : run.tokens
      ? { total: run.tokens.total, input: run.tokens.input, output: run.tokens.output, cache_read: run.tokens.cacheRead, cache_write: run.tokens.cacheWrite }
      : null;
  return {
    v: 1,
    run: run.dir, folder: run.folder ?? null, branch: run.branch ?? null, type: run.type ?? null,
    topic: run.topic ?? null, machine: run.machine ?? null,
    started: iso(run.started) ?? timing?.start ?? null,
    ended: timing?.end ?? null,
    closed: iso(closedMs),
    status: run.statusLine ?? null,
    tasks_merged: run.merged ?? null, tasks_planned: run.planned ?? null,
    wall: timing?.wall ?? null,
    critical_path: timing?.critical_path ?? null,
    categories: timing?.categories ?? null,
    tasks, agents, tokens,
    resources: resources
      ? { cpu_s: resources.cpu_s ?? null, peak_rss_mb: resources.peak_rss_mb ?? null, avg_rss_mb: resources.avg_rss_mb ?? null, estimated: Boolean(resources.estimated), programs }
      : null,
    recorded: iso(now),
  };
}

// Run on the run's machine. $1 the run directory, $2 "check" or "append", $3 the run's
// `"run":..` JSON fragment, $4 its `"started":..` one, $5 its `"closed":..` one (empty:
// any closing of the run counts), then, to append, the line in pieces.
// The file is next to the runs: the root is two levels up from the run directory.
// check: exits 5 when the line is there already. append: the same check under a mkdir lock
// (a lock left by a killed writer is broken after a minute), then one write of one line.
export const HISTORY = [
  'd=$1 mode=$2 a=$3 b=$4 c=$5; shift 5',
  'f="${d%/*/*}/.history.jsonl" l="${d%/*/*}/.history.jsonl.lock"',
  'has() { [ -f "$f" ] && grep -F -- "$a" "$f" | grep -F -- "$b" | grep -qF -- "$c"; }',
  'has && exit 5',
  '[ "$mode" = check ] && exit 0',
  'if ! mkdir "$l" 2>/dev/null; then',
  '  [ -n "$(find "$l" -maxdepth 0 -mmin +1 2>/dev/null)" ] && rmdir "$l" 2>/dev/null',
  '  mkdir "$l" 2>/dev/null || exit 3',
  'fi',
  "trap 'rmdir \"$l\" 2>/dev/null' EXIT",
  'has && exit 5',
  'printf "%s\\n" "$(printf "%s" "$@")" >>"$f"',
].join("\n");

const frag = (key, value) => JSON.stringify(key) + ":" + JSON.stringify(value);

// Runs written, by "<run key>|<closed>" (or the run key alone for a delete without a
// closed marker), and the writes under way, so a poll that sees the same closed run again
// does nothing. A run whose timing could not be read is tried again after RETRY ms.
const done = new Set();
const pending = new Map();
const failedAt = new Map();
const RETRY = 5 * 60000;

// Appends the run's line unless it is there: true once written or found, false when not
// (timing unreadable and `force` unset, or the write failed). `how`: "closed" for a run
// Harbormaster saw closed, "delete" just before it goes (writes even without timing).
export function writeHistory(run, how) {
  const closedMs = run.away?.how === "closed" ? run.away.at : null;
  const id = closedMs ? `${run.key}|${closedMs}` : run.key;
  if (done.has(id) || (closedMs && done.has(run.key))) return Promise.resolve(true);
  if (pending.has(id)) return pending.get(id);
  if (how === "closed" && Date.now() - (failedAt.get(id) ?? 0) < RETRY) return Promise.resolve(false);
  const p = (async () => {
    const parts = [frag("run", run.dir), run.started ? frag("started", iso(run.started)) : "", closedMs ? frag("closed", iso(closedMs)) : ""];
    const on = { on: run.machine };
    // A closing already recorded costs one grep, not a timing read.
    const seen = await exec("sh", ["-c", HISTORY, "sh", run.dir, "check", ...parts], on);
    if (seen.code === 5) return true;
    if (seen.code !== 0) return false;
    // The first read of a big run parses every transcript, so loadTiming allows it long.
    const timing = await loadTiming(run, { maxAge: 10 * 60000 });
    if (!timing && how === "closed") return false;
    const line = JSON.stringify(buildLine(run, timing, resourcesOf(run), closedMs ?? Date.now()));
    const out = await exec("sh", ["-c", HISTORY, "sh", run.dir, "append", ...parts, ...chunks(line)], on);
    return out.code === 0 || out.code === 5;
  })().catch(() => false).then((ok) => {
    pending.delete(id);
    if (ok) done.add(id); else failedAt.set(id, Date.now());
    return ok;
  });
  pending.set(id, p);
  return p;
}

// Before a run's directory goes: waits for the write, but only so long, then lets the
// delete go ahead.
export async function writeHistoryBeforeDelete(run, timeout = 90000) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeout); });
  try { return await Promise.race([writeHistory(run, "delete"), late]); } finally { clearTimeout(timer); }
}
