// Accept / Ask to prove on a claim (claims.js, proof.js, data.js): proof-accepted.json kept and
// locked, the captain watcher's filter, and the writes end to end against a throwaway run
// directory: an acceptance that lapses when the result changes, a pending ask.
// Run: node --import ./loader.mjs --test proof-accept.test.mjs
// HM_KEEP_FILES=<file> writes the files the clicks wrote there (the task's proof).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, renameSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withRoot } from "./root.mjs";
import { acceptedFile, withAcceptance } from "../../herdr-app/mods/harbormaster/proof.js";
import { claimRows, claimsVerdict } from "../../herdr-app/mods/harbormaster/claims.js";
import { loadRuns, acceptProof, unacceptProof, WRITE_ACCEPTED } from "../../herdr-app/mods/harbormaster/data.js";
import { send, legacyOutcome } from "../../herdr-app/mods/harbormaster/inbox.js";

const here = dirname(fileURLToPath(import.meta.url));
const MD = `# Proof
Tier: T2
Checks: green — the suite

## C1 One works
Result: pass — 12 tests
Shot: shared/proof/c1.png
Test: one works — pass

## C2 The hover card shows
Result: partial — the hover card needs a real hover, not screenshotted
Shot: shared/proof/c2.png
`;
const SHOTS = ["c1.png", "c2.png"];

test("proof-accepted.json: other entries and fields are kept, a file that is not an object is refused", () => {
  const file = acceptedFile('{"t1": {"at": "a", "result": "fail — x", "note": "mine"}, "zz": 3}');
  const out = JSON.parse(withAcceptance(file, "t1", { at: "b", result: "fail — y" }));
  assert.deepEqual(out, { t1: { at: "b", result: "fail — y", note: "mine" }, zz: 3 });
  assert.deepEqual(acceptedFile(""), {});
  assert.deepEqual(acceptedFile(" \n"), {});
  assert.throws(() => acceptedFile("[1]"));
  assert.throws(() => acceptedFile("{broken"));
});

test("the write is refused under another writer's lock, or when the file changed since it was read", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-acc-"));
  const w = (was, text) => spawnSync("sh", ["-c", WRITE_ACCEPTED, "sh", dir, was, text], { encoding: "utf8" }).status;
  try {
    assert.equal(w("", "{\"a\":1}\n"), 0);
    assert.equal(readFileSync(join(dir, "proof-accepted.json"), "utf8"), "{\"a\":1}\n");
    assert.equal(w("{}", "{\"b\":1}\n"), 3);
    assert.equal(w("{\"a\":1}", "{\"b\":1}\n"), 0);
    mkdirSync(join(dir, "proof-accepted.json.lock"));
    assert.equal(w("{\"b\":1}", "{}\n"), 3);
    assert.deepEqual(readdirSync(dir).sort(), ["proof-accepted.json", "proof-accepted.json.lock"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the captain watcher does not take an ask to prove or a level request as an answer", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-watch-"));
  try {
    mkdirSync(join(dir, "inbox"));
    writeFileSync(join(dir, "inbox", "a-harbormaster-proof.message"), "prove t2 to T2: partial — x\nAsked from Harbormaster.\n");
    writeFileSync(join(dir, "inbox", "b-harbormaster-proof.message"), "prove C3 to T2: not proven yet\n");
    writeFileSync(join(dir, "inbox", "c-harbormaster-level.message"), "set autonomy to L2\n");
    writeFileSync(join(dir, "inbox", "d-captain.message"), 'Answer to "Q": Yes\nprove t2 to T2: x\n');
    const lib = join(here, "../../skills/herdr-app-captain/scripts/lib.sh");
    const r = spawnSync("bash", ["-c", 'source "$1"; answer_messages "$2"', "bash", lib, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split("\n").map((p) => p.split("/").pop()), ["d-captain.message"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
async function read(dir) {
  skew += 5000;
  const { runs } = await loadRuns();
  return runs.find((r) => r.dir === dir);
}

test("Accept, Unaccept and Ask to prove write the run's files, and the next read shows them", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-accept-"));
  const keep = process.env.HM_KEEP_FILES;
  const log = (title, text) => keep && appendFileSync(keep, `==> ${title}\n${text}${text.endsWith("\n") ? "" : "\n"}\n`);
  if (keep) writeFileSync(keep, "");
  try {
    withRoot(root);
    // A run directory with a quote, a $( ) and a space in its name stays one argument.
    const dir = join(root, "skills", `feat-'x $(touch pwned)"`);
    mkdirSync(join(dir, "shared", "proof"), { recursive: true });
    writeFileSync(join(dir, "orchestrator.json"), JSON.stringify({ branch: "feat-x", terminal: "t99", folder: "skills" }));
    writeFileSync(join(dir, "status.json"), JSON.stringify({ status: "running", autonomy: "L1", type: "feat" }));
    writeFileSync(join(dir, "plan.md"), "Status: running\nPrefix: fx\nProof tier: T2\n\n### t1 one — merged\n- Proof: T1 — tests\n\n### t2 two — merged\n- Proof: T2 — a screenshot of the hover card\n\n## Claims\n- C1 One works — AC 1 — tasks t1\n- C2 The hover card shows — AC 2 — tasks t2\n");
    writeFileSync(join(dir, "proof.md"), MD);
    for (const f of SHOTS) writeFileSync(join(dir, "shared", "proof", f), "x");
    let r = await read(dir);
    const rowsOf = (run) => claimRows(run.proof, run);
    let k = rowsOf(r)[1];
    assert.equal(k.result, "partial");
    assert.equal(k.accepted, null);

    await acceptProof(r, k);
    const file = readFileSync(join(dir, "proof-accepted.json"), "utf8");
    log("proof-accepted.json after Accept on C2", file);
    const entry = JSON.parse(file).C2;
    assert.equal(entry.result, "partial — the hover card needs a real hover, not screenshotted");
    assert.match(entry.at, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith(".proof-accepted")), []);
    r = await read(dir);
    k = rowsOf(r)[1];
    assert.equal(k.accepted.result, entry.result);
    assert.equal(k.state, "accepted");
    assert.equal(claimsVerdict(rowsOf(r), { md: r.proof.md }).text, "1 of 2 proven · 1 accepted");

    // The result changes: the acceptance stays in the file but no longer holds.
    writeFileSync(join(dir, "proof.md"), MD.replace("not screenshotted", "still not screenshotted"));
    r = await read(dir);
    assert.equal(rowsOf(r)[1].accepted, null);
    writeFileSync(join(dir, "proof.md"), MD);

    // A file someone broke by hand is not overwritten.
    writeFileSync(join(dir, "proof-accepted.json"), "{oops");
    await assert.rejects(unacceptProof(r, k), /not a JSON object/);
    assert.equal(readFileSync(join(dir, "proof-accepted.json"), "utf8"), "{oops");
    writeFileSync(join(dir, "proof-accepted.json"), file);
    // A read that fails changes nothing.
    const real = globalThis.__herdrExec;
    globalThis.__herdrExec = async (cmd, args) => (args?.[1]?.startsWith("[ -e") ? { code: 255, stdout: "", stderr: "connection lost" } : real(cmd, args));
    await assert.rejects(unacceptProof(r, k), /could not read proof-accepted.json: connection lost/);
    globalThis.__herdrExec = real;
    assert.equal(readFileSync(join(dir, "proof-accepted.json"), "utf8"), file);

    await unacceptProof(r, k);
    log("proof-accepted.json after Unaccept on C2", readFileSync(join(dir, "proof-accepted.json"), "utf8"));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "proof-accepted.json"), "utf8")), {});

    // The orchestrator t99 is not running here, so the ask only waits in the inbox.
    r = await read(dir);
    k = rowsOf(r)[1];
    assert.deepEqual(legacyOutcome(await send(r, "proof", { row: k })), { blocked: false, waits: true });
    const [msg] = readdirSync(join(dir, "inbox"));
    assert.match(msg, /^\d{8}T\d{6}Z-\d{3}-harbormaster-proof\.message$/);
    log(`inbox/${msg} after Ask to prove on C2`, readFileSync(join(dir, "inbox", msg), "utf8"));
    assert.match(readFileSync(join(dir, "inbox", msg), "utf8"), /^prove C2 to T2: partial — the hover card needs a real hover, not screenshotted\n/);
    r = await read(dir);
    assert.equal(rowsOf(r)[1].asked, true);
    // Not an answer: an open question must not read as answered.
    assert.equal(r.unhandled, 0);
    renameSync(join(dir, "inbox", msg), join(dir, "inbox", `${msg}.handled`));
    r = await read(dir);
    assert.equal(rowsOf(r)[1].asked, false);
    assert.deepEqual(spawnSync("find", [root, "-name", "pwned"], { encoding: "utf8" }).stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
    delete globalThis.__herdrExec;
  }
});

