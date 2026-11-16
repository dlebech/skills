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
  "passing tests, their output for the changed behaviour, screenshots or a recording, and a guided demo",
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
