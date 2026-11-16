// The stats view's figures, in one shape for open and past runs: the history line's
// (.history.jsonl, see run-files.md). An open run's comes from timing.sh (timing.js),
// its .resources.json (resources.js) and status.json's tokens; a past run's is its last
// history line. Pure helpers first (tests drive them), then the loading.

import { exec, machines } from "herdr";
import { loadTiming, cachedTiming, pruneTiming } from "./timing.js";
import { attributeResources, taskResources } from "./attribute.js";

export { taskOfName } from "./attribute.js";

const num = (v) => Number(v) || 0;
const orNull = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);

// A category map with every value a number; a missing category reads as 0 wherever it is used.
export const cats = (m) => Object.fromEntries(Object.entries(obj(m)).map(([k, v]) => [k, num(v)]).filter(([, v]) => v > 0));

// Adds `b`'s categories into `a` (mutates and returns `a`).
export function addCats(a, b) {
  for (const [k, v] of Object.entries(obj(b))) a[k] = (a[k] ?? 0) + num(v);
  return a;
}

export const catTotal = (m) => Object.values(obj(m)).reduce((s, v) => s + num(v), 0);

function tokensOf(x) {
  if (!x || !(num(x.total) > 0)) return null;
  // status.json's (and history's) names, or data.js's camelCase.
  return {
    total: num(x.total), input: num(x.input), output: num(x.output),
    cache_read: num(x.cache_read ?? x.cacheRead), cache_write: num(x.cache_write ?? x.cacheWrite),
  };
}

// Fresh tokens (input + output + cache writes) and cache reads: the two parts of a token bar.
export const tokenParts = (tk) => (tk ? { fresh: tk.input + tk.output + tk.cache_write, cached: tk.cache_read } : null);

function resourcesOfLine(x) {
  if (!x || typeof x !== "object") return null;
  return {
    cpu_s: orNull(x.cpu_s), peak_rss_mb: orNull(x.peak_rss_mb), avg_rss_mb: orNull(x.avg_rss_mb), estimated: Boolean(x.estimated),
    programs: Object.fromEntries(Object.entries(obj(x.programs)).map(([k, v]) => [k, { cpu_s: num(v?.cpu_s), peak_rss_mb: orNull(v?.peak_rss_mb) }])),
  };
}

const agentOf = (a) => ({
  name: String(a?.name ?? "?"), label: a?.label ?? null, role: a?.role ?? null, task: a?.task ?? null, kind: a?.kind ?? null,
  total: num(a?.total), categories: cats(a?.categories),
  cpu_s: orNull(a?.cpu_s), peak_rss_mb: orNull(a?.peak_rss_mb), avg_rss_mb: orNull(a?.avg_rss_mb),
});

const taskOf = (k) => ({ id: String(k?.id ?? "?"), total: num(k?.total), categories: cats(k?.categories), cpu_s: orNull(k?.cpu_s), peak_rss_mb: orNull(k?.peak_rss_mb) });

// One history line → the shared shape, every field there (missing numbers 0 or null).
export function fromHistory(x, machine = null) {
  const started = x.started ?? null;
  return {
    key: `${machine ?? ""}:${x.run}:${started ?? ""}`, source: "history", live: false, machine,
    run: String(x.run), folder: x.folder ?? null, branch: x.branch ?? String(x.run).split("/").pop(),
    type: x.type ?? null, topic: x.topic ?? null, started, ended: x.ended ?? null, closed: x.closed ?? null,
    status: x.status ?? null, tasks_merged: orNull(x.tasks_merged), tasks_planned: orNull(x.tasks_planned),
    wall: num(x.wall), critical_path: cats(x.critical_path), categories: cats(x.categories),
    tasks: arr(x.tasks).map(taskOf), agents: arr(x.agents).map(agentOf),
    tokens: tokensOf(x.tokens), resources: resourcesOfLine(x.resources), timed: true,
  };
}

// .history.jsonl's text → its runs, the last line per run (directory + started) kept, lines
// that do not parse (a half-written last line, a cut first one) skipped.
export function parseHistory(text, machine = null) {
  const byKey = new Map();
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    let x;
    try { x = JSON.parse(line); } catch { continue; }
    if (!x || typeof x !== "object" || !x.run) continue;
    const s = fromHistory(x, machine);
    byKey.delete(s.key);
    byKey.set(s.key, s);
  }
  return [...byKey.values()];
}

// An open run (data.js) with its timing (timing.sh's JSON or null) and its .resources.json (or
// null) → the shared shape. Terminals go to agents and tasks by attribute.js, as in the history.
export function summaryOf(run, timing, res) {
  const all = attributeResources(arr(timing?.agents).map(agentOf), res?.agents, run.prefix ?? null).map(agentOf);
  const tasks = taskResources(arr(timing?.tasks), all).map(taskOf);
  return {
    key: run.key, source: "open", live: !run.away, machine: run.machine ?? null,
    run: run.dir, folder: run.folder || null, branch: run.branch, type: run.type ?? null, topic: run.topic ?? null,
    started: timing?.start ?? (run.started ? new Date(run.started).toISOString() : null), ended: timing?.end ?? null,
    closed: run.away?.how === "closed" && run.away.at ? new Date(run.away.at).toISOString() : null,
    status: run.statusLine ?? null, tasks_merged: run.merged ?? null, tasks_planned: run.planned ?? null,
    wall: num(timing?.wall), critical_path: cats(timing?.critical_path), categories: cats(timing?.categories),
    tasks, agents: all, tokens: tokensOf(timing?.tokens) ?? tokensOf(run.tokens), resources: resourcesOfLine(res), timed: Boolean(timing),
  };
}

// Open runs and past runs, one row each, newest first. A run in both is its history line once
// it is closed (the line is final); while open (never closed, or resumed since) the live figures.
export function mergeRuns(open, history) {
  const where = (x) => `${x.machine ?? ""}:${x.run}`;
  const byRun = new Map();
  for (const h of history) byRun.set(where(h), [...(byRun.get(where(h)) ?? []), h]);
  const sameStart = (h, o) => !h.started || !o.started || Date.parse(h.started) === Date.parse(o.started);
  const shown = open.filter((o) => !(o.closed && (byRun.get(where(o)) ?? []).some((h) => sameStart(h, o))));
  const live = new Map();
  for (const o of shown) live.set(where(o), [...(live.get(where(o)) ?? []), o]);
  const past = history.filter((h) => !(live.get(where(h)) ?? []).some((o) => sameStart(h, o)));
  const at = (s) => Date.parse(s.started ?? "") || 0;
  return [...shown, ...past].sort((a, b) => at(b) - at(a));
}

// Where the time goes across runs: critical_path summed, one row per group (folder, type or
// all), biggest first: [{ group, runs, wall, critical_path, total }].
export function acrossRuns(runs, by = "all") {
  const groups = new Map();
  for (const r of runs) {
    if (!catTotal(r.critical_path)) continue;
    const g = by === "folder" ? (r.folder?.split("/").pop() || "?") : by === "type" ? (r.type || "untyped") : "All runs";
    const x = groups.get(g) ?? { group: g, runs: 0, wall: 0, critical_path: {} };
    x.runs++; x.wall += r.wall; addCats(x.critical_path, r.critical_path);
    groups.set(g, x);
  }
  return [...groups.values()].map((x) => ({ ...x, total: catTotal(x.critical_path) })).sort((a, b) => b.total - a.total);
}

// The live CPU table: each orchestrator (and the captain) with its agents, then the agents in
// no crew, from the live snapshot; rows only for terminals the snapshot has.
// `crews` [{ title, root: address, name, members: [{address, name}] }]; `snapshot` resourceSnapshot().
// Terminals in no crew below LOOSE_MIN (idle shells, mostly) are not rows: the group's `hidden`
// counts them, { count, cpu, rssKb }.
export const LOOSE_MIN = { cpu: 1, rssKb: 100 * 1024 };
export function liveGroups(crews, snapshot, names = {}) {
  const terms = obj(snapshot?.terminals);
  const used = new Set();
  const row = (address, name) => {
    used.add(address);
    const u = terms[address];
    return u ? { address, name: name || address, term: names[address] ?? null, cpu: u.cpu, rssKb: u.rssKb, own: u.own, programs: u.programs ?? [] } : null;
  };
  const groups = crews.map((c) => {
    const rows = [row(c.root, c.name), ...c.members.map((m) => row(m.address, m.name))].filter(Boolean);
    return { title: c.title, rows, cpu: rows.reduce((s, r) => s + r.cpu, 0), rssKb: rows.reduce((s, r) => s + r.rssKb, 0) };
  }).filter((g) => g.rows.length);
  const loose = Object.keys(terms).filter((a) => !used.has(a)).map((a) => row(a, names[a])).filter(Boolean).sort((x, y) => y.cpu - x.cpu || y.rssKb - x.rssKb);
  if (loose.length) {
    const busy = loose.filter((r) => r.cpu >= LOOSE_MIN.cpu || r.rssKb >= LOOSE_MIN.rssKb);
    const quiet = loose.filter((r) => !busy.includes(r));
    groups.push({
      title: "Not in a run", rows: busy, cpu: loose.reduce((s, r) => s + r.cpu, 0), rssKb: loose.reduce((s, r) => s + r.rssKb, 0),
      hidden: quiet.length ? { count: quiet.length, cpu: quiet.reduce((s, r) => s + r.cpu, 0), rssKb: quiet.reduce((s, r) => s + r.rssKb, 0) } : null,
    });
  }
  return groups;
}

// ---- loading ----

// Each machine's history, re-read at most every HISTORY_AGE: it grows only when a run closes.
const HISTORY_AGE = 60000;
// A live run's timing is read again at most this often; closed or parked runs once.
export const LIVE_TIMING_AGE = 90000;
const FAILED_TIMING_AGE = 10 * 60000;
const HISTORY = 'f="${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}/.history.jsonl"; [ -r "$f" ] && tail -c 4000000 "$f"; exit 0';
let history = { at: 0, runs: [], pending: null };

export const cachedHistory = () => history.runs;

export function loadHistory() {
  if (history.pending) return history.pending;
  if (Date.now() - history.at < HISTORY_AGE) return Promise.resolve(history.runs);
  history.pending = (async () => {
    const names = machines().filter((m) => m.layout !== "unavailable").map((m) => m.name);
    if (!names.includes(null)) names.unshift(null);
    const runs = (await Promise.all(names.map((on) => exec("sh", ["-c", HISTORY], { on })
      .then((out) => parseHistory(out.stdout, on)).catch(() => [])))).flat();
    history = { at: Date.now(), runs, pending: null };
    return runs;
  })().catch(() => { history = { ...history, at: Date.now(), pending: null }; return history.runs; });
  return history.pending;
}

// The order runs' timing is read in: live runs already read (a quick re-read, so they stay at
// most LIVE_TIMING_AGE old), then runs never read (a first read of a big run parses every
// transcript, up to minutes), then the rest (put away and read: nothing to do).
export const timingOrder = (r, cached) => (!r.away && cached ? 0 : !cached ? 1 : 2);

// Reads the open runs' timing one run at a time, in timingOrder. Runs a history line already
// covers are skipped. Every caller's `onEach` hears each run that was read (to redraw), also
// one that called while a pass was under way; resolves when the pass is done.
let timingBusy = null;
const timingListeners = new Set();
export function refreshTimings(runs, onEach = () => {}) {
  timingListeners.add(onEach);
  if (timingBusy) return timingBusy;
  pruneTiming(new Set(runs.map((r) => r.key)));
  const covered = new Set(history.runs.map((h) => `${h.machine ?? ""}:${h.run}`));
  const todo = runs.filter((r) => !(r.away?.how === "closed" && covered.has(`${r.machine ?? ""}:${r.dir}`)))
    .sort((a, b) => timingOrder(a, cachedTiming(a)) - timingOrder(b, cachedTiming(b)));
  timingBusy = (async () => {
    for (const r of todo) {
      const had = cachedTiming(r);
      // A put-away run does not change; one that could not be read is tried again now and then.
      await loadTiming(r, { maxAge: !had ? FAILED_TIMING_AGE : r.away ? Infinity : LIVE_TIMING_AGE });
      if (cachedTiming(r) !== had) for (const f of timingListeners) { try { f(r); } catch { /* its view is gone */ } }
    }
  })().catch(() => {}).finally(() => { timingBusy = null; timingListeners.clear(); });
  return timingBusy;
}

// Does a run's summary match the stats view's `run` prop (a run directory, maybe with ~)?
export function isRunProp(s, dir) {
  if (!dir) return false;
  const d = String(dir).replace(/\/+$/, "");
  return s.run === d || (d.startsWith("~/") && s.run.endsWith(d.slice(1)));
}
