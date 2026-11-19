// Unit tests for the run history (herdr-app/mods/harbormaster/history.js): the line built from
// timing, status and resources, and the guarded append to .history.jsonl against a throwaway root.
// Run: node --import ./loader.mjs --test history.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLine, writeHistory, writeHistoryBeforeDelete, HISTORY, tune } from "../../herdr-app/mods/harbormaster/history.js";

tune.oldGap = 0; // runs here are all "old": closed before this process started
tune.retry = 0;

const timing = {
  version: 1, start: "2026-11-16T08:00:00Z", end: "2026-11-16T09:00:00Z", wall: 3600,
  critical_path: { agent_wait: 3000, idle: 100 }, categories: { test: 50, model: 400 },
  agents: [
    { name: "orchestrator", label: null, role: "orchestrator", task: null, kind: "claude", total: 3000, categories: { agent_wait: 3000 } },
    { name: "rss-t1", label: "impl-rss-t1", role: "impl", task: "t1", kind: "claude", total: 500, categories: { test: 50 } },
    { name: "rss-t9", label: null, role: "impl", task: "t9", kind: "pi", total: 5, categories: {} },
  ],
  tasks: [{ id: "t1", total: 500, categories: { test: 50 } }, { id: "t9", total: 5, categories: {} }],
  tokens: { total: 1000, input: 10, output: 20, cache_read: 900, cache_write: 70 },
};
const resources = {
  cpu_s: 100, peak_rss_mb: 900, avg_rss_mb: 500, estimated: false, programs: { "test runner": { cpu_s: 30 } },
  agents: {
    "orc-x": { parent: null, cpu_s: 40, peak_rss_mb: 400, avg_rss_mb: 300, programs: {} },
    "impl-rss-t1": { parent: "orc-x", cpu_s: 60, peak_rss_mb: 600, avg_rss_mb: 200, programs: { "test runner": { cpu_s: 30, peak_rss_mb: 80 } } },
  },
};
const mkRun = (root, name = "feat") => {
  const dir = join(root, "skills", name);
  mkdirSync(dir, { recursive: true });
  return { key: `k-${name}`, dir, folder: "/r/skills", branch: name, type: "feat", topic: "T", machine: null, started: Date.parse("2026-11-16T08:00:00Z"),
    statusLine: "finished", merged: 2, planned: 2, tokens: null, away: { how: "closed", at: Date.parse("2026-11-16T09:30:00Z"), was: null } };
};

test("buildLine joins timing, resources and status; unmatched rows have nulls", () => {
  const run = { ...mkRun(tmpdir(), "buildline-unused"), dir: "/x/skills/feat" };
  const l = buildLine(run, timing, resources, run.away.at, 1);
  assert.equal(l.v, 1);
  assert.equal(l.closed, "2026-11-16T09:30:00.000Z");
  assert.equal(l.wall, 3600);
  assert.equal(l.tasks_merged, 2);
  const by = Object.fromEntries(l.agents.map((a) => [a.name, a]));
  assert.equal(by.orchestrator.cpu_s, 40);
  assert.equal(by["impl-rss-t1"].peak_rss_mb, 600);
  assert.equal(by["rss-t9"].cpu_s, null);
  assert.deepEqual(l.tasks.map((t) => [t.id, t.cpu_s, t.peak_rss_mb]), [["t1", 60, 600], ["t9", null, null]]);
  assert.deepEqual(l.resources.programs["test runner"], { cpu_s: 30, peak_rss_mb: 80 });
  assert.equal(l.tokens.cache_read, 900);
});

test("buildLine with nothing known gives nulls, not a throw", () => {
  const l = buildLine({ dir: "/x/a/b", key: "k" }, null, null, null, 1);
  assert.equal(l.wall, null);
  assert.equal(l.resources, null);
  assert.equal(l.tokens, null);
  assert.deepEqual(l.agents, []);
});

// The wait before a delete is a `sleep` process (Herdr has no setTimeout): it waits here too.
const slept = async (args) => { await new Promise((r) => setTimeout(r, Number(args[0]) * 1000)); return { code: 0, stdout: "", stderr: "" }; };

// exec on this machine for real, except timing.sh, which answers with the canned JSON.
function withExec(timingOut = JSON.stringify(timing), counts = {}) {
  globalThis.__herdrExec = async (cmd, args) => {
    if (cmd === "sleep") return slept(args);
    if (args[1] !== HISTORY) { counts.timing = (counts.timing ?? 0) + 1; return timingOut == null ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: timingOut, stderr: "" }; }
    counts.history = (counts.history ?? 0) + 1;
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return counts;
}
const lines = (root) => (existsSync(join(root, ".history.jsonl")) ? readFileSync(join(root, ".history.jsonl"), "utf8").split("\n").filter(Boolean) : []);

test("a closed run is appended once; polling again or deleting adds nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-hist-"));
  try {
    const counts = withExec();
    const run = mkRun(root);
    assert.equal(await writeHistory(run, "closed"), true);
    assert.equal(lines(root).length, 1);
    assert.equal(JSON.parse(lines(root)[0]).run, run.dir);
    await writeHistory(run, "closed");
    await writeHistoryBeforeDelete(run);
    assert.equal(lines(root).length, 1);
    assert.equal(counts.history, 2, "the second poll did not even look at the file");
    assert.equal(existsSync(join(root, ".history.jsonl.lock")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("after a restart the file is checked before any timing is read", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-hist-"));
  try {
    const run = mkRun(root);
    writeFileSync(join(root, ".history.jsonl"), JSON.stringify(buildLine(run, timing, null, run.away.at)) + "\n");
    const counts = withExec();
    // A fresh module instance has no memory of what was written.
    const fresh = await import("../../herdr-app/mods/harbormaster/history.js?restart");
    assert.equal(await fresh.writeHistory(run, "closed"), true);
    assert.equal(counts.timing ?? 0, 0);
    assert.equal(lines(root).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("deleting a run that was never closed writes one line, even without timing", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-hist-"));
  try {
    withExec(null);
    const run = { ...mkRun(root, "nc"), away: null };
    assert.equal(await writeHistoryBeforeDelete(run), true);
    const l = JSON.parse(lines(root)[0]);
    assert.equal(l.wall, null);
    assert.equal(l.run, run.dir);
    assert.ok(l.closed);
    await writeHistoryBeforeDelete(run);
    assert.equal(lines(root).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a closed run without readable timing is not written, and retried later", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-hist-"));
  try {
    withExec(null);
    const run = mkRun(root, "bad");
    assert.equal(await writeHistory(run, "closed"), false);
    assert.equal(lines(root).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a resumed run closed again gets a second line; an earlier one is not rewritten", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-hist-"));
  try {
    withExec();
    const run = mkRun(root, "again");
    await writeHistory(run, "closed");
    const later = { ...run, away: { ...run.away, at: run.away.at + 3600000 } };
    await writeHistory(later, "closed");
    assert.equal(lines(root).length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a held lock refuses, a stale one is broken, writers at once leave no torn line", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-hist-"));
  try {
    const dir = join(root, "skills", "x");
    mkdirSync(dir, { recursive: true });
    const args = (line) => ["-c", HISTORY, "sh", dir, "append", '"run":"a"', '"started":"s"', '"closed":"c"', line];
    const run = (line) => spawnSync("sh", args(line), { encoding: "utf8" });
    mkdirSync(join(root, ".history.jsonl.lock"));
    assert.equal(run("one").status, 3, "a fresh lock is respected");
    assert.equal(lines(root).length, 0);
    spawnSync("touch", ["-d", "10 minutes ago", join(root, ".history.jsonl.lock")]);
    assert.equal(run('{"run":"a","started":"s","closed":"c"}').status, 0, "a stale lock is broken");
    assert.equal(run('{"run":"a","started":"s","closed":"c"}').status, 5, "the same closing is not added twice");
    assert.equal(lines(root).length, 1);
    // Several at once, each its own closing: all succeed or find the lock held, and no line is torn.
    const codes = await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((res) => {
      spawn("sh", ["-c", HISTORY, "sh", dir, "append", '"run":"b"', '"started":"s"', `"closed":"c${i}"`, `{"i":${i}}`]).on("close", res);
    })));
    const wrote = codes.filter((c) => c === 0).length;
    assert.ok(wrote >= 1);
    assert.ok(codes.every((c) => c === 0 || c === 3));
    const all = lines(root).slice(1);
    assert.equal(all.length, wrote);
    for (const l of all) JSON.parse(l);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("closed runs older than the start are taken one per gap per machine", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-hist-"));
  try {
    withExec();
    tune.oldGap = 3600000;
    const a = { ...mkRun(root, "old1"), machine: "lazy" }, b = { ...mkRun(root, "old2"), machine: "lazy" };
    assert.equal(await writeHistory(a, "closed"), true);
    assert.equal(await writeHistory(b, "closed"), false, "not due yet");
    tune.oldGap = 0;
    assert.equal(await writeHistory(b, "closed"), true);
    assert.equal(lines(root).length, 2);
  } finally { tune.oldGap = 0; rmSync(root, { recursive: true, force: true }); }
});

test("timing reads go one at a time", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-hist-"));
  try {
    let now = 0, peak = 0;
    globalThis.__herdrExec = async (cmd, args) => {
      if (args[1] !== HISTORY) { peak = Math.max(peak, ++now); await new Promise((r) => setTimeout(r, 20)); now--; return { code: 0, stdout: JSON.stringify(timing), stderr: "" }; }
      const r = spawnSync(cmd, args, { encoding: "utf8" });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    await Promise.all(["q1", "q2", "q3"].map((n) => writeHistory(mkRun(root, n), "closed")));
    assert.equal(lines(root).length, 3);
    assert.equal(peak, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a closed run whose logs are gone is written without timing on the second failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-hist-"));
  try {
    const counts = withExec(null);
    const run = mkRun(root, "gone");
    assert.equal(await writeHistory(run, "closed"), false);
    assert.equal(await writeHistory(run, "closed"), true);
    assert.equal(JSON.parse(lines(root)[0]).wall, null);
    const n = counts.timing;
    await writeHistory(run, "closed");
    assert.equal(counts.timing, n, "no more reads");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("one resources row goes to one timing agent only", () => {
  const dup = { ...timing, agents: [timing.agents[1], { ...timing.agents[1], name: "rss-t1b" }], tasks: [timing.tasks[0]] };
  const l = buildLine({ dir: "/x/a/b", key: "k" }, dup, resources, null, 1);
  // The second gets none; the orchestrator's terminal, with no orchestrator in this timing, is a row of its own.
  assert.deepEqual(l.agents.map((a) => [a.name, a.cpu_s]), [["impl-rss-t1", 60], ["impl-rss-t1", null], ["orc-x", 40]]);
  assert.equal(l.tasks[0].cpu_s, 60);
});

test("a stale parentless terminal does not become the orchestrator's row", () => {
  const res = { agents: { old: { parent: null, cpu_s: 5, last_ms: 1 }, cur: { parent: null, cpu_s: 9, last_ms: 2 } } };
  const l = buildLine({ dir: "/x/a/b", key: "k" }, timing, res, null, 1);
  assert.equal(l.agents[0].cpu_s, 9);
});

test("deleteRun waits for the history, then deletes; a history that never answers still lets it go", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-hist-"));
  const { deleteRun, deleteRuns } = await import("../../herdr-app/mods/harbormaster/data.js");
  try {
    const order = [];
    globalThis.__herdrExec = async (cmd, args) => {
      if (cmd === "sleep") return slept(args);
      if (args[1] === HISTORY) { order.push(args[4]); const r = spawnSync(cmd, args, { encoding: "utf8" }); return { code: r.status, stdout: r.stdout, stderr: r.stderr }; }
      if (String(args[1]).includes("not a run directory")) { order.push("delete"); return { code: 0, stdout: "", stderr: "" }; }
      return { code: 0, stdout: JSON.stringify(timing), stderr: "" };
    };
    const run = { ...mkRun(root, "d1"), branch: "d1" };
    await deleteRun(run);
    assert.deepEqual(order, ["check", "append", "delete"]);
    assert.equal(lines(root).length, 1);
    // Never answers: the delete goes ahead after the wait, and a second delete does not wait again.
    tune.deleteWait = 30;
    globalThis.__herdrExec = async (cmd, args) => {
      if (cmd === "sleep") return slept(args);
      if (args[1] === HISTORY) return new Promise(() => {});
      if (String(args[1]).includes("not a run directory")) { order.push("delete2"); return { code: 0, stdout: "", stderr: "" }; }
      return { code: 0, stdout: "", stderr: "" };
    };
    const r2 = mkRun(root, "d2"), r3 = mkRun(root, "d3");
    const t0 = Date.now();
    const failed = await deleteRuns([r2, r3]);
    assert.deepEqual(failed, []);
    assert.equal(order.filter((x) => x === "delete2").length, 2);
    assert.ok(Date.now() - t0 < 1000);
  } finally { tune.deleteWait = 90000; rmSync(root, { recursive: true, force: true }); }
});

test("buildLine counts a command's terminal for its agent, and a terminal timing does not know as its own row", () => {
  const res = { agents: {
    ...resources.agents,
    // Started by impl-rss-t1 with hc run.
    "impl-rss-t1-tests": { parent: "impl-rss-t1", cpu_s: 7, peak_rss_mb: 700, avg_rss_mb: 50 },
    // An agent no session was read for (a grunt), with a command of its own.
    "grunt-rss-t2": { parent: "orc-x", cpu_s: 3, peak_rss_mb: 100, avg_rss_mb: 80 },
    "grunt-rss-t2-ci": { parent: "grunt-rss-t2", cpu_s: 2, peak_rss_mb: 20, avg_rss_mb: 10 },
  } };
  const l = buildLine({ dir: "/x/a/b", key: "k", prefix: "rss" }, timing, res, null, 1);
  const by = Object.fromEntries(l.agents.map((a) => [a.name, a]));
  assert.equal(by["impl-rss-t1"].cpu_s, 67);
  assert.equal(by["impl-rss-t1"].peak_rss_mb, 700);
  assert.equal(by.orchestrator.cpu_s, 40);
  assert.deepEqual([by["grunt-rss-t2"].role, by["grunt-rss-t2"].task, by["grunt-rss-t2"].cpu_s], ["grunt", "t2", 5]);
  assert.deepEqual(l.tasks.map((t) => [t.id, t.cpu_s]), [["t1", 67], ["t9", null], ["t2", 5]]);
  // Every terminal's CPU is in some agent.
  assert.equal(l.agents.reduce((s, a) => s + (a.cpu_s ?? 0), 0), 40 + 60 + 7 + 3 + 2);
});
