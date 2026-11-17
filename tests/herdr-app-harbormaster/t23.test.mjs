// t23: after the proof is read, a run that is ready says so and leads to the merge. The proof's
// signature and read state (proof.js), the ready rule (attention.js assess), the box (needaction.js),
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
import { rowLead, badgeOf } from "../../herdr-app/mods/harbormaster/crewrows.js";
import { parkedLabel, toastParts } from "../../herdr-app/mods/harbormaster/tell.js";
import { proofTasks, proofCounts, proofSig, proofRead, proofClean, proofGaps, parseProofMd } from "../../herdr-app/mods/harbormaster/proof.js";
import { nextProofSeen } from "../../herdr-app/mods/harbormaster/proofseen.js";
import { changesRequest, CHANGES } from "../../herdr-app/mods/harbormaster/changes.js";

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

const md = (second = "pass — fine") => parseProofMd(`Tier: T1\n\n## t1 a\nResult: pass — tests\n\n## t2 b\nResult: ${second}\n`);
const rowsOf = (m, extra = {}) => proofTasks([done("t1"), done("t2")], m, null, extra);

test("a proof's signature changes with a result or a file, and 'read' needs the same signature", () => {
  const a = proofSig(rowsOf(md()));
  assert.equal(a, proofSig(rowsOf(md())));
  assert.notEqual(a, proofSig(rowsOf(md("partial — one shot missing"))));
  assert.equal(proofRead(a, a), true);
  assert.equal(proofRead(null, a), false);
  assert.equal(proofRead(a, proofSig(rowsOf(md("partial — x")))), false);
  // No proof is never read.
  assert.equal(proofRead("", ""), false);
  // Accepting a row does not change what was read.
  const partial = md("partial — x");
  const line = rowsOf(partial)[1];
  assert.equal(proofSig(rowsOf(partial)), proofSig(rowsOf(partial, { accepted: { t2: { result: "partial — x" } } })));
  assert.ok(line);
});

test("proofClean: every task passes (or was accepted); gaps say what is missing", () => {
  assert.equal(proofClean(proofCounts(rowsOf(md()))), true);
  const partial = proofCounts(rowsOf(md("partial — x")));
  assert.equal(proofClean(partial), false);
  assert.equal(proofGaps(partial), "1/2 pass, 1 partial");
  assert.equal(proofClean(proofCounts(rowsOf(md("partial — x"), { accepted: { t2: { result: "partial — x" } } }))), true);
  assert.equal(proofGaps(proofCounts(rowsOf(md()))), null);
  assert.equal(proofClean(proofCounts([])), false);
  assert.equal(proofGaps(proofCounts(rowsOf(md("pending — still going")))), "1/2 pass, 1 pending");
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
  assert.equal(it.detail, "All 2 tasks done · proof 2/2 pass · checks green");
  assert.equal(it.line, "Ready to merge #44: All 2 tasks done · proof 2/2 pass · checks green");
  assert.deepEqual(it.actions.map((a) => [a.kind, a.label]), [["open", "Merge #44 on GitHub"], ["proof", "Proof"], ["changes", "Ask for changes"]]);
  assert.equal(it.actions[0].url, list[0].url);
  assert.deepEqual(it.actions.map((a, j) => isPrimary(a, 0, j)), [true, false, false]);
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
  assert.equal(it.line, "Read the proof (T1 · 2/2 pass), then merge #44");
  assert.deepEqual(it.actions.map((x) => x.label), ["Proof", "Open #44"]);
});

test("a read proof that is not clean says what stands in the way, the merge link still the main button", () => {
  const list = [pr()];
  const a = at(run(), list, { proofClean: false });
  const [it] = needActions(a, ctxFor(run(), list, { proof: { tier: 1, pass: 1, total: 2, fail: 0, accepted: 0, gaps: "1/2 pass, 1 partial" } }));
  assert.equal(it.ready, undefined);
  assert.equal(it.line, "Proof read · 1/2 pass, 1 partial — accept it or ask to prove it before merging #44");
  assert.deepEqual(it.actions.map((x) => x.label), ["Merge #44 on GitHub", "Proof"]);
  assert.deepEqual(it.actions.map((x, j) => isPrimary(x, 0, j)), [true, false]);
});

test("a failing proof, red CI and a draft keep their own wording", () => {
  const list = [pr()];
  const failed = needActions(at(run(), list, { proofFailed: true, proofClean: false }), ctxFor(run(), list, { proof: { tier: 1, pass: 1, total: 2, fail: 1, failed: "t2 b", gaps: "1/2 pass" } }))[0];
  assert.match(failed.line, /^Proof: t2 b failed — read it before merging #44$/);
  assert.equal(failed.actions[0].label, "Proof");
  const red = [pr({ checks: { pass: 1, fail: 1, pending: 0 } })];
  const lines = needActions(at(run(), red), ctxFor(run(), red)).map((x) => x.line);
  assert.ok(lines.every((l) => !/Ready to merge/.test(l)), lines.join("|"));
  const draft = [pr({ state: "DRAFT" })];
  assert.match(needActions(at(run(), draft), ctxFor(run(), draft))[0].line, /then mark #44 ready and merge/);
});

test("agreement: the Crew lead, the pill, the toast and the parked label all say ready to merge", () => {
  const list = [pr()];
  const a = at(run(), list);
  const lead = rowLead(a, now);
  assert.equal(lead.lead.split(" · ")[0], "ready to merge");
  assert.equal(lead.tone, "pass");
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
