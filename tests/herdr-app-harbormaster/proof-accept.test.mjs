// A Proof row's result-first layout, and Accept / Ask to prove (proof.js, data.js): the row's
// parts in order, the verdict with accepted tasks, an acceptance that lapses when the result
// changes, a pending ask, the captain watcher's filter, and the writes end to end against a
// throwaway run directory.
// Run: node --import ./loader.mjs --test proof-accept.test.mjs
// HM_KEEP_FILES=<file> writes the files the clicks wrote there (the task's proof).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, renameSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { proofTasks, proofVerdict, proofRowParts, needsLook, resultLine, pendingProofs, proveRequest, parseAccepted, acceptedFile, withAcceptance, parseProofMd, proofTone, proofCounts, resultPill } from "../../herdr-app/mods/harbormaster/proof.js";
import { loadRuns, acceptProof, unacceptProof, askProof, WRITE_ACCEPTED } from "../../herdr-app/mods/harbormaster/data.js";

const here = dirname(fileURLToPath(import.meta.url));
const MD = `# Proof
Tier: T2
Checks: green — the suite

## t1 one
Tier: T1
Checked: tests
Result: pass — 12 tests
Files: shared/proof/t1.txt

## t2 two
Tier: T2
Checked: the hover card, by screenshot
Result: partial — the hover card needs a real hover, not screenshotted
Files: shared/proof/t2.png, shared/proof/t2.txt
`;
const TASKS = [
  { id: "t1", name: "one", proof: { tier: 1, text: "tests" } },
  { id: "t2", name: "two", proof: { tier: 2, text: "a screenshot of the hover card" } },
];
const SHOTS = ["t1.txt", "t2.png", "t2.txt"];

test("an unfolded row: the result first, without its Result: prefix, then thumbnails, details, actions", () => {
  const [, k] = proofTasks(TASKS, parseProofMd(MD), SHOTS);
  const parts = proofRowParts(k, false);
  assert.deepEqual(parts.map((p) => p.kind), ["result", "thumbs", "details", "actions"]);
  assert.deepEqual(parts[0], { kind: "result", text: "partial — the hover card needs a real hover, not screenshotted", tone: "partial" });
  assert.deepEqual(parts[2].items.map((x) => x.label), ["Planned", "Checked", "Files"]);
  assert.deepEqual(parts[3].actions, ["accept", "ask"]);
  // A pass row unfolds the same way, with nothing to accept.
  const pass = proofRowParts(proofTasks(TASKS, parseProofMd(MD), SHOTS)[0], false);
  assert.deepEqual(pass.map((p) => p.kind), ["result", "thumbs", "details"]);
  assert.equal(pass[0].text, "pass — 12 tests");
  // Nothing checked yet: just the result line and the actions.
  const bare = proofRowParts(proofTasks(TASKS, null, null)[1], true);
  assert.deepEqual(bare.map((p) => p.kind), ["result", "details", "actions"]);
  assert.deepEqual(bare[0], { kind: "result", text: "not checked", tone: "unchecked" });
  const unscoped = proofRowParts(proofTasks([{ id: "t9", name: "", proof: null }], null, null)[0], false);
  assert.equal(unscoped[0].text, "not scoped — no Proof line in plan.md");
});

test("the verdict counts an accepted task apart, and it no longer needs a look", () => {
  const md = parseProofMd(MD);
  const tier = { tier: 2, byUser: false };
  assert.equal(proofVerdict({ tier, md, tasks: TASKS, danger: null, shotFiles: SHOTS }).text, "Proof T2 · 1/2 pass · 1 partial · checks green");
  const accepted = { t2: { at: "2026-11-16T10:00:00Z", result: "partial — the hover card needs a real hover, not screenshotted" } };
  const v = proofVerdict({ tier, md, tasks: TASKS, danger: null, shotFiles: SHOTS, accepted });
  assert.deepEqual(v, { text: "Proof T2 · 1/2 pass · 1 accepted · checks green", tone: "done" });
  const k = proofTasks(TASKS, md, SHOTS, { accepted })[1];
  assert.equal(k.accepted.at, "2026-11-16T10:00:00Z");
  assert.equal(needsLook(k, true), false);
  assert.equal(proofTone(k, true), "accepted");
  assert.deepEqual(proofRowParts(k, false).at(-1).actions, ["unaccept"]);
});

test("an acceptance holds only for the result line it accepted", () => {
  const accepted = { t2: { at: "2026-11-16T10:00:00Z", result: "partial — the hover card needs a real hover, not screenshotted" } };
  const changed = parseProofMd(MD.replace("needs a real hover", "needs a real hover and a video"));
  const k = proofTasks(TASKS, changed, SHOTS, { accepted })[1];
  assert.equal(k.accepted, null);
  assert.equal(needsLook(k, false), true);
  // A pass is never "accepted", even with an old entry.
  assert.equal(proofTasks(TASKS, parseProofMd(MD), SHOTS, { accepted: { t1: { at: "x", result: "pass — 12 tests" } } })[0].accepted, null);
  // The file round-trips; a broken one reads as nothing accepted.
  const text = withAcceptance({}, "t2", accepted.t2);
  assert.deepEqual(parseAccepted(text), accepted);
  assert.deepEqual(parseAccepted(withAcceptance(accepted, "t2", null)), {});
  assert.deepEqual(parseAccepted("{not json"), {});
  assert.deepEqual(parseAccepted("[1]"), {});
});

test("an ask to prove is pending while unhandled and the result is the same", () => {
  const md = parseProofMd(MD);
  const k = proofTasks(TASKS, md, SHOTS)[1];
  const msg = proveRequest(k, 2);
  assert.equal(msg, "prove t2 to T2: partial — the hover card needs a real hover, not screenshotted\n"
    + "Asked from Harbormaster: finish this task's proof to T2 and update its proof.md section.");
  const asks = pendingProofs(`set proof tier to T3\n${msg.split("\n")[0]}\n`);
  assert.equal(asks.get("t2"), resultLine(k));
  let row = proofTasks(TASKS, md, SHOTS, { asks })[1];
  assert.equal(row.asked, true);
  assert.deepEqual(proofRowParts(row, false).at(-1).actions, ["accept", "asked"]);
  // The result changed: the ask is answered, whatever the inbox says.
  row = proofTasks(TASKS, parseProofMd(MD.replace("Result: partial — the hover card needs a real hover, not screenshotted", "Result: pass — hovered for real")), SHOTS, { asks })[1];
  assert.equal(row.asked, false);
  // No tier anywhere: no "to T<n>".
  assert.match(proveRequest({ ...k, tier: null }, null), /^prove t2: partial/);
  assert.equal(pendingProofs("please prove t2 to T2: x\nprove t3: not checked").get("t3"), "not checked");
  assert.equal(pendingProofs("please prove t2 to T2: x").size, 0);
});

test("an accepted unscoped task counts in neither the pass count nor its denominator", () => {
  const tasks = [{ id: "a", name: "", proof: { tier: 1, text: "tests" } }, { id: "b", name: "", proof: null }];
  const md = parseProofMd("## a\nResult: partial — x\n");
  const accepted = { b: { at: "x", result: "not scoped" } };
  const rows = proofTasks(tasks, md, null, { accepted });
  assert.ok(rows[1].accepted);
  const c = proofCounts(rows);
  assert.deepEqual([c.total, c.pass, c.partial, c.accepted, c.unscoped], [1, 0, 1, 0, 0]);
  assert.equal(proofVerdict({ tier: null, md, tasks, danger: null, accepted }).text, "Proof · 0/1 pass · 1 partial");
});

test("a task that isn't done can't be accepted unchecked, and an accepted one keeps its stage colour", () => {
  const k = proofTasks(TASKS, null, null)[1];
  assert.deepEqual(proofRowParts(k, false, false).at(-1).actions, ["ask"]);
  assert.deepEqual(proofRowParts(k, false, true).at(-1).actions, ["accept", "ask"]);
  assert.deepEqual(proofRowParts(k, true, false).at(-1).actions, ["accept", "ask"]);
  // A partial can be accepted whatever its stage.
  assert.deepEqual(proofRowParts(proofTasks(TASKS, parseProofMd(MD), SHOTS)[1], false, false).at(-1).actions, ["accept", "ask"]);
  const acc = proofTasks(TASKS, null, null, { accepted: { t2: { at: "x", result: "not checked" } } })[1];
  assert.ok(acc.accepted);
  assert.equal(proofTone(acc, false, false), null);
  assert.equal(proofTone(acc, false, true), "accepted");
});

test("a task id with a space is written and read back as one word", () => {
  const tasks = [{ id: "T1 api", name: "", proof: { tier: 2, text: "x" } }];
  const md = parseProofMd("## T1\nResult: partial — y\n");
  const k = { ...proofTasks(tasks, null, null)[0] };
  const msg = proveRequest(k, null);
  assert.match(msg, /^prove T1_api to T2: not checked\n/);
  const asks = pendingProofs(msg.split("\n")[0]);
  assert.equal(asks.get("T1_api"), "not checked");
  assert.equal(proofTasks(tasks, md, null, { asks })[0].asked, true);
  const dir = mkdtempSync(join(tmpdir(), "hm-watch-"));
  try {
    mkdirSync(join(dir, "inbox"));
    writeFileSync(join(dir, "inbox", "a.message"), `${msg}\n`);
    const lib = join(here, "../../skills/herdr-app-captain/scripts/lib.sh");
    const r = spawnSync("bash", ["-c", 'source "$1"; answer_messages "$2"', "bash", lib, dir], { encoding: "utf8" });
    assert.equal(r.stdout, "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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
    writeFileSync(join(dir, "inbox", "b-harbormaster-proof.message"), "prove t3: not checked\n");
    writeFileSync(join(dir, "inbox", "c-harbormaster-level.message"), "set autonomy to L2\n");
    writeFileSync(join(dir, "inbox", "d-captain.message"), 'Answer to "Q": Yes\nprove t2 to T2: x\n');
    const lib = join(here, "../../skills/herdr-app-captain/scripts/lib.sh");
    const r = spawnSync("bash", ["-c", 'source "$1"; answer_messages "$2"', "bash", lib, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split("\n").map((p) => p.split("/").pop()), ["d-captain.message"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Only sh runs for real, with the throwaway root; hc and gh are not called.
function withRoot(root) {
  globalThis.__herdrExec = async (cmd, args) => {
    if (cmd !== "sh") return { code: 1, stdout: "", stderr: "not in this test" };
    const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, HERDR_ORCHESTRATION_ROOT: root } });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
}
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
    writeFileSync(join(dir, "plan.md"), "Status: running\nPrefix: fx\nProof tier: T2\n\n### t1 one — merged\n- Proof: T1 — tests\n\n### t2 two — merged\n- Proof: T2 — a screenshot of the hover card\n");
    writeFileSync(join(dir, "proof.md"), MD);
    for (const f of SHOTS) writeFileSync(join(dir, "shared", "proof", f), "x");
    let r = await read(dir);
    let k = proofTasks(r.tasks, r.proof.md, r.proof.files, r.proof)[1];
    assert.equal(k.result, "partial");
    assert.equal(k.accepted, null);

    await acceptProof(r, k);
    const file = readFileSync(join(dir, "proof-accepted.json"), "utf8");
    log("proof-accepted.json after Accept on t2", file);
    const entry = JSON.parse(file).t2;
    assert.equal(entry.result, "partial — the hover card needs a real hover, not screenshotted");
    assert.match(entry.at, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith(".proof-accepted")), []);
    r = await read(dir);
    k = proofTasks(r.tasks, r.proof.md, r.proof.files, r.proof)[1];
    assert.equal(k.accepted.result, entry.result);
    assert.equal(proofVerdict({ tier: r.proof.tier, md: r.proof.md, tasks: r.tasks, danger: null, shotFiles: r.proof.files, ...r.proof }).text,
      "Proof T2 · 1/2 pass · 1 accepted · checks green");

    // The result changes: the acceptance stays in the file but no longer holds.
    writeFileSync(join(dir, "proof.md"), MD.replace("not screenshotted", "still not screenshotted"));
    r = await read(dir);
    assert.equal(proofTasks(r.tasks, r.proof.md, r.proof.files, r.proof)[1].accepted, null);
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
    log("proof-accepted.json after Unaccept on t2", readFileSync(join(dir, "proof-accepted.json"), "utf8"));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "proof-accepted.json"), "utf8")), {});

    // The orchestrator t99 is not running here, so the ask only waits in the inbox.
    r = await read(dir);
    k = proofTasks(r.tasks, r.proof.md, r.proof.files, r.proof)[1];
    assert.deepEqual(await askProof(r, k), { blocked: false, waits: true });
    const [msg] = readdirSync(join(dir, "inbox"));
    assert.match(msg, /^\d{8}T\d{6}Z-\d{3}-harbormaster-proof\.message$/);
    log(`inbox/${msg} after Ask to prove on t2`, readFileSync(join(dir, "inbox", msg), "utf8"));
    r = await read(dir);
    assert.equal(proofTasks(r.tasks, r.proof.md, r.proof.files, r.proof)[1].asked, true);
    // Not an answer: an open question must not read as answered.
    assert.equal(r.unhandled, 0);
    renameSync(join(dir, "inbox", msg), join(dir, "inbox", `${msg}.handled`));
    r = await read(dir);
    assert.equal(proofTasks(r.tasks, r.proof.md, r.proof.files, r.proof)[1].asked, false);
    assert.deepEqual(spawnSync("find", [root, "-name", "pwned"], { encoding: "utf8" }).stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
    delete globalThis.__herdrExec;
  }
});

// A T2 pass whose Files hold no image or video: the row's line is amber "(no screenshot)", so its
// pill, tone, the verdict's counts and the segment must say the same, not "pass".
test("a T2 pass without a screenshot reads 'no screenshot' in the partial colour everywhere", () => {
  const md = parseProofMd(`# Proof\nTier: T2\n\n## t1 one\nTier: T2\nChecked: tests\nResult: pass — 12 tests\nFiles: shared/proof/t1.txt\n`);
  const tasks = [{ id: "t1", name: "one", proof: { tier: 2, text: "a screenshot" } }];
  const [k] = proofTasks(tasks, md, ["t1.txt"], {});
  assert.equal(k.missing, true);
  const pill = resultPill(k, false);
  assert.equal(pill.text, "no screenshot");
  assert.equal(pill.tone, "partial");
  assert.match(pill.tip, /pass — 12 tests \(no screenshot\)\nA pass at T2 needs a screenshot or a recording\. Accept it as it is, or ask the orchestrator to prove it\./);
  // The row's own line and tone agree.
  const parts = proofRowParts(k, false, true);
  assert.equal(parts[0].tone, "partial");
  assert.match(parts[0].text, /no screenshot/);
  assert.deepEqual(parts.find((x) => x.kind === "actions").actions, ["accept", "ask"]);
  assert.equal(proofTone(k, false), "partial");
  // The verdict counts it as partial, not pass.
  const c = proofCounts([k]);
  assert.deepEqual([c.pass, c.partial, c.missing, c.unchecked], [0, 1, 1, 0]);
  assert.equal(proofVerdict({ tier: { tier: 2 }, md, tasks, shotFiles: ["t1.txt"] }).text, "Proof T2 · 0/1 pass · 1 partial (1 task without a screenshot)");
});

test("an accepted or asked no-screenshot row's pill hover says so, not to accept or ask", () => {
  const base = { scoped: true, result: "pass", why: "ok", missing: true, tier: 2, files: [] };
  assert.match(resultPill({ ...base, accepted: { at: "x" } }, false).tip, /You accepted it without a screenshot\.$/);
  assert.match(resultPill({ ...base, asked: true }, false).tip, /Asked its orchestrator to prove it\.$/);
  for (const k of [{ ...base, accepted: { at: "x" } }, { ...base, asked: true }]) {
    const p = resultPill(k, false);
    assert.equal(p.text, "no screenshot");
    assert.doesNotMatch(p.tip, /Accept it as it is/);
  }
});

test("a pass with a screenshot, a T1 pass, a fail and a partial keep their own pill", () => {
  const row = (tier, result, files) => proofTasks([{ id: "t1", name: "one", proof: { tier, text: "x" } }],
    parseProofMd(`# Proof\n\n## t1 one\nTier: T${tier}\nResult: ${result}\nFiles: ${files.map((f) => `shared/proof/${f}`).join(", ")}\n`), files, {})[0];
  assert.deepEqual(resultPill(row(2, "pass", ["t1.png"]), false), { text: "pass", tone: "pass", tip: "pass" });
  assert.equal(resultPill(row(1, "pass", ["t1.txt"]), false).text, "pass");
  assert.equal(resultPill(row(2, "fail — broke", ["t1.png"]), false).tone, "fail");
  assert.equal(resultPill(row(2, "partial — half", ["t1.png"]), false).tone, "partial");
  assert.equal(resultPill({ scoped: true, result: null, files: [] }, true).tone, "amber");
  assert.equal(resultPill({ scoped: true, result: null, files: [] }, false).tone, "dim");
  assert.equal(resultPill({ scoped: false, result: null, files: [] }, false).text, "not scoped");
  assert.equal(resultPill({ pending: true, result: "pending", why: "waiting", files: [] }, false).text, "pending");
});
