// Starting the captain from Harbormaster: the pure parts (startrun.js) and the dialog's Start.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { captainName, captainProblem, captainArgs, remember, parsePrefs } from "../../herdr-app/mods/harbormaster/startrun.js";
import { initNewRun, newRunView } from "../../herdr-app/mods/harbormaster/newrun.js";
import { find } from "./gpui-stub.mjs";

const T = new Proxy({}, { get: () => "#000000" });
const live = (name, labels = {}) => ({ name, address: `t/${name}`, state: "live", labels });

test("captainName is captain, or the next free captain-<n> among live terminals", () => {
  assert.equal(captainName([]), "captain");
  assert.equal(captainName([live("orc-x")]), "captain");
  assert.equal(captainName([live("captain")]), "captain-2");
  assert.equal(captainName([live("captain"), live("captain-2")]), "captain-3");
  assert.equal(captainName([{ name: "captain", state: "gone" }]), "captain");
});

test("a live captain blocks a second one, with the reason", () => {
  assert.equal(captainProblem([live("orc-x", { role: "orchestrator" })]), null);
  assert.match(captainProblem([live("captain", { role: "captain" })]), /already running/);
});

test("the captain's arguments: no parent, role=captain, the folder's space, its own tab", () => {
  const a = captainArgs({ name: "captain", cwd: "/p", taskFile: "/r/f", spaceId: "sp-p" });
  assert.ok(a.includes("--no-parent"));
  assert.ok(a.includes("role=captain") && !a.includes("role=orchestrator"));
  assert.ok(a.includes("herdr.space=sp-p") && a.includes("herdr.tab=tb-captain"));
  assert.equal(a[a.indexOf("--cwd") + 1], "/p");
});

test("remembering a captain start keeps the folder and leaves the profile alone", () => {
  const prefs = parsePrefs(JSON.stringify({ profile: { implementer: "opus" }, folders: ["/a"] }));
  const next = remember(prefs, { kind: "captain", profile: null, repo: "/b", drafts: "herdr" });
  assert.deepEqual(next.folders, ["/b", "/a"]);
  assert.equal(next.profile.implementer, "opus");
});

// ---- the dialog ----
function callCx() {
  const cx = { stale: false, notified: 0, tasks: [],
    notify() { if (cx.stale) throw new Error("stale context"); cx.notified++; },
    stop_propagation() {}, bind_keys: () => 1,
    spawn(body) { const a = callCx(); const p = Promise.resolve().then(() => body(a)); cx.tasks.push({ cx: a, p }); return p; } };
  return cx;
}
const settle = () => new Promise((r) => setTimeout(r, 30));
const entry = { folder: "/home/u/projects/skills", name: "skills", space: "sp-x", machine: null };
let execs, rejections;
const onRejection = (e) => rejections.push(e);
beforeEach(() => {
  execs = []; rejections = []; globalThis.__herdrClosed = null; globalThis.__herdrTerminals = [];
  process.removeListener("unhandledRejection", onRejection); process.on("unhandledRejection", onRejection);
  globalThis.__herdrExec = async (cmd, args) => {
    execs.push([cmd, ...args]);
    if (cmd === "bash") return { code: 0, stdout: "started t9\n", stderr: "" };
    return { code: 0, stdout: (args[1] ?? "").includes("start-agent.sh") ? "/s/start-agent.sh" : "/runs", stderr: "" };
  };
});
function dialog() {
  globalThis.__herdrProps = { role: "newrun", kind: "captain", overlay: "ov1" };
  const view = {}; initNewRun(view, callCx());
  const nr = view.nr; nr.entries = [entry]; nr.folder = entry; nr.shown = entry.folder; nr.where.set_value(entry.folder);
  return view;
}
function click(view) {
  const btn = find(newRunView(view, T), "nr-start");
  const cx = callCx(); btn.click({}, cx); cx.stale = true; return cx;
}

test("Start captain starts it in the folder, with /herdr-app-captain, and closes the dialog", async () => {
  const view = dialog();
  assert.equal(find(newRunView(view, T), "nr-k-issue"), null, "no run fields in the captain dialog");
  click(view); await settle();
  assert.deepEqual(rejections, []);
  const bash = execs.find(([c]) => c === "bash");
  assert.ok(bash.includes("role=captain") && bash.includes("--no-parent"));
  assert.equal(globalThis.__herdrClosed, "ov1");
});

test("Start captain with a live captain says so and starts nothing", async () => {
  globalThis.__herdrTerminals = [live("captain", { role: "captain" })];
  const view = dialog();
  click(view); await settle();
  assert.match(view.nr.error, /already running/);
  assert.ok(!execs.some(([c]) => c === "bash"));
});

test("Start captain that cannot start shows the reason in the dialog", async () => {
  globalThis.__herdrExec = async (cmd, args) => (cmd === "bash" ? { code: 2, stdout: "", stderr: "hc: no core\n" }
    : { code: 0, stdout: (args[1] ?? "").includes("start-agent.sh") ? "/s/start-agent.sh" : "/runs", stderr: "" });
  const view = dialog();
  const cx = click(view); await settle();
  assert.deepEqual(rejections, []);
  assert.equal(view.nr.error, "Could not start it: hc: no core");
  assert.ok(cx.tasks.some((t) => t.cx.notified > 0));
  assert.equal(globalThis.__herdrClosed, null);
});

test("Start captain starts over a task file an interrupted start left behind", async () => {
  // Herdr refuses to write a new file (expected text null) over one that exists.
  let leftover = true;
  const exec = globalThis.__herdrExec;
  globalThis.__herdrExec = async (cmd, args) => {
    if (cmd === "sh" && /rm -f "\$1"/.test(args[1] ?? "")) leftover = false;
    return exec(cmd, args);
  };
  globalThis.__herdrWrite = async (_p, _s, expected) => {
    if (expected === null && leftover) throw new Error("`herdr.writeTextFile`: The file changed outside Herdr.");
  };
  try {
    const view = dialog();
    click(view); await settle();
    assert.deepEqual(rejections, []);
    assert.equal(view.nr.error ?? null, null);
    assert.ok(execs.some(([c]) => c === "bash"));
  } finally { globalThis.__herdrWrite = null; }
});

// ---- the buttons: shown only while no captain is live ----
test("the sidebar header and the overview strip offer Start captain only without a live captain", async () => {
  const { harborHeader } = await import("../../herdr-app/mods/harbormaster/crew.js");
  const { captainStrip } = await import("../../herdr-app/mods/harbormaster/overview.js");
  const cap = (terminal) => ({ terminal, watching: false });
  const header = (terminal, asks = 0) => harborHeader({ t: T, view: { runs: [] }, ctx: { terminals: [], agents: [] }, cap: cap(terminal), asks });
  const strip = (terminalList) => captainStrip({ runs: [] }, T, { terminals: terminalList, agents: [] }, { live: [], docked: [] });
  const none = [live("orc-x", { role: "orchestrator" })], some = [live("captain", { role: "captain" })];

  assert.ok(find(header(null), "crew-start-captain"));
  assert.equal(find(header(null), "crew-captain-link"), null);
  assert.ok(find(header(some[0]), "crew-captain-link"));
  assert.equal(find(header(some[0]), "crew-start-captain"), null);
  assert.ok(find(strip(none), "start-captain"));
  assert.equal(find(strip(some), "start-captain"), null);
});
