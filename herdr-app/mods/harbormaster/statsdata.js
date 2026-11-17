// The stats view's figures, in one shape for open and past runs: the history line's
// (.history.jsonl, see run-files.md). An open run's comes from timing.sh (timing.js),
// its .resources.json (resources.js) and status.json's tokens; a past run's is its last
// history line. Pure helpers first (tests drive them), then the loading.

import { exec, machines } from "herdr";
import { loadTiming, cachedTiming, pruneTiming } from "./timing.js";
import { attributeResources, taskResources } from "./attribute.js";
import { recordedCounts } from "./data.js";

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
    status: run.statusLine ?? null, tasks_merged: recordedCounts(run).done, tasks_planned: recordedCounts(run).planned,
    wall: num(timing?.wall), critical_path: cats(timing?.critical_path), categories: cats(timing?.categories),
    tasks, agents: all, tokens: tokensOf(run.tokens) ?? tokensOf(timing?.tokens), resources: resourcesOfLine(res), timed: Boolean(timing),
  };
}

// Open runs and past runs, one row each: live open runs first, then the rest, each newest
// first. (Sorting everything by `started` lost a run that was parked and resumed: its start is
// days old, so it fell under "+ N older runs" while open.) A run in both is its history line once
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
  const isOpen = (s) => s.source === "open" && s.live;
  return [...shown, ...past].sort((a, b) => isOpen(b) - isOpen(a) || at(b) - at(a));
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
export function liveGroups(crews, snapshot, names = {}, steady = null) {
  const terms = obj(snapshot?.terminals);
  const used = new Set();
  const row = (address, name) => {
    used.add(address);
    const u = terms[address];
    return u ? { address, name: name || address, term: names[address] ?? null, cpu: u.cpu, rssKb: u.rssKb, own: u.own, programs: u.programs ?? [] } : null;
  };
  const groups = crews.map((c) => {
    const rows = [row(c.root, c.name), ...c.members.map((m) => row(m.address, m.name))].filter(Boolean);
    return { title: c.title, root: c.root, rows, cpu: rows.reduce((s, r) => s + r.cpu, 0), rssKb: rows.reduce((s, r) => s + r.rssKb, 0) };
  }).filter((g) => g.rows.length);
  const loose = Object.keys(terms).filter((a) => !used.has(a)).map((a) => row(a, names[a])).filter(Boolean).sort((x, y) => y.cpu - x.cpu || y.rssKb - x.rssKb);
  if (loose.length) {
    // With a `steady`, a terminal moves between a row and the folded line only after two samples.
    const over = (r) => r.cpu >= LOOSE_MIN.cpu || r.rssKb >= LOOSE_MIN.rssKb;
    const busy = loose.filter((r) => (steady ? steady.hold(`loose:${r.address}`, over(r)) : over(r)));
    const quiet = loose.filter((r) => !busy.includes(r));
    groups.push({
      title: "Not in a run", rows: busy, cpu: loose.reduce((s, r) => s + r.cpu, 0), rssKb: loose.reduce((s, r) => s + r.rssKb, 0),
      hidden: quiet.length ? { count: quiet.length, cpu: quiet.reduce((s, r) => s + r.cpu, 0), rssKb: quiet.reduce((s, r) => s + r.rssKb, 0) } : null,
    });
  }
  return groups;
}

// ---- the view's shape (pure) ----

// Under this CPU % a run, or a program outside the agents, is quiet: folded into one line.
export const QUIET_CPU = 1;
const byCpu = (a, b) => b.cpu - a.cpu || b.rssKb - a.rssKb;

// ---- steadiness: the live table is read over minutes, so it must not jump with every sample ----

// Smoothing, row order and the busy/quiet split that change only on a clear, lasting difference.
// One per module: every stats view reads the same steady figures; the sample time `at` (any increasing number)
// is set once per sample with begin(), and every call after it in the same sample gives the same
// answer, so a redraw between samples changes nothing.
export const STEADY = { tauMs: 25000, rel: 0.25, abs: 2, streak: 2, keepMs: 5 * 60000 };

// Memory in kB to the unit memText shows: under 1 GiB two significant figures of MB (645M → 650M),
// above it as is (memText gives one decimal of G).
export const sig2 = (n) => {
  const mb = n / 1024;
  return mb >= 1024 || mb < 1 ? n : Number(mb.toPrecision(2)) * 1024;
};

const machineInfo = (snap, name) => snap?.machines?.[name] ?? null;

export function createSteady(cfg = {}) {
  const c = { ...STEADY, ...cfg };
  const ema = new Map(), orders = new Map(), flags = new Map(), asked = new Map();
  let at = 0;
  // Overtaking needs both a relative and an absolute lead, so two near-equal rows keep their places.
  const beats = (a, b) => a.cpu - b.cpu >= c.abs && a.cpu >= b.cpu * (1 + c.rel);
  const api = {
    begin(now) {
      if (now === at) return;
      at = now;
      for (const m of [ema, flags]) for (const [k, v] of m) if (now - v.seen > c.keepMs) m.delete(k);
      for (const [k, v] of asked) if (now - v > c.keepMs) { asked.delete(k); orders.delete(k); }
    },
    // An exponential moving average per key (tau ~25 s), then rounded: CPU to a whole %, memory to
    // two figures. {cpu, rssKb} in, the same out.
    // `when` is the sample time of the machine the figure came from (default: the view's); each
    // machine polls on its own clock, so one machine's poll must not count as a sample of another's.
    smooth(key, cpu, rssKb = 0, when = at) {
      let e = ema.get(key);
      if (!e) e = { at: when, seen: at, cpu, rssKb };
      else if (e.at !== when) {
        const a = 1 - Math.exp(-Math.max(0, when - e.at) / c.tauMs);
        e = { at: when, seen: at, cpu: e.cpu + a * (cpu - e.cpu), rssKb: e.rssKb + a * (rssKb - e.rssKb) };
      }
      e.seen = at;
      ema.set(key, e);
      return { cpu: Math.round(e.cpu), rssKb: sig2(e.rssKb) };
    },
    // Whether `key` is busy (cpu at or over QUIET_CPU): it changes sides only after `streak`
    // samples in a row on the other side.
    busy(key, cpu) { return api.hold(key, cpu >= QUIET_CPU); },
    // A yes/no that changes only after it has said the other thing for `streak` samples in a row.
    hold(key, want) {
      let f = flags.get(key);
      if (!f) f = { at, seen: at, on: want, run: 0 };
      else if (f.at !== at) {
        f.at = at;
        f.run = want === f.on ? 0 : f.run + 1;
        if (f.run >= c.streak) { f.on = want; f.run = 0; }
      }
      f.seen = at;
      flags.set(key, f);
      return f.on;
    },
    // `items` in the order of `id` last time; a new one is placed by CPU; a row moves above its
    // neighbour only when it beats it clearly (see beats).
    order(id, items, keyOf = (x) => x.address ?? x.name) {
      const pos = new Map((orders.get(id) ?? []).map((k, i) => [k, i]));
      const out = items.filter((x) => pos.has(keyOf(x))).sort((a, b) => pos.get(keyOf(a)) - pos.get(keyOf(b)));
      for (const x of items.filter((y) => !pos.has(keyOf(y))).sort(byCpu)) {
        const i = out.findIndex((y) => beats(x, y));
        out.splice(i < 0 ? out.length : i, 0, x);
      }
      for (let moved = true, n = 0; moved && n <= out.length * out.length; n++) {
        moved = false;
        for (let i = 1; i < out.length; i++) if (beats(out[i], out[i - 1])) { [out[i - 1], out[i]] = [out[i], out[i - 1]]; moved = true; }
      }
      orders.set(id, out.map(keyOf));
      asked.set(id, at);
      return out;
    },
    // The snapshot's terminals (resources.js) with CPU and memory smoothed, per terminal, own
    // process and program, so the table, its details and "Hottest" read the same steady figures.
    // Each is smoothed on its machine's sample time; a machine with no rating yet (CPU 0 would seed
    // the average) passes through as it is.
    snapshot(snap) {
      const terminals = {};
      for (const [a, u] of Object.entries(snap?.terminals ?? {})) {
        const m = machineInfo(snap, a.includes("/") ? a.slice(0, a.indexOf("/")) : "");
        if (m && !m.rated) { terminals[a] = u; continue; }
        const when = m?.at ?? snap?.at ?? at;
        terminals[a] = {
          ...u, ...api.smooth(a, u.cpu, u.rssKb, when),
          own: u.own ? { ...u.own, ...api.smooth(`${a}\town`, u.own.cpu, u.own.rssKb, when) } : u.own,
          programs: (u.programs ?? []).map((p) => ({ ...p, ...api.smooth(`${a}\t${p.name}`, p.cpu, p.rssKb, when) })),
        };
      }
      return { ...snap, terminals };
    },
    // Processes outside the agents ({machine, pid, cpu, rssKb, ...}), smoothed per process.
    others(list, snap = null) {
      return list.map((p) => {
        const m = machineInfo(snap, p.machine ?? "");
        return m && !m.rated ? p : { ...p, ...api.smooth(`${p.machine ?? ""}:${p.pid}`, p.cpu, p.rssKb, m?.at ?? at) };
      });
    },
  };
  return api;
}

// Splits items ({cpu, rssKb, ...}) into the busy ones, hottest first, and the quiet ones
// (under QUIET_CPU) as one line: { busy, quiet: { count, names, cpu, rssKb, items } or null }.
// With a `steady` (createSteady) and the list's `id` the order and the split hold still.
export function foldQuiet(items, nameOf = (x) => x.name, steady = null, id = "", keyOf = (x) => x.address ?? x.name) {
  const all = steady ? steady.order(`${id}:all`, items, keyOf) : [...items].sort(byCpu);
  const isBusy = steady ? (x) => steady.busy(`${id}:${keyOf(x)}`, x.cpu) : (x) => x.cpu >= QUIET_CPU;
  const busy = all.filter(isBusy), rest = all.filter((x) => !busy.includes(x));
  return {
    busy,
    quiet: rest.length ? { count: rest.length, names: rest.map(nameOf), cpu: rest.reduce((n, x) => n + x.cpu, 0), rssKb: rest.reduce((n, x) => n + x.rssKb, 0), items: rest } : null,
  };
}

// The live table from liveGroups(): groups hottest first, each one's rows hottest first. A run
// whose only row is its orchestrator is the group line alone (`solo`, that row): the run row
// says it. Runs (groups with a root) under QUIET_CPU fold into `quiet`; "Not in a run" is no
// run, so it stays a line of its own.
export function liveTable(groups, steady = null) {
  const gkey = (g) => g.root ?? g.title;
  const shaped = groups.map((g) => {
    const rows = steady ? steady.order(`rows:${gkey(g)}`, g.rows) : [...g.rows].sort(byCpu);
    const solo = rows.length === 1 && g.root && rows[0].address === g.root ? rows[0] : null;
    return { ...g, rows: solo ? [] : rows, solo };
  });
  const { busy, quiet } = foldQuiet(shaped.filter((g) => g.root), (g) => g.title, steady, "groups", gkey);
  const shown = [...busy, ...shaped.filter((g) => !g.root)];
  return { groups: steady ? steady.order("groups", shown, gkey) : shown.sort(byCpu), quiet };
}

// Processes outside the agents, one row per program name and machine: "firefox ×3" sums its
// processes' CPU and memory. Then folded like the runs.
export function groupProcesses(other, steady = null) {
  const by = new Map();
  for (const p of other) {
    const key = `${p.machine ?? ""}\t${p.name}`;
    const g = by.get(key) ?? { name: p.name, machine: p.machine ?? null, program: p.program, count: 0, cpu: 0, rssKb: 0, pids: [] };
    g.count++; g.cpu += p.cpu; g.rssKb += p.rssKb; g.pids.push(p.pid);
    by.set(key, g);
  }
  return foldQuiet([...by.values()], (g) => (g.count > 1 ? `${g.name} ×${g.count}` : g.name), steady, "procs", (g) => `${g.machine ?? ""}\t${g.name}`);
}

// The hottest agent right now, from liveGroups(): { name, cpu, rssKb, mostly } or null when
// nothing reaches QUIET_CPU. `mostly` names what its CPU goes to: one program when it has at
// least half, else the two biggest ("lint and browser"), the agent's own process "the agent itself".
// A run's root row is named after its role ("orchestrator"), so it is named with its run's
// title: "Sunday match orchestrator".
export function hottest(groups, steady = null) {
  const rows = groups.flatMap((g) => g.rows.map((r) => ({ r, g })));
  const pick = steady ? steady.order("hottest", rows.map((x) => ({ ...x, cpu: x.r.cpu, rssKb: x.r.rssKb })), (x) => x.r.address)[0]
    : rows.sort((a, b) => byCpu(a.r, b.r))[0];
  const top = pick?.r;
  if (!top || !(steady ? steady.busy("hottest", top.cpu) : top.cpu >= QUIET_CPU)) return null;
  const g = pick.g;
  const name = g.root && top.address === g.root && g.title && g.title.toLowerCase() !== top.name.toLowerCase() ? `${g.title} ${top.name}` : top.name;
  const parts = [...(top.own ? [{ name: "the agent itself", cpu: top.own.cpu }] : []), ...top.programs.map((p) => ({ name: p.name, cpu: p.cpu }))]
    .filter((p) => p.cpu >= QUIET_CPU).sort((a, b) => b.cpu - a.cpu);
  const mostly = !parts.length ? null : parts[0].cpu >= top.cpu / 2 || parts.length === 1 ? parts[0].name : `${parts[0].name} and ${parts[1].name}`;
  return { name, cpu: top.cpu, rssKb: top.rssKb, mostly };
}

// "Hottest: impl-xweek-ui 44%, mostly browser".
export const hottestText = (h) => (h ? `Hottest: ${h.name} ${Math.round(h.cpu)}%${h.mostly ? `, mostly ${h.mostly}` : ""}` : "Nothing busy right now");

// Where the time went, idle apart: { working, idle, parts (biggest first, with pct of the
// working time), shown (the `top` biggest of 1% or more), hidden (the rest) }.
export function timeSplit(m, top = 4) {
  const c = cats(m);
  const parts = Object.entries(c).filter(([k]) => k !== "idle").sort((a, b) => b[1] - a[1]);
  const working = parts.reduce((n, [, v]) => n + v, 0);
  const all = parts.map(([key, secs]) => ({ key, secs, pct: working > 0 ? (100 * secs) / working : 0 }));
  const shown = all.filter((p) => p.pct >= 1).slice(0, top);
  return { working, idle: c.idle ?? 0, parts: all, shown, hidden: all.filter((p) => !shown.includes(p)) };
}

// The runs list (from mergeRuns, live open runs first): every open run, then the newest `n`
// others, unless all are asked for; `older` is how many past runs are folded.
export const RECENT = 5;
export function recentRuns(runs, all = false, n = RECENT) {
  const open = runs.filter((s) => s.source === "open" && s.live).length;
  const rows = all ? runs : runs.slice(0, open + n);
  return { rows, older: runs.length - rows.length };
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
