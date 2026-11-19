// The closed runs' bulk Delete, as Herdr runs it: Herdr's shell has no setTimeout or clearTimeout
// (calling either throws), and the history wait before a delete used both, so every delete failed
// at once and the error showed 40 cards below the header (proof t1). Real run directories in a
// throwaway root; sh runs for real against it, `sleep` waits as the program would.
// Run: node --import ./loader.mjs --test closed-delete.test.mjs
import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as nodeTimeout } from "node:timers/promises";
import { resetShared } from "herdr";
import { find } from "gpui-kit";
import { loadRuns, cachedRuns, deleteRun, deleteRuns } from "../../herdr-app/mods/harbormaster/data.js";
import { tune, writeHistoryBeforeDelete } from "../../herdr-app/mods/harbormaster/history.js";
import Harbormaster from "../../herdr-app/mods/harbormaster/main.js";

const text = (e) => (e && typeof e === "object" && "kids" in e ? e.kids.map(text).join("") : typeof e === "string" ? e : "");
let root;

// sh for real with the throwaway root; sleep as a wait; timing.sh's read answers nothing.
function withExec(fail = null) {
  globalThis.__herdrExec = async (cmd, args) => {
    if (cmd === "sleep") { await nodeTimeout(Number(args[0]) * 1000); return { code: 0, stdout: "", stderr: "" }; }
    if (cmd !== "sh") return { code: 1, stdout: "", stderr: "not in this test" };
    if (fail && String(args[1]).includes("not a run directory")) return { code: 3, stdout: "", stderr: fail };
    const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, HERDR_ORCHESTRATION_ROOT: root } });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
}

// A run closed `i` days ago, its orchestrator long gone.
function closedRun(i) {
  const branch = `old-${i}`, dir = join(root, "api", branch);
  mkdirSync(dir, { recursive: true });
  const at = new Date(Date.now() - i * 86400000).toISOString();
  writeFileSync(join(dir, "orchestrator.json"), JSON.stringify({ branch, terminal: `t${i}`, folder: join(root, "work"), started: at }));
  writeFileSync(join(dir, "status.json"), JSON.stringify({ status: "finished", type: "feat", updated: at }));
  writeFileSync(join(dir, "plan.md"), `Status: finished\nPrefix: o${i}\n\n### t1 thing — merged\n`);
  writeFileSync(join(dir, "closed"), `${at}\tfinished\n`);
  return dir;
}

// Herdr's shell: the timer globals are there and throw.
const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const herdrTimers = () => {
  globalThis.setTimeout = () => { throw new Error("`setTimeout` is not available in the shell: use cx.timer.after"); };
  globalThis.clearTimeout = () => { throw new Error("`clearTimeout` is not available in the shell: cancel the handle returned by cx.timer.after"); };
};

before(() => { tune.deleteWait = 200; });
after(() => { tune.deleteWait = 90000; });
// Each test reads its own root: a cached read from the last one (a failed delete leaves it) is dropped.
beforeEach(() => { resetShared(); cachedRuns().at = 0; root = mkdtempSync(join(tmpdir(), "hm-cdel-")); mkdirSync(join(root, "work")); });
afterEach(() => { Object.assign(globalThis, real); rmSync(root, { recursive: true, force: true }); });

test("without setTimeout, as in Herdr, a bulk delete and a card's Delete both take the runs", async () => {
  const dirs = Array.from({ length: 41 }, (_, i) => closedRun(i + 1));
  withExec();
  const { runs } = await loadRuns();
  herdrTimers();
  const failed = await deleteRuns(runs.slice(1));
  assert.deepEqual(failed.map((f) => f.error), []);
  await deleteRun(runs[0]);
  for (const d of dirs) assert.equal(existsSync(d), false, `${d} deleted`);
});

// Counts the waits: exec sleeps, and a spawn cx's timer (Herdr's: no setTimeout), each after and cancel.
function counting() {
  const sh = globalThis.__herdrExec;
  const n = { sleeps: 0, afters: 0, cancels: 0, fired: 0 };
  globalThis.__herdrExec = async (cmd, args, o) => { if (cmd === "sleep") n.sleeps++; return sh(cmd, args, o); };
  const cx = { timer: { after(ms, handler) {
    n.afters++;
    let live = true;
    nodeTimeout(ms).then(() => { if (live) { n.fired++; handler(cx); } });
    return { cancel() { live = false; n.cancels++; } };
  } } };
  return { n, cx };
}

test("history writes that fail fast: one wait for the batch, none again per run", async () => {
  const dirs = [closedRun(1), closedRun(2), closedRun(3)];
  withExec();
  const { runs } = await loadRuns();
  const sh = globalThis.__herdrExec;
  globalThis.__herdrExec = async (cmd, args, o) => (cmd === "sh" && String(args[1]).includes(".history.jsonl")
    ? { code: 1, stdout: "", stderr: "locked" } : sh(cmd, args, o));
  const { n } = counting();
  herdrTimers();
  assert.deepEqual(await deleteRuns(runs), []);
  assert.equal(n.sleeps, 1);
  for (const d of dirs) assert.equal(existsSync(d), false);
});

test("with the spawn's cx, the wait is its timer, cancelled once the writes are done: no sleep process", async () => {
  const dirs = [closedRun(1), closedRun(2), closedRun(3)];
  withExec();
  const { runs } = await loadRuns();
  const { n, cx } = counting();
  herdrTimers();
  assert.deepEqual(await deleteRuns(runs.slice(1), { cx }), []);
  assert.deepEqual(n, { sleeps: 0, afters: 1, cancels: 1, fired: 0 });
  await deleteRun(runs[0], { cx });
  assert.deepEqual(n, { sleeps: 0, afters: 2, cancels: 2, fired: 0 }, "a card's Delete: its own timer, cancelled");
  for (const d of dirs) assert.equal(existsSync(d), false);
});

test("runs whose history is already written are deleted without any wait", async () => {
  const dirs = [closedRun(1), closedRun(2)];
  withExec();
  const { runs } = await loadRuns();
  for (const r of runs) assert.equal(await writeHistoryBeforeDelete(r), true);
  const { n, cx } = counting();
  herdrTimers();
  assert.deepEqual(await deleteRuns(runs, { cx }), []);
  assert.deepEqual(n, { sleeps: 0, afters: 0, cancels: 0, fired: 0 });
  for (const d of dirs) assert.equal(existsSync(d), false);
});

// The overview as main.js draws it, Closed unfolded; cx.spawn runs its body as Herdr would.
function overview(runs) {
  const hm = new Harbormaster();
  const tasks = [];
  const cx = { notify() {}, stop_propagation() {}, spawn(body) { tasks.push(body(cx)); } };
  Object.assign(hm, { runs, errors: [], decisions: [], folds: new Map(), busy: {}, size: { width: 600 }, showDone: true, load: async () => {} });
  return { hm, cx, tasks, draw: () => hm.render(cx) };
}

test("Delete N: the confirm goes and Deleting N shows at once; a failure shows by the header", async () => {
  for (let i = 1; i <= 3; i++) closedRun(i);
  withExec();
  const { runs } = await loadRuns();
  withExec("its worktrees are still there");
  herdrTimers();
  const v = overview(runs);
  find(v.draw(), "bulk-all").click({}, v.cx);
  find(v.draw(), "bulk-yes").click({}, v.cx);
  const busy = v.draw();
  assert.equal(find(busy, "bulk-yes"), null, "the confirm is gone");
  assert.match(text(busy), /Deleting 3 closed runs…/);
  await Promise.all(v.tasks);
  const el = v.draw();
  const err = find(el, "bulk-error");
  assert.ok(err, "the failure is shown");
  assert.match(text(err), /^3 not deleted: its worktrees are still there \(old-\d, old-\d, old-\d\)/);
  // By the header, not with the notes at the list's bottom.
  const head = (e, path = []) => (e?.kids?.includes(err) ? e : e?.kids?.map((k) => head(k)).find(Boolean) ?? null);
  assert.ok(find(head(el), "finished-toggle"), "next to the closed runs' header");
  assert.equal(v.hm.actionError ?? null, null);
  find(el, "bulk-error-x").click({}, v.cx);
  assert.equal(find(v.draw(), "bulk-error"), null, "dismissed");
});

// Last: its write never ends, so it holds the history queue for the tests after it.
test("a history write that never answers still lets the delete go after the wait, once for the batch", async () => {
  const dirs = [closedRun(1), closedRun(2), closedRun(3)];
  withExec();
  const { runs } = await loadRuns();
  const sh = globalThis.__herdrExec;
  let sleeps = 0;
  globalThis.__herdrExec = async (cmd, args, o) => {
    if (cmd === "sleep") sleeps++;
    if (cmd === "sh" && String(args[1]).includes(".history.jsonl")) return new Promise(() => {});
    return sh(cmd, args, o);
  };
  herdrTimers();
  const t0 = Date.now();
  assert.deepEqual(await deleteRuns(runs), []);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(sleeps, 1, "one wait for the whole batch");
  for (const d of dirs) assert.equal(existsSync(d), false);
});
