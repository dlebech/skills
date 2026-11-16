// Pending proof (proof.js): a row whose proof is still being gathered, because its task isn't
// done or proof.md says "Result: pending — <why>", reads calm, offers nothing and counts apart;
// and a captain decision's run named "<machine>:<dir>" (data.js decisionRun).
import { test } from "node:test";
import assert from "node:assert/strict";
import { proofTasks, proofVerdict, proofRowParts, needsLook, proofTone, proofCounts, parseProofMd, isPending, pendingLine, gatheringStage } from "../../herdr-app/mods/harbormaster/proof.js";
import { decisionRun, taskStage } from "../../herdr-app/mods/harbormaster/data.js";

const MD = `Tier: T2

## t1 one
Result: pass — 12 tests
Files: shared/proof/t1.png

## t2 two
Result: partial — the popup shots are t4's
Files: shared/proof/t2.png

## t3 three
Result: pending — waiting for t4
Files: shared/proof/t3.png

## t4 four
Result: fail — the shot is blank
Files: shared/proof/t4.png
`;
const TASKS = ["t1", "t2", "t3", "t4", "t5"].map((id) => ({ id, name: id, proof: { tier: 2, text: "shots" } }));
const SHOTS = ["t1.png", "t2.png", "t3.png", "t4.png"];
const tier = { tier: 2, byUser: false };
const underWay = (...ids) => (id) => ids.includes(id);

test("proof.md's Result: pending is read like the other result words", () => {
  const e = parseProofMd(MD).tasks.t3;
  assert.equal(e.result, "pending");
  assert.equal(e.why, "waiting for t4");
});

test("a row is pending while its task isn't done and nothing failed, or when proof.md says so", () => {
  const rows = proofTasks(TASKS, parseProofMd(MD), SHOTS, { gathering: underWay("t2", "t5") });
  // t1 passed, t2's task isn't done (its partial waits), t3 says pending though done, t4 failed, t5 isn't done.
  assert.deepEqual(rows.map((k) => k.pending), [false, true, true, false, true]);
  // A failure is never pending, done or not.
  assert.equal(proofTasks(TASKS, parseProofMd(MD), SHOTS, { gathering: () => true })[3].pending, false);
  // A pass is a pass, even on a task still in review.
  assert.equal(proofTasks(TASKS, parseProofMd(MD), SHOTS, { gathering: () => true })[0].pending, false);
  // Without `gathering`, no task is under way: only proof.md's pending is pending.
  assert.deepEqual(proofTasks(TASKS, parseProofMd(MD), SHOTS).map((k) => k.pending), [false, false, true, false, false]);
  // On a finished run nothing is being gathered any more: nothing is pending.
  assert.ok(proofTasks(TASKS, parseProofMd(MD), SHOTS, { gathering: () => true, finished: true }).every((k) => !k.pending));
  assert.equal(isPending({ result: "pending", missing: false }, true, true), false);
});

test("a pending row reads calm: no look needed, no actions, no segment colour", () => {
  const rows = proofTasks(TASKS, parseProofMd(MD), SHOTS, { gathering: underWay("t2", "t5") });
  const [, t2, t3, t4, t5] = rows;
  for (const k of [t2, t3, t5]) {
    assert.equal(needsLook(k, false), false, k.id);
    assert.equal(proofTone(k, false, k.id === "t3"), null, k.id);
    const parts = proofRowParts(k, false, k.id === "t3");
    assert.equal(parts[0].tone, "pending", k.id);
    assert.ok(!parts.some((p) => p.kind === "actions"), k.id);
  }
  assert.equal(proofRowParts(t3, false)[0].text, "pending — waiting for t4");
  assert.equal(pendingLine(t2), "pending — the task isn't done yet (so far: partial — the popup shots are t4's)");
  assert.equal(pendingLine(t5), "pending — the task isn't done yet");
  // The failure still needs a look and offers Accept and Ask to prove.
  assert.equal(needsLook(t4, false), true);
  assert.deepEqual(proofRowParts(t4, false).at(-1).actions, ["accept", "ask"]);
});

test("a done task's partial still needs a look, and proof.md's pending on a finished run does too", () => {
  const rows = proofTasks(TASKS, parseProofMd(MD), SHOTS, { gathering: () => false });
  assert.equal(rows[1].pending, false);
  assert.equal(needsLook(rows[1], false), true);
  const fin = proofTasks(TASKS, parseProofMd(MD), SHOTS, { gathering: () => false, finished: true });
  assert.equal(needsLook(fin[2], true), true);
  assert.equal(proofTone(fin[2], true), "unchecked");
  assert.equal(proofRowParts(fin[2], true)[0].tone, "unchecked");
  assert.deepEqual(proofRowParts(fin[2], true).at(-1).actions, ["accept", "ask"]);
});

test("the verdict counts pending apart, and only-pending reads as no problem", () => {
  const md = parseProofMd(MD);
  const v = proofVerdict({ tier, md, tasks: TASKS, danger: null, shotFiles: SHOTS, gathering: underWay("t2", "t5") });
  assert.deepEqual(v, { text: "Proof T2 · 1/5 pass · 3 pending · 1 fail", tone: "blocked" });
  const c = proofCounts(proofTasks(TASKS, md, SHOTS, { gathering: underWay("t2", "t5") }));
  assert.deepEqual({ pass: c.pass, pending: c.pending, fail: c.fail, partial: c.partial, unchecked: c.unchecked, unscoped: c.unscoped },
    { pass: 1, pending: 3, fail: 1, partial: 0, unchecked: 0, unscoped: 0 });
  // Without the failure, nothing but pass and pending: dim, no partial, no "not checked".
  const ok = parseProofMd(MD.replace("Result: fail — the shot is blank", "Result: pass — the shot"));
  assert.deepEqual(proofVerdict({ tier, md: ok, tasks: TASKS, danger: null, shotFiles: SHOTS, gathering: underWay("t2", "t5") }),
    { text: "Proof T2 · 2/5 pass · 3 pending", tone: "dim" });
  // Once every task is done, t2's partial and t5's missing result are back.
  assert.equal(proofVerdict({ tier, md: ok, tasks: TASKS, danger: null, shotFiles: SHOTS, gathering: () => false }).text,
    "Proof T2 · 2/5 pass · 1 pending · 1 partial · 1 not checked");
});

test("an unscoped task that isn't done is pending, not 'not scoped'", () => {
  const tasks = [...TASKS, { id: "t6", name: "six", proof: null }];
  const rows = proofTasks(tasks, null, null, { gathering: (id) => id === "t6" });
  assert.equal(rows[5].pending, true);
  assert.equal(needsLook(rows[5], false), false);
  assert.equal(proofCounts(rows).unscoped, 0);
  // The verdict counts it with the pending rows, but not in the pass denominator.
  assert.equal(proofCounts(rows).pending, 1);
  assert.equal(proofCounts(rows).total, 5);
  assert.equal(proofCounts(proofTasks(tasks, null, null)).unscoped, 1);
});

test("an accepted row stays accepted, never pending", () => {
  const accepted = { t2: { at: "2026-11-16T10:00:00Z", result: "partial — the popup shots are t4's" } };
  const k = proofTasks(TASKS, parseProofMd(MD), SHOTS, { accepted, gathering: () => true })[1];
  assert.equal(k.pending, false);
  assert.ok(k.accepted);
  assert.equal(proofCounts([k]).accepted, 1);
  assert.equal(proofCounts([k]).pending, 0);
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
  // A blocked task's partial needs a look, with its buttons.
  const blocked = (id) => gatheringStage(taskStage(id === "t2" ? "blocked" : "implementing"));
  const k = proofTasks(TASKS, parseProofMd(MD), SHOTS, { gathering: blocked })[1];
  assert.equal(k.pending, false);
  assert.equal(needsLook(k, false), true);
  assert.deepEqual(proofRowParts(k, false).at(-1).actions, ["accept", "ask"]);
});
