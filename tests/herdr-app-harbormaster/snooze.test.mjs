// Snoozing a "Next for you" row (snooze.js): the rules with a fake clock, and the file round trip.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetShared, shared } from "herdr";
import { SNOOZE_CHOICES, SNOOZE_KEY, kindOf, parseSnoozed, pruneSnoozed, splitSnoozed, withSnooze, withoutUrls, setSnooze, wakeSnoozes, loadSnoozed, snoozed, mergeSnoozed } from "../../herdr-app/mods/harbormaster/snooze.js";

const HOUR = 3600000;
const it = (o = {}) => ({ kind: "mine", url: "https://github.com/o/r/pull/1", reason: "approved — merge", age: 5, ...o });
const choice = (k) => SNOOZE_CHOICES.find((c) => c.key === k);
const t0 = new Date(2026, 10, 18, 14, 0, 0).getTime();

beforeEach(() => { resetShared(); delete globalThis.__herdrWrite; delete globalThis.__herdrRead; delete globalThis.__herdrMachines; globalThis.__herdrExec = async () => ({ code: 0, stdout: "/root", stderr: "" }); });

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

test("waking leaves a tombstone until the entry's own time, which shows the item", () => {
  const map = withSnooze(withSnooze({}, it(), t0 + HOUR, t0), it(), null, t0 + 1);
  assert.deepEqual(map, { [it().url]: { until: t0 + HOUR, reason: "", at: t0 + 1, off: true } });
  assert.equal(splitSnoozed([it()], map, t0 + 2).shown.length, 1);
  assert.deepEqual(splitSnoozed([it()], map, t0 + 2).woke, []);
  assert.deepEqual(pruneSnoozed(map, t0 + HOUR), {});
  // nothing to wake: no tombstone
  assert.deepEqual(withSnooze({}, it(), null, t0), {});
});

test("two machines' maps merge: the newest change per PR wins, a wake beats an older snooze", () => {
  const a = withSnooze({}, it(), t0 + 4 * HOUR, t0);
  const b = withSnooze({}, it({ url: "u2" }), t0 + HOUR, t0);
  const both = mergeSnoozed(a, b, t0);
  assert.deepEqual(Object.keys(both).sort(), [it().url, "u2"].sort());
  const woken = withSnooze(a, it(), null, t0 + 10);
  assert.equal(mergeSnoozed(a, woken, t0 + 20)[it().url].off, true);
  assert.equal(mergeSnoozed(woken, a, t0 + 20)[it().url].off, true);
  // a later snooze beats the tombstone
  const again = withSnooze(woken, it(), t0 + 8 * HOUR, t0 + 30);
  assert.equal(mergeSnoozed(woken, again, t0 + 40)[it().url].off, undefined);
  // an old file (no `at`) still counts, and loses to any stamped change
  const old = { [it().url]: { until: t0 + HOUR, reason: "approved — merge" } };
  assert.equal(mergeSnoozed(old, woken, t0 + 20)[it().url].off, true);
  assert.deepEqual(mergeSnoozed({}, old, t0), old);
});

test("loadSnoozed merges the other machines' files and writes back where they lack something", async () => {
  const files = {
    local: JSON.stringify({ a: { until: Date.now() + HOUR, reason: "x", at: 1 } }),
    desk: JSON.stringify({ b: { until: Date.now() + HOUR, reason: "y" } }),
  };
  globalThis.__herdrMachines = [{ name: null, layout: "ready" }, { name: "desk", layout: "ready" }, { name: "off", layout: "unavailable" }];
  globalThis.__herdrRead = async (_p, o) => { assert.ok(!o?.on, "another machine's file is read through sh, with a timeout"); return files.local; };
  globalThis.__herdrWrite = async (_p, text) => { files.local = text; };
  const asked = [];
  globalThis.__herdrExec = async (_c, args, o) => {
    asked.push(o?.on ?? null);
    if (args[1].includes("mv -f")) files[o.on] = args[4];
    if (args[1].includes('cat "$1"')) { assert.ok(o.timeout > 0); return { code: 0, stdout: files[o.on], stderr: "" }; }
    return { code: 0, stdout: "/root", stderr: "" };
  };
  await loadSnoozed();
  assert.deepEqual(Object.keys(snoozed()).sort(), ["a", "b"]);
  assert.deepEqual(Object.keys(parseSnoozed(files.local)).sort(), ["a", "b"]);
  assert.deepEqual(Object.keys(parseSnoozed(files.desk)).sort(), ["a", "b"]);
  assert.ok(!asked.includes("off"));
});

test("a snooze is pushed to the other machines too", async () => {
  const files = { local: "{}", desk: "{}" };
  globalThis.__herdrMachines = [{ name: "desk", layout: "ready" }];
  globalThis.__herdrRead = async () => files.local;
  globalThis.__herdrWrite = async (_p, text) => { files.local = text; };
  globalThis.__herdrExec = async (_c, args, o) => {
    if (args[1].includes("mv -f")) files[o.on] = args[4];
    if (args[1].includes('cat "$1"')) return { code: 0, stdout: files[o.on], stderr: "" };
    return { code: 0, stdout: "/root", stderr: "" };
  };
  await setSnooze(it(), Date.now() + HOUR);
  assert.equal(parseSnoozed(files.desk)[it().url].reason, "approved — merge");
  await setSnooze(it(), null);
  assert.equal(parseSnoozed(files.desk)[it().url].off, true);
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
  // and it is written once, for all urls, as a tombstone (times from now: the file write prunes what is up)
  const now = Date.now();
  const live = withSnooze({}, it(), now + 4 * HOUR, now);
  const file = { text: JSON.stringify(live), writes: 0 };
  globalThis.__herdrRead = async () => file.text;
  globalThis.__herdrWrite = async (_p, text) => { file.text = text; file.writes++; };
  await wakeSnoozes([it().url, "u-other"], now + 1);
  assert.equal(file.writes, 1);
  assert.deepEqual(parseSnoozed(file.text)[it().url], { until: now + 4 * HOUR, reason: "", at: now + 1, off: true });
});

test("one more new comment is the same kind and stays snoozed", () => {
  assert.equal(kindOf("1 new comment"), kindOf("2 new comments"));
  assert.notEqual(kindOf("approved — merge"), kindOf("CI failed"));
  const map = withSnooze({}, it({ reason: "1 new comment" }), t0 + 4 * HOUR, t0);
  assert.equal(splitSnoozed([it({ reason: "2 new comments" })], map, t0 + HOUR).snoozed.length, 1);
  assert.equal(splitSnoozed([it({ reason: "changes requested" })], map, t0 + HOUR).shown.length, 1);
});
