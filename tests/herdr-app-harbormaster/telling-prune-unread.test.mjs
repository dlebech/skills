// observeTelling before any run read has succeeded (a reload, the first read still out or failed):
// a run absent from `runs` is only unread, so the shared asked store keeps its marks.
// Own file: the run cache is module state, and the other prune tests read it.
// Run: node --import ./loader.mjs --test telling-prune-unread.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetShared } from "herdr";
import { observeTelling } from "../../herdr-app/mods/harbormaster/telling.js";
import { cachedRuns } from "../../herdr-app/mods/harbormaster/data.js";
import { facts } from "../../herdr-app/mods/harbormaster/live.js";
import { markAsked, askedStore } from "../../herdr-app/mods/harbormaster/inbox.js";

test("prune: no read ever succeeded keeps the marks of absent runs", () => {
  resetShared();
  const r = { key: ":/r/never", dir: "/r/never", branch: "never", terminal: null, localTerminal: null, statusLine: "running", progress: "p1", tasks: [], phase: "running", away: null, decided: [], prs: [] };
  markAsked(r, "blocking", "", r);
  assert.equal(cachedRuns().at, 0);
  observeTelling([], facts());
  assert.equal(Object.keys(askedStore()).length, 1);
});
