// Orchestrators lost to a restart: which runs come back, the line typed into the shell, and the
// machine-side script that types it once per shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, mkdirSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resumeLine, latestSession, revivable, REVIVE, RESUME, RESTART_NOTE, noteName, reviveRuns, forgetTried } from "../../herdr-app/mods/harbormaster/revive.js";
import { agentArgv, newUuid } from "../../herdr-app/mods/harbormaster/startrun.js";
import { resetShared } from "./herdr-stub.mjs";

test("each kind's resume command, typed after a cd into the run's folder", () => {
  assert.equal(resumeLine("claude", "3849af18-aa", "/home/u/app"), "cd '/home/u/app' && claude --resume 3849af18-aa");
  assert.equal(resumeLine("pi", "/home/u/.pi/agent/sessions/--x--/a.jsonl", ""), "pi --session /home/u/.pi/agent/sessions/--x--/a.jsonl");
  assert.equal(resumeLine("opencode", "ses_abc", "/p"), "cd '/p' && opencode --session ses_abc");
  assert.equal(resumeLine("copilot", "0cb9-26aa", "/p"), "cd '/p' && copilot --resume=0cb9-26aa");
});

test("nothing is typed for codex, a missing id, or an id or folder a shell would read as more", () => {
  assert.equal(resumeLine("codex", "x", "/p"), null);
  assert.equal(resumeLine("claude", null, "/p"), null);
  assert.equal(resumeLine("claude", "x; rm -rf ~", "/p"), null);
  assert.equal(resumeLine("claude", "$(id)", "/p"), null);
  assert.equal(resumeLine("claude", "x", "/it's"), null);
});

test("the latest session of the run's kind is the last line of that kind", () => {
  const text = "claude aaa\npi /f.jsonl\nclaude bbb\n\n";
  assert.equal(latestSession(text, "claude"), "bbb");
  assert.equal(latestSession(text, "pi"), "/f.jsonl");
  assert.equal(latestSession(text, "opencode"), null);
  assert.equal(latestSession("", "claude"), null);
});

test("only open runs whose orchestrator is lost, of a kind that resumes, not tried before", () => {
  const runs = [
    { key: "a", localTerminal: "t1", kind: "claude" },
    { key: "b", localTerminal: "t2", kind: "claude", away: { how: "parked" } },
    { key: "c", localTerminal: "t3", kind: "codex" },
    { key: "d", localTerminal: "t4", kind: null },
    { key: "e", localTerminal: "t5", kind: "pi" },
    { key: "f", localTerminal: null, kind: "claude" },
  ];
  const lost = (r) => r.key !== "e";
  assert.deepEqual(revivable(runs, {}, { lost }).map((r) => r.key), ["a", "d"]);
  assert.deepEqual(revivable(runs, {}, { lost, tried: new Set(["a"]) }).map((r) => r.key), ["d"]);
});

test("Copilot starts on a session id of ours; others start as before", () => {
  assert.deepEqual(agentArgv("copilot", () => "u-1"), ["copilot", "--session-id=u-1"]);
  assert.deepEqual(agentArgv("claude"), ["claude"]);
  assert.deepEqual(agentArgv("codex"), ["codex", "--no-daemon"]);
  assert.match(newUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("the note is named like the inbox's other messages", () => {
  assert.equal(noteName(new Date("2026-11-24T08:01:02.345Z")), "20261124T080102Z-345-harbormaster-restart.message");
  assert.match(RESTART_NOTE, /^restarted: /);
  assert.match(RESTART_NOTE, /Do not change the run's status/);
});

// The machine-side script, with a fake hc on PATH: `hc get` prints $HC_GET, `hc send` logs its arguments.
function machine({ get, sessions = "claude abc-123\n" }) {
  const root = mkdtempSync(join(tmpdir(), "revive-"));
  const bin = join(root, "bin"), run = join(root, "run");
  mkdirSync(bin); mkdirSync(run);
  if (sessions !== null) writeFileSync(join(run, "sessions"), sessions);
  writeFileSync(join(bin, "hc"), `#!/bin/sh\ncase $1 in get) [ -n "$HC_GET" ] || exit 3; printf '%s' "$HC_GET" ;; send) shift; printf '%s\\n' "$*" >>"${root}/sent" ;; esac\n`);
  chmodSync(join(bin, "hc"), 0o755);
  const go = (kind = "claude", folder = "/home/u/app") => execFileSync("sh", ["-c", REVIVE, "sh", run, "t7", kind, folder, "n.message", RESTART_NOTE], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HC_GET: get === undefined ? "" : JSON.stringify(get) },
  }).toString().trim();
  const sent = () => (existsSync(join(root, "sent")) ? readFileSync(join(root, "sent"), "utf8").trim().split("\n") : []);
  return { run, go, sent };
}
const shell = { state: "live", foreground: { pid: process.pid, argv: ["/bin/bash"] }, status: null };

test("a lost orchestrator's shell gets the resume line once, and the note lands in its inbox", () => {
  const m = machine({ get: shell });
  assert.equal(m.go(), "resumed");
  assert.deepEqual(m.sent(), ["t7 cd '/home/u/app' && claude --resume abc-123"]);
  assert.deepEqual(readdirSync(join(m.run, "inbox")), ["n.message"]);
  assert.equal(m.go(), "done");
  assert.equal(m.sent().length, 1);
  assert.equal(readdirSync(m.run).filter((f) => f.startsWith(".revived-")).length, 1);
});

test("the script's line is resumeLine's, for every kind", () => {
  for (const kind of Object.keys(RESUME)) {
    const m = machine({ get: shell, sessions: `${kind} id-1\n` });
    assert.equal(m.go(kind), "resumed");
    assert.equal(m.sent()[0], `t7 ${resumeLine(kind, "id-1", "/home/u/app")}`);
  }
});

test("nothing is typed into an agent, a gone terminal, without a session, or with an unsafe id", () => {
  assert.equal(machine({ get: { ...shell, foreground: { pid: 1, argv: ["claude"] } } }).go(), "notshell");
  assert.equal(machine({ get: { ...shell, status: { state: "idle" } } }).go(), "notshell");
  assert.equal(machine({ get: { ...shell, state: "finished" } }).go(), "gone");
  assert.equal(machine({}).go(), "gone");
  assert.equal(machine({ get: shell, sessions: null }).go(), "nosession");
  assert.equal(machine({ get: shell, sessions: "pi /x.jsonl\n" }).go(), "nosession");
  const bad = machine({ get: shell, sessions: "claude x;rm\n" });
  assert.equal(bad.go(), "unsafe");
  assert.deepEqual(bad.sent(), []);
  assert.equal(machine({ get: shell }).go("claude", "/it's"), "unsafe");
});

test("a working run's wake waits for its agent to report, then goes once", async () => {
  resetShared(); forgetTried();
  const run = { key: "k", dir: "/r", localTerminal: "t7", terminal: "t7", kind: "claude", phase: "running", branch: "b", topic: "T" };
  globalThis.__herdrExec = async () => ({ code: 0, stdout: "resumed\n", stderr: "" });
  globalThis.__herdrTerminals = [{ address: "t7", state: "live", program: { shell: true } }];
  globalThis.__herdrAgents = [];
  const woke = [];
  const wake = async (r, f) => woke.push([r.key, f]);
  try {
    assert.deepEqual(await reviveRuns([run], { wake, now: () => new Date("2026-11-24T08:00:00Z") }), ["T"]);
    assert.deepEqual(woke, []);
    globalThis.__herdrTerminals = [{ address: "t7", state: "live" }];
    globalThis.__herdrAgents = [{ address: "t7", status: "idle" }];
    assert.deepEqual(await reviveRuns([run], { wake }), []);
    assert.deepEqual(woke, [["k", "20261124T080000Z-000-harbormaster-restart.message"]]);
    await reviveRuns([run], { wake });
    assert.equal(woke.length, 1);
  } finally { delete globalThis.__herdrExec; delete globalThis.__herdrTerminals; delete globalThis.__herdrAgents; }
});

test("a waiting or finished run is resumed without a wake", async () => {
  resetShared(); forgetTried();
  const run = { key: "k2", dir: "/r", localTerminal: "t8", terminal: "t8", kind: "claude", phase: "finished", branch: "b" };
  globalThis.__herdrExec = async () => ({ code: 0, stdout: "resumed\n", stderr: "" });
  globalThis.__herdrTerminals = [{ address: "t8", state: "live", program: { shell: true } }];
  const woke = [];
  try {
    assert.deepEqual(await reviveRuns([run], { wake: async () => woke.push(1) }), ["b"]);
    globalThis.__herdrTerminals = [{ address: "t8", state: "live" }];
    globalThis.__herdrAgents = [{ address: "t8", status: "idle" }];
    await reviveRuns([run], { wake: async () => woke.push(1) });
    assert.deepEqual(woke, []);
  } finally { delete globalThis.__herdrExec; delete globalThis.__herdrTerminals; delete globalThis.__herdrAgents; }
});
