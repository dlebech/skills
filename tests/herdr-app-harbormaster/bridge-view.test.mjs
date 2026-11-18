// The Bridge drawn with the test stubs (overview.js cards): its blocks, with and without a captain, wide and narrow,
// the fold of a run's line, and Resume on a parked row.
// Run: node --import ./loader.mjs --test bridge-view.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetShared } from "herdr";
import { find } from "gpui-kit";
import { cards } from "../../herdr-app/mods/harbormaster/overview.js";

const t = new Proxy({}, { get: () => "#888" });
const text = (e) => (e && typeof e === "object" && "kids" in e ? e.kids.map(text).join(" ") : typeof e === "string" || typeof e === "number" ? String(e) : "");
const cx = { notify() {}, stop_propagation() {}, spawn() {} };
const MIN = 60000;
const ago = (m) => Date.now() - m * MIN;
const run = (n, o = {}) => ({
  key: `:/r/${n}`, dir: `/r/${n}`, branch: `feat-${n}`, folder: "/p/skills", repo: "skills", type: "feat", phase: "running", statusLine: "running", progress: `${n} implementing`,
  tasks: [], prs: [], related: [], waiting: [], unhandled: 0, decided: [], issues: [], reports: [], proof: {}, question: null, ask: null, askedAt: null, away: null, updated: ago(60), started: ago(300),
  terminal: `w/${n}`, localTerminal: true, autonomy: "L1", machine: null, ...o,
});
const captain = { address: "cap", name: "captain", labels: { role: "captain" }, state: "live", status: "idle" };
const orch = (n) => ({ address: `w/${n}`, name: n, labels: { role: "orchestrator" }, state: "live", status: "idle" });
let view;
const draw = (runs, { width = 860 } = {}) => {
  view.runs = runs;
  view.size = { width };
  return cards(view, t, runs, [], []);
};
beforeEach(() => {
  resetShared();
  view = { runs: [], decisions: [], folds: new Map(), busy: {}, replying: null };
  globalThis.__herdrTerminals = [captain, orch("a"), orch("b")];
  globalThis.__herdrAgents = [];
  globalThis.__herdrOpened = null;
  globalThis.__herdrExec = async () => ({ code: 0, stdout: "[]", stderr: "" });
});
const parkedRun = run("p", { terminal: undefined, localTerminal: undefined, away: { how: "parked", at: ago(3 * 24 * 60) } });

test("the Bridge draws its blocks, with a captain and without, wide and narrow", () => {
  for (const withCaptain of [true, false]) for (const width of [860, 320]) {
    globalThis.__herdrTerminals = withCaptain ? [captain, orch("a"), orch("b")] : [orch("a"), orch("b")];
    const d = draw([run("a"), run("b"), parkedRun], { width });
    const s = text(d);
    for (const want of ["Bridge", "Open runs", "Parked", "This week"]) assert.ok(s.includes(want), `${want} (captain ${withCaptain}, width ${width})`);
    assert.ok(!s.includes("Waiting on you"));
    assert.ok(find(d, withCaptain ? "open-chat" : "start-captain"), "the captain strip's button");
    assert.equal(find(d, withCaptain ? "start-captain" : "open-chat"), null);
    assert.ok(find(d, "bridge-left") && find(d, "bridge-right"));
  }
});

test("a run is one line until clicked, then its card shows under it; clicking again folds it; Unfold all and Fold all", () => {
  const runs = [run("a"), run("b")];
  assert.equal(find(draw(runs), "run-:/r/a"), null, "folded runs build no card");
  assert.match(text(find(draw(runs), "bridge-run-:/r/a")), /feat-a/);
  find(draw(runs), "bridge-run-:/r/a").click({}, cx);
  assert.ok(find(draw(runs), "run-:/r/a"));
  assert.equal(find(draw(runs), "run-:/r/b"), null);
  assert.match(text(find(draw(runs), "bridge-unfold-all")), /Unfold all/);
  find(draw(runs), "bridge-unfold-all").click({}, cx);
  assert.ok(find(draw(runs), "run-:/r/b"));
  assert.match(text(find(draw(runs), "bridge-unfold-all")), /Fold all/);
  find(draw(runs), "bridge-unfold-all").click({}, cx);
  assert.equal(find(draw(runs), "run-:/r/a"), null);
  find(draw(runs), "bridge-run-:/r/a").click({}, cx);
  find(draw(runs), "bridge-run-:/r/a").click({}, cx);
  assert.equal(find(draw(runs), "run-:/r/a"), null);
});

test("no runs: the empty lines; a parked run is a row with Resume, which asks before resuming; a chevron-click unfolds its card", () => {
  assert.match(text(draw([])), /No runs in progress\. Start one with \+ New run in the sidebar, or ask the captain\.[\s\S]*Nothing parked\./);
  const d = draw([run("a"), parkedRun]);
  const row = text(find(d, "bridge-parked-item-:/r/p"));
  assert.match(row, /parked 3d/);
  assert.ok(row.includes("Resume"));
  assert.equal(find(d, "run-:/r/p"), null);
  assert.equal(find(d, "yes-bridge-:/r/p"), null);
  find(d, "bridge-resume-:/r/p").click({}, cx);
  assert.ok(find(draw([run("a"), parkedRun]), "yes-bridge-:/r/p"), "the confirm step");
  find(draw([run("a"), parkedRun]), "bridge-parked-:/r/p").click({}, cx);
  const open = draw([run("a"), parkedRun]);
  assert.ok(find(open, "run-:/r/p"));
  assert.equal(find(open, "yes-bridge-:/r/p"), null, "the card shows the confirm once, not the row too");
});

test("the columns: two side by side when wide, stacked when narrow; the popup's first draw is wide", () => {
  const two = draw([run("a")], { width: 860 });
  const one = draw([run("a")], { width: 500 });
  assert.ok(find(two, "bridge-cols") && !find(two, "bridge-stack"));
  assert.ok(find(one, "bridge-stack") && !find(one, "bridge-cols"));
  assert.deepEqual(find(two, "bridge-cols").kids.map((c) => c.idv), ["bridge-left", "bridge-right"]);
  assert.deepEqual(find(one, "bridge-stack").kids.map((c) => c.idv), ["bridge-left", "bridge-right"]);
  // No size event yet: the popup (an overlay) opens at BRIDGE_SIZE, the pane beside the captain as one column.
  const first = (overlay) => { globalThis.__herdrProps = { overlay }; try { return cards({ runs: [], decisions: [], folds: new Map(), busy: {} }, t, [], [], []); } finally { globalThis.__herdrProps = undefined; } };
  assert.ok(find(first(true), "bridge-cols"));
  assert.ok(find(first(false), "bridge-stack"));
});

test("a run that moves to another block starts folded there; Unfold all leaves Parked alone; gone runs' keys are pruned", () => {
  const a = run("a"), b = run("b");
  find(draw([a, b]), "bridge-unfold-all").click({}, cx);
  assert.ok(find(draw([a, b]), "run-:/r/a"));
  const parked = run("a", { terminal: undefined, localTerminal: undefined, away: { how: "parked", at: ago(60) } });
  const d = draw([parked, b]);
  assert.equal(find(d, "run-:/r/a"), null, "its Parked row is folded");
  assert.ok(find(d, "run-:/r/b"), "b stays unfolded");
  assert.deepEqual([...view.bridgeOpen], ["open::/r/b"]);
  draw([]);
  assert.equal(view.bridgeOpen.size, 0);
});

test("Resume marks the run busy at once, on the row and the card, so a second click does nothing", () => {
  globalThis.__herdrExec = async () => ({ code: 0, stdout: "[]", stderr: "" });
  const runs = [parkedRun];
  find(draw(runs), "bridge-resume-:/r/p").click({}, cx);
  find(draw(runs), "yes-bridge-:/r/p").click({}, cx);
  assert.equal(view.busy[":/r/p"].label, "Resuming…");
  assert.equal(view.confirm, null);
  find(draw(runs), "bridge-resume-:/r/p").click({}, cx);
  assert.equal(view.confirm, null, "a second Resume click asks nothing");
  find(draw(runs), "bridge-parked-:/r/p").click({}, cx);
  const card = text(find(draw(runs), "run-:/r/p"));
  assert.match(card, /Resuming…/);
});

test("the captain strip: a stopped watcher says what to do, in full as its tooltip; the no-captain line is the brief's", () => {
  const d = draw([run("a")]);
  assert.match(text(find(d, "captain-watch")), /Watcher not running · ask the captain to watch/);
  globalThis.__herdrTerminals = [orch("a")];
  assert.match(text(find(draw([run("a")]), "captain")), /The Bridge works without one\. Start a captain when you want someone to talk to across runs\./);
});
