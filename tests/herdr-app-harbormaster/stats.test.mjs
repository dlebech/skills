// Unit tests for the stats view's figures (herdr-app/mods/harbormaster/statsdata.js): reading
// .history.jsonl, an open run's summary from timing and .resources.json, merging open and past
// runs, the across-runs sums and the live table's groups.
// Run: node --import ./loader.mjs --test stats.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHistory, summaryOf, mergeRuns, acrossRuns, liveGroups, taskOfName, cats, addCats, catTotal, tokenParts } from "../../herdr-app/mods/harbormaster/statsdata.js";

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
  const snap = { terminals: { o1: u(10, 1000), a1: u(80, 2000), a2: u(5, 10), x9: u(30, 5), y1: u(1, 1) } };
  const groups = liveGroups([
    { title: "Run one", root: "o1", name: "orc", members: [{ address: "a1", name: "impl-x-t1" }, { address: "gone", name: "z" }] },
    { title: "Empty", root: "nope", members: [] },
  ], snap, { x9: "stray" });
  assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => r.name), g.cpu]), [
    ["Run one", ["orc", "impl-x-t1"], 90],
    ["Not in a run", ["stray", "a2", "y1"], 36],
  ]);
  assert.deepEqual(liveGroups([], {}), []);
});
