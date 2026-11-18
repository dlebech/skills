// What a run's header tags mean, as definitions: its autonomy level, proof tier and type. They
// are labels of what the run is, so their hovers read "Proof tier T2 — proved with …", never like a
// status ("tests green"). No herdr imports, so it can be run under plain node.

// What each tier asks for, after "proved with". The source is the tier table in
// skills/proving/SKILL.md (each row stands alone); tests/herdr-app-harbormaster/tiers.sh and
// levels.test.mjs fail when these differ from it, so change both together.
export const TIER_TEXT = [
  "passing tests (CI, or the repo's local suite)",
  "passing tests and their output for the changed behaviour",
  "passing tests, their output for the changed behaviour, and screenshots or a recording",
  "passing tests, their output for the changed behaviour, screenshots or a recording, and a guided demo where one can be recorded",
];

// "Proof tier T2 — proved with passing tests, …"
export const tierTip = (tier) => (TIER_TEXT[tier] ? `Proof tier T${tier} — proved with ${TIER_TEXT[tier]}` : `Proof tier T${tier}`);

// What each autonomy level (set-status.sh --autonomy) lets the orchestrator do, from spec's L0–L2.
export const AUTONOMY = {
  L0: "you approve its decisions; it stops and asks before each one",
  L1: "decides small things itself and logs them; stops only for direction and design calls",
  L2: "runs to a merge-ready PR with proof on its own; stops only at merge",
};

// "Autonomy L1 — decides small things itself …"
export const autonomyTip = (level) => (AUTONOMY[level] ? `Autonomy ${level} — ${AUTONOMY[level]}` : `Autonomy ${level}`);

// "Run type: review — the kind of work this run does"
export const typeTip = (type) => `Run type: ${type} — the kind of work this run does (set-status.sh --type)`;

// ---- changing a level from its tag ----
// Hovering an autonomy or tier tag lists every level; clicking another one asks the orchestrator
// to change it, with a message in the run's inbox (run-files.md). Harbormaster never writes
// status.json or plan.md itself: the orchestrator owns them, and applies the change there.

// Every level of a kind, for the tag's popover: {level, label, text, current, pending}.
// `current` is the run's level ("L1", or a tier number), `pending` the one asked for, or null.
export function levelChoices(kind, current, pending = null) {
  const all = kind === "autonomy"
    ? Object.keys(AUTONOMY).map((l) => ({ level: l, label: l, text: AUTONOMY[l] }))
    : TIER_TEXT.map((text, i) => ({ level: i, label: `T${i}`, text: `proved with ${text}` }));
  return all.map((c) => ({ ...c, current: c.level === current, pending: c.level === pending && c.level !== current }));
}

// The first line of a level request, which the orchestrator acts on and pendingLevels() finds:
// "set autonomy to L2", "set proof tier to T2".
const REQUEST = /^set (autonomy|proof tier) to (L[0-2]|T[0-3])\s*$/;
export const requestLine = (kind, level) => (kind === "autonomy" ? `set autonomy to ${level}` : `set proof tier to T${level}`);

// The level request message lives in inbox.js; re-exported so imports keep working.
export { levelRequest } from "./inbox.js";

// The levels asked for and not applied yet: `lines` are the request lines found in the run's
// unhandled inbox messages (data.js), oldest first, so the latest of each kind wins. A request
// stops being pending once status.json (autonomy) or plan.md (tier) shows that level, or once
// the orchestrator renames its message to .handled (it then is no longer among `lines`).
// → {autonomy: "L2" | null, tier: 2 | null}.
export function pendingLevels(lines, { autonomy = null, tier = null } = {}) {
  const out = { autonomy: null, tier: null };
  for (const line of (lines ?? "").split("\n")) {
    const m = REQUEST.exec(line.trim());
    if (!m) continue;
    if (m[1] === "autonomy") out.autonomy = m[2];
    else out.tier = Number(m[2].slice(1));
  }
  if (out.autonomy === autonomy) out.autonomy = null;
  if (out.tier === tier) out.tier = null;
  return out;
}
