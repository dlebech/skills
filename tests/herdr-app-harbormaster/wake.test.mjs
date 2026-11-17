// The detached wake-up send: its hc arguments, and that its terminal is no agent of the crew.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detachedSend, wakeName, isWake } from "../../herdr-app/mods/harbormaster/wake.js";
import { facts, adrift } from "../../herdr-app/mods/harbormaster/live.js";
import { answerRun } from "../../herdr-app/mods/harbormaster/data.js";

test("the send is started detached, parentless and removed after, with the line as one argument", () => {
  const a = detachedSend("t5pw", "Read and act on /r/inbox/x.message.", "wake-abc");
  assert.deepEqual(a, ["run", "--bg", "--rm", "--no-notify", "--no-parent", "--label", "role=wake", "--name", "wake-abc", "--", "hc", "send", "t5pw", "Read and act on /r/inbox/x.message."]);
});
test("text that looks like an option stays the text", () => {
  const a = detachedSend("t1", "--help; rm -rf", "wake-x");
  assert.equal(a.at(-1), "--help; rm -rf");
  assert.ok(a.indexOf("--") < a.indexOf("hc"));
});
test("names are valid hc names and differ between calls", () => {
  const a = wakeName(Date.now(), 0.1), b = wakeName(Date.now(), 0.9);
  assert.match(a, /^[a-z0-9_-]{1,32}$/);
  assert.notEqual(a, b);
});
test("a terminal with role wake is a wake", () => {
  assert.ok(isWake({ labels: { role: "wake" } }));
  assert.ok(!isWake({ labels: { role: "orchestrator" } }));
  assert.ok(!isWake({}));
});

test("a wake terminal and its agent are left out of the facts, so they are not adrift", () => {
  globalThis.__herdrTerminals = [{ address: "t1", state: "live", labels: { role: "orchestrator" } }, { address: "t9", state: "live", labels: { role: "wake" } }];
  globalThis.__herdrAgents = [{ address: "t1", status: "idle" }, { address: "t9", status: "working" }];
  try {
    const f = facts();
    assert.deepEqual(f.terminals.map((t) => t.address), ["t1"]);
    assert.deepEqual(adrift(["t1"], f), []);
  } finally { delete globalThis.__herdrTerminals; delete globalThis.__herdrAgents; }
});

// A run on another machine: the window's address (m1/t7) differs from hc's own on that machine (t7).
const runOf = { dir: "/r", machine: "m1", terminal: "m1/t7", localTerminal: "t7", key: "k" };
// Models real hc on m1: `get` fails (exit 3) for a terminal that is gone, `run` starts anything.
const withHc = async ({ state = "live", status = "idle", gone = false } = {}, fn) => {
  const calls = [];
  globalThis.__herdrExec = async (cmd, args, opts) => {
    calls.push({ cmd, args, on: opts?.on });
    if (cmd !== "hc") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "get") return gone ? { code: 3, stdout: "", stderr: 'no terminal "t7"' } : { code: 0, stdout: JSON.stringify({ state }), stderr: "" };
    return { code: 0, stdout: "{}", stderr: "" };
  };
  globalThis.__herdrTerminals = [{ address: "m1/t7", state: "live", labels: { role: "orchestrator" } }];
  globalThis.__herdrAgents = [{ address: "m1/t7", status }];
  try { return [await fn(), calls.filter((c) => c.cmd === "hc")]; } finally { delete globalThis.__herdrExec; delete globalThis.__herdrTerminals; delete globalThis.__herdrAgents; }
};

test("answering checks the terminal, then wakes through a detached hc run on its machine", async () => {
  const [res, hc] = await withHc({}, () => answerRun(runOf, "Q", "Written"));
  assert.equal(res.blocked, false);
  assert.deepEqual(hc.map((c) => c.args[0]), ["get", "run"]);
  assert.ok(hc.every((c) => c.on === "m1"));
  assert.deepEqual(hc[0].args, ["get", "t7"]);
  assert.ok(hc[1].args.includes("--bg"));
  assert.deepEqual(hc[1].args.slice(-4, -1), ["hc", "send", "t7"]);
});
test("a terminal that is gone shows as an error and nothing is started", async () => {
  const [err, hc] = await withHc({ gone: true }, () => answerRun(runOf, "Q", "Written").catch((e) => e));
  assert.equal(err.inInbox, true);
  assert.match(err.message, /could not be told: no terminal/);
  assert.deepEqual(hc.map((c) => c.args[0]), ["get"]);
});
test("a terminal that is not live shows as an error", async () => {
  const [err] = await withHc({ state: "finished" }, () => answerRun(runOf, "Q", "Written").catch((e) => e));
  assert.equal(err.inInbox, true);
});
test("an orchestrator on a dialog is reported blocked and no wake is started", async () => {
  const [res, hc] = await withHc({ status: "blocked" }, () => answerRun(runOf, "Q", "Written"));
  assert.equal(res.blocked, true);
  assert.deepEqual(hc.map((c) => c.args[0]), ["get"]);
});
test("an orchestrator in error is not blocked: hc delivers to it", async () => {
  const [res, hc] = await withHc({ status: "error" }, () => answerRun(runOf, "Q", "Written"));
  assert.equal(res.blocked, false);
  assert.deepEqual(hc.map((c) => c.args[0]), ["get", "run"]);
});
