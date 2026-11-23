// Every exec Harbormaster's refresh awaits carries a timeout, and a timed-out one lands in the
// existing failure path (runs carried stale, PRs kept stale), without throwing.
// Run: node --import ./loader.mjs --test exectimeouts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetShared, shared } from "herdr";
import { loadRuns, refreshPrs, textSig } from "../../herdr-app/mods/harbormaster/data.js";
import { loadContexts } from "../../herdr-app/mods/harbormaster/context.js";
import { exportFacts } from "../../herdr-app/mods/harbormaster/sceneexport.js";

const timedOut = () => Object.assign(new Error("timed out"), { timedOut: true });
const calls = [];
const record = (answer) => { calls.length = 0; globalThis.__herdrExec = async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return answer(cmd, args, opts); }; };
const allTimed = () => { for (const c of calls) assert.ok(c.opts?.timeout > 0, `exec ${c.cmd} ${String(c.args?.[0])} has no timeout`); assert.ok(calls.length > 0); };

test("loadRuns reads with a timeout, and a read that times out fails the machine without throwing", async () => {
  record(async () => ({ code: 0, stdout: "", stderr: "" }));
  await loadRuns();
  allTimed();
  await new Promise((r) => setTimeout(r, 0));
  // A new read after the cache is old: a rejecting (timed-out) read
  const realNow = Date.now; Date.now = () => realNow() + 60000;
  try {
    record(async () => { throw timedOut(); });
    const res = await loadRuns();
    assert.deepEqual(res.failed, [null]);
    assert.match(res.errors[0], /timed out/);
    // and the nonzero-exit shape
    Date.now = () => realNow() + 120000;
    record(async () => ({ code: 124, stdout: "", stderr: "" }));
    const res2 = await loadRuns();
    assert.deepEqual(res2.failed, [null]);
    // the cache freed itself, so the next poll reads again
    assert.equal(res2.pending, null);
  } finally { Date.now = realNow; }
});

test("loadContexts reads with a timeout and frees its cache when the read times out", async () => {
  record(async () => { throw timedOut(); });
  const out = await loadContexts(["t1:a"]);
  allTimed();
  assert.deepEqual(out, {});
  // The cache is free: another set of addresses reads again.
  record(async () => ({ code: 0, stdout: "t1:b\t1000\tm\n", stderr: "" }));
  const again = await loadContexts(["t1:b"]);
  assert.equal(calls.length, 1);
  assert.equal(again["t1:b"].tokens, 1000);
});

test("exportFacts: the want read and the write both carry a timeout", async () => {
  globalThis.__herdrChecking = false;
  record(async (cmd, args) => (args[1].includes("harbor3d.want") ? { code: 0, stdout: "/root\n1\n", stderr: "" } : { code: 0, stdout: "", stderr: "" }));
  await exportFacts(() => ({ v: 1, at: 1, runs: [] }));
  assert.equal(calls.length, 2);
  allTimed();
  record(async () => { throw timedOut(); });
  await exportFacts(() => ({ v: 1, at: 2, runs: ["x"] }));
  assert.ok(calls.length > 0); // the want read timed out: nothing thrown
  delete globalThis.__herdrChecking;
});

test("refreshPrs reads gh with a timeout, and a timed-out read keeps the last PR stale", async () => {
  resetShared();
  const url = "https://github.com/o/r/pull/7";
  const view = { number: 7, title: "t", state: "OPEN", isDraft: false, reviewDecision: null, reviews: [], reviewRequests: [], author: { login: "me" }, statusCheckRollup: [], url, headRefName: "b", headRefOid: "a".repeat(40), body: "", updatedAt: "2026-11-18T09:00:00Z" };
  const run = { key: ":/runs/t2a", machine: null, folder: "/repo", branch: "x", type: "feat", prs: [{ url, repo: "o/r" }], related: [], filesSig: textSig("t2a") };
  record(async (cmd, args) => (args[0] === "pr" ? { code: 0, stdout: JSON.stringify(view), stderr: "" } : { code: 0, stdout: JSON.stringify({ data: { repository: { pullRequest: { reviews: { nodes: [] }, reviewThreads: { nodes: [] }, comments: { nodes: [] } } } } }), stderr: "" }));
  await refreshPrs(run, false, true);
  allTimed();
  assert.equal(shared("harbormaster.prs")[run.key].list[0].state, "OPEN");
  record(async () => { throw timedOut(); });
  await refreshPrs(run, false, true);
  const entry = shared("harbormaster.prs")[run.key];
  assert.ok(entry.error);
  assert.equal(entry.list[0].stale, true);
  assert.equal(entry.list[0].state, "OPEN");
});
