// Starting a run without the captain (the "+ New run" dialog, the one-click Review): the
// orchestrator prompt, the profile line, the start-agent.sh arguments and the remembered
// choices. Pure, so the tests drive it; newrun.js does the exec and the drawing.

import { captainOf } from "./live.js";
import { RECENT_MAX } from "./folders.js";

export const KINDS = [
  { id: "issue", label: "Issue(s)", hint: "Issue numbers or URLs", example: "12 14 or a GitHub issue URL" },
  { id: "review", label: "Review PR", hint: "Pull request number or URL", example: "123 or a GitHub PR URL" },
  { id: "describe", label: "Describe", hint: "What should it do?", example: "Say it in your own words" },
];

export const DRAFTS = [
  { id: "herdr", label: "Show drafts in Herdr", tip: "Findings become draft comments in the run's tab and the Needs-you box; nothing reaches GitHub until you post it" },
  { id: "pending", label: "Pending GitHub review", tip: "Posted as a pending review that only you see, until you submit it on GitHub" },
  { id: "direct", label: "Post review directly", tip: "Submitted at once, in your name" },
];

// The agents an orchestrator can be (start-agent.sh --kind), in the order the dialog offers them.
// The dialog offers those installed (newrun.js installedAgents); with only one, no choice.
export const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "pi", label: "pi" },
  { id: "opencode", label: "opencode" },
  { id: "codex", label: "Codex", tip: "Untested with the orchestrator" },
];
// The command that starts an agent in a tab (start-agent.sh does the same). Codex without --no-daemon
// shares one background server whose environment, HC_TERMINAL_ID included, is that of the terminal
// that first started it, so a run would register that terminal, not its own.
// Copilot starts on a session id of ours, so it can be resumed after a restart (revive.js), as start-agent.sh does.
export const agentArgv = (id, uuid = newUuid) => (id === "codex" ? ["codex", "--no-daemon"] : id === "copilot" ? ["copilot", `--session-id=${uuid()}`] : [id]);
// The lines of skills/herdr-app-orchestrator/scripts/in-shell.sh, without its comments (a test checks
// they match): run the agent through the user's interactive shell, which execs it, so it has what
// ~/.bashrc sets up (nvm's node and npx) and is still the terminal's root program, ending its terminal
// when it exits. Inline, since Herdr runs the argv on the run's machine, whose skill path this does not know.
export const IN_SHELL = `s=\${SHELL:-}
[ -x "$s" ] || exec "$@"
case \${s##*/} in
  bash|zsh|ksh|ksh93|mksh) exec "$s" -ic 'printf "\\033[H\\033[2J\\033[3J"; exec "$0" "$@"' "$@" ;;
  fish) exec "$s" -ic 'printf "\\x1b[H\\x1b[2J\\x1b[3J"; exec $argv' "$@" ;;
esac
exec "$@"
`;
// The argv Herdr starts an agent of `id` with in a tab: agentArgv, through the user's interactive shell.
export const launchArgv = (id, uuid = newUuid) => ["sh", "-c", IN_SHELL, "sh", ...agentArgv(id, uuid)];
// A random (version 4) UUID, without crypto, which the mod runtime may not have.
export const newUuid = (rand = Math.random) => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((c === "x" ? 0 : 8) + Math.floor(rand() * (c === "x" ? 16 : 4))).toString(16));
export const agentLabel = (id) => AGENTS.find((a) => a.id === id)?.label ?? id;

// The agent a start uses: the remembered one while it is installed, else Claude Code, else the first installed.
export function agentFor(prefs, installed) {
  const have = installed?.length ? installed : ["claude"];
  return [prefs?.agent, "claude"].find((a) => a && have.includes(a)) ?? have[0];
}

// What a run uses until the user changes it; a review always starts from Opus and L1 (the preset).
// Model names are Claude's: another agent's models are provider/id, so its roles start empty (its own default).
export const DEFAULT_PROFILE = { implementer: "sonnet", reviewer: "opus", specialist: "opus", autonomy: "L1" };
export const REVIEW_PROFILE = { reviewer: "opus", autonomy: "L1" };
const OTHER_PROFILE = { implementer: "", reviewer: "", specialist: "", autonomy: "L1" };

const ROLES = ["implementer", "reviewer", "specialist"];
// The roles the line can set: the run's agents, and the orchestrator's own model (start-agent.sh --model).
const LINE_ROLES = ["orchestrator", ...ROLES];

// "implementer=sonnet reviewer=opus specialist=opus autonomy=L1": the line the user edits.
// A role with no model (another agent's default) is left out. A role's value is a model of the
// run's agent, or `<agent>:<model>` for another agent (`implementer=opencode:lab/qwen3`), or an agent alone.
export const profileText = (p) => [...LINE_ROLES.filter((r) => p[r]).map((r) => `${r}=${p[r]}`), `autonomy=${p.autonomy}`].join(" ");

const AGENT_IDS = new Set(["claude", "pi", "opencode", "codex"]);

// A role's value → {kind, model}: "opencode:lab/x" → opencode's lab/x; "pi" → pi's default;
// anything else a model of the run's agent (a "/" is a provider, as in opencode/big-pickle, never an agent).
export function roleValue(value, agent = "claude") {
  const v = String(value ?? "");
  const m = /^([a-z]+):(.*)$/.exec(v);
  if (m && AGENT_IDS.has(m[1])) return { kind: m[1], model: m[2] };
  if (AGENT_IDS.has(v)) return { kind: v, model: "" };
  return { kind: agent, model: v };
}

// Claude Code takes these names, or a full claude-* id; it has no list to ask.
const CLAUDE_MODELS = ["sonnet", "opus", "haiku", "fable", "opusplan", "default"];
const claudeModel = (m) => CLAUDE_MODELS.includes(m.toLowerCase().replace(/\[1m\]$/, "")) || /^claude-[\w.-]+(\[1m\])?$/i.test(m);

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const subsequence = (q, s) => { let i = 0; for (const c of s) if (c === q[i]) i++; return i === q.length; };

// The models that match what was typed, best first, as role values for a run of `agent`: from each
// installed agent's list (`models`: {opencode: [...], pi: [...]}) and Claude's names. Typing
// "qwen3.8flash" finds lab/qwen3.8-flash-next-coder-iq1_m; "opencode:qwen" looks only in opencode's.
export function matchModels(typed, { agent = "claude", models = {}, installed = ["claude"], max = 4 } = {}) {
  const { kind: only, model } = /^[a-z]+:/.test(typed) ? roleValue(typed, agent) : { kind: null, model: typed };
  const q = norm(model);
  // A provider-looking prefix that is wrong ("opencode/qwen…" for a lab model) should not hide the rest.
  const qTail = model.includes("/") ? norm(model.slice(model.indexOf("/") + 1)) : null;
  if (!q) return [];
  const pool = [];
  for (const kind of installed) {
    if (only && kind !== only) continue;
    const list = kind === "claude" ? CLAUDE_MODELS.slice(0, 4) : models[kind] ?? [];
    for (const m of list) pool.push({ kind, m });
  }
  const score = ({ kind, m }) => {
    const n = norm(m);
    const s = n.includes(q) ? 0 : qTail && n.includes(qTail) ? 1 : subsequence(q, n) ? 2 : qTail && subsequence(qTail, n) ? 3 : 9;
    return s + (kind === agent ? 0 : 0.5);
  };
  return pool.map((x) => ({ ...x, s: score(x) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s || a.m.length - b.m.length)
    .slice(0, max).map(({ kind, m }) => (kind === agent ? m : `${kind}:${m}`));
}

// What is wrong with the line's roles, given what is installed and each agent's model list
// (a list that could not be read is not checked): [{role, value, why, suggestions}].
export function modelProblems(profile, { agent = "claude", models = {}, installed = ["claude"] } = {}) {
  const out = [];
  for (const role of LINE_ROLES) {
    const value = profile?.[role];
    if (!value) continue;
    const { kind, model } = roleValue(value, agent);
    if (role === "orchestrator" && kind !== agent) { out.push({ role, value, why: `the orchestrator is the Agent above; give it a ${agent} model`, suggestions: [] }); continue; }
    if (!installed.includes(kind)) { out.push({ role, value, why: `${kind} is not installed`, suggestions: matchModels(model, { agent, models, installed }) }); continue; }
    if (!model) continue;
    const known = kind === "claude" ? claudeModel(model) : !models[kind] || models[kind].includes(model);
    if (!known) out.push({ role, value, why: `${kind} has no model ${model}`, suggestions: matchModels(kind === agent ? model : `${kind}:${model}`, { agent, models, installed }) });
  }
  return out;
}

// The line with one role's value replaced (a suggestion clicked); `<role>-model=` counts as the role.
export function setRole(text, role, value) {
  const parts = String(text).split(/\s+/).filter(Boolean);
  const i = parts.findIndex((p) => new RegExp(`^${role}(?:-model)?=`, "i").test(p));
  if (i >= 0) parts[i] = `${role}=${value}`; else parts.unshift(`${role}=${value}`);
  return parts.join(" ");
}

// `pi --list-models`' table → provider/model ids.
export const parsePiModels = (text) => String(text).split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 2 && c[0] && c[1]).map(([p, m]) => `${p}/${m}`);
// `opencode models`: one id per line.
export const parseOpencodeModels = (text) => String(text).split("\n").map((l) => l.trim()).filter((l) => /^[\w.-]+\/\S+$/.test(l));

// Reads the line back over `base`; a part it cannot read leaves the base's, and says so.
export function parseProfile(text, base = DEFAULT_PROFILE) {
  const p = { ...base }, bad = [];
  for (const part of String(text).split(/[\s,]+/).filter(Boolean)) {
    const [, key, val] = /^([a-z-]+?)(?:-model)?=(\S+)$/i.exec(part) ?? [];
    if (LINE_ROLES.includes(key?.toLowerCase())) p[key.toLowerCase()] = val;
    else if (key?.toLowerCase() === "autonomy" && /^L[0-3]$/i.test(val)) p.autonomy = val.toUpperCase();
    else bad.push(part);
  }
  return { profile: p, bad };
}

// The profile a start of this kind prefills: the last one for a run. A review never implements, so its
// profile holds only what it uses (reviewer, autonomy; the orchestrator if a line gives one): the agent's
// remembered review profile (`lastReview`), else the preset. `last` is that agent's (prefs.profiles[agent]);
// the Opus preset is Claude's only.
export const profileFor = (kind, last, agent = "claude", lastReview = null) => kind === "review"
  ? { ...(agent === "claude" ? REVIEW_PROFILE : { reviewer: "", autonomy: "L1" }), ...reviewPart(lastReview) }
  : agent === "claude" ? { ...DEFAULT_PROFILE, ...(last ?? {}) } : { ...OTHER_PROFILE, ...(last ?? {}) };

// The review's own roles of a profile: reviewer, autonomy and the orchestrator, when set.
const reviewPart = (p) => Object.fromEntries(["orchestrator", "reviewer", "autonomy"].filter((k) => p?.[k] != null && (p[k] || k === "reviewer")).map((k) => [k, p[k]]));

// The profile the dialog prefills for a kind and agent, from the remembered prefs.
export const prefillProfile = (prefs, kind, agent) => profileFor(kind, lastProfile(prefs, agent), agent, lastReviewProfile(prefs, agent));

// How each agent runs a skill: Claude Code by its slash command, pi by /skill:, the others asked in words.
export function skillPrompt(agent, skill, args) {
  if (agent === "claude") return `/${skill} ${args}`;
  if (agent === "pi") return `/skill:${skill} ${args}`;
  return `Use the ${skill} skill with these arguments: ${args}`;
}

const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();

// The orchestrator's first prompt: `/herdr-app-orchestrator <work> <options>`; a review is
// `review <pr> review-drafts=<mode>` (herdr-app-orchestrator's review preset).
// Another agent than Claude Code also gets agent=<it>, so the run's own agents are that kind too.
export function buildPrompt({ kind, input, profile, drafts = "herdr", agent = "claude" }) {
  // Words the profile, drafts or agent own would override them: the text keeps only its own.
  const work = oneLine(input).split(" ").filter((w) => !/^(?:type|review-drafts|autonomy|agent|(?:implementer|reviewer|specialist)(?:-model)?)=/i.test(w)).join(" ");
  // A role on another agent says so (implementer=opencode), then its model: the skill's own form.
  const roles = ROLES.filter((r) => profile[r]).flatMap((r) => {
    const { kind, model } = roleValue(profile[r], agent);
    return [...(kind !== agent ? [`${r}=${kind}`] : []), ...(model ? [`${r}-model=${model}`] : [])];
  });
  const opts = [...(agent === "claude" ? [] : [`agent=${agent}`]), ...roles, `autonomy=${profile.autonomy}`].join(" ");
  return skillPrompt(agent, "herdr-app-orchestrator", kind === "review" ? `review ${work} type=rev review-drafts=${drafts} ${opts}` : `${work} ${opts}`);
}

// "123", "#123" or a PR URL; the text back, or null.
export const prRef = (s) => {
  const t = oneLine(s);
  return /^#?\d+$/.test(t) ? t.replace("#", "") : /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\S*$/.test(t) ? t : null;
};

// What the input must be before Start works, or null when it is fine.
export function inputProblem(kind, input) {
  const t = oneLine(input);
  if (!t) return kind === "review" ? "Which pull request?" : kind === "issue" ? "Which issue?" : "What should it do?";
  if (kind === "review" && !prRef(t)) return "A PR number or a GitHub PR URL";
  return null;
}

// An hc terminal name: <= 32 of a-z 0-9 - _, unique per start (a name that is still live resumes that agent).
export function runAgentName(repo, kind, input, now = Date.now()) {
  const part = (s, n) => oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, n).replace(/-+$/, "");
  const what = kind === "review" ? `pr${/(\d+)\S*$/.exec(oneLine(input))?.[1] ?? ""}` : part(input, 8);
  return ["orc", part(repo, 8), what, (now % 46656).toString(36).padStart(3, "0")].filter(Boolean).join("-").slice(0, 32);
}

// The start-agent.sh arguments: a new tab in the repository's own space, no parent (the run must
// outlive whoever started it, here nobody), the role that lets runs.sh list it until it has a run directory.
export function startArgs({ name, cwd, taskFile, spaceId, kind = "claude", model = "" }) {
  return ["--name", name, "--cwd", cwd, "--kind", kind, ...(model ? ["--model", model] : []), "--task-file", taskFile, "--no-parent",
    "--label", "role=orchestrator", "--label", `herdr.space=${spaceId}`, "--label", `herdr.tab=tb-${name}`];
}

// ---- the captain, started from Harbormaster (newrun.js, dialog mode "captain") ----

export const CAPTAIN_PROMPT = "/herdr-app-captain";

// The live captain, if any: it is what Harbormaster's captain spot shows (live.js captainOf).
const liveCaptain = (terminals) => captainOf({ terminals: terminals ?? [] }).terminal;

// Why no captain can be started now, or null. A second captain would answer the same decisions twice.
export const captainProblem = (terminals) => (liveCaptain(terminals) ? "A captain is already running: open it from the captain link" : null);

// "captain", or "captain-<n>" when a live terminal (not a captain, e.g. a leftover) already has that name:
// start-agent.sh resumes a live name instead of starting anew.
export function captainName(terminals) {
  const taken = new Set((terminals ?? []).filter((t) => t.state === "live").flatMap((t) => [t.name, t.address?.split("/").pop()]));
  if (!taken.has("captain")) return "captain";
  for (let n = 2; ; n++) if (!taken.has(`captain-${n}`)) return `captain-${n}`;
}

// The captain's start-agent.sh arguments: as a run's, with role=captain, so it needs no parent and shows as the captain.
export const captainArgs = ({ name, cwd, taskFile, spaceId }) => startArgs({ name, cwd, taskFile, spaceId }).map((a) => (a === "role=orchestrator" ? "role=captain" : a));

// start-agent.sh's one line: "started t5", "trust t5", ... → what to tell the user.
export function startOutcome(code, stdout, stderr) {
  const [word, address] = String(stdout).trim().split(/\s+/);
  if (code === 0 && word === "started") return { ok: true, address };
  const calm = {
    trust: "Claude Code asks to trust the folder: answer it in the new tab",
    blocked: "A dialog is open in the new tab: answer it there",
    unconfirmed: "It started, but did not take the task: look in the new tab",
    exited: "The agent exited while starting: look in the new tab",
    timeout: "The agent never reported ready: look in the new tab",
  }[word];
  if (calm) return { ok: false, address, error: calm, started: true };
  return { ok: false, error: `Could not start it${stderr ? `: ${String(stderr).trim().split("\n")[0].slice(0, 160)}` : ""}` };
}

// ---- remembered choices: <runs root>/.newrun.json ----

export function parsePrefs(text) {
  try {
    const j = JSON.parse(text);
    const profile = j?.profile && typeof j.profile === "object" ? j.profile : null;
    // Each other agent's last profile; Claude Code's stays in `profile`, as before there was a choice.
    const profiles = j?.profiles && typeof j.profiles === "object" ? j.profiles : {};
    const agent = typeof j?.agent === "string" && j.agent ? j.agent : null;
    const drafts = j?.drafts && typeof j.drafts === "object" ? j.drafts : {};
    const folders = Array.isArray(j?.folders) ? j.folders.filter((f) => typeof f === "string" && f) : [];
    // Each agent's last review profile ({reviewer, autonomy, orchestrator?}); old files have none.
    const reviewProfiles = j?.reviewProfiles && typeof j.reviewProfiles === "object" && !Array.isArray(j.reviewProfiles) ? j.reviewProfiles : {};
    return { profile, profiles, reviewProfiles, agent, drafts, folders };
  } catch { return { profile: null, profiles: {}, reviewProfiles: {}, agent: null, drafts: {}, folders: [] }; }
}

// The review-drafts mode a repository starts with: its remembered one, never "direct".
export const draftsFor = (prefs, repo) => (["herdr", "pending"].includes(prefs?.drafts?.[repo]) ? prefs.drafts[repo] : "herdr");

// The prefs after a start. A review never touches the feature profile (its preset is not the user's
// habit); its own reviewer and autonomy are kept apart, per agent. "direct" is never remembered, and leaves what the repository had.
// The folder goes first in the recents (newest first, each once, at most RECENT_MAX).
// The agent is remembered from any run's start; the profile under that agent.
// `recent` false (a folder on another machine, `repo` being "<machine>:<folder>"): the recents,
// which are this machine's folders, are left as they were.
export function remember(prefs, { kind, profile, repo, drafts, agent = "claude", recent = true }) {
  const folders = recent ? [repo, ...(prefs?.folders ?? []).filter((f) => f !== repo)].slice(0, RECENT_MAX) : [...(prefs?.folders ?? [])];
  const next = { profile: prefs?.profile ?? null, profiles: { ...(prefs?.profiles ?? {}) }, reviewProfiles: { ...(prefs?.reviewProfiles ?? {}) }, agent: prefs?.agent ?? null, drafts: { ...(prefs?.drafts ?? {}) }, folders };
  if (kind === "captain") return next; // only the folder is remembered
  next.agent = agent;
  if (kind === "review") {
    if (drafts !== "direct") next.drafts[repo] = drafts;
    if (profile) next.reviewProfiles[agent] = reviewPart(profile);
  }
  else if (agent === "claude") next.profile = profile;
  else next.profiles[agent] = profile;
  return next;
}

// The last review's profile with this agent, or null.
export const lastReviewProfile = (prefs, agent) => prefs?.reviewProfiles?.[agent] ?? null;

// The last profile used with this agent.
export const lastProfile = (prefs, agent) => (agent === "claude" ? prefs?.profile : prefs?.profiles?.[agent]) ?? null;

// The reviews started from here, by PR URL → when the click was. A review's orchestrator writes
// the run files that name the PR (reviews.js runReviewing) a while after it takes its task, so
// until then, or for STARTED_MS, its row says "starting…" instead of offering Review again.
// Module state: every view and copy of the mod shares it.
export const STARTED_MS = 5 * 60000;
const started = new Map();
export const markReviewStarted = (url, at = Date.now()) => { if (url) started.set(url, at); };
export const clearReviewStarted = (url) => { started.delete(url); };
export function reviewStarting(url, now = Date.now()) {
  const at = started.get(url);
  if (at == null) return false;
  if (now - at <= STARTED_MS) return true;
  started.delete(url);
  return false;
}
