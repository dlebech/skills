// t23: after the proof is read, a run that is ready says so and leads to the merge. The proof's
// signature and read state (claims.js, proof.js), the ready rule (attention.js assess), the box (needaction.js),
// the views agreeing (Crew lead, pill, toast, parked label) and the Ask for changes message.
// Run: node --import ./loader.mjs --test t23.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assess } from "../../herdr-app/mods/harbormaster/attention.js";
import { needActions, isPrimary } from "../../herdr-app/mods/harbormaster/needaction.js";
import { rowLead, rowEdge, badgeOf } from "../../herdr-app/mods/harbormaster/crewrows.js";
import { parkedLabel, toastParts } from "../../herdr-app/mods/harbormaster/tell.js";
import { proofRead, parseProofMd } from "../../herdr-app/mods/harbormaster/proof.js";
import { claimRows, claimCounts, claimsClean, claimsGaps, claimsSig, parsePlanClaims, proofState } from "../../herdr-app/mods/harbormaster/claims.js";
import { nextProofSeen } from "../../herdr-app/mods/harbormaster/proofseen.js";
import { proofStateOf } from "../../herdr-app/mods/harbormaster/attend.js";
import { changesRequest, changesPending, CHANGES } from "../../herdr-app/mods/harbormaster/inbox.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIN = 60000;
const now = Date.parse("2026-11-17T12:00:00Z");
const ago = (m) => now - m * MIN;
const done = (id) => ({ id, name: id, state: "done" });
const run = (o = {}) => ({
  key: ":/r/x", dir: "/r/x", folder: "/p/skills", repo: "skills", phase: "finished", statusLine: "finished", progress: null,
  tasks: [done("t1"), done("t2")], prs: [{ url: "u1" }], question: null, ask: null, askedAt: null, away: null,
  updated: ago(60), started: ago(300), terminal: "w/orch", ...o,
});
const pr = (o = {}) => ({
  number: 44, state: "OPEN", review: null, approvedBy: [], changesBy: [], requested: [], checks: { pass: 3, fail: 0, pending: 0 },
  url: "https://github.com/o/skills/pull/44", repo: "o/skills", ci: { startedAt: ago(90), finishedAt: ago(80) }, reviewedAt: null, ...o,
});
const read = (list) => ({ list, readable: true, why: null });
const at = (r, list, o = {}) => assess(r, { orch: "idle", working: false, pr: read(list), now, proofRead: true, proofClean: true, ...o });

const md = (second = "pass — fine") => parseProofMd(`Tier: T1\n\n## C1 a\nResult: pass — tests\n\n## C2 b\nResult: ${second}\n`);
const CLAIMS = parsePlanClaims("## Claims\nC1 a — tasks t1\nC2 b — tasks t2\n");
const proofOf = (m, extra = {}) => ({ tier: { tier: 1 }, claims: CLAIMS, md: m, files: [], accepted: {}, asks: new Map(), ...extra });
const rowsOf = (m, extra = {}) => claimRows(proofOf(m, extra), { tasks: [done("t1"), done("t2")] });

test("a proof's signature changes with a result or a file, and 'read' needs the same signature", () => {
  const a = claimsSig(rowsOf(md()));
  assert.equal(a, claimsSig(rowsOf(md())));
  assert.notEqual(a, claimsSig(rowsOf(md("partial — one shot missing"))));
  assert.equal(proofRead(a, a), true);
  assert.equal(proofRead(null, a), false);
  assert.equal(proofRead(a, claimsSig(rowsOf(md("partial — x")))), false);
  // No proof is never read.
  assert.equal(proofRead("", ""), false);
  // Accepting a row does not change what was read.
  const partial = md("partial — x");
  const line = rowsOf(partial)[1];
  assert.equal(claimsSig(rowsOf(partial)), claimsSig(rowsOf(partial, { accepted: { C2: { result: "partial — x" } } })));
  assert.ok(line);
});

test("clean: every claim proven (or accepted); gaps say what is missing", () => {
  assert.equal(claimsClean(claimCounts(rowsOf(md()))), true);
  const partial = rowsOf(md("partial — x"));
  assert.equal(claimsClean(claimCounts(partial)), false);
  assert.equal(claimsGaps(partial), "1 of 2 proven, not yet: b");
  assert.equal(claimsClean(claimCounts(rowsOf(md("partial — x"), { accepted: { C2: { result: "partial — x" } } }))), true);
  assert.equal(claimsGaps(rowsOf(md())), null);
  assert.equal(claimsClean(claimCounts([])), false);
});

test("a run is ready only with every condition: step, proof read and clean, green or no checks, nothing else open", () => {
  const ready = (r, list, o) => at(r, list, o).ready;
  assert.equal(ready(run(), [pr()]), true);
  // No checks at all is fine.
  assert.equal(ready(run(), [pr({ checks: { pass: 0, fail: 0, pending: 0 } })]), true);
  // Each one missing:
  assert.equal(ready(run(), [pr()], { proofRead: false }), false, "proof unread");
  assert.equal(ready(run(), [pr()], { proofClean: false }), false, "proof not clean");
  assert.equal(ready(run(), [pr()], { proofFailed: true }), false, "proof failed");
  assert.equal(ready(run(), [pr({ checks: { pass: 1, fail: 1, pending: 0 } })]), false, "red CI");
  assert.equal(ready(run(), [pr({ state: "DRAFT" })]), false, "a draft is marked ready first");
  assert.equal(ready(run({ phase: "running", question: "Q?", askedAt: ago(5) }), [pr()]), false, "a question is open");
  assert.equal(ready(run({ phase: "running", tasks: [done("t1"), { id: "t2", name: "t2", state: "implementing" }] }), [pr()]), false, "plan open");
  assert.equal(at(run(), [pr()], { flow: "peer" }).ready, false, "peer flow is not this step");
  // Still CI running: not in Needs you at all.
  const running = at(run(), [pr({ checks: { pass: 1, fail: 0, pending: 1 } })]);
  assert.equal(running.ready, false);
  assert.notEqual(running.group, "needs");
});

const ctxFor = (r, list, o = {}) => ({ run: r, prs: list, now, proof: { tier: 1, pass: 2, total: 2, fail: 0, accepted: 0, gaps: null }, ...o });

test("the ready box: a headline, what is done, a Merge button per PR (primary), Proof and Ask for changes plain", () => {
  const list = [pr()];
  const [it] = needActions(at(run(), list), ctxFor(run(), list));
  assert.equal(it.ready, true);
  assert.equal(it.headline, "Ready to merge");
  assert.equal(it.detail, "All 2 tasks done · proof 2/2 proven · checks green");
  assert.equal(it.line, "Ready to merge #44: All 2 tasks done · proof 2/2 proven · checks green");
  assert.deepEqual(it.actions.map((a) => [a.kind, a.label]), [["open", "Merge #44 on GitHub"], ["proof", "Proof"], ["changes", "Ask for changes"], ["wait-on", "Waiting on someone…"]]);
  assert.equal(it.actions[0].url, list[0].url);
  assert.deepEqual(it.actions.map((a, j) => isPrimary(a, 0, j)), [true, false, false, false]);
  // No checks: said so.
  const none = [pr({ checks: { pass: 0, fail: 0, pending: 0 } })];
  assert.match(needActions(at(run(), none), ctxFor(run(), none))[0].detail, /no checks$/);
});

test("the ready box with several PRs has one Merge button each, in order", () => {
  const list = [pr(), pr({ number: 45, url: "https://github.com/o/skills/pull/45" })];
  const [it] = needActions(at(run(), list), ctxFor(run(), list));
  assert.deepEqual(it.actions.filter((a) => a.kind === "open").map((a) => a.label), ["Merge #44 on GitHub", "Merge #45 on GitHub"]);
  assert.ok(it.actions.filter((a) => a.kind === "open").every((a) => a.primary));
});

test("an unread proof keeps today's box: Read the proof, Proof first", () => {
  const list = [pr()];
  const a = at(run(), list, { proofRead: false });
  const [it] = needActions(a, ctxFor(run(), list));
  assert.equal(it.ready, undefined);
  assert.equal(it.line, "Read the proof (T1 · 2/2 proven), then merge #44");
  assert.deepEqual(it.actions.map((x) => x.label), ["Proof", "Open #44", "Waiting on someone…"]);
});

test("a read proof that is not clean says what stands in the way, the merge link still the main button", () => {
  const list = [pr()];
  const a = at(run(), list, { proofClean: false });
  const [it] = needActions(a, ctxFor(run(), list, { proof: { tier: 1, pass: 1, total: 2, fail: 0, accepted: 0, gaps: "1/2 proven, 1 partial" } }));
  assert.equal(it.ready, undefined);
  assert.equal(it.line, "Proof read · 1/2 proven, 1 partial — accept it or ask to prove it before merging #44");
  assert.deepEqual(it.actions.map((x) => x.label), ["Merge #44 on GitHub", "Proof", "Waiting on someone…"]);
  assert.deepEqual(it.actions.map((x, j) => isPrimary(x, 0, j)), [true, false, false]);
});

test("a failing proof, red CI and a draft keep their own wording", () => {
  const list = [pr()];
  const failed = needActions(at(run(), list, { proofFailed: true, proofClean: false }), ctxFor(run(), list, { proof: { tier: 1, pass: 1, total: 2, fail: 1, failed: "t2 b", gaps: "1/2 proven" } }))[0];
  assert.match(failed.line, /^Proof: t2 b failed — read it before merging #44$/);
  assert.equal(failed.actions[0].label, "Proof");
  const red = [pr({ checks: { pass: 1, fail: 1, pending: 0 } })];
  const lines = needActions(at(run(), red), ctxFor(run(), red)).map((x) => x.line);
  assert.ok(lines.every((l) => !/Ready to merge/.test(l)), lines.join("|"));
  const draft = [pr({ state: "DRAFT" })];
  // Read and clean, a draft is still not ready: what is left is marking it ready.
  assert.match(needActions(at(run(), draft), ctxFor(run(), draft))[0].line, /^Proof read — mark #44 ready, then merge it$/);
  assert.match(needActions(at(run(), draft, { proofRead: false }), ctxFor(run(), draft))[0].line, /then mark #44 ready and merge/);
});

test("agreement: the Crew lead, the pill, the toast and the parked label all say ready to merge", () => {
  const list = [pr()];
  const a = at(run(), list);
  const lead = rowLead(a, now);
  assert.equal(lead.lead.split(" · ")[0], "ready to merge");
  assert.equal(lead.tone, "pass");
  assert.equal(rowEdge(a), "pass");
  const badge = badgeOf(a, true);
  assert.equal(badge.label, "ready to merge");
  assert.equal(badge.ready, true);
  assert.deepEqual(toastParts(run(), a).parts.map((p) => p.text), ["#44 ready to merge"]);
  const parked = { how: "parked", at: ago(120) };
  assert.equal(parkedLabel(at(run({ away: parked }), list), parked, now), "ready to merge · 2h0m");
  // Unread: all four say review proof → merge, red.
  const un = at(run(), list, { proofRead: false });
  assert.equal(badgeOf(un, true).label, "review proof → merge");
  assert.equal(badgeOf(un, true).ready, undefined);
  assert.equal(rowLead(un, now).tone, "blocked");
  assert.equal(rowEdge(un), "blocked");
  assert.equal(rowLead(un, now).lead.split(" · ")[0], "review proof → merge");
});

test("the Needs-you count is unchanged: a ready run is still in Needs you", () => {
  const a = at(run(), [pr()]);
  assert.equal(a.group, "needs");
  assert.equal(at(run(), [pr()], { proofRead: false }).group, "needs");
});

test("the changes message names the source and is no answer to a question", () => {
  assert.equal(changesRequest("  make the toast green \n"), "changes asked from Harbormaster: make the toast green");
  assert.equal(changesRequest("   "), null);
  assert.match(changesRequest("x"), CHANGES);
  const dir = mkdtempSync(join(tmpdir(), "hm-chg-"));
  try {
    mkdirSync(join(dir, "inbox"));
    writeFileSync(join(dir, "inbox", "a-harbormaster-changes.message"), `${changesRequest("tweak the copy")}\n`);
    writeFileSync(join(dir, "inbox", "b-captain.message"), 'Answer to "Q": Yes\n');
    const lib = join(here, "../../skills/herdr-app-captain/scripts/lib.sh");
    const r = spawnSync("bash", ["-c", 'source "$1"; answer_messages "$2"', "bash", lib, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split("\n").map((p) => p.split("/").pop()), ["b-captain.message"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the proofSeen store forgets gone runs, keeps a down machine's", () => {
  const store = { ":/r/a": "s1", ":/r/b": "s2", "m1:/r/c": "s3" };
  const runs = [{ key: ":/r/a" }];
  assert.deepEqual(nextProofSeen(store, runs, { failed: ["m1"] }), { ":/r/a": "s1", "m1:/r/c": "s3" });
  const same = { ":/r/a": "s1" };
  assert.equal(nextProofSeen(same, runs), same);
});

test("accepted rows are said as accepted, in the ready line and in the gaps", () => {
  const list = [pr()];
  const [it] = needActions(at(run(), list), ctxFor(run(), list, { proof: { tier: 1, pass: 1, total: 2, fail: 0, accepted: 1, gaps: null } }));
  assert.equal(it.detail, "All 2 tasks done · proof 1/2 proven · 1 accepted · checks green");
  const c = claimCounts(rowsOf(md("partial — x"), { accepted: { C2: { result: "partial — x" } } }));
  assert.equal(c.accepted, 1);
});

test("a listed task not done keeps a finished run from being ready, and the line says so", () => {
  const list = [pr()];
  const r = run({ tasks: [done("t1"), { id: "t2", name: "t2", state: "planned" }] });
  const a = at(r, list);
  assert.equal(a.ready, false);
  assert.equal(a.tasksShort, true);
  const [it] = needActions(a, ctxFor(r, list, { proof: { tier: 1, pass: 2, total: 2, fail: 0, accepted: 0, gaps: null } }));
  assert.equal(it.line, "Proof read · 1/2 tasks done — finish or drop the rest before merging #44");
  assert.deepEqual(it.actions.map((x) => x.label), ["Merge #44 on GitHub", "Proof", "Waiting on someone…"]);
});

test("an unread Ask for changes: not ready, Merge plain, pill and Crew lead say changes asked", () => {
  const list = [pr()];
  const a = at(run({ changesAsked: true }), list, { changesAsked: true });
  assert.equal(a.ready, false);
  assert.equal(rowLead(a, now).lead.split(" · ")[0], "changes asked…");
  assert.equal(badgeOf(a, true).label, "changes asked…");
  const [it] = needActions(a, ctxFor(run(), list));
  assert.match(it.line, /^Changes asked… its orchestrator plans them/);
  assert.deepEqual(it.actions.map((x, j) => isPrimary(x, 0, j)), [false, false, false]);
  assert.equal(changesPending("set autonomy to L2\nchanges asked from Harbormaster: tweak"), true);
  assert.equal(changesPending("what is blocking? x"), false);
});

test("the sig written when the proof is opened is the sig the ready check reads", () => {
  const r = run({ proof: proofOf(md()) });
  const stages = ["done", "done"];
  const written = proofState(r, stages).sig;
  assert.equal(written, claimsSig(rowsOf(md())));
  const state = proofStateOf(r, stages);
  assert.equal(state.sig, written);
  assert.equal(state.clean, true);
  // With it stored, the run is ready; without it, not.
  assert.equal(at(r, [pr()], { proofRead: proofRead(written, state.sig), proofClean: state.clean }).ready, true);
  assert.equal(at(r, [pr()], { proofRead: proofRead(null, state.sig), proofClean: state.clean }).ready, false);
});

test("an old run (no claims) is judged by its checks line alone: green is clean, red failed", () => {
  const old = (checks) => run({ proof: { tier: null, claims: [], md: parseProofMd(`${checks}## t1 a\nResult: fail — x\n`), files: [], accepted: {} } });
  assert.deepEqual(proofStateOf(old("Checks: green — 12 tests\n"), ["done", "done"]), { failed: false, clean: true, sig: "checks|green|12 tests" });
  assert.deepEqual(proofStateOf(old("Checks: red — lint\n"), ["done", "done"]), { failed: true, clean: false, sig: "checks|red|lint" });
  // Nothing to read: never ready by its proof.
  assert.deepEqual(proofStateOf(old(""), ["done", "done"]), { failed: false, clean: false, sig: "" });
});

test("reading the proof changes neither a run's reason keys nor its wait anchor, so the Needs-you order stays put", () => {
  const key = (a) => a.reasons.map((r) => r.key);
  const unread = at(run(), [pr()], { proofRead: false, proofClean: false });
  const read_ = at(run(), [pr()], { proofRead: true, proofClean: true });
  assert.equal(unread.group, "needs");
  assert.deepEqual(key(read_), key(unread));
  assert.equal(read_.waitSince, unread.waitSince);
});
