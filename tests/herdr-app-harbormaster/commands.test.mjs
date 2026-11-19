// The commands Harbormaster hears, parsed, and the run a toast's click names (commands.js).
// Run: node --import ./loader.mjs --test commands.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, openRunAction, runNamed } from "../../herdr-app/mods/harbormaster/commands.js";

test("a command's name and arg, by colon or space, the arg keeping its own colons", () => {
  assert.deepEqual(parseCommand("show-run:feat/x details"), { name: "show-run", arg: "feat/x details" });
  assert.deepEqual(parseCommand("show-run feat/x"), { name: "show-run", arg: "feat/x" });
  assert.deepEqual(parseCommand("show-overview"), { name: "show-overview", arg: "" });
  assert.deepEqual(parseCommand("open-run:key=:/home/u/run"), { name: "open-run", arg: "key=:/home/u/run" });
  assert.deepEqual(parseCommand("open-run:key=local-ssh:/home/u/run"), { name: "open-run", arg: "key=local-ssh:/home/u/run" });
});

test("a toast's click opens the run it is about, not another machine's run at the same path", () => {
  const remote = { key: "local-ssh:/home/u/run", dir: "/home/u/run", branch: "feat/x", machine: "local-ssh" };
  const local = { key: ":/home/u/run", dir: "/home/u/run", branch: "feat/x" };
  const runs = [remote, local];
  const { name, arg } = parseCommand(openRunAction(local).replace(/^harbormaster\./, ""));
  assert.equal(name, "open-run");
  assert.equal(runNamed(runs, arg), local);
  assert.equal(runNamed(runs, parseCommand(openRunAction(remote).replace(/^harbormaster\./, "")).arg), remote);
  assert.equal(runNamed(runs, "key=:/nowhere"), undefined);
  // A directory alone still finds the first run at it, as show-run always did.
  assert.equal(runNamed(runs, "/home/u/run"), remote);
});

test("set-flow's argument: a folder name and peer, self or default", async () => {
  const { flowArgs } = await import("../../herdr-app/mods/harbormaster/commands.js");
  assert.deepEqual(flowArgs("acme=peer"), { key: "acme", flow: "peer" });
  assert.deepEqual(flowArgs(" skills=self "), { key: "skills", flow: "self" });
  assert.deepEqual(flowArgs("acme=default"), { key: "acme", flow: null });
  assert.equal(flowArgs("acme=maybe"), null);
  assert.equal(flowArgs("/a/acme=peer"), null);
  assert.equal(flowArgs(""), null);
});
