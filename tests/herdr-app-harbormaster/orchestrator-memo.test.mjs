// orchestratorState (live.js) is worked out once per run per facts() snapshot; a new snapshot reads again.
// Run: node --import ./loader.mjs --test orchestrator-memo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { orchestratorState } from "../../herdr-app/mods/harbormaster/live.js";

test("the same ctx answers from the memo, a new ctx reads the terminals again", () => {
  const run = { key: "r", terminal: "t1" };
  const ctx = { terminals: [{ address: "t1", state: "live", status: "working" }], agents: [] };
  assert.equal(orchestratorState(run, ctx), "working");
  ctx.terminals[0].status = "idle";
  assert.equal(orchestratorState(run, ctx), "working", "kept for this snapshot");
  assert.equal(orchestratorState(run, { terminals: ctx.terminals, agents: [] }), "idle", "a new snapshot reads again");
  assert.equal(orchestratorState({ key: "x", terminal: "none" }, ctx), "gone", "another run in the same ctx is its own answer");
});
