// The branch-level `Reviewed:` line (claims.js reviewedLine, proof.js parseProofMd), #48.
// Run: node --import ./loader.mjs --test reviewed.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewedLine, reviewedState, claimsVerdict, claimsAsk } from "../../herdr-app/mods/harbormaster/claims.js";
import { parseProofMd } from "../../herdr-app/mods/harbormaster/proof.js";

const md = (lines) => parseProofMd(`# Proof\nTier: T2\nChecks: green — ok\n${lines}\n\n## C1 Thing\nResult: pass — ok\nShot: a.png\n`);

test("parses repeatable Reviewed lines in the header", () => {
  const m = md("Reviewed: 3def855 task t9b — 3 must-fix fixed\nReviewed: 4AD8528 final review — 9 findings, all fixed\nReviewed: nonsense");
  assert.deepEqual(m.reviewed, [
    { sha: "3def855", what: "task t9b", result: "3 must-fix fixed" },
    { sha: "4ad8528", what: "final review", result: "9 findings, all fixed" },
  ]);
  assert.deepEqual(md("").reviewed, []);
});

test("current: the latest final review at the branch's HEAD, or the same tree", () => {
  const m = md("Reviewed: 4ad8528 final review — fixed\nReviewed: 5555555 task t2 — ok");
  const gap = { sha: "4ad8528", count: 0, same: true };
  assert.deepEqual([reviewedLine(m, gap).text, reviewedLine(m, gap).tone], ["Reviewed · final review at 4ad8528", "dim"]);
  const same = reviewedLine(m, { sha: "4ad8528", count: 3, same: true });
  assert.equal(same.text, "Reviewed · final review at 4ad8528");
  assert.equal(reviewedLine(m, null).tone, "dim"); // not read yet: no false alarm
});

test("commits since: amber, with the count", () => {
  const m = md("Reviewed: 4ad8528 final review — fixed");
  const l = reviewedLine(m, { sha: "4ad8528", count: 5, same: false });
  assert.deepEqual([l.text, l.tone, l.since], ["Reviewed at 4ad8528 · 5 commits since, not reviewed", "amber", 5]);
  assert.equal(reviewedLine(m, { sha: "4ad8528", count: 1, same: false }).text, "Reviewed at 4ad8528 · 1 commit since, not reviewed");
  // A gap read for another sha says nothing about this one.
  assert.equal(reviewedLine(m, { sha: "9999999", count: 5, same: false }).tone, "dim");
});

test("no Reviewed line: nothing for old runs, dim 'not reviewed' for a finished run with claims", () => {
  const m = md("");
  assert.equal(reviewedLine(m, null), null);
  assert.equal(reviewedLine(m, null, { finished: true }), null);
  assert.deepEqual(reviewedLine(m, null, { finished: true, claims: true }), { text: "not reviewed", tone: "dim", tip: "proof.md has no Reviewed line", since: 0 });
  assert.equal(reviewedLine(null, null), null);
});

test("the verdict counts commits since the review; the merge ask carries the line", () => {
  const r = { phase: "working", tasks: [], reviewedGap: { sha: "4ad8528", count: 2, same: false },
    proof: { claims: [{ id: "C1", text: "Thing", ac: null, tasks: [], bar: null }], md: md("Reviewed: 4ad8528 final review — fixed"), files: null, tier: { tier: 2 } } };
  const ask = claimsAsk(r);
  assert.equal(ask.reviewed.tone, "amber");
  assert.ok(ask.verdict.parts.some((p) => p.text === "2 commits not reviewed" && p.tone === "amber"));
  assert.equal(claimsVerdict(ask.worthALook, { reviewed: null }).parts.some((p) => /not reviewed/.test(p.text)), false);
});

test("task reviews alone never measure the gap: dim 'not reviewed (branch)', the count in the hover", () => {
  const m = md("Reviewed: a1b2c3d task t1 — ok\nReviewed: b2c3d4e task t2 — ok");
  const l = reviewedLine(m, { sha: "b2c3d4e", count: 7, same: false });
  assert.deepEqual([l.text, l.tone, l.since], ["not reviewed (branch)", "dim", 0]);
  assert.match(l.tip, /2 task reviews/);
});

test("a gap git could not read is unknown, not current", () => {
  const m = md("Reviewed: 4ad8528 final review — fixed");
  const l = reviewedLine(m, { sha: "4ad8528", count: 0, same: null });
  assert.deepEqual([l.text, l.tone, l.since], ["Reviewed at 4ad8528", "dim", 0]);
  assert.match(l.tip, /could not compare with the branch/i);
});

test("reviewedState: the same rules as reviewedLine, as plain facts", () => {
  const m = (l) => parseProofMd(`# Proof\nTier: T2\n${l}\n\n## C1 Thing\nResult: pass — ok\nShot: a.png\n`);
  assert.equal(reviewedState(m("")).kind, "none");
  assert.equal(reviewedState(m("Reviewed: abc1234 task t1 — pass")).kind, "task-only");
  const fin = m("Reviewed: abc1234 final review — pass");
  assert.deepEqual(reviewedState(fin), { kind: "current", behind: null, sha: "abc1234", compared: false });
  assert.deepEqual(reviewedState(fin, { sha: "abc1234", count: 2, same: false }), { kind: "behind", behind: 2, sha: "abc1234", compared: true });
  assert.equal(reviewedState(fin, { sha: "abc1234", count: 0, same: false }).kind, "current");
  assert.equal(reviewedState(fin, { sha: "abc1234", count: 0, same: true }).compared, true);
  assert.equal(reviewedState(fin, { sha: "abc1234", count: 0, same: null }).compared, false);
  assert.equal(reviewedState(fin, { sha: "ffff", count: 3, same: false }).kind, "current");
});
