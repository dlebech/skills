// Telling the user (tell.js): the toast transition rule (seed, hold, dedupe, carry-over while
// PRs can't be read, pruning), decisions new since you looked, and parked runs' texts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess } from "../../herdr-app/mods/harbormaster/attention.js";
import { toastParts, nextToasts, toastText, TOAST_HOLD, latestDecision, newDecisions, newSinceText, nextSeen, parkedLabel, parkedHeading, openPrsLabel } from "../../herdr-app/mods/harbormaster/tell.js";

const MIN = 60000;
const now = Date.parse("2026-11-16T12:00:00Z");
const ago = (m) => now - m * MIN;

const run = (o = {}) => ({
  key: ":/r/x", dir: "/r/x", folder: "/p/skills", repo: "skills", phase: "running", statusLine: "running",
  progress: "watching CI", tasks: [], prs: [{ url: "u1" }], question: null, ask: null, askedAt: null, away: null,
  updated: ago(60), started: ago(300), decided: [], ...o,
});
const pr = (o = {}) => ({
  number: 42, state: "OPEN", review: null, approvedBy: [], changesBy: [], requested: [], checks: { pass: 3, fail: 0, pending: 0 },
  url: "u1", repo: "o/skills", ci: { startedAt: ago(90), finishedAt: ago(80) }, reviewedAt: null, ...o,
});
const read = (list) => ({ list, readable: true, why: null });
const att = (r, o = {}) => assess(r, { orch: "idle", working: false, pr: read([pr()]), now, since: ago(20), ...o });
const seenOf = (r, a) => ({ key: r.key, ...toastParts(r, a) });

// ---- toastParts ----

test("toastParts: a question, an approval to merge and red CI each become a part with its own id", () => {
  const q = run({ question: "q", ask: { title: "Which groups?" }, askedAt: ago(5), phase: "waiting", statusLine: "waiting for user: Which groups?" });
  const p = toastParts(q, att(q, { orch: "idle" }));
  assert.equal(p.known, true);
  assert.ok(p.parts.some((x) => x.id === `question:${ago(5)}` && x.text === "Asks you: Which groups?"), JSON.stringify(p.parts));

  const ap = run({ phase: "finished", prs: [{ url: "u1" }, { url: "u2" }] });
  const a = att(ap, { flow: "peer", pr: read([pr({ number: 1799, approvedBy: ["anna"] }), pr({ number: 1372, url: "u2", approvedBy: ["anna"] })]) });
  assert.deepEqual(toastParts(ap, a).parts, [{ id: "pr/approved — merge:#1799,#1372", text: "#1799, #1372 approved — merge" }]);

  const red = run();
  const ra = att(red, { pr: read([pr({ checks: { pass: 1, fail: 2, pending: 0 } })]) });
  assert.ok(toastParts(red, ra).parts.some((x) => x.id === "pr/red-ci:red CI on #42" && x.text === "Red CI on #42"));
});

test("toastParts: a finished run with no PR and a gone orchestrator are told; a stall is not", () => {
  const fin = run({ phase: "finished", prs: [] });
  assert.deepEqual(toastParts(fin, att(fin, { pr: read([]) })).parts.map((x) => x.id), ["finished"]);
  const gone = run({ prs: [] });
  assert.deepEqual(toastParts(gone, att(gone, { orch: "gone", pr: read([]) })).parts.map((x) => x.id), ["gone"]);
  const quiet = run({ prs: [] });
  const qa = att(quiet, { pr: read([]), stall: { quietMs: 40 * MIN, by: "quiet" } });
  assert.equal(qa.group, "needs");
  assert.deepEqual(toastParts(quiet, qa).parts, []);
});

test("toastParts: not in Needs you, or parked, has no parts; unreadable files are unknown; unreadable PRs are not prKnown", () => {
  const w = run();
  assert.deepEqual(toastParts(w, att(w, { working: true })), { known: true, prKnown: true, parts: [] });
  const parked = run({ away: { how: "parked", at: ago(10) }, phase: "finished" });
  assert.deepEqual(toastParts(parked, att(parked, { flow: "peer", pr: read([pr({ approvedBy: ["anna"] })]) })).parts, []);
  const off = run();
  assert.equal(toastParts(off, att(off, { filesOk: false })).known, false);
  const cant = run();
  const ca = att(cant, { pr: { list: null, readable: false, why: "gh failed" } });
  assert.deepEqual(toastParts(cant, ca), { known: false, prKnown: false, parts: [] });
  const q = run({ question: "q", ask: { title: "Ok?" }, askedAt: ago(1), phase: "waiting", statusLine: "waiting for user: Ok?" });
  const qa = att(q, { pr: { list: null, readable: false, why: "gh failed" } });
  const p = toastParts(q, qa);
  assert.equal(p.known, true);
  assert.equal(p.prKnown, false);
  assert.equal(p.parts[0].text, "Asks you: Ok?");
});

// ---- nextToasts ----

const s = (key, ids, o = {}) => ({ key, known: true, prKnown: true, parts: ids.map((id) => ({ id, text: `T ${id}` })), ...o });

test("nextToasts: a run seen for the first time is seeded silently, even when it already needs you", () => {
  const { store, toasts } = nextToasts(null, [s(":/a", ["question:1"]), s(":/b", [])], now);
  assert.deepEqual(toasts, []);
  assert.deepEqual(store[":/a"], { told: ["question:1"], cand: ["question:1"], since: now });
  // Held long after: still nothing, it was told (seeded) already.
  assert.deepEqual(nextToasts(store, [s(":/a", ["question:1"]), s(":/b", [])], now + 10 * MIN).toasts, []);
});

test("nextToasts: a new reason toasts once it has held for the hold time, and only once", () => {
  let { store } = nextToasts(null, [s(":/a", [])], now);
  ({ store } = nextToasts(store, [s(":/a", ["question:1"])], now + 5000));
  let r = nextToasts(store, [s(":/a", ["question:1"])], now + 5000 + TOAST_HOLD - 1);
  assert.deepEqual(r.toasts, []);
  r = nextToasts(r.store, [s(":/a", ["question:1"])], now + 5000 + TOAST_HOLD, { me: "A" });
  assert.deepEqual(r.toasts, [{ key: ":/a", parts: [{ id: "question:1", text: "T question:1" }] }]);
  assert.equal(r.store[":/a"].by, "A");
  assert.equal(r.store[":/a"].at, now + 5000 + TOAST_HOLD);
  const again = nextToasts(r.store, [s(":/a", ["question:1"])], now + 20 * MIN);
  assert.deepEqual(again.toasts, []);
  assert.equal(again.store, r.store, "unchanged store is the same object (no shared write)");
});

test("nextToasts: a reason that flaps away and back inside the hold is not told again", () => {
  let { store } = nextToasts(null, [s(":/a", ["gone"])], now);
  ({ store } = nextToasts(store, [s(":/a", [])], now + 10000));
  ({ store } = nextToasts(store, [s(":/a", ["gone"])], now + 30000));
  const r = nextToasts(store, [s(":/a", ["gone"])], now + 30000 + TOAST_HOLD);
  assert.deepEqual(r.toasts, []);
});

test("nextToasts: a reason that went for good and comes back later is news again; a reason leaving alone tells nothing", () => {
  let { store } = nextToasts(null, [s(":/a", ["pr/red-ci:#42"])], now);
  ({ store } = nextToasts(store, [s(":/a", [])], now + MIN));
  let r = nextToasts(store, [s(":/a", [])], now + 3 * MIN);
  assert.deepEqual(r.toasts, []);
  assert.deepEqual(r.store[":/a"].told, []);
  ({ store } = nextToasts(r.store, [s(":/a", ["pr/red-ci:#42"])], now + 10 * MIN));
  r = nextToasts(store, [s(":/a", ["pr/red-ci:#42"])], now + 12 * MIN);
  assert.deepEqual(r.toasts.map((x) => x.parts.map((p) => p.id)), [["pr/red-ci:#42"]]);
});

test("nextToasts: a second question is a new part; only the new one is told", () => {
  let { store } = nextToasts(null, [s(":/a", ["pr/approved — merge:#1"])], now);
  ({ store } = nextToasts(store, [s(":/a", ["pr/approved — merge:#1", "question:2"])], now + MIN));
  const r = nextToasts(store, [s(":/a", ["pr/approved — merge:#1", "question:2"])], now + 3 * MIN);
  assert.deepEqual(r.toasts[0].parts.map((p) => p.id), ["question:2"]);
});

test("nextToasts: while PRs can't be read, their reasons stand; a run never read is not seeded", () => {
  let { store } = nextToasts(null, [s(":/a", ["pr/approved — merge:#1"])], now);
  // gh fails: only the question is read; the approval is carried, so it is not told again later.
  const cant = s(":/a", ["question:9"], { prKnown: false });
  ({ store } = nextToasts(store, [cant], now + MIN));
  assert.deepEqual(store[":/a"].cand, ["pr/approved — merge:#1", "question:9"]);
  let r = nextToasts(store, [cant], now + 3 * MIN);
  assert.deepEqual(r.toasts[0].parts.map((p) => p.id), ["question:9"]);
  r = nextToasts(r.store, [s(":/a", ["pr/approved — merge:#1", "question:9"])], now + 4 * MIN);
  assert.deepEqual(r.toasts, []);
  // Never read, PRs unknown: left alone, so the first good read seeds it.
  const fresh = nextToasts(null, [s(":/b", [], { prKnown: false })], now);
  assert.deepEqual(fresh.store, null);
  // Files unknown: left as it is.
  const kept = nextToasts(r.store, [s(":/a", [], { known: false })], now + 9 * MIN);
  assert.equal(kept.store, r.store);
});

test("nextToasts: a run gone from a machine that answered is forgotten; one on a machine that failed is kept", () => {
  const store = { ":/a": { told: [], cand: [], since: now }, "box:/b": { told: [], cand: [], since: now } };
  const r = nextToasts(store, [], now, { failed: ["box"] });
  assert.deepEqual(Object.keys(r.store), ["box:/b"]);
});

test("toastText: the run's name, and its new reasons joined", () => {
  assert.deepEqual(toastText("#985 · Road routes", [{ text: "Asks you: Ok?" }, { text: "Red CI on #4" }]),
    { title: "#985 · Road routes", body: "Asks you: Ok? · Red CI on #4" });
});

// ---- decisions new since you looked ----

const d = (m) => ({ by: "decided", at: m == null ? null : ago(m), decision: "x", raw: `x${m}` });

test("newDecisions counts lines newer than when the user last looked; none before the run was seen", () => {
  const list = [d(1), d(5), d(30), d(null)];
  assert.equal(newDecisions(list, ago(10)).length, 2);
  assert.equal(newDecisions(list, null).length, 0);
  assert.equal(newDecisions(list, ago(0)).length, 0);
  assert.equal(latestDecision(list), ago(1));
  assert.equal(latestDecision([]), 0);
  assert.equal(newSinceText(7), "7 new since you looked");
  assert.equal(newSinceText(0), null);
});

test("nextSeen seeds a new run at its newest decision, keeps known ones and prunes gone runs", () => {
  const a = run({ key: ":/a", decided: [d(3), d(9)] });
  const b = run({ key: ":/b", decided: [] });
  const st = nextSeen(null, [a, b]);
  assert.deepEqual(st, { ":/a": ago(3), ":/b": 0 });
  assert.equal(nextSeen(st, [a, b]), st);
  // A run with no decisions yet that gets some: all of them are new.
  assert.equal(newDecisions([d(1), d(2)], st[":/b"]).length, 2);
  assert.deepEqual(nextSeen(st, [a]), { ":/a": ago(3) });
  assert.deepEqual(nextSeen({ "box:/c": 5 }, [], { failed: ["box"] }), { "box:/c": 5 });
  // A stale (carried) run is not seeded.
  assert.equal(nextSeen({}, [run({ key: "box:/d", stale: true, decided: [d(1)] })], { failed: ["box"] }).hasOwnProperty("box:/d"), false);
});

// ---- parked runs ----

test("parkedLabel says what a parked run's PRs wait on and how long it has been parked", () => {
  const r = run({ phase: "finished", away: { how: "parked", at: ago(3 * 24 * 60) } });
  const a = att(r, { flow: "peer", pr: read([pr({ approvedBy: ["anna"] })]) });
  assert.equal(parkedLabel(a, r.away, now), "approved — merge · 3d0h");
  const none = run({ prs: [], away: { how: "parked", at: ago(5) } });
  assert.equal(parkedLabel(att(none, { pr: read([]) }), none.away, now), null);
  const cant = att(r, { pr: { list: null, readable: false, why: "x" } });
  assert.equal(parkedLabel(cant, r.away, now), null);
});

test("parkedHeading and openPrsLabel name the parked runs' open PRs", () => {
  assert.equal(parkedHeading(3, 2), "Parked · 3 · 2 with open PRs");
  assert.equal(parkedHeading(3, 0), "Parked · 3");
  assert.equal(openPrsLabel(2, 0, 4), "open PRs (+4 parked)");
  assert.equal(openPrsLabel(1, 0, 0), "open PR");
  assert.equal(openPrsLabel(3, 1, 2), "open PRs · 1 failing (+2 parked)");
});
