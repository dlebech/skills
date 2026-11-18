// observeTelling prunes the shared asked store (inbox.js pruneAsked): a mark whose signature
// moved or whose run is closed is dropped, a live unchanged one is kept, a stale run's is kept.
// Run: node --import ./loader.mjs --test telling-prune.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetShared } from "herdr";
import { observeTelling } from "../../herdr-app/mods/harbormaster/telling.js";
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
