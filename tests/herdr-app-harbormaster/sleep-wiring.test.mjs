// observeRuns / lastActivity with the clocks stubbed: sleeps, slow polls, closed views, another machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { observeRuns, lastActivity } from "../../herdr-app/mods/harbormaster/tracking.js";
import { stalled, STALL_MS } from "../../herdr-app/mods/harbormaster/attention.js";

const MIN = 60000;
// wall: Date.now; mono: performance.now, which stands still while asleep.
let wall = 1e12, mono = 5000;
Date.now = () => wall;
Object.defineProperty(globalThis, "performance", { value: { now: () => mono }, configurable: true });
const awake = (ms) => { wall += ms; mono += ms; };
const sleep = (ms) => { wall += ms; };
const ctx = { terminals: [], agents: [] };
const local = { key: "a", terminal: "t1", phase: "running" };
const remote = { key: "m:b", terminal: "m/t2", machine: "m", phase: "running" };
const poll = (runs, answered) => observeRuns(runs, ctx, new Set(answered));
const quiet = (r) => stalled(r, { now: Date.now(), lastActivity: lastActivity(r) });

poll([local], [""]); // first poll at "start"

test("A: after a 3h sleep it is not quiet, before or after the first poll", () => {
  awake(10 * MIN); poll([local], [""]);
  sleep(180 * MIN);
  assert.equal(quiet(local), false, "before the first poll finishes");
  poll([local], [""]);
  assert.equal(quiet(local), false, "after it");
});
test("a real stall still shows after 30 minutes awake past the wake", () => {
  awake(STALL_MS - 1 * MIN); poll([local], [""]);
  assert.equal(quiet(local), false);
  awake(2 * MIN); poll([local], [""]);
  assert.equal(quiet(local).by, "quiet");
});
test("B/C: slow polls or a closed view hide no stall", () => {
  const r = { key: "c", terminal: "t3", phase: "running" };
  poll([r], [""]);
  awake(28 * MIN); // view closed: no polls
  poll([r], [""]);
  awake(3 * MIN); // a slow read
  poll([r], [""]);
  assert.equal(quiet(r).by, "quiet");
  for (let i = 0; i < 40; i++) { awake(3 * MIN); poll([r], [""]); }
  assert.equal(quiet(r).by, "quiet");
});
test("remote machine that went unseen for hours gets a fresh window when it answers", () => {
  poll([remote], ["", "m"]);
  awake(5 * MIN);
  const stale = { ...remote, stale: true };
  poll([stale], [""]); // m did not answer
  awake(180 * MIN); poll([stale], [""]);
  awake(MIN);
  poll([remote], ["", "m"]); // m is back
  assert.equal(quiet(remote), false);
  awake(STALL_MS + MIN);
  assert.equal(quiet(remote).by, "quiet");
});
test("a machine missed for one poll only is not a wake", () => {
  const r = { key: "m:d", terminal: "m/t4", machine: "m", phase: "running" };
  poll([r], ["", "m"]);
  awake(25 * MIN);
  poll([{ ...r, stale: true }], [""]);
  awake(10 * 1000);
  poll([r], ["", "m"]);
  awake(6 * MIN);
  assert.equal(quiet(r).by, "quiet");
});
