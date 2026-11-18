// The one Needs-you queue the sidebar and the Bridge both draw: the Needs-you entries and the
// captain's open decisions as one ordered list, a stable key for each, and what a decision's one
// button does. Pure, so the tests drive it; crew.js draws it.

import { byNeed, importance, needKey, canExpand } from "./crewrows.js";

// A decision ranks as a question: it sits among the entries whose reason is an open question,
// by how long it has waited, and before every entry whose most important reason ranks lower. So it
// is given the shape byNeed ranks (an attention with one question reason, waiting since it was asked),
// and byNeed, the sidebar's one ranking, orders everything.
const asEntry = (it) => ({ r: { key: queueKey({ kind: "decision", it }) }, a: { reasons: [{ key: "question" }], waitSince: it.since ?? undefined } });

// An item's stable key: its entry's needKey, or `dec-<decision key>` (the decision item's id) for a decision.
export const queueKey = (item) => (item.kind === "decision" ? item.it.id : needKey(item.x));

// The Needs-you list: `entries` (crewrows.js groupRows(...).needs, already in byNeed order) and the
// captain's decision `items` (data.js decisionQueue's kind "decision") as [{kind: "entry", x} |
// {kind: "decision", it}]. Only what is asked, waited and keyed orders it: never which item is open.
export function needQueue(entries, decisions) {
  const list = [...entries.map((x) => ({ kind: "entry", x, e: x })), ...decisions.filter((it) => it.kind === "decision").map((it) => ({ kind: "decision", it, e: asEntry(it) }))];
  return list.map((p) => [p, importance(p.e.a)]).sort((p, q) => byNeed(p[0].e, q[0].e, p[1], q[1])).map(([p]) => (p.kind === "entry" ? { kind: "entry", x: p.x } : { kind: "decision", it: p.it }));
}

// What a decision row's one button does, as {kind: "answer", option} (send that option, an index),
// {kind: "open"} (focus the captain) or {kind: "start-captain"}. With a captain: its recommended
// option, else open it. Without: the same answer when the decision names a run that can take it (it
// goes to that run's inbox, answers.js sendAnswer), else start the captain. `unreachable` is the
// caller's fact (answers.js runUnreachable): the run is parked, gone or on another machine.
export function decisionAction(it, { captain, unreachable = false }) {
  const answer = it.recommended != null && it.options?.[it.recommended] ? { kind: "answer", option: it.recommended } : null;
  if (captain) return answer ?? { kind: "open" };
  return it.run && !unreachable ? answer ?? { kind: "open" } : { kind: "start-captain" };
}

// Which queue item the sidebar's Needs-you box draws open: the one clicked (`openKey`) while it is
// still in the queue, else the first, longest wait first. A decision can always be drawn as the box;
// an entry only with a run directory (crewrows.js canExpand). Null for none.
export function expandedItem(queue, openKey) {
  const can = queue.filter((q) => q.kind === "decision" || canExpand(q.x));
  return can.find((q) => queueKey(q) === openKey) ?? can[0] ?? null;
}
