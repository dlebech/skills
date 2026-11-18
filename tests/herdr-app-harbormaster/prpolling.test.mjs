// When Harbormaster reads a run's PRs (data.js refreshPrs): on the run's own events within
// PR_EVENT_FLOOR_MS, else at a slow backstop, and how many GitHub points that costs.
// Run: node --import ./loader.mjs --test prpolling.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetShared } from "herdr";
import { needButton } from "../../herdr-app/mods/harbormaster/overview.js";
import { refreshPrs, markOpened, textSig, prFilesSig, PR_BACKSTOP_CAP } from "../../herdr-app/mods/harbormaster/data.js";
import { prTtl, prOffset, prMaxAge, fnv1a, PR_EVENT_FLOOR_MS, PR_OPENED_MS, PR_SPREAD_MS } from "../../herdr-app/mods/harbormaster/attention.js";

const MIN = 60_000;
const SHA = (n) => String(n).padStart(40, "a");
let clock = Date.parse("2026-11-18T10:00:00Z");
let keys = 0;

// A fake GitHub and git: `gh` PRs by URL ({state, review, sha, head, updatedAt}); `local` the local
// refs by branch ({origin, local}; the head look reads only origin). Counts the calls and the GraphQL
// points they cost. `w.gate`, while set, is a promise the git call waits on (a slow ssh); `w.fail`,
// while true, makes `gh pr view` fail.
function world() {
  const w = { prs: new Map(), local: new Map(), calls: { view: 0, comments: 0, git: 0 }, points: 0, gate: null, fail: false };
  globalThis.__herdrExec = async (cmd, args) => {
    if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
      w.calls.view++;
      if (w.fail) return { code: 1, stdout: "", stderr: "HTTP 502" };
      w.points += 1;
      const p = w.prs.get(args[2]);
      return { code: 0, stdout: JSON.stringify({
        number: p.number, title: "t", state: p.state, isDraft: false, reviewDecision: p.review ?? null, reviews: [], reviewRequests: [],
        author: { login: "me" }, statusCheckRollup: [], url: args[2], headRefName: p.head, headRefOid: p.sha, body: "", updatedAt: p.updatedAt ?? "2026-11-18T09:00:00Z",
      }), stderr: "" };
    }
    if (cmd === "gh" && args[0] === "api" && args[1] === "graphql") {
      w.calls.comments++; w.points += 2;
      return { code: 0, stdout: JSON.stringify({ data: { repository: { pullRequest: { reviews: { nodes: [] }, reviewThreads: { nodes: [] }, comments: { nodes: [] } } } } }), stderr: "" };
    }
    if (cmd === "sh" && args[1].includes("refs/remotes/origin")) {
      w.calls.git++;
      if (w.gate) await w.gate;
      const lines = args.slice(4).map((b) => { const r = w.local.get(b); return r?.origin ? `${args[3]}/\t${b}\t${r.origin}` : null; }).filter(Boolean);
      return { code: 0, stdout: lines.join("\n"), stderr: "" };
    }
    throw new Error(`unexpected exec ${cmd} ${args.join(" ")}`);
  };
  // A run with `n` PRs on GitHub, its head branches checked out locally at the same commits.
  w.run = (n = 2, { state = "OPEN", review = null } = {}) => {
    const key = `:/runs/r${++keys}`;
    const prs = [];
    for (let i = 0; i < n; i++) {
      const url = `https://github.com/o/r/pull/${keys * 10 + i}`;
      const head = `b${keys}-${i}`;
      w.prs.set(url, { number: keys * 10 + i, state, review, sha: SHA(keys * 10 + i), head });
      w.local.set(head, { origin: SHA(keys * 10 + i), local: SHA(keys * 10 + i) });
      prs.push({ url, repo: "o/r" });
    }
    return { key, machine: null, folder: "/repo", branch: "x", type: "feat", prs, related: [], filesSig: textSig(`a${keys}`) };
  };
  return w;
}

function withClock(fn) {
  return async () => {
    const realNow = Date.now;
    Date.now = () => clock;
    resetShared();
    try { await fn(); } finally { Date.now = realNow; delete globalThis.__herdrExec; clock += 24 * 60 * MIN; }
  };
}
const tick = (ms) => { clock += ms; };

test("each run's backstop is put off by a stable offset under a minute, so runs started together spread out", () => {
  const offsets = Array.from({ length: 20 }, (_, i) => prOffset(`:/home/u/.herdr/hc-orchestration/skills/run-${i}`));
  assert.ok(offsets.every((o) => o >= 0 && o < PR_SPREAD_MS));
  assert.equal(prOffset(":/a/b"), prOffset(":/a/b"));
  assert.equal(prOffset(":/a/b"), fnv1a(":/a/b") % PR_SPREAD_MS, "the same FNV-1a as textSig");
  assert.equal(textSig("abc"), `3:${fnv1a("abc").toString(36)}`);
  assert.ok(new Set(offsets.map((o) => Math.floor(o / 5000))).size >= 8, "20 runs land in at least 8 different 5 s polls");
  // A read put off by the most offset is still not taken for a stuck one.
  assert.ok(prMaxAge(true) > prTtl(true) + PR_SPREAD_MS && prMaxAge(false) > prTtl(false) + PR_SPREAD_MS);
});

test("budget: 10 quiet open runs of 2 PRs each stay under 500 GraphQL points an hour", withClock(async () => {
  const w = world();
  // Half the runs' PRs are approved, so their comments are read too (2 points each).
  const runs = Array.from({ length: 10 }, (_, i) => w.run(2, { review: i % 2 ? "APPROVED" : null }));
  const perPoll = [];
  for (let t = 0; t < 60 * MIN; t += 5000) {
    const before = w.calls.view;
    for (const r of runs) await refreshPrs(r, false);
    perPoll.push(w.calls.view - before);
    tick(5000);
  }
  console.log(`budget (quiet): ${w.points} GraphQL points/h (${w.calls.view} pr view, ${w.calls.comments} comments queries, ${w.calls.git} git calls; first poll ${perPoll[0]} pr views, busiest ${Math.max(...perPoll)})`);
  assert.ok(w.points < 500, `${w.points} points in an hour`);
  // Every run's backstop, not only the first poll's: each run is read about 12 times.
  assert.ok(w.calls.view >= 10 * 2 * 11, `${w.calls.view} reads`);
  // No burst, the first poll included: at most PR_BACKSTOP_CAP runs (2 PRs each) start a read per poll.
  assert.ok(Math.max(...perPoll) <= PR_BACKSTOP_CAP * 2, `busiest poll ${Math.max(...perPoll)} pr views`);
  assert.equal(perPoll[0], PR_BACKSTOP_CAP * 2, "the first poll reads only the capped runs");
}));

test("budget: 10 busy open runs (progress every minute, a task merged and pushed every 10) stay under 500 points an hour", withClock(async () => {
  const w = world();
  const runs = Array.from({ length: 10 }, (_, i) => w.run(2, { review: i % 2 ? "APPROVED" : null }));
  // The push of a merge: a minute after it (validated first), one PR's head moves on origin and on
  // GitHub, and its updatedAt with it (so an approved PR's comments are read again too).
  let pushes = 0;
  const push = (r, t) => {
    const pr = w.prs.get(r.prs[pushes % 2].url);
    pr.sha = SHA(100000 + ++pushes); pr.updatedAt = new Date(clock).toISOString();
    w.local.get(pr.head).origin = pr.sha;
  };
  const status = runs.map((r) => ({ status: "running", prs: r.prs.map((p) => p.url), tasks: { merged: 0, planned: 8 }, progress: "start", updated: "0" }));
  const sync = () => runs.forEach((r, i) => { r.filesSig = prFilesSig(status[i], "Status: running\n", "+Checks: pending — CI\n"); });
  sync();
  let triggers = 0;
  for (let t = 0; t < 60 * MIN; t += 5000) {
    // Each run's own step at its own second: set-status.sh stamps progress and updated every minute, and
    // merges a task every 10 minutes.
    status.forEach((s, i) => {
      if ((t / 1000 + i * 5) % 60 === 0) { s.progress = `step ${t}`; s.updated = String(t); }
      if ((t / 1000 + i * 5) % 600 === 0 && t > 0) { s.tasks = { ...s.tasks, merged: s.tasks.merged + 1 }; triggers++; }
      if ((t / 1000 + i * 5) % 600 === 60 && t > 60_000) push(runs[i], t);
    });
    sync();
    for (const r of runs) await refreshPrs(r, false);
    tick(5000);
  }
  console.log(`budget (busy): ${w.points} GraphQL points/h (${w.calls.view} pr view, ${w.calls.comments} comments queries, ${triggers} task merges, ${pushes} pushes)`);
  assert.ok(w.points < 500, `${w.points} points in an hour`);
  // The progress stamps read nothing. A merge reads, and so does its push a minute later (each puts
  // that run's backstop off 5 minutes), so each run reads about 18 times an hour: twice per merge and
  // a backstop between. With the push's comments queries on approved PRs that is about 430 points.
  assert.ok(triggers >= 50 && pushes >= 50, `${triggers} merges, ${pushes} pushes`);
  assert.ok(w.calls.view >= 10 * 2 * 15 && w.calls.view <= 10 * 2 * 20, `${w.calls.view} reads`);
}));

test("only what bears on PRs changes a run's file fingerprint", () => {
  const base = { status: "running", prs: ["u"], tasks: { merged: 1, planned: 4 }, progress: "a", updated: "2026-11-18T10:00:00Z", waiting: [] };
  const sig = prFilesSig(base, "Status: running\n## Tasks\n- [ ] t1", "+# Proof\nChecks: green — tests\nt1: ok");
  assert.equal(prFilesSig({ ...base, progress: "b", updated: "2026-11-18T10:05:00Z", waiting: ["x"], tokens: { total: 9 } },
    "Status: running\n## Tasks\n- [x] t1", "+# Proof\nChecks: green — tests\nt1: ok, t2: ok"), sig);
  assert.notEqual(prFilesSig({ ...base, prs: ["u", "v"] }, "Status: running\n", "+Checks: green — tests"), sig);
  assert.notEqual(prFilesSig({ ...base, tasks: { merged: 2, planned: 4 } }, "Status: running\n## Tasks\n- [ ] t1", "+# Proof\nChecks: green — tests\nt1: ok"), sig);
  assert.notEqual(prFilesSig(base, "Status: finished\n## Tasks\n- [ ] t1", "+# Proof\nChecks: green — tests\nt1: ok"), sig);
  assert.notEqual(prFilesSig(base, "Status: running\n## Tasks\n- [ ] t1", "+# Proof\nChecks: red — tests\nt1: ok"), sig);
});

test("a change in the run's files reads its PRs at the next poll past the floor, once for a burst", withClock(async () => {
  const w = world();
  const run = w.run(2);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 2);
  // Changed 10 s after the read: too soon; nothing is read until the floor has passed.
  tick(10_000);
  run.filesSig = textSig("plan.md now says the PR is open");
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 2);
  // A burst: the files change at every poll until the floor.
  for (let t = 15_000; t < PR_EVENT_FLOOR_MS; t += 5000) { tick(5000); run.filesSig = textSig(`burst ${t}`); await refreshPrs(run, false); }
  tick(PR_EVENT_FLOOR_MS - 25_000);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 4, "read once, at the first poll past the floor");
  // Nothing changed since: no more reads until the backstop.
  for (let i = 0; i < 20; i++) { tick(5000); await refreshPrs(run, false); }
  assert.equal(w.calls.view, 4);
}));

test("a push of a PR's head reads the PRs, once per state of the remote-tracking refs", withClock(async () => {
  const w = world();
  const run = w.run(2);
  await refreshPrs(run, false);
  tick(PR_EVENT_FLOOR_MS);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 2, "heads as GitHub has them: nothing to read");
  // A push: the remote-tracking ref moves; GitHub has not got it yet when it is read.
  const head = w.prs.get(run.prs[0].url).head;
  w.local.set(head, { origin: SHA(999), local: SHA(999) });
  tick(15_000);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 4, "read at the next look");
  // GitHub still says the old sha (the push was read before GitHub had it): not read again for the same state.
  for (let i = 0; i < 20; i++) { tick(5000); await refreshPrs(run, false); }
  assert.equal(w.calls.view, 4);
  // GitHub catches up, and the next push reads again.
  w.prs.get(run.prs[0].url).sha = SHA(999);
  w.local.set(head, { origin: SHA(998), local: SHA(998) });
  tick(15_000);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 6);
  // 21 looks over ~2 minutes of polls at 5 s: the git call comes at most every 15 s.
  assert.ok(w.calls.git <= 12, `${w.calls.git} git calls`);
}));

test("a local-only commit reads nothing; its push reads within the floor", withClock(async () => {
  const w = world();
  const run = w.run(2);
  await refreshPrs(run, false);
  const head = w.prs.get(run.prs[0].url).head;
  // A task merged into the integration branch: the local branch moves, origin and GitHub do not.
  tick(PR_EVENT_FLOOR_MS);
  w.local.get(head).local = SHA(777);
  for (let i = 0; i < 12; i++) { tick(5000); await refreshPrs(run, false); }
  assert.equal(w.calls.view, 2, "a local commit can't change what GitHub shows: no read");
  // It is pushed: origin moves to it; GitHub has it too by the next read.
  w.local.get(head).origin = SHA(777);
  w.prs.get(run.prs[0].url).sha = SHA(777);
  const pushed = clock;
  while (w.calls.view === 2 && clock - pushed < 60_000) { tick(5000); await refreshPrs(run, false); }
  assert.equal(w.calls.view, 4, "the push reads");
  assert.ok(clock - pushed <= PR_EVENT_FLOOR_MS, `read ${(clock - pushed) / 1000} s after the push`);
  for (let i = 0; i < 20; i++) { tick(5000); await refreshPrs(run, false); }
  assert.equal(w.calls.view, 4, "quiet again");
}));

test("a read that fails does not use up the change that fired it: the next poll past the floor tries again", withClock(async () => {
  const w = world();
  const run = w.run(2);
  await refreshPrs(run, false);
  tick(PR_EVENT_FLOOR_MS);
  run.filesSig = textSig("status.json gained a PR");
  w.fail = true;
  assert.equal(await refreshPrs(run, false), "files");
  w.fail = false;
  tick(5000);
  assert.equal(await refreshPrs(run, false), null, "within the floor of the failed read: not yet");
  tick(PR_EVENT_FLOOR_MS);
  assert.equal(await refreshPrs(run, false), "files", "tried again");
  const views = w.calls.view;
  for (let i = 0; i < 12; i++) { tick(5000); await refreshPrs(run, false); }
  assert.equal(w.calls.view, views, "read without error: used up");
}));

test("a parked or closed run reads at the 30-minute backstop and never reads a merged or closed PR again", withClock(async () => {
  const w = world();
  const done = w.run(2, { state: "MERGED" });
  const mixed = w.run(2);
  w.prs.get(mixed.prs[1].url).state = "CLOSED";
  await refreshPrs(done, true);
  await refreshPrs(mixed, true);
  assert.equal(w.calls.view, 4, "the first read reads them all");
  for (let t = 0; t < 2 * 60 * MIN; t += 5000) { tick(5000); await refreshPrs(done, true); await refreshPrs(mixed, true); }
  // `done` made no further call in two hours; `mixed` read its one open PR at each 30-minute backstop.
  const backstops = Math.floor(2 * 60 * MIN / (prTtl(true) + prOffset(mixed.key) + 5000));
  assert.ok(backstops >= 3);
  assert.ok(w.calls.view >= 4 + backstops && w.calls.view <= 4 + backstops + 1, `${w.calls.view} reads, ${backstops} backstops`);
  assert.equal(w.calls.git, 0, "no head look on a closed run");
}));

test("an open run still reads its merged PRs at the backstop (a PR may be reopened)", withClock(async () => {
  const w = world();
  const run = w.run(2, { state: "MERGED" });
  await refreshPrs(run, false);
  tick(prTtl(false) + prOffset(run.key));
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 4);
}));

test("opening a run (markOpened) reads it at the next poll when the last read is over a minute old; force reads at once", withClock(async () => {
  const w = world();
  const run = w.run(2);
  await refreshPrs(run, false);
  tick(45_000);
  markOpened(run);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 2, "45 s old: shown as read");
  tick(PR_OPENED_MS - 45_000);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 2, "that opening was used up: a minute later the pane alone reads nothing");
  markOpened(run.key);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 4, "opened again over a minute after the read: read");
  tick(1000);
  await refreshPrs(run, false, true);
  assert.equal(w.calls.view, 6, "an action's force read ignores the floor");
  // A parked run opened later keeps its merged PR's last read, without being told it is parked.
  const parked = { ...w.run(2), away: { how: "parked", at: clock } };
  w.prs.get(parked.prs[0].url).state = "MERGED";
  await refreshPrs(parked, true);
  tick(PR_OPENED_MS + 1000);
  const views = w.calls.view;
  markOpened(parked);
  await refreshPrs(parked, true);
  assert.equal(w.calls.view, views + 1, "only its open PR is read");
}));

test("two Harbormaster copies asking at once start one read", withClock(async () => {
  const w = world();
  const run = w.run(2);
  await refreshPrs(run, false);
  tick(prTtl(false) + PR_SPREAD_MS);
  await Promise.all([refreshPrs(run, false), refreshPrs(run, false), refreshPrs(run, false)]);
  assert.equal(w.calls.view, 4);
}));

test("each opening reads once when the last read is over a minute old, also with the run's pane already shown", withClock(async () => {
  const w = world();
  const run = w.run(2);
  await refreshPrs(run, false);
  const base = w.calls.view;
  // The pane is shown and polls; the user opens the run from its Crew row over a minute after the read.
  tick(PR_OPENED_MS + 1000);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, base, "the shown pane alone reads nothing");
  markOpened(run);
  assert.equal(await refreshPrs(run, false), "opened");
  assert.equal(w.calls.view, base + 2, "61 s old: read once");
  // Every copy polls: the mark is used up by the first.
  await refreshPrs(run, false);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, base + 2);
  // Opened again 30 s later: the last read is fresh, no read, and the mark is used up all the same.
  tick(30_000);
  markOpened(run);
  assert.equal(await refreshPrs(run, false), null);
  tick(PR_OPENED_MS);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, base + 2, "the 30 s opening does not read later by itself");
  // Opened again over a minute later: a read.
  markOpened(run);
  await refreshPrs(run, false);
  assert.equal(w.calls.view, base + 4);
  markOpened(null);
  markOpened(undefined);
}));

test("an opening that meets another copy deciding on the run is kept and read at the next poll", withClock(async () => {
  const w = world();
  const run = w.run(2);
  await refreshPrs(run, false);
  tick(PR_OPENED_MS + 1000);
  // One copy is deciding and waits on the head look (git over ssh, say).
  let release;
  w.gate = new Promise((r) => { release = r; });
  const deciding = refreshPrs(run, false);
  await new Promise((r) => setImmediate(r));
  markOpened(run);
  assert.equal(await refreshPrs(run, false), "busy", "the run pane's poll meets the claim");
  w.gate = null;
  release();
  assert.equal(await deciding, null, "the other copy found nothing (it decided before the opening)");
  assert.equal(w.calls.view, 2);
  assert.equal(await refreshPrs(run, false), "opened", "the next poll reads the kept opening");
  assert.equal(w.calls.view, 4);
}));

// The need box's focus button (overview.js needButton): focusing the run's own orchestrator opens the run,
// so the next poll reads its PRs; focusing a worker does not.
test("a need box's Open the orchestrator button marks the run opened; a worker's focus button does not", withClock(async () => {
  const t = new Proxy({}, { get: () => "#000" });
  const click = (r, address) => needButton({}, t, r, {}, { kind: "focus", label: "Open", address }, "b", "card", false).click({}, { stop_propagation() {}, notify() {} });
  const w = world();
  const run = { ...w.run(2), terminal: "t7" };
  await refreshPrs(run, false);
  tick(PR_OPENED_MS + 1000);
  click(run, "t9");
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 2, "a worker's terminal: nothing marked, nothing read");
  click(run, "t7");
  await refreshPrs(run, false);
  assert.equal(w.calls.view, 4, "the run's orchestrator: marked, read at the next poll");
}));
