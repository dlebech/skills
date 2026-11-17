// The New run dialog's Start: a click (or Enter) either starts the run or says why not, never nothing.
// A click's cx is valid only during the click: the stub makes it throw once the click has returned,
// as Herdr's does ("stale context"), so Start's awaits must not use it.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initNewRun, newRunView } from "../../herdr-app/mods/harbormaster/newrun.js";
import { find } from "./gpui-stub.mjs";

const T = new Proxy({}, { get: () => "#000000" }); // any theme colour

// A cx for one call: it goes stale when the test says the call returned. Spawned work gets its own.
function callCx() {
  const cx = {
    stale: false, notified: 0, tasks: [],
    notify() { if (cx.stale) throw new Error("stale context"); cx.notified++; },
    stop_propagation() {}, bind_keys: () => 1,
    spawn(body) { const a = callCx(); const p = Promise.resolve().then(() => body(a)); cx.tasks.push({ cx: a, p }); return p; },
  };
  return cx;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

// A dialog for kind Describe, with `entry` chosen as its folder and a description typed.
function dialog(entry, text = "Fix the New run button") {
  globalThis.__herdrProps = { role: "newrun", kind: "describe", overlay: "ov1" };
  const view = {};
  initNewRun(view, callCx());
  const nr = view.nr;
  nr.entries = [entry];
  nr.folder = entry; nr.shown = entry.folder; nr.where.set_value(entry.folder);
  nr.text.set_value(text);
  return view;
}

// Clicks Start as Herdr does: the handler runs with a cx that is stale once it returns.
function clickStart(view) {
  const btn = find(newRunView(view, T), "nr-start");
  assert.ok(btn?.click, "Start has a click handler");
  const cx = callCx();
  btn.click({}, cx);
  cx.stale = true;
  return cx;
}

let rejections, execs;
const onRejection = (e) => rejections.push(e);
beforeEach(() => {
  rejections = []; execs = []; globalThis.__herdrClosed = null;
  process.removeListener("unhandledRejection", onRejection);
  process.on("unhandledRejection", onRejection);
  globalThis.__herdrExec = async (cmd, args) => {
    execs.push([cmd, ...args]);
    const script = args[1] ?? "";
    if (cmd === "bash") return { code: 0, stdout: "started t9\n", stderr: "" };
    if (script.includes("HERDR_ORCHESTRATION_ROOT")) return { code: 0, stdout: "/runs", stderr: "" };
    if (script.includes("start-agent.sh")) return { code: 0, stdout: "/s/herdr-app-orchestrator/scripts/start-agent.sh", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
});

// The user's case: this repository's folder offered without a space (its space's folder is elsewhere),
// so Start first looks again for a space opened meanwhile: an await before anything is drawn.
const noSpace = { folder: "/home/u/projects/skills", name: "skills", space: null, machine: null, recent: true };

test("Start on a folder without a space starts the run and closes the dialog", async () => {
  const view = dialog(noSpace);
  clickStart(view);
  await settle();
  assert.deepEqual(rejections, []);
  assert.ok(execs.some(([cmd]) => cmd === "bash"), "start-agent.sh ran");
  assert.equal(globalThis.__herdrClosed, "ov1");
});

test("Start that cannot start says why in the dialog", async () => {
  globalThis.__herdrExec = async (cmd, args) => (cmd === "sh" && args[1].includes("start-agent.sh") ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: "/runs", stderr: "" });
  const view = dialog(noSpace);
  const cx = clickStart(view);
  await settle();
  assert.deepEqual(rejections, []);
  assert.match(view.nr.error ?? "", /orchestrator skill is not installed/);
  assert.equal(view.nr.busy, false);
  assert.ok(cx.tasks.some((t) => t.cx.notified > 0), "the dialog was redrawn with the reason");
});

test("Start says Starting… at once, and a second click does not start a second run", async () => {
  const view = dialog(noSpace);
  clickStart(view);
  assert.equal(view.nr.busy, true);
  assert.equal(find(newRunView(view, T), "nr-start").click, null);
  await settle();
  assert.equal(execs.filter(([cmd]) => cmd === "bash").length, 1);
});

test("Start with a folder text that names no listed folder says to pick one", async () => {
  const view = dialog(noSpace);
  view.nr.where.set_value("~/projects/nope");
  clickStart(view);
  await settle();
  assert.deepEqual(rejections, []);
  assert.equal(view.nr.error, "Pick a folder from the list");
  assert.ok(!execs.some(([cmd]) => cmd === "bash"));
});

test("Enter in the description starts it too", async () => {
  const view = dialog(noSpace);
  const cx = callCx();
  view.nr.text.handlers.submit({}, cx);
  cx.stale = true;
  await settle();
  assert.deepEqual(rejections, []);
  assert.equal(globalThis.__herdrClosed, "ov1");
});

test("Start without a description asks for one", async () => {
  const view = dialog(noSpace, "  ");
  clickStart(view);
  await settle();
  assert.deepEqual(rejections, []);
  assert.equal(view.nr.error, "What should it do?");
});

// A folder with an open space skips the space lookup: its first await is the launch itself.
const withSpace = { folder: "/home/u/projects/skills", name: "skills", space: "sp-x", machine: null };

test("Start on a folder with a space that cannot start says why in the dialog", async () => {
  globalThis.__herdrExec = async (cmd, args) => (cmd === "bash" ? { code: 2, stdout: "", stderr: "hc: no core\n" }
    : { code: 0, stdout: args[1].includes("start-agent.sh") ? "/s/start-agent.sh" : "/runs", stderr: "" });
  const view = dialog(withSpace);
  const cx = clickStart(view);
  await settle();
  assert.deepEqual(rejections, []);
  assert.equal(view.nr.error, "Could not start it: hc: no core");
  assert.equal(view.nr.busy, false);
  assert.ok(cx.tasks.some((t) => t.cx.notified > 0), "the dialog was redrawn with the reason");
  assert.equal(globalThis.__herdrClosed, null);
});

test("A start that began but was not confirmed keeps the dialog open, says where to look, and offers Close", async () => {
  globalThis.__herdrExec = async (cmd, args) => (cmd === "bash" ? { code: 1, stdout: "unconfirmed t9\n", stderr: "" }
    : { code: 0, stdout: args[1].includes("start-agent.sh") ? "/s/start-agent.sh" : "/runs", stderr: "" });
  const view = dialog(withSpace);
  const cx = clickStart(view);
  await settle();
  assert.deepEqual(rejections, []);
  assert.equal(view.nr.done, true);
  assert.match(view.nr.error, /did not take the task/);
  assert.ok(cx.tasks.some((t) => t.cx.notified > 0));
  assert.equal(globalThis.__herdrClosed, null);
  assert.equal(find(newRunView(view, T), "nr-start").click, null, "no second start");
});

test("Crew's one-click Review redraws from a task, not the click's stale cx", async () => {
  const { nextAction } = await import("../../herdr-app/mods/harbormaster/crew.js");
  globalThis.__herdrExec = async (cmd, args) => (cmd === "sh" && args[1].includes("start-agent.sh") ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: "/runs", stderr: "" });
  const it = { kind: "review", local: { space: "sp-x", root: "/home/u/projects/skills" }, number: 52, url: "https://github.com/o/r/pull/52" };
  const btn = find(nextAction({ t: T }, it, "nx"), "nx-act");
  assert.ok(btn?.click, "Review has a click handler");
  const cx = callCx();
  btn.click({}, cx);
  cx.stale = true;
  await settle();
  assert.deepEqual(rejections, []);
  assert.ok(cx.tasks.some((t) => t.cx.notified > 0), "the row was redrawn after the start");
});
