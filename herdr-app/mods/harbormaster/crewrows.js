// How the Crew block shows each orchestrator's attention (attention.js assess): its group
// (Needs you, Working, Waiting on others, Can't tell, Done), its place in it, the words that lead its detail line,
// their colour, and its hover. Pure, so the tests drive it; overview.js crew() draws it.

import { byWait, nextStepText, stepText, ageText, reviewWaitText, FINISHED_LABEL } from "./attention.js";
import { commentLines, commentsText, hasComments } from "./comments.js";

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

// Why a run can't be told, in two or three words for a row: its machine, its files, or GitHub.
export function cantWhy(a) {
  const why = a?.why ?? "";
  if (/machine/.test(why)) return "machine offline";
  if (/run files/.test(why)) return "no run files";
  if (/not read yet/.test(why)) return "PRs not read yet";
  return "GitHub unreadable";
}

// The start of a row's detail line: {lead, rest, tone}. `lead` comes first, so a narrow
// sidebar keeps it, `rest` after it (null for none). Tone is a colour name: "blocked" (red),
// "amber", "dim" (grey, can't tell) or "muted".
//   Needs you: its reasons and how long the longest has waited ("approved — merge · 2 PRs · 1h");
//     a stalled run says what it was doing ("quiet 34m", then "t3 implementing"), its quiet
//     time being its age.
//   Working: the step and its own age ("CI on #42 · 34m", "t3 implementing 1h12m · +1 task");
//     for a briefly idle run too, so the age shows how quiet it is.
//   Waiting on others: the label ("review from anna"), then the step.
//   Can't tell: "can't tell: machine offline", grey.
//   Done: the label ("merged — close run · 2 PRs"), or "closed".
// `narrow` (the sidebar): a label without its comment count ("approved · 2 PRs · 1h25m"), so
// the age survives the truncation; the hover, the pill and the need box keep the count.
export function rowLead(a, now = Date.now(), { narrow = false } = {}) {
  const step = stepText(a.step, now) || null;
  if (a.group === "needs") {
    const why = a.reasons.map((r) => (narrow && r.short) || r.text).join(" · ");
    const waited = !onlyStalled(a) && a.waitSince ? ageText(now - a.waitSince) : null;
    return { lead: waited ? `${why} · ${waited}` : why, rest: a.stall ? a.step?.text || null : null, tone: onlyStalled(a) ? "amber" : "blocked" };
  }
  if (a.group === "done") return { lead: a.next ? nextStepText(a.next) : "closed", rest: null, tone: "muted" };
  if (a.group === "cant" || a.cantTell) return { lead: `can't tell: ${cantWhy(a)}`, rest: null, tone: "dim" };
  if (a.group === "waiting") return { lead: a.reasons[0]?.text ?? (a.next ? nextStepText(a.next) : "waiting"), rest: step, tone: "muted" };
  return { lead: step ?? a.reasons[0]?.text ?? (a.next ? nextStepText(a.next) : null) ?? "idle", rest: null, tone: "muted" };
}

// A row's edge colour name, one meaning each: red ("blocked") for Needs you, you must act;
// amber when it has only stalled, look soon; "review" (cyan) for Waiting on others; done's
// colour for Done; grey for Can't tell. Working is "neutral", whether its agents work, CI runs
// or it is briefly idle: fine needs no colour, and the row's spinner says it works.
export function rowEdge(a) {
  if (a.group === "needs") return onlyStalled(a) ? "amber" : "blocked";
  if (a.group === "done") return "done";
  if (a.group === "cant" || a.cantTell) return "dim";
  if (a.group === "waiting") return "review";
  return "neutral";
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
  // Who said what on its approved or changes-requested PRs, one line each.
  if (a.group !== "done" && a.next?.comments && (hasComments(a.next.comments) || a.next.comments.unknown)) lines.push(...reviewCommentLines(a.next));
  if (a.cantTell) lines.push(`Can't tell${a.group === "needs" ? " its pull requests" : ""}: ${a.why ?? "its state could not be read"}`);
  if (a.step?.text && a.group !== "done") lines.push(`Current step: ${a.step.text}${a.step.since ? `, for ${ageText(now - a.step.since)}` : ""}${a.step.more > 0 ? ` (${a.step.more} more ${a.step.more === 1 ? "task" : "tasks"} at work)` : ""}`);
  return lines;
}

// The review comments of a next step, for a hover: a heading, then who said what ("mfalkenbrink
// on src/x.ts:42: …"), or [] without any.
export function reviewCommentLines(next) {
  const c = next?.comments;
  if (!c || (!hasComments(c) && !c.unknown)) return [];
  const head = c.unknown && !hasComments(c) ? "Review comments: could not be read"
    : `Review comments (${commentsText({ ...c, unknown: false }) ?? "unknown"}${c.unknown ? ", some could not be read" : ""}):`;
  return [head, ...commentLines(c.prs).map((l) => `  ${l}`)];
}

// The reason a Needs-you run's pill names: the first one the Crew row leads with, past a question
// (its own box says what is asked, and its title is too long for a pill). Null for none.
export const pillReason = (a) => (a?.group === "needs" ? a.reasons.find((r) => r.key !== "question") ?? null : null);

// A run card's pill when it should say what comes next, as the Crew does: {label, tone} for
// a run with a next-step label that is in Needs you (red) or Done (done's colour), a finished
// run with no PR (finished — read and close, red), or that is finished (`finished`: its phase),
// in a neutral colour, since a label beats "Finished"; else null (the card keeps its phase:
// running, parked, closed…). In Needs you it says what the Crew row leads with (pillReason):
// "red CI on #42" over a run whose label is review proof, never a step the box puts second.
export function badgeOf(a, finished = false) {
  // A finished run with no PR has no PR label: its own reason is the pill.
  if (!a?.next && a?.group === "needs" && a.reasons.some((r) => r.key === "finished")) return { label: FINISHED_LABEL, tone: "blocked" };
  if (!a?.next) return null;
  const tone = a.group === "needs" ? "blocked" : a.group === "done" ? "done" : finished ? "muted" : null;
  // With review comments, a `tip` saying who said what.
  const tip = reviewCommentLines(a.next).join("\n");
  const label = pillReason(a)?.text ?? nextStepText(a.next);
  return tone ? { label, tone, ...(tip ? { tip } : {}) } : null;
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

// The line an empty group shows in its place, or null: only a group with an `empty` text, only
// while there are orchestrators (`total` rows in all; none keeps the Crew's own empty text),
// and only when nothing counts in it: `count` is needCount for Needs you (the captain's open
// decisions too), the list's length for any other group.
export const emptyNote = (g, count, total) => (g.empty && !count && total > 0 ? g.empty : null);

// ---- one Needs you for every view ----

// Whether a run needs you, given its attention `a`: in Needs you and not put away (a parked or
// closed run's PRs may wait on you, but it is not counted). attend.js needsYouNow is this.
export const needsRun = (r, a) => !r.away && a.group === "needs";

// The runs that need you, for the overview's cards and header and the Crew alike; `attOf(run)`
// gives a run's attention.
export const needRunsOf = (runs, attOf) => runs.filter((r) => needsRun(r, attOf(r)));

// The Crew's rows, with its Needs you made the overview's set (attend.js needsYouNow), so the
// two never disagree. `orchs`: a row ({term, r, a}) per live orchestrator, `r` its run or null;
// `needRuns`: the runs the overview counts as needing you. A run there whose orchestrator has
// no row (gone, or on a machine that did not answer) gets one of its own, {term: null, r, a},
// `attOf(run)` giving its attention. An orchestrator's row in Needs you that the overview does
// not count (its run is parked or closed) shows its step under Working instead.
export function crewEntries(orchs, needRuns, attOf) {
  const need = new Set(needRuns);
  const seen = new Set(orchs.map((x) => x.r).filter(Boolean));
  const rows = orchs.map((x) => (x.r && x.a?.group === "needs" && !need.has(x.r) ? { ...x, a: { ...x.a, group: "working" } } : x));
  for (const r of needRuns) if (!seen.has(r)) rows.push({ term: null, r, a: attOf(r) });
  return rows;
}

// Orchestrators without a run directory that need you (blocked on a dialog): the overview has
// no run for them, so it adds these to its count.
export const runlessNeeds = (orchs) => orchs.filter((x) => !x.r && x.a?.group === "needs");

// How many things need you, for the overview's header and the Crew's Needs you heading alike:
// the runs that need you, orchestrators without a run blocked on a dialog, and the captain's
// open decisions.
export const needCount = (needRuns, orchs, decisions) => needRuns.length + runlessNeeds(orchs).length + decisions;

// The line under Needs you while the captain has open decisions: they count in the heading,
// and the captain's own row (above, where it always is) is where to answer them.
export const captainNeedNote = (decisions) => (decisions > 0 ? `+ the captain's ${decisions === 1 ? "decision" : `${decisions} decisions`}, above` : null);

// What the captain's row says it watches, from stats(): "watching 2 runs · 1 finished", every
// run it keeps an eye on (running and finished but open), then how many of them are finished.
export function watchingText(live, docked) {
  const n = live + docked;
  return `watching ${n} run${n === 1 ? "" : "s"}${docked ? ` · ${docked} finished` : ""}`;
}
