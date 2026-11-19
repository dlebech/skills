// The New run dialog's prompt and arguments, the remembered choices, and the review requests parser.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROFILE, AGENTS, agentFor, lastProfile, skillPrompt, roleValue, matchModels, modelProblems, setRole, parsePiModels, parseOpencodeModels, profileText, parseProfile, profileFor, buildPrompt, inputProblem, prRef, runAgentName, startArgs,
  startOutcome, parsePrefs, draftsFor, remember, prefillProfile, lastReviewProfile,
} from "../../herdr-app/mods/harbormaster/startrun.js";
import { newRunArgs } from "../../herdr-app/mods/harbormaster/commands.js";
import { parseReviewRequests, runReviewing, withContext } from "../../herdr-app/mods/harbormaster/reviews.js";
import { ownerRepo } from "../../herdr-app/mods/harbormaster/repospaces.js";

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

test("a review's prompt is the review preset with its drafts mode, Opus and L1, and no implementer or specialist", () => {
  const profile = profileFor("review", { ...DEFAULT_PROFILE, implementer: "opencode/q", reviewer: "sonnet", autonomy: "L3" });
  assert.deepEqual(profile, { reviewer: "opus", autonomy: "L1" });
  assert.equal(buildPrompt({ kind: "review", input: "https://github.com/o/r/pull/7", profile, drafts: "pending" }),
    "/herdr-app-orchestrator review https://github.com/o/r/pull/7 type=rev review-drafts=pending reviewer-model=opus autonomy=L1");
  // A review line the user edits does not get the implementer or specialist added back.
  assert.deepEqual(parseProfile("reviewer=sonnet", profile).profile, { reviewer: "sonnet", autonomy: "L1" });
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
  assert.deepEqual(p, { profile: null, profiles: {}, reviewProfiles: {}, agent: null, drafts: {}, folders: [] });
  p = remember(p, { kind: "issue", profile: { ...DEFAULT_PROFILE, implementer: "opus" }, repo: "/r" });
  assert.equal(p.profile.implementer, "opus");
  p = remember(p, { kind: "review", profile: { ...DEFAULT_PROFILE, reviewer: "sonnet", autonomy: "L2" }, repo: "/r", drafts: "pending" });
  assert.equal(p.profile.implementer, "opus"); // a review leaves the profile alone
  assert.deepEqual(p.reviewProfiles, { claude: { reviewer: "sonnet", autonomy: "L2" } }); // and keeps its own, per agent
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
  const repos = [{ space: "sp-1", name: "skills", root: "/home/d/skills", origin: "dlebech/skills" }];
  const runs = [{ dir: "/runs/skills/pr-9", issues: [], related: [{ url: "https://github.com/acme/api/pull/9" }] }];
  const [a, b] = withContext(parseReviewRequests(GH), repos, runs);
  assert.equal(a.local, null);
  assert.equal(a.run, "/runs/skills/pr-9");
  assert.deepEqual(b.local, { space: "sp-1", root: "/home/d/skills", name: "skills", machine: null });
  assert.equal(b.run, null);
  // A clone found beside the open spaces counts too (no space yet: a review opens one); an open space wins.
  const cloned = withContext(parseReviewRequests(GH), [{ space: null, name: "api", root: "/home/d/api", origin: "acme/api" }, ...repos], []);
  assert.deepEqual(cloned[0].local, { space: null, root: "/home/d/api", name: "api", machine: null });
  // Another machine's open checkout counts (a review starts there); this machine's comes first.
  const far = { space: "desk/sp-1", name: "skills", root: "/home/d/skills", origin: "dlebech/skills", machine: "desk" };
  assert.equal(withContext(parseReviewRequests(GH), [far], [])[1].local.machine, "desk");
  assert.equal(withContext(parseReviewRequests(GH), [...repos, far], [])[1].local.machine, null);
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

test("a review started from here says starting… until its run is seen or five minutes pass, then Review again", async () => {
  const { reviewStarting, markReviewStarted, clearReviewStarted, STARTED_MS } = await import("../../herdr-app/mods/harbormaster/startrun.js");
  const url = "https://github.com/o/r/pull/9";
  assert.equal(reviewStarting(url, 1000), false);
  markReviewStarted(url, 1000);
  assert.equal(reviewStarting(url, 1000 + 60000), true);
  assert.equal(reviewStarting(url, 1000 + STARTED_MS), true);
  assert.equal(reviewStarting(url, 1001 + STARTED_MS), false);
  // Forgotten once expired; a failed start clears it at once.
  assert.equal(reviewStarting(url, 1000), false);
  markReviewStarted(url, 1000);
  clearReviewStarted(url);
  assert.equal(reviewStarting(url, 1000), false);
  markReviewStarted(null, 1000);
  assert.equal(reviewStarting(null, 1000), false);
});

test("the agent: the remembered one while installed, else Claude Code, else the first installed", () => {
  assert.equal(agentFor({ agent: "pi" }, ["claude", "pi"]), "pi");
  assert.equal(agentFor({ agent: "codex" }, ["claude", "pi"]), "claude"); // uninstalled since
  assert.equal(agentFor({}, ["pi", "opencode"]), "pi");
  assert.equal(agentFor(null, []), "claude"); // nothing found: as before there was a choice
  assert.deepEqual(AGENTS.map((a) => a.id), ["claude", "pi", "opencode", "codex"]);
});

test("each agent runs the skill its own way, with agent= for any but Claude Code", () => {
  assert.equal(skillPrompt("claude", "s", "a b"), "/s a b");
  assert.equal(skillPrompt("pi", "s", "a b"), "/skill:s a b");
  assert.equal(skillPrompt("opencode", "s", "a b"), "Use the s skill with these arguments: a b");
  const pi = profileFor("issue", null, "pi");
  assert.equal(profileText(pi), "autonomy=L1"); // Claude's model names are not pi's
  assert.equal(buildPrompt({ kind: "issue", input: "12 agent=claude", profile: pi, agent: "pi" }), "/skill:herdr-app-orchestrator 12 agent=pi autonomy=L1");
  const own = parseProfile("implementer=ollama/qwen3:8b autonomy=L2", pi).profile;
  assert.equal(buildPrompt({ kind: "review", input: "7", profile: own, drafts: "herdr", agent: "opencode" }),
    "Use the herdr-app-orchestrator skill with these arguments: review 7 type=rev review-drafts=herdr agent=opencode implementer-model=ollama/qwen3:8b autonomy=L2");
  assert.equal(profileFor("review", null, "pi").reviewer, ""); // the Opus preset is Claude's
  assert.equal(startArgs({ name: "n", cwd: "/r", taskFile: "/t", spaceId: "s", kind: "pi" })[5], "pi");
});

test("the agent and each agent's profile are remembered apart; a captain start touches neither", () => {
  let p = parsePrefs("{}");
  p = remember(p, { kind: "issue", profile: { ...DEFAULT_PROFILE, implementer: "opus" }, repo: "/r", agent: "claude" });
  p = remember(p, { kind: "issue", profile: { implementer: "ollama/x", reviewer: "", specialist: "", autonomy: "L2" }, repo: "/r", agent: "pi" });
  assert.equal(p.agent, "pi");
  assert.equal(lastProfile(p, "claude").implementer, "opus");
  assert.equal(lastProfile(p, "pi").implementer, "ollama/x");
  assert.equal(lastProfile(p, "opencode"), null);
  p = remember(p, { kind: "captain", profile: null, repo: "/c", drafts: "herdr" });
  assert.equal(p.agent, "pi");
  assert.deepEqual(parsePrefs(JSON.stringify(p)), p);
});

const OPENCODE = ["ollama/qwen3.8:27b", "opencode/big-pickle", "opencode/hy4-flash-free", "strata/qwen3.8-flash-next-coder-iq1_m"];
const env = { agent: "claude", installed: ["claude", "pi", "opencode"], models: { opencode: OPENCODE, pi: ["ollama/gemma4:26b"] } };

test("a role's value: a model of the run's agent, <agent>:<model>, or an agent; a provider is never an agent", () => {
  assert.deepEqual(roleValue("sonnet"), { kind: "claude", model: "sonnet" });
  assert.deepEqual(roleValue("opencode:strata/x"), { kind: "opencode", model: "strata/x" });
  assert.deepEqual(roleValue("pi"), { kind: "pi", model: "" });
  assert.deepEqual(roleValue("opencode/big-pickle", "opencode"), { kind: "opencode", model: "opencode/big-pickle" });
});

test("the run that guessed: implementer=opencode/qwen3.8flash is caught, with strata's flash model first", () => {
  const profile = { ...DEFAULT_PROFILE, implementer: "opencode/qwen3.8flash" };
  const [p] = modelProblems(profile, env);
  assert.equal(p.role, "implementer");
  assert.equal(p.suggestions[0], "opencode:strata/qwen3.8-flash-next-coder-iq1_m");
  const fixed = setRole(profileText(profile), "implementer", p.suggestions[0]);
  assert.equal(fixed, "implementer=opencode:strata/qwen3.8-flash-next-coder-iq1_m reviewer=opus specialist=opus autonomy=L1");
  const again = parseProfile(fixed).profile;
  assert.deepEqual(modelProblems(again, env), []);
  assert.equal(buildPrompt({ kind: "issue", input: "1371", profile: again }),
    "/herdr-app-orchestrator 1371 implementer=opencode implementer-model=strata/qwen3.8-flash-next-coder-iq1_m reviewer-model=opus specialist-model=opus autonomy=L1");
});

test("model checks: Claude's names, an uninstalled agent, an unlisted agent, the orchestrator's own", () => {
  assert.deepEqual(modelProblems(DEFAULT_PROFILE, env), []);
  assert.equal(modelProblems({ implementer: "sonet" }, env)[0].suggestions[0], "sonnet");
  assert.match(modelProblems({ implementer: "codex:gpt" }, env)[0].why, /codex is not installed/);
  assert.deepEqual(modelProblems({ implementer: "pi:anything" }, { ...env, models: {} }), []); // no list: not checked
  assert.deepEqual(modelProblems({ orchestrator: "strata/qwen3.8-flash-next-coder-iq1_m" }, { ...env, agent: "opencode" }), []);
  assert.match(modelProblems({ orchestrator: "pi:x" }, env)[0].why, /Agent above/);
  assert.deepEqual(matchModels("pi:gemma", env), ["pi:ollama/gemma4:26b"]);
  assert.equal(matchModels("big pickle", { ...env, agent: "opencode" })[0], "opencode/big-pickle");
});

test("the orchestrator's model goes to start-agent.sh, not the prompt", () => {
  const { profile } = parseProfile("orchestrator=strata/q autonomy=L2", profileFor("issue", null, "opencode"));
  assert.equal(buildPrompt({ kind: "issue", input: "1", profile, agent: "opencode" }), "Use the herdr-app-orchestrator skill with these arguments: 1 agent=opencode autonomy=L2");
  const args = startArgs({ name: "n", cwd: "/r", taskFile: "/t", spaceId: "s", kind: "opencode", model: roleValue(profile.orchestrator, "opencode").model });
  assert.deepEqual(args.slice(4, 8), ["--kind", "opencode", "--model", "strata/q"]);
});

test("the model lists are read from each agent's own output", () => {
  assert.deepEqual(parsePiModels("provider   model   context\nollama     gemma4:26b  64K\nllama.cpp  ggml-org/x:Q4  16K\n"), ["ollama/gemma4:26b", "llama.cpp/ggml-org/x:Q4"]);
  assert.deepEqual(parseOpencodeModels("Loading...\nstrata/qwen3\nopencode/big-pickle\n"), ["strata/qwen3", "opencode/big-pickle"]);
});

test("the last review's reviewer is remembered per agent and prefills the next review", () => {
  let p = parsePrefs(JSON.stringify({ profile: { ...DEFAULT_PROFILE, implementer: "opus" }, agent: "claude" })); // an old file
  assert.deepEqual(p.reviewProfiles, {});
  assert.equal(lastReviewProfile(p, "claude"), null);
  assert.deepEqual(prefillProfile(p, "review", "claude"), { reviewer: "opus", autonomy: "L1" }, "no memory: the preset");
  assert.deepEqual(prefillProfile(p, "review", "pi"), { reviewer: "", autonomy: "L1" });
  const before = p.profile;
  p = remember(p, { kind: "review", profile: { orchestrator: "haiku", implementer: "x", reviewer: "sonnet", specialist: "y", autonomy: "L3" }, repo: "/r", drafts: "herdr", agent: "claude" });
  p = remember(p, { kind: "review", profile: { reviewer: "", autonomy: "L2" }, repo: "/r", drafts: "herdr", agent: "pi" });
  assert.deepEqual(p.profile, before, "the feature profile is untouched");
  assert.deepEqual(p.profiles, {});
  assert.deepEqual(prefillProfile(p, "review", "claude"), { reviewer: "sonnet", autonomy: "L3", orchestrator: "haiku" });
  assert.deepEqual(prefillProfile(p, "review", "pi"), { reviewer: "", autonomy: "L2" });
  assert.deepEqual(prefillProfile(p, "review", "opencode"), { reviewer: "", autonomy: "L1" });
  assert.equal(prefillProfile(p, "issue", "claude").implementer, "opus", "a feature run still uses its own profile");
  assert.deepEqual(parsePrefs(JSON.stringify(p)), p);
});
