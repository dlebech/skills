// How the Crew block shows each orchestrator's attention (attention.js assess): its group
// (Needs you, Working, Waiting on others, Can't tell, Done), its place in it, the words that lead its detail line,
// their colour, and its hover. Pure, so the tests drive it; overview.js crew() draws it.

import { byWait, nextStepText, stepText, ageText, reviewWaitText, FINISHED_LABEL } from "./attention.js";

// The groups, in the order the Crew shows them: what you must act on, what is at work, what
// waits on someone else (a reviewer), what can't be read (grey, so it is never mixed into
// another group) and Done, folded until clicked open. An empty group is not shown, except
// Needs you while there are orchestrators: it then says so (`empty`), so a glance tells
// "nothing for you" from "not looked yet".
export const GROUPS = [
  { key: "needs", title: "Needs you", empty: "nothing for you right now 🎉" },
  { key: "working", title: "Working" },
  { key: "waiting", title: "Waiting on others" },
  { key: "cant", title: "Can't tell" },
  { key: "done", title: "Done", folded: true },
];

// Rows ({a: assess result, ...}) by group, each longest wait first. A row without a result
// can't be told.
export function groupRows(rows) {
  const out = Object.fromEntries(GROUPS.map((g) => [g.key, []]));
  for (const x of rows) (out[x.a?.group] ?? out.cant).push(x);
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
//   Working: the step and its age ("CI on #42 · 34m", "t3 implementing · 1h12m"); for a
//     briefly idle run too, so the age shows how quiet it is.
//   Waiting on others: the label ("review from anna"), then the step.
//   Can't tell: "can't tell", grey.
//   Done: the label ("merged — close run · 2 PRs"), or "closed".
export function rowLead(a, now = Date.now()) {
  const step = stepText(a.step, now) || null;
  if (a.group === "needs") {
    const lead = a.reasons.map((r) => r.text).join(" · ");
    return { lead, rest: a.stall ? a.step?.text || null : null, tone: onlyStalled(a) ? "amber" : "blocked" };
  }
  if (a.group === "done") return { lead: a.next ? nextStepText(a.next) : "closed", rest: null, tone: "muted" };
  if (a.group === "cant" || a.cantTell) return { lead: "can't tell", rest: null, tone: "dim" };
  if (a.group === "waiting") return { lead: a.reasons[0]?.text ?? (a.next ? nextStepText(a.next) : "waiting"), rest: step, tone: "muted" };
  return { lead: step ?? a.reasons[0]?.text ?? (a.next ? nextStepText(a.next) : null) ?? "idle", rest: null, tone: "muted" };
}

// A row's edge colour name: red for Needs you (amber when it has only stalled), done's colour
// for Done, grey for Can't tell, "review" (a calm colour of its own) for Waiting on others.
// Working: working's colour only while agents work or CI runs, "neutral" for a run briefly
// idle, so colour always means something.
export function rowEdge(a) {
  if (a.group === "needs") return onlyStalled(a) ? "amber" : "blocked";
  if (a.group === "done") return "done";
  if (a.group === "cant" || a.cantTell) return "dim";
  if (a.group === "waiting") return "review";
  const key = a.reasons?.[0]?.key;
  return key === "working" || key === "ci-running" ? "working" : "neutral";
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const since = (at, now) => (at ? `, since ${ageText(now - at)} ago` : "");

// The hover's lines, in plain words: why the row is in its group and since when, why its
// state can't be read, and its current step with its age.
export function rowTip(a, now = Date.now()) {
  const lines = [];
  if (a.group === "needs") lines.push(...a.reasons.map((r) => `Needs you: ${r.text}${since(r.since, now)}`));
  else if (a.group === "done") lines.push(a.next ? `Done: every pull request merged or closed (${nextStepText(a.next)})` : "Done: the run is closed");
  else lines.push(...a.reasons.filter((r) => r.key !== "cant-tell").map((r) => `${(r.key === "waiting-for" && reviewWaitText(a.next)) || cap(r.text)}${since(r.since, now)}`));
  if (a.cantTell) lines.push(`Can't tell${a.group === "needs" ? " its pull requests" : ""}: ${a.why ?? "its state could not be read"}`);
  if (a.step?.text && a.group !== "done") lines.push(`Current step: ${a.step.text}${a.step.since ? `, for ${ageText(now - a.step.since)}` : ""}`);
  return lines;
}

// A run card's pill when it should say what comes next, as the Crew does: {label, tone} for
// a run with a next-step label that is in Needs you (red) or Done (done's colour), a finished
// run with no PR (finished — read and close, red), or that is finished (`finished`: its phase), in a neutral colour, since a label beats "Finished";
// else null (the card keeps its phase: running, parked, closed…).
export function badgeOf(a, finished = false) {
  // A finished run with no PR has no PR label: its own reason is the pill.
  if (!a?.next && a?.group === "needs" && a.reasons.some((r) => r.key === "finished")) return { label: FINISHED_LABEL, tone: "blocked" };
  if (!a?.next) return null;
  const tone = a.group === "needs" ? "blocked" : a.group === "done" ? "done" : finished ? "muted" : null;
  return tone ? { label: nextStepText(a.next), tone } : null;
}

// Why a run is in Needs you, in one line ("red CI on #42 · review proof → merge"), or null.
export const needLine = (a) => (a?.group === "needs" ? a.reasons.map((r) => r.text).join(" · ") || null : null);

// The runs Close all merged closes, from the Done group's rows ({r, a}): runs with a directory,
// not already parked or closed, finished (closing a running run would end it mid-run), with no
// open question, and Done because every PR is merged or closed (a label; a run Done because it
// is closed has none). `busy`: run keys an action is already under way on, left to it.
export function closableDone(rows, busy = {}) {
  return rows.filter((x) => x.a?.group === "done" && x.a.next && x.r?.dir && x.r.phase === "finished" && !x.r.away && !x.r.question && !busy[x.r.key]).map((x) => x.r);
}

// The line an empty group shows in its place, or null: only a group with an `empty` text, and
// only while there are orchestrators (`total` rows in all; none keeps the Crew's own empty text).
export const emptyNote = (g, list, total) => (g.empty && !list.length && total > 0 ? g.empty : null);
