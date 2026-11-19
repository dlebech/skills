// Waiting on someone… end to end through the shared store: the reply field marks the run
// (answers.js submitReply), attend.js attentionOf reads the mark, and the poll (attend.js
// observeWaits) deletes it once it lets go, or when its run is closed or gone.
// Run: node --import ./loader.mjs --test waiting-on.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shared, setShared, resetShared } from "herdr";
import { attentionOf, observeWaits } from "../../herdr-app/mods/harbormaster/attend.js";
import { submitReply } from "../../herdr-app/mods/harbormaster/answers.js";
import { waitOnId } from "../../herdr-app/mods/harbormaster/needbox.js";
import { waitingOnOf, setWaitingOn } from "../../herdr-app/mods/harbormaster/tracking.js";
import { facts } from "../../herdr-app/mods/harbormaster/live.js";
import { loadRuns } from "../../herdr-app/mods/harbormaster/data.js";
import { withRoot } from "./root.mjs";

const KEY = "harbormaster.waitingOn";
let root;
beforeEach(async () => {
  resetShared();
  // The run's folder is peer by the user's setting: no folder is peer built in.
  setShared("harbormaster.reviewFlows", { acme: "peer" });
  root = mkdtempSync(join(tmpdir(), "hm-wait-"));
  // A fresh read of the (empty) run root, so the runs below count as freshly read (data.js filesFresh).
  withRoot(root);
  await loadRuns();
  // The run's orchestrator is live and idle: a finished run with it there is not closed.
  globalThis.__herdrTerminals = [{ address: "t99", state: "live", labels: { role: "orchestrator" } }];
  globalThis.__herdrAgents = [{ address: "t99", status: "idle" }];
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); delete globalThis.__herdrExec; delete globalThis.__herdrTerminals; delete globalThis.__herdrAgents; });

// A finished peer-flow run (acme) with one open PR and no reviewer: `request review`.
const runIn = (o = {}) => {
  const dir = join(root, "acme", "issue-1371");
  mkdirSync(dir, { recursive: true });
  return { key: ":" + dir, dir, folder: "/home/u/projects/acme", repo: "acme", branch: "issue-1371", terminal: "t99", localTerminal: "t99",
    phase: "finished", statusLine: "finished", progress: "", tasks: [], prs: [{ url: "https://github.com/o/acme/pull/1397" }],
    related: [], question: null, ask: null, away: null, updated: Date.now() - 3600000, started: Date.now() - 7200000, ...o };
};
const pr = (o = {}) => ({ number: 1397, state: "OPEN", review: null, approvedBy: [], changesBy: [], requested: [], checks: { pass: 3, fail: 0, pending: 0 },
  url: "https://github.com/o/acme/pull/1397", repo: "o/acme", ci: { startedAt: 1, finishedAt: 2 }, reviewedAt: null, sha: "abc", ...o });
const readPrs = (run, list) => setShared("harbormaster.prs", { [run.key]: { list, at: Date.now(), okAt: Date.now() } });
// A view with the reply field open on the run's Waiting on someone…
const viewOn = (run, text) => {
  let value = text;
  return { runs: [run], decisions: [], replying: waitOnId(run), reply: { value: () => value, set_value: (v) => { value = v; }, focus: () => {} } };
};
const cx = () => { const c = { notified: 0, notify: () => { c.notified++; } }; return c; };

test("Enter with text marks the run and closes the field; nothing goes to its inbox", () => {
  const run = runIn();
  readPrs(run, [pr()]);
  assert.equal(attentionOf(run, facts()).reasons[0].key, "request review");
  const view = viewOn(run, "  Kari — preview check ");
  submitReply(view, cx());
  const mark = waitingOnOf(run);
  assert.equal(mark.text, "Kari — preview check");
  assert.equal(mark.label, "request review");
  assert.ok(Math.abs(mark.at - Date.now()) < 5000);
  assert.equal(view.replying, null);
  assert.equal(existsSync(join(run.dir, "inbox")), false);
  const a = attentionOf(run, facts());
  assert.equal(a.group, "waiting");
  assert.equal(a.reasons[0].text, "waiting on Kari — preview check");
});

test("blank text sets nothing and leaves the field open", () => {
  const run = runIn();
  readPrs(run, [pr()]);
  const view = viewOn(run, "   ");
  submitReply(view, cx());
  assert.equal(shared(KEY), null);
  assert.equal(view.replying, waitOnId(run));
});

test("the poll deletes a mark that let go, and it does not come back", () => {
  const run = runIn();
  readPrs(run, [pr()]);
  submitReply(viewOn(run, "Kari — preview check"), cx());
  observeWaits([run], facts());
  assert.ok(waitingOnOf(run), "still applies: kept");
  // A reviewer is requested: the mark goes; removing the request again does not bring it back.
  readPrs(run, [pr({ requested: ["anna"] })]);
  assert.equal(attentionOf(run, facts()).dropWait, true);
  observeWaits([run], facts());
  assert.equal(waitingOnOf(run), null);
  readPrs(run, [pr()]);
  assert.equal(attentionOf(run, facts()).group, "needs");
});

test("an unreadable PR read keeps the mark; a closed or unlisted run's mark is pruned; clearing by hand", () => {
  const run = runIn();
  readPrs(run, [pr()]);
  submitReply(viewOn(run, "Kari"), cx());
  setShared("harbormaster.prs", { [run.key]: { list: [pr()], at: Date.now(), error: "gh failed" } });
  observeWaits([run], facts());
  assert.ok(waitingOnOf(run));
  // Cleared by hand (the card's and pane's Not waiting any more).
  setWaitingOn(run.key, null);
  assert.equal(waitingOnOf(run), null);
  assert.deepEqual(shared(KEY), {});
  // Closed, and no longer listed.
  setWaitingOn(run.key, { text: "Kari", at: 1, label: "request review", sig: "x" });
  setWaitingOn(":/gone", { text: "Bo", at: 1, label: "request review", sig: "x" });
  observeWaits([{ ...run, away: { how: "closed", at: 1 } }], facts());
  assert.deepEqual(shared(KEY), {});
});

test("marks of runs not read this poll are kept: a machine that did not answer, or a failed read", () => {
  setWaitingOn("lab:/r/acme/x", { text: "Kari", at: 1, label: "request review", sig: "x" });
  setWaitingOn(":/r/acme/y", { text: "Bo", at: 1, label: "request review", sig: "x" });
  // App restart with the lab machine offline: its run is not in the first read at all.
  observeWaits([], facts(), { failed: ["lab"], errors: [] });
  assert.deepEqual(Object.keys(shared(KEY)), ["lab:/r/acme/x"]);
  // This machine's own read failed: nothing is pruned for being unlisted.
  setWaitingOn(":/r/acme/y", { text: "Bo", at: 1, label: "request review", sig: "x" });
  observeWaits([], facts(), { failed: [], errors: ["Error: sh failed"] });
  assert.deepEqual(Object.keys(shared(KEY)).sort(), [":/r/acme/y", "lab:/r/acme/x"]);
  observeWaits([], facts(), { failed: [null], errors: [] });
  assert.deepEqual(Object.keys(shared(KEY)).sort(), [":/r/acme/y"]);
});

test("Enter on a run whose step changed meanwhile sets nothing, closes the field and says why", () => {
  const run = runIn();
  readPrs(run, [pr()]);
  const view = viewOn(run, "Kari — preview check");
  // A reviewer was requested before Enter: review from, Waiting on others already.
  readPrs(run, [pr({ requested: ["anna"] })]);
  submitReply(view, cx());
  assert.equal(shared(KEY), null);
  assert.equal(view.replying, null);
  assert.equal(view.actionNote.text, "Not marked waiting on Kari — preview check: it no longer waits on you for that step");
  // Red CI beside it: still Needs you, for more than that step.
  readPrs(run, [pr({ checks: { pass: 2, fail: 1, pending: 0 }, ci: { startedAt: Date.now() - 60000, finishedAt: Date.now() - 30000 } })]);
  const again = viewOn(run, "Kari");
  submitReply(again, cx());
  assert.equal(shared(KEY), null);
  assert.match(again.actionNote.text, /^Not marked waiting on Kari: it now needs you for red CI on #1397 · request review/);
});
