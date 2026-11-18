// observeTelling prunes the shared asked store (inbox.js pruneAsked): a mark whose signature
// moved or whose run is closed is dropped, a live unchanged one is kept, a stale run's is kept.
// Run: node --import ./loader.mjs --test telling-prune.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetShared, setShared, shared } from "herdr";
import { observeTelling } from "../../herdr-app/mods/harbormaster/telling.js";
import { loadRuns } from "../../herdr-app/mods/harbormaster/data.js";
import { facts } from "../../herdr-app/mods/harbormaster/live.js";
import { markAsked, askedStore } from "../../herdr-app/mods/harbormaster/inbox.js";

beforeEach(() => resetShared());
const run = (name, o = {}) => ({
  key: `:/r/${name}`, dir: `/r/${name}`, branch: name, terminal: null, localTerminal: null, statusLine: "running", progress: "p1",
  tasks: [], phase: "running", away: null, decided: [], prs: [], ...o,
});

test("observeTelling drops a blocking mark whose signature moved or whose run is closed, keeps the rest", () => {
  const same = run("same"), moved = run("moved"), closed = run("closed"), stale = run("stale");
  for (const r of [same, moved, closed, stale]) markAsked(r, "blocking", "", r);
  assert.equal(Object.keys(askedStore()).length, 4);
  const next = [same, { ...moved, progress: "p2" }, { ...closed, away: { how: "closed" } }, { ...stale, stale: true }];
  observeTelling(next, facts());
  // What is left, by run: the unchanged run's, and the stale run's (unchanged, though not read this time).
  const left = Object.keys(askedStore()).map((k) => k.split("\u001f")[0]).sort();
  assert.deepEqual(left, [":/r/same", ":/r/stale"]);
});

// An answer's mark reads the queue, which only a fresh read can vouch for: after polls stall
// (the cache is old) nothing is pruned, and once a read is fresh a question that is gone drops it.
test("answer marks: kept while the read is not fresh, dropped once fresh and the question or decision is gone", async () => {
  const r = run("ans");
  const need = `need-${r.key}`, dec = "dec-:d1";
  const marks = () => Object.keys(askedStore()).map((k) => k.split("\u001f")[2]).sort();
  markAsked(r, "answer", need, { since: 1 });
  markAsked(r, "answer", dec, { since: 1 });
  // No read yet (the cache is at 0): the queue is empty only because nothing was read.
  observeTelling([r], facts());
  assert.deepEqual(marks(), [dec, need].sort());
  // A fresh read with no questions and no decisions.
  globalThis.__herdrExec = async () => ({ code: 0, stdout: "", stderr: "" });
  try { await loadRuns(); } finally { delete globalThis.__herdrExec; }
  observeTelling([r], facts());
  assert.deepEqual(marks(), []);
});

// A run absent from `runs` is gone only when its machine was read fresh this time. After a reload
// the cache is empty, and a machine that fails its first read leaves its runs out of `runs`.
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
const readWith = async (exec) => {
  skew += 5000;
  globalThis.__herdrExec = exec;
  try { await loadRuns(); } finally { delete globalThis.__herdrExec; }
};
const marks = () => Object.keys(askedStore()).length;

test("prune: marks of runs missing from a read that failed or never happened are kept; a fresh read drops them", async () => {
  const r = run("away");
  markAsked(r, "blocking", "", r);
  markAsked(r, "answer", `need-${r.key}`, { since: 1 });
  // A machine that failed its read (here this one): its runs are absent, not gone.
  await readWith(async () => ({ code: 1, stdout: "", stderr: "unreachable" }));
  observeTelling([], facts());
  assert.equal(marks(), 2);
  // The same read, but another machine's run is listed: still not gone.
  observeTelling([run("other")], facts());
  assert.equal(marks(), 2);
  // Marks still age out.
  observeTelling([], facts(), Date.now() + 8 * 24 * 3600 * 1000);
  assert.equal(marks(), 0);
  // A fresh read that lists no run: the run is gone.
  markAsked(r, "blocking", "", r);
  await readWith(async () => ({ code: 0, stdout: "", stderr: "" }));
  observeTelling([], facts());
  assert.equal(marks(), 0);
});

test("migration: the old comments asks wait for a read that lists every machine", async () => {
  const OLD = "harbormaster.commentsAsked";
  const r = run("m"), url = "https://github.com/o/r/pull/1";
  const entry = { sig: "s", ids: [], at: Date.now() };
  // Failed read, no runs: nothing moves, the old key stays.
  setShared(OLD, { [url]: entry });
  await readWith(async () => ({ code: 1, stdout: "", stderr: "unreachable" }));
  observeTelling([], facts());
  assert.deepEqual(shared(OLD), { [url]: entry });
  // A failed machine with runs listed (another one's): the same.
  observeTelling([r], facts());
  assert.deepEqual(shared(OLD), { [url]: entry });
  // (With a read that lists every machine the migration runs; inbox-views.test.mjs covers what it moves.)
});
