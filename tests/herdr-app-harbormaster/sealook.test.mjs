// The sea's pure helpers (sealook.js), and guards that it stays calm: no redraw timer, no forced theme.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buoyLook, stillLook, idle, captainText, boatBadge, railCounts, opensPopup, motionOf } from "../../herdr-app/mods/harbormaster/sealook.js";

const mod = (f) => readFileSync(new URL(`../../herdr-app/mods/harbormaster/${f}`, import.meta.url), "utf8");

test("a buoy looks by its stage state", () => {
  const L = (fill, ring, pulse = false, halo = false) => ({ fill, ring, pulse, halo });
  assert.deepEqual(buoyLook("done"), L("pass", null));
  assert.deepEqual(buoyLook("current"), L(null, "foreground"));
  assert.deepEqual(buoyLook("you", true), L("blocked", null, true));
  assert.deepEqual(buoyLook("you", false), L("blocked", null, false, true));
  assert.deepEqual(buoyLook("look"), L("amber", null));
  assert.deepEqual(buoyLook("fail", true), L("blocked", null));
  assert.deepEqual(buoyLook("todo"), L(null, "dim"));
});

test("a blocked creature is raised with a badge when still", () => {
  assert.deepEqual(stillLook("blocked"), { raise: 4, badge: true });
  assert.deepEqual(stillLook("working"), { raise: 0, badge: false });
});

test("idle starts a loop only with motion on", () => {
  const calls = [];
  const el = { id(x) { calls.push(["id", x]); return this; }, loop(...a) { calls.push(["loop", ...a]); return this; } };
  assert.equal(idle(el, "a", { prop: "top", to: -3, period: 1500 }, false), el);
  assert.equal(idle(el, "a", null, true), el);
  assert.deepEqual(calls, []);
  idle(el, "a", { prop: "opacity", from: 0.5, to: 1, period: 1300 }, true);
  assert.deepEqual(calls, [["id", "a"], ["loop", "opacity", { from: 0.5, to: 1, period: 1300 }]]);
});

test("the captain's state is plain words", () => {
  assert.equal(captainText({ present: false }), "No captain is running");
  assert.equal(captainText({ present: true, watching: false }), "Captain: not watching");
  assert.equal(captainText({ present: true, watching: true, working: true }), "Captain: working");
  assert.equal(captainText({ present: true, watching: true, working: false }), "Captain: watching");
});

test("the boat's badge counts decisions and runs and lists them", () => {
  assert.deepEqual(boatBadge({ decisions: 2, runNames: ["a", "b"] }), { count: 4, tip: "2 decisions\na\nb" });
  assert.deepEqual(boatBadge({ decisions: 1, runNames: [] }), { count: 1, tip: "1 decision" });
  assert.equal(boatBadge({ decisions: 0, runNames: [] }).count, 0);
});

test("the rail's counts", () => {
  assert.deepEqual(railCounts({ runs: 1, needs: 0, prs: 1 }), [{ text: "1 run", tone: null }, { text: "0 need you", tone: null }, { text: "1 PR open", tone: null }]);
  assert.deepEqual(railCounts({ runs: 3, needs: 2, prs: 0 }).map((c) => [c.text, c.tone]), [["3 runs", null], ["2 need you", "blocked"], ["0 PRs open", null]]);
  assert.equal(railCounts({ runs: 1, needs: 1, prs: 0 })[1].text, "1 needs you");
});

test("which need buttons open the run's pane", () => {
  for (const k of ["request-review", "changes", "close", "resume"]) assert.equal(opensPopup(k), true, k);
  for (const k of ["open", "address", "focus", "proof", "ask-ci"]) assert.equal(opensPopup(k), false, k);
});

test("creature motion is native and only when working or blocked", () => {
  assert.deepEqual(motionOf("octopus", "working"), { prop: "top", to: -3, period: 1500 });
  assert.deepEqual(motionOf("crab", "working"), { prop: "left", to: 5, period: 900 });
  assert.deepEqual(motionOf("crab", "blocked"), { prop: "top", to: -5, period: 700 });
  assert.equal(motionOf("crab", "done"), null);
  assert.equal(motionOf("octopus", "idle"), null);
});

test("the sea has no redraw timer and reads no step", () => {
  const h = mod("harbor.js"), m = mod("main.js");
  assert.doesNotMatch(h, /view\.step|this\.step|timer\.every|setInterval|setTimeout/);
  assert.doesNotMatch(m, /this\.step|view\.step/);
  assert.doesNotMatch(m, /role === "harbor"\)\s*cx\.timer/);
  // every loop goes through idle(): harbor.js never calls .loop( itself
  assert.doesNotMatch(h, /\.loop\(/);
});

test("the sea layout keeps the user's theme", () => {
  const l = JSON.parse(readFileSync(new URL("../../herdr-app/layouts/harbormaster-sea.json", import.meta.url), "utf8"));
  assert.equal(l.id, "hs-root");
  for (const k of ["theme", "colors", "background", "font_size", "ui_font"]) assert.equal(k in l, false, k);
  assert.deepEqual(l.children.map((c) => c.id), ["hs-sea", "hs-rail", "hs-deck"]);
  assert.deepEqual(l.children[0].size, { px: 220 });
  assert.deepEqual(l.children[0].content.props, { role: "harbor" });
});
