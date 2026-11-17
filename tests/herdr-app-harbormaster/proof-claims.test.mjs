// Proof as claims (claims.js, #47): plan.md's `## Claims` and proof.md's `## C<n>` sections, each
// claim's state against its bar, the verdict that names the unproven one, the merge ask, and an
// old run without claims.
// Run: node --import ./loader.mjs --test proof-claims.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlanClaims, claimRows, claimCounts, claimsVerdict, claimsGaps, claimsClean, claimPill, claimActions, claimResultLine, claimProveRequest, checksLine, claimsAsk, claimsSig, hasClaims, withSaid } from "../../herdr-app/mods/harbormaster/claims.js";
import { parseProofMd, pendingProofs } from "../../herdr-app/mods/harbormaster/proof.js";

const PLAN = `# Plan
Proof tier: T2

## Tasks
- t1 drag — Status: done
- t2 save — Status: done
- t3 undo — Status: implementing

## Claims
- C1 Drag a card to reorder the list — AC 3 — tasks t1 — bar T2
- C2 The new order is saved across restarts — AC 4 — tasks t1, t2
- C3 Undo puts the card back — AC 5 — tasks t3
- C4 A guided tour of reordering — AC 6 — tasks t2 — bar T3

## Notes
- C9 not a claim: outside the section
`;

const MD = `# Proof: reorder
Tier: T2
Checks: green — 1497 tests, build, lint, CI

## C1 Drag a card to reorder the list
Result: pass — dragging moves the card
Shot: shared/proof/t1-drag.png, shared/proof/t1-drop.png
Test: reorder moves the card — pass
Test: reorder keeps focus — pass

## C2 The new order is saved across restarts
Result: pass — 2 tests
Test: order persists — pass

## C4 A guided tour of reordering
Result: pass — shots only
Shot: t2-tour.png

## t1 drag
Result: pass — an old-style task section is still a task
`;

const tasks = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
const run = (over = {}) => ({
  tasks, phase: "running",
  proof: { tier: { tier: 2 }, claims: parsePlanClaims(PLAN), md: parseProofMd(MD), files: ["t1-drag.png", "t1-drop.png", "t2-tour.png"], accepted: {}, asks: new Map(), ...over },
});
const STAGES = ["done", "done", "implement"];

test("plan.md's ## Claims: one claim per line, its AC, tasks and bar; nothing outside the section", () => {
  const c = parsePlanClaims(PLAN);
  assert.deepEqual(c.map((x) => x.id), ["C1", "C2", "C3", "C4"]);
  assert.deepEqual(c[0], { id: "C1", text: "Drag a card to reorder the list", ac: "3", tasks: ["t1"], bar: 2 });
  assert.deepEqual(c[1].tasks, ["t1", "t2"]);
  assert.equal(c[1].bar, null, "no bar: the run's tier");
  assert.equal(c[3].bar, 3);
  assert.deepEqual(parsePlanClaims("# Plan\n## Tasks\n- t1 x\n"), [], "an old plan has no claims");
  assert.deepEqual(parsePlanClaims("## Claims\nC1 Just the words\n")[0], { id: "C1", text: "Just the words", ac: null, tasks: [], bar: null });
});

test("proof.md's ## C<n> sections are claims with Shot, Test and Clip lines; task sections stay tasks", () => {
  const md = parseProofMd(MD);
  assert.deepEqual(Object.keys(md.claims), ["C1", "C2", "C4"]);
  assert.deepEqual(md.claims.C1.shots, ["shared/proof/t1-drag.png", "shared/proof/t1-drop.png"]);
  assert.deepEqual(md.claims.C1.tests, [{ name: "reorder moves the card", ok: true }, { name: "reorder keeps focus", ok: true }]);
  assert.equal(md.claims.C2.result, "pass");
  assert.deepEqual(Object.keys(md.tasks), ["t1"]);
  assert.deepEqual(md.checks, { state: "green", text: "1497 tests, build, lint, CI" });
  const clip = parseProofMd("## C1 x\nResult: fail — the drop jumps\nClip: shared/proof/c1.mp4\nTest: drop lands — fail\n").claims.C1;
  assert.deepEqual(clip.clips, ["shared/proof/c1.mp4"]);
  assert.deepEqual(clip.tests, [{ name: "drop lands", ok: false }]);
});

test("each claim against its bar: proven, needs a screenshot or a clip, not proven yet while its tasks are under way", () => {
  const rows = claimRows(run().proof, run(), STAGES);
  assert.deepEqual(rows.map((k) => k.state), ["proven", "below", "pending", "below"]);
  assert.equal(rows[1].tier, 2, "the run's tier is the default bar");
  assert.deepEqual(rows.map((k) => claimPill(k).text), ["proven", "needs a screenshot", "not proven yet", "needs a clip"]);
  assert.equal(claimResultLine(rows[1]), "pass — 2 tests (needs a screenshot)");
  // A screenshot the shared/proof/ listing lacks does not exist.
  const gone = claimRows(run({ files: ["t2-tour.png"] }).proof, run(), STAGES);
  assert.equal(gone[0].state, "below");
  // A T1 claim needs no screenshot.
  assert.equal(claimRows(run({ tier: { tier: 1 } }).proof, run(), STAGES)[1].state, "proven");
});

test("a claim nothing proves once its tasks are done wants a look; once the run is finished, every one does", () => {
  const done = claimRows(run().proof, run(), ["done", "done", "done"]);
  assert.equal(done[2].state, "unproven");
  assert.equal(claimPill(done[2], true).text, "not proven");
  assert.equal(claimRows(run().proof, run(), STAGES, true)[2].state, "unproven");
});

test("the verdict counts claims and names the first unproven one; tier and checks in the hover", () => {
  const rows = claimRows(run().proof, run(), STAGES);
  const v = claimsVerdict(rows, { tier: 2, md: run().proof.md });
  assert.equal(v.text, "1 of 4 proven · not yet: The new order is saved across restarts +2");
  assert.equal(v.tone, "dim");
  assert.match(v.tip, /^Proof tier T2: each claim's bar/);
  assert.match(v.tip, /Whole-branch checks: green — 1497 tests, build, lint, CI/);
  assert.equal(claimsVerdict([], {}), null, "no claims, no verdict");
  const failed = claimRows(run({ md: parseProofMd("## C1 x\nResult: fail — nothing moves\n") }).proof, run(), STAGES);
  assert.equal(claimsVerdict(failed, {}).tone, "blocked");
  assert.match(claimsVerdict(failed, {}).text, /not yet: Drag a card to reorder the list/);
  // A failed claim is named before one that only wants a look.
  const both = claimRows(run({ md: parseProofMd("## C1 a\nResult: partial — half\n## C2 b\nResult: fail — no\n") }).proof, run(), ["done", "done", "done"]);
  assert.match(claimsVerdict(both, {}).text, /not yet: The new order is saved across restarts/);
});

test("every claim proven or accepted is clean; a red check is not", () => {
  const md = parseProofMd(`Checks: green — all\n## C1 a\nResult: pass\nShot: a.png\n## C2 b\nResult: partial — half\n`);
  const p = { tier: { tier: 2 }, claims: parsePlanClaims("## Claims\nC1 a\nC2 b\n"), md, files: ["a.png"], accepted: {}, asks: new Map() };
  let rows = claimRows(p, { tasks: [] }, [], true);
  assert.equal(claimsClean(claimCounts(rows), md.checks), false);
  assert.equal(claimsGaps(rows, md), "1 of 2 proven, not yet: b");
  rows = claimRows({ ...p, accepted: { C2: { at: "2026-11-17T10:00:00Z", result: "partial — half" } } }, { tasks: [] }, [], true);
  assert.equal(rows[1].state, "accepted");
  assert.equal(claimsClean(claimCounts(rows), md.checks), true);
  assert.equal(claimsGaps(rows, md), null);
  assert.equal(claimsClean(claimCounts(rows), { state: "red" }), false);
  // An acceptance is for that result line only: a new result asks again.
  rows = claimRows({ ...p, accepted: { C2: { result: "partial — something else" } } }, { tasks: [] }, [], true);
  assert.equal(rows[1].state, "partial");
});

test("Accept and Ask to prove sit on claim rows; the ask is a 'prove C<n> to T<n>:' inbox line", () => {
  const rows = claimRows(run().proof, run(), STAGES);
  assert.deepEqual(claimActions(rows[0]), [], "a proven claim offers nothing");
  assert.deepEqual(claimActions(rows[2]), [], "nor one still being proved");
  assert.deepEqual(claimActions(rows[1]), ["accept", "ask"]);
  const msg = claimProveRequest(rows[1]);
  assert.equal(msg.split("\n")[0], "prove C2 to T2: pass — 2 tests (needs a screenshot)");
  assert.match(msg.split("\n")[1], /prove claim C2 \("The new order is saved across restarts"\) to T2, with a screenshot/);
  const asks = pendingProofs(msg);
  const asked = claimRows(run({ asks }).proof, run(), STAGES);
  assert.equal(asked[1].asked, true);
  assert.deepEqual(claimActions(asked[1]), ["accept", "asked"]);
});

test("the whole-branch checks are one line, green or red", () => {
  assert.deepEqual(checksLine(parseProofMd("Checks: green — 1497 tests, build, lint, CI\n")),
    { text: "Checks ✓ 1497 tests, build, lint, CI", tone: "pass", tip: "Whole-branch checks: green — 1497 tests, build, lint, CI" });
  assert.equal(checksLine(parseProofMd("Checks: red — lint\n")).text, "Checks ✗ lint");
  assert.equal(checksLine(parseProofMd("## C1 x\n")), null);
});

test("the merge ask: worth-a-look claims first, then proven ones with a thumbnail, at most three and the rest counted", () => {
  const md = parseProofMd(`Checks: green — all
## C1 a
Result: pass
Shot: a.png
## C2 b
Result: fail — broken
## C3 c
Result: partial — half
## C4 d
Result: pass
Shot: d.png
## C5 e
Result: pass — tests only
`);
  const r = { tasks: [], phase: "finished", proof: { tier: { tier: 1 }, claims: parsePlanClaims("## Claims\nC1 a\nC2 b\nC3 c\nC4 d\nC5 e\n"), md, files: ["a.png", "d.png"], accepted: {}, asks: new Map() } };
  const ask = claimsAsk(r);
  assert.deepEqual(ask.worthALook.map((k) => [k.id, k.look]), [["C2", true], ["C3", true], ["C1", false]]);
  assert.equal(ask.more, 2);
  assert.equal(ask.checks, "Checks ✓ all");
  assert.equal(ask.verdict.text, "3 of 5 proven · not yet: b +1");
});

test("an old run without ## Claims has just its checks line", () => {
  const old = { tasks, phase: "finished", proof: { tier: { tier: 2 }, claims: [], md: parseProofMd("Checks: green — 120 tests\n## t1 x\nResult: pass\n"), files: [], accepted: {}, asks: new Map() } };
  assert.equal(hasClaims(old), false);
  assert.deepEqual(claimsAsk(old), { worthALook: [], more: 0, reviewed: null, checks: "Checks ✓ 120 tests", verdict: null });
});

test("the read signature changes with a claim's result or evidence", () => {
  const a = claimsSig(claimRows(run().proof, run(), STAGES));
  const b = claimsSig(claimRows(run({ files: ["t1-drag.png"] }).proof, run(), STAGES));
  assert.notEqual(a, b);
  assert.equal(a, claimsSig(claimRows(run().proof, run(), STAGES)));
});

// ---- review findings (review-t5.md) ----

test("a Test: line's status is the first word after its last ' — ', whatever follows it", () => {
  const t = parseProofMd(`## C1 x
Test: reorder — fail: assertion at line 3
Test: saves — fail (2 of 11)
Test: drag — then drop — pass
Test: just a name
Test: undo ✗
Test: redo — passed, 3 cases
`).claims.C1.tests;
  assert.deepEqual(t, [
    { name: "reorder", ok: false }, { name: "saves", ok: false }, { name: "drag — then drop", ok: true },
    { name: "just a name", ok: true }, { name: "undo ✗", ok: true }, { name: "redo", ok: true },
  ]);
});

test("'## C1: Drag' and '## C1. Drag' in proof.md are claim C1, as in plan.md", () => {
  const md = parseProofMd("## C1: Drag\nResult: pass\n## C2. Save\nResult: fail — no\n## C3) Undo\nResult: partial\n");
  assert.deepEqual(Object.keys(md.claims), ["C1", "C2", "C3"]);
  assert.deepEqual(Object.keys(md.tasks), []);
  assert.equal(md.claims.C2.result, "fail");
});

test("claimsAsk without stages reads each task's own state: a claim whose task is still implementing is not a gap", () => {
  const r = { tasks: [{ id: "t1", state: "merged" }, { id: "t2", state: "merged" }, { id: "t3", state: "implementing" }], phase: "running",
    proof: run().proof };
  const ask = claimsAsk(r);
  assert.ok(!ask.worthALook.some((k) => k.id === "C3"), "C3's task t3 is still implementing");
  assert.equal(claimRows(r.proof, r)[2].state, "pending");
  assert.doesNotMatch(ask.verdict.text, /Undo/);
});

test("a claim's bar is the run's tier or more, never less", () => {
  const p = (plan, tier, md) => ({ tier: tier === null ? null : { tier }, claims: parsePlanClaims(plan), md: parseProofMd(md), files: [], accepted: {}, asks: new Map() });
  const tests = "## C1 x\nResult: pass — tests\n";
  assert.equal(claimRows(p("## Claims\nC1 x — bar T1\n", 2, tests), {}, null, true)[0].tier, 2);
  assert.equal(claimRows(p("## Claims\nC1 x — bar T1\n", 2, tests), {}, null, true)[0].state, "below");
  assert.equal(claimRows(p("## Claims\nC1 x — bar T3\n", 2, tests), {}, null, true)[0].tier, 3);
  assert.equal(claimRows(p("## Claims\nC1 x — bar T1\n", null, tests), {}, null, true)[0].tier, 1);
  assert.equal(claimRows(p("## Claims\nC1 x\n", null, tests), {}, null, true)[0].tier, null);
});

test("Checks with another state than green or red (still running) is a dim line, not dropped", () => {
  const md = parseProofMd("Checks: pending — CI\n");
  assert.deepEqual(md.checks, { state: "pending", text: "CI" });
  assert.deepEqual(checksLine(md), { text: "Checks pending CI", tone: "dim", tip: "Whole-branch checks: pending — CI" });
});

test("a claim's own ' — ' stays in its words; only AC, tasks and bar parts are taken out", () => {
  const [c] = parsePlanClaims("## Claims\n- C2 Save — then reload — AC 2 — tasks t1\n");
  assert.equal(c.text, "Save — then reload");
  assert.equal(c.ac, "2");
  assert.deepEqual(c.tasks, ["t1"]);
});

test("'Tests: 4 passed' is a note, not a test; 'Shots:' and 'Clips:' still count", () => {
  const e = parseProofMd("## C1 x\nTests: 4 passed\nTest: one — pass\nShots: a.png, b.png\nClips: c.mp4\n").claims.C1;
  assert.deepEqual(e.tests, [{ name: "one", ok: true }]);
  assert.deepEqual(e.shots, ["a.png", "b.png"]);
  assert.deepEqual(e.clips, ["c.mp4"]);
});

test("a click shows at once (withSaid) and goes once the files show it", () => {
  const p = run({ md: parseProofMd("## C2 x\nResult: partial — half\n") }).proof;
  const r = { tasks: [{ id: "t1", state: "merged" }, { id: "t2", state: "merged" }, { id: "t3", state: "merged" }] };
  const said = new Map([["k:C2", { kind: "accept", line: "partial — half", at: 1000 }]]);
  const rows = withSaid(claimRows(p, r), said, "k", p, 2000);
  assert.equal(rows[1].state, "accepted");
  // Read back from the file: the note goes.
  withSaid(claimRows(p, r), said, "k", { ...p, accepted: { C2: { result: "partial — half" } } }, 3000);
  assert.equal(said.size, 0);
  // Unaccept puts the state back to what the row says.
  said.set("k:C2", { kind: "unaccept", line: "partial — half", at: 1000 });
  const back = withSaid(claimRows({ ...p, accepted: { C2: { result: "partial — half" } } }, r), said, "k", { ...p, accepted: { C2: { result: "partial — half" } } }, 2000);
  assert.equal(back[1].state, "partial");
});
