// The Next-for-you section as drawn (crew.js nextSection through crew(view, t)): the count, the
// `snoozed · n` line, everything snoozed, the Later menu and Wake. The gh caches are filled
// through a stubbed exec.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetShared, shared, setShared } from "herdr";
import { find } from "gpui-kit";
import { crew } from "../../herdr-app/mods/harbormaster/crew.js";
import { refreshReviews } from "../../herdr-app/mods/harbormaster/reviews.js";
import { refreshMine } from "../../herdr-app/mods/harbormaster/mypr.js";
import { SNOOZE_KEY } from "../../herdr-app/mods/harbormaster/snooze.js";

const t = new Proxy({}, { get: () => "#888" });
const prs = [1, 2, 3].map((n) => ({ number: n, title: `pr ${n}`, url: `https://github.com/o/r/pull/${n}`, author: { login: "x" }, updatedAt: "2026-11-01T00:00:00Z", repository: { nameWithOwner: "o/r" } }));
const text = (e) => (e && typeof e === "object" && "kids" in e ? e.kids.map(text).join("") : typeof e === "string" ? e : "");
const cx = { notify() {}, stop_propagation() {} };
let view;
const draw = () => crew(view, t);

beforeEach(async () => {
  resetShared();
  view = { runs: [], decisions: [], folds: new Map() };
  globalThis.__herdrWrite = async () => null;
  globalThis.__herdrRead = async () => "";
  globalThis.__herdrExec = ghAnswer(true);
  await refreshReviews(true);
  await refreshMine(true);
});
// gh: the review search lists the PRs; the graphql call is empty, or fails when `mineOk` is false.
const ghAnswer = (mineOk) => async (cmd, args) => cmd !== "gh" ? { code: 0, stdout: "/root", stderr: "" }
  : args[0] === "api" ? (mineOk ? { code: 0, stdout: JSON.stringify({ data: { viewer: { login: "me", pullRequests: { nodes: [] } } } }), stderr: "" } : { code: 1, stdout: "", stderr: "x" })
  : { code: 0, stdout: JSON.stringify(prs), stderr: "" };

const snoozeAll = (n) => { const m = {}; for (const p of prs.slice(0, n)) m[p.url] = { until: Date.now() + 3600000, reason: "review requested · x" }; return m; };

test("the count is the unsnoozed rows, and a dim snoozed line says how many are hidden", () => {
  setShared(SNOOZE_KEY, snoozeAll(1));
  const d = draw();
  assert.match(text(find(d, "crew-group-next")), /Next for you · 2/);
  assert.match(text(find(d, "crew-next-snoozed-toggle")), /snoozed · 1/);
  assert.equal(find(d, "crew-next-z0"), null); // folded
  view.folds.set("crew-next-snoozed", true);
  assert.ok(find(draw(), "crew-next-z0-wake"));
});

test("with everything snoozed only the snoozed line is left, no header", () => {
  setShared(SNOOZE_KEY, snoozeAll(3));
  const d = draw();
  assert.equal(find(d, "crew-group-next"), null);
  assert.match(text(find(d, "crew-next-snoozed-toggle")), /snoozed · 3/);
});

test("Later opens the three choices, × closes it, a choice snoozes, Wake brings it back", () => {
  setShared(SNOOZE_KEY, {});
  find(draw(), "crew-next-0-later").click({}, cx);
  assert.equal(view.laterOpen, prs[0].url);
  const menu = find(draw(), "crew-next-0-later-menu");
  assert.deepEqual(["tomorrow", "1h", "4h"].map((k) => text(find(menu, `crew-next-0-later-${k}`))), ["Tomorrow 9:00", "1 h", "4 h"]);
  find(menu, "crew-next-0-later-close").click({}, cx);
  assert.equal(view.laterOpen, null);
  find(draw(), "crew-next-0-later").click({}, cx);
  find(draw(), "crew-next-0-later-1h").click({}, cx);
  assert.ok(shared(SNOOZE_KEY)[prs[0].url].until > Date.now());
  const d = draw();
  assert.match(text(find(d, "crew-group-next")), /Next for you · 2/);
  view.folds.set("crew-next-snoozed", true);
  find(draw(), "crew-next-z0-wake").click({}, cx);
  assert.equal(shared(SNOOZE_KEY)[prs[0].url]?.off ?? true, true, "woken: no entry, or a tombstone");
  assert.match(text(find(draw(), "crew-group-next")), /Next for you · 3/);
});

test("everything snoozed while GitHub can't be reached still shows the snoozed line, with the error", async () => {
  globalThis.__herdrExec = ghAnswer(false);
  await refreshMine(true);
  setShared(SNOOZE_KEY, snoozeAll(3));
  const d = draw();
  assert.match(text(find(d, "crew-group-next")), /Next for you · \?.*can't reach GitHub/);
  assert.match(text(find(d, "crew-next-snoozed-toggle")), /snoozed · 3/);
});
