// Ask what's blocking (blocking.js, data.js askBlocking) and the review-flow setting
// (attention.js flowState, flowSetting; tracking.js withFlow): the message text, when the row
// reads "asked…", that the ask is no answer to a question, and what a toggle click stores.
// Run: node --import ./loader.mjs --test blocking.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { blockingRequest, blockingPending, blockingAsked, askSig, BLOCKING } from "../../herdr-app/mods/harbormaster/blocking.js";
import { withRoot } from "./root.mjs";
import { flowState, flowSetting, reviewFlow } from "../../herdr-app/mods/harbormaster/attention.js";
import { withFlow } from "../../herdr-app/mods/harbormaster/tracking.js";
import { loadRuns, askBlocking } from "../../herdr-app/mods/harbormaster/data.js";

const here = dirname(fileURLToPath(import.meta.url));

test("the ask says what Harbormaster sees and what to do, its first line marks it", () => {
  const msg = blockingRequest({ quiet: "34m", step: "CI on #42 · 50m" });
  assert.equal(msg, "what is blocking? Harbormaster sees this run quiet for 34m (step: CI on #42 · 50m).\n"
    + "Asked from Harbormaster: if you need me, write question.md and ask; else carry on and update your progress line.");
  assert.match(blockingRequest({ quiet: "1h2m" }), /^what is blocking\? Harbormaster sees this run quiet for 1h2m\.\n/);
  assert.ok(BLOCKING.test(msg.split("\n")[0]));
});

test("asked… holds while the message is unread, or until progress, task states or status change", () => {
  assert.equal(blockingPending("set autonomy to L2\nwhat is blocking? Harbormaster sees …"), true);
  assert.equal(blockingPending("set autonomy to L2\n"), false);
  assert.equal(blockingPending(null), false);
  const r = { progress: "CI on #42", tasks: [{ id: "t1", state: "merged" }], statusLine: "running", blockingAsked: false };
  const asked = { sig: askSig(r) };
  assert.equal(blockingAsked(r, asked), true);
  assert.equal(blockingAsked({ ...r, progress: "fixing CI" }, asked), false);
  assert.equal(blockingAsked({ ...r, tasks: [{ id: "t1", state: "done" }] }, asked), false);
  assert.equal(blockingAsked({ ...r, statusLine: "waiting for user: x" }, asked), false);
  assert.equal(blockingAsked({ ...r, progress: "fixing CI", blockingAsked: true }, asked), true);
  assert.equal(blockingAsked(r, null), false);
});

test("the review flow: the folder's default, the user's setting over it, and what a click stores", () => {
  const snev = { folder: "/home/u/projects/snevagten" }, skills = { folder: "/home/u/projects/skills/" };
  assert.deepEqual(flowState(snev, {}), { key: "snevagten", flow: "peer", fallback: "peer", isDefault: true });
  assert.deepEqual(flowState(skills, {}), { key: "skills", flow: "self", fallback: "self", isDefault: true });
  assert.deepEqual(flowState(skills, { skills: "peer" }), { key: "skills", flow: "peer", fallback: "self", isDefault: false });
  // Picking the default removes the setting; the other one stores it.
  assert.equal(flowSetting("self", "self"), null);
  assert.equal(flowSetting("peer", "self"), "peer");
  assert.equal(flowSetting("self", "peer"), "self");
  let store = withFlow({}, "skills", flowSetting("peer", "self"));
  assert.deepEqual(store, { skills: "peer" });
  // Every run of that folder reads it.
  assert.equal(reviewFlow({ folder: "/elsewhere/skills", key: "other" }, store), "peer");
  store = withFlow(store, "snevagten", flowSetting("self", "peer"));
  assert.deepEqual(store, { skills: "peer", snevagten: "self" });
  store = withFlow(store, "skills", flowSetting("self", "self"));
  assert.deepEqual(store, { snevagten: "self" });
  assert.equal(withFlow(store, "", "peer"), store);
});

test("the captain watcher does not take an ask what is blocking as an answer", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-blk-"));
  try {
    mkdirSync(join(dir, "inbox"));
    writeFileSync(join(dir, "inbox", "a-harbormaster-blocking.message"), `${blockingRequest({ quiet: "34m" })}\n`);
    writeFileSync(join(dir, "inbox", "b-captain.message"), 'Answer to "Q": Yes\nwhat is blocking? x\n');
    const lib = join(here, "../../skills/herdr-app-captain/scripts/lib.sh");
    const r = spawnSync("bash", ["-c", 'source "$1"; answer_messages "$2"', "bash", lib, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split("\n").map((p) => p.split("/").pop()), ["b-captain.message"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("askBlocking writes the message to the run's inbox, and the next read shows it asked, not as an answer", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-blk-root-"));
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  const read = async (dir) => { skew += 5000; return (await loadRuns()).runs.find((r) => r.dir === dir); };
  try {
    withRoot(root);
    const dir = join(root, "skills", "feat-x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orchestrator.json"), JSON.stringify({ branch: "feat-x", terminal: "t99", folder: "skills" }));
    writeFileSync(join(dir, "status.json"), JSON.stringify({ status: "running", progress: "CI on #42" }));
    writeFileSync(join(dir, "plan.md"), "Status: running\n");
    writeFileSync(join(dir, "question.md"), "# Go on?\n");
    let r = await read(dir);
    assert.equal(r.blockingAsked, false);
    // The orchestrator t99 is not running here, so the ask only waits in the inbox.
    assert.deepEqual(await askBlocking(r, { quiet: "34m", step: "CI on #42 · 50m" }), { blocked: false, waits: true });
    const [msg] = readdirSync(join(dir, "inbox"));
    assert.match(msg, /^\d{8}T\d{6}Z-\d{3}-harbormaster-blocking\.message$/);
    assert.match(readFileSync(join(dir, "inbox", msg), "utf8"), /^what is blocking\? Harbormaster sees this run quiet for 34m \(step: CI on #42 · 50m\)\./);
    r = await read(dir);
    assert.equal(r.blockingAsked, true);
    // Not an answer: the open question must not read as answered.
    assert.equal(r.unhandled, 0);
    renameSync(join(dir, "inbox", msg), join(dir, "inbox", `${msg}.handled`));
    r = await read(dir);
    assert.equal(r.blockingAsked, false);
  } finally {
    Date.now = realNow;
    rmSync(root, { recursive: true, force: true });
    delete globalThis.__herdrExec;
  }
});
