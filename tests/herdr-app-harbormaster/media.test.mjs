// Unit tests for copying proof files (herdr-app/mods/harbormaster/media.js) from another machine,
// with exec faked: the base64 path, and one copy for one file however proof.md names it.
// Run: node --import ./loader.mjs --test media.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCopier } from "../../herdr-app/mods/harbormaster/media.js";

// Runs every command here; one with `on` (the "other machine") counts as a remote call.
function fakeExec(remote) {
  return async (cmd, args, opts = {}) => {
    if (opts.on) remote.push(args[1]);
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
}

test("a file named two ways is copied from the other machine once", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hm-media-"));
  try {
    const dir = join(tmp, "root/skills/demo"), home = join(tmp, "home");
    spawnSync("mkdir", ["-p", `${dir}/shared/proof`, home]);
    writeFileSync(`${dir}/shared/proof/shot.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 0, 255]));
    const remote = [];
    const copy = makeCopier({ exec: fakeExec(remote), writeTextFile: async (p, s) => writeFileSync(p, s), home });
    const run = { dir, machine: "box" };
    const a = await copy(run, "shared/proof/shot.png");
    const b = await copy(run, "shot.png");
    assert.equal(a.state, "ready");
    assert.equal(b.path, a.path);
    assert.deepEqual(readFileSync(a.abs), readFileSync(`${dir}/shared/proof/shot.png`));
    assert.equal(remote.filter((s) => s.includes("base64")).length, 1, "one base64 copy over the connection");
    assert.equal(readdirSync(a.abs.slice(0, a.abs.lastIndexOf("/"))).length, 1);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
