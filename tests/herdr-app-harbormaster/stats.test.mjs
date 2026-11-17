// Unit tests for the stats view's figures (herdr-app/mods/harbormaster/statsdata.js): reading
// .history.jsonl, an open run's summary from timing and .resources.json, merging open and past
// runs, the across-runs sums, the live table's groups and the view's shape (sorting, folding,
// the hottest agent, the legend's split, the recent runs).
// Run: node --import ./loader.mjs --test stats.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHistory, summaryOf, mergeRuns, acrossRuns, liveGroups, isRunProp, taskOfName, timingOrder, refreshTimings, cats, addCats, catTotal, tokenParts,
  liveTable, groupProcesses, hottest, hottestText, timeSplit, recentRuns, foldQuiet, createSteady, sig2 } from "../../herdr-app/mods/harbormaster/statsdata.js";
import { tokenShort, tokenHeadline } from "../../herdr-app/mods/harbormaster/context.js";

const line = (o) => JSON.stringify({ v: 1, folder: "/p/skills", branch: "b", type: "feat", started: "2026-11-01T10:00:00Z", wall: 100, critical_path: { model: 60, idle: 40 }, ...o });

test("history: last line per run and start, bad lines skipped, missing keys read as 0 or null", () => {
  const text = [
    line({ run: "/r/a", wall: 10 }),
    "{not json",
    line({ run: "/r/b" }),
    line({ run: "/r/a", wall: 20 }),
    line({ run: "/r/a", started: "2026-11-02T10:00:00Z", wall: 30 }),
    JSON.stringify({ v: 1, run: "/r/c" }),
    JSON.stringify({ v: 1 }),
    '{"v":1,"run":"/r/d","wall":', // half-written last line
  ].join("\n");
  const runs = parseHistory(text, "box");
  assert.deepEqual(runs.map((r) => [r.run, r.wall]), [["/r/b", 100], ["/r/a", 20], ["/r/a", 30], ["/r/c", 0]]);
  const c = runs.find((r) => r.run === "/r/c");
  assert.equal(c.machine, "box");
  assert.equal(c.branch, "c");
  assert.deepEqual(c.critical_path, {});
  assert.deepEqual(c.tasks, []);
  assert.equal(c.tokens, null);
  assert.equal(c.resources, null);
  assert.equal(c.source, "history");
  assert.equal(parseHistory("", null).length, 0);
  assert.equal(parseHistory(null).length, 0);
});

test("history: tasks, agents, tokens and resources keep their numbers; zero categories drop", () => {
  const [r] = parseHistory(line({
    run: "/r/a", categories: { model: 5, test: 0, lint: "3" },
    tasks: [{ id: "t1", total: 9, categories: { test: 4 }, cpu_s: 2.5, peak_rss_mb: null }],
    agents: [{ name: "rss-t1", role: "impl", task: "t1", total: 9, categories: {} }],
    tokens: { total: 100, input: 1, output: 9, cache_read: 80, cache_write: 10 },
    resources: { cpu_s: 12, peak_rss_mb: 300, avg_rss_mb: 200, estimated: false, programs: { "test runner": { cpu_s: 4, peak_rss_mb: 90 } } },
  }));
  assert.deepEqual(r.categories, { model: 5, lint: 3 });
  assert.equal(r.tasks[0].cpu_s, 2.5);
  assert.equal(r.tasks[0].peak_rss_mb, null);
  assert.equal(r.agents[0].cpu_s, null);
  assert.deepEqual(tokenParts(r.tokens), { fresh: 20, cached: 80 });
  assert.equal(r.resources.programs["test runner"].cpu_s, 4);
});

test("category helpers: missing keys are 0", () => {
  assert.deepEqual(cats({ a: 1, b: 0, c: "x", d: "2" }), { a: 1, d: 2 });
  assert.deepEqual(addCats({ a: 1 }, { a: 2, b: 3 }), { a: 3, b: 3 });
  assert.equal(catTotal(undefined), 0);
  assert.equal(catTotal({ a: 1, b: 2 }), 3);
});

test("taskOfName", () => {
  assert.equal(taskOfName("impl-rss-t3", "rss"), "t3");
  assert.equal(taskOfName("rev-pda-final-fix", "pda"), "final-fix");
  assert.equal(taskOfName("orc-skills-stats", "rss"), null);
  assert.equal(taskOfName("impl-rss-t3", null), null);
  // "final" is no task; a round suffix is dropped only when the base is a known task.
  assert.equal(taskOfName("rev-rss-final", "rss"), null);
  assert.equal(taskOfName("rev-rss-t2-2", "rss", new Set(["t2"])), "t2");
  assert.equal(taskOfName("grunt-rss-t2-2", "rss", new Set(["t2"])), "t2");
  assert.equal(taskOfName("rev-rss-t2-2", "rss"), "t2-2");
});

const run = { key: ":/r/live", dir: "/r/live", machine: null, branch: "run-x", folder: "/p/skills", type: "feat", topic: "Stats", prefix: "rss", merged: 1, planned: 3, statusLine: "running", away: null, started: Date.parse("2026-11-16T08:00:00Z"), tokens: { total: 50, input: 1, output: 4, cacheRead: 40, cacheWrite: 5 } };
const timing = {
  version: 1, start: "2026-11-16T08:00:00Z", end: "2026-11-16T09:00:00Z", wall: 3600,
  critical_path: { model: 1000, agent_wait: 2000, idle: 600 }, categories: { model: 1500, test: 100 },
  agents: [
    { name: "orchestrator", label: null, role: "orchestrator", task: null, kind: "claude", total: 3000, categories: { model: 1000 } },
    { name: "rss-t1", label: "impl-rss-t1", role: "impl", task: "t1", kind: "claude", total: 400, categories: { test: 100, model: 300 } },
    { name: "rss-t1", label: "rev-rss-t1", role: "rev", task: "t1", kind: "claude", total: 100, categories: { review: 100 } },
  ],
  tasks: [{ id: "t1", total: 500, categories: { test: 100, model: 300, review: 100 } }],
  tokens: null,
};
const res = {
  version: 2, cpu_s: 50, peak_rss_mb: 900, avg_rss_mb: 600, estimated: false, programs: { "test runner": { cpu_s: 10 } },
  agents: {
    "orc-skills-x": { parent: null, cpu_s: 20, peak_rss_mb: 400, avg_rss_mb: 300 },
    "impl-rss-t1": { parent: "orc-skills-x", cpu_s: 15, peak_rss_mb: 350, avg_rss_mb: 250 },
    // A command impl-rss-t1 started with hc run: counted for it.
    "impl-rss-t1-tests": { parent: "impl-rss-t1", cpu_s: 5, peak_rss_mb: 500, avg_rss_mb: 100 },
    // An agent timing does not know (no session read yet): its own row, its task from its name.
    "impl-rss-t2": { parent: "orc-skills-x", cpu_s: 7, peak_rss_mb: 200, avg_rss_mb: 150 },
    "impl-rss-t2-build": { parent: "impl-rss-t2", cpu_s: 3, peak_rss_mb: 100, avg_rss_mb: 50 },
  },
};

test("summaryOf: timing agents get their terminals' CPU and memory; unknown ones become rows; tasks sum", () => {
  const s = summaryOf(run, timing, res);
  assert.equal(s.source, "open");
  assert.equal(s.live, true);
  assert.equal(s.wall, 3600);
  assert.deepEqual(s.critical_path, { model: 1000, agent_wait: 2000, idle: 600 });
  // status.json's tokens when timing has none, in the history's names.
  assert.deepEqual(s.tokens, { total: 50, input: 1, output: 4, cache_read: 40, cache_write: 5 });
  const by = Object.fromEntries(s.agents.map((a) => [a.label ?? a.name, a]));
  assert.equal(by.orchestrator.cpu_s, 20);
  assert.equal(by["impl-rss-t1"].cpu_s, 20);
  assert.equal(by["impl-rss-t1"].peak_rss_mb, 500);
  assert.equal(by["rev-rss-t1"].cpu_s, null);
  assert.equal(by["impl-rss-t2"].cpu_s, 10);
  assert.equal(by["impl-rss-t2"].task, "t2");
  assert.equal(by["impl-rss-t2"].role, "impl");
  assert.equal(by["impl-rss-t2"].total, 0);
  const t1 = s.tasks.find((k) => k.id === "t1"), t2 = s.tasks.find((k) => k.id === "t2");
  assert.equal(t1.total, 500);
  assert.equal(t1.cpu_s, 20);
  assert.equal(t1.peak_rss_mb, 500);
  assert.equal(t2.total, 0);
  assert.equal(t2.cpu_s, 10);
  assert.equal(s.resources.cpu_s, 50);
  assert.equal(s.tasks_planned, 3);
});

test("summaryOf: no timing and no resources yet", () => {
  const s = summaryOf({ ...run, tokens: null }, null, null);
  assert.equal(s.timed, false);
  assert.equal(s.wall, 0);
  assert.deepEqual(s.agents, []);
  assert.deepEqual(s.tasks, []);
  assert.equal(s.tokens, null);
  assert.equal(s.resources, null);
  assert.equal(s.started, "2026-11-16T08:00:00.000Z");
});

test("mergeRuns: a closed run in the history shows once, as its line; an open one live; newest first", () => {
  const open = [
    { ...summaryOf(run, timing, res) },
    { ...summaryOf({ ...run, key: ":/r/old", dir: "/r/old", away: { how: "closed", at: Date.parse("2026-11-10T00:00:00Z") }, started: Date.parse("2026-11-09T00:00:00Z") }, null, null) },
  ];
  const history = parseHistory([
    line({ run: "/r/old", started: "2026-11-09T00:00:00Z", wall: 77 }),
    // Same directory, recorded once, then resumed: the open run shows its live figures.
    line({ run: "/r/live", started: "2026-11-16T08:00:00Z", wall: 5 }),
    line({ run: "/r/gone", started: "2026-11-12T00:00:00Z" }),
  ].join("\n"), null);
  const rows = mergeRuns(open, history);
  assert.deepEqual(rows.map((r) => [r.run, r.source]), [["/r/live", "open"], ["/r/gone", "history"], ["/r/old", "history"]]);
  assert.equal(rows.find((r) => r.run === "/r/old").wall, 77);
  // A history line from another machine is another run.
  const other = parseHistory(line({ run: "/r/old", started: "2026-11-09T00:00:00Z" }), "box");
  assert.equal(mergeRuns(open, other).length, 3);
});

test("acrossRuns: sums critical paths, by group, biggest first; runs without time left out", () => {
  const rows = parseHistory([
    line({ run: "/r/1", folder: "/p/skills", type: "feat", wall: 100, critical_path: { model: 60, idle: 40 } }),
    line({ run: "/r/2", folder: "/p/app", type: "fix", wall: 300, critical_path: { test: 200, model: 100 } }),
    line({ run: "/r/3", folder: "/q/skills", type: "feat", wall: 50, critical_path: { model: 50 } }),
    line({ run: "/r/4", critical_path: {} }),
  ].join("\n"));
  const [all] = acrossRuns(rows);
  assert.equal(all.runs, 3);
  assert.equal(all.wall, 450);
  assert.deepEqual(all.critical_path, { model: 210, idle: 40, test: 200 });
  assert.equal(all.total, 450);
  assert.deepEqual(acrossRuns(rows, "folder").map((g) => [g.group, g.runs, g.total]), [["app", 1, 300], ["skills", 2, 150]]);
  assert.deepEqual(acrossRuns(rows, "type").map((g) => g.group), ["fix", "feat"]);
  assert.deepEqual(acrossRuns([]), []);
});

test("liveGroups: crews with their agents, the rest after, only terminals the snapshot has", () => {
  const u = (cpu, rssKb) => ({ cpu, rssKb, own: { cpu, rssKb }, programs: [] });
  const snap = { terminals: { o1: u(10, 1000), a1: u(80, 2000), a2: u(5, 10), x9: u(30, 5), y1: u(0.5, 1) } };
  const groups = liveGroups([
    { title: "Run one", root: "o1", name: "orc", members: [{ address: "a1", name: "impl-x-t1" }, { address: "gone", name: "z" }] },
    { title: "Empty", root: "nope", members: [] },
  ], snap, { x9: "stray" });
  // Idle terminals in no run (under 1% and 100 MB) are counted, not listed.
  assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => r.name), g.cpu, g.hidden]), [
    ["Run one", ["orc", "impl-x-t1"], 90, undefined],
    ["Not in a run", ["stray", "a2"], 35.5, { count: 1, cpu: 0.5, rssKb: 1 }],
  ]);
  assert.equal(groups[1].rows[0].term, "stray");
  assert.deepEqual(liveGroups([], {}), []);
});

test("isRunProp: a run directory, with ~ or a trailing slash", () => {
  const s = { run: "/home/u/.herdr/hc-orchestration/skills/x" };
  assert.ok(isRunProp(s, "/home/u/.herdr/hc-orchestration/skills/x/"));
  assert.ok(isRunProp(s, "~/.herdr/hc-orchestration/skills/x"));
  assert.ok(!isRunProp(s, "~/.herdr/hc-orchestration/skills/xy"));
  assert.ok(!isRunProp(s, null));
});

test("summaryOf and buildLine give an open run and its history line the same agents and tasks", async () => {
  const { buildLine } = await import("../../herdr-app/mods/harbormaster/history.js");
  const open = summaryOf(run, timing, res);
  const past = parseHistory(JSON.stringify(buildLine(run, timing, res, null, 1)))[0];
  const pick = (s) => [s.agents.map((a) => [a.label ?? a.name, a.cpu_s, a.peak_rss_mb]), s.tasks.map((k) => [k.id, k.cpu_s, k.peak_rss_mb])];
  assert.deepEqual(pick(past), pick(open));
});

test("timingOrder: live runs already read, then never read, then put away", () => {
  const live = { away: null }, away = { away: { how: "parked" } };
  assert.deepEqual([timingOrder(live, {}), timingOrder(live, null), timingOrder(away, null), timingOrder(away, {})], [0, 1, 1, 2]);
});

test("refreshTimings: a second caller during a pass hears each run read too", async () => {
  const seen = { a: [], b: [] };
  let release;
  const gate = new Promise((r) => { release = r; });
  globalThis.__herdrExec = async () => { await gate; return { code: 0, stdout: JSON.stringify({ version: 1, wall: 1 }), stderr: "" }; };
  try {
    const r = { key: "m:/r/listen", dir: "/r/listen", machine: null, away: null };
    const p1 = refreshTimings([r], (x) => seen.a.push(x.key));
    const p2 = refreshTimings([r], (x) => seen.b.push(x.key));
    release();
    await Promise.all([p1, p2]);
    assert.deepEqual(seen, { a: ["m:/r/listen"], b: ["m:/r/listen"] });
  } finally { delete globalThis.__herdrExec; }
});

const term = (address, cpu, rssKb, programs = [], own = { cpu: 0, rssKb: 0 }) => ({ cpu, rssKb, own, programs });

test("liveTable: hottest first, a lone orchestrator is the run line, runs under 1% fold", () => {
  const snap = { terminals: {
    o1: term("o1", 1, 300), o2: term("o2", 3, 500), w2: term("w2", 44, 900, [{ name: "browser", cpu: 40, rssKb: 800, count: 3 }]),
    o3: term("o3", 0.4, 400), o4: term("o4", 0.2, 200),
  } };
  const groups = liveGroups([
    { title: "Quiet one", root: "o1", name: "orchestrator", members: [] },
    { title: "Sunday", root: "o2", name: "orchestrator", members: [{ address: "w2", name: "impl-x-ui" }] },
    { title: "Idle A", root: "o3", name: "orchestrator", members: [] },
    { title: "Idle B", root: "o4", name: "orchestrator", members: [] },
  ], snap);
  const { groups: shown, quiet } = liveTable(groups);
  assert.deepEqual(shown.map((g) => [g.title, g.rows.map((r) => r.name), Boolean(g.solo)]), [
    ["Sunday", ["impl-x-ui", "orchestrator"], false],
    ["Quiet one", [], true],
  ]);
  assert.equal(shown[1].solo.address, "o1");
  assert.equal(quiet.count, 2);
  assert.deepEqual(quiet.names, ["Idle A", "Idle B"]);
  assert.ok(Math.abs(quiet.cpu - 0.6) < 1e-9);
  assert.equal(quiet.rssKb, 600);
  assert.deepEqual(liveTable([]), { groups: [], quiet: null });
});

test("groupProcesses: repeated programs are one row with a count, quiet ones fold", () => {
  const other = [
    { machine: null, pid: 1, name: "firefox", program: "browser", cpu: 15, rssKb: 100 },
    { machine: null, pid: 2, name: "herdr-app", program: "herdr-app", cpu: 47, rssKb: 900 },
    { machine: null, pid: 3, name: "firefox", program: "browser", cpu: 6, rssKb: 200 },
    { machine: null, pid: 4, name: "firefox", program: "browser", cpu: 5, rssKb: 300 },
    { machine: "box", pid: 5, name: "firefox", program: "browser", cpu: 2, rssKb: 10 },
    { machine: null, pid: 6, name: "sshd", program: "sshd", cpu: 0.2, rssKb: 5 },
  ];
  const { busy, quiet } = groupProcesses(other);
  assert.deepEqual(busy.map((g) => [g.name, g.machine, g.count, g.cpu, g.rssKb]), [
    ["herdr-app", null, 1, 47, 900], ["firefox", null, 3, 26, 600], ["firefox", "box", 1, 2, 10],
  ]);
  assert.deepEqual(busy[1].pids, [1, 3, 4]);
  assert.deepEqual(quiet.names, ["sshd"]);
  assert.deepEqual(foldQuiet([{ name: "a", cpu: 1, rssKb: 0 }]), { busy: [{ name: "a", cpu: 1, rssKb: 0 }], quiet: null });
});

test("hottest: the busiest agent in plain words, what its CPU mostly goes to", () => {
  const row = (name, cpu, programs, own = 0) => ({ name, cpu, rssKb: 1, own: { cpu: own, rssKb: 1 }, programs });
  const g = [{ rows: [row("orchestrator", 2, [], 2)] }, { rows: [row("impl-xweek-ui", 44, [{ name: "browser", cpu: 37 }, { name: "mcp server", cpu: 0.3 }], 7)] }];
  assert.deepEqual(hottest(g), { name: "impl-xweek-ui", cpu: 44, rssKb: 1, mostly: "browser" });
  assert.equal(hottestText(hottest(g)), "Hottest: impl-xweek-ui 44%, mostly browser");
  // No program has half: the two biggest. The agent's own process is "the agent itself".
  assert.equal(hottest([{ rows: [row("a", 30, [{ name: "lint", cpu: 12 }, { name: "browser", cpu: 8 }], 10)] }]).mostly, "lint and the agent itself");
  assert.equal(hottestText(hottest([{ rows: [row("a", 90, [], 90)] }])), "Hottest: a 90%, mostly the agent itself");
  assert.equal(hottest([{ rows: [row("a", 0.5, [], 0.5)] }]), null);
  assert.equal(hottestText(null), "Nothing busy right now");
});

test("timeSplit: idle apart, biggest first, the top four of 1% or more shown, the rest hidden", () => {
  const m = { idle: 600, model: 100, agent_wait: 500, test: 2, git: 50, lint: 80, review: 60, user_wait: 0 };
  const s = timeSplit(m);
  assert.equal(s.idle, 600);
  assert.equal(s.working, 792);
  assert.deepEqual(s.parts.map((p) => p.key), ["agent_wait", "model", "lint", "review", "git", "test"]);
  assert.deepEqual(s.shown.map((p) => p.key), ["agent_wait", "model", "lint", "review"]);
  assert.deepEqual(s.hidden.map((p) => p.key), ["git", "test"]);
  // Under 1% is hidden even when there is room.
  assert.deepEqual(timeSplit({ model: 1000, test: 5 }).shown.map((p) => p.key), ["model"]);
  assert.deepEqual(timeSplit({ idle: 10 }), { working: 0, idle: 10, parts: [], shown: [], hidden: [] });
  assert.equal(timeSplit(undefined).working, 0);
});

test("recentRuns: the newest five, the rest counted as older unless all are asked for", () => {
  const runs = Array.from({ length: 8 }, (_, i) => ({ key: i }));
  assert.deepEqual([recentRuns(runs).rows.length, recentRuns(runs).older], [5, 3]);
  assert.deepEqual([recentRuns(runs, true).rows.length, recentRuns(runs, true).older], [8, 0]);
  assert.deepEqual(recentRuns(runs.slice(0, 2)).older, 0);
});

test("recentRuns: every open run is listed, so showing all changes nothing while only they and the recent ones exist", () => {
  const runs = [...Array.from({ length: 3 }, (_, i) => ({ key: `o${i}`, source: "open", live: true })), ...Array.from({ length: 4 }, (_, i) => ({ key: `p${i}` }))];
  assert.equal(recentRuns(runs).rows.length, 7);
  assert.equal(recentRuns(runs).older, 0);
  assert.equal(recentRuns(runs, true).rows.length, runs.length);
});

test("tokenShort: the card's fresh-first headline, short", () => {
  const tk = { total: 95_100_000, input: 100_000, output: 1_000_000, cache_write: 2_000_000, cache_read: 92_000_000 };
  assert.equal(tokenHeadline(tk), "3.1M tok (+92M cached)");
  assert.equal(tokenShort(tk), "3.1M +92M");
  assert.equal(tokenShort({ total: 500, input: 200, output: 300, cache_read: 0, cache_write: 0 }), "<1k");
  assert.equal(tokenShort({ total: 1_200_000, input: 0, output: 0, cache_read: 0, cache_write: 0 }), "1.2M");
});

test("liveTable: only runs fold into quiet runs; Not in a run stays its own line", () => {
  const snap = { terminals: { o1: term("o1", 0.3, 100), o2: term("o2", 0.2, 100), loose: term("loose", 0.5, 200 * 1024), o3: term("o3", 5, 100) } };
  const groups = liveGroups([
    { title: "Road routes", root: "o1", name: "orchestrator", members: [] },
    { title: "Diesel", root: "o2", name: "orchestrator", members: [] },
    { title: "Busy", root: "o3", name: "orchestrator", members: [] },
  ], snap, { loose: "t4db" });
  const { groups: shown, quiet } = liveTable(groups);
  assert.deepEqual(shown.map((g) => g.title), ["Busy", "Not in a run"]);
  assert.deepEqual(quiet.names, ["Road routes", "Diesel"]);
  assert.equal(quiet.count, 2);
});

test("hottest: a run's orchestrator is named with its run", () => {
  const snap = { terminals: { o1: term("o1", 40, 100, [], { cpu: 40, rssKb: 100 }), w1: term("w1", 3, 100) } };
  const groups = liveGroups([{ title: "Sunday match", root: "o1", name: "orchestrator", members: [{ address: "w1", name: "impl-x" }] }], snap);
  assert.equal(hottestText(hottest(groups)), "Hottest: Sunday match orchestrator 40%, mostly the agent itself");
  // The captain's root row is "captain" in the "Captain" crew: not "Captain captain".
  const cap = liveGroups([{ title: "Captain", root: "o1", name: "captain", members: [] }], snap);
  assert.equal(hottest(cap).name, "captain");
  // A worker keeps its own name.
  const w = liveGroups([{ title: "Sunday match", root: "o1", name: "orchestrator", members: [{ address: "w1", name: "impl-x" }] }],
    { terminals: { o1: term("o1", 1, 1), w1: term("w1", 30, 1) } });
  assert.equal(hottest(w).name, "impl-x");
});

test("runs list: an open run started days ago is always listed, ahead of newer past runs", () => {
  const o = summaryOf({ ...run, key: ":/r/resumed", dir: "/r/resumed", started: Date.parse("2026-11-14T00:00:00Z") }, null, null);
  const history = parseHistory(Array.from({ length: 6 }, (_, i) =>
    line({ run: `/r/p${i}`, started: `2026-11-1${5 + (i % 3)}T0${i}:00:00Z` })).join("\n"), null);
  const runs = mergeRuns([o], history);
  assert.equal(runs[0].run, "/r/resumed");
  const { rows, older } = recentRuns(runs);
  assert.ok(rows.some((r) => r.run === "/r/resumed"));
  assert.deepEqual([rows.length, older], [6, 1], "the open run plus the newest five past runs");
  assert.deepEqual([recentRuns(runs, true).rows.length, recentRuns(runs, true).older], [7, 0]);
  const more = Array.from({ length: 10 }, (_, i) => ({ key: i, source: i < 3 ? "open" : "history", live: true }));
  assert.deepEqual([recentRuns(more).rows.length, recentRuns(more).older], [8, 2], "three open runs plus five past");
  // Past runs stay newest first after the open one.
  const rest = rows.slice(1).map((r) => Date.parse(r.started));
  assert.deepEqual(rest, [...rest].sort((a, b) => b - a));
});

test("steady: order is kept under small changes and swapped under a clear overtake", () => {
  const st = createSteady();
  const rows = (a, b) => [{ address: "a", cpu: a, rssKb: 1 }, { address: "b", cpu: b, rssKb: 1 }];
  st.begin(1);
  assert.deepEqual(st.order("l", rows(50, 40)).map((r) => r.address), ["a", "b"]);
  // b is ahead by 4 points but only 8% relative: a stays on top.
  assert.deepEqual(st.order("l", rows(50, 54)).map((r) => r.address), ["a", "b"]);
  // 2+ points and 25%+ ahead: swapped, and kept once swapped.
  assert.deepEqual(st.order("l", rows(40, 60)).map((r) => r.address), ["b", "a"]);
  assert.deepEqual(st.order("l", rows(44, 46)).map((r) => r.address), ["b", "a"]);
  // Big relative lead but under 2 points: kept.
  assert.deepEqual(st.order("s", rows(1, 0.5)).map((r) => r.address), ["a", "b"]);
  assert.deepEqual(st.order("s", rows(0.4, 1.9)).map((r) => r.address), ["a", "b"]);
});

test("steady: smoothing is a moving average, rounded; the same sample gives the same figures", () => {
  const st = createSteady({ tauMs: 25000 });
  st.begin(0);
  assert.deepEqual(st.smooth("k", 80, 1234), { cpu: 80, rssKb: sig2(1234) });
  assert.deepEqual(st.smooth("k", 0, 0), { cpu: 80, rssKb: sig2(1234) }, "same sample: unchanged");
  st.begin(5000);
  const one = st.smooth("k", 0, 1234);
  assert.ok(one.cpu > 55 && one.cpu < 80, `moved only part of the way: ${one.cpu}`);
  st.begin(200000);
  assert.equal(st.smooth("k", 0, 1234).cpu, 0);
  // Rounded in the unit memText shows: 645 MB → 650 MB, 10 GiB stays 10 GiB.
  assert.equal(sig2(645 * 1024), 650 * 1024); assert.equal(sig2(10 * 1024 * 1024), 10 * 1024 * 1024);
});

test("steady: a row turns busy or quiet only after staying past the threshold for two samples", () => {
  const st = createSteady();
  const at = (n, cpu) => { st.begin(n); return st.busy("x", cpu); };
  assert.equal(at(1, 0), false);
  assert.equal(at(2, 5), false, "one sample over: still quiet");
  assert.equal(at(3, 5), true);
  assert.equal(at(4, 0), true, "one sample under: still busy");
  assert.equal(at(5, 5), true, "back over resets the count");
  assert.equal(at(6, 0), true);
  assert.equal(at(7, 0), false);
});

test("steady: liveTable and foldQuiet keep their places; hottest does not flip on a near tie", () => {
  const st = createSteady();
  const row = (address, cpu) => ({ address, name: address, cpu, rssKb: 1, own: null, programs: [] });
  const g = (a, b) => [{ title: "t", root: null, rows: [row("a", a), row("b", b)], cpu: a + b, rssKb: 2 }];
  st.begin(1);
  assert.equal(hottest(g(50, 40), st).name, "a");
  assert.deepEqual(liveTable(g(50, 40), st).groups[0].rows.map((r) => r.address), ["a", "b"]);
  st.begin(2);
  assert.equal(hottest(g(50, 55), st).name, "a");
  assert.deepEqual(liveTable(g(50, 55), st).groups[0].rows.map((r) => r.address), ["a", "b"]);
  st.begin(3);
  assert.equal(foldQuiet([row("a", 30), row("b", 3)], undefined, st, "z").busy[0].name, "a");
});

test("steady: terminals in no run move between a row and the idle line only after two samples", () => {
  const st = createSteady();
  const snap = (cpu) => ({ terminals: { t1: { cpu, rssKb: 10, own: null, programs: [] } } });
  const rows = (n, cpu) => { st.begin(n); return liveGroups([], snap(cpu), {}, st)[0].rows.length; };
  assert.equal(rows(1, 0), 0);
  assert.equal(rows(2, 2), 0, "one sample over: still folded");
  assert.equal(rows(3, 2), 1);
  assert.equal(rows(4, 0), 1, "one sample under: still a row");
  assert.equal(rows(5, 0), 0);
});

test("steady: each machine's figures are averaged on that machine's own sample time", () => {
  const st = createSteady({ tauMs: 25000 });
  const snap = (aAt, bAt, a, b) => ({
    at: Math.max(aAt, bAt),
    machines: { "": { rated: true, at: aAt }, m2: { rated: true, at: bAt } },
    terminals: { t1: { cpu: a, rssKb: 10, own: null, programs: [] }, "m2/t2": { cpu: b, rssKb: 10, own: null, programs: [] } },
  });
  st.begin(0);
  st.snapshot(snap(0, 0, 80, 80));
  // Only this machine polled (m2's sample is the old one): m2's figure must not move, however often we draw.
  st.begin(5000);
  const s1 = st.snapshot(snap(5000, 0, 0, 0)).terminals;
  assert.ok(s1.t1.cpu > 55 && s1.t1.cpu < 80, `this machine moved part of the way: ${s1.t1.cpu}`);
  assert.equal(s1["m2/t2"].cpu, 80, "m2 did not poll: not a sample for it");
  st.begin(10000);
  assert.equal(st.snapshot(snap(5000, 0, 0, 0)).terminals["m2/t2"].cpu, 80);
  // When m2 does poll, it moves by the time since its own last sample (10 s), not the view's.
  st.begin(11000);
  const s2 = st.snapshot(snap(5000, 10000, 0, 0)).terminals["m2/t2"].cpu;
  assert.ok(s2 > 45 && s2 < 65, `10 s of m2's time: ${s2}`);
});

test("steady: a machine with no rating yet passes through unsmoothed and seeds nothing", () => {
  const st = createSteady({ tauMs: 25000 });
  const snap = (rated, cpu) => ({
    at: 1, machines: { m2: { rated, at: 1 } },
    terminals: { "m2/t2": { cpu, rssKb: 2000, own: null, programs: [] } },
  });
  st.begin(1);
  assert.deepEqual(st.snapshot(snap(false, 0)).terminals["m2/t2"], { cpu: 0, rssKb: 2000, own: null, programs: [] }, "memory not rounded, as is");
  st.begin(2000);
  assert.equal(st.snapshot(snap(true, 90)).terminals["m2/t2"].cpu, 90, "its first rated sample is not averaged with the unrated 0");
  const others = st.others([{ machine: "m2", pid: 1, cpu: 7, rssKb: 1234 }], snap(false, 0));
  assert.equal(others[0].rssKb, 1234);
});
