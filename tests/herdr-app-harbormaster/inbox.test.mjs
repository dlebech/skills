// The inbox module (inbox.js), one table over every kind: the send writes the expected file and
// text, the unread prefix makes it read asked, and a renamed (.handled) message stays asked only
// while its signature has not moved; prune drops what no longer holds. Plus the three outcomes,
// the failure after the inbox, the NOT_ANSWERS string, and that lib.sh's copy of the pattern
// reads the same fixture inbox the same way.
// Run: node --import ./loader.mjs --test inbox.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resetShared, setShared } from "herdr";
import { KINDS, askedLevel, NOT_ANSWERS, PREFIXES, send, asked, markAsked, unmarkAsked, pruneAsked, askedStore } from "../../herdr-app/mods/harbormaster/inbox.js";
import { withRoot } from "./root.mjs";
import { ASKED_KEEP_MS } from "../../herdr-app/mods/harbormaster/comments.js";

const here = dirname(fileURLToPath(import.meta.url));
const DAY = 24 * 3600 * 1000;
let root;
beforeEach(() => { resetShared(); root = mkdtempSync(join(tmpdir(), "hm-inbox-")); withRoot(root); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); delete globalThis.__herdrExec; delete globalThis.__herdrTerminals; delete globalThis.__herdrAgents; });

const runIn = (o = {}) => ({
  key: ":" + join(root, "skills", "feat-x"), dir: join(root, "skills", "feat-x"), terminal: "t99", localTerminal: "t99", machine: undefined,
  statusLine: "running", progress: "t1 implementing", tasks: [{ id: "t1", state: "implement" }], autonomy: "L1", phase: "running",
  proof: { tier: { tier: 1 }, asks: new Map() }, pending: { autonomy: null, tier: null }, commentsAsked: [], blockingAsked: false, changesAsked: false, ...o,
});
const PR = (o = {}) => ({ url: "https://github.com/o/r/pull/7", number: 7, state: "OPEN", review: "APPROVED", comments: { count: 1, threads: 1, notes: 0, bots: {}, items: [{ kind: "thread", thread: "T1", who: "ann", where: "a.js:3", text: "fix this" }] }, ...o });
const ROW = (o = {}) => ({ id: "C2", name: "Drag a card", tier: 2, result: "partial", why: "no screenshot", missing: false, ...o });

// Per kind: what is sent, the key and the item its asked state is read from, how the unread message
// shows in the run, and a change that moves the signature.
const TABLE = [
  { kind: "level", payload: () => ({ kind: "tier", level: 2 }), source: "harbormaster-level", first: /^set proof tier to T2$/,
    key: "tier", item: (r) => ({ level: 2, current: r.proof.tier.tier }), unread: (r) => ({ ...r, pending: { autonomy: null, tier: 2 } }),
    moved: (r) => ({ run: { ...r, proof: { ...r.proof, tier: { tier: 2 } } }, item: { level: 2, current: 2 } }) },
  { kind: "proof", payload: () => ({ row: ROW() }), source: "harbormaster-proof", first: /^prove C2 to T2: partial — no screenshot$/,
    key: "C2", item: () => ROW(), unread: (r) => ({ ...r, proof: { ...r.proof, asks: new Map([["C2", "partial — no screenshot"]]) } }),
    moved: (r) => ({ run: r, item: ROW({ result: "pass", why: "shot" }) }) },
  { kind: "blocking", payload: () => ({ quiet: "34m", step: "CI on #42 · 50m" }), source: "harbormaster-blocking", first: /^what is blocking\? Harbormaster sees this run quiet for 34m/,
    key: "", item: (r) => r, unread: (r) => ({ ...r, blockingAsked: true }),
    moved: (r) => ({ run: { ...r, progress: "fixing CI" }, item: { ...r, progress: "fixing CI" } }) },
  { kind: "ci", payload: () => ({ pr: 42, check: "unit", url: "https://ci/1" }), source: "harbormaster-blocking", first: /^what is blocking\? Harbormaster sees CI red on #42 \(failing: unit\): https:\/\/ci\/1\.$/,
    key: "", item: (r) => r, unread: (r) => ({ ...r, blockingAsked: true }),
    moved: (r) => ({ run: { ...r, statusLine: "waiting for user: x" }, item: { ...r, statusLine: "waiting for user: x" } }) },
  { kind: "comments", payload: () => ({ pr: PR(), mode: "ask" }), source: "harbormaster-comments", first: /^address comments on https:\/\/github.com\/o\/r\/pull\/7: ask$/,
    key: PR().url, item: () => PR(), unread: (r) => ({ ...r, commentsAsked: [PR().url] }),
    moved: (r) => ({ run: r, item: PR({ comments: { ...PR().comments, items: [{ ...PR().comments.items[0], kind: "answered" }], count: 0 } }) }) },
  { kind: "comments-all", payload: () => ({ prs: [PR(), PR({ url: "https://github.com/o/r/pull/8", number: 8 })], mode: "handle" }), source: "harbormaster-comments", first: /^address comments on https:\/\/github.com\/o\/r\/pull\/7 https:\/\/github.com\/o\/r\/pull\/8: handle$/,
    key: PR().url, item: () => PR(), unread: (r) => ({ ...r, commentsAsked: [PR().url] }),
    moved: (r) => ({ run: r, item: PR({ comments: { ...PR().comments, count: 2 } }) }) },
  { kind: "changes", payload: () => ({ text: "make the card wider" }), source: "harbormaster-changes", first: /^changes asked from Harbormaster: make the card wider$/,
    key: "", item: () => null, unread: (r) => ({ ...r, changesAsked: true }), moved: null },
  { kind: "answer", payload: () => ({ title: "Which way?", answer: "A", free: "because" }), source: "harbormaster", first: /^Answer to "Which way\?": A$/,
    key: "q-1", item: () => ({ since: 100 }), unread: null, moved: (r) => ({ run: r, item: { since: 200 } }) },
];

for (const t of TABLE) {
  test(`${t.kind}: sent to the inbox, asked while unread, asked until its signature moves, cleared`, async () => {
    const run = runIn();
    // The orchestrator is not running here, so the message only waits in the inbox.
    const out = await send(run, t.kind, t.payload(), { asks: [{ key: t.key, item: t.item(run) }] });
    assert.deepEqual(out, { outcome: "waits" });
    const files = readdirSync(join(run.dir, "inbox"));
    assert.equal(files.length, 1);
    assert.match(files[0], new RegExp(`^\\d{8}T\\d{6}Z-\\d{3}-${t.source}\\.message$`));
    const text = readFileSync(join(run.dir, "inbox", files[0]), "utf8");
    assert.match(text.split("\n")[0], t.first);
    // The unread prefix is the kind's; an answer has none.
    assert.equal(KINDS[t.kind].prefix === null, t.kind === "answer");
    if (KINDS[t.kind].prefix) assert.ok(new RegExp(`^(${KINDS[t.kind].prefix})`).test(text.split("\n")[0]), "its first line matches its prefix");
    // Unread: asked from the run's own read, with nothing stored.
    if (t.unread) {
      resetShared();
      assert.equal(asked(run, t.kind, t.key, t.item(run)), false);
      assert.equal(asked(t.unread(run), t.kind, t.key, t.item(run)), true);
    }
    // Handled (renamed), nothing unread: asked by the stored signature while it has not moved.
    renameSync(join(run.dir, "inbox", files[0]), join(run.dir, "inbox", `${files[0]}.handled`));
    if (!t.moved) { assert.equal(asked(run, t.kind, t.key, t.item(run)), false, "no signature: asked only while unread"); return; }
    markAsked(run, t.kind, t.key, t.item(run));
    assert.equal(asked(run, t.kind, t.key, t.item(run)), true);
    const m = t.moved(run);
    assert.equal(asked(m.run, t.kind, t.key, m.item), false);
    // An old mark is no mark.
    assert.equal(asked(run, t.kind, t.key, t.item(run), { now: Date.now() + ASKED_KEEP_MS + 1000 }), false);
  });
}

test("the three outcomes: sent, blocked on a dialog, waits for a gone orchestrator", async () => {
  const run = runIn();
  const hcCalls = [];
  const realExec = globalThis.__herdrExec;
  const live = (status) => {
    globalThis.__herdrTerminals = [{ address: "t99", state: "live", labels: { role: "orchestrator" } }];
    globalThis.__herdrAgents = [{ address: "t99", status }];
    globalThis.__herdrExec = async (cmd, args) => {
      if (cmd === "sh") return realExec(cmd, args);
      hcCalls.push(args[0]);
      return args[0] === "get" ? { code: 0, stdout: JSON.stringify({ state: "live" }), stderr: "" } : { code: 0, stdout: "{}", stderr: "" };
    };
  };
  live("idle");
  assert.deepEqual(await send(run, "blocking", { quiet: "1m" }), { outcome: "sent" });
  assert.deepEqual(hcCalls, ["get", "run"]);
  live("blocked");
  hcCalls.length = 0;
  assert.deepEqual(await send(run, "blocking", { quiet: "1m" }), { outcome: "blocked" });
  assert.deepEqual(hcCalls, ["get"], "a blocked orchestrator is not sent to");
  withRoot(root);
  delete globalThis.__herdrTerminals; delete globalThis.__herdrAgents;
  assert.deepEqual(await send(run, "blocking", { quiet: "1m" }), { outcome: "waits" });
  assert.equal(readdirSync(join(run.dir, "inbox")).length, 3);
});

test("a failed wake leaves the ask marked (inInbox); a failed write unmarks it; empty changes throw", async () => {
  const run = runIn();
  globalThis.__herdrTerminals = [{ address: "t99", state: "live", labels: { role: "orchestrator" } }];
  globalThis.__herdrAgents = [{ address: "t99", status: "idle" }];
  const real = globalThis.__herdrExec;
  globalThis.__herdrExec = async (cmd, args, o) => (cmd === "hc" ? { code: 3, stdout: "", stderr: 'no terminal "t99"' } : real(cmd, args, o));
  await assert.rejects(send(run, "blocking", { quiet: "1m" }, { asks: [{ key: "" }] }),
    (e) => e.inInbox === true && e.message === "the message is in its inbox, but its orchestrator could not be told: no terminal \"t99\"");
  assert.equal(Object.keys(askedStore()).length, 1, "it reached the inbox, so it stays asked");
  globalThis.__herdrExec = async () => ({ code: 1, stdout: "", stderr: "disk full" });
  resetShared();
  await assert.rejects(send(run, "blocking", { quiet: "1m" }, { asks: [{ key: "" }] }), (e) => !e.inInbox && e.message === "disk full");
  assert.equal(Object.keys(askedStore()).length, 0, "it did not reach the inbox, so it is unmarked");
  await assert.rejects(send(run, "changes", { text: "  " }), /^Error: say what to change$/);
  await assert.rejects(send(run, "nope"), /unknown inbox message kind/);
});

test("the store is shared state keyed by run, kind and item; blocking and ci share one ask", () => {
  const run = runIn();
  markAsked(run, "ci", "", run);
  assert.equal(asked(run, "blocking", "", run), true);
  assert.deepEqual(Object.keys(askedStore()), [`${run.key}\u001fblocking\u001f`]);
  unmarkAsked(run, "blocking", "");
  assert.equal(asked(run, "ci", "", run), false);
});

test("prune drops a moved signature, a gone or closed run and a week-old mark; keeps the rest", () => {
  const now = Date.now();
  const a = runIn(), b = runIn({ key: ":/r/b", dir: "/r/b" }), c = runIn({ key: ":/r/c", dir: "/r/c" });
  markAsked(a, "blocking", "", a, now);
  markAsked(b, "blocking", "", b, now);
  markAsked(c, "blocking", "", c, now);
  markAsked(a, "level", "tier", { level: 2, current: 1 }, now);
  markAsked(a, "comments", PR().url, PR(), now);
  markAsked(a, "answer", "q-1", { since: 1 }, now);
  const before = Object.keys(askedStore()).length;
  assert.equal(before, 6);
  // Nothing moved: nothing goes (and nothing is written).
  const same = askedStore();
  pruneAsked([a, b, c], { now, lookup: (r, fam) => (fam === "comments" ? PR() : undefined) });
  assert.equal(askedStore(), same);
  // a's progress moved (its blocking ask goes), b is gone, c is closed, the PR merged; the level is
  // still not applied and the answer's item is unknown to the lookup, so both stay.
  const moved = { ...a, progress: "fixing" };
  pruneAsked([moved, { ...c, away: { how: "closed" } }], { now, lookup: (r, fam) => (fam === "comments" ? PR({ state: "MERGED" }) : undefined) });
  assert.deepEqual(Object.keys(askedStore()).sort(), [`${a.key}\u001fanswer\u001fq-1`, `${a.key}\u001flevel\u001ftier`].sort());
  // A level mark is 15 s old at most.
  markAsked(a, "level", "autonomy", { level: "L2", current: "L1" }, now - 20000);
  pruneAsked([moved], { now });
  assert.ok(!Object.keys(askedStore()).some((k) => k.endsWith("autonomy")));
  // A week later everything left goes.
  pruneAsked([moved], { now: now + 7 * DAY + 1000 });
  assert.deepEqual(askedStore(), {});
});

test("NOT_ANSWERS is built from the kind table and equals the string data.js had", () => {
  assert.equal(NOT_ANSWERS, "^(set (autonomy|proof tier) to |prove [^ ]+( to T[0-3])?: |what is blocking\\?|address comments on |changes asked from Harbormaster: )");
  assert.equal(PREFIXES.length, 5, "blocking and ci, comments and comments-all share a prefix");
});

// ---- lib.sh contract ----
// skills/herdr-app-captain/scripts/lib.sh keeps its own copy of the pattern (answer_messages).
// One fixture inbox, read by lib.sh's answer_messages and by the module's prefixes (as data.js's
// run read does, with grep -E over each message's first line): the same messages must be answers.
test("lib.sh's answer_messages and the module's prefixes agree on a fixture inbox", async () => {
  const run = runIn();
  const sendTo = async (kind, payload) => { await send(run, kind, payload); await new Promise((r) => setTimeout(r, 3)); };
  await sendTo("level", { kind: "autonomy", level: "L2" });
  await sendTo("level", { kind: "tier", level: 3 });
  await sendTo("proof", { row: ROW() });
  await sendTo("proof", { row: ROW({ tier: null, id: "C9" }) });
  await sendTo("blocking", { quiet: "5m" });
  await sendTo("ci", { pr: 1 });
  await sendTo("comments", { pr: PR(), mode: "handle" });
  await sendTo("comments-all", { prs: [PR(), PR({ url: "u2", number: 2 })], mode: "ask" });
  await sendTo("changes", { text: "more" });
  await sendTo("answer", { title: "Q", answer: "yes" });
  await sendTo("answer", { title: "Q", answer: "no", free: "set autonomy to L2" });
  writeFileSync(join(run.dir, "inbox", "20261118T000000Z-000-person.message"), "just some free text\nprove C1: not an ask on line two\n");
  writeFileSync(join(run.dir, "inbox", "20261118T000001Z-000-person.message"), "set autonomy to L9 is still shaped like one\n");
  const lib = join(here, "../../skills/herdr-app-captain/scripts/lib.sh");
  const shell = spawnSync("bash", ["-c", `. "${lib}"; answer_messages "$1"`, "bash", run.dir], { encoding: "utf8" });
  assert.equal(shell.status, 0, shell.stderr);
  const fromLib = shell.stdout.split("\n").filter(Boolean).sort();
  const files = readdirSync(join(run.dir, "inbox")).filter((f) => f.endsWith(".message")).map((f) => join(run.dir, "inbox", f));
  const answers = files.filter((f) => spawnSync("sh", ["-c", `head -n 1 "$1" | grep -qE "$2"`, "sh", f, NOT_ANSWERS]).status !== 0).sort();
  assert.deepEqual(fromLib, answers);
  assert.ok(fromLib.length >= 3 && fromLib.length < files.length, "the fixture has both answers and asks");
  // The module's JS view of the same rule: a first line is an ask when a kind's prefix starts it.
  const isAsk = (f) => PREFIXES.some((p) => new RegExp(`^(${p})`).test(readFileSync(f, "utf8").split("\n")[0]));
  assert.deepEqual(files.filter((f) => !isAsk(f)).sort(), fromLib);
});

test("level and proof click marks last 15 s, the others a week; an unread level request is asked at once", () => {
  const run = runIn(), now = Date.now();
  markAsked(run, "level", "tier", { level: 2, current: 1 }, now);
  markAsked(run, "proof", "C2", ROW(), now);
  markAsked(run, "blocking", "", run, now);
  const later = { now: now + 16000 };
  assert.equal(asked(run, "level", "tier", { level: 2, current: 1 }, { now: now + 5000 }), true);
  assert.equal(asked(run, "level", "tier", { level: 2, current: 1 }, later), false);
  assert.equal(asked(run, "proof", "C2", ROW(), { now: now + 5000 }), true);
  assert.equal(asked(run, "proof", "C2", ROW(), later), false);
  assert.equal(asked(run, "blocking", "", run, later), true);
  // The tag shows the level asked for: the unread request, else a fresh mark the run has not caught up with.
  assert.equal(askedLevel(run, "tier", 1, now + 5000), 2);
  assert.equal(askedLevel(run, "tier", 2, now + 5000), null);
  assert.equal(askedLevel(run, "tier", 1, now + 16000), null);
  assert.equal(askedLevel({ ...run, pending: { autonomy: null, tier: 3 } }, "tier", 1, now + 16000), 3);
  // Another level of the same kind replaces the mark (one key per kind).
  markAsked(run, "level", "tier", { level: 3, current: 1 }, now);
  assert.equal(askedLevel(run, "tier", 1, now), 3);
});

test("comments while the run works: asked holds until a new counted comment; prune honours busy", () => {
  const run = runIn(), now = Date.now(), url = PR().url;
  const two = PR({ comments: { ...PR().comments, count: 2, items: [...PR().comments.items, { kind: "thread", thread: "T2", who: "bo", where: "b.js:1", text: "and this" }] } });
  const answered = PR({ comments: { ...PR().comments, count: 0, items: [{ ...PR().comments.items[0], kind: "answered" }] } });
  markAsked(run, "comments", url, PR(), now);
  // Not working: any move of the comments clears it.
  assert.equal(asked(run, "comments", url, answered), false);
  // Working: the orchestrator answers T1 (the signature moves) and nothing new appeared: still asked.
  assert.equal(asked(run, "comments", url, answered, { working: true }), true);
  // A reviewer adds T2 meanwhile: not asked.
  assert.equal(asked(run, "comments", url, two, { working: true }), false);
  // Prune: busy keeps the moved ask, unless a new counted comment is there; not busy drops it.
  const keepsWith = (pr, busy) => { resetShared(); markAsked(run, "comments", url, PR(), now); pruneAsked([run], { now, lookup: () => pr, busy }); return Object.keys(askedStore()).length === 1; };
  assert.equal(keepsWith(answered, new Set([url])), true);
  assert.equal(keepsWith(two, new Set([url])), false);
  assert.equal(keepsWith(answered, new Set()), false);
});
