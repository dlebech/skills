// Starting a run without the captain (the "+ New run" dialog, the one-click Review): the
// orchestrator prompt, the profile line, the start-agent.sh arguments and the remembered
// choices. Pure, so the tests drive it; newrun.js does the exec and the drawing.

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

// What a run uses until the user changes it; a review always starts from Opus and L1 (the preset).
export const DEFAULT_PROFILE = { implementer: "sonnet", reviewer: "opus", specialist: "opus", autonomy: "L1" };
export const REVIEW_PROFILE = { reviewer: "opus", autonomy: "L1" };

const ROLES = ["implementer", "reviewer", "specialist"];

// "implementer=sonnet reviewer=opus specialist=opus autonomy=L1": the line the user edits.
export const profileText = (p) => `${ROLES.map((r) => `${r}=${p[r]}`).join(" ")} autonomy=${p.autonomy}`;

// Reads the line back over `base`; a part it cannot read leaves the base's, and says so.
export function parseProfile(text, base = DEFAULT_PROFILE) {
  const p = { ...base }, bad = [];
  for (const part of String(text).split(/[\s,]+/).filter(Boolean)) {
    const [, key, val] = /^([a-z-]+?)(?:-model)?=(\S+)$/i.exec(part) ?? [];
    if (ROLES.includes(key?.toLowerCase())) p[key.toLowerCase()] = val;
    else if (key?.toLowerCase() === "autonomy" && /^L[0-3]$/i.test(val)) p.autonomy = val.toUpperCase();
    else bad.push(part);
  }
  return { profile: p, bad };
}

// The profile a start of this kind prefills: the last one, a review's preset on top.
export const profileFor = (kind, last) => ({ ...DEFAULT_PROFILE, ...(last ?? {}), ...(kind === "review" ? REVIEW_PROFILE : {}) });

const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();

// The orchestrator's first prompt: `/herdr-app-orchestrator <work> <options>`; a review is
// `review <pr> review-drafts=<mode>` (herdr-app-orchestrator's review preset).
export function buildPrompt({ kind, input, profile, drafts = "herdr" }) {
  // Words the profile or drafts own would override them: the text keeps only its own.
  const work = oneLine(input).split(" ").filter((w) => !/^(?:type|review-drafts|autonomy|(?:implementer|reviewer|specialist)-model)=/i.test(w)).join(" ");
  const opts = `${ROLES.map((r) => `${r}-model=${profile[r]}`).join(" ")} autonomy=${profile.autonomy}`;
  if (kind === "review") return `/herdr-app-orchestrator review ${work} type=rev review-drafts=${drafts} ${opts}`;
  return `/herdr-app-orchestrator ${work} ${opts}`;
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
export function startArgs({ name, cwd, taskFile, spaceId, kind = "claude" }) {
  return ["--name", name, "--cwd", cwd, "--kind", kind, "--task-file", taskFile, "--no-parent",
    "--label", "role=orchestrator", "--label", `herdr.space=${spaceId}`, "--label", `herdr.tab=tb-${name}`];
}

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
    const drafts = j?.drafts && typeof j.drafts === "object" ? j.drafts : {};
    return { profile, drafts };
  } catch { return { profile: null, drafts: {} }; }
}

// The review-drafts mode a repository starts with: its remembered one, never "direct".
export const draftsFor = (prefs, repo) => (["herdr", "pending"].includes(prefs?.drafts?.[repo]) ? prefs.drafts[repo] : "herdr");

// The prefs after a start. A review does not touch the profile (its preset is not the user's
// habit); "direct" is never remembered, and leaves what the repository had.
export function remember(prefs, { kind, profile, repo, drafts }) {
  const next = { profile: prefs?.profile ?? null, drafts: { ...(prefs?.drafts ?? {}) } };
  if (kind === "review") { if (drafts !== "direct") next.drafts[repo] = drafts; }
  else next.profile = profile;
  return next;
}

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
