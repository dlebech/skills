import { test } from "node:test";
import assert from "node:assert/strict";
import { sleptThrough, awakeSince, machineWoke, SLEEP_GAP_MS } from "../../herdr-app/mods/harbormaster/sleep.js";
import { stalled, STALL_MS } from "../../herdr-app/mods/harbormaster/attention.js";

const MIN = 60000;
const run = { phase: "running" };

test("a sleep is wall time that the monotonic clock did not see; slow reads are not", () => {
  const at = (wall, mono) => ({ wall, mono });
  assert.equal(sleptThrough(at(1000, 10), at(1000 + 5 * MIN, 10 + 5 * MIN)), null); // 5 quiet minutes awake
  assert.equal(sleptThrough(at(1000, 10), at(1000 + 180 * MIN, 10 + 2000)), 1000 + 180 * MIN);
  assert.equal(sleptThrough(null, at(5, 5)), null);
  assert.equal(sleptThrough(at(1, null), at(1e9, null)), null);
  assert.equal(machineWoke(null, 1e9), null);
  assert.equal(machineWoke(0, SLEEP_GAP_MS), null);
  assert.equal(machineWoke(0, SLEEP_GAP_MS + 1), SLEEP_GAP_MS + 1);
});
test("a run working before a 3h sleep is not quiet on waking", () => {
  const last = 1000, wake = 3 * 60 * MIN, now = wake + MIN;
  assert.equal(stalled(run, { now, lastActivity: last }).by, "quiet"); // without the fix
  assert.equal(stalled(run, { now, lastActivity: awakeSince(last, wake) }), false);
});
test("30 minutes awake after the wake still stalls", () => {
  const wake = 180 * MIN;
  const s = stalled(run, { now: wake + STALL_MS, lastActivity: awakeSince(1000, wake) });
  assert.equal(s.by, "quiet");
  assert.equal(s.quietMs, STALL_MS);
  assert.equal(stalled(run, { now: wake + STALL_MS - 1, lastActivity: awakeSince(1000, wake) }), false);
});
test("activity after the wake wins, and null stays null", () => {
  assert.equal(awakeSince(500, 100), 500);
  assert.equal(awakeSince(10, 400 * MIN), 400 * MIN);
  assert.equal(awakeSince(null, 400 * MIN), null);
});
