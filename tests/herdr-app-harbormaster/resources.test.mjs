// Unit tests for Harbormaster's CPU and memory sampler (herdr-app/mods/harbormaster/resources.js):
// the Linux awk against a fake /proc (with gawk, mawk and busybox awk where installed), the macOS
// awk against captured-style ps output, the live snapshot and CPU %, the per-run totals, and the
// guarded write of .resources.json. Run: node --import ./loader.mjs --test resources.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LINUX_AWK, MAC_AWK, WRITE, chunks, parseSample, ingest, liveUsage, treeUsage, otherProcesses, hotText, programOf, mergeRun } from "../../herdr-app/mods/harbormaster/resources.js";

// A fake /proc: herdr-core (100) holds terminal t1 (200, claude), which runs bash (201) and
// vitest under node (202); 203 has a ") " in its name; outside every terminal a browser (300)
// and a small idle process (301) that is left out. CPU in ticks of 1/100 s, RSS in 4 kB pages.
function fakeProc(dir, { uptime, ticks, fresh = false }) {
  const stat = (pid, comm, ppid, ut, st, cut, cst, start, pages) =>
    `${pid} (${comm}) S ${ppid} 1 1 0 -1 0 0 0 0 0 ${ut} ${st} ${cut} ${cst} 20 0 1 0 ${start} 1000 ${pages} 0`;
  const procs = [
    [100, "herdr-core", 1, 50, 50, 0, 0, 10, 1000, ["herdr-core", "hold"], ""],
    // A variable with a newline comes before HC_TERMINAL_ID, as the environment can hold one.
    [200, "claude", 100, ticks, 100, 500, 0, 20, 100000, ["claude", "--model", "sonnet"], "A=1\0MULTI=x\ny\0HC_TERMINAL_ID=t1\0"],
    [201, "bash", 200, 1, 1, 0, 0, 30, 1000, ["/bin/bash", "-c", "npx vitest"], "HC_TERMINAL_ID=t1\0"],
    [202, "node", 201, ticks * 2, 0, 0, 0, 40, 200000, ["node", "/x/node_modules/.bin/vitest", "run"], ""],
    [203, "odd) R name", 200, 1, 0, 0, 0, 50, 10, ["odd"], ""],
    [300, "MainThread", 1, 90000, 1000, 0, 0, 60, 300000, ["/usr/lib/firefox/firefox"], ""],
    [301, "sleep", 1, 0, 0, 0, 0, 70, 10, ["sleep", "100"], ""],
    // Started at 1002 s after boot, with 3 s of CPU since.
    ...(fresh ? [[204, "node", 200, 300, 0, 0, 0, 100200, 1000, ["node", "x.js"], ""]] : []),
  ];
  mkdirSync(join(dir, "self"), { recursive: true });
  writeFileSync(join(dir, "self", "stat"), "1 (x) S 0");
  writeFileSync(join(dir, "uptime"), `${uptime} 1.00\n`);
  for (const [pid, comm, ppid, ut, st, cut, cst, start, pages, argv, env] of procs) {
    mkdirSync(join(dir, String(pid)), { recursive: true });
    writeFileSync(join(dir, String(pid), "stat"), stat(pid, comm, ppid, ut, st, cut, cst, start, pages) + "\n");
    writeFileSync(join(dir, String(pid), "cmdline"), argv.join("\0") + "\0");
    writeFileSync(join(dir, String(pid), "environ"), env);
  }
}

const awks = ["awk", "mawk", "busybox awk"].filter((a) => spawnSync("sh", ["-c", `echo | ${a} '{}'`]).status === 0);

function sampleWith(awk, dir) {
  const files = ["100", "200", "201", "202", "203", "204", "300", "301", "999"].map((p) => join(dir, p, "stat")); // 999 exited
  const sh = `d=$1 prog=$2; shift 2; LC_ALL=C ${awk} -v hz=100 -v pg=4096 -v proc="$d" "$prog" "$@"`;
  return execFileSync("sh", ["-c", sh, "sh", dir, LINUX_AWK, ...files], { encoding: "utf8" });
}

for (const awk of awks) {
  test(`Linux sampler reads a fake /proc (${awk})`, () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-proc-"));
    try {
      fakeProc(dir, { uptime: 1000, ticks: 1000 });
      const s = parseSample(sampleWith(awk, dir));
      assert.equal(s.os, "linux");
      assert.equal(s.at, 1000);
      const by = Object.fromEntries(s.procs.map((p) => [p.pid, p]));
      assert.deepEqual(Object.keys(by).sort(), ["200", "201", "202", "203", "300"]);
      assert.equal(by[200].tid, "t1");
      assert.equal(by[200].root, true);
      assert.equal(by[200].ownMs, 11000); // (1000 + 100) ticks
      assert.equal(by[200].kidMs, 5000);
      assert.equal(by[200].rssKb, 400000);
      assert.equal(by[202].tid, "t1");
      assert.equal(by[202].root, false);
      assert.equal(by[203].tid, "t1"); // a name with ") " in it does not shift the fields
      assert.equal(by[300].tid, null);
      assert.equal(by[300].name, "firefox");
      if (awk !== "busybox awk") assert.match(by[202].args, /vitest run/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("the live snapshot: per-terminal programs, CPU % from two polls, others", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-proc-"));
  try {
    fakeProc(dir, { uptime: 1000, ticks: 1000 });
    ingest("box", sampleWith("awk", dir));
    // First poll: no CPU % yet, memory already.
    assert.equal(liveUsage("box/t1").cpu, 0);
    assert.equal(liveUsage("box/t1").rssKb, (100000 + 1000 + 200000 + 10) * 4);
    fakeProc(dir, { uptime: 1005, ticks: 1250 }); // claude +250 ticks, vitest +500 in 5 s
    ingest("box", sampleWith("awk", dir));
    const u = liveUsage("box/t1");
    assert.equal(Math.round(u.own.cpu), 50);
    assert.equal(Math.round(u.cpu), 150);
    assert.equal(u.programs[0].name, "test runner");
    assert.equal(Math.round(u.programs[0].cpu), 100);
    assert.equal(u.programs[0].count, 2); // "bash -c npx vitest" is the test run too
    assert.equal(hotText(u), "150% · 1.1G");
    assert.equal(otherProcesses("box")[0].program, "browser");
    assert.equal(otherProcesses("box").some((p) => p.pid === "301"), false);
    // A reload a second later (after an action) is not a measurement: skipped.
    fakeProc(dir, { uptime: 1006, ticks: 1300 });
    assert.equal(ingest("box", sampleWith("awk", dir)), null);
    assert.equal(Math.round(liveUsage("box/t1").own.cpu), 50);
    const tree = treeUsage(["box/t1"]);
    assert.equal(Math.round(tree.cpu), 150);
    assert.equal(tree.own.rssKb, 400000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a process started since the poll before gets all its CPU as its share", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-proc-"));
  try {
    fakeProc(dir, { uptime: 1000, ticks: 1000 });
    ingest("box2", sampleWith("awk", dir));
    fakeProc(dir, { uptime: 1005, ticks: 1000, fresh: true });
    ingest("box2", sampleWith("awk", dir));
    const node = liveUsage("box2/t1").programs.find((g) => g.name === "node");
    assert.equal(Math.round(node.cpu), 60);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("macOS sampler reads ps output", () => {
  const ps = [
    "  100     1   9000   0:01.50   0.1 Mon Nov 16 08:00:00 2026 /Users/x/.local/bin/herdr-core",
    "  200   100 400000  12:03.25  45.0 Mon Nov 16 09:43:12 2026 /usr/local/bin/claude",
    "  202   200 800000 1:02:03.00  99.5 Mon Nov 16 09:50:01 2026 /usr/local/bin/node",
    "  300     1 1200000 1-00:00:01.00  85.0 Sun Nov 15 09:00:00 2026 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "ENV",
    "  200 claude HOME=/Users/x HC_TERMINAL_ID=t9 TERM=xterm",
  ].join("\n");
  const out = execFileSync("awk", ["-v", "now=1700000000", MAC_AWK], { input: ps, encoding: "utf8" });
  const s = parseSample(out);
  assert.equal(s.os, "darwin");
  const by = Object.fromEntries(s.procs.map((p) => [p.pid, p]));
  assert.equal(by[200].tid, "t9");
  assert.equal(by[200].ownMs, 723250);
  assert.equal(by[202].ownMs, 3723000);
  assert.equal(by[202].pcpu, 99.5);
  assert.equal(by[300].ownMs, 86401000);
  assert.equal(by[300].name, "Google_Chrome");
  assert.equal(by[202].start, "Mon_Nov_16_09:50:01_2026");
  assert.equal(by[202].ppid, "200");
  assert.equal(programOf(by[300].name), "browser");
});

test("programOf names commands from the table, else by program", () => {
  assert.equal(programOf("node", "/x/.bin/vitest run"), "test runner");
  assert.equal(programOf("php", "vendor/bin/phpunit"), "test runner");
  assert.equal(programOf("node", "--import ./loader.mjs --test a.test.mjs"), "test runner");
  assert.equal(programOf("bash", "tests/herdr-app-captain/runs-live.sh"), "test runner");
  assert.equal(programOf("node", "--check a.js"), "lint");
  assert.equal(programOf("composer", "install"), "install");
  assert.equal(programOf("cargo", "build --release"), "build");
  assert.equal(programOf("cargo", "test"), "test runner");
  assert.equal(programOf("node", "node_modules/.bin/eslint ."), "lint");
  assert.equal(programOf("bash", "-c ls"), "shell");
  assert.equal(programOf("php", "artisan serve"), "php");
  assert.equal(programOf("node", "/x/.bin/firefox-devtools-mcp --tool-preset developer"), "mcp server");
  assert.equal(programOf("firefox", "-marionette"), "browser");
});

// A process in a usage's pids, as ingest() gives them.
const proc = (key, program, ownMs, kidMs, parent = null, root = false) => ({ key, program, ownMs, kidMs, parent, root });
const usage = (rssKb, pids, programs = []) => ({ rssKb, pids, programs, totalMs: 0, ownMs: 0 });
const agentRoot = (ownMs, kidMs) => proc("10:1", "agent", ownMs, kidMs, null, true);

test("run totals: a command's exited workers count for it, not as short-lived; samples count once", () => {
  const terms = [{ address: "t1", name: "orc", parent: null }, { address: "t2", name: "impl-x-t1", parent: "orc" }];
  // `npm test` (own 1 s) has run 59 s of CPU in workers it already reaped.
  const one = {
    t1: usage(1024 * 100, [proc("1:1", "agent", 10000, 0, null, true)]),
    t2: usage(1024 * 300, [agentRoot(10000, 0), proc("20:5", "test runner", 1000, 59000, "10:1")], [{ name: "test runner", rssKb: 1024 * 200 }]),
  };
  let st = mergeRun(null, terms, one, 1_000_000, "linux");
  let ag = st.agents["impl-x-t1"];
  assert.equal(ag.programs["test runner"].cpu_s, 60);
  assert.equal(ag.programs["short-lived"], undefined);
  assert.equal(ag.own_cpu_s, 10);
  assert.equal(ag.cpu_s, 70);
  assert.equal(st.cpu_s, 80);
  assert.equal(ag.parent, "orc");
  assert.equal(st.peak_rss_mb, 400);
  // The same sample again (another window's poll at the same moment) adds nothing.
  assert.equal(mergeRun(st, terms, one, 1_000_000, "linux").cpu_s, 80);
  // npm test ends (61 s in all) and the agent reaps it: its children counter grows by 61 s, of
  // which 60 were counted for the test runner; the 1 s no poll saw is short-lived.
  st = mergeRun(st, terms, { t1: one.t1, t2: usage(1024 * 100, [agentRoot(10000, 61000)]) }, 1_010_000, "linux");
  ag = st.agents["impl-x-t1"];
  assert.equal(ag.programs["test runner"].cpu_s, 60);
  assert.equal(ag.programs["short-lived"].cpu_s, 1);
  assert.equal(ag.cpu_s, 71);
  assert.equal(ag.peak_rss_mb, 300);
  assert.equal(ag.avg_rss_mb, Math.round(((300 * 5 + 100 * 10) / 15) * 10) / 10);
  assert.equal(st.peak_rss_mb, 400);
  // A gap longer than 15 s (the app was closed) counts as 15 s. t2 has ended: its credits stay,
  // its process bookkeeping is dropped.
  st = mergeRun(st, [terms[0]], { t1: one.t1 }, 2_000_000, "linux");
  assert.equal(st.seconds, 30);
  assert.equal(st.agents["impl-x-t1"].seconds, 15);
  assert.equal(st.agents["impl-x-t1"].cpu_s, 71);
  assert.deepEqual(st.agents["impl-x-t1"].raw.terms, {});
  assert.ok(JSON.stringify(st).startsWith('{"sampled_ms":2000000,"version":2,'));
});

test("run totals never go down when a process leaves the tree unreaped", () => {
  const terms = [{ address: "t1", name: "a", parent: null }];
  // agent → sh → node dev server; then sh exits and the server is reparented out of the tree.
  let st = mergeRun(null, terms, { t1: usage(1, [agentRoot(10000, 0), proc("2:1", "shell", 1000, 0, "10:1"), proc("3:1", "node", 5000, 0, "2:1")]) }, 1, "linux");
  assert.equal(st.agents.a.cpu_s, 16);
  st = mergeRun(st, terms, { t1: usage(1, [agentRoot(10000, 1000)]) }, 5001, "linux");
  assert.equal(st.agents.a.cpu_s, 16);
  assert.equal(st.agents.a.programs.node.cpu_s, 5);
  assert.equal(st.agents.a.programs.shell.cpu_s, 1);
  st = mergeRun(st, terms, { t1: usage(1, [agentRoot(12000, 1000)]) }, 10001, "linux");
  assert.equal(st.agents.a.cpu_s, 18);
});

test("macOS totals are what was seen", () => {
  const st = mergeRun(null, [{ address: "t1", name: "a", parent: null }],
    { t1: usage(1024, [agentRoot(2000, 0), proc("9:Mon_Nov_16_09:43:12_2026", "node", 3000, 0, "10:1")]) }, 1, "darwin");
  assert.equal(st.estimated, true);
  assert.equal(st.agents.a.cpu_s, 5);
});

test("the write is atomic, guarded by what was read and by a lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-run-"));
  const lock = join(dir, ".resources.json.lock");
  const write = (want, text) => spawnSync("sh", ["-c", WRITE, "sh", dir, want, ...chunks(text)]).status;
  try {
    assert.equal(write("0", '{"sampled_ms":5,"a":1}'), 0);
    assert.equal(readFileSync(join(dir, ".resources.json"), "utf8"), '{"sampled_ms":5,"a":1}');
    // Another poll wrote first: the stale one is dropped.
    assert.equal(write("0", '{"sampled_ms":6,"a":2}'), 3);
    assert.equal(write("5", '{"sampled_ms":7,"a":3}'), 0);
    // A writer holds the lock: skipped, the file stays whole, the lock stays.
    mkdirSync(lock);
    assert.equal(write("7", '{"sampled_ms":8,"a":4}'), 3);
    assert.equal(JSON.parse(readFileSync(join(dir, ".resources.json"), "utf8")).a, 3);
    assert.equal(existsSync(lock), true);
    // A lock older than a minute is a killed writer's: broken, and the next write goes through.
    execFileSync("touch", ["-d", "2 minutes ago", lock]);
    assert.equal(write("7", '{"sampled_ms":8,"a":4}'), 3);
    assert.equal(existsSync(lock), false);
    // JSON longer than one argument may be (128 kB on Linux) goes in several, joined.
    const big = `{"sampled_ms":9,"pad":"${"x".repeat(300000)}"}`;
    assert.ok(chunks(big).length > 2);
    assert.equal(write("7", big), 0);
    assert.equal(readFileSync(join(dir, ".resources.json"), "utf8"), big);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
