// Pending proof: a claim whose proof is still being gathered, because its tasks aren't done or
// proof.md says "Result: pending — <why>", reads calm and offers nothing (claims.js); which task
// stages gather proof (proof.js); and a captain decision's run named "<machine>:<dir>" (data.js decisionRun).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProofMd, gatheringStage } from "../../herdr-app/mods/harbormaster/proof.js";
import { claimRows, claimActions, worthALook, parsePlanClaims } from "../../herdr-app/mods/harbormaster/claims.js";
import { decisionRun, taskStage } from "../../herdr-app/mods/harbormaster/data.js";

const MD = `## C3 three
Result: pending — waiting for t4
`;
const proof = (md) => ({ tier: { tier: 1 }, claims: parsePlanClaims("## Claims\nC1 one — tasks t1\nC2 two — tasks t2\nC3 three — tasks t1\n"), md: parseProofMd(md), files: null, accepted: {}, asks: new Map() });

test("proof.md's Result: pending is read like the other result words", () => {
  const e = parseProofMd(MD).claims.C3;
  assert.equal(e.result, "pending");
  assert.equal(e.why, "waiting for t4");
});

test("a claim is pending while its tasks are under way and nothing failed, or when proof.md says so; calm, no actions", () => {
  const run = { tasks: [{ id: "t1", state: "merged" }, { id: "t2", state: "implementing" }] };
  const rows = claimRows(proof(MD + "## C2 two\nResult: partial — half\n"), run);
  assert.deepEqual(rows.map((k) => k.state), ["unproven", "pending", "pending"]);
  assert.deepEqual(rows.filter((k) => k.state === "pending").map(claimActions), [[], []]);
  assert.equal(rows.some((k) => k.state === "pending" && worthALook(k)), false);
  // A failed claim is never pending; nothing is once the run is finished.
  assert.equal(claimRows(proof("## C2 two\nResult: fail — no\n"), run)[1].state, "fail");
  assert.deepEqual(claimRows(proof(MD), run, null, true).map((k) => k.state), ["unproven", "unproven", "unproven"]);
});

test("a captain decision's run is a directory on its machine, or <machine>:<dir> on another", () => {
  const here = { dir: "/home/me/.herdr/hc-orchestration/api/x", machine: null };
  const there = { dir: "/home/me/.herdr/hc-orchestration/api/x", machine: "local-ssh" };
  const runs = [here, there];
  assert.equal(decisionRun({ run: here.dir, machine: null }, runs), here);
  assert.equal(decisionRun({ run: `local-ssh:${there.dir}`, machine: null }, runs), there);
  // A decision read on that machine may name its own run plainly.
  assert.equal(decisionRun({ run: there.dir, machine: "local-ssh" }, runs), there);
  assert.equal(decisionRun({ run: `other:${there.dir}`, machine: null }, runs), null);
  assert.equal(decisionRun({ run: null, machine: null }, runs), null);
  // A relative-looking value with a colon but no absolute path is a plain directory name.
  assert.equal(decisionRun({ run: "a:b", machine: null }, [{ dir: "a:b", machine: null }])?.dir, "a:b");
});

test("only a task under way is gathering proof: planned, implementing, in review, fixing; never blocked", () => {
  const states = { "planned": true, "implementing": true, "in review": true, "fixing review findings": true,
    "merged": false, "done": false, "blocked: needs a key": false, "failed": false, "stuck": false, "validating": false };
  for (const [state, want] of Object.entries(states)) assert.equal(gatheringStage(taskStage(state)), want, state);
  // A blocked task's partial claim needs a look, with its buttons.
  const k = claimRows(proof("## C2 two\nResult: partial — half\n"), { tasks: [{ id: "t1", state: "merged" }, { id: "t2", state: "blocked" }] })[1];
  assert.equal(k.state, "partial");
  assert.deepEqual(claimActions(k), ["accept", "ask"]);
});
