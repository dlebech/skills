// The calm sidebar's pure rules (crew.js, props needs: "box"): the captain link's mark, the
// Needs-you rows under the box, a compact row's second line, the box's one button and the Next for
// you rows' PR names.
// Run: node --import ./loader.mjs --test calmcrew.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { captainMark, SHELLS_ONLY, needsSlots, subtitleOf, prRef } from "../../herdr-app/mods/harbormaster/crewrows.js";
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

test("Needs you shows the first four in list order, the rest behind + n more until unfolded; the open one keeps its place", () => {
  const list = ["a", "b", "c", "d", "e", "f"];
  const ids = (r) => r.slots.map((s) => s.x + (s.box ? "*" : ""));
  assert.deepEqual(ids(needsSlots(list, "a")), ["a*", "b", "c", "d"]);
  assert.equal(needsSlots(list, "a").extra, 2);
  // Opening another one moves nothing: same order, only the box moves.
  assert.deepEqual(ids(needsSlots(list, "c")), ["a", "b", "c*", "d"]);
  assert.deepEqual(ids(needsSlots(list, "f")), ["a", "b", "c", "d", "f*"], "an open entry past the limit stays in its place");
  assert.equal(needsSlots(list, "f").extra, 1, "the open entry past the limit is not counted as hidden");
  assert.equal(needsSlots(list, "e").extra, 1);
  assert.deepEqual(ids(needsSlots(list, "a", { open: true })), ["a*", "b", "c", "d", "e", "f"]);
  assert.deepEqual(ids(needsSlots(["a", "b"], "a")), ["a*", "b"]);
  // No entry can be drawn open (no run directory): every one is a row.
  assert.deepEqual(ids(needsSlots(["x", "y"], null)), ["x", "y"]);
});

test("a compact row's second line is the run's progress note, else its plan status, on one line", () => {
  assert.equal(subtitleOf("t2 implementing", "running"), "t2 implementing");
  assert.equal(subtitleOf(null, "  waiting\n for  user "), "waiting for user");
  assert.equal(subtitleOf("", null), null);
  assert.equal(subtitleOf(undefined, undefined), null);
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
  assert.equal(prRef("acme/skills", 52), "skills#52");
  assert.equal(prRef("app", 7), "app#7");
});

test("a merge ask is an approved PR, a proof to read before merging or a run ready to merge; its unfolded box shows the claims", () => {
  assert.equal(isMergeAsk([item("red-ci", []), item("approved — merge", [])]), true);
  assert.equal(isMergeAsk([{ ...item("review proof → merge", []), ready: true }]), true);
  // Reading the proof before the merge is a merge ask too: that is where the claims matter.
  assert.equal(isMergeAsk([item("review proof → merge", []), item("red-ci", [])]), true);
  // A red CI or a question alone: not a merge ask.
  assert.equal(isMergeAsk([item("red-ci", []), item("question", [])]), false);
  assert.equal(isMergeAsk([]), false);
  assert.equal(isMergeAsk(null), false);
});

test("a review run's title is repo#number · topic, from its related PR", async () => {
  const { reviewTitle } = await import("../../herdr-app/mods/harbormaster/crewrows.js");
  const rel = [{ url: "https://github.com/o/api/pull/52" }];
  assert.equal(reviewTitle("rev", rel, "Triage"), "api#52 · Triage");
  assert.equal(reviewTitle("feat", rel, "Triage"), null);
  assert.equal(reviewTitle("rev", [], "Triage"), null);
  assert.equal(reviewTitle("rev", rel, ""), null);
});

test("rows with the same title get their repository's name; a review's own title never does", async () => {
  const { repoPrefixes } = await import("../../herdr-app/mods/harbormaster/crewrows.js");
  const p = repoPrefixes([
    { key: "a", title: "Login", repo: "api" }, { key: "b", title: "Login", repo: "web" },
    { key: "c", title: "Other", repo: "api" },
    { key: "d", title: "api#1 · X", repo: "api" }, { key: "e", title: "api#1 · X", repo: "api" },
    { key: "f", title: "Same", repo: null }, { key: "g", title: "Same", repo: null },
  ]);
  assert.deepEqual([...p], [["a", "api"], ["b", "web"]]);
});

test("Next for you drops a review request a live run is reviewing, keeps one only starting", async () => {
  const { notReviewing } = await import("../../herdr-app/mods/harbormaster/mypr.js");
  const items = [{ kind: "review", url: "a", run: "/runs/x" }, { kind: "review", url: "b", run: null }, { kind: "mine", url: "c", run: null }];
  assert.deepEqual(notReviewing(items).map((i) => i.url), ["b", "c"]);
});

test("the Needs-you card shows selection by its outline, tint and bar", async () => {
  const { needCardLook, HOVER_TINT } = await import("../../herdr-app/mods/harbormaster/crewrows.js");
  assert.deepEqual(needCardLook(true), { tint: "3d", border: "", bar: 5 });
  assert.deepEqual(needCardLook(false), { tint: "22", border: "00", bar: 3 });
  assert.equal(HOVER_TINT, "2e");
});
