// After an action changes a run's files (close, park, resume, delete), the next poll reads
// them again at once, while every other run keeps its fresh files: closing one run used to
// put every run under Can't tell until that read came back.
// Run: node --import ./loader.mjs --test reread.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRuns, askReread, filesFresh, cachedRuns } from "../../herdr-app/mods/harbormaster/data.js";

// Each run-files read waits until the test lets it finish.
const reads = [];
globalThis.__herdrExec = async (cmd) => {
  if (cmd !== "sh") return { code: 0, stdout: "", stderr: "" };
  return new Promise((done) => reads.push(() => done({ code: 0, stdout: "", stderr: "" })));
};
const finish = async (p) => { reads.at(-1)(); return p; };
const tick = () => new Promise((r) => setTimeout(r, 0));

test("a reread asked for after an action keeps the other runs fresh and reads again at once", async () => {
  await finish(loadRuns());
  assert.equal(reads.length, 1);
  await loadRuns();
  assert.equal(reads.length, 1, "within 2.5 s a poll uses the last read");

  askReread();
  const again = loadRuns();
  await tick();
  assert.equal(reads.length, 2, "a reread is due, so it reads at once");
  assert.equal(filesFresh({ machine: null }), true, "while it reads, the other runs stay fresh");
  await finish(again);
});

test("a read already under way when the action wrote its files does not count as the reread", async () => {
  const before = reads.length;
  const p = (async () => { await new Promise((r) => setTimeout(r, 2600)); return loadRuns(); })();
  await new Promise((r) => setTimeout(r, 2700));
  assert.equal(reads.length, before + 1, "a poll's read is under way");
  askReread();
  const after = loadRuns();
  await tick();
  assert.equal(reads.length, before + 2, "a new read starts instead of waiting on the old one");
  reads.at(-2)();
  await finish(after);
  await p;
  assert.equal(cachedRuns().due, false);
});

test("a reread asked for during a read, with no poll in between, is still due after it", async () => {
  const before = reads.length;
  await new Promise((r) => setTimeout(r, 2600));
  const p = loadRuns();
  await tick();
  assert.equal(reads.length, before + 1);
  askReread();
  await finish(p);
  assert.equal(cachedRuns().due, true);
  const next = loadRuns();
  await tick();
  assert.equal(reads.length, before + 2, "the next poll reads again at once");
  await finish(next);
});
