// Snoozing a "Next for you" row (snooze.js): the rules with a fake clock, and the file round trip.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetShared, shared } from "herdr";
import { SNOOZE_CHOICES, SNOOZE_KEY, kindOf, parseSnoozed, pruneSnoozed, splitSnoozed, withSnooze, withoutUrls, setSnooze, wakeSnoozes, loadSnoozed, snoozed } from "../../herdr-app/mods/harbormaster/snooze.js";

const HOUR = 3600000;
const it = (o = {}) => ({ kind: "mine", url: "https://github.com/o/r/pull/1", reason: "approved — merge", age: 5, ...o });
const choice = (k) => SNOOZE_CHOICES.find((c) => c.key === k);
const t0 = new Date(2026, 10, 18, 14, 0, 0).getTime();

beforeEach(() => { resetShared(); delete globalThis.__herdrWrite; delete globalThis.__herdrRead; globalThis.__herdrExec = async () => ({ code: 0, stdout: "/root", stderr: "" }); });

test("a snoozed item is hidden, and comes back when its time is up", () => {
  const map = withSnooze({}, it(), t0 + HOUR, t0);
  assert.deepEqual(splitSnoozed([it()], map, t0 + 59 * 60000).snoozed.length, 1);
  assert.equal(splitSnoozed([it()], map, t0 + 59 * 60000).shown.length, 0);
  const later = splitSnoozed([it()], map, t0 + HOUR + 1);
  assert.equal(later.shown.length, 1);
  assert.equal(later.snoozed.length, 0);
});

test("a changed reason wakes it; the same reason (and a moved age) keeps it hidden", () => {
  const map = withSnooze({}, it(), t0 + 4 * HOUR, t0);
  assert.equal(splitSnoozed([it({ age: 999 })], map, t0 + HOUR).shown.length, 0);
  assert.equal(splitSnoozed([it({ reason: "changes requested" })], map, t0 + HOUR).shown.length, 1);
  assert.equal(splitSnoozed([it({ reason: "CI failed" })], map, t0 + HOUR).shown.length, 1);
});

test("snoozes are per PR url, and the lists keep their order", () => {
  const a = it(), b = it({ url: "u2" }), c = it({ url: "u3" });
  const { shown, snoozed: z } = splitSnoozed([a, b, c], withSnooze({}, b, t0 + HOUR, t0), t0);
  assert.deepEqual(shown.map((x) => x.url), [a.url, "u3"]);
  assert.deepEqual(z.map((x) => x.url), ["u2"]);
});

test("waking removes the entry", () => {
  const map = withSnooze(withSnooze({}, it(), t0 + HOUR, t0), it(), null, t0);
  assert.deepEqual(map, {});
});

test("Tomorrow 9:00 is 9:00 local the next day, also just before and after midnight", () => {
  const at = (...a) => new Date(...a).getTime();
  assert.equal(choice("tomorrow").until(at(2026, 10, 18, 14, 0)), at(2026, 10, 19, 9, 0));
  assert.equal(choice("tomorrow").until(at(2026, 10, 18, 23, 59, 59)), at(2026, 10, 19, 9, 0));
  assert.equal(choice("tomorrow").until(at(2026, 10, 19, 0, 0, 1)), at(2026, 10, 20, 9, 0));
  assert.equal(choice("tomorrow").until(at(2026, 11, 31, 22, 0)), at(2027, 0, 1, 9, 0));
  assert.equal(choice("1h").until(t0), t0 + HOUR);
  assert.equal(choice("4h").until(t0), t0 + 4 * HOUR);
});

test("a missing or unreadable file is nothing snoozed, and bad entries are dropped", () => {
  assert.deepEqual(parseSnoozed(""), {});
  assert.deepEqual(parseSnoozed("{nope"), {});
  assert.deepEqual(parseSnoozed("[1]"), {});
  assert.deepEqual(parseSnoozed(JSON.stringify({ a: { until: 5, reason: "x" }, b: { until: "no" }, c: 3 })), { a: { until: 5, reason: "x" } });
});

test("the file round trip: written with the new entry, an expired one dropped, a read gives it back", async () => {
  const file = { text: JSON.stringify({ old: { until: Date.now() - 1000, reason: "x" }, keep: { until: Date.now() + HOUR, reason: "CI failed" } }) };
  globalThis.__herdrRead = async () => file.text;
  globalThis.__herdrWrite = async (path, text) => { file.path = path; file.text = text; };
  await setSnooze(it(), Date.now() + 4 * HOUR);
  assert.equal(file.path, "/root/.snoozed.json");
  const back = parseSnoozed(file.text);
  assert.deepEqual(Object.keys(back).sort(), ["keep", it().url].sort());
  assert.equal(back[it().url].reason, "approved — merge");
  assert.deepEqual(shared(SNOOZE_KEY), back);
  // a restart: the store is empty, the file is read
  resetShared();
  await loadSnoozed();
  assert.deepEqual(snoozed(), back);
});

test("an unreadable file at start leaves nothing snoozed", async () => {
  globalThis.__herdrRead = async () => { throw new Error("gone"); };
  await loadSnoozed();
  assert.deepEqual(snoozed(), {});
});

test("pruneSnoozed drops what is up", () => {
  assert.deepEqual(pruneSnoozed({ a: { until: t0, reason: "r" }, b: { until: t0 + 1, reason: "r" } }, t0), { b: { until: t0 + 1, reason: "r" } });
});

test("a woken item stays awake when the old reason comes back before its time is up", async () => {
  const map = withSnooze({}, it(), t0 + 4 * HOUR, t0);
  const woke = splitSnoozed([it({ reason: "CI failed" })], map, t0 + HOUR);
  assert.equal(woke.shown.length, 1);
  assert.deepEqual(woke.woke, [it().url]);
  // the caller drops the entry (one write); the old reason then shows
  const after = withoutUrls(map, woke.woke, t0 + HOUR);
  const back = splitSnoozed([it()], after, t0 + 2 * HOUR);
  assert.equal(back.shown.length, 1);
  assert.deepEqual(back.woke, []);
  // and it is written once, for all urls
  const file = { text: JSON.stringify(map) };
  globalThis.__herdrRead = async () => file.text;
  globalThis.__herdrWrite = async (_p, text) => { file.text = text; };
  await wakeSnoozes([it().url], t0 + HOUR);
  assert.deepEqual(parseSnoozed(file.text), {});
});

test("one more new comment is the same kind and stays snoozed", () => {
  assert.equal(kindOf("1 new comment"), kindOf("2 new comments"));
  assert.notEqual(kindOf("approved — merge"), kindOf("CI failed"));
  const map = withSnooze({}, it({ reason: "1 new comment" }), t0 + 4 * HOUR, t0);
  assert.equal(splitSnoozed([it({ reason: "2 new comments" })], map, t0 + HOUR).snoozed.length, 1);
  assert.equal(splitSnoozed([it({ reason: "changes requested" })], map, t0 + HOUR).shown.length, 1);
});
