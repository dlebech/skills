// The calm sidebar's pure rules (crew.js, props needs: "box"): the captain link's mark, the
// Needs-you rows under the box, a compact row's progress, the box's one button and the Next for
// you rows' PR names.
// Run: node --import ./loader.mjs --test calmcrew.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { captainMark, SHELLS_ONLY, needsRest, progressOf, prRef } from "../../herdr-app/mods/harbormaster/crewrows.js";
import { primaryOf, isMergeAsk } from "../../herdr-app/mods/harbormaster/needaction.js";

test("the captain watches while idle with its watcher, or working only on background shells", () => {
  assert.equal(captainMark({ status: "idle", watching: true }), "watching");
  assert.equal(captainMark({ status: "working", msg: "1 shell still running", watching: false }), "watching");
  assert.equal(captainMark({ status: "working", msg: "3 shells still running", watching: true }), "watching");
  assert.equal(captainMark({ status: "done", watching: true }), "watching");
});

test("the spinner only while it really replies; a prompt is blocked; idle without a watcher", () => {
  assert.equal(captainMark({ status: "working", msg: null, watching: true }), "working");
  assert.equal(captainMark({ status: "working", msg: "Reading files", watching: true }), "working");
  assert.equal(captainMark({ status: "blocked", msg: "1 shell still running", watching: true }), "blocked");
  assert.equal(captainMark({ status: "idle", watching: false }), "idle");
  assert.equal(captainMark(), "idle");
});

test("only a whole shells-still-running message counts", () => {
  assert.ok(SHELLS_ONLY.test("1 shell still running"));
  assert.ok(SHELLS_ONLY.test("12 background shells still running"));
  assert.ok(!SHELLS_ONLY.test("Running tests; 1 shell still running"));
  assert.ok(!SHELLS_ONLY.test(""));
});

test("under the box, at most three rows, the rest behind + n more until unfolded", () => {
  const list = ["a", "b", "c", "d", "e", "f"];
  assert.deepEqual(needsRest(list, "a"), { shown: ["b", "c", "d"], extra: 2 });
  assert.deepEqual(needsRest(list, "a", { open: true }), { shown: ["b", "c", "d", "e", "f"], extra: 2 });
  assert.deepEqual(needsRest(["a", "b"], "a"), { shown: ["b"], extra: 0 });
  // No entry can be drawn open (no run directory): every one is a row.
  assert.deepEqual(needsRest(["x", "y"], null), { shown: ["x", "y"], extra: 0 });
});

test("a compact row's progress is done of planned, with the bar's fill; none while nothing is planned", () => {
  assert.deepEqual(progressOf({ done: 1, planned: 4 }), { text: "1/4", frac: 0.25 });
  assert.deepEqual(progressOf({ done: 5, planned: 4 }), { text: "4/4", frac: 1 });
  assert.equal(progressOf({ done: 0, planned: 0 }), null);
  assert.equal(progressOf(null), null);
});

const item = (key, actions) => ({ key, line: key, actions });
test("the box's one button: the most urgent item's primary action, else its first", () => {
  // Red CI first: its failing check, though a later merge says it is primary.
  const items = [
    item("red-ci", [{ kind: "open", label: "Open the failing check" }, { kind: "ask-ci", label: "Ask the orchestrator" }]),
    item("review proof → merge", [{ kind: "open", label: "Merge #1 on GitHub", primary: true }]),
  ];
  assert.deepEqual(primaryOf(items), { i: 0, j: 0 });
  // Ready to merge: Merge, not Proof.
  assert.deepEqual(primaryOf([item("ready", [{ kind: "proof", label: "Proof", primary: false }, { kind: "open", label: "Merge", primary: true }])]), { i: 0, j: 1 });
  // At L2, Handle them is the default over Ask me.
  assert.deepEqual(primaryOf([item("approved — merge", [{ kind: "address", mode: "ask", primary: false }, { kind: "address", mode: "handle", primary: true }])]), { i: 0, j: 1 });
  // An "asked…" note is no button: the next item's.
  assert.deepEqual(primaryOf([item("changes requested", [{ kind: "asked", label: "asked…" }]), item("finished", [{ kind: "close", label: "Close" }])]), { i: 1, j: 0 });
  assert.equal(primaryOf([item("other", [])]), null);
  assert.equal(primaryOf([]), null);
});

test("a Next for you row names its PR by repository name and number", () => {
  assert.equal(prRef("dlebech/skills", 52), "skills#52");
  assert.equal(prRef("app", 7), "app#7");
});

test("a merge ask is an approved PR or a run ready to merge; its unfolded box shows the claims", () => {
  assert.equal(isMergeAsk([item("red-ci", []), item("approved — merge", [])]), true);
  assert.equal(isMergeAsk([{ ...item("review proof → merge", []), ready: true }]), true);
  // Reading the proof first, a red CI or a question: not a merge ask yet.
  assert.equal(isMergeAsk([item("review proof → merge", []), item("red-ci", [])]), false);
  assert.equal(isMergeAsk([]), false);
  assert.equal(isMergeAsk(null), false);
});
