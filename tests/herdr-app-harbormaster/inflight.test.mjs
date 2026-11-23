// Harbormaster's repeating spawns never pile up: one body per copy and kind at a time (issue 70;
// Herdr refuses cx.spawn at 1024 outstanding host tasks). Time is faked through tune.now.
// Run: node --import ./loader.mjs --test inflight.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startOnce, inflightCounts, resetInflight, tune, LIMITS, MAX_HUNG } from "../../herdr-app/mods/harbormaster/inflight.js";
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
  assert.deepEqual(Object.values(inflightCounts())[0], { started: 3, ended: 3, inflight: 0 });
});

test("keys are separate; the warning logs at the threshold and each doubling", () => {
  const cx = fakeCx(), owner = {};
  tune.warnAt = 4;
  for (let i = 0; i < 8; i++) startOnce(owner, "copy", (b) => cx.spawn(b), never, { key: `f${i}`, tag: "cards" });
  assert.equal(Object.values(inflightCounts())[0].inflight, 8);
  assert.equal(logs.filter((l) => /tasks in flight/.test(l)).length, 2); // at 4 and 8
});

test("Harbormaster.refresh with an exec that never answers starts one body over many ticks", async () => {
  globalThis.__herdrExec = never;
  const cx = fakeCx();
  const view = Object.create(Harbormaster.prototype);
  Object.assign(view, { runs: [], decisions: [], errors: [], busy: {}, contexts: {} });
  for (let i = 0; i < 5; i++) view.refresh(cx);
  assert.equal(cx.bodies.length, 1);
  assert.equal(Object.values(inflightCounts())[0].inflight, 1);
  clock += LIMITS.refresh + 1;
  view.refresh(cx);
  assert.equal(cx.bodies.length, 2);
  assert.equal(Object.values(inflightCounts())[0].started, 2);
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
