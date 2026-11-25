// Resume starts an orchestrator in a tab with launchArgv: through the user's interactive shell, which
// execs it, as start-agent.sh does with in-shell.sh. Its lines are in-shell.sh's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { IN_SHELL, launchArgv } from "../../herdr-app/mods/harbormaster/startrun.js";

const script = new URL("../../skills/herdr-app-orchestrator/scripts/in-shell.sh", import.meta.url);

test("IN_SHELL is in-shell.sh without its comments", () => {
  const body = readFileSync(script, "utf8").split("\n").filter((l) => !l.startsWith("#")).join("\n");
  assert.equal(IN_SHELL, body);
});

test("launchArgv wraps each kind's command, its arguments kept", () => {
  assert.deepEqual(launchArgv("claude"), ["sh", "-c", IN_SHELL, "sh", "claude"]);
  assert.deepEqual(launchArgv("codex").slice(4), ["codex", "--no-daemon"]);
  assert.deepEqual(launchArgv("copilot", () => "u-1").slice(4), ["copilot", "--session-id=u-1"]);
});

test("the agent launchArgv starts sees what ~/.bashrc adds, behind its interactive guard, as the process started", () => {
  const bash = spawnSync("sh", ["-c", "command -v bash"]).stdout.toString().trim();
  const dir = mkdtempSync(join(tmpdir(), "launch-argv-"));
  try {
    mkdirSync(join(dir, "nvm"));
    writeFileSync(join(dir, ".bashrc"), 'case $- in *i*) ;; *) return;; esac\necho banner\nexport PATH="$HOME/nvm:$PATH"\n');
    const agent = join(dir, "agent");
    writeFileSync(agent, '#!/bin/sh\necho "$$ $PATH" > "$HOME/seen"\n');
    chmodSync(agent, 0o755);
    const [prog, ...args] = launchArgv("x").slice(0, 4);
    const r = spawnSync(prog, [...args, agent], { env: { HOME: dir, SHELL: bash, PATH: "/usr/bin:/bin" } });
    const [pid, path] = readFileSync(join(dir, "seen"), "utf8").trim().split(" ");
    assert.equal(path.split(":")[0], join(dir, "nvm"));
    assert.equal(Number(pid), r.pid);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
