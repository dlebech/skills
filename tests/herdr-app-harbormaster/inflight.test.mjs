// Harbormaster's repeating spawns never pile up: one body per copy and kind at a time (issue 70;
// Herdr refuses cx.spawn at 1024 outstanding host tasks). Time is faked through tune.now.
// Run: node --import ./loader.mjs --test inflight.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startOnce, inflightCounts, inflightTotal, resetInflight, tune, LIMITS, MAX_HUNG, PRS_DEADLINE, commandLoop, TICK } from "../../herdr-app/mods/harbormaster/inflight.js";
import Harbormaster from "../../herdr-app/mods/harbormaster/main.js";

let clock, logs, realLog;
beforeEach(() => {
  resetInflight(); clock = 1000; tune.now = () => clock; logs = [];
  realLog = console.log; console.log = (...a) => logs.push(a.join(" "));
});
afterEach(() => { console.log = realLog; tune.now = () => Date.now(); tune.warnAt = 50; delete globalThis.__herdrExec; });

// A cx whose spawn runs the body at once and keeps the promise.
const fakeCx = () => { const cx = { bodies: [], notify() {}, spawn(b) { const p = b(cx); cx.bodies.push(p); return p; }, timer: { every() {} } }; return cx; };
const never = () => new Promise(() => {});

test("a body that never ends blocks a second one; after the limit a new one starts and the old one's late end keeps the new mark", async () => {
  const cx = fakeCx(), owner = {};
  let release; const slow = () => new Promise((r) => { release = r; });
  assert.equal(startOnce(owner, "refresh", (b) => cx.spawn(b), slow), true);
  const first = release;
  assert.equal(startOnce(owner, "refresh", (b) => cx.spawn(b), slow), false);
  clock += LIMITS.refresh - 1;
  assert.equal(startOnce(owner, "refresh", (b) => cx.spawn(b), slow), false);
  clock += 2;
  assert.equal(startOnce(owner, "refresh", (b) => cx.spawn(b), slow), true);
  assert.equal(logs.filter((l) => /refresh hung/.test(l)).length, 1);
  assert.equal(Object.values(inflightCounts())[0].inflight, 2);
  first(); await cx.bodies[0]; // the abandoned body ends late
  assert.equal(Object.values(inflightCounts())[0].inflight, 1);
  assert.equal(startOnce(owner, "refresh", (b) => cx.spawn(b), slow), false, "the new body is still marked");
  release(); await cx.bodies[1];
  assert.equal(startOnce(owner, "refresh", (b) => cx.spawn(b), async () => {}), true);
  await cx.bodies[2];
  assert.deepEqual(inflightCounts(), {}, "a label goes once nothing of it is in flight");
  assert.equal(inflightTotal(), 0);
  assert.equal(logs.filter((l) => /refresh given up after 120s ended after 120s/.test(l)).length, 1, "the late end says it was slow, not stuck");
});

test("keys are separate; the warning logs at the threshold and each doubling", () => {
  const cx = fakeCx(), owner = {};
  tune.warnAt = 4;
  for (let i = 0; i < 8; i++) startOnce(owner, "copy", (b) => cx.spawn(b), never, { key: `f${i}`, tag: "cards" });
  assert.equal(Object.values(inflightCounts())[0].inflight, 8);
  assert.equal(logs.filter((l) => /tasks in flight/.test(l)).length, 2); // at 4 and 8
});

// The in-flight count of one kind, whatever the copy's tag.
const inflightOf = (kind) => Object.entries(inflightCounts()).filter(([k]) => k.endsWith(`/${kind}`)).reduce((n, [, v]) => n + v.inflight, 0);
const view = (runs = []) => Object.assign(Object.create(Harbormaster.prototype), { runs, decisions: [], errors: [], busy: {}, contexts: {} });
const settle = () => new Promise((r) => setImmediate(r));

test("Harbormaster.refresh with an exec that never answers starts one body of each kind over many ticks", async () => {
  globalThis.__herdrExec = never;
  const cx = fakeCx(), v = view();
  for (let i = 0; i < 5; i++) v.refresh(cx);
  assert.equal(inflightOf("refresh"), 1);
  clock += LIMITS.refresh + 1;
  v.refresh(cx);
  assert.equal(inflightOf("refresh"), 2, "the hung body is given up and a new one starts");
});

let runNo = 0;
const prRun = () => { const n = ++runNo; return { key: `:/runs/inflight${n}`, machine: null, folder: `/repo${n}`, branch: "x", type: "feat", prs: [{ url: `https://github.com/o/r/pull/${n}`, repo: "o/r" }], related: [], filesSig: `sig${n}` }; };

test("a gh that never answers holds only the PR reads: the run read goes on every tick", async () => {
  globalThis.__herdrExec = (cmd) => (cmd === "gh" || cmd === "sh" ? never() : Promise.resolve({ code: 0, stdout: "", stderr: "" }));
  const cx = fakeCx(), run = prRun(), v = view([run]);
  let loads = 0;
  v.load = async () => { loads++; return v.runs; };
  for (let i = 0; i < 4; i++) { v.refresh(cx); await settle(); clock += 5000; }
  assert.equal(loads, 4, "load ran on each tick");
  assert.equal(inflightOf("prs"), 1, "one PR body, stuck in gh");
  assert.equal(inflightOf("refresh"), 0);
});

test("the PR reads stop starting runs after the deadline, and the next body goes on from there", async (t) => {
  const runs = [prRun(), prRun(), prRun(), prRun()];
  const touched = [];
  // Each read takes 25 s of the fake clock and fails (so nothing is cached as read).
  globalThis.__herdrExec = async (cmd, args) => {
    clock += 25000;
    const r = runs.find((x) => args.includes(x.prs[0].url) || args.includes(x.folder));
    if (r && !touched.includes(r.key)) touched.push(r.key);
    return { code: 1, stdout: "", stderr: "down" };
  };
  // refreshPrs caps its first reads per 5 s of Date.now: the fake clock drives it too.
  const realNow = Date.now; clock = realNow(); Date.now = () => clock;
  t.after(() => { Date.now = realNow; });
  const cx = fakeCx(), v = view(runs);
  v.load = async () => v.runs;
  v.refresh(cx);
  for (let i = 0; i < 20 && inflightOf("prs"); i++) await settle();
  assert.equal(inflightOf("prs"), 0);
  assert.ok(touched.length >= 1 && touched.length < runs.length, `stopped early: ${touched.length} of ${runs.length}`);
  assert.equal(v.prsFrom, runs[touched.length].key, "the next body starts where this one stopped");
  const first = touched.length;
  v.refresh(cx);
  for (let i = 0; i < 20 && inflightOf("prs"); i++) await settle();
  assert.equal(touched[first], runs[first].key, "the next body read the passed-over run first");
  assert.ok(PRS_DEADLINE + 2 * 120000 <= LIMITS.prs, "the PR body's limit is above its deadline plus a run's worst reads");
});

test("commandLoop keeps one pending command across liveness wakes, handles each once, and ends when alive throws", async () => {
  const cmds = [], handled = [];
  let nexts = 0, wakes = 0, dead = false, sleeper = null;
  const next = () => { nexts++; return new Promise((r) => cmds.push(r)); };
  const sleep = () => new Promise((r) => { sleeper = r; });
  const alive = () => { wakes++; if (dead) throw new Error("build replaced"); };
  const loop = commandLoop({ next, sleep, alive, handle: (c) => handled.push(c) });
  await settle();
  sleeper(); await settle(); // a liveness wake: no command, the same nextCommand stays pending
  sleeper(); await settle();
  assert.equal(nexts, 1);
  assert.deepEqual(handled, []);
  cmds[0]("show-crew"); await settle();
  assert.deepEqual(handled, ["show-crew"]);
  assert.equal(nexts, 2, "a new nextCommand only once the last one was handled");
  sleeper(); await settle();
  assert.deepEqual(handled, ["show-crew"], "no command is handled twice");
  dead = true;
  sleeper();
  await assert.rejects(loop, /build replaced/, "a replaced build's loop ends at the next wake, without a command");
  assert.equal(nexts, 2);
  assert.ok(wakes >= 4);
  assert.equal(typeof TICK, "symbol");
});

test("commandLoop never handles a command that arrives after its build died", async () => {
  const handled = [];
  let give;
  const loop = commandLoop({ next: () => new Promise((r) => { give = r; }), sleep: () => new Promise(() => {}), alive: () => { throw new Error("closed"); }, handle: (c) => handled.push(c) });
  give("new-run");
  await assert.rejects(loop, /closed/);
  assert.deepEqual(handled, []);
});

test("a body that never ends leaves at most MAX_HUNG given up plus one, over many limits", () => {
  const cx = fakeCx(), owner = {};
  let started = 0;
  for (let i = 0; i < 6; i++) { if (startOnce(owner, "refresh", (b) => cx.spawn(b), never)) started++; clock += LIMITS.refresh + 1; }
  assert.equal(started, MAX_HUNG + 1);
  assert.equal(Object.values(inflightCounts())[0].inflight, MAX_HUNG + 1);
  assert.equal(logs.filter((l) => /starting no more/.test(l)).length, 1);
});

test("the in-flight warning needs the total to fall below half the threshold before it repeats", () => {
  const cx = fakeCx(), owner = {};
  tune.warnAt = 4;
  const ends = [];
  for (let i = 0; i < 4; i++) startOnce(owner, "copy", (b) => cx.spawn(b), () => new Promise((r) => ends.push(r)), { key: `f${i}`, tag: "t" });
  const n = () => logs.filter((l) => /tasks in flight/.test(l)).length;
  assert.equal(n(), 1);
  ends[0](); // 3 in flight: still above half, then back to 4
  return Promise.all(cx.bodies.slice(0, 1)).then(() => {
    startOnce(owner, "copy", (b) => cx.spawn(b), never, { key: "again", tag: "t" });
    assert.equal(n(), 1);
  });
});
