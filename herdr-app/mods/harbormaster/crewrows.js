// How the Crew block shows each orchestrator's attention (attention.js assess): its group
// (Needs you, Everything else, Done), its place in it, the words that lead its detail line,
// their colour, and its hover. Pure, so the tests drive it; overview.js crew() draws it.

import { byWait, nextStepText, stepText, ageText } from "./attention.js";

// The groups, in the order the Crew shows them. Done is folded until clicked open.
export const GROUPS = [
  { key: "needs", title: "Needs you" },
  { key: "else", title: "Everything else" },
  { key: "done", title: "Done", folded: true },
];

// Rows ({a: assess result, ...}) by group, each longest wait first. A row without a result
// goes under Everything else.
export function groupRows(rows) {
  const out = { needs: [], else: [], done: [] };
  for (const x of rows) (out[x.a?.group] ?? out.else).push(x);
  for (const list of Object.values(out)) list.sort((x, y) => byWait(x.a ?? {}, y.a ?? {}));
  return out;
}

// Only stalled: what waits on the user is a nudge, not a decision, so amber, not red.
const onlyStalled = (a) => Boolean(a.stall) && a.reasons.length > 0 && a.reasons.every((r) => r.key === "stalled");

// The start of a row's detail line: {lead, rest, tone}. `lead` comes first (before when the
// run started, so a narrow sidebar keeps it), `rest` after it (null for none). Tone is a
// colour name: "blocked" (red), "amber", "dim" (grey, can't tell) or "muted".
//   Needs you: its reasons ("red CI on #42 · review proof → merge"); a stalled run says
//     what it was doing ("quiet 34m", then "t3 implementing").
//   Everything else: can't tell; while agents work or CI runs, the step and its age
//     ("CI on #42 · 34m"); waiting on a reviewer, the label ("waiting for anna"), then the
//     step; otherwise the next-step label, else the step.
//   Done: the label ("merged — close run · 2 PRs"), or "closed".
export function rowLead(a, now = Date.now()) {
  const step = stepText(a.step, now) || null;
  if (a.group === "needs") {
    const lead = a.reasons.map((r) => r.text).join(" · ");
    return { lead, rest: a.stall ? a.step?.text || null : null, tone: onlyStalled(a) ? "amber" : "blocked" };
  }
  if (a.group === "done") return { lead: a.next ? nextStepText(a.next) : "closed", rest: null, tone: "muted" };
  if (a.cantTell) return { lead: "can't tell", rest: null, tone: "dim" };
  const key = a.reasons[0]?.key;
  if (key === "working" || key === "ci-running") return { lead: step ?? a.reasons[0].text, rest: null, tone: "muted" };
  if (key === "waiting-for") return { lead: a.reasons[0].text, rest: step, tone: "muted" };
  return { lead: (a.next ? nextStepText(a.next) : null) ?? step ?? "idle", rest: null, tone: "muted" };
}

// A row's edge colour name: red for Needs you (amber when it has only stalled), grey when
// the state can't be read, done's colour for Done, working's otherwise.
export function rowEdge(a) {
  if (a.group === "needs") return onlyStalled(a) ? "amber" : "blocked";
  if (a.group === "done") return "done";
  return a.cantTell ? "dim" : "working";
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const since = (at, now) => (at ? `, since ${ageText(now - at)} ago` : "");

// The hover's lines, in plain words: why the row is in its group and since when, why its
// state can't be read, and its current step with its age.
export function rowTip(a, now = Date.now()) {
  const lines = [];
  if (a.group === "needs") lines.push(...a.reasons.map((r) => `Needs you: ${r.text}${since(r.since, now)}`));
  else if (a.group === "done") lines.push(a.next ? `Done: every pull request merged or closed (${nextStepText(a.next)})` : "Done: the run is closed");
  else lines.push(...a.reasons.filter((r) => r.key !== "cant-tell").map((r) => `${cap(r.text)}${since(r.since, now)}`));
  if (a.cantTell) lines.push(`Can't tell${a.group === "needs" ? " its pull requests" : ""}: ${a.why ?? "its state could not be read"}`);
  if (a.step?.text && a.group !== "done") lines.push(`Current step: ${a.step.text}${a.step.since ? `, for ${ageText(now - a.step.since)}` : ""}`);
  return lines;
}

// A run card's pill when it should say what comes next, as the Crew does: {label, tone} for
// a run in Needs you (red) or Done (done's colour) with a next-step label, else null (the
// card keeps its phase: running, parked, closed…).
export function badgeOf(a) {
  if (!a?.next || (a.group !== "needs" && a.group !== "done")) return null;
  return { label: nextStepText(a.next), tone: a.group === "needs" ? "blocked" : "done" };
}

// Why a run is in Needs you, in one line ("red CI on #42 · review proof → merge"), or null.
export const needLine = (a) => (a?.group === "needs" ? a.reasons.map((r) => r.text).join(" · ") || null : null);
