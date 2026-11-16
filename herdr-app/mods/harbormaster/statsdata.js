// The stats view's figures, in one shape for open and past runs: the history line's
// (.history.jsonl, see run-files.md). An open run's comes from timing.sh (timing.js),
// its .resources.json (resources.js) and status.json's tokens; a past run's is its last
// history line. Pure helpers first (tests drive them), then the loading.

import { exec, machines } from "herdr";
import { loadTiming, cachedTiming } from "./timing.js";

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

// The task in a terminal's name, "impl-rss-t3" → "t3" for prefix "rss"; null when it names none.
export function taskOfName(name, prefix) {
  if (!prefix) return null;
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[a-z]+-${esc}-(.+)$`, "i").exec(name ?? "")?.[1] ?? null;
}

// An open run (data.js) with its timing (timing.sh's JSON or null) and its .resources.json (or
// null) → the shared shape. Each resources terminal goes to the agent it belongs to: the timing
// agent with its name as label, else the one its parent chain reaches (the commands an agent
// started with hc run), else the orchestrator for the run's root; a terminal that reaches none
// is an agent of its own, with CPU and memory and no time. An agent's CPU adds its terminals';
// its peak and average memory are its largest terminal's (they were not sampled together).
export function summaryOf(run, timing, res) {
  const prefix = run.prefix ?? null;
  const agents = arr(timing?.agents).map(agentOf);
  const byLabel = new Map(agents.filter((a) => a.label).map((a) => [a.label, a]));
  const orch = agents.find((a) => a.role === "orchestrator") ?? null;
  const terms = obj(res?.agents);
  const ownerOf = (name, depth = 0) => {
    if (byLabel.has(name)) return byLabel.get(name);
    const t = terms[name];
    if (!t || depth > 20) return null;
    if (!t.parent) return orch;
    // A terminal right under the orchestrator that timing does not know is an agent of its own.
    if (!terms[t.parent] || !terms[t.parent].parent) return null;
    return ownerOf(t.parent, depth + 1);
  };
  const extra = new Map();
  for (const [name, t] of Object.entries(terms)) {
    let a = ownerOf(name);
    if (!a) {
      // Its own row, named after the top of its chain below the orchestrator.
      let top = name;
      for (let d = 0; terms[top]?.parent && terms[terms[top].parent]?.parent && d < 20; d++) top = terms[top].parent;
      a = extra.get(top);
      if (!a) {
        a = agentOf({ name: top, label: top, role: /^([a-z]+)-/i.exec(top)?.[1]?.toLowerCase() ?? "agent", task: taskOfName(top, prefix) });
        extra.set(top, a);
      }
    }
    a.cpu_s = Math.round(((a.cpu_s ?? 0) + num(t.cpu_s)) * 10) / 10;
    a.peak_rss_mb = Math.max(a.peak_rss_mb ?? 0, num(t.peak_rss_mb));
    a.avg_rss_mb = Math.max(a.avg_rss_mb ?? 0, num(t.avg_rss_mb));
  }
  const all = [...agents, ...extra.values()];
  const tasks = arr(timing?.tasks).map(taskOf);
  for (const a of all) {
    if (!a.task) continue;
    let k = tasks.find((x) => x.id === a.task);
    if (!k) { k = taskOf({ id: a.task }); tasks.push(k); }
    if (a.cpu_s != null) k.cpu_s = Math.round(((k.cpu_s ?? 0) + a.cpu_s) * 10) / 10;
    if (a.peak_rss_mb != null) k.peak_rss_mb = Math.max(k.peak_rss_mb ?? 0, a.peak_rss_mb);
  }
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
  const same = (h, o) => h.run === o.run && (h.machine ?? null) === (o.machine ?? null)
    && (!h.started || !o.started || Date.parse(h.started) === Date.parse(o.started));
  const shown = open.filter((o) => !(o.closed && history.some((h) => same(h, o))));
  const past = history.filter((h) => !shown.some((o) => same(h, o)));
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
// `crews` [{ title, root: address, members: [{address, name}] }]; `snapshot` resourceSnapshot().
export function liveGroups(crews, snapshot, names = {}) {
  const terms = obj(snapshot?.terminals);
  const used = new Set();
  const row = (address, name) => {
    used.add(address);
    const u = terms[address];
    return u ? { address, name: name || address, cpu: u.cpu, rssKb: u.rssKb, own: u.own, programs: u.programs ?? [] } : null;
  };
  const groups = crews.map((c) => {
    const rows = [row(c.root, c.name), ...c.members.map((m) => row(m.address, m.name))].filter(Boolean);
    return { title: c.title, rows, cpu: rows.reduce((s, r) => s + r.cpu, 0), rssKb: rows.reduce((s, r) => s + r.rssKb, 0) };
  }).filter((g) => g.rows.length);
  const loose = Object.keys(terms).filter((a) => !used.has(a)).map((a) => row(a, names[a])).filter(Boolean).sort((x, y) => y.cpu - x.cpu || y.rssKb - x.rssKb);
  if (loose.length) groups.push({ title: "Not in a run", rows: loose, cpu: loose.reduce((s, r) => s + r.cpu, 0), rssKb: loose.reduce((s, r) => s + r.rssKb, 0) });
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

// Reads the open runs' timing one run at a time (a first read of a big run parses every
// transcript), those never read first. Runs a history line already covers are skipped.
// Resolves when done; `onEach` after each run that was read, to redraw.
let timingBusy = null;
export function refreshTimings(runs, onEach = () => {}) {
  if (timingBusy) return timingBusy;
  const covered = new Set(history.runs.map((h) => `${h.machine ?? ""}:${h.run}`));
  const todo = runs.filter((r) => !(r.away?.how === "closed" && covered.has(`${r.machine ?? ""}:${r.dir}`)))
    .sort((a, b) => (cachedTiming(a) ? 1 : 0) - (cachedTiming(b) ? 1 : 0));
  timingBusy = (async () => {
    for (const r of todo) {
      const had = cachedTiming(r);
      // A put-away run does not change; one that could not be read is tried again now and then.
      await loadTiming(r, { maxAge: !had ? FAILED_TIMING_AGE : r.away ? Infinity : LIVE_TIMING_AGE });
      if (cachedTiming(r) !== had) onEach(r);
    }
  })().catch(() => {}).finally(() => { timingBusy = null; });
  return timingBusy;
}
