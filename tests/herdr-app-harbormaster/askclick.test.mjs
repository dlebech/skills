// The click every ask button shares (askclick.js): with a fake view and cx, each outcome of a
// send sets the note or error, redraws and reloads, and leaves the ask asked or not as before.
// Run: node --import ./loader.mjs --test askclick.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetShared } from "herdr";
import { askClick } from "../../herdr-app/mods/harbormaster/askclick.js";
import { asked, askedStore } from "../../herdr-app/mods/harbormaster/inbox.js";
import { noteText } from "../../herdr-app/mods/harbormaster/note.js";
import { withRoot } from "./root.mjs";

let root;
beforeEach(() => { resetShared(); root = mkdtempSync(join(tmpdir(), "hm-click-")); withRoot(root); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); delete globalThis.__herdrExec; delete globalThis.__herdrTerminals; delete globalThis.__herdrAgents; });

const runIn = (o = {}) => {
  const dir = join(root, "skills", "feat-x");
  mkdirSync(dir, { recursive: true });
  return { key: ":" + dir, dir, branch: "feat-x", terminal: "t99", localTerminal: "t99", statusLine: "running", progress: "p", tasks: [], blockingAsked: false, changesAsked: false, ...o };
};
// A cx whose spawn runs the callback and lets the test wait for it.
const fake = () => {
  const calls = { notify: 0, load: 0, before: 0 };
  let done;
  const cx = { notify: () => { calls.notify++; }, spawn: (f) => { done = f(cx); } };
  const view = { actionError: "old", redraw: false, load: async () => { calls.load++; } };
  return { cx, view, calls, finished: () => done };
};
const NOTES = { waits: "waits note", blocked: "blocked note", sent: "sent note" };
const click = async (run, kind, payload, opts) => {
  const f = fake();
  askClick(f.view, f.cx, run, kind, payload, opts);
  await f.finished();
  return f;
};

test("a gone orchestrator: the ask waits, the note says so, and it reads asked", async () => {
  const run = runIn();
  const f = await click(run, "blocking", { quiet: "5m" }, { asks: [{ key: "", item: run }], notes: NOTES });
  assert.equal(f.view.actionError, null);
  assert.equal(noteText(f.view), "feat-x: waits note");
  assert.equal(f.view.redraw, true);
  assert.equal(f.calls.load, 1);
  assert.equal(f.calls.notify, 2);
  assert.equal(asked(run, "blocking", "", run), true);
});

// An orchestrator that is live, with hc stubbed: `status` is what the window reports for it
// ("blocked" is on a dialog), `wake` is the exit code of hc run.
const live = (status, wake = 0) => {
  const real = globalThis.__herdrExec;
  globalThis.__herdrTerminals = [{ address: "t99", state: "live", labels: { role: "orchestrator" } }];
  globalThis.__herdrAgents = [{ address: "t99", status }];
  globalThis.__herdrExec = async (cmd, args, o) => {
    if (cmd === "sh") return real(cmd, args, o);
    return args[0] === "get" ? { code: 0, stdout: JSON.stringify({ state: "live" }), stderr: "" }
      : { code: wake, stdout: "{}", stderr: wake ? 'no terminal "t99"' : "" };
  };
};

test("the ask is marked asked as the click returns, before the spawned body runs", () => {
  const run = runIn();
  const calls = { notify: 0 };
  const cx = { notify: () => { calls.notify++; }, spawn: () => {} };
  askClick({ load: async () => {} }, cx, run, "blocking", { quiet: "5m" }, { asks: [{ key: "", item: run }], notes: NOTES });
  assert.equal(asked(run, "blocking", "", run), true);
  assert.equal(Object.keys(askedStore()).length, 1);
});

test("sent: the orchestrator was told; changes notes it, an ask with no `sent` note shows none", async () => {
  live("idle");
  const run = runIn();
  let f = await click(run, "changes", { text: "make it green" }, { notes: NOTES });
  assert.equal(noteText(f.view), "feat-x: sent note");
  assert.equal(f.view.actionError, null);
  assert.equal(f.view.redraw, true);
  assert.equal(f.calls.load, 1);
  f = await click(run, "blocking", { quiet: "5m" }, { asks: [{ key: "", item: run }], notes: { waits: "w", blocked: "b" } });
  assert.equal(noteText(f.view), null);
  assert.equal(asked(run, "blocking", "", run), true);
});

test("blocked: the orchestrator is on a dialog, so the blocked note shows and the ask stays asked", async () => {
  live("blocked");
  const run = runIn();
  const f = await click(run, "ci", { pr: 4, check: "build", url: null }, { asks: [{ key: "", item: run }], notes: NOTES });
  assert.equal(noteText(f.view), "feat-x: blocked note");
  assert.equal(f.view.actionError, null);
  assert.equal(f.calls.load, 1);
  assert.equal(asked(run, "ci", "", run), true);
});

test("a failure after the inbox (the wake failed): the error shows and the ask stays asked", async () => {
  live("idle", 3);
  const run = runIn();
  const f = await click(run, "blocking", { quiet: "5m" }, { asks: [{ key: "", item: run }], notes: NOTES });
  assert.equal(f.view.actionError, 'feat-x: the message is in its inbox, but its orchestrator could not be told: no terminal "t99"');
  assert.equal(noteText(f.view), null);
  assert.equal(f.view.redraw, true);
  assert.equal(f.calls.load, 1);
  assert.equal(asked(run, "blocking", "", run), true);
});

test("a click that reaches no inbox: the mark existed during the send, then it is taken back, the error shows", async () => {
  const run = runIn({ dir: "/proc/none/x" });
  const f = fake();
  askClick(f.view, f.cx, run, "ci", { pr: 4, check: "build", url: null }, { asks: [{ key: "", item: run }], notes: NOTES });
  assert.equal(Object.keys(askedStore()).length, 1, "marked while the send is under way");
  assert.equal(asked(run, "ci", "", run), true);
  await f.finished();
  assert.match(f.view.actionError, /^feat-x: /);
  assert.equal(noteText(f.view), null);
  assert.equal(f.view.redraw, true);
  assert.equal(f.calls.load, 1);
  assert.equal(Object.keys(askedStore()).length, 0);
  assert.equal(asked(run, "ci", "", run), false);
});

test("changes: marks nothing and runs `before` first; a gone orchestrator notes waits", async () => {
  const run = runIn({ terminal: undefined });
  let order = [];
  const f = fake();
  f.view.load = async () => { order.push("load"); };
  askClick(f.view, f.cx, run, "changes", { text: "make it green" }, { before: () => order.push("before"), notes: NOTES });
  await f.finished();
  assert.deepEqual(order, ["before", "load"]);
  assert.equal(noteText(f.view), "feat-x: waits note");
  assert.equal(asked(run, "changes", "", run), false);
});

test("an empty change is an error, not a note", async () => {
  const run = runIn();
  const f = await click(run, "changes", { text: "  " }, { notes: NOTES });
  assert.equal(f.view.actionError, "feat-x: say what to change");
});

// `after` and `onError` are the button's own; a throwing `after` is not a failed send.
test("a throwing after: the send's outcome stands, no error, no onError, still asked", async () => {
  const run = runIn();
  let onError = 0;
  const f = await click(run, "blocking", { quiet: "5m" }, {
    asks: [{ key: "", item: run }], notes: NOTES,
    after: () => { throw new Error("after broke"); }, onError: () => { onError++; },
  });
  assert.equal(f.view.actionError, null);
  assert.equal(onError, 0);
  assert.equal(noteText(f.view), "feat-x: waits note");
  assert.equal(asked(run, "blocking", "", run), true);
  assert.equal(f.calls.load, 1);
});
