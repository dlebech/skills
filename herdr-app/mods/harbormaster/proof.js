// A run's proof files: each task's `Proof:` line and the run's `Proof tier:` from plan.md,
// proof.md (claim sections, read by claims.js, and an old run's task sections), and the user's
// say on a claim: proof-accepted.json and the "prove …" inbox line. No herdr imports, so it can
// be run under plain node. The format is in skills/herdr-app-orchestrator/references/run-files.md.

// The tier texts live in levels.js, with the other header tags' texts; re-exported here.
export { TIER_TEXT, tierTip } from "./levels.js";

// "T1 — the evidence", "T1: the evidence", "T2" → {tier: 1, text}; null when no T0..T3 leads it.
export function proofOf(s) {
  const m = /^[*_`\s]*T([0-3])\b[*_`]*\s*(?:[—–:-]\s*)?(.*)$/is.exec(s ?? "");
  return m ? { tier: Number(m[1]), text: m[2].replace(/[*_`]+$/, "").trim() } : null;
}

// plan.md's `Proof tier: T2` or `Proof tier: T2 (set by user)` → {tier, byUser}, else null.
export function declaredTier(plan) {
  const m = /^[*_\s]*Proof tier:?[*_\s]*T([0-3])\b(.*)$/im.exec(plan ?? "");
  return m ? { tier: Number(m[1]), byUser: /set by user/i.test(m[2]) } : null;
}

// The run's tier: the declared line, else the highest of its tasks' tiers, else null (nothing named).
export function runTier(plan, tasks) {
  const declared = declaredTier(plan);
  if (declared) return declared;
  const tiers = tasks.filter((t) => t.proof).map((t) => t.proof.tier);
  return tiers.length ? { tier: Math.max(...tiers), byUser: false } : null;
}

// `Files:` (an old run's task sections) and `Shot:` / `Clip:` are comma-separated paths; a note in
// parentheses after a path (it may hold commas) is dropped.
const MEDIA_FILE = /^[^\s,()]+\.\w{1,6}$/;
export function parseFiles(val) {
  const out = [];
  let depth = 0, cur = "";
  for (const c of val) {
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  // Only the path-looking first word of each entry counts: "a.png (the run pane)" is "a.png".
  return out.map((e) => e.replace(/\([^)]*\)?/g, " ").trim().split(/\s+/)[0]).filter((f) => f && MEDIA_FILE.test(f));
}

// proof.md → { tier, checks ({state: "green" | "red" | another word, text} or null), claims, tasks, cut }.
// A claim's section is "## C<n> <claim>" (claims.js): `Result: pass | fail | partial | pending — one
// line` (pending: still being gathered, as when a later task takes its screenshots), and evidence
// lines `Shot: <path>`, `Test: <name> — pass`, `Clip: <path>`. An old run's "## <task id> <name>"
// sections go to `tasks` ({tier, checked, result, why, files}); nothing shows them any more.
export const isClaimId = (id) => /^C\d+$/.test(String(id ?? ""));
export const emptyClaim = () => ({ result: null, why: "", shots: [], tests: [], clips: [] });

export function parseProofMd(text) {
  const out = { tier: null, checks: null, reviewed: [], tasks: {}, claims: {}, cut: false };
  if (!text) return out;
  let cur = null, claim = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const h = /^##\s+(\S+)/.exec(line);
    if (h) {
      cur = claim = null;
      // "## C1: Drag" and "## C1. Drag" are C1, as plan.md's claim lines are read.
      const id = h[1].replace(/[.:)]+$/, "");
      if (isClaimId(id)) claim = out.claims[id] = emptyClaim();
      else cur = out.tasks[h[1]] = { tier: null, checked: "", result: null, why: "", files: [] };
      continue;
    }
    // `Test:` only: "Tests: 4 passed" is a note, not a test named "4 passed".
    const kv = /^[-*\s]*(Tier|Checks|Reviewed|Checked|Result|Files|Shots?|Test|Clips?):\s*(.*)$/i.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase().replace(/^(shot|clip)s$/, "$1"), val = kv[2].trim();
    if (claim) { claimLine(claim, key, val); continue; }
    if (!cur) {
      if (key === "tier") out.tier = proofOf(val)?.tier ?? null;
      // "Checks: green — <what>" / "Checks: red — <what>" (or another word, as "pending — CI":
      // still running), in the header above the first section.
      else if (key === "checks") { const c = /^(\w+)\b[\s—–:-]*(.*)$/.exec(val); if (c) out.checks = { state: c[1].toLowerCase(), text: c[2].trim() }; }
      // "Reviewed: 4ad8528 final review — 9 findings, all fixed", repeatable (claims.js reviewedLine).
      else if (key === "reviewed") { const x = parseReviewed(val); if (x) out.reviewed.push(x); }
      continue;
    }
    if (key === "tier") cur.tier = proofOf(val)?.tier ?? null;
    else if (key === "checked") cur.checked = val;
    else if (key === "files") cur.files = parseFiles(val);
    else if (key === "result") {
      const r = /^(pass|fail|partial|pending)\b[\s—–:-]*(.*)$/i.exec(val);
      if (r) { cur.result = r[1].toLowerCase(); cur.why = r[2].trim(); }
    }
  }
  return out;
}

// A `Reviewed:` value: "<sha> <which review> — <result>" → {sha, what, result}, null without a
// hex sha first. The result may be empty.
export function parseReviewed(val) {
  const m = /^`?([0-9a-f]{4,40})`?\s+(.*)$/i.exec(val.trim());
  if (!m) return null;
  const [what, ...rest] = m[2].split(/\s+[—–]\s+/);
  return { sha: m[1].toLowerCase(), what: what.trim(), result: rest.join(" — ").trim() };
}

// One line of a claim's section into `e` (emptyClaim()). `Shot:` and `Clip:` take one path or
// several, comma-separated; `Test: <name> — pass|fail[ <anything>]` is one test, its status the
// first word after the last " — " ("— fail: assertion at line 3" fails), else it passed.
function claimLine(e, key, val) {
  if (key === "result") {
    const r = /^(pass|fail|partial|pending)\b[\s—–:-]*(.*)$/i.exec(val);
    if (r) { e.result = r[1].toLowerCase(); e.why = r[2].trim(); }
  } else if (key === "shot") e.shots.push(...parseFiles(val));
  else if (key === "clip") e.clips.push(...parseFiles(val));
  else if (key === "test") {
    const t = /^(.*)\s[—–-]\s*(pass(?:ed)?|ok|✓|fail(?:ed|s)?|✗)(?=$|[\s:(,;.—–-])/i.exec(val);
    const name = (t ? t[1] : val).trim();
    if (name) e.tests.push({ name, ok: !t || !/^(fail|✗)/i.test(t[2]) });
  }
}

// Whether a task's stage (tasks.js taskStage, data.js shownStage) is one whose proof is still being
// gathered: planned, implementing, in review or fixing; not done, blocked or a stage named by none.
const GATHERING = new Set(["planned", "implement", "review", "fix"]);
export const gatheringStage = (stage) => GATHERING.has(stage);

// proof-accepted.json → { <claim id>: {at, result} }, the entries that hold one; anything else
// (missing, broken) is {}. For showing: a broken file accepts nothing.
export function parseAccepted(text) {
  let v;
  try { v = acceptedFile(text); } catch { return {}; }
  return Object.fromEntries(Object.entries(v).filter(([, e]) => e && typeof e.result === "string"));
}

// proof-accepted.json as written, for changing it: {} when empty or missing; throws when it
// holds something that is not a JSON object, so a hand-edited file is never overwritten.
export function acceptedFile(text) {
  if (!(text ?? "").trim()) return {};
  const v = JSON.parse(text);
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not a JSON object");
  return v;
}

// The file after accepting (entry) or unaccepting (null) one claim, as the text to write. Other
// entries, and other fields of this one, are kept as they are.
export function withAcceptance(file, id, entry) {
  const out = { ...file };
  if (entry) out[id] = { ...(out[id] && typeof out[id] === "object" ? out[id] : {}), ...entry }; else delete out[id];
  return `${JSON.stringify(out, null, 2)}\n`;
}

// The first line of an Ask to prove (claims.js claimProveRequest), "prove C2 to T2: <result
// line>", which the orchestrator acts on and pendingProofs() finds.
export const PROVE = /^prove (\S+?)(?: to T([0-3]))?: (.*)$/;

// The asks still waiting: the first lines of the run's unhandled inbox messages (data.js), oldest
// first → Map(claim id → the result line asked about). A claim reads "asked…" only while its result
// line is still that one (claims.js claimRows), and not once the message is renamed .handled.
export function pendingProofs(lines) {
  const out = new Map();
  for (const line of (lines ?? "").split("\n")) {
    const m = PROVE.exec(line.trim());
    if (m) out.set(m[1], m[3]);
  }
  return out;
}

// Whether the proof with signature `sig` was read: `seen` is what was stored when the user last
// opened it. No proof (an empty signature) is never read.
export const proofRead = (seen, sig) => Boolean(sig) && seen === sig;

