// The GitHub poll as Herdr runs it: Herdr's shell has no setTimeout or clearTimeout (calling either
// throws), and the wait for the known repositories used both, so every poll failed and "Next for
// you" always said "can't reach GitHub" (proof t2). Also: no mod calls those timers at all.
// Run: node --import ./loader.mjs --test poller-timers.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as nodeTimeout } from "node:timers/promises";
import * as reviews from "../../herdr-app/mods/harbormaster/reviews.js";
const { poller } = reviews, tune = reviews.tune ?? {};

const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const herdrTimers = () => {
  globalThis.setTimeout = () => { throw new Error("`setTimeout` is not available in the shell: use cx.timer.after"); };
  globalThis.clearTimeout = () => { throw new Error("`clearTimeout` is not available in the shell: cancel the handle returned by cx.timer.after"); };
};
// A short wait, so a sleep left running after knownRepos wins doesn't hold the file open.
const savedWait = tune.reposWait;
beforeEach(() => { tune.reposWait = 50; });
afterEach(() => { Object.assign(globalThis, real); delete globalThis.__herdrExec; tune.reposWait = savedWait; });

const prs = JSON.stringify([{ number: 4, title: "Fix it", url: "https://github.com/acme/api/pull/4", author: { login: "cy" }, updatedAt: "2026-11-01T00:00:00Z", repository: { nameWithOwner: "acme/api" } }]);

// gh answers; `sleep` waits as the program would; anything else (finding the repositories) as `other` says.
const withExec = (other) => {
  globalThis.__herdrExec = async (cmd, args) => {
    if (cmd === "gh") return { code: 0, stdout: prs, stderr: "" };
    if (cmd === "sleep") { await nodeTimeout(Number(args[0]) * 1000); return { code: 0, stdout: "", stderr: "" }; }
    return other();
  };
};
const parse = (t) => JSON.parse(t);

test("without setTimeout, as in Herdr, a good gh poll fills the list", async () => {
  withExec(async () => ({ code: 0, stdout: "", stderr: "" }));
  herdrTimers();
  const p = poller(["search", "prs"], parse);
  await p.refresh(true);
  Object.assign(globalThis, real);
  assert.equal(p.error(), null);
  assert.equal(p.get().list.length, 1);
});

test("without setTimeout, slow repositories don't hold the list back past the wait", async () => {
  tune.reposWait = 200;
  withExec(() => new Promise(() => {})); // never answers
  herdrTimers();
  const p = poller(["search", "prs"], parse);
  const t0 = Date.now();
  await p.refresh(true);
  Object.assign(globalThis, real);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(p.error(), null);
  assert.equal(p.get().list.length, 1);
  assert.deepEqual(p.get().repos, []);
});

// The lines of `code` calling one of the timers, as "<line>: <text>". Line by line, skipping only
// whole-line comments: a block-comment strip would read a shell glob like "$d"/*.message as a
// comment's start and hide the code after it. Not a method (cx.timer.after) or a longer name.
const timerCalls = (code) => code.split("\n").flatMap((l, i) =>
  !/^\s*(\/\/|\*|\/\*)/.test(l) && /(?<![\w$.])(set|clear)(Timeout|Interval)\s*\(/.test(l.replace(/(^|[^:"'`])\/\/.*$/, "$1")) ? [`${i + 1}: ${l.trim()}`] : []);

test("the timer scan finds a call after a shell glob, and skips comments and methods", () => {
  const sample = ['const a = sh(\'ls "$d"/inbox/*.message\');', "// setTimeout(f, 1) in a comment", " * clearTimeout(t) in a block comment", "x.setTimeout(f);", "const t = setTimeout(f, 5);", "setInterval(f, 1); // tick"].join("\n");
  assert.deepEqual(timerCalls(sample), ["5: const t = setTimeout(f, 5);", "6: setInterval(f, 1); // tick"]);
});

// Herdr's runtime would throw on them: cx.timer (or a sleep process) instead.
test("no mod calls setTimeout, clearTimeout, setInterval or clearInterval", () => {
  const mods = fileURLToPath(new URL("../../herdr-app/mods", import.meta.url));
  const files = readdirSync(mods, { recursive: true }).filter((f) => String(f).endsWith(".js"));
  assert.ok(files.length > 10);
  const hits = files.flatMap((f) => timerCalls(readFileSync(join(mods, f), "utf8")).map((h) => `${f}:${h}`));
  assert.deepEqual(hits, []);
});
