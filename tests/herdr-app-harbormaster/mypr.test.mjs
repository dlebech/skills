// The user's own PRs that need something, and the combined "Next for you" list, against fake-gh.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseMine, outsideRuns, minePrs, nextItems, refreshMine, mineError, QUERY } from "../../herdr-app/mods/harbormaster/mypr.js";
import { refreshReviews } from "../../herdr-app/mods/harbormaster/reviews.js";

const fake = fileURLToPath(new URL("./fake-gh.sh", import.meta.url));
const ghOut = (args) => execFileSync(fake, args, { env: { ...process.env, REAL_GH: "false" }, encoding: "utf8" });
const mine = parseMine(ghOut(["api", "graphql", "-f", `query=${QUERY}`]));

test("only PRs needing an action show, each with a reason and a suggested action", () => {
  assert.deepEqual(mine.map((p) => [p.number, p.reason, p.action.label]), [
    [11, "CI failed", "Open check"], [12, "changes requested", "Open PR"], [13, "approved — merge", "Merge on GitHub"],
    [14, "2 new comments", "Open PR"], [16, "approved — merge", "Merge on GitHub"],
    [17, "approved — merge", "Merge on GitHub"], [18, "changes requested", "Open PR"], [20, "approved — merge", "Merge on GitHub"]]);
  assert.equal(mine[0].action.url, "https://ci/11");
  assert.equal(mine[3].since, Date.parse("2026-11-17T01:10:00Z")); // oldest of the new ones; the author's, the bot's and the pre-push one don't count
});

test("without a reviewDecision the standing reviews decide; pending CI is not merge-ready", () => {
  const by = Object.fromEntries(mine.map((p) => [p.number, p.reason]));
  assert.equal(by[17], "approved — merge"); // anna's approval stands
  assert.equal(by[18], "changes requested"); // a change request outweighs bo's approval
  assert.equal(by[19], undefined); // approved, but CI still running: quiet
  assert.equal(by[20], "approved — merge"); // mergeable UNKNOWN right after a push
});

test("a PR in a live or parked run is left out; a closed run's is not", () => {
  const left = outsideRuns(mine, [{ prs: [{ url: "https://github.com/acme/app/pull/16/" }] }, { prs: ["https://github.com/acme/app/pull/12"], away: { how: "parked" } }, { prs: ["https://github.com/acme/app/pull/13"], away: { how: "closed" } }]);
  assert.deepEqual(left.map((p) => p.number), [11, 13, 14, 17, 18, 20]);
});

test("a failing poll says so quietly and keeps the last good list; partial data counts", async () => {
  assert.deepEqual(parseMine("not json"), []);
  const good = ghOut(["api", "graphql", "-f", `query=${QUERY}`]);
  globalThis.__herdrExec = async () => ({ code: 0, stdout: good, stderr: "" });
  await refreshMine(true);
  assert.equal(mineError(), null);
  const n = minePrs({}).length;
  assert.ok(n > 0);
  globalThis.__herdrExec = async () => ({ code: 1, stdout: "", stderr: "no" });
  await refreshMine(true);
  assert.equal(mineError(), "can't reach GitHub");
  assert.equal(minePrs({}).length, n);
  globalThis.__herdrExec = async () => { throw new Error("timeout"); };
  await refreshMine(true);
  assert.equal(mineError(), "can't reach GitHub");
  // gh exits 1 on any error in the response, even with data beside it (an SSO-hidden PR)
  const partial = JSON.stringify({ ...JSON.parse(good), errors: [{ type: "FORBIDDEN", message: "SAML" }] });
  globalThis.__herdrExec = async () => ({ code: 1, stdout: partial, stderr: "" });
  await refreshMine(true);
  assert.equal(mineError(), null);
  assert.equal(minePrs({}).length, n);
});

test("nextItems: review requests first, then mine, oldest wait first in each", async () => {
  const now = Date.parse("2026-11-17T03:00:00Z");
  const reqs = JSON.stringify([
    { number: 5, title: "New", url: "https://github.com/o/r/pull/5", author: { login: "bo" }, updatedAt: "2026-11-17T02:50:00Z", repository: { nameWithOwner: "o/r" } },
    { number: 4, title: "Old", url: "https://github.com/o/r/pull/4", author: { login: "cy" }, updatedAt: "2026-11-17T01:00:00Z", repository: { nameWithOwner: "o/r" } }]);
  globalThis.__herdrExec = async (cmd, args) => ({ code: 0, stdout: args.includes("graphql") ? ghOut(args) : reqs, stderr: "" });
  await refreshMine(true); await refreshReviews(true);
  const items = nextItems({ runs: [{ prs: ["https://github.com/acme/app/pull/16"] }] }, now);
  assert.deepEqual(items.map((i) => `${i.kind}:${i.number}`), ["review:4", "review:5", "mine:11", "mine:14", "mine:12", "mine:13", "mine:17", "mine:18", "mine:20"]);
  assert.deepEqual(Object.keys(items[2]).sort(), ["action", "age", "kind", "local", "number", "reason", "repo", "run", "title", "url"]);
  assert.equal(items[2].age, 2 * 3600e3);
  assert.equal(items[0].reason, "review requested · cy");
});

test("nextItems: a parked run's PRs stay out, a closed run's show, and a parked run never claims a review request", async () => {
  const reqs = JSON.stringify([{ number: 4, title: "Old", url: "https://github.com/o/r/pull/4", author: { login: "cy" }, updatedAt: "2026-11-17T01:00:00Z", repository: { nameWithOwner: "o/r" } }]);
  globalThis.__herdrExec = async (cmd, args) => ({ code: 0, stdout: args.includes("graphql") ? ghOut(args) : reqs, stderr: "" });
  await refreshMine(true); await refreshReviews(true);
  const parked = { prs: ["https://github.com/acme/app/pull/13"], issues: ["https://github.com/o/r/pull/4"], away: { how: "parked" } };
  const closed = { prs: ["https://github.com/acme/app/pull/17"], away: { how: "closed" } };
  const nums = (items) => items.map((i) => `${i.kind}:${i.number}`);
  const items = nextItems({ runs: [{ prs: ["https://github.com/acme/app/pull/16"] }], parked: [parked] });
  assert.ok(!nums(items).includes("mine:13"));
  assert.ok(nums(items).includes("review:4")); // the parked run does not hide the request
  assert.equal(items.find((i) => i.kind === "review").run, null);
  assert.ok(nums(nextItems({ runs: [], parked: [] })).includes("mine:13"));
  assert.ok(nums(nextItems({ runs: [], parked: [parked] })).includes("mine:17")); // closed runs are not passed in at all
  assert.ok(nums(minePrs({ runs: [closed] })).includes("mine:17"));
});
