// A run's PRs and Next for you, as drawn: the sidebar (crew) and the Bridge's queue (queueSections)
// both go through crew.js nextSection. Live and parked runs' PRs are left out; a closed run's show.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resetShared } from "herdr";
import { crew, queueSections } from "../../herdr-app/mods/harbormaster/crew.js";
import { refreshReviews } from "../../herdr-app/mods/harbormaster/reviews.js";
import { refreshMine } from "../../herdr-app/mods/harbormaster/mypr.js";

const fake = fileURLToPath(new URL("./fake-gh.sh", import.meta.url));
const ghOut = (args) => execFileSync(fake, args, { env: { ...process.env, REAL_GH: "false" }, encoding: "utf8" });
const t = new Proxy({}, { get: () => "#888" });
const text = (e) => (e && typeof e === "object" && "kids" in e ? e.kids.map(text).join("") : typeof e === "string" ? e : "");
const PR = "https://github.com/acme/app/pull/13"; // approved and mergeable: "approved — merge"
let view;

beforeEach(async () => {
  resetShared();
  view = { runs: [], decisions: [], folds: new Map() };
  globalThis.__herdrWrite = async () => null;
  globalThis.__herdrRead = async () => "";
  globalThis.__herdrExec = async (cmd, args) => ({ code: 0, stdout: args.includes("graphql") ? ghOut(args) : "[]", stderr: "" });
  await refreshReviews(true);
  await refreshMine(true);
});

const run = (away) => ({ key: ":r1", dir: "r1", branch: "r1", terminal: "t99", localTerminal: "t99", phase: "running", statusLine: "running", progress: "", tasks: [], prs: [PR], question: null, ask: null,
  away: away ? { how: away, at: 1 } : null, updated: Date.now() - 5 * 60000, started: Date.now() - 3600000 });
// Whether the PR's row is in the sidebar's Next for you and in the Bridge's queue.
const shown = () => [text(crew(view, t)), text({ kids: queueSections(view, t, { all: true }) })].map((s) => s.includes("Mine 13"));

test("with no run the PR shows, in the sidebar and the Bridge's queue", () => {
  assert.deepEqual(shown(), [true, true]);
});
test("a parked run's PR is left out of both", () => {
  view.runs = [run("parked")];
  assert.deepEqual(shown(), [false, false]);
});
test("a closed run's PR shows in both", () => {
  view.runs = [run("closed")];
  assert.deepEqual(shown(), [true, true]);
});
test("a live run's PR is left out of both", () => {
  view.runs = [run()];
  assert.deepEqual(shown(), [false, false]);
});
