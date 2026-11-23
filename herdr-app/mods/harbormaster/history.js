// The run history: one summary line per closed run, appended to .history.jsonl in the runs
// root of the run's machine, so the stats view can show runs whose directory is gone. The
// line's format is in skills/herdr-app-orchestrator/references/run-files.md.
//
// Nothing here may block closing or deleting a run: every failure resolves, never rejects.

import { exec } from "herdr";
import { loadTiming } from "./timing.js";
import { resourcesOf, chunks } from "./resources.js";
import { attributeResources, taskResources } from "./attribute.js";
// A cycle with data.js (it writes the history), safe: only called, never read at load.
import { recordedCounts } from "./data.js";

const HISTORY_TIMEOUT = 20000;

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

// The history line for a run, from its timing (timing.sh's JSON, or null), its resources
// (.resources.json, or null) and the run read by data.js. Missing pieces are null.
// `closedMs` is the closed marker's time, or the delete time. Pure, for tests.
export function buildLine(run, timing, resources, closedMs, now = Date.now()) {
  const res = resources?.agents ?? {};
  // Terminals to agents and tasks by attribute.js, the stats view's rule for open runs too, so a
  // run's figures stay the same once it is in the history.
  const agents = attributeResources(timing?.agents ?? [], res, run.prefix ?? null).map((a) => ({
    name: a.label || a.name, role: a.role ?? null, task: a.task ?? null, kind: a.kind ?? null,
    total: a.total ?? null, categories: a.categories ?? {},
    cpu_s: a.cpu_s, peak_rss_mb: a.peak_rss_mb, avg_rss_mb: a.avg_rss_mb,
  }));
  const tasks = taskResources(timing?.tasks ?? [], agents);
  const programs = {};
  for (const a of Object.values(res)) {
    for (const [p, v] of Object.entries(a.programs ?? {})) {
      const x = (programs[p] ??= { cpu_s: 0, peak_rss_mb: 0 });
      x.cpu_s = r1(x.cpu_s + (v.cpu_s ?? 0));
      x.peak_rss_mb = Math.max(x.peak_rss_mb, v.peak_rss_mb ?? 0);
    }
  }
  for (const [p, v] of Object.entries(resources?.programs ?? {})) programs[p] ??= { cpu_s: v.cpu_s ?? null, peak_rss_mb: null };
  // run.tokens is re-read every 5 s; timing's copy of status.json may be minutes old.
  const t = timing?.tokens ?? null;
  const tokens = run.tokens && Number(run.tokens.total) > 0
    ? { total: run.tokens.total, input: run.tokens.input, output: run.tokens.output, cache_read: run.tokens.cacheRead, cache_write: run.tokens.cacheWrite }
    : t && Number(t.total) > 0
      ? { total: Number(t.total), input: Number(t.input) || 0, output: Number(t.output) || 0, cache_read: Number(t.cache_read) || 0, cache_write: Number(t.cache_write) || 0 }
      : null;
  return {
    v: 1,
    run: run.dir, folder: run.folder ?? null, branch: run.branch ?? null, type: run.type ?? null,
    topic: run.topic ?? null, machine: run.machine ?? null,
    started: iso(run.started) ?? timing?.start ?? null,
    ended: timing?.end ?? null,
    closed: iso(closedMs),
    status: run.statusLine ?? null,
    tasks_merged: recordedCounts(run).done, tasks_planned: recordedCounts(run).planned,
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
// does nothing. A run whose timing could not be read is tried again after RETRY ms, and
// written without timing on its FAILS-th failure, so a run whose logs are gone stops costing.
const done = new Set();
const pending = new Map();
const failedAt = new Map();
const fails = new Map();
// Timings, in ms; a test sets them.
export const tune = { retry: 5 * 60000, oldGap: 60000, deleteWait: 90000 };
const FAILS = 2;

// Reading timing is the costly part (every transcript of the run), so one at a time per
// machine; and closed runs already closed when Harbormaster started (all of them, on the
// first poll after an install) are taken one a minute per machine, not all at once.
const queue = new Map();
const lastOld = new Map();
const startedAt = Date.now();
const inQueue = (machine, fn) => {
  const prev = queue.get(machine ?? "") ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queue.set(machine ?? "", next.catch(() => {}));
  return next;
};

// Appends the run's line unless it is there: true once written or found, false when not
// (timing unreadable, a lazy one not due yet, or the write failed). `how`: "closed" for a
// run Harbormaster saw closed, "delete" just before it goes (writes even without timing).
export function writeHistory(run, how) {
  const closedMs = run.away?.how === "closed" ? run.away.at : null;
  const id = doneId(run);
  if (historyWritten(run)) return Promise.resolve(true);
  if (pending.has(id)) return pending.get(id);
  if (how === "closed") {
    if (Date.now() - (failedAt.get(id) ?? 0) < tune.retry) return Promise.resolve(false);
    if (closedMs && closedMs < startedAt) {
      const m = run.machine ?? "";
      if (Date.now() - (lastOld.get(m) ?? 0) < tune.oldGap) return Promise.resolve(false);
      lastOld.set(m, Date.now());
    }
  }
  const p = inQueue(run.machine, async () => {
    const parts = [frag("run", run.dir), run.started ? frag("started", iso(run.started)) : "", closedMs ? frag("closed", iso(closedMs)) : ""];
    const on = { on: run.machine, timeout: HISTORY_TIMEOUT };
    // A closing already recorded costs one grep, not a timing read.
    const seen = await exec("sh", ["-c", HISTORY, "sh", run.dir, "check", ...parts], on);
    if (seen.code === 5) return true;
    if (seen.code !== 0) return false;
    // The first read of a big run parses every transcript, so loadTiming allows it long.
    const timing = await loadTiming(run, { maxAge: 10 * 60000 });
    if (!timing && how === "closed" && (fails.get(id) ?? 0) + 1 < FAILS) {
      fails.set(id, (fails.get(id) ?? 0) + 1);
      return false;
    }
    const line = JSON.stringify(buildLine(run, timing, resourcesOf(run), closedMs ?? Date.now()));
    const out = await exec("sh", ["-c", HISTORY, "sh", run.dir, "append", ...parts, ...chunks(line)], on);
    return out.code === 0 || out.code === 5;
  }).catch(() => false).then((ok) => {
    pending.delete(id);
    if (ok) done.add(id); else failedAt.set(id, Date.now());
    return ok;
  });
  pending.set(id, p);
  return p;
}

// The key a run's line is remembered by once written: a closed run's includes when it closed,
// so a run closed again later gets a line of its own.
const doneId = (run) => (run.away?.how === "closed" ? `${run.key}|${run.away.at}` : run.key);
// Its line is in the history (written or found by this Harbormaster), so there is nothing to wait for.
export const historyWritten = (run) => done.has(doneId(run)) || (run.away?.how === "closed" && done.has(run.key));

// Before a run's directory goes: waits for the write, but only so long, then lets the
// delete go ahead (and does not wait again for the same run). `late`: a shared deleteWait()
// when several runs go at once, so one wait covers them all; else `cx` (a spawn's) times its own.
const gaveUp = new Set();
export async function writeHistoryBeforeDelete(run, { late = null, cx = null } = {}) {
  if (gaveUp.has(run.key)) return false;
  const write = writeHistory(run, "delete");
  if (historyWritten(run)) return write;
  const own = late ? null : deleteWait(cx);
  try {
    const out = await Promise.race([write, (late ?? own).done.then(() => "late")]);
    if (out !== "late") return out;
    gaveUp.add(run.key);
    return false;
  } finally { own?.cancel(); }
}

// The wait before a delete goes ahead without its history line: { done, cancel }. Herdr's
// runtime has no setTimeout or clearTimeout (calling them throws, which failed every delete),
// so it is the caller's cx.timer, cancelled once the write wins; without a cx, a sleep process,
// which can't be cancelled and ends by itself. `done` resolves, never rejects.
export function deleteWait(cx = null) {
  if (cx?.timer) {
    let task;
    const done = new Promise((resolve) => { task = cx.timer.after(tune.deleteWait, () => resolve(), { owner: null }); });
    return { done, cancel: () => { try { task?.cancel(); } catch { /* already ended */ } } };
  }
  const done = exec("sleep", [String(tune.deleteWait / 1000)], { timeout: tune.deleteWait + 10000 }).then(() => {}, () => {});
  return { done, cancel() {} };
}
