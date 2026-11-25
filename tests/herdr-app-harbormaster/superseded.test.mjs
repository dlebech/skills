// An orchestrator that finished one run and started the next in the same terminal: both run
// directories' orchestrator.json name that terminal. The sidebar gave the terminal one row (the first
// run in directory order), so the other run, still listed open or done by the Bridge, had no row.
// The terminal now serves one run (live.js supersededRuns); the other's orchestrator is gone.
// Run: node --import ./loader.mjs --test superseded.test.mjs
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetShared } from "herdr";
import { find } from "gpui-kit";
import { withRoot } from "./root.mjs";
import { loadRuns, askReread, stats, isClosed, putAway } from "../../herdr-app/mods/harbormaster/data.js";
import { supersededRuns, runDirLabel, orchestratorState, orchestratorLost, facts, tabOf, liveTabOf } from "../../herdr-app/mods/harbormaster/live.js";
import { runNamed } from "../../herdr-app/mods/harbormaster/commands.js";
import { crew } from "../../herdr-app/mods/harbormaster/crew.js";
import { revivable } from "../../herdr-app/mods/harbormaster/revive.js";
import { runOfProps } from "../../herdr-app/mods/harbormaster/runpane.js";
import { crewEntries, needRunsOf } from "../../herdr-app/mods/harbormaster/crewrows.js";
import { attOf } from "../../herdr-app/mods/harbormaster/needitems.js";

const orch = (labels = {}) => ({ address: "t1", state: "live", status: "working", labels: { role: "orchestrator", ...labels } });
const run = (dir, started, o = {}) => ({ key: `:${dir}`, dir, terminal: "t1", localTerminal: "t1", started, ...o });

test("the run started last owns a terminal two runs name; the other is superseded", () => {
  const old = run("/r/app/one", 1000), now = run("/r/app/two", 2000), apart = run("/r/app/three", 500, { terminal: "t2" });
  const ctx = { terminals: [orch()], agents: [] };
  assert.deepEqual([...supersededRuns([now, old, apart], ctx)], [old]);
});

test("the terminal's run.dir label wins over the start times: an older run resumed in it", () => {
  const old = run("/r/app/one", 1000), now = run("/r/app/two", 2000);
  const ctx = { terminals: [orch({ "run.dir": "app/one" })], agents: [] };
  assert.deepEqual([...supersededRuns([old, now], ctx)], [now]);
  assert.equal(runDirLabel("/home/u/.herdr/hc-orchestration/app/one/"), "app/one");
});

test("with no way to tell (no label, no or equal start times), no run is superseded", () => {
  const ctx = { terminals: [orch()], agents: [] };
  assert.equal(supersededRuns([run("/r/a/x", null), run("/r/a/y", null)], ctx).size, 0);
  assert.equal(supersededRuns([run("/r/a/x", 5), run("/r/a/y", 5)], ctx).size, 0);
  // A label naming neither (the run it serves was deleted): the terminal serves neither of them.
  assert.deepEqual([...supersededRuns([run("/r/a/x", 1), run("/r/a/y", 2)], { terminals: [orch({ "run.dir": "a/z" })], agents: [] })].map((r) => r.dir), ["/r/a/x", "/r/a/y"]);
});

test("a superseded run's orchestrator is gone, never lost, so it is not resumed into the new run's terminal", () => {
  const r = run("/r/a/x", 1, { superseded: true, kind: "claude" });
  // A shell in the terminal (the new run's agent exited): lost for its own run, not for this one.
  const ctx = { terminals: [{ ...orch(), status: null, program: { shell: true } }], agents: [] };
  assert.equal(orchestratorState(r, ctx), "gone");
  assert.equal(orchestratorLost(r, ctx), false);
  assert.deepEqual(revivable([r], ctx), []);
});

test("a pane pinned beside the terminal, or a command naming it, means the run it serves", () => {
  const old = run("/r/a/one", 1, { superseded: true }), now = run("/r/a/two", 2);
  assert.equal(runOfProps([old, now], { terminal: "t1" }), now);
  assert.equal(runNamed([old, now], "t1"), now);
  assert.equal(runNamed([old, now], "/r/a/one"), old, "its own directory still names it");
});

// The terminal's tab is the other run's: nothing done to the superseded run may close it.
const shared = { tab: "tab-1", terminal: "t1", pane: "p1" };

test("a superseded run has no tab, though its terminal is shown in one", () => {
  globalThis.__herdrPanes = [shared];
  const old = run("/r/a/one", 1, { superseded: true, tab: "tab-1" }), now = run("/r/a/two", 2, { tab: "tab-1" });
  assert.equal(liveTabOf(old), null);
  assert.equal(tabOf(old), null, "not the tab_id its orchestrator.json recorded either");
  assert.equal(liveTabOf(now), "tab-1");
  globalThis.__herdrPanes = undefined;
});

test("Park on an unfinished superseded run marks it and leaves the shared tab open", async () => {
  globalThis.__herdrPanes = [shared];
  globalThis.__herdrRun = [];
  const shells = [];
  globalThis.__herdrExec = async (cmd, args) => { shells.push(args?.[3]); return { code: 0, stdout: "", stderr: "" }; };
  const old = run("/r/a/one", 1, { superseded: true, tab: "tab-1", phase: "running", branch: "one", folder: "" });
  await putAway(old, "parked", "gone");
  assert.ok(shells.includes("/r/a/one"), "the parked marker is written");
  assert.deepEqual(globalThis.__herdrRun.filter(([name]) => name === "tab.close"), []);
  await putAway({ ...old }, "closed", "gone");
  assert.deepEqual(globalThis.__herdrRun.filter(([name]) => name === "tab.close"), [], "Close neither");
  globalThis.__herdrPanes = undefined;
  globalThis.__herdrRun = undefined;
});

// The real case, read from run directories as Harbormaster reads them.
let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), "hm-superseded-"));
  const make = (branch, started, status, topic) => {
    const dir = join(root, "app", branch);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orchestrator.json"), JSON.stringify({ branch, terminal: "t1", folder: "/p/app", kind: "claude", started }));
    writeFileSync(join(dir, "status.json"), JSON.stringify({ status, topic, updated: started }));
    writeFileSync(join(dir, "plan.md"), `Status: ${status}\n\n### t1 thing — ${status === "finished" ? "merged" : "implementing"}\n`);
  };
  // Directory order puts the newer run first, as in the bug: "ask-dialog" before "session-insights".
  make("ask-dialog", "2026-11-25T09:48:47Z", "running", "Ask via dialog");
  make("session-insights", "2026-11-25T07:45:02Z", "finished", "Session insights");
});
beforeEach(() => {
  resetShared();
  withRoot(root);
  globalThis.__herdrTerminals = [orch({ "run.topic": "Ask via dialog" })];
  globalThis.__herdrAgents = [{ address: "t1", status: "working" }];
});
after(() => { rmSync(root, { recursive: true, force: true }); globalThis.__herdrPanes = undefined; globalThis.__herdrRun = undefined; });

test("read from disk: the finished run whose terminal moved on is closed, and the Bridge and sidebar agree", async () => {
  const { runs } = await loadRuns();
  const ctx = facts();
  const by = (b) => runs.find((r) => r.branch === b);
  assert.equal(by("session-insights").superseded, true);
  assert.equal(by("ask-dialog").superseded, false);
  assert.equal(isClosed(by("session-insights"), ctx), true, "finished with its orchestrator gone: closed, like one whose agent exited");
  const s = stats(runs, ctx);
  assert.deepEqual(s.shown.map((r) => r.branch), ["ask-dialog"]);
  // Every run the Bridge lists as open or done has a sidebar row: its orchestrator's, here.
  const term = ctx.terminals[0];
  const orchs = [{ term, r: by("ask-dialog"), a: attOf(by("ask-dialog"), ctx) }];
  const rows = crewEntries(orchs, needRunsOf(s.shown, (r) => attOf(r, ctx)), (r) => attOf(r, ctx));
  assert.deepEqual(s.shown.filter((r) => !rows.some((x) => x.r === r)), []);
});

test("the sidebar's row for the shared terminal is the run it serves", async () => {
  const { runs } = await loadRuns();
  const view = { runs, decisions: [], folds: new Map(), busy: {} };
  const t = new Proxy({}, { get: () => "#888" });
  const text = (e) => (e && typeof e === "object" && "kids" in e ? e.kids.map(text).join("") : typeof e === "string" ? e : "");
  const d = crew(view, t);
  // Before, the row was the first run in directory order that named t1, whichever that was.
  assert.match(text(find(d, "crew-t1")), /Ask via dialog/);
  assert.doesNotMatch(text(d), /Session insights/);
  assert.match(text(find(d, "crew-group-working")), /Working · 1/);
});

test("a closed marker on the superseded run never closes the tab of the run working in it", async () => {
  const dir = join(root, "app", "session-insights");
  writeFileSync(join(dir, "closed"), "2026-11-25T09:00:00Z\tfinished\n");
  globalThis.__herdrPanes = [shared];
  globalThis.__herdrRun = [];
  try {
    askReread(); // loadRuns reuses a read under 2.5 s old
    const { runs } = await loadRuns();
    assert.equal(runs.find((r) => r.branch === "session-insights").away?.how, "closed");
    assert.equal(runs.find((r) => r.branch === "session-insights").superseded, true);
    await new Promise((r) => setTimeout(r, 100)); // tidyClosed runs in the background
    assert.deepEqual(globalThis.__herdrRun.filter(([name]) => name === "tab.close"), []);
  } finally {
    rmSync(join(dir, "closed"));
  }
});
