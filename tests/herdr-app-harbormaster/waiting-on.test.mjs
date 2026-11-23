// Waiting on someone… end to end through the run's waiting-on.json: the reply field marks the run
// (answers.js submitReply), which writes the file on the run's machine (tracking.js setWaitingOn);
// the run read (data.js) reads it back, so every Harbormaster sees the same mark; attend.js
// attentionOf reads it, and the poll (attend.js observeWaits) clears it once it lets go, or when
// its run is closed. Only sh runs for real (root.mjs), against a throwaway run root.
// Run: node --import ./loader.mjs --test waiting-on.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shared, setShared, resetShared } from "herdr";
import { attentionOf, observeWaits } from "../../herdr-app/mods/harbormaster/attend.js";
import { submitReply } from "../../herdr-app/mods/harbormaster/answers.js";
import { waitOnId } from "../../herdr-app/mods/harbormaster/needbox.js";
import { waitingOnOf, setWaitingOn, parseWait, SAID_MS } from "../../herdr-app/mods/harbormaster/tracking.js";
import { facts } from "../../herdr-app/mods/harbormaster/live.js";
import { loadRuns, askReread } from "../../herdr-app/mods/harbormaster/data.js";
import { waitSig } from "../../herdr-app/mods/harbormaster/attention.js";
import { withRoot } from "./root.mjs";

const SAID = "harbormaster.waitingOnSaid";
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
  return { key: ":" + dir, dir, machine: null, folder: "/home/u/projects/acme", repo: "acme", branch: "issue-1371", terminal: "t99", localTerminal: "t99",
    phase: "finished", statusLine: "finished", progress: "", tasks: [], prs: [{ url: "https://github.com/o/acme/pull/1397" }],
    related: [], question: null, ask: null, away: null, updated: Date.now() - 3600000, started: Date.now() - 7200000, waitOn: null, ...o };
};
const file = (run) => join(run.dir, "waiting-on.json");
// The run as the next poll reads it: its waiting-on.json as data.js parses it.
const reread = (run) => ({ ...run, waitOn: existsSync(file(run)) ? parseWait(readFileSync(file(run), "utf8")) : null });
const pr = (o = {}) => ({ number: 1397, state: "OPEN", review: null, approvedBy: [], changesBy: [], requested: [], checks: { pass: 3, fail: 0, pending: 0 },
  url: "https://github.com/o/acme/pull/1397", repo: "o/acme", ci: { startedAt: 1, finishedAt: 2 }, reviewedAt: null, sha: "abc", ...o });
const readPrs = (run, list) => setShared("harbormaster.prs", { [run.key]: { list, at: Date.now(), okAt: Date.now() } });
// A view with the reply field open on the run's Waiting on someone…
const viewOn = (run, text) => {
  let value = text;
  return { runs: [run], decisions: [], replying: waitOnId(run), reply: { value: () => value, set_value: (v) => { value = v; }, focus: () => {} } };
};
// The spawned tasks are kept, so a test can wait for the write.
const cx = () => { const c = { notified: 0, tasks: [], notify: () => { c.notified++; }, spawn: (f) => { c.tasks.push(f(c)); } }; return c; };
const settle = (c) => Promise.all(c.tasks);
const mark = (o = {}) => ({ text: "Kari", at: 1700000000000, label: "request review", sig: "x", ...o });

test("Enter with text marks the run at once, writes waiting-on.json and closes the field; nothing goes to its inbox", async () => {
  const run = runIn();
  readPrs(run, [pr()]);
  assert.equal(attentionOf(run, facts()).reasons[0].key, "request review");
  const view = viewOn(run, "  Kari — preview check ");
  const c = cx();
  submitReply(view, c);
  // Shown before the write is read back.
  assert.equal(waitingOnOf(run).text, "Kari — preview check");
  await settle(c);
  const onDisk = JSON.parse(readFileSync(file(run), "utf8"));
  assert.equal(onDisk.text, "Kari — preview check");
  assert.equal(onDisk.label, "request review");
  assert.ok(Math.abs(Date.parse(onDisk.at) - Date.now()) < 5000);
  assert.equal(view.replying, null);
  assert.equal(existsSync(join(run.dir, "inbox")), false);
  // The next read agrees: what was said goes, and the file's mark holds the run.
  const read = reread(run);
  await observeWaits([read], facts());
  assert.deepEqual(shared(SAID), {});
  const a = attentionOf(read, facts());
  assert.equal(a.group, "waiting");
  assert.equal(a.reasons[0].text, "waiting on Kari — preview check");
});

test("the mark is the run's: another Harbormaster, with nothing in its shared state, sees it from the file", async () => {
  const run = runIn();
  readPrs(run, [pr()]);
  const next = attentionOf(run, facts()).next;
  await setWaitingOn(run, mark({ text: "Kari — preview check", sig: waitSig(next) }));
  const prs = shared("harbormaster.prs");
  resetShared();
  setShared("harbormaster.reviewFlows", { acme: "peer" });
  setShared("harbormaster.prs", prs);
  assert.equal(attentionOf(run, facts()).group, "needs");
  assert.equal(attentionOf(reread(run), facts()).group, "waiting");
});

test("the run read takes waiting-on.json with the run's files", async () => {
  const run = runIn();
  writeFileSync(join(run.dir, "orchestrator.json"), JSON.stringify({ folder: "/home/u/projects/acme", branch: "issue-1371" }));
  await setWaitingOn(run, mark());
  askReread();
  const read = (await loadRuns()).runs.find((r) => r.dir === run.dir);
  assert.deepEqual(read.waitOn, mark());
  rmSync(file(run));
  askReread();
  assert.equal((await loadRuns()).runs.find((r) => r.dir === run.dir).waitOn, null);
});

test("blank text sets nothing and leaves the field open", () => {
  const run = runIn();
  readPrs(run, [pr()]);
  const view = viewOn(run, "   ");
  submitReply(view, cx());
  assert.equal(existsSync(file(run)), false);
  assert.equal(shared(SAID), null);
  assert.equal(view.replying, waitOnId(run));
});

test("the poll clears a mark that let go, and it does not come back", async () => {
  let run = runIn();
  readPrs(run, [pr()]);
  // Marked as the reply field does, with the step's signature.
  const c = cx();
  submitReply(viewOn(run, "Kari — preview check"), c);
  await settle(c);
  run = reread(run);
  await observeWaits([run], facts());
  assert.ok(waitingOnOf(run), "still applies: kept");
  assert.ok(existsSync(file(run)));
  // A reviewer is requested: the mark goes; removing the request again does not bring it back.
  readPrs(run, [pr({ requested: ["anna"] })]);
  assert.equal(attentionOf(run, facts()).dropWait, true);
  await observeWaits([run], facts());
  assert.equal(existsSync(file(run)), false);
  assert.equal(waitingOnOf(run), null, "cleared at once, before the next read");
  run = reread(run);
  readPrs(run, [pr()]);
  assert.equal(attentionOf(run, facts()).group, "needs");
});

test("an unreadable PR read or a machine that did not answer keeps the mark; a closed run's is cleared; clearing by hand", async () => {
  let run = runIn();
  readPrs(run, [pr()]);
  await setWaitingOn(run, mark());
  run = reread(run);
  setShared("harbormaster.prs", { [run.key]: { list: [pr()], at: Date.now(), error: "gh failed" } });
  await observeWaits([run], facts());
  assert.ok(existsSync(file(run)));
  // Its machine did not answer: the run is carried from the last read, closed or not.
  await observeWaits([{ ...run, stale: true, away: { how: "closed", at: 1 } }], facts());
  assert.ok(existsSync(file(run)));
  // Cleared by hand (the card's and pane's Not waiting any more).
  await setWaitingOn(run, null);
  assert.equal(waitingOnOf(run), null);
  assert.equal(existsSync(file(run)), false);
  // Closed.
  await setWaitingOn(run, mark());
  run = reread(run);
  await observeWaits([{ ...run, away: { how: "closed", at: 1 } }], facts());
  assert.equal(existsSync(file(run)), false);
});

test("a write that fails shows the run as its files say, and Enter says why", async () => {
  const run = runIn();
  readPrs(run, [pr()]);
  globalThis.__herdrExec = async () => ({ code: 1, stdout: "", stderr: "Permission denied" });
  await assert.rejects(setWaitingOn(run, mark()), /Permission denied/);
  assert.equal(waitingOnOf(run), null);
  const view = viewOn(run, "Kari");
  const c = cx();
  submitReply(view, c);
  await settle(c);
  assert.equal(waitingOnOf(run), null);
  assert.equal(view.actionNote.text, "Not marked waiting on Kari: Permission denied");
});

test("what was said is let go once the files agree, or after a while when they never do", async () => {
  const run = runIn();
  await setWaitingOn(run, mark());
  // A read from before the write still shows no mark: what was said holds.
  await observeWaits([run], facts());
  assert.equal(waitingOnOf(run).text, "Kari");
  await observeWaits([run], facts(), Date.now() + SAID_MS + 1000);
  assert.equal(waitingOnOf(run), null);
});

test("marks kept in shared state before waiting-on.json move into the files of the runs read", async () => {
  const run = runIn();
  const other = "lab:/r/acme/x";
  setShared("harbormaster.waitingOn", { [run.key]: mark({ text: "Bo" }), [other]: mark() });
  await observeWaits([run], facts());
  assert.equal(parseWait(readFileSync(file(run), "utf8")).text, "Bo");
  // The run on a machine not read yet keeps its old mark until it is.
  assert.deepEqual(Object.keys(shared("harbormaster.waitingOn")), [other]);
  // A run that already has a file keeps it; the old mark just goes.
  setShared("harbormaster.waitingOn", { [run.key]: mark({ text: "Cy" }) });
  await observeWaits([reread(run)], facts());
  assert.equal(parseWait(readFileSync(file(run), "utf8")).text, "Bo");
  assert.equal(shared("harbormaster.waitingOn"), null);
});

test("Enter on a run whose step changed meanwhile sets nothing, closes the field and says why", () => {
  const run = runIn();
  readPrs(run, [pr()]);
  const view = viewOn(run, "Kari — preview check");
  // A reviewer was requested before Enter: review from, Waiting on others already.
  readPrs(run, [pr({ requested: ["anna"] })]);
  submitReply(view, cx());
  assert.equal(existsSync(file(run)), false);
  assert.equal(view.replying, null);
  assert.equal(view.actionNote.text, "Not marked waiting on Kari — preview check: it no longer waits on you for that step");
  // Red CI beside it: still Needs you, for more than that step.
  readPrs(run, [pr({ checks: { pass: 2, fail: 1, pending: 0 }, ci: { startedAt: Date.now() - 60000, finishedAt: Date.now() - 30000 } })]);
  const again = viewOn(run, "Kari");
  submitReply(again, cx());
  assert.equal(existsSync(file(run)), false);
  assert.match(again.actionNote.text, /^Not marked waiting on Kari: it now needs you for red CI on #1397 · request review/);
});
