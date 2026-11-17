// The New run dialog's prompt and arguments, the remembered choices, and the review requests parser.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROFILE, profileText, parseProfile, profileFor, buildPrompt, inputProblem, prRef, runAgentName, startArgs,
  startOutcome, parsePrefs, draftsFor, remember,
} from "../../herdr-app/mods/harbormaster/startrun.js";
import { newRunArgs } from "../../herdr-app/mods/harbormaster/commands.js";
import { parseReviewRequests, runReviewing, withContext } from "../../herdr-app/mods/harbormaster/reviews.js";
import { ownerRepo, repoFromRevParse } from "../../herdr-app/mods/harbormaster/repospaces.js";

test("the default profile line, and reading an edited one back", () => {
  assert.equal(profileText(DEFAULT_PROFILE), "implementer=sonnet reviewer=opus specialist=opus autonomy=L1");
  const { profile, bad } = parseProfile("implementer=opus autonomy=l2 reviewer-model=sonnet nonsense");
  assert.deepEqual(profile, { implementer: "opus", reviewer: "sonnet", specialist: "opus", autonomy: "L2" });
  assert.deepEqual(bad, ["nonsense"]);
  assert.deepEqual(parseProfile("autonomy=L9").bad, ["autonomy=L9"]);
});

test("an issue run's prompt carries the work and the profile", () => {
  assert.equal(buildPrompt({ kind: "issue", input: " 12  14 ", profile: DEFAULT_PROFILE }),
    "/herdr-app-orchestrator 12 14 implementer-model=sonnet reviewer-model=opus specialist-model=opus autonomy=L1");
  assert.match(buildPrompt({ kind: "describe", input: "Add a dark mode\nto the sidebar", profile: DEFAULT_PROFILE }), /^\/herdr-app-orchestrator Add a dark mode to the sidebar implementer-model=/);
});

test("a review's prompt is the review preset with its drafts mode, Opus and L1", () => {
  const profile = profileFor("review", { ...DEFAULT_PROFILE, reviewer: "sonnet", autonomy: "L3" });
  assert.equal(buildPrompt({ kind: "review", input: "https://github.com/o/r/pull/7", profile, drafts: "pending" }),
    "/herdr-app-orchestrator review https://github.com/o/r/pull/7 type=rev review-drafts=pending implementer-model=sonnet reviewer-model=opus specialist-model=opus autonomy=L1");
  assert.equal(profileFor("issue", { autonomy: "L3" }).autonomy, "L3");
});

test("the input is checked per kind", () => {
  assert.ok(inputProblem("issue", "  "));
  assert.equal(inputProblem("issue", "12"), null);
  assert.ok(inputProblem("review", "my feature"));
  assert.equal(inputProblem("review", "#123"), null);
  assert.equal(prRef("#123"), "123");
  assert.equal(prRef("https://github.com/o/r/pull/9"), "https://github.com/o/r/pull/9");
  assert.equal(prRef("https://github.com/o/r/issues/9"), null);
});

test("the agent name is a valid hc name; the arguments start a parentless orchestrator in the space", () => {
  const n = runAgentName("A very long repository name", "issue", "Fix the Login!! page now please", 123456);
  assert.match(n, /^[a-z0-9_-]{1,32}$/);
  assert.match(n, /^orc-a-very-l/);
  assert.match(runAgentName("skills", "review", "https://github.com/o/r/pull/45", 1), /^orc-skills-pr45-/);
  assert.notEqual(runAgentName("skills", "issue", "12", 1000), runAgentName("skills", "issue", "12", 2000));
  assert.deepEqual(startArgs({ name: "orc-x", cwd: "/r", taskFile: "/t", spaceId: "sp-1" }), [
    "--name", "orc-x", "--cwd", "/r", "--kind", "claude", "--task-file", "/t", "--no-parent",
    "--label", "role=orchestrator", "--label", "herdr.space=sp-1", "--label", "herdr.tab=tb-orc-x"]);
});

test("start-agent.sh's outcomes read calmly", () => {
  assert.deepEqual(startOutcome(0, "started t5\n", ""), { ok: true, address: "t5" });
  const trust = startOutcome(4, "trust t5\n", "");
  assert.equal(trust.ok, false);
  assert.ok(trust.started);
  assert.match(trust.error, /trust the folder/);
  assert.match(startOutcome(1, "", "hc: no core\nmore").error, /hc: no core$/);
});

test("the last profile and each repository's drafts mode are remembered; direct never is", () => {
  let p = parsePrefs("not json");
  assert.deepEqual(p, { profile: null, drafts: {} });
  p = remember(p, { kind: "issue", profile: { ...DEFAULT_PROFILE, implementer: "opus" }, repo: "/r" });
  assert.equal(p.profile.implementer, "opus");
  p = remember(p, { kind: "review", profile: DEFAULT_PROFILE, repo: "/r", drafts: "pending" });
  assert.equal(p.profile.implementer, "opus"); // a review leaves the profile alone
  assert.equal(draftsFor(p, "/r"), "pending");
  p = remember(p, { kind: "review", profile: DEFAULT_PROFILE, repo: "/r", drafts: "direct" });
  assert.equal(draftsFor(p, "/r"), "pending"); // direct leaves what was
  assert.equal(draftsFor(p, "/other"), "herdr");
  assert.equal(draftsFor({ drafts: { "/r": "direct" } }, "/r"), "herdr"); // a hand-edited direct is ignored
  assert.deepEqual(parsePrefs(JSON.stringify(p)), p);
});

test("the new-run command's arguments", () => {
  assert.deepEqual(newRunArgs(""), {});
  assert.deepEqual(newRunArgs("repo=skills kind=review input=https://github.com/o/r/pull/3"), { repo: "skills", kind: "review", input: "https://github.com/o/r/pull/3" });
  assert.deepEqual(newRunArgs("input=add a thing"), { input: "add a thing" });
  assert.deepEqual(newRunArgs("kind=review repo=skills input=7 autonomy=L1"), { kind: "review", repo: "skills", input: "7 autonomy=L1" });
});

const GH = JSON.stringify([
  { number: 5, title: "Older", url: "https://github.com/dlebech/skills/pull/5", author: { login: "ann" }, updatedAt: "2026-11-16T10:00:00Z", repository: { nameWithOwner: "dlebech/skills" } },
  { number: 9, title: "Newer", url: "https://github.com/acme/api/pull/9", author: { login: "bo" }, updatedAt: "2026-11-17T10:00:00Z", repository: { nameWithOwner: "acme/api" } },
]);

test("gh's search output parses newest first, and garbage is no requests", () => {
  const l = parseReviewRequests(GH);
  assert.deepEqual(l.map((p) => p.number), [9, 5]);
  assert.deepEqual(l[0], { repo: "acme/api", number: 9, title: "Newer", url: "https://github.com/acme/api/pull/9", author: "bo", updated: Date.parse("2026-11-17T10:00:00Z") });
  assert.deepEqual(parseReviewRequests("oops"), []);
  assert.deepEqual(parseReviewRequests("{}"), []);
});

test("a request knows its local checkout and the live run reviewing it", () => {
  assert.equal(ownerRepo("git@github.com:dlebech/skills.git"), "dlebech/skills");
  assert.equal(ownerRepo("https://github.com/DLebech/Skills/"), "dlebech/skills");
  assert.equal(ownerRepo("https://gitlab.com/a/b"), null);
  assert.deepEqual(repoFromRevParse("/home/d/skills/.git\n/home/d/skills\n"), { root: "/home/d/skills", kind: "primary" });
  assert.equal(repoFromRevParse("/home/d/skills/.git\n/home/d/wt/x\n").kind, "worktree");
  const repos = [{ space: "sp-1", name: "skills", root: "/home/d/skills", origin: "dlebech/skills" }];
  const runs = [{ dir: "/runs/skills/pr-9", issues: [], related: [{ url: "https://github.com/acme/api/pull/9" }] }];
  const [a, b] = withContext(parseReviewRequests(GH), repos, runs);
  assert.equal(a.local, null);
  assert.equal(a.run, "/runs/skills/pr-9");
  assert.deepEqual(b.local, { space: "sp-1", root: "/home/d/skills" });
  assert.equal(b.run, null);
  assert.equal(runReviewing([{ dir: "/x", issues: ["https://github.com/acme/api/pull/9/"], related: [] }], "https://github.com/acme/api/pull/9"), "/x");
});

test("free text cannot override the profile or drafts options", () => {
  const p = buildPrompt({ kind: "describe", input: "add x autonomy=L3 reviewer-model=haiku", profile: DEFAULT_PROFILE });
  assert.match(p, /^\/herdr-app-orchestrator add x implementer-model=sonnet reviewer-model=opus .* autonomy=L1$/);
});

test("a bare PR number in a run's issues counts when its folder is the PR's repository", () => {
  const runs = [{ dir: "/runs/a", folder: "/home/d/api", issues: ["#9"], related: [] }, { dir: "/runs/b", folder: "/home/d/web", issues: ["9"], related: [] }];
  assert.equal(runReviewing(runs, "https://github.com/acme/api/pull/9"), "/runs/a");
  assert.equal(runReviewing(runs, "https://github.com/acme/api/pull/10"), null);
});
