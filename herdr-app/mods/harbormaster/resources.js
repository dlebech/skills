// CPU and memory of each agent and run, from one process snapshot per machine taken in
// data.js's 5 s poll (SAMPLER below runs at the end of its sh script), so nothing new keeps
// running. Each herdr-core terminal's process tree is walked from its own process (a child
// of `herdr-core hold`, found by the HC_TERMINAL_ID in its environment): the agent's own
// process apart from the commands it started, named by program (PROGRAMS).
//
// Linux: CPU totals from /proc/<pid>/stat (utime+stime, plus cutime+cstime so exited
// children count), CPU % from the difference between two polls, memory from RSS.
// macOS: one `ps` sample; CPU totals are each live process's own time, so commands that
// exited between polls are missed (estimated). Other systems: nothing, and no errors.
//
// Per run, the totals are kept in <run dir>/.resources.json (run-files.md), written
// atomically and only by one poll at a time, so they survive the app and t4/t8 can read them.
// The live snapshot is module state: liveUsage(), treeUsage(), otherProcesses().

import { exec } from "herdr";
import { orchestratorsOf, workersOf } from "./live.js";

// When a row gets a badge: above either limit. Calm otherwise.
export const HOT = { cpu: 50, rssKb: 2 * 1024 * 1024 };
// The top processes outside every agent's tree that the snapshot keeps.
const OTHER_TOP = 6;
// A process outside every terminal is printed only when it has used this much CPU or memory,
// so the poll's output stays small; a busy one crosses the CPU line within seconds.
const OTHER_MIN = { cpuSeconds: 2, rssMb: 100 };
// The longest gap between two samples that still counts as covered (the app may be closed).
const MAX_GAP_S = 15;

// Programs by name, first match wins, tested against "<program> <arguments>". Anything else
// is named by its program's file name (node, php, python3, ...). Editable on purpose.
export const PROGRAMS = [
  ["test runner", /\b(vitest|jest|mocha|pytest|py\.test|phpunit|pest|rspec|bats|playwright test|cargo test|go test|node --test|runs-live\.sh|npm (run )?test|pnpm (run )?test|yarn test)\b/],
  // Before browser: firefox-devtools-mcp is a tool server, not the browser it may start.
  ["mcp server", /(-mcp\b|\bmcp-server|\bmcp\b)/i],
  ["browser", /(chrom|firefox|MainThread|headless_shell|WebKit|Web Content|Isolated Web|msedge|safari)/i],
  ["lint", /\b(eslint|biome|phpstan|psalm|ruff|mypy|pyright|tsc|shellcheck|clippy|prettier|stylelint)\b/],
  ["install", /\b(npm (ci|install|i)|pnpm (install|i)|yarn install|composer (install|update)|pip3? install|bundle install|uv sync)\b/],
  ["build", /\b(webpack|vite|esbuild|rollup|turbo|make|cmake|ninja|gcc|g\+\+|cc1\w*|clang\+*|rustc|cargo|go build|gradle|mvn|swc|next build)\b/],
  ["docker", /^(docker|podman|containerd)/],
  ["git", /^git\b/],
  ["shell", /^(ba|z|da|fi|k)?sh\b/],
];

export function programOf(name, args = "") {
  const text = `${name} ${args}`.trim();
  return PROGRAMS.find(([, re]) => re.test(text))?.[0] ?? (name || "?");
}

// ---- the sampler: sh, run on each machine, its output after a \x1d ----
// Prints, one per line:
//   S <os> <seconds: uptime on Linux, epoch on macOS>
//   P <pid> <terminal id or -> <is terminal root 0|1> <own cpu ms> <exited children cpu ms> <rss kB> <start> <cpu % or -> <name>\t<args>
// Only processes in a terminal's tree, and others above OTHER_MIN.

// The tree walk shared by both systems: term[pid] = id for terminal roots; tid(p) its terminal.
const AWK_TREE = `
function tid(p, d) {
  if (p in memo) return memo[p]
  if (p in term) return memo[p] = term[p]
  if (!(p in pp) || pp[p] <= 1 || d > 60) return memo[p] = "-"
  return memo[p] = tid(pp[p], d + 1)
}
function out(p, t, args) {
  t = tid(p, 0)
  if (t == "-" && rss[p] == 0) return
  if (t == "-" && own[p] + kid[p] < ${OTHER_MIN.cpuSeconds * 1000} && rss[p] < ${OTHER_MIN.rssMb * 1024}) return
  printf "P %s %s %d %d %d %d %s %s %s\\t%s\\n", p, t, (p in term), own[p], kid[p], rss[p], st[p], pc[p], nm[p], args
}`;

// Linux: one awk reads every /proc/<pid>/stat (getline, so a process that exits midway is
// skipped, not fatal), the environment of herdr-core's children, and the command line of
// the processes it prints. No fork per process. Works with gawk, mawk and busybox awk.
export const LINUX_AWK = `
BEGIN {
  if (!hz) hz = 100; if (!pg) pg = 4096
  # busybox awk ends strings at a NUL (so a command line is its program alone) and /\\0/
  # matches anywhere there; gawk and mawk keep NULs, which become spaces.
  z = "ab"; nul = !gsub(/\\0/, "", z)
  if (!proc) proc = "/proc"
  getline up < (proc "/uptime"); close(proc "/uptime"); split(up, u, " ")
  print "S linux " u[1]
  for (i = 1; i < ARGC; i++) {
    f = ARGV[i]; line = ""
    r = (getline line < f); close(f)
    if (r <= 0 || !match(line, /.*\\)/)) continue
    p = f; sub(/\\/stat$/, "", p); sub(/.*\\//, "", p)
    o = index(line, "(")
    cm[p] = substr(line, o + 1, RLENGTH - o - 1)
    n = split(substr(line, RLENGTH + 2), a, " ")
    pp[p] = a[2]; own[p] = int((a[12] + a[13]) * 1000 / hz); kid[p] = int((a[14] + a[15]) * 1000 / hz)
    st[p] = a[20]; rss[p] = int(a[22] * pg / 1024); pc[p] = "-"
  }
  ARGC = 1
  for (p in pp) if (cm[pp[p]] == "herdr-core") {
    # A variable may hold a newline, so read on to the end of the environment.
    f = proc "/" p "/environ"
    while ((getline env < f) > 0) if (match(env, /HC_TERMINAL_ID=[A-Za-z0-9_.-]+/)) { term[p] = substr(env, RSTART + 15, RLENGTH - 15); break }
    close(f)
  }
  for (p in pp) {
    f = proc "/" p "/cmdline"; c = ""
    if (tid(p, 0) != "-" || own[p] + kid[p] >= ${OTHER_MIN.cpuSeconds * 1000} || rss[p] >= ${OTHER_MIN.rssMb * 1024}) { getline c < f; close(f) }
    gsub(/[\\001-\\037]/, " ", c); if (nul) gsub(/\\0/, " ", c)
    split(c, w, " "); nm[p] = w[1]; sub(/.*\\//, "", nm[p]); if (nm[p] == "") nm[p] = cm[p]; gsub(/[ \\t]/, "_", nm[p])
    out(p, 0, substr(c, length(w[1]) + 2, 160))
  }
}
${AWK_TREE}`;

// macOS: one ps for every process, then one more for the environment of herdr-core's
// children. Lines up to "ENV" are the first, the rest the second. `time` is the process's own
// CPU time, [[dd-]hh:]mm:ss.cc; exited children are not known.
export const MAC_AWK = `
function ms(s, n, x, i, t) { gsub(/-/, ":", s); n = split(s, x, ":"); t = 0; for (i = 1; i <= n; i++) t = t * (i == n - 2 && n == 4 ? 24 : 60) + x[i]; return int(t * 1000) }
$0 == "ENV" { env = 1; next }
env { if (match($0, /HC_TERMINAL_ID=[A-Za-z0-9_.-]+/)) term[$1] = substr($0, RSTART + 15, RLENGTH - 15); next }
{
  p = $1; pp[p] = $2; rss[p] = $3; own[p] = ms($4); kid[p] = 0; pc[p] = $5; st[p] = 0
  c = $0; sub(/^ *[0-9]+ +[0-9]+ +[0-9]+ +[0-9:.-]+ +[0-9.]+ +/, "", c)
  nm[p] = c; sub(/.*\\//, "", nm[p]); gsub(/[ \\t]/, "_", nm[p])
}
END { print "S darwin " now; for (p in pp) out(p, 0, "") }
${AWK_TREE}`;

export const SAMPLER = [
  "printf '\\035'",
  "if [ -r /proc/self/stat ]; then",
  `  LC_ALL=C awk -v hz="$(getconf CLK_TCK 2>/dev/null)" -v pg="$(getconf PAGESIZE 2>/dev/null)" '${LINUX_AWK.replace(/'/g, "'\\''")}' /proc/[0-9]*/stat 2>/dev/null`,
  'elif [ "$(uname)" = Darwin ]; then',
  "  t=$(ps -axww -o pid=,ppid=,rss=,time=,%cpu=,comm= 2>/dev/null)",
  "  k=$(printf '%s\\n' \"$t\" | awk '$NF ~ /(^|\\/)herdr-core$/ {h[$1]=1} {pp[$1]=$2} END {for (p in pp) if (pp[p] in h) printf \"%s,\", p}')",
  `  { printf '%s\\nENV\\n' "$t"; [ -n "$k" ] && ps -Eww -o pid=,command= -p "\${k%,}" 2>/dev/null; } | LC_ALL=C awk -v now="$(date +%s)" '${MAC_AWK.replace(/'/g, "'\\''")}'`,
  "fi",
].join("\n");

// ---- reading a sample ----

// The sampler's output → { os, at (s), procs: [{pid, tid, root, ownMs, kidMs, rssKb, start, pcpu, name, args}] }, or null.
export function parseSample(text) {
  let os = null, at = null;
  const procs = [];
  for (const line of (text ?? "").split("\n")) {
    if (line.startsWith("S ")) { const [, o, s] = line.split(" "); os = o; at = Number(s); continue; }
    if (!line.startsWith("P ")) continue;
    const tab = line.indexOf("\t");
    const head = (tab < 0 ? line : line.slice(0, tab)).split(" ");
    if (head.length < 10) continue;
    const [, pid, tid, root, own, kid, rss, start, pcpu, name] = head;
    procs.push({
      pid, tid: tid === "-" ? null : tid, root: root === "1", ownMs: Number(own) || 0, kidMs: Number(kid) || 0,
      rssKb: Number(rss) || 0, start, pcpu: pcpu === "-" ? null : Number(pcpu) || 0, name, args: tab < 0 ? "" : line.slice(tab + 1).trim(),
    });
  }
  return os ? { os, at, procs } : null;
}

// ---- the live snapshot ----

// machine ("" for this one) → { os, at, cpu: Map "<pid>:<start>" → total ms } from the poll before.
const previous = new Map();
// address → usage (see usageOf); machine → { os, other: [...] }.
let live = { at: 0, terminals: {}, machines: {} };
let version = 0;

const addr = (machine, tid) => (machine ? `${machine}/${tid}` : tid);

// Builds each terminal's usage from one machine's sample, with CPU % from the poll before:
// { address, os, cpu (% of one core), rssKb, totalMs (tree CPU so far), ownMs, own: {cpu, rssKb},
//   programs: [{name, cpu, rssKb, count}], pids: [{key, program, ms}] }; and the machine's top others.
export function ingest(machine, text) {
  const m = machine ?? "";
  const s = parseSample(text);
  if (!s) { previous.delete(m); delete live.machines[m]; return null; }
  const before = previous.get(m);
  const dt = before && before.os === s.os ? s.at - before.at : 0;
  const cpuNow = new Map();
  const terms = {}, other = [];
  for (const p of s.procs) {
    const key = `${p.pid}:${p.start}`;
    const total = p.ownMs + p.kidMs;
    cpuNow.set(key, total);
    // macOS gives ps's own %cpu; Linux the share of the time between the two polls.
    const was = before?.cpu.get(key);
    const cpu = p.pcpu ?? (dt > 0 && was !== undefined ? Math.max(0, (total - was) / (dt * 10)) : 0);
    if (!p.tid) {
      if (p.rssKb > 0) other.push({ machine: m || null, pid: p.pid, name: p.name, program: programOf(p.name, p.args), cpu, rssKb: p.rssKb });
      continue;
    }
    const a = addr(machine, p.tid);
    const u = (terms[a] ??= { address: a, os: s.os, cpu: 0, rssKb: 0, totalMs: 0, ownMs: 0, own: { cpu: 0, rssKb: 0 }, programs: [], pids: [] });
    u.cpu += cpu; u.rssKb += p.rssKb; u.totalMs += total;
    if (p.root) { u.ownMs = p.ownMs; u.own = { cpu, rssKb: p.rssKb, name: p.name }; continue; }
    const name = programOf(p.name, p.args);
    u.pids.push({ key, program: name, ms: p.ownMs });
    const g = u.programs.find((x) => x.name === name) ?? (u.programs.push({ name, cpu: 0, rssKb: 0, count: 0 }), u.programs.at(-1));
    g.cpu += cpu; g.rssKb += p.rssKb; g.count++;
  }
  for (const u of Object.values(terms)) u.programs.sort((x, y) => y.cpu - x.cpu || y.rssKb - x.rssKb);
  other.sort((x, y) => y.cpu - x.cpu || y.rssKb - x.rssKb);
  previous.set(m, { os: s.os, at: s.at, cpu: cpuNow });
  // CPU % needs two polls; until then the first one's terminals show memory only.
  const terminals = Object.fromEntries(Object.entries(live.terminals).filter(([a]) => machineOf(a) !== m));
  live = { at: Date.now(), terminals: { ...terminals, ...terms }, machines: { ...live.machines, [m]: { os: s.os, rated: dt > 0, other: other.slice(0, OTHER_TOP) } } };
  version++;
  return terms;
}

const machineOf = (address) => (address.includes("/") ? address.slice(0, address.indexOf("/")) : "");

// For t8's live table: the whole snapshot, { at, terminals: {address: usage}, machines: {name: {os, rated, other}} }.
export const resourceSnapshot = () => live;
export const liveUsage = (address) => live.terminals[address] ?? null;
// The top processes outside every agent's tree, on every machine (or one), busiest first.
export const otherProcesses = (machine) => Object.entries(live.machines)
  .filter(([m]) => machine === undefined || m === (machine ?? "")).flatMap(([, x]) => x.other)
  .sort((x, y) => y.cpu - x.cpu || y.rssKb - x.rssKb);

// The sum of several terminals' usage (an orchestrator and its agents), or null when none is
// known: { cpu, rssKb, own (the first terminal's own process), programs (every agent's own
// process counted as "agent") }.
export function treeUsage(addresses) {
  const us = addresses.map(liveUsage).filter(Boolean);
  if (!us.length) return null;
  const programs = new Map();
  const add = (name, cpu, rssKb, count = 1) => {
    const g = programs.get(name) ?? { name, cpu: 0, rssKb: 0, count: 0 };
    g.cpu += cpu; g.rssKb += rssKb; g.count += count;
    programs.set(name, g);
  };
  for (const u of us) {
    if (u !== us[0] || addresses[0] !== u.address) add("agent", u.own.cpu, u.own.rssKb);
    for (const g of u.programs) add(g.name, g.cpu, g.rssKb, g.count);
  }
  return {
    cpu: us.reduce((n, u) => n + u.cpu, 0), rssKb: us.reduce((n, u) => n + u.rssKb, 0),
    own: liveUsage(addresses[0])?.own ?? null,
    programs: [...programs.values()].sort((x, y) => y.cpu - x.cpu || y.rssKb - x.rssKb),
  };
}

// "85% · 2.1G" for a usage above HOT, else null.
export function hotText(u) {
  if (!u || (u.cpu <= HOT.cpu && u.rssKb <= HOT.rssKb)) return null;
  return `${Math.round(u.cpu)}% · ${memText(u.rssKb)}`;
}
export const memText = (kb) => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)}G` : `${Math.round(kb / 1024)}M`);

// What the badges show right now (each live terminal's, and each orchestrator's with its
// agents), so a view redraws when that changes and not on every sample.
export function hotSignature(ctx) {
  const each = ctx.terminals.filter((t) => t.state === "live").map((t) => hotText(liveUsage(t.address)) ?? "");
  const trees = orchestratorsOf(ctx).map((o) => hotText(treeUsage([o.address, ...workersOf(o.address, ctx).map((w) => w.address)])) ?? "");
  return [...each, ...trees].join("|");
}
export const sampleVersion = () => version;

// ---- per-run totals, kept in the run directory ----

// Each run's .resources.json as the last poll read it, by run key. Kept here, not on the run
// objects, so the views (which redraw when a run changes) do not redraw on every sample.
const stored = new Map();
export const setStored = (key, text) => stored.set(key, parseJson(text));
// For t4/t8: a run's totals (the file's shape is in run-files.md), or null before its first sample.
export const resourcesOf = (run) => stored.get(run.key) ?? null;

const parseJson = (s) => { try { return s?.trim() ? JSON.parse(s) : null; } catch { return null; } };
const r1 = (x) => Math.round(x * 10) / 10;
const mb = (kb) => kb / 1024;

// The run's terminals as [{address, name, parent}] → its totals with this sample added.
// `prev` is the file as read; `now` the wall clock in ms. Pure, so tests can drive it.
// CPU totals keep the largest value seen per terminal and per process (the counters only grow),
// so a sample counted twice changes nothing; memory peaks are maxima and averages weigh
// each sample by the time since the one before (at most MAX_GAP_S), so more polls do not
// tilt them either.
export function mergeRun(prev, terms, usage, now, os) {
  const st = prev && prev.version === 1 ? JSON.parse(JSON.stringify(prev)) : { sampled_ms: 0, version: 1, os, estimated: os !== "linux", samples: 0, seconds: 0, cpu_s: 0, peak_rss_mb: 0, avg_rss_mb: 0, rss_mbs: 0, programs: {}, agents: {} };
  const dt = st.sampled_ms ? Math.min(Math.max(0, (now - st.sampled_ms) / 1000), MAX_GAP_S) : 5;
  st.sampled_ms = now; st.os = os; st.estimated = os !== "linux"; st.samples++; st.seconds = r1(st.seconds + dt);
  let runKb = 0;
  for (const t of terms) {
    const u = usage[t.address];
    const key = t.name || t.address;
    const ag = (st.agents[key] ??= { terminals: [], parent: null, first_ms: now, last_ms: now, seconds: 0, cpu_s: 0, own_cpu_s: 0, peak_rss_mb: 0, avg_rss_mb: 0, programs: {}, raw: { terms: {}, done_ms: {}, rss_mbs: 0, prog_mbs: {}, prog_peak: {} } });
    if (!ag.terminals.includes(t.address)) ag.terminals.push(t.address);
    if (t.parent) ag.parent = t.parent;
    const raw = ag.raw;
    const rt = (raw.terms[t.address] ??= { cpu_ms: 0, own_ms: 0, live: {} });
    // Processes gone since the last sample: their last CPU time stays with their program.
    const nowLive = new Map((u?.pids ?? []).map((p) => [p.key, p]));
    for (const [k, [prog, ms]] of Object.entries(rt.live)) {
      if (nowLive.has(k)) continue;
      raw.done_ms[prog] = (raw.done_ms[prog] ?? 0) + ms;
      delete rt.live[k];
    }
    if (!u) continue;
    for (const p of nowLive.values()) rt.live[p.key] = [p.program, Math.max(p.ms, rt.live[p.key]?.[1] ?? 0)];
    rt.cpu_ms = Math.max(rt.cpu_ms, u.totalMs);
    rt.own_ms = Math.max(rt.own_ms, u.ownMs);
    ag.last_ms = now; ag.seconds = r1(ag.seconds + dt);
    runKb += u.rssKb;
    raw.rss_mbs += mb(u.rssKb) * dt;
    ag.peak_rss_mb = r1(Math.max(ag.peak_rss_mb, mb(u.rssKb)));
    const progKb = {};
    for (const g of u.programs) progKb[g.name] = g.rssKb;
    for (const [name, kb] of Object.entries(progKb)) {
      raw.prog_mbs[name] = (raw.prog_mbs[name] ?? 0) + mb(kb) * dt;
      raw.prog_peak[name] = Math.max(raw.prog_peak[name] ?? 0, mb(kb));
    }
  }
  // Derived numbers, from the raw counters.
  const runProgs = {};
  st.cpu_s = 0;
  for (const ag of Object.values(st.agents)) {
    const raw = ag.raw;
    const terms = Object.values(raw.terms);
    const own = terms.reduce((n, x) => n + x.own_ms, 0);
    let total = terms.reduce((n, x) => n + x.cpu_ms, 0);
    const progMs = { ...raw.done_ms };
    for (const x of terms) for (const [prog, ms] of Object.values(x.live)) progMs[prog] = (progMs[prog] ?? 0) + ms;
    const counted = own + Object.values(progMs).reduce((n, ms) => n + ms, 0);
    // macOS knows no exited children: its total is what was seen.
    if (st.estimated) total = Math.max(total, counted);
    // What the agent's commands used that no poll saw alive: commands under 5 s.
    if (total - counted > 0) progMs["short-lived"] = total - counted;
    ag.cpu_s = r1(total / 1000); ag.own_cpu_s = r1(own / 1000);
    ag.avg_rss_mb = ag.seconds ? r1(raw.rss_mbs / ag.seconds) : 0;
    ag.programs = {};
    for (const name of new Set([...Object.keys(progMs), ...Object.keys(raw.prog_peak)])) {
      ag.programs[name] = { cpu_s: r1((progMs[name] ?? 0) / 1000), peak_rss_mb: r1(raw.prog_peak[name] ?? 0), avg_rss_mb: ag.seconds ? r1((raw.prog_mbs[name] ?? 0) / ag.seconds) : 0 };
      runProgs[name] = r1((runProgs[name] ?? 0) + (progMs[name] ?? 0) / 1000);
    }
    st.cpu_s += total / 1000;
  }
  st.cpu_s = r1(st.cpu_s);
  st.programs = Object.fromEntries(Object.entries(runProgs).map(([k, v]) => [k, { cpu_s: v }]));
  st.peak_rss_mb = r1(Math.max(st.peak_rss_mb, mb(runKb)));
  st.rss_mbs += mb(runKb) * dt;
  st.avg_rss_mb = st.seconds ? r1(st.rss_mbs / st.seconds) : 0;
  return st;
}

// Writes the file only when it still holds what this poll read (sampled_ms, its first key, is
// the version; else exits 3), under a mkdir lock, through a temporary file and mv: two windows polling at
// once cannot interleave, and the slower one's sample is dropped, not merged twice. A lock
// left by a killed writer is broken after a minute.
export const WRITE = [
  'f="$1/.resources.json" want=$2 l="$1/.resources.json.lock"',
  'if ! mkdir "$l" 2>/dev/null; then',
  '  [ -n "$(find "$l" -maxdepth 0 -mmin +1 2>/dev/null)" ] && rmdir "$l" 2>/dev/null',
  '  exit 3',
  'fi',
  "trap 'rmdir \"$l\" 2>/dev/null' EXIT",
  'have=$(head -c 40 "$f" 2>/dev/null | sed -n \'s/^{"sampled_ms":\\([0-9]*\\).*/\\1/p\')',
  '[ "${have:-0}" = "$want" ] || exit 3',
  'printf "%s" "$3" >"$f.tmp.$$" && mv "$f.tmp.$$" "$f"',
].join("\n");

// Polls closer together than this (another window's) are skipped rather than written.
const MIN_WRITE_GAP = 4000;

// Adds this poll's sample to each live run's totals and writes them. `runs` are data.js runs;
// `termsOf(run)` gives its terminals [{address, name, parent}]; `sampled` the machines that answered.
export async function recordRuns(runs, termsOf, sampled) {
  const now = Date.now();
  await Promise.all(runs.map(async (r) => {
    const m = r.machine ?? "";
    const info = live.machines[m];
    if (!sampled.has(m) || !info?.rated) return;
    const terms = termsOf(r);
    if (!terms.some((t) => live.terminals[t.address])) return;
    const prev = stored.get(r.key) ?? null;
    if (prev && now - (prev.sampled_ms ?? 0) < MIN_WRITE_GAP) return;
    const next = mergeRun(prev, terms, live.terminals, now, info.os);
    const out = await exec("sh", ["-c", WRITE, "sh", r.dir, String(prev?.sampled_ms ?? 0), JSON.stringify(next)], { on: r.machine }).catch(() => null);
    if (out?.code === 0) stored.set(r.key, next);
  }));
}
