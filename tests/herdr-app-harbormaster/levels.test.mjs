// Unit tests for the header tags' texts (herdr-app/mods/harbormaster/levels.js).
// Run: node --import ./loader.mjs --test levels.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TIER_TEXT, tierTip, AUTONOMY, autonomyTip, typeTip, levelChoices, levelRequest, requestLine, pendingLevels } from "../../herdr-app/mods/harbormaster/levels.js";
import { tierTip as proofTierTip } from "../../herdr-app/mods/harbormaster/proof.js";

const skill = readFileSync(new URL("../../skills/proving/SKILL.md", import.meta.url), "utf8");

test("the tier texts are the proving skill's tier table, row for row", () => {
  const rows = skill.split("\n").map((l) => /^\| T(\d+) \| (.*) \|\s*$/.exec(l)).filter(Boolean);
  assert.deepEqual(rows.map((m) => Number(m[1])), [0, 1, 2, 3]);
  assert.deepEqual(rows.map((m) => m[2]), TIER_TEXT);
});

test("a tier's hover is a definition, not a status", () => {
  assert.equal(tierTip(2), "Proof tier T2 — proved with passing tests, their output for the changed behaviour, and screenshots or a recording");
  assert.equal(tierTip(0), "Proof tier T0 — proved with passing tests (CI, or the repo's local suite)");
  // A guided demo only where one can be recorded: a Herdr mod or a CLI may have none (#47).
  assert.equal(tierTip(3), "Proof tier T3 — proved with passing tests, their output for the changed behaviour, screenshots or a recording, and a guided demo where one can be recorded");
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

test("a level tag's popover lists every level with its definition, the run's own marked", () => {
  const auto = levelChoices("autonomy", "L1");
  assert.deepEqual(auto.map((c) => c.label), ["L0", "L1", "L2"]);
  assert.deepEqual(auto.map((c) => c.current), [false, true, false]);
  assert.equal(auto[2].text, AUTONOMY.L2);
  assert.ok(auto.every((c) => !c.pending));
  const tiers = levelChoices("tier", 2, 3);
  assert.deepEqual(tiers.map((c) => c.label), ["T0", "T1", "T2", "T3"]);
  assert.deepEqual(tiers.map((c) => c.level), [0, 1, 2, 3]);
  assert.deepEqual(tiers.map((c) => c.current), [false, false, true, false]);
  assert.deepEqual(tiers.map((c) => c.pending), [false, false, false, true]);
  assert.equal(tiers[0].text, `proved with ${TIER_TEXT[0]}`);
  // A request for the level the run already has is not pending.
  assert.ok(levelChoices("autonomy", "L2", "L2").every((c) => !c.pending));
});

test("a level request is one line the orchestrator acts on, then what it implies", () => {
  assert.equal(requestLine("autonomy", "L2"), "set autonomy to L2");
  assert.equal(requestLine("tier", 2), "set proof tier to T2");
  assert.equal(levelRequest("autonomy", "L2", { from: "L1" }),
    `set autonomy to L2\nAsked from Harbormaster (was L1). From now on: ${AUTONOMY.L2}.`);
  assert.equal(levelRequest("tier", 3, { from: 1 }),
    `set proof tier to T3\nAsked from Harbormaster (was T1): every claim is proved with ${TIER_TEXT[3]}, proven ones included.`);
  // On a finished run a higher tier means proving its done tasks again, which sets it running.
  assert.match(levelRequest("tier", 2, { from: 0, finished: true }), /^set proof tier to T2\n.*the run is finished, so prove its claims to T2 .*sets it back to running\.$/);
  assert.match(levelRequest("tier", 0, { from: 2, finished: true }), /^set proof tier to T0\n.*needs only to be proved with .*proof already gathered stays\.$/);
  for (const m of [levelRequest("autonomy", "L0"), levelRequest("tier", 1)]) assert.equal(m.split("\n").length, 2);
});

test("pending levels come from unhandled request lines and stop once the run shows them", () => {
  const lines = "set proof tier to T3\nset autonomy to L2\nset proof tier to T2\n";
  // The latest request of each kind wins.
  assert.deepEqual(pendingLevels(lines, { autonomy: "L1", tier: 1 }), { autonomy: "L2", tier: 2 });
  // Applied: status.json or plan.md shows it, though the message is not renamed yet.
  assert.deepEqual(pendingLevels(lines, { autonomy: "L2", tier: 2 }), { autonomy: null, tier: null });
  // No unhandled messages (renamed to .handled): nothing pending.
  assert.deepEqual(pendingLevels("", { autonomy: "L1", tier: 1 }), { autonomy: null, tier: null });
  assert.deepEqual(pendingLevels(undefined), { autonomy: null, tier: null });
  // Only exact request lines count; out-of-range levels and prose do not.
  assert.deepEqual(pendingLevels("set autonomy to L3\nplease set proof tier to T2\nset proof tier to T9", { autonomy: "L0", tier: 0 }), { autonomy: null, tier: null });
  // A tier request on a run with no tier yet is pending.
  assert.deepEqual(pendingLevels("set proof tier to T1", { autonomy: "L0", tier: null }), { autonomy: null, tier: 1 });
});
