// The start date in a run's Crew card tooltip (context.js startedTip) and its age line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startedTip } from "../../herdr-app/mods/harbormaster/context.js";

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
const now = at(2026, 11, 16, 15, 30);

test("the tooltip has the full date and time", () => {
  assert.equal(startedTip(at(2026, 11, 14, 18, 20)), "Started 14 Nov 2026, 18:20");
});
test("no start shows nothing", () => {
  assert.equal(startedTip(null), "");
});

import { runAgeText, spanText } from "../../herdr-app/mods/harbormaster/context.js";

test("spans read in minutes, hours or days", () => {
  assert.equal(spanText(45 * 60000), "45m");
  assert.equal(spanText((8 * 60 + 12) * 60000), "8h 12m");
  assert.equal(spanText((51 * 60) * 60000), "2d 3h");
});
test("a running run says how long it has been running", () => {
  assert.equal(runAgeText({ started: at(2026, 11, 16, 9, 28), phase: "running" }, now), "Started today 09:28 · running for 6h 2m");
});
test("a finished run says how long it took, to its last update", () => {
  assert.equal(runAgeText({ started: at(2026, 11, 14, 18, 20), phase: "finished", updated: at(2026, 11, 15, 2, 0) }, now),
    "Started 14 Nov 18:20 · finished after 7h 40m");
});
test("a run put away unfinished says when it stopped", () => {
  assert.equal(runAgeText({ started: at(2026, 11, 16, 9, 0), phase: "running", away: { at: at(2026, 11, 16, 12, 5) } }, now),
    "Started today 09:00 · stopped after 3h 5m");
});
test("no start, no line", () => {
  assert.equal(runAgeText({ phase: "running" }, now), "");
});
