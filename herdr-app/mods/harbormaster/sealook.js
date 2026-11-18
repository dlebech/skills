// What the sea (harbor.js) decides in plain data, kept apart from gpui so it can be tested:
// how a path stage looks as a buoy, the captain's state in words, the rail's counts, and which
// need-button kinds open the run's pane as a popup instead of acting in the reef.

// A path stage's buoy: `fill` and `ring` are theme colour names ("pass", "amber", "blocked",
// "foreground", "dim"). Done is filled green, current a ring, you red (pulsing when `motion`,
// else still with a `halo`: a 2 px red ring around the dot), look amber, fail red and still, todo a dim ring.
export function buoyLook(state, motion = false) {
  switch (state) {
    case "done": return { fill: "pass", ring: null, pulse: false, halo: false };
    case "current": return { fill: null, ring: "foreground", pulse: false, halo: false };
    case "you": return { fill: "blocked", ring: null, pulse: motion, halo: !motion };
    case "look": return { fill: "amber", ring: null, pulse: false, halo: false };
    case "fail": return { fill: "blocked", ring: null, pulse: false, halo: false };
    default: return { fill: null, ring: "dim", pulse: false, halo: false };
  }
}

// A creature that is blocked, without motion: raised 4 px with a small red "!" badge.
export const stillLook = (status) => ({ raise: status === "blocked" ? 4 : 0, badge: status === "blocked" });

// The one place a loop is started: `idle(el, id, spec, motion)`. Without `motion` (or a spec) the
// element comes back untouched, so a sea with motion off holds no loop. spec: {prop, to, period}.
export function idle(el, id, spec, motion) {
  if (!motion || !spec) return el;
  return el.id(id).loop(spec.prop, { from: spec.from ?? 0, to: spec.to, period: spec.period });
}

// The captain's state in plain words, for the boat's tooltip.
export function captainText({ present, watching, working }) {
  if (!present) return "No captain is running";
  if (!watching) return "Captain: not watching";
  return working ? "Captain: working" : "Captain: watching";
}

const noun = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The boat's badge: how many things need you (captain decisions, then runs) and the tooltip
// listing them. `count` 0 means no badge.
export function boatBadge({ decisions, runNames }) {
  const count = decisions + runNames.length;
  const head = decisions > 0 ? noun(decisions, "decision") : null;
  const lines = [head, ...runNames].filter(Boolean);
  return { count, tip: lines.join("\n") };
}

// The rail's right side: "3 runs", "2 need you" (tone "blocked" when any), "1 PR open".
export function railCounts({ runs, needs, prs }) {
  return [
    { text: noun(runs, "run"), tone: null },
    { text: `${needs} need${needs === 1 ? "s" : ""} you`, tone: needs > 0 ? "blocked" : null },
    { text: `${noun(prs, "PR")} open`, tone: null },
  ];
}

// Need-button kinds whose picker or confirm needs more room than a reef has: the button opens
// the run's pane as a popup instead.
const POPUP_KINDS = new Set(["request-review", "changes", "close", "resume"]);
export const opensPopup = (kind) => POPUP_KINDS.has(kind);

// The creatures' motion: [prop, from, to, period] for a working octopus or crab, a blocked one,
// else null (done and idle stay still).
export function motionOf(kind, status) {
  if (status === "blocked") return { prop: "top", to: -5, period: 700 };
  if (status !== "working") return null;
  return kind === "octopus" ? { prop: "top", to: -3, period: 1500 } : { prop: "left", to: 5, period: 900 };
}

// The count badge's text: white on the red badge, in any theme.
export const BADGE_TEXT = "#ffffff";
