// What the views read from inbox.js for Address comments, Ask to prove and the level tags: asked
// across a reload, the click's mark before the first redraw, the old commentsAsked store moved
// into the shared one, and each "requested…" clearing as it always did.
// Run: node --import ./loader.mjs --test inbox-views.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetShared, shared, setShared } from "herdr";
import { askClick } from "../../herdr-app/mods/harbormaster/askclick.js";
import { asked, askedLevel, askedStore, askedPrsOf, markAsked, migrateCommentsAsked, pruneAsked } from "../../herdr-app/mods/harbormaster/inbox.js";
import { commentsSig, ASKED_KEEP_MS } from "../../herdr-app/mods/harbormaster/comments.js";
import { claimRows, claimResultLine, withSaid, withAsked, claimActions } from "../../herdr-app/mods/harbormaster/claims.js";
import { parseProofMd } from "../../herdr-app/mods/harbormaster/proof.js";

beforeEach(() => resetShared());
const OLD = "harbormaster.commentsAsked";
const run = (name = "x", o = {}) => ({ key: `:/r/${name}`, dir: `/r/${name}`, branch: name, terminal: "t1", localTerminal: "t1", autonomy: "L1",
  phase: "running", statusLine: "running", progress: "p", tasks: [], pending: { autonomy: null, tier: null }, commentsAsked: [], ...o });
const pr = (n, ids = ["a", "b"]) => ({ url: `https://github.com/o/r/pull/${n}`, number: n, state: "OPEN",
  comments: { count: ids.length, bots: {}, items: ids.map((thread) => ({ thread, text: thread, kind: "thread" })) } });
// A click whose spawned body never runs: what the first redraw sees.
const clickOnly = (r, kind, payload, asks) => askClick({ load: async () => {} }, { notify: () => {}, spawn: () => {} }, r, kind, payload, { asks });

// ---- Address comments ----

test("comments: the click's mark holds across a reload, and while the run works until a new comment", () => {
  const r = run(), p = pr(1);
  clickOnly(r, "comments-all", { prs: [p], mode: "ask" }, [{ key: p.url, item: p }]);
  assert.equal(asked(r, "comments", p.url, p), true, "marked before the first redraw");
  // A reload: a fresh run object, the same shared state.
  assert.deepEqual([...askedPrsOf(run(), [p])], [p.url]);
  // Comments moved: asked ends while idle, holds while working, ends with a comment the ask did not list.
  const answered = pr(1, ["a"]);
  assert.equal(asked(run(), "comments", p.url, answered), false);
  assert.equal(asked(run(), "comments", p.url, answered, { working: true }), true);
  assert.equal(asked(run(), "comments", p.url, pr(1, ["a", "b", "new"]), { working: true }), false);
});

test("comments: the old commentsAsked store moves into the shared one, once", () => {
  const a = run("a"), b = run("b"), p = pr(1), q = pr(2), gone = pr(3);
  const sig = commentsSig(null, p);
  setShared(OLD, { [p.url]: { sig, ids: ["a", "b"], at: Date.now() }, [q.url]: { sig: commentsSig(null, q), ids: ["a", "b"], at: Date.now() }, [gone.url]: { sig: "x", at: Date.now() } });
  const prsOf = (r) => (r === a ? [p] : [q]);
  migrateCommentsAsked([a, b], prsOf);
  assert.equal(shared(OLD), null, "the old key goes");
  assert.equal(asked(a, "comments", p.url, p), true);
  assert.equal(asked(b, "comments", q.url, q), true);
  assert.equal(asked(b, "comments", p.url, p), false, "an ask belongs to the run that owns the PR");
  assert.equal(Object.keys(askedStore()).length, 2, "a PR in no run is dropped");
  const before = askedStore();
  migrateCommentsAsked([a, b], prsOf);
  assert.equal(askedStore(), before, "idempotent");
});

test("comments: a mark of a PR no run lists is kept in the old key while a run is stale", () => {
  const a = run("a"), s = { ...run("s"), stale: true }, p = pr(1), q = pr(2);
  setShared(OLD, { [p.url]: { sig: commentsSig(null, p), ids: [], at: Date.now() }, [q.url]: { sig: "x", at: Date.now() } });
  migrateCommentsAsked([a, s], (r) => (r === a ? [p] : []));
  assert.deepEqual(Object.keys(shared(OLD)), [q.url]);
  assert.equal(asked(a, "comments", p.url, p), true);
  // An entry already in the shared store is not overwritten by an old one.
  resetShared();
  markAsked(a, "comments", p.url, p, 5);
  setShared(OLD, { [p.url]: { sig: "old", at: 1 } });
  migrateCommentsAsked([a], () => [p]);
  assert.equal(Object.values(askedStore())[0].at, 5);
});

test("comments: prune drops a mark whose PR is merged, keeps one whose PR is unknown", () => {
  const r = run(), p = pr(1);
  markAsked(r, "comments", p.url, p);
  pruneAsked([r], { lookup: () => ({ ...p, state: "MERGED" }) });
  assert.deepEqual(askedStore(), {});
  markAsked(r, "comments", p.url, p);
  pruneAsked([r], { lookup: () => undefined });
  assert.equal(Object.keys(askedStore()).length, 1);
  pruneAsked([r], { now: Date.now() + ASKED_KEEP_MS + 1000 });
  assert.deepEqual(askedStore(), {});
});

// ---- Ask to prove ----

const proof = (o = {}) => ({ md: parseProofMd("## C1 x\nResult: fail — half\n"), claims: [{ id: "C1", text: "x", tasks: [], bar: null }], tier: { tier: 1 }, asks: new Map(), accepted: {}, ...o });
const rowsOf = (r) => claimRows(r.proof, r);

test("proof: asked at the click for 15 s while the result line is the same, then unread only", () => {
  const r = run("p", { proof: proof() });
  const [k] = rowsOf(r);
  assert.equal(claimActions(k)[1], "ask");
  const t0 = Date.now();
  clickOnly(r, "proof", { row: k }, [{ key: k.id, item: k }]);
  assert.equal(withAsked(rowsOf(r), r, t0 + 1000)[0].asked, true);
  assert.deepEqual(claimActions(withAsked(rowsOf(r), r, t0 + 1000)[0]), ["accept", "asked"]);
  // After 15 s, or once the result line moved, the mark no longer holds.
  assert.equal(withAsked(rowsOf(r), r, t0 + 16000)[0].asked, false);
  const moved = run("p", { proof: proof({ md: parseProofMd("## C1 x\nResult: fail — more\n") }) });
  assert.equal(withAsked(rowsOf(moved), moved, t0 + 1000)[0].asked, false);
  // Unread in the inbox (proof.asks has the same line): asked with no mark at all.
  resetShared();
  const unread = run("p", { proof: proof({ asks: new Map([["C1", claimResultLine(k)]]) }) });
  assert.equal(withAsked(rowsOf(unread), unread, t0 + 60000)[0].asked, true);
});

test("proof: Accept and Unaccept still show at once through said, and an accepted row is not asked", () => {
  const r = run("p", { proof: proof() });
  const [k] = rowsOf(r);
  const said = new Map([[`${r.key}:C1`, { kind: "accept", line: claimResultLine(k), at: 1000 }]]);
  const [acc] = withAsked(withSaid(rowsOf(r), said, r.key, r.proof, 2000), r, 2000);
  assert.equal(acc.state, "accepted");
  assert.deepEqual(claimActions(acc), ["unaccept"]);
  markAsked(r, "proof", "C1", k, 1500);
  assert.equal(withAsked(withSaid(rowsOf(r), new Map(), r.key, r.proof, 2000), r, 2000)[0].asked, true);
  // An accepted row stays accepted whatever the mark says.
  const accepted = run("p", { proof: proof({ accepted: { C1: { result: claimResultLine(k) } } }) });
  assert.equal(withAsked(rowsOf(accepted), accepted, 2000)[0].state, "accepted");
});

test("proof: prune reads the claim row; a moved result line drops the mark", () => {
  const r = run("p", { proof: proof() });
  const [k] = rowsOf(r);
  markAsked(r, "proof", "C1", k);
  const lookup = (rr, fam, key) => claimRows(rr.proof, rr).find((x) => x.id === key);
  pruneAsked([r], { lookup });
  assert.equal(Object.keys(askedStore()).length, 1);
  const moved = { ...r, proof: proof({ md: parseProofMd("## C1 x\nResult: fail — more\n") }) };
  pruneAsked([moved], { lookup });
  assert.deepEqual(askedStore(), {});
});

// ---- levels ----

test("level: requested reads from the click at once, and clears three ways", () => {
  const now = Date.now();
  const r = run();
  clickOnly(r, "level", { kind: "autonomy", level: "L2" }, [{ key: "autonomy", item: { level: "L2", current: "L1" } }]);
  assert.equal(askedLevel(r, "autonomy", "L1"), "L2", "marked before the first redraw");
  // 1. The run shows the request (unread): the mark gives way to it, the same level.
  assert.equal(askedLevel({ ...r, pending: { autonomy: "L2", tier: null } }, "autonomy", "L1"), "L2");
  // 2. The run reached the level: nothing requested.
  assert.equal(askedLevel(r, "autonomy", "L2"), null);
  // 3. 15 s passed.
  assert.equal(askedLevel(r, "autonomy", "L1", now + 16000), null);
  // The click shows over an older unread request of the same kind, as it did.
  assert.equal(askedLevel({ ...r, pending: { autonomy: "L0", tier: null } }, "autonomy", "L1"), "L2");
  // A tier is a number; one mark per kind.
  clickOnly(r, "level", { kind: "tier", level: 3 }, [{ key: "tier", item: { level: 3, current: 1 } }]);
  assert.equal(askedLevel(r, "tier", 1), 3);
  assert.equal(askedLevel(r, "autonomy", "L1"), "L2");
});

// ---- review fixes ----

test("migration: a run whose PR list is not read yet keeps the unowned entries in the old key, until a week old", () => {
  const a = run("a"), p = pr(1);
  const e = { sig: commentsSig(null, p), ids: [], at: Date.now() };
  setShared(OLD, { [p.url]: e, "https://x/old": { sig: "x", at: Date.now() - ASKED_KEEP_MS - 1000 } });
  migrateCommentsAsked([a], () => null);
  assert.deepEqual(Object.keys(shared(OLD)), [p.url]);
  assert.deepEqual(askedStore(), {});
  // Until it is migrated, a copy that does not migrate still reads the old mark.
  assert.deepEqual([...askedPrsOf(a, [p])], [p.url]);
  assert.deepEqual([...askedPrsOf(a, [pr(1, ["a"])])], [], "comments moved: the old mark ends as it did");
  // Once the PRs are known the entry moves.
  migrateCommentsAsked([a], () => [p]);
  assert.equal(shared(OLD), null);
  assert.equal(asked(a, "comments", p.url, p), true);
});

test("migration: a closed run's entry moves and is then pruned; two runs with one PR, the first wins", () => {
  const a = run("a"), b = run("b"), p = pr(1);
  setShared(OLD, { [p.url]: { sig: commentsSig(null, p), ids: [], at: Date.now() } });
  migrateCommentsAsked([a, b], () => [p]);
  assert.deepEqual(Object.keys(askedStore()).map((k) => k.split("\u001f")[0]), [a.key]);
  pruneAsked([{ ...a, away: { how: "closed" } }, b], { lookup: () => p });
  assert.deepEqual(askedStore(), {});
});

test("an ask read from the inbox ends its click mark: unread, then read inside 15 s, is not asked", () => {
  const r = run(), now = Date.now();
  markAsked(r, "level", "tier", { level: 2, current: 1 }, now);
  const unread = { ...r, pending: { autonomy: null, tier: 2 } };
  pruneAsked([unread], { now: now + 1000 });
  assert.deepEqual(askedStore(), {});
  assert.equal(askedLevel(r, "tier", 1, now + 2000), null, "read, level not changed yet");
  assert.equal(askedLevel(unread, "tier", 1, now + 500), 2, "while unread it still shows");
  // The same for a proof mark.
  const pr1 = run("p", { proof: proof() });
  const [k] = rowsOf(pr1);
  markAsked(pr1, "proof", "C1", k, now);
  const lookup = (rr, _f, key) => claimRows(rr.proof, rr).find((x) => x.id === key);
  pruneAsked([pr1], { now: now + 1000, lookup });
  assert.equal(Object.keys(askedStore()).length, 1, "not yet shown unread");
  const shown = { ...pr1, proof: proof({ asks: new Map([["C1", claimResultLine(k)]]) }) };
  pruneAsked([shown], { now: now + 2000, lookup });
  assert.deepEqual(askedStore(), {});
  assert.equal(withAsked(rowsOf(pr1), pr1, now + 3000)[0].asked, false);
});
