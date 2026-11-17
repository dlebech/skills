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

// answerRun runs the wake through exec: write the inbox (sh), then `hc run` (detached).
const runOf = { dir: "/r", machine: null, terminal: "t1", localTerminal: "t1", key: "k" };
const withExec = async (hcResult, fn) => {
  const calls = [];
  globalThis.__herdrExec = async (cmd, args) => { calls.push([cmd, args]); return cmd === "hc" ? hcResult : { code: 0, stdout: "", stderr: "" }; };
  globalThis.__herdrTerminals = [{ address: "t1", state: "live", labels: { role: "orchestrator" } }];
  globalThis.__herdrAgents = [{ address: "t1", status: "idle" }];
  try { return [await fn(), calls]; } finally { delete globalThis.__herdrExec; delete globalThis.__herdrTerminals; delete globalThis.__herdrAgents; }
};

test("answering wakes through a detached hc run, never a plain hc send", async () => {
  const [res, calls] = await withExec({ code: 0, stdout: "", stderr: "" }, () => answerRun(runOf, "Q", "Written"));
  assert.equal(res.blocked, false);
  const hc = calls.filter(([c]) => c === "hc");
  assert.equal(hc.length, 1);
  assert.equal(hc[0][1][0], "run");
  assert.ok(hc[0][1].includes("--bg"));
});
test("hc refusing to start the send still shows as an error, the message being in the inbox", async () => {
  await assert.rejects(withExec({ code: 1, stdout: "", stderr: "no such terminal" }, () => answerRun(runOf, "Q", "Written")),
    (e) => e.inInbox === true && /could not be told: no such terminal/.test(e.message));
});
