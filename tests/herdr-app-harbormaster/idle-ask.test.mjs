// An orchestrator that ended its turn asking in its tab only (no question.md, no waiting
// status): tracking.js agentsSince dates its idleness, and attend.js attentionOf puts the run in
// Needs you (idle-ask) after IDLE_ASK_MS, and back in Working once it works again. Clocks faked.
// Run: node --import ./loader.mjs --test idle-ask.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeRuns, agentsSince, lastActivity, withAgents, seededAgentsAt } from "../../herdr-app/mods/harbormaster/tracking.js";
import { shared, setShared } from "herdr";
import { attentionOf } from "../../herdr-app/mods/harbormaster/attend.js";
import { loadRuns } from "../../herdr-app/mods/harbormaster/data.js";
import { IDLE_ASK_MS } from "../../herdr-app/mods/harbormaster/attention.js";
import { withRoot } from "./root.mjs";

const MIN = 60000;
let wall = Date.parse("2026-11-16T12:00:00Z"), mono = 5000;
const realNow = Date.now;
Date.now = () => wall;
Object.defineProperty(globalThis, "performance", { value: { now: () => mono }, configurable: true });
const awake = (ms) => { wall += ms; mono += ms; };
const sleep = (ms) => { wall += ms; };

let root;
before(() => { root = mkdtempSync(join(tmpdir(), "hm-idle-")); withRoot(root); });
after(() => { rmSync(root, { recursive: true, force: true }); delete globalThis.__herdrExec; Date.now = realNow; });

const run = (key, o = {}) => ({
  key, dir: `/r/${key}`, folder: "/home/u/projects/skills", repo: "skills", terminal: `${key}-o`, phase: "running", statusLine: "running",
  progress: "planning", tasks: [], prs: [], related: [], question: null, ask: null, askedAt: null, away: null,
  updated: wall - 60 * MIN, started: wall - 120 * MIN, ...o,
});
// ctx: the orchestrator (status, turn) and its workers [{status, program?}].
const ctxOf = (r, status, turn = 1, workers = []) => ({
  terminals: [{ address: r.terminal, state: "live", status, turn, labels: { role: "orchestrator" } },
    ...workers.map((w, i) => ({ address: `${r.terminal}-w${i}`, parent: r.terminal, state: "live", status: w.status ?? null, turn: 1 }))],
  agents: [{ address: r.terminal, status }, ...workers.filter((w) => w.status).map((w, i) => ({ address: `${r.terminal}-w${i}`, status: w.status }))],
});
const poll = async (runs, ctx) => { observeRuns(runs, ctx, new Set([""])); };
// The run files read fresh (data.js filesFresh) at the test's last check, `ms` from now. A real
// read lists runs from the (empty) root and so forgets the activity of these runs, which it does
// not list: it is taken first, at that later time, and the clocks go back together (no sleep).
const freshFor = async (ms) => { awake(10 * MIN + ms); await loadRuns(); wall -= ms; mono -= ms; };
const keys = (a) => a.reasons.map((x) => x.key);

test("agentsSince starts at the first poll and moves only when the agents' signature changes: the orchestrator's status or turn", async () => {
  const r = run("a");
  assert.equal(agentsSince(r), null);
  await poll([r], ctxOf(r, "done", 3));
  const t0 = wall;
  assert.equal(agentsSince(r), t0);
  awake(MIN); await poll([r], ctxOf(r, "done", 3));
  assert.equal(agentsSince(r), t0, "same status and turn");
  awake(MIN); await poll([r], ctxOf(r, "done", 4));
  assert.equal(agentsSince(r), wall, "a new turn");
  const t1 = wall;
  awake(MIN); await poll([r], ctxOf(r, "idle", 4));
  assert.equal(agentsSince(r), wall, "a new status");
  assert.ok(agentsSince(r) > t1);
});

test("idle 2 minutes: Needs you (idle-ask); under it: Working, idle; working again: back to Working", async () => {
  await freshFor(IDLE_ASK_MS + 20000);
  const r = run("b");
  await poll([r], ctxOf(r, "done", 7));
  awake(IDLE_ASK_MS - MIN); await poll([r], ctxOf(r, "done", 7));
  let a = attentionOf(r, ctxOf(r, "done", 7), wall);
  assert.deepEqual([a.group, keys(a)], ["working", ["idle"]]);
  awake(MIN); await poll([r], ctxOf(r, "done", 7));
  a = attentionOf(r, ctxOf(r, "done", 7), wall);
  assert.deepEqual([a.group, keys(a)], ["needs", ["idle-ask"]]);
  assert.equal(a.reasons[0].text, "orchestrator idle — may be asking in its tab");
  assert.equal(a.reasons[0].since, wall - IDLE_ASK_MS);
  // The user answers in its tab: it works, so the next poll leaves Needs you.
  awake(10000); await poll([r], ctxOf(r, "working", 8));
  a = attentionOf(r, ctxOf(r, "working", 8), wall);
  assert.deepEqual([a.group, keys(a)], ["working", ["working"]]);
  // Its turn over, idle again: it needs the full grace again.
  awake(10000); await poll([r], ctxOf(r, "idle", 8));
  assert.equal(attentionOf(r, ctxOf(r, "idle", 8), wall).group, "working");
});

test("a working or blocked worker, or an orchestrator with no status, never triggers it; a plain program child does not stop it", async () => {
  const cases = [
    ["c1", [{ status: "working" }], "working"],
    ["c2", [{ status: "blocked" }], "working"],
    ["c3", [{ status: null }], "needs"], // a sampler script: no status
  ];
  await freshFor(IDLE_ASK_MS + MIN);
  const runs = cases.map(([k]) => run(k));
  const parts = cases.map(([, workers], i) => ctxOf(runs[i], "idle", 1, workers));
  const ctx = { terminals: parts.flatMap((c) => c.terminals), agents: parts.flatMap((c) => c.agents) };
  await poll(runs, ctx);
  awake(IDLE_ASK_MS + MIN); await poll(runs, ctx);
  cases.forEach(([k, , group], i) => {
    const a = attentionOf(runs[i], ctx, wall);
    assert.equal(a.group, group, k);
    assert.equal(keys(a).includes("idle-ask"), group === "needs", k);
  });
  // No status reported by the orchestrator itself (agentStatus would call it idle).
  await freshFor(IDLE_ASK_MS + MIN);
  const r = run("c4");
  const none = { terminals: [{ address: r.terminal, state: "live", turn: 1, labels: { role: "orchestrator" }, program: { shell: false } }], agents: [{ address: r.terminal }] };
  await poll([r], none);
  awake(IDLE_ASK_MS + MIN); await poll([r], none);
  assert.equal(keys(attentionOf(r, none, wall)).includes("idle-ask"), false);
});

test("agentsSince also moves when a worker's status or turn changes, or a worker comes or goes", async () => {
  const r = run("w");
  await poll([r], ctxOf(r, "idle", 1, [{ status: "idle" }]));
  const t0 = wall;
  awake(MIN); await poll([r], ctxOf(r, "idle", 1, [{ status: "idle" }]));
  assert.equal(agentsSince(r), t0);
  awake(MIN); await poll([r], ctxOf(r, "idle", 1, [{ status: "done" }]));
  assert.equal(agentsSince(r), wall, "a worker's status");
  const c = ctxOf(r, "idle", 1, [{ status: "done" }]);
  c.terminals[1].turn = 2;
  awake(MIN); await poll([r], c);
  assert.equal(agentsSince(r), wall, "a worker's turn");
  awake(MIN); await poll([r], ctxOf(r, "idle", 1));
  assert.equal(agentsSince(r), wall, "a worker gone");
});

test("new screen output moves the stall clock but not agentsSince", async () => {
  const r = run("p");
  const real = globalThis.__herdrExec;
  let screen = "Do we have a shared understanding?";
  globalThis.__herdrExec = async (cmd, args) => (cmd === "hc" && args[0] === "read" ? { code: 0, stdout: screen, stderr: "" } : real(cmd, args));
  try {
    const c = ctxOf(r, "idle", 1);
    await poll([r], c);
    const t0 = wall;
    awake(26 * MIN); await poll([r], c); // quiet past PROBE_AFTER: its screen is read
    await new Promise((ok) => setImmediate(ok));
    screen = "Something new printed";
    awake(MIN); await poll([r], c);
    await new Promise((ok) => setImmediate(ok));
    assert.equal(lastActivity(r), wall, "the probe saw new output");
    assert.equal(agentsSince(r), t0);
  } finally { globalThis.__herdrExec = real; }
});

test("a reload keeps the idle time: a fresh activity entry seeds from harbormaster.agents", async () => {
  await freshFor(0);
  const r = run("reload");
  const c = ctxOf(r, "done", 5);
  // As an earlier copy of the module left it (this one has no activity for the run): idle for an hour with this very signature.
  const sig = `${r.terminal}:done:5`;
  setShared("harbormaster.agents", { ...(shared("harbormaster.agents") ?? {}), [r.key]: { sig, since: wall - 60 * MIN } });
  await poll([r], c);
  assert.equal(agentsSince(r), wall - 60 * MIN);
  const a = attentionOf(r, c, wall);
  assert.deepEqual([a.group, keys(a)], ["needs", ["idle-ask"]]);
  // Another signature since (it worked meanwhile): not seeded.
  assert.equal(seededAgentsAt({ sig: "x:idle:1", since: 5 }, sig, 100), 100);
  assert.equal(seededAgentsAt({ sig, since: 5 }, sig, 100), 5);
  assert.equal(seededAgentsAt(null, sig, 100), 100);
});

test("harbormaster.agents is written only for a settled signature, and pruned with its run", async () => {
  const store = { k: { sig: "o:idle:1", since: 1 } };
  assert.equal(withAgents(store, "k", "o:idle:1", 1), store, "unchanged");
  assert.equal(withAgents(store, "k", "o:working:2", 9), store, "working: never written");
  assert.equal(withAgents(store, "k", "o:idle:2\nw:working:1", 9), store, "a worker working: never written");
  assert.deepEqual(withAgents(store, "k", "o:done:2", 9).k, { sig: "o:done:2", since: 9 });
  const r = run(":/r/gone");
  await poll([r], ctxOf(r, "idle", 1));
  assert.ok(shared("harbormaster.agents")[r.key]);
  await poll([run(":/r/else")], ctxOf(run(":/r/else"), "idle", 1));
  assert.equal(shared("harbormaster.agents")[r.key], undefined, "gone from a machine that answered");
  const f = run(":/r/fin");
  await poll([f], ctxOf(f, "idle", 1));
  await poll([{ ...f, phase: "finished" }], ctxOf(f, "idle", 1));
  assert.equal(shared("harbormaster.agents")[f.key], undefined, "finished");
});

test("a sleep does not reset the idle time: an orchestrator idle before it is still asking after it", async () => {
  await freshFor(3 * MIN);
  const r = run("slept");
  const c = ctxOf(r, "idle", 2);
  await poll([r], c);
  const t0 = wall;
  sleep(3 * MIN); await poll([r], c);
  assert.equal(agentsSince(r), t0);
  assert.deepEqual(keys(attentionOf(r, c, wall)), ["idle-ask"]);
});

test("an orchestrator working with \"1 shell still running\" never triggers it, however long", async () => {
  await freshFor(IDLE_ASK_MS + MIN);
  const r = run("shells");
  const c = ctxOf(r, "working", 3);
  c.agents[0].title = "1 shell still running";
  await poll([r], c);
  awake(IDLE_ASK_MS + MIN); await poll([r], c);
  const a = attentionOf(r, c, wall);
  assert.deepEqual([a.group, keys(a)], ["working", ["working"]]);
});

test("over budget with no question.md: Harbormaster's own budget item asks, so no idle-ask", async () => {
  await freshFor(IDLE_ASK_MS + MIN);
  const r = run("budget", { budget: 1000, tokens: { total: 1500 }, budgetAnswered: null });
  const c = ctxOf(r, "idle", 1);
  await poll([r], c);
  awake(IDLE_ASK_MS + MIN); await poll([r], c);
  assert.equal(keys(attentionOf(r, c, wall)).includes("idle-ask"), false);
  // Once that budget is answered, an idle orchestrator is asking in its tab again.
  assert.deepEqual(keys(attentionOf({ ...r, budgetAnswered: 1000 }, c, wall)), ["idle-ask"]);
});
