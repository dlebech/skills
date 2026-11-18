// The Needs-you queue shared by the sidebar and the Bridge (queue.js): its order with the captain's
// decisions among the entries, its keys and what a decision's one button does.
// Run: node --import ./loader.mjs --test queue.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { needQueue, queueKey, decisionAction, expandedItem } from "../../herdr-app/mods/harbormaster/queue.js";
import { groupRows } from "../../herdr-app/mods/harbormaster/crewrows.js";
import { stats } from "../../herdr-app/mods/harbormaster/data.js";

const entry = (key, reason, waitSince) => ({ r: { key, dir: `/runs/${key}` }, term: null, a: { group: "needs", reasons: [{ key: reason }], waitSince } });
const dec = (id, since, extra = {}) => ({ id: `dec-:${id}`, kind: "decision", title: `Q ${id}`, options: [{ label: "Yes", text: "" }, { label: "No", text: "" }], recommended: 0, since, run: null, decision: { id }, ...extra });
const keys = (list) => list.map(queueKey);

test("without decisions the entries keep their order exactly", () => {
  const entries = groupRows([entry("c", "stalled", 5), entry("a", "question", 9), entry("b", "red-ci", 1)]).needs;
  assert.deepEqual(keys(needQueue(entries, [])), keys(entries.map((x) => ({ kind: "entry", x }))));
  assert.deepEqual(needQueue([], []), []);
});

test("a decision ranks as a question: among the questions by wait, before anything less important", () => {
  const entries = groupRows([entry("ci", "red-ci", 1), entry("q-old", "question", 10), entry("q-new", "question", 50), entry("stalled", "stalled", 2)]).needs;
  const q = needQueue(entries, [dec("d", 30)]);
  assert.deepEqual(keys(q), ["q-old", "dec-:d", "q-new", "ci", "stalled"]);
  // Waited longest of all: first. Asked just now: after the questions, still before red CI.
  assert.deepEqual(keys(needQueue(entries, [dec("d", 5)])).slice(0, 2), ["dec-:d", "q-old"]);
  assert.deepEqual(keys(needQueue(entries, [dec("d", 99)])), ["q-old", "q-new", "dec-:d", "ci", "stalled"]);
});

test("several decisions: longest waiting first, ties by key, whatever order they come in", () => {
  const entries = groupRows([entry("ci", "red-ci", 1)]).needs;
  const a = needQueue(entries, [dec("b", 20), dec("a", 20), dec("c", 10)]);
  assert.deepEqual(keys(a), ["dec-:c", "dec-:a", "dec-:b", "ci"]);
  assert.deepEqual(keys(needQueue(entries, [dec("c", 10), dec("a", 20), dec("b", 20)])), keys(a));
  // Same wait as a question entry: a stable tie by key.
  assert.deepEqual(keys(needQueue(groupRows([entry("q", "question", 20)]).needs, [dec("a", 20)])), ["dec-:a", "q"]);
});

test("nothing but the items themselves moves the order", () => {
  const entries = groupRows([entry("q", "question", 10), entry("ci", "red-ci", 1)]).needs;
  const ds = [dec("a", 5)];
  assert.deepEqual(keys(needQueue(entries, ds)), keys(needQueue([...entries].reverse(), ds)));
});

test("a decision without a time waits last among questions", () => {
  const entries = groupRows([entry("q", "question", 10), entry("ci", "red-ci", 1)]).needs;
  assert.deepEqual(keys(needQueue(entries, [dec("n", null)])), ["q", "dec-:n", "ci"]);
});

test("a decision's button: with a captain, its recommended option, else open the captain", () => {
  assert.deepEqual(decisionAction(dec("a", 1), { captain: true }), { kind: "answer", option: 0 });
  assert.deepEqual(decisionAction(dec("a", 1, { recommended: 1 }), { captain: true }), { kind: "answer", option: 1 });
  assert.deepEqual(decisionAction(dec("a", 1, { options: [], recommended: null }), { captain: true }), { kind: "open" });
  assert.deepEqual(decisionAction(dec("a", 1, { recommended: null }), { captain: true }), { kind: "open" });
  // Even naming a run, with a captain it goes to the captain.
  assert.deepEqual(decisionAction(dec("a", 1, { run: {} }), { captain: true }), { kind: "answer", option: 0 });
});

test("a decision's button with no captain: the same answer for a named run, else start the captain", () => {
  assert.deepEqual(decisionAction(dec("a", 1, { run: { key: "r" } }), { captain: false }), { kind: "answer", option: 0 });
  assert.deepEqual(decisionAction(dec("a", 1), { captain: false }), { kind: "start-captain" });
  assert.deepEqual(decisionAction(dec("a", 1, { options: [], recommended: null }), { captain: false }), { kind: "start-captain" });
  assert.deepEqual(decisionAction(dec("a", 1, { run: { key: "r" }, options: [], recommended: null }), { captain: false }), { kind: "open" });
});

test("the box opens the clicked item while it is queued, else the first that can open: a decision, or an entry with a run directory", () => {
  const e = (key, dir = "/r/" + key) => ({ kind: "entry", x: { r: { key, dir }, term: { address: "t" + key }, a: {} } });
  const list = [e("a"), e("b"), e("c")];
  assert.equal(expandedItem(list, "b"), list[1]);
  assert.equal(expandedItem(list, "gone"), list[0], "a clicked run that left Needs you falls back to the first");
  assert.equal(expandedItem(list, undefined), list[0]);
  const runless = { kind: "entry", x: { r: null, term: { address: "t9" }, a: {} } };
  assert.equal(expandedItem([runless, list[1]], null), list[1], "an orchestrator without a run directory stays a compact row");
  assert.equal(expandedItem([runless], "t9"), null);
  assert.equal(expandedItem([], "a"), null);
  const d = { kind: "decision", it: dec("x", 1) };
  assert.equal(expandedItem([runless, d], null), d);
  assert.equal(expandedItem([list[0], d], "dec-:x"), d);
});
