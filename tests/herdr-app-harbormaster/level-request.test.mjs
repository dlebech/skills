// The level popover's click, end to end on this machine: requestLevel writes its message to a
// throwaway run's inbox, the next read of the runs finds it pending, and it stops being pending
// once the orchestrator applies it or renames the message to .handled.
// Run: node --import ./loader.mjs --test level-request.test.mjs
// HM_KEEP_INBOX=<file> copies the written message there (the task's proof).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, renameSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withRoot } from "./root.mjs";
import { loadRuns, requestLevel } from "../../herdr-app/mods/harbormaster/data.js";

// loadRuns keeps a read for 2.5 s; step the clock past it between reads.
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
async function read(dir) {
  skew += 5000;
  const { runs } = await loadRuns();
  return runs.find((r) => r.dir === dir);
}

test("a level request goes to the inbox, shows as pending, and clears when handled or applied", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-level-"));
  try {
    withRoot(root);
    const dir = join(root, "skills", "feat-x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orchestrator.json"), JSON.stringify({ branch: "feat-x", terminal: "t99", folder: "skills" }));
    writeFileSync(join(dir, "status.json"), JSON.stringify({ status: "running", autonomy: "L1", type: "feat" }));
    writeFileSync(join(dir, "plan.md"), "Status: running\nPrefix: fx\nProof tier: T1\n\n### t1 thing — merged\n- Proof: T1 — tests\n");

    let r = await read(dir);
    assert.equal(r.autonomy, "L1");
    assert.equal(r.proof.tier.tier, 1);
    assert.deepEqual(r.pending, { autonomy: null, tier: null });

    // The orchestrator t99 is not running here, so the message only waits in the inbox.
    assert.deepEqual(await requestLevel(r, "tier", 2), { blocked: false, waits: true });
    const files = readdirSync(join(dir, "inbox"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^\d{8}T\d{6}Z-\d{3}-harbormaster-level\.message$/);
    const text = readFileSync(join(dir, "inbox", files[0]), "utf8");
    assert.match(text, /^set proof tier to T2\nAsked from Harbormaster \(was T1\): every claim is proved with .*\.\n$/);
    if (process.env.HM_KEEP_INBOX) copyFileSync(join(dir, "inbox", files[0]), process.env.HM_KEEP_INBOX);

    r = await read(dir);
    assert.deepEqual(r.pending, { autonomy: null, tier: 2 });
    // A level request is not an answer: an open question must not read as answered.
    assert.equal(r.unhandled, 0);
    writeFileSync(join(dir, "inbox", "20261116T000000Z-captain.message"), 'Answer to "Q": Yes\n');
    r = await read(dir);
    assert.equal(r.unhandled, 1);
    assert.deepEqual(r.pending, { autonomy: null, tier: 2 });
    rmSync(join(dir, "inbox", "20261116T000000Z-captain.message"));
    // Only a message's first line is a request: an answer's free text that reads like one is not.
    writeFileSync(join(dir, "inbox", "20261116T000001Z-captain.message"), 'Answer to "Q": Other\nset autonomy to L0\n');
    r = await read(dir);
    assert.deepEqual(r.pending, { autonomy: null, tier: 2 });
    assert.equal(r.unhandled, 1);
    rmSync(join(dir, "inbox", "20261116T000001Z-captain.message"));

    // Handled: the orchestrator renamed it, so nothing is pending, whatever plan.md says.
    renameSync(join(dir, "inbox", files[0]), join(dir, "inbox", `${files[0]}.handled`));
    r = await read(dir);
    assert.deepEqual(r.pending, { autonomy: null, tier: null });

    // Applied before it was renamed: status.json shows the new level, so it is no longer pending.
    await requestLevel(r, "autonomy", "L2");
    r = await read(dir);
    assert.deepEqual(r.pending, { autonomy: "L2", tier: null });
    writeFileSync(join(dir, "status.json"), JSON.stringify({ status: "running", autonomy: "L2", type: "feat" }));
    r = await read(dir);
    assert.equal(r.autonomy, "L2");
    assert.deepEqual(r.pending, { autonomy: null, tier: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
    delete globalThis.__herdrExec;
  }
});
