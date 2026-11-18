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

// ---- which final review is "the" review: the newest on the branch, whatever the line order (t6) ----
import { execFileSync, execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshReviewed } from "../../herdr-app/mods/harbormaster/data.js";

// A real repo: main has c1..c5; "side" is a commit on another branch (not an ancestor of main).
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "reviewed-"));
  const git = (...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  const shas = [];
  for (let i = 1; i <= 5; i++) { writeFileSync(join(dir, "f"), String(i)); git("add", "."); git("commit", "-q", "-m", `c${i}`); shas.push(git("rev-parse", "--short", "HEAD")); }
  git("checkout", "-q", "-b", "side", shas[0]);
  writeFileSync(join(dir, "g"), "x"); git("add", "."); git("commit", "-q", "-m", "side");
  const side = git("rev-parse", "--short", "HEAD");
  git("checkout", "-q", "main");
  return { dir, shas, side };
}
const asRun = (dir, lines, n) => ({ key: `k${n}`, folder: dir, branch: "main", proof: { md: md(lines.join("\n")) } });
globalThis.__herdrExec = (cmd, args) => new Promise((res) => execFile(cmd, args, (e, stdout, stderr) => res({ code: e ? (e.code ?? 1) : 0, stdout, stderr })));

test("final lines newest-first and oldest-first pick the same review, and the same count", async () => {
  const { dir, shas } = repo();
  const line = (s) => `Reviewed: ${s} final review — ok`;
  const asc = asRun(dir, [line(shas[1]), line(shas[3])], 1), desc = asRun(dir, [line(shas[3]), line(shas[1])], 2);
  await refreshReviewed(asc); await refreshReviewed(desc);
  for (const r of [asc, desc]) {
    assert.equal(r.reviewedGap.sha, shas[3]);
    assert.equal(r.reviewedGap.count, 1);
    const l = reviewedLine(r.proof.md, r.reviewedGap);
    assert.equal(l.text, `Reviewed at ${shas[3]} · 1 commit since, not reviewed`);
    assert.equal(reviewedState(r.proof.md, r.reviewedGap).sha, shas[3]);
  }
});

test("a final review sha not on the branch is skipped when another is on it", async () => {
  const { dir, shas, side } = repo();
  // The foreign sha is last in the file, which used to win.
  const r = asRun(dir, [`Reviewed: ${shas[1]} final review — ok`, `Reviewed: ${side} final review — ok`], 3);
  await refreshReviewed(r);
  assert.equal(r.reviewedGap.sha, shas[1]);
  assert.equal(r.reviewedGap.count, 3);
  assert.equal(reviewedLine(r.proof.md, r.reviewedGap).tip.startsWith(`Reviewed: ${shas[1]}`), true);
  // Alone, it still measures (nothing else does).
  const only = asRun(dir, [`Reviewed: ${side} final review — ok`], 4);
  await refreshReviewed(only);
  assert.equal(only.reviewedGap.sha, side);
});

test("one final line, an unknown sha, or no gap keeps the last line in file order", async () => {
  const { dir, shas } = repo();
  const r = asRun(dir, [`Reviewed: ${shas[2]} final review — ok`, "Reviewed: deadbee final review — ok"], 5);
  await refreshReviewed(r);
  assert.equal(r.reviewedGap.sha, shas[2]); // the unknown one cannot measure while another can
  const none = asRun(dir, ["Reviewed: deadbee final review — ok", "Reviewed: cafe123 final review — ok"], 6);
  await refreshReviewed(none);
  assert.deepEqual([none.reviewedGap.sha, none.reviewedGap.same], ["cafe123", null]);
  const m = md("Reviewed: 1111111 final review — a\nReviewed: 2222222 final review — b");
  assert.match(reviewedLine(m, null).text, /2222222/);
});

test("one git call per refresh, however many final lines", async () => {
  const { dir, shas } = repo();
  const calls = []; const real = globalThis.__herdrExec;
  globalThis.__herdrExec = (...a) => { calls.push(a); return real(...a); };
  await refreshReviewed(asRun(dir, shas.map((s) => `Reviewed: ${s} final review — ok`), 7));
  globalThis.__herdrExec = real;
  assert.equal(calls.length, 1);
});

test("two final lines at one sha show the later line, as the pick does", async () => {
  const { dir, shas } = repo();
  const r = asRun(dir, [`Reviewed: ${shas[3]} final review — 2 must-fix`, `Reviewed: ${shas[3]} final review 2 — 0 findings`], 8);
  await refreshReviewed(r);
  assert.equal(r.reviewedGap.sha, shas[3]);
  const l = reviewedLine(r.proof.md, r.reviewedGap);
  assert.equal(l.text, `Reviewed at ${shas[3]} · 1 commit since, not reviewed`);
  assert.match(l.tip, /final review 2 — 0 findings/);
  const same = reviewedLine(r.proof.md, { ...r.reviewedGap, count: 0, same: true });
  assert.equal(same.text, `Reviewed · final review 2 at ${shas[3]}`);
});

test("a gap read before a final line was added does not measure from the old pick", async () => {
  const { dir, shas } = repo();
  const old = asRun(dir, [`Reviewed: ${shas[1]} final review — ok`], 9);
  await refreshReviewed(old);
  assert.equal(reviewedLine(old.proof.md, old.reviewedGap).tone, "amber");
  const grown = md(`Reviewed: ${shas[1]} final review — ok\nReviewed: ${shas[4]} final review 2 — ok`);
  // The stale gap (key of the old set) is no gap: dim line at the new last review, state current, not compared.
  const l = reviewedLine(grown, old.reviewedGap);
  assert.deepEqual([l.tone, l.text.includes(shas[4])], ["dim", true]);
  assert.deepEqual(reviewedState(grown, old.reviewedGap), { kind: "current", behind: null, sha: shas[4], compared: false });
  // A gap without a key (older callers) still names its sha.
  assert.equal(reviewedLine(grown, { sha: shas[1], count: 3, same: false }).tone, "amber");
});
