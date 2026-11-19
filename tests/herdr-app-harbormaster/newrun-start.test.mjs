// The New run dialog's Start: a click (or Enter) either starts the run or says why not, never nothing.
// A click's cx is valid only during the click: the stub makes it throw once the click has returned,
// as Herdr's does ("stale context"), so Start's awaits must not use it.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initNewRun, newRunView, installedAgents } from "../../herdr-app/mods/harbormaster/newrun.js";
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
  globalThis.__herdrExec = async (cmd, args, opts) => {
    execs.push([cmd, ...args]);
    execs.at(-1).on = opts?.on ?? null;
    const script = args[1] ?? "";
    if (cmd === "bash" || script.includes('exec bash "$@"')) return { code: 0, stdout: "started t9\n", stderr: "" };
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

test("Crew's Review button opens New run prefilled; nothing starts", async () => {
  const { nextAction } = await import("../../herdr-app/mods/harbormaster/crew.js");
  const it = { kind: "review", local: { space: null, root: "/home/u/projects/skills" }, number: 52, url: "https://github.com/o/r/pull/52" };
  const btn = find(nextAction({ t: T }, it, "nx"), "nx-act");
  assert.ok(btn?.click, "Review has a click handler");
  globalThis.__herdrOpened = null;
  btn.click({}, callCx());
  await settle();
  assert.deepEqual(globalThis.__herdrOpened.props, { role: "newrun", repo: "/home/u/projects/skills", kind: "review", input: "52", url: it.url });
  assert.deepEqual(execs.filter((e) => e[0] === "bash"), [], "no run was started");
});

test("a review started from the dialog marks its PR starting, once; a failed start clears the mark", async () => {
  const { guardReview } = await import("../../herdr-app/mods/harbormaster/newrun.js");
  const { reviewStarting } = await import("../../herdr-app/mods/harbormaster/startrun.js");
  const url = "https://github.com/o/r/pull/77";
  let release, runs = 0;
  const first = guardReview({ id: url, url, run: () => { runs++; return new Promise((r) => { release = r; }); } });
  assert.equal(reviewStarting(url), true);
  const second = await guardReview({ id: url, url, run: async () => { runs++; return { ok: true }; } });
  assert.equal(second.ok, false);
  assert.equal(runs, 1, "a second start of the same PR does not run");
  release({ ok: true });
  assert.equal((await first).ok, true);
  assert.equal(reviewStarting(url), true, "a start keeps the mark");
  // A second dialog, after the first Start returned: the mark still holds, so it does not run either.
  const again = await guardReview({ id: url, url, run: async () => { runs++; return { ok: true }; } });
  assert.equal(again.ok, false);
  assert.equal(runs, 1);
  const url2 = "https://github.com/o/r/pull/78";
  await guardReview({ id: "x", url: url2, run: async () => ({ ok: false, error: "no" }) });
  assert.equal(reviewStarting(url2), false, "a failed start clears it");
  await assert.rejects(guardReview({ id: "y", url: url2, run: async () => { throw new Error("x"); } }));
  assert.equal(reviewStarting(url2), false);
});

test("the starting mark follows the PR the dialog was opened for, not another", async () => {
  const { sameReview } = await import("../../herdr-app/mods/harbormaster/newrun.js");
  assert.equal(sameReview("review", " 52 ", "52"), true);
  assert.equal(sameReview("review", "53", "52"), false);
  assert.equal(sameReview("issue", "52", "52"), false);
  assert.equal(sameReview("review", "52", undefined), false);
});

test("withFolder adds a requested clone that no list has, and only that", async () => {
  const { withFolder } = await import("../../herdr-app/mods/harbormaster/newrun.js");
  const listed = [{ folder: "/home/u/skills", name: "skills", space: "sp-s" }];
  assert.equal(withFolder(listed, "/home/u/skills"), listed);
  assert.equal(withFolder(listed, "skills"), listed);
  assert.equal(withFolder(listed, undefined), listed);
  const out = withFolder(listed, "/home/u/clone/x");
  assert.equal(out.length, 2);
  assert.equal(out[1].folder, "/home/u/clone/x");
  assert.equal(out[1].space, null);
});

test("a review's prompt from the dialog carries only the reviewer and autonomy", async () => {
  globalThis.__herdrProps = { role: "newrun", kind: "review", input: "52", overlay: "ov1" };
  const view = {};
  initNewRun(view, callCx());
  view.nr.prefs = { profile: { implementer: "opencode/qwen3.8flash", reviewer: "opus", specialist: "opus", autonomy: "L2" }, profiles: {}, reviewProfiles: {} };
  view.nr.agent = "claude";
  view.nr.profile.set_value("");
  const { profileText, prefillProfile } = await import("../../herdr-app/mods/harbormaster/startrun.js");
  assert.equal(profileText(prefillProfile(view.nr.prefs, "review", "claude")), "reviewer=opus autonomy=L1");
});

// With more than one agent installed the dialog offers them; the one picked is what starts.
test("Agent: found on the login shell's PATH, a row only when more than one, and the pick is the --kind", async () => {
  const base = globalThis.__herdrExec;
  let installed = "claude\n";
  globalThis.__herdrExec = async (cmd, args) => (cmd === "sh" && args[1].includes("__PATH__") ? { code: 0, stdout: installed, stderr: "" } : base(cmd, args));
  const open = async () => { const v = dialog(noSpace); v.nr.agents = await installedAgents(); v.nr.agent = "claude"; return v; };
  let view = await open();
  assert.deepEqual(view.nr.agents, ["claude"]);
  assert.equal(find(newRunView(view, T), "nr-a-claude"), null, "one agent: no choice");
  installed = "pi\nbash: no job control\nclaude\n";
  view = await open();
  assert.deepEqual(view.nr.agents, ["claude", "pi"], "in the dialog's order, noise ignored");
  const pi = find(newRunView(view, T), "nr-a-pi");
  assert.ok(pi?.click, "pi is offered");
  pi.click({}, callCx());
  assert.equal(view.nr.profile.value(), "autonomy=L1", "Claude's models are not prefilled for pi");
  clickStart(view);
  await settle();
  assert.deepEqual(rejections, []);
  const run = execs.find(([cmd]) => cmd === "bash");
  assert.equal(run[run.indexOf("--kind") + 1], "pi");
});

test("Start in another machine's folder runs everything there, with the space id as it names it", async () => {
  let wrote = false;
  globalThis.__herdrWrite = async (path) => { if (path.includes(".newrun-")) wrote = true; };
  const view = dialog({ folder: "/home/u/projects/skills", name: "skills", space: "desk/sp-skills", machine: "desk" });
  clickStart(view);
  await settle();
  assert.deepEqual(rejections, []);
  const bash = execs.find(([cmd, , script]) => cmd === "sh" && script?.includes('exec bash "$@"'));
  assert.ok(bash, "start-agent.sh ran, with the login PATH");
  assert.equal(bash.on, "desk");
  assert.ok(bash.includes("herdr.space=sp-skills"), "no machine prefix in the space label");
  assert.ok(execs.some((e) => e.on === "desk" && e[2]?.includes('printf %s "$2" > "$1"')), "the task file was written on desk");
  assert.equal(wrote, false, "the task file not with this machine's writeTextFile (the prefs are this machine's)");
  assert.equal(globalThis.__herdrClosed, "ov1");
  delete globalThis.__herdrWrite;
});

test("a Review button for another machine's checkout opens New run on that machine", async () => {
  const { nextAction } = await import("../../herdr-app/mods/harbormaster/crew.js");
  const it = { kind: "review", local: { space: "desk/sp-api", root: "/home/u/api", machine: "desk" }, number: 7, url: "https://github.com/o/api/pull/7" };
  globalThis.__herdrOpened = null;
  find(nextAction({ t: T }, it, "nx"), "nx-act").click({}, callCx());
  await settle();
  assert.deepEqual(globalThis.__herdrOpened.props, { role: "newrun", repo: "/home/u/api", machine: "desk", kind: "review", input: "7", url: it.url });
});
