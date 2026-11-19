// The overview with Closed unfolded and many closed runs, drawn as main.js draws it. In Herdr a
// render may take about 50 ms before it is interrupted ("This view could not be re-rendered"), and
// each shared() read copies the whole value: with ~40 closed runs the cards read the PR store
// (harbormaster.prs) about 150 times, ~0.3 ms each, and the view was interrupted (proof t1-timing).
// A draw now reads each shared key once (store.js oneRead). The runs are real run directories
// in a throwaway root, read by loadRuns.
// Run: node --import ./loader.mjs --test closed-view.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetShared, setShared, sharedReads } from "herdr";
import { find } from "gpui-kit";
import { withRoot } from "./root.mjs";
import { loadRuns } from "../../herdr-app/mods/harbormaster/data.js";
import Harbormaster from "../../herdr-app/mods/harbormaster/main.js";

const N = 120;
const text = (e) => (e && typeof e === "object" && "kids" in e ? e.kids.map(text).join("") : typeof e === "string" ? e : "");
const cx = { notify() {}, spawn() {}, stop_propagation() {} };
let root, runs;

// A closed run: finished, with a PR, an issue, a task and a closed marker, `i` hours ago.
function closedRun(i) {
  const repo = i % 2 ? "api" : "box", branch = `feat-${i}`;
  const dir = join(root, repo, branch);
  mkdirSync(dir, { recursive: true });
  const at = new Date(Date.UTC(2026, 10, 1) - i * 3600000).toISOString();
  writeFileSync(join(dir, "orchestrator.json"), JSON.stringify({ branch, terminal: `t${i}`, folder: repo, started: at }));
  writeFileSync(join(dir, "status.json"), JSON.stringify({ status: "finished", autonomy: "L1", type: "feat", updated: at,
    prs: [`https://github.com/o/${repo}/pull/${i}`], issues: [`https://github.com/o/${repo}/issues/${1000 + i}`] }));
  // feat-7: its tier set by the user and a second task without a proof tier, for the tag's hover.
  writeFileSync(join(dir, "plan.md"), i === 7
    ? `Status: finished\nPrefix: f${i}\nProof tier: T1 (set by user)\n\n### t1 thing ${i} — merged\n- Proof: T1 — tests\n\n### t2 other ${i} — merged\n`
    : `Status: finished\nPrefix: f${i}\nProof tier: T1\n\n### t1 thing ${i} — merged\n- Proof: T1 — tests\n`);
  writeFileSync(join(dir, "closed"), `${at}\tmerged #${i}\n`);
  return { key: `:${dir}`, repo, i };
}

before(async () => {
  resetShared();
  root = mkdtempSync(join(tmpdir(), "hm-closed-"));
  const made = Array.from({ length: N }, (_, i) => closedRun(i + 1));
  // Every run's PRs as refreshPrs stores them: a merged PR each, with a long-ish body's worth of
  // fields, so the store is the size a busy machine has.
  const prs = {};
  for (const m of made) {
    prs[m.key] = { at: 1, okAt: 1, related: [], list: [{ number: m.i, title: `Add thing ${m.i}`, state: "MERGED", review: "APPROVED",
      approvedBy: ["anna"], changesBy: [], requested: [], checks: { pass: 3, fail: 0, pending: 0 }, url: `https://github.com/o/${m.repo}/pull/${m.i}`,
      repo: `o/${m.repo}`, head: `feat-${m.i}`, sha: "a".repeat(40), danger: null, updatedAt: "2026-11-01T00:00:00Z" }] };
  }
  setShared("harbormaster.prs", prs);
  withRoot(root);
  ({ runs } = await loadRuns());
  // loadRuns starts tidying the closed runs (sh, in the background): nothing more is run.
  globalThis.__herdrExec = async () => ({ code: 1, stdout: "", stderr: "not in this test" });
});
after(() => rmSync(root, { recursive: true, force: true }));

// The overview as Harbormaster.render draws it, Closed unfolded or not.
function draw(showDone) {
  const hm = new Harbormaster();
  Object.assign(hm, { runs, errors: [], decisions: [], folds: new Map(), busy: {}, size: { width: 600 }, showDone, load: async () => {} });
  sharedReads.clear();
  const a = performance.now();
  const el = hm.render(cx);
  return { el, ms: performance.now() - a, reads: new Map(sharedReads) };
}

test(`Closed unfolded with ${N} closed runs: each card drawn, each shared key read once`, () => {
  assert.equal(runs.length, N);
  const { el, ms, reads } = draw(true);
  assert.match(text(find(el, "finished-toggle")), new RegExp(`${N} closed`));
  for (const r of runs) assert.ok(find(el, `run-${r.key}`), `a card for ${r.branch}`);
  for (const [key, n] of reads) assert.equal(n, 1, `${key} read ${n} times in one draw`);
  // Node draws it in a few ms; this only catches something gone quadratic.
  assert.ok(ms < 1000, `drawn in ${ms.toFixed(0)} ms`);
});

test("a closed card still shows its facts: Closed, when and why, its PR, issue and level tags", () => {
  const { el } = draw(true);
  const r = runs.find((x) => x.branch === "feat-7");
  const c = find(el, `run-${r.key}`);
  const s = text(c);
  assert.match(s, /Closed/);
  assert.match(s, /was: merged #7/);
  assert.match(s, /#7/, "the PR fact");
  assert.ok(find(c, `is-${r.key}-https://github.com/o/api/issues/1007`), "the issue chip");
  assert.match(text(find(c, `auto-${r.key}`)), /^L1$/);
  const tier = find(c, `tier-${r.key}`);
  assert.match(text(tier), /^T1$/);
  assert.match(tier.tip, /^Proof tier T1 — proved with /);
  assert.match(tier.tip, /Set by user/);
  assert.match(tier.tip, /1 task not scoped/);
  assert.match(find(c, `auto-${r.key}`).tip, /^Autonomy L1 — /);
});

// A closed run's level can't change: its tags are plain, not the level picker (a HoverCard each,
// about a third of a card's cost in Herdr; proof t1-timing).
test("closed cards draw no level picker", () => {
  const { el } = draw(true);
  const cards = [];
  const hover = (e) => (e && typeof e === "object" && "kids" in e ? ("hoverCard" in e ? 1 : 0) + e.kids.reduce((n, k) => n + hover(k), 0) : 0);
  for (const r of runs) cards.push(find(el, `run-${r.key}`));
  assert.equal(cards.reduce((n, c) => n + hover(c), 0), 0);
});

test("folded, the closed runs draw no card and still read each shared key once", () => {
  const { el, reads } = draw(false);
  assert.match(text(find(el, "finished-toggle")), new RegExp(`${N} closed`));
  assert.equal(find(el, `run-${runs[0].key}`), null);
  for (const [key, n] of reads) assert.equal(n, 1, `${key} read ${n} times in one draw`);
});
