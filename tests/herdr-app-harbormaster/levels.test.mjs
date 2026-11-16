// Unit tests for the header tags' texts (herdr-app/mods/harbormaster/levels.js) and the tasks
// bar's proof colours (proof.js proofTone).
// Run: node --import ./loader.mjs --test levels.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TIER_TEXT, tierTip, AUTONOMY, autonomyTip, typeTip } from "../../herdr-app/mods/harbormaster/levels.js";
import { tierTip as proofTierTip, proofTasks, proofTone, proofToneText, parseProofMd } from "../../herdr-app/mods/harbormaster/proof.js";

const skill = readFileSync(new URL("../../skills/proving/SKILL.md", import.meta.url), "utf8");

test("the tier texts are the proving skill's tier table, row for row", () => {
  const rows = skill.split("\n").map((l) => /^\| T(\d+) \| (.*) \|\s*$/.exec(l)).filter(Boolean);
  assert.deepEqual(rows.map((m) => Number(m[1])), [0, 1, 2, 3]);
  assert.deepEqual(rows.map((m) => m[2]), TIER_TEXT);
});

test("a tier's hover is a definition, not a status", () => {
  assert.equal(tierTip(2), "Proof tier T2 — proved with passing tests, their output for the changed behaviour, and screenshots or a recording");
  assert.equal(tierTip(0), "Proof tier T0 — proved with passing tests (CI, or the repo's local suite)");
  for (let i = 0; i < 4; i++) {
    assert.match(tierTip(i), new RegExp(`^Proof tier T${i} — proved with `));
    assert.doesNotMatch(tierTip(i), /green/i);
  }
  assert.equal(tierTip(7), "Proof tier T7");
  // proof.js's users get the same text.
  assert.equal(proofTierTip, tierTip);
});

test("an autonomy level's hover defines it", () => {
  assert.equal(autonomyTip("L1"), "Autonomy L1 — decides small things itself and logs them; stops only for direction and design calls");
  assert.equal(autonomyTip("L0"), "Autonomy L0 — you approve its decisions; it stops and asks before each one");
  assert.equal(autonomyTip("L2"), "Autonomy L2 — runs to a merge-ready PR with proof on its own; stops only at merge");
  assert.deepEqual(Object.keys(AUTONOMY), ["L0", "L1", "L2"]);
  assert.equal(autonomyTip("L9"), "Autonomy L9");
  assert.match(typeTip("feat"), /^Run type: feat — /);
});

const row = (result, extra = {}) => ({ result, missing: false, scoped: true, ...extra });

test("a task's bar colour follows its proof result", () => {
  assert.equal(proofTone(row("pass"), false), "pass");
  assert.equal(proofTone(row("fail"), false), "fail");
  assert.equal(proofTone(row("partial"), false), "partial");
  // A T2+ pass without a screenshot is amber, like a partial.
  assert.equal(proofTone(row("pass", { missing: true }), true), "partial");
  // No result: the stage's colour while the run goes on, amber once it is finished.
  assert.equal(proofTone(row(null), false), null);
  assert.equal(proofTone(row(null), true), "unchecked");
  assert.equal(proofTone(row(null, { scoped: false }), true), "unchecked");
  // Only a done task is "not checked": a blocked or never-started one on a finished, parked or
  // closed run keeps its stage's colour, and a result shows whatever the stage.
  assert.equal(proofTone(row(null), true, false), null);
  assert.equal(proofTone(row(null, { scoped: false }), true, false), null);
  assert.equal(proofTone(row("fail"), true, false), "fail");
  assert.equal(proofTone(row(null), true, true), "unchecked");
  // A run without proof keeps every segment its stage's colour.
  assert.equal(proofTone(null, true), null);
});

test("a segment's hover says its proof", () => {
  assert.equal(proofToneText(null, row(null)), null);
  assert.equal(proofToneText("pass", row("pass")), "proof pass");
  assert.equal(proofToneText("fail", row("fail")), "proof fail");
  assert.equal(proofToneText("partial", row("partial")), "proof partial");
  assert.equal(proofToneText("partial", row("pass", { missing: true })), "proof pass, but no screenshot");
  assert.equal(proofToneText("unchecked", row(null)), "proof not checked");
  assert.equal(proofToneText("unchecked", row(null, { scoped: false })), "proof not scoped");
});

test("tones from plan.md tasks and proof.md, in plan order", () => {
  const tasks = [
    { id: "t1", name: "a", proof: { tier: 1, text: "x" } },
    { id: "t2", name: "b", proof: { tier: 2, text: "x" } },
    { id: "t3", name: "c", proof: { tier: 2, text: "x" } },
    { id: "t4", name: "d", proof: { tier: 1, text: "x" } },
    { id: "t5", name: "e", proof: null },
  ];
  const md = parseProofMd(["# Proof", "Checks: green — suite", "",
    "## t1 a", "Result: pass", "", "## t2 b", "Tier: T2", "Result: pass — tests", "Files: out.txt", "",
    "## t3 c", "Result: fail — broke"].join("\n"));
  const rows = proofTasks(tasks, md, ["out.txt"]);
  assert.deepEqual(rows.map((k) => proofTone(k, false)), ["pass", "partial", "fail", null, null]);
  assert.deepEqual(rows.map((k) => proofTone(k, true)), ["pass", "partial", "fail", "unchecked", "unchecked"]);
});
