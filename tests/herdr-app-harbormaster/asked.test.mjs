// Handle them on one PR keeps the rest in Needs you (t17): the asked PRs leave the step, not the
// run; their rows read "asked…"; Handle all asks the rest; the asked state holds while the PR's
// comments are unchanged.
// Run: node --import ./loader.mjs --test asked.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, nextStepText } from "../../herdr-app/mods/harbormaster/attention.js";
import { needActions } from "../../herdr-app/mods/harbormaster/needaction.js";
import { rowLead, badgeOf } from "../../herdr-app/mods/harbormaster/crewrows.js";
import { toastParts, parkedLabel } from "../../herdr-app/mods/harbormaster/tell.js";
import { askedEntry, askedUrls, markAsked, unmarkAsked, prunedAsked, offersAll, askAllLabel, ASKED_KEEP_MS } from "../../herdr-app/mods/harbormaster/comments.js";

const MIN = 60000;
const now = Date.parse("2026-11-17T12:00:00Z");
const ago = (m) => now - m * MIN;

const run = (o = {}) => ({
  key: ":/r/x", dir: "/r/x", folder: "/p/snevagten", repo: "snevagten", phase: "running", statusLine: "running", progress: "t1 implementing",
  tasks: [], prs: [{ url: "a" }, { url: "b" }], question: null, ask: null, askedAt: null, away: null, updated: ago(60), started: ago(300),
  terminal: "w/orch", localTerminal: true, autonomy: "L1", ...o,
});
const cm = (count, ids) => ({ count, bots: {}, items: ids.map((thread) => ({ thread, text: thread, kind: "thread" })) });
const pr = (number, count, o = {}) => ({
  number, state: "OPEN", review: "APPROVED", approvedBy: ["mfalkenbrink"], changesBy: [], requested: [], checks: { pass: 3, fail: 0, pending: 0 },
  url: `https://github.com/o/r/pull/${number}`, repo: "o/r", ci: { startedAt: ago(90), finishedAt: ago(80) }, reviewedAt: ago(500),
  comments: cm(count, Array.from({ length: count }, (_, i) => `t${number}-${i}`)), ...o,
});
const list = () => [pr(1799, 2), pr(1372, 9)];
const read = (l) => ({ list: l, readable: true, why: null });
const at = (r, l, o = {}) => assess(r, { orch: "working", working: true, pr: read(l), flow: "peer", now, ...o });
const box = (r, l, o = {}) => needActions(at(r, l, o), { run: r, prs: l, now });
const asking = (...urls) => new Set(urls);

test("one PR asked, the orchestrator working: still Needs you, over the other PR only", () => {
  const l = list();
  const a = at(run(), l, { askedPrs: asking(l[0].url) });
  assert.equal(a.group, "needs");
  assert.deepEqual(a.next.prs.map((p) => p.number), [1372]);
  assert.deepEqual(a.next.asked.map((p) => p.number), [1799]);
  assert.equal(a.reasons[0].key, "approved — merge");
  assert.equal(a.reasons[0].text, "approved · 9 comments");
});

test("its box has #1799 as asked… and #1372 with its buttons", () => {
  const l = list();
  const [it] = box(run(), l, { askedPrs: asking(l[0].url) });
  assert.equal(it.line, "Approved by mfalkenbrink 8h20m ago with 9 comments on #1372: address them, then merge");
  const of = (row) => it.actions.filter((x) => x.row === row).map((x) => x.kind === "address" ? x.label : x.kind);
  assert.deepEqual(of("#1799"), ["asked", "open"]);
  assert.deepEqual(of("#1372 · 9 comments"), ["Ask me", "Handle them", "open"]);
  // Only one PR left to ask: no all-row.
  assert.ok(!it.actions.some((x) => x.kind === "address-all"));
});

test("both PRs asked and working: the run is Working, as before", () => {
  const l = list();
  const a = at(run(), l, { askedPrs: asking(l[0].url, l[1].url) });
  assert.equal(a.group, "working");
  assert.equal(a.reasons[0].key, "working");
});

test("nobody asked and working: Working, as before", () => {
  assert.equal(at(run(), list()).group, "working");
});

test("#1799's comments change after the ask: it counts again", () => {
  const l = list();
  const store = markAsked({}, run(), [l[0]], now);
  assert.ok(askedEntry(store, l[0], now));
  const moved = [pr(1799, 3), l[1]];
  assert.ok(!askedEntry(store, moved[0], now));
  const a = at(run(), moved, { askedPrs: askedUrls(store, moved, now) });
  // Neither is asked now: working, no reason.
  assert.equal(a.group, "working");
  // The stale entry is pruned.
  assert.deepEqual(prunedAsked(store, moved, now), {});
});

test("with both un-asked, not working: both rows with buttons and Handle all after them", () => {
  const [it] = box(run(), list(), { working: false, orch: "idle" });
  const all = it.actions.filter((x) => x.kind === "address-all");
  assert.deepEqual(all.map((x) => x.label), ["Ask me about all", "Handle all"]);
  assert.deepEqual(all.map((x) => x.primary), [true, false]);
  assert.equal(it.actions.at(-1).kind, "address-all");
  assert.equal(all[0].prs.length, 2);
  // L2 highlights Handle all.
  const [l2] = box(run({ autonomy: "L2" }), list(), { working: false, orch: "idle" });
  assert.deepEqual(l2.actions.filter((x) => x.kind === "address-all").map((x) => x.primary), [false, true]);
  // The per-PR buttons are then not highlighted: one primary in the box.
  assert.ok(!l2.actions.some((x) => x.kind === "address" && x.primary));
});

test("a single PR run has no Handle all, and its box is as before", () => {
  const one = [pr(42, 3)];
  const [it] = box(run({ prs: [{ url: "a" }] }), one, { working: false, orch: "idle" });
  assert.deepEqual(it.actions.map((x) => x.label), ["Ask me", "Handle them", "Open #42"]);
  assert.ok(!offersAll([one[0]]));
  assert.ok(offersAll(list()));
  assert.equal(askAllLabel("ask"), "Ask me about all");
});

test("marking all asks each PR; a failed send unmarks only that PR", () => {
  const l = list();
  const store = markAsked({}, run(), l, now);
  assert.deepEqual([...askedUrls(store, l, now)].sort(), l.map((p) => p.url).sort());
  const less = unmarkAsked(store, l[0].url);
  assert.deepEqual([...askedUrls(less, l, now)], [l[1].url]);
  assert.equal(unmarkAsked(less, "nope"), less);
});

test("asks older than a week, or for a merged PR, are pruned; unread comments never prune", () => {
  const l = list();
  const store = markAsked({}, run(), l, now);
  assert.equal(prunedAsked(store, l, now), store);
  assert.deepEqual(Object.keys(prunedAsked(store, l, now + ASKED_KEEP_MS + 1)), []);
  assert.deepEqual(Object.keys(prunedAsked(store, [{ ...l[0], state: "MERGED" }, l[1]], now)), [l[1].url]);
  assert.equal(prunedAsked(store, [{ ...l[0], comments: { error: "x" } }, l[1]], now), store);
});

test("the pill, the Crew lead, the parked label and the toast say the same", () => {
  const l = list();
  const r = run();
  const a = at(r, l, { askedPrs: asking(l[0].url) });
  assert.equal(badgeOf(a, false).label, "approved · 9 comments");
  assert.ok(rowLead(a, now).lead.startsWith("approved · 9 comments"), rowLead(a, now).lead);
  const parked = { how: "parked", at: ago(120) };
  assert.ok(parkedLabel(at(run({ away: parked }), l, { askedPrs: asking(l[0].url), working: false }), parked, now).startsWith("approved · 9 comments"));
  assert.ok(toastParts(r, a).parts.some((p) => p.text.includes("approved · 9 comments")), JSON.stringify(toastParts(r, a)));
  assert.equal(nextStepText(a.next), "approved · 9 comments");
});
