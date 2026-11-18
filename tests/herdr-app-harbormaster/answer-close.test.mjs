// An answer (the answer kind through askClick, its asked state in the shared store), Compact and
// Close (data.js) on inbox.js: the files they write, the notes, and what stays asked.
// Run: node --import ./loader.mjs --test answer-close.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetShared } from "herdr";
import { askClick } from "../../herdr-app/mods/harbormaster/askclick.js";
import { asked, unmarkAsked, markAsked, pruneAsked, askedStore, NOT_ANSWERS } from "../../herdr-app/mods/harbormaster/inbox.js";
import { sendAnswer } from "../../herdr-app/mods/harbormaster/overview.js";
import { compactRun, putAway } from "../../herdr-app/mods/harbormaster/data.js";
import { noteText } from "../../herdr-app/mods/harbormaster/note.js";
import { withRoot } from "./root.mjs";

let root, hc;
beforeEach(() => { resetShared(); hc = []; root = mkdtempSync(join(tmpdir(), "hm-ans-")); withRoot(root); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); delete globalThis.__herdrExec; delete globalThis.__herdrTerminals; delete globalThis.__herdrAgents; });

const runIn = (o = {}) => {
  const dir = join(root, "skills", "feat-x");
  mkdirSync(dir, { recursive: true });
  return { key: ":" + dir, dir, branch: "feat-x", terminal: "t99", localTerminal: "t99", statusLine: "running", progress: "p", tasks: [], phase: "running", ...o };
};
const files = (run) => { try { return readdirSync(join(run.dir, "inbox")).filter((f) => f.endsWith(".message")); } catch { return []; } };
const text = (run, f) => readFileSync(join(run.dir, "inbox", f), "utf8");
// The orchestrator is live (hc stubbed, calls kept); `status` is what the window reports, `wake` hc run's exit code.
const live = (status, wake = 0) => {
  const real = globalThis.__herdrExec;
  globalThis.__herdrTerminals = [{ address: "t99", state: "live", labels: { role: "orchestrator" } }];
  globalThis.__herdrAgents = [{ address: "t99", status }];
  globalThis.__herdrExec = async (cmd, args, o) => {
    if (cmd === "sh") return real(cmd, args, o);
    if (cmd === "sleep") return { code: 0, stdout: "", stderr: "" };
    hc.push(args);
    return args[0] === "get" ? { code: 0, stdout: JSON.stringify({ state: "live" }), stderr: "" }
      : { code: wake, stdout: "{}", stderr: wake ? 'no terminal "t99"' : "" };
  };
};
const IT = (o = {}) => ({ id: "need-:x", kind: "run", title: "Q?", since: 1000, run: null, ...o });
// The real sendAnswer (overview.js) with a fake view and cx: `dropped` collects dropDecision's calls
// through the DROP script (a decision's answer drops it from .captain-decisions.json).
const answer = async (run, it, { text = "Yes", option = false } = {}) => {
  const view = { actionError: "old", redraw: false, load: async () => {} };
  let done, marked;
  const cx = { notify: () => { marked ??= asked(run, "answer", it.id, it); }, spawn: (f) => { done = f(cx); } };
  const sent = sendAnswer(view, it, text, cx, option);
  await done;
  return { view, marked, sent, dropped: dropFile() };
};
const decisions = (ids) => writeFileSync(join(root, ".captain-decisions.json"), JSON.stringify(ids.map((id) => ({ id }))));
const dropFile = () => { try { return JSON.parse(readFileSync(join(root, ".captain-decisions.json"), "utf8")).map((d) => d.id); } catch { return null; } };

const DEC = (run, o = {}) => IT({ id: "dec-:d1", kind: "decision", run, decision: { id: "d1", machine: undefined }, ...o });

test("answer: marked before the first redraw, written as an answer, asked survives a reload", async () => {
  live("idle");
  const run = runIn(), it = IT({ run });
  const { view, marked, sent } = await answer(run, it);
  assert.equal(sent, true);
  assert.equal(marked, true);
  assert.equal(view.actionError, null);
  assert.equal(noteText(view), null, "an answer sets no note");
  const [f] = files(run);
  assert.match(f, /-harbormaster\.message$/);
  assert.equal(text(run, f), 'Answer to "Q?": Yes\n');
  assert.equal(asked(runIn(), "answer", it.id, it), true, "a reload: a fresh run object, the same store");
  assert.equal(asked(run, "answer", it.id, IT({ since: 2000 })), false, "a new question clears it");
});

test("answer: a failure before the inbox unmarks it and shows the error; a decision is not dropped", async () => {
  live("idle");
  decisions(["d1"]);
  const run = runIn({ dir: join(root, "nope", "\0bad") }), it = DEC(run);
  const { view, dropped } = await answer(run, it);
  assert.match(view.actionError, /^feat-x: /);
  assert.equal(asked(run, "answer", it.id, it), false);
  assert.deepEqual(dropped, ["d1"]);
});

test("answer: the wake failing leaves it answered, shows the error and still drops a decision", async () => {
  live("idle", 1);
  decisions(["d1", "d2"]);
  const run = runIn(), it = DEC(run);
  const { view, dropped } = await answer(run, it);
  assert.match(view.actionError, /^feat-x: the message is in its inbox, but its orchestrator could not be told/);
  assert.equal(asked(run, "answer", it.id, it), true);
  assert.deepEqual(dropped, ["d2"]);
});

test("answer: a decision is dropped after a successful send; a run's question has nothing to drop", async () => {
  live("idle");
  decisions(["d1", "d2"]);
  const run = runIn();
  const { view, dropped } = await answer(run, DEC(run));
  assert.deepEqual(dropped, ["d2"]);
  assert.equal(view.actionError, null);
  assert.deepEqual((await answer(run, IT({ run }))).dropped, ["d2"]);
});

// ---- the hooks askClick gives Compact (via, after, onError), and sendAnswer's Compact wiring ----

const BUDGET = (run) => IT({ id: "need-:b", kind: "budget", title: "Over budget: 1 of 1 tokens", run });

test("Compact from the click: /compact typed, the answer written, no note, asked stays", async () => {
  live("idle");
  const run = runIn(), it = BUDGET(run);
  const { view, marked } = await answer(run, it, { text: "Compact", option: true });
  assert.equal(marked, true);
  assert.equal(view.actionError, null);
  assert.equal(noteText(view), null);
  assert.equal(text(run, files(run)[0]), 'Answer to "Over budget: 1 of 1 tokens": Compact\n');
  assert.equal(hc[0].at(-1), "/compact");
  assert.equal(asked(run, "answer", it.id, it), true);
});

test("Compact from the click: refused while not idle, shows that error and unmarks", async () => {
  live("working");
  const run = runIn(), it = BUDGET(run);
  const { view } = await answer(run, it, { text: "Compact", option: true });
  assert.equal(view.actionError, "feat-x: not compacted: its orchestrator is not idle or done");
  assert.equal(asked(run, "answer", it.id, it), false);
  assert.deepEqual(files(run), []);
});

test("Compact typed as a reply, or on another question, is an ordinary answer (no /compact)", async () => {
  live("idle");
  const run = runIn();
  await answer(run, BUDGET(run), { text: "Compact", option: false });
  await answer(run, IT({ run }), { text: "Compact", option: true });
  assert.equal(files(run).length, 2);
  assert.deepEqual(hc.filter((a) => a.at(-1) === "/compact"), []);
});

test("askClick via: success runs after and no note; a plain throw unmarks; an inInbox throw stays marked, onError before the error shows", async () => {
  const click = async (via, run, it) => {
    const order = [];
    const view = { actionError: null, redraw: false, load: async () => {} };
    let done;
    const cx = { notify: () => {}, spawn: (f) => { done = f(cx); } };
    askClick(view, cx, run, "answer", { title: "Q?", answer: "Yes" }, { asks: [{ key: it.id, item: it }], via,
      after: async () => { order.push("after"); },
      onError: async () => { order.push(`onError:${view.actionError}`); } });
    await done;
    return { view, order };
  };
  const run = runIn(), it = IT({ run });
  let r = await click(async () => ({ outcome: "sent" }), run, it);
  assert.deepEqual(r.order, ["after"]);
  assert.equal(noteText(r.view), null);
  assert.equal(asked(run, "answer", it.id, it), true);
  unmarkAsked(run, "answer", it.id);
  r = await click(async () => { throw new Error("nope"); }, run, it);
  assert.deepEqual(r.order, ["onError:null"], "onError runs before the error shows");
  assert.equal(r.view.actionError, "feat-x: nope");
  r = await click(async () => { throw Object.assign(new Error("in inbox"), { inInbox: true }); }, run, it);
  assert.equal(r.view.actionError, "feat-x: in inbox");
});

test("answer: prune drops it when the question is a new one, or the item is gone; keeps it otherwise", () => {
  const run = runIn(), it = IT();
  const keeps = (item) => { resetShared(); markAsked(run, "answer", it.id, it); pruneAsked([run], { lookup: () => item }); return Object.keys(askedStore()).length === 1; };
  assert.equal(keeps(it), true);
  assert.equal(keeps(IT({ since: 5 })), false);
  assert.equal(keeps(false), false);
  assert.equal(keeps(undefined), true);
});

test("compact: the answer is written as an answer, /compact typed, then the wake", async () => {
  live("idle");
  const run = runIn();
  const out = await compactRun(run, "Budget?", "Compact");
  assert.equal(out.blocked, false);
  const [f] = files(run);
  assert.match(f, /-harbormaster\.message$/);
  assert.equal(text(run, f), 'Answer to "Budget?": Compact\n');
  assert.deepEqual(hc.map((a) => a[0]), ["run", "get", "run"]);
  assert.equal(hc[0].at(-1), "/compact");
});

test("compact: refused while the orchestrator is not idle, writing nothing", async () => {
  live("working");
  const run = runIn();
  await assert.rejects(compactRun(run, "Budget?", "Compact"), /not compacted: its orchestrator is not idle or done/);
  assert.deepEqual(files(run), []);
});

test("close: written as harbormaster-close with the same text; the notes say cleaning up, or blocked", async () => {
  const closeText = "The user closed this run in Harbormaster. Clean up and close your tab, as in your skill's section 9 (Close).";
  live("idle");
  let run = runIn();
  assert.equal(await putAway(run, "closed", "idle"), "its orchestrator is cleaning up, and its tab closes when done");
  let [f] = files(run);
  assert.match(f, /-harbormaster-close\.message$/);
  assert.equal(text(run, f), closeText + "\n");
  live("blocked");
  run = runIn({ dir: join(root, "skills", "feat-y"), key: ":y" });
  mkdirSync(run.dir, { recursive: true });
  assert.equal(await putAway(run, "closed", "blocked"), "its orchestrator is blocked on a dialog: answer it in its tab, and it then cleans up and closes");
});

test("close: an orchestrator that is gone fails the wake as before, never reporting waits; the message stays in the inbox", async () => {
  // No live terminal in the window: the answer kind would report waits, Close tries the wake.
  const real = globalThis.__herdrExec;
  globalThis.__herdrExec = async (cmd, args, o) => (cmd === "sh" ? real(cmd, args, o) : { code: 1, stdout: "", stderr: 'no terminal "t99"' });
  const run = runIn();
  await assert.rejects(putAway(run, "closed", "idle"), (e) => e.inInbox === true && /^the message is in its inbox, but its orchestrator could not be told: no terminal "t99"$/.test(e.message));
  assert.match(files(run)[0], /-harbormaster-close\.message$/);
});

test("a close has no unread prefix: NOT_ANSWERS is the string it always was", () => {
  assert.equal(NOT_ANSWERS, "^(set (autonomy|proof tier) to |prove [^ ]+( to T[0-3])?: |what is blocking\\?|address comments on |changes asked from Harbormaster: |re-review asked from Harbormaster:)");
});

test("answer: an after that throws leaves it answered and shows no error", async () => {
  const run = runIn(), it = IT({ run });
  const f = { actionError: "old", redraw: false, load: async () => {} };
  let done;
  const cx = { notify: () => {}, spawn: (g) => { done = g(cx); } };
  askClick(f, cx, run, "answer", { title: it.title, answer: "Yes" }, { asks: [{ key: it.id, item: it }], after: () => { throw new Error("drop broke"); }, onError: () => unmarkAsked(run, "answer", it.id) });
  await done;
  assert.equal(f.actionError, null);
  assert.equal(asked(run, "answer", it.id, it), true);
});
