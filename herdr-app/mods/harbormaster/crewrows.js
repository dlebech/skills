// How the Crew block shows each orchestrator's attention (attention.js assess): its group
// (Needs you, Working, Waiting on others, Can't tell, Done), its place in it, the words that lead its detail line,
// their colour, and its hover. Pure, so the tests drive it; crew.js draws it.

import { byWait, nextStepText, stepText, ageText, reviewWaitText, FINISHED_LABEL } from "./attention.js";
import { ORDER as REASON_ORDER } from "./needaction.js";
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

// Rows ({a: assess result, ...}) by group, each longest wait first (Needs you: byNeed, below). A row without a result
// can't be told.
export function groupRows(rows) {
  const out = Object.fromEntries(GROUPS.map((g) => [g.key, []]));
  for (const x of rows) (out[x.a?.group] ?? out.cant).push(x);
  for (const [key, list] of Object.entries(out)) if (key !== "needs") list.sort((x, y) => byWait(x.a ?? {}, y.a ?? {}));
  out.needs = out.needs.map((x) => [importance(x.a), x]).sort((p, q) => byNeed(p[1], q[1], p[0], q[0])).map((p) => p[1]);
  return out;
}

// How important a Needs-you run is: its most urgent reason's place in needaction.js ORDER (0 first).
export const importance = (a) => Math.min(REASON_ORDER.length, ...(a?.reasons ?? []).map((r) => { const i = REASON_ORDER.indexOf(r.key); return i < 0 ? REASON_ORDER.length : i; }));

// Needs-you order, which only real changes move: most important first, then longest waiting,
// then by key so equals never swap. Nothing about which entry is open, seen or hovered is in it.
export function byNeed(x, y, ix = importance(x.a), iy = importance(y.a)) {
  const i = ix - iy;
  if (i) return i;
  const w = (x.a?.waitSince ?? Infinity) === (y.a?.waitSince ?? Infinity) ? 0 : (x.a?.waitSince ?? Infinity) < (y.a?.waitSince ?? Infinity) ? -1 : 1;
  if (w) return w;
  const kx = String(needKey(x)), ky = String(needKey(y));
  return kx < ky ? -1 : kx > ky ? 1 : 0;
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
//   Waiting on others: the label ("review from anna"), then the step; a run the user marked
//     waiting on someone says on whom and since when ("waiting on Kari — preview check · 2h").
//   Can't tell: "can't tell: machine offline", grey.
//   Done: the label ("merged — close run · 2 PRs"), or "closed".
// `narrow` (the sidebar): a label without its comment count ("approved · 2 PRs · 1h25m"), so
// the age survives the truncation; the hover, the pill and the need box keep the count.
// A run that is ready to merge and waits on nothing else: green, the one good-news row in Needs you.
export const readyAlone = (a) => Boolean(a?.ready) && a.reasons.length === 1;

export function rowLead(a, now = Date.now(), { narrow = false } = {}) {
  const step = stepText(a.step, now) || null;
  if (a.group === "needs") {
    const why = a.reasons.map((r) => (narrow && r.short) || r.text).join(" · ");
    const waited = !onlyStalled(a) && a.waitSince ? ageText(now - a.waitSince) : null;
    // A run that is ready to merge reads in the pass colour: it is the user's to merge, but it is good news.
    return { lead: waited ? `${why} · ${waited}` : why, rest: a.stall ? a.step?.text || null : null, tone: readyAlone(a) ? "pass" : onlyStalled(a) ? "amber" : "blocked" };
  }
  if (a.group === "done") return { lead: a.next ? nextStepText(a.next) : "closed", rest: null, tone: "muted" };
  if (a.group === "cant" || a.cantTell) return { lead: `can't tell: ${cantWhy(a)}`, rest: null, tone: "dim" };
  if (a.group === "waiting" && a.waitingOn) {
    const w = a.reasons[0];
    return { lead: w.since ? `${w.text} · ${ageText(now - w.since)}` : w.text, rest: step, tone: "muted" };
  }
  if (a.group === "waiting") return { lead: a.reasons[0]?.text ?? (a.next ? nextStepText(a.next) : "waiting"), rest: step, tone: "muted" };
  return { lead: step ?? a.reasons[0]?.text ?? (a.next ? nextStepText(a.next) : null) ?? "idle", rest: null, tone: "muted" };
}

// A row's edge colour name, one meaning each: red ("blocked") for Needs you, you must act;
// green ("pass") for a run ready to merge: everything is done, the merge is yours;
// amber when it has only stalled, look soon; "review" (cyan) for Waiting on others; done's
// colour for Done; grey for Can't tell. Working is "neutral", whether its agents work, CI runs
// or it is briefly idle: fine needs no colour, and the row's spinner says it works.
export function rowEdge(a) {
  if (a.group === "needs") return readyAlone(a) ? "pass" : onlyStalled(a) ? "amber" : "blocked";
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

// The review comments of a next step, for a hover: a heading, then who said what ("kim
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
  const own = !a?.next && a?.group === "needs" ? a.reasons.find((r) => r.key === "finished" || r.key === "review-pending") : null;
  if (own) return { label: own.text, tone: "blocked" };
  if (!a?.next) return null;
  const tone = a.group === "needs" ? "blocked" : a.group === "done" ? "done" : finished ? "muted" : null;
  // With review comments, a `tip` saying who said what.
  const tip = reviewCommentLines(a.next).join("\n");
  // Marked waiting on someone: the pill says on whom, not the step it was marked on.
  const label = pillReason(a)?.text ?? (a.waitingOn ? `waiting on ${a.waitingOn.text}` : nextStepText(a.next));
  return tone ? { label, tone, ...(a.ready && a.group === "needs" ? { ready: true } : {}), ...(tip ? { tip } : {}) } : null;
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
// The Needs-you card's look for "its orchestrator's terminal is the selected one": colour
// suffixes to add to the edge colour (tint, border; "00" is fully transparent, so the 1 px border
// keeps its width and nothing shifts) and the left bar's width. Hover on an unselected card: HOVER_TINT.
export const HOVER_TINT = "2e";
export const needCardLook = (selected) => (selected ? { tint: "3d", border: "", bar: 5 } : { tint: "22", border: "00", bar: 3 });

export const needsRun = (r, a) => !r.away && a.group === "needs";

// The runs that need you, for the Bridge's cards and header and the Crew alike; `attOf(run)`
// gives a run's attention.
export const needRunsOf = (runs, attOf) => runs.filter((r) => needsRun(r, attOf(r)));

// The Crew's rows, with its Needs you made the Bridge's set (attend.js needsYouNow), so the
// two never disagree. `orchs`: a row ({term, r, a}) per live orchestrator, `r` its run or null;
// `needRuns`: the runs the Bridge counts as needing you. A run there whose orchestrator has
// no row (gone, or on a machine that did not answer) gets one of its own, {term: null, r, a},
// `attOf(run)` giving its attention. An orchestrator's row in Needs you that the Bridge does
// not count (its run is parked or closed) shows its step under Working instead.
export function crewEntries(orchs, needRuns, attOf) {
  const need = new Set(needRuns);
  const seen = new Set(orchs.map((x) => x.r).filter(Boolean));
  const rows = orchs.map((x) => (x.r && x.a?.group === "needs" && !need.has(x.r) ? { ...x, a: { ...x.a, group: "working" } } : x));
  for (const r of needRuns) if (!seen.has(r)) rows.push({ term: null, r, a: attOf(r) });
  return rows;
}

// A Needs-you entry's key: its run's, else its orchestrator's address (no run directory).
export const needKey = (x) => x.r?.key ?? x.term?.address ?? null;

// Whether a Needs-you entry can be drawn as the sidebar's box: only with a run directory; the rest stay
// compact rows (queue.js expandedItem picks the open one).
export const canExpand = (x) => Boolean(x.r?.dir);

// Orchestrators without a run directory that need you (blocked on a dialog): the Bridge has
// no run for them, so it adds these to its count.
export const runlessNeeds = (orchs) => orchs.filter((x) => !x.r && x.a?.group === "needs");

// How many things need you, for the Bridge's header and the Crew's Needs you heading alike:
// the runs that need you, orchestrators without a run blocked on a dialog, and the captain's
// open decisions.
export const needCount = (needRuns, orchs, decisions) => needRuns.length + runlessNeeds(orchs).length + decisions;

// What the captain's row says it watches, from stats(): "watching 2 runs · 1 finished", every
// run it keeps an eye on (running and finished but open), then how many of them are finished.
export function watchingText(live, docked) {
  const n = live + docked;
  return `watching ${n} run${n === 1 ? "" : "s"}${docked ? ` · ${docked} finished` : ""}`;
}

// The same from stats() itself.
export const watchedText = (s) => watchingText(s.live.length, s.docked.length);

// A run's workers as Herdr's Agents list draws them: each parent followed by its children, with
// how deep it hangs and the tree lines to draw. `guides` has one entry per ancestor level below
// the top (true: that ancestor has later siblings, so a │ continues there); `last` says whether
// the row itself closes its siblings (└ rather than ├). A worker whose parent is the run's
// orchestrator, or isn't among the workers, stays at the top level.
export function workerTree(workers, rootAddress) {
  const here = new Set(workers.map((w) => w.address));
  const parentOf = (w) => (w.parent !== rootAddress && here.has(w.parent) ? w.parent : null);
  const out = [];
  const add = (parent, guides) => {
    const kids = workers.filter((w) => parentOf(w) === parent);
    kids.forEach((w, i) => {
      const last = i === kids.length - 1;
      // Top-level rows draw no lines; their children hang one level in, with `guides` for the levels between.
      const top = parent === null;
      out.push({ w, depth: guides.length + (top ? 0 : 1), last, guides });
      add(w.address, top ? [] : [...guides, !last]);
    });
  };
  add(null, []);
  return out;
}

// ---- the calm sidebar (props needs: "box") ----

// Claude Code reports "working" while a background shell runs, and says so in its status
// message ("1 shell still running"). A captain on the old skill waits on its watcher that way,
// so that "working" is watching, not replying.
export const SHELLS_ONLY = /^\s*\d+\s+(background\s+)?shells?\s+(are\s+|is\s+)?still\s+running\s*\.?\s*$/i;

// The captain link's mark, from its agent status, its status message and whether its watcher
// runs: "blocked" (a dialog waits), "working" (it is really replying: the spinner), "watching"
// (idle with its watcher running, or working only on background shells: a calm eye) or "idle".
export function captainMark({ status = null, msg = null, watching = false } = {}) {
  if (status === "blocked") return "blocked";
  const shellsOnly = SHELLS_ONLY.test(msg ?? "");
  if (status === "working" && !shellsOnly) return "working";
  if (shellsOnly || watching) return "watching";
  return "idle";
}

// The Needs-you entries in list order, the open one among them (`box`: draw it as the box), so
// opening one never moves another: the first `limit`, the rest behind "+ n more" until unfolded
// (`open`). The open entry stays in its place even beyond the limit. {slots: [{x, box}], extra}:
// `extra` is how many the fold holds, shown or not, so the toggle can say "+ 3 more".
export function needsSlots(entries, expanded, { limit = 4, open = false } = {}) {
  // An open entry past the limit is shown, so the fold holds one fewer.
  const past = expanded && entries.indexOf(expanded) >= limit ? 1 : 0;
  const extra = open ? Math.max(0, entries.length - limit) : Math.max(0, entries.length - limit - past);
  const slots = entries.map((x, i) => ({ x, box: x === expanded, show: open || i < limit || x === expanded }));
  return { slots: slots.filter((s) => s.show).map(({ x, box }) => ({ x, box })), extra };
}

// A compact Crew row's second line: what the run is doing now, in its own words (status.json's
// progress, else the plan's status line), one line. It changes as tasks do, which is why no
// count of them is shown: plans grow during a run. Null when it says nothing.
export const subtitleOf = (progress, statusLine) => String(progress ?? statusLine ?? "").replace(/\s+/g, " ").trim() || null;

// ---- Next for you ----

// "skills#52": the repository's name without its owner, and the number.
export const prRef = (repo, number) => `${String(repo ?? "").split("/").pop()}#${number}`;

// ---- titles ----

// A review run's title: "api#52 · Triage" (the repository's name from its related PR, its
// topic the PR's subject), so two reviews in different repositories never read alike. Null for
// any other run, or a review without a related PR or topic yet.
export function reviewTitle(type, related, topic) {
  if (type !== "rev" || !topic) return null;
  const m = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(related?.[0]?.url ?? "");
  return m ? `${m[1]}#${m[2]} · ${topic}` : null;
}

// Rows whose title is the same get their repository's name, muted, before it ("api · …"):
// {key, title, repo} → Map key → prefix, only for the rows that need one. A title that already
// names its repository (a review's) never gets a second.
export function repoPrefixes(rows) {
  const count = new Map();
  for (const x of rows) count.set(x.title, (count.get(x.title) ?? 0) + 1);
  return new Map(rows.filter((x) => count.get(x.title) > 1 && x.repo && !x.title.startsWith(`${x.repo}#`)).map((x) => [x.key, x.repo]));
}
