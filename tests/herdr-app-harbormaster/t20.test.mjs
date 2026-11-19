// The final review's fixes (t20): a toast id that asking never changes, an open plan told no merge,
// a bot's answered thread staying answered, "asked…" always showing, an ask ended by a new comment,
// and the plan rule from plan.md alone.
// Run: node --import ./loader.mjs --test t20.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess } from "../../herdr-app/mods/harbormaster/attention.js";
import { needActions } from "../../herdr-app/mods/harbormaster/needaction.js";
import { toastParts, nextToasts, TOAST_HOLD } from "../../herdr-app/mods/harbormaster/tell.js";
import { resetShared, setShared } from "herdr";
import { commentSummary, countedIds } from "../../herdr-app/mods/harbormaster/comments.js";
import { asked, markAsked, pruneAsked, askedStore } from "../../herdr-app/mods/harbormaster/inbox.js";
import { planOpen } from "../../herdr-app/mods/harbormaster/tasks.js";

const MIN = 60000;
const now = Date.parse("2026-11-17T12:00:00Z");
const ago = (m) => now - m * MIN;

const run = (o = {}) => ({
  key: ":/r/x", dir: "/r/x", folder: "/p/acme", repo: "acme", phase: "running", statusLine: "running", progress: "t1 implementing",
  tasks: [], prs: [{ url: "a" }, { url: "b" }], question: null, ask: null, askedAt: null, away: null, updated: ago(60), started: ago(300),
  terminal: "w/orch", localTerminal: true, autonomy: "L1", ...o,
});
const cm = (count, ids) => ({ count, bots: {}, items: ids.map((thread) => ({ thread, text: thread, kind: "thread" })) });
const pr = (number, count, o = {}) => ({
  number, state: "OPEN", review: "APPROVED", approvedBy: ["kim"], changesBy: [], requested: [], checks: { pass: 3, fail: 0, pending: 0 },
  url: `https://github.com/o/r/pull/${number}`, repo: "o/r", ci: { startedAt: ago(90), finishedAt: ago(80) }, reviewedAt: ago(500),
  comments: cm(count, Array.from({ length: count }, (_, i) => `t${number}-${i}`)), ...o,
});
const read = (l) => ({ list: l, readable: true, why: null });
const at = (r, l, o = {}) => assess(r, { orch: "idle", working: false, pr: read(l), flow: "peer", now, ...o });
const box = (r, l, o = {}) => needActions(at(r, l, o), { run: r, prs: l, now });

// ---- 1. the toast id ----

test("asking about one of two PRs does not change the toast's id, so nothing new is told", () => {
  const l = [pr(1799, 2), pr(1372, 9)];
  const r = run({ phase: "finished" });
  const before = toastParts(r, at(r, l));
  const after = toastParts(r, at(r, l, { askedPrs: new Set([l[0].url]) }));
  assert.equal(after.parts.length, 1);
  assert.equal(after.parts[0].id, before.parts[0].id);
  // The text names only the PR still to ask about.
  assert.match(after.parts[0].text, /^#1372 /);
  // Through the store: seeded before the ask, held past the hold, no toast.
  const key = r.key;
  let store = nextToasts({}, [{ key, ...before }], now).store;
  store = nextToasts(store, [{ key, ...after }], now + 1000).store;
  assert.deepEqual(nextToasts(store, [{ key, ...after }], now + 1000 + TOAST_HOLD + 1).toasts, []);
});

// ---- 2. no "merge" while the plan is open ----

test("an approved PR on a run whose plan is open stays in Needs you, told without merge", () => {
  const open = run({ phase: "running", tasks: [{ id: "t1", state: "done" }, { id: "t2", state: "done" }, { id: "t3", state: "planned" }], planned: 3 });
  const l = [pr(44, 0, { comments: cm(0, []), reviewedAt: ago(500) })];
  const a = at(open, l);
  assert.equal(a.group, "needs");
  assert.equal(a.planOpen, true);
  assert.equal(a.reasons[0].key, "approved — merge");
  assert.equal(a.reasons[0].text, "approved · plan open");
  const [it] = needActions(a, { run: open, prs: l, now });
  assert.equal(it.line, "#44 approved by kim 8h20m ago · merge once the plan is done (2/3 tasks)");
  assert.doesNotMatch(it.line, /^Merge/);
  // Done tasks: the same PR is told to merge.
  const done = run({ phase: "running", tasks: [{ id: "t1", state: "done" }], planned: 1 });
  const b = at(done, l);
  assert.equal(b.planOpen, false);
  assert.equal(needActions(b, { run: done, prs: l, now })[0].line, "Merge #44 · approved by kim 8h20m ago");
});

test("with comments and an open plan: address them, no 'then merge'", () => {
  const open = run({ phase: "running", tasks: [{ id: "t1", state: "done" }, { id: "t2", state: "planned" }], planned: 2 });
  const l = [pr(1372, 9)];
  const [it] = needActions(at(open, l), { run: open, prs: l, now });
  assert.equal(it.line, "Approved by kim 8h20m ago with 9 comments on #1372: address them");
});

// ---- 3. a bot's thread stays answered ----

const by = (login) => ({ __typename: login === "coderabbitai" ? "Bot" : "User", login });
const th = (id, who, bodies) => ({ id, isResolved: false, path: "a.php", line: 1,
  first: { nodes: [{ author: by(who), authorAssociation: who === "coderabbitai" ? "NONE" : "MEMBER", body: bodies[0], url: `u-${id}` }] },
  last: { nodes: bodies.slice(-5).map((body) => ({ body, author: body.startsWith("🤖") ? by("dlebech") : by(who), authorAssociation: body.startsWith("🤖") ? "MEMBER" : "NONE" })) } });
const graph = (threads) => ({ data: { repository: { pullRequest: { author: { login: "me" }, reviewThreads: { nodes: threads }, reviews: { nodes: [] }, comments: { nodes: [] } } } } });

test("a bot's thread stays answered after the bot thanks the AI reply; a person's follow-up counts again", () => {
  const s = commentSummary(graph([
    th("B1", "coderabbitai", ["Fix this", "🤖 AI: fixed in abc", "Thanks for the fix!"]),
    th("B2", "coderabbitai", ["Fix that"]),
    th("P1", "anna", ["Rename", "🤖 AI: renamed", "Still not right"]),
    th("P2", "anna", ["Rename too", "🤖 AI: renamed"]),
  ]));
  assert.deepEqual(s.bots, { coderabbitai: 1 });
  assert.deepEqual(s.items.filter((x) => x.kind === "answered").map((x) => x.thread).sort(), ["B1", "P2"]);
  assert.deepEqual(s.items.filter((x) => x.kind === "thread" && !x.bot).map((x) => x.thread), ["P1"]);
});

// ---- 4. "asked…" always shows ----

test("an asked PR keeps its row when nothing else can be asked (a question is open)", () => {
  const l = [pr(1372, 9)];
  const asked = pr(1799, 2);
  const r = run({ phase: "waiting", question: "q", ask: { title: "Which?" }, askedAt: ago(5) });
  const [it] = needActions(assess(r, { orch: "idle", working: false, pr: read([asked, ...l]), flow: "peer", askedPrs: new Set([asked.url]), now }), { run: r, prs: [asked, ...l], now })
    .filter((x) => x.key === "approved — merge");
  assert.ok(it.actions.some((x) => x.kind === "asked" && x.pr.number === 1799), JSON.stringify(it.actions.map((x) => x.kind)));
  assert.ok(it.actions.some((x) => x.kind === "open" && /1372/.test(x.label)));
});

test("changes requested on a PR being handled and on one without comments: the handled one says so", () => {
  const handled = pr(1799, 2, { review: "CHANGES_REQUESTED", approvedBy: [], changesBy: ["anna"] });
  const plain = pr(1372, 0, { review: "CHANGES_REQUESTED", approvedBy: [], changesBy: ["anna"], comments: cm(0, []) });
  const r = run();
  const a = assess(r, { orch: "working", working: true, pr: read([handled, plain]), flow: "peer", askedPrs: new Set([handled.url]), now });
  assert.equal(a.group, "needs");
  const [it] = needActions(a, { run: r, prs: [handled, plain], now });
  assert.ok(it.actions.some((x) => x.kind === "asked" && x.pr.number === 1799), JSON.stringify(it.actions.map((x) => x.kind)));
  assert.ok(it.actions.some((x) => x.kind === "open" && x.label === "Open #1372"));
});

// ---- 5. new comments during an ask ----

test("while the run works, an ask ends when a counted comment appears that the ask did not list", () => {
  const before = pr(1799, 2);
  resetShared();
  const isAsked = (p, working = true) => asked(run(), "comments", p.url, p, { now, working });
  const prune = (p, busy) => pruneAsked([run()], { now, busy, lookup: () => p });
  markAsked(run(), "comments", before.url, before, now);
  const store = askedStore();
  assert.deepEqual(Object.values(store)[0].ids, ["t1799-0", "t1799-1"]);
  assert.ok(isAsked(before));
  // A new thread by the reviewer: the ask ends, even while the run works.
  const more = { ...before, comments: cm(3, ["t1799-0", "t1799-1", "t1799-new"]) };
  assert.ok(!isAsked(more));
  prune(more, new Set([more.url]));
  assert.deepEqual(askedStore(), {});
  resetShared(); markAsked(run(), "comments", before.url, before, now);
  // An answered thread changes its kind, not its id: the ask holds.
  const answered = { ...before, comments: { count: 1, bots: {}, items: [{ thread: "t1799-0", kind: "thread", text: "x" }, { thread: "t1799-1", kind: "answered", text: "x" }] } };
  assert.ok(isAsked(answered));
  const kept = askedStore();
  prune(answered, new Set([answered.url]));
  assert.equal(askedStore(), kept);
  // An ask stored before ids were kept is not ended by the new rule.
  const [id, e] = Object.entries(store)[0];
  resetShared(); setShared("harbormaster.asked", { [id]: { sig: e.sig, at: now } });
  assert.ok(isAsked(more));
  assert.deepEqual(countedIds({ comments: { items: [{ kind: "summary", text: "s" }, { kind: "note", url: "n" }] } }), ["n"]);
});

// ---- 7. the plan rule ----

test("plan.md's tasks alone decide when it lists any: a stale planned count does not hold a ready PR back", () => {
  const done3 = { phase: "running", planned: 5, tasks: [{ state: "done" }, { state: "merged" }, { state: "done" }] };
  assert.equal(planOpen(done3), false);
  assert.equal(planOpen({ ...done3, tasks: [...done3.tasks, { state: "implementing" }] }), true);
  assert.equal(planOpen({ ...done3, tasks: [...done3.tasks, { state: "dropped" }] }), false);
  // Without tasks in plan.md the counts decide.
  assert.equal(planOpen({ phase: "running", planned: 3, merged: 1, tasks: [] }), true);
  assert.equal(planOpen({ phase: "running", planned: 3, merged: 3, tasks: [] }), false);
});
