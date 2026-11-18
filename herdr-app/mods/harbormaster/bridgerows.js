// The Bridge's pure pieces: how many columns, which run goes in which block, the words on a run's
// line and a parked row, the header's totals and the fold state. No drawing; bridge.js draws them.

import { needRunsOf, rowLead, subtitleOf, watchingText } from "./crewrows.js";
import { parkedLabel, openPrsLabel } from "./tell.js";

// The view's width (after zoom) from which the Bridge draws two columns; narrower it is one.
export const WIDE = 700;

export const bridgeColumns = (width) => (width >= WIDE ? 2 : 1);

// Every run in exactly one block, from stats()'s result: Open (needing you first, then the rest,
// each newest first by `sort`), Done (attention group "done"), Parked and Closed (newest first).
export function bridgeGroups(s, attOf, sort) {
  const seen = new Set();
  const take = (runs) => runs.filter((r) => !seen.has(r) && seen.add(r));
  const parked = take(s.parked);
  const closed = take(s.closed);
  const shown = take(s.shown);
  const done = shown.filter((r) => attOf(r)?.group === "done");
  const rest = shown.filter((r) => !done.includes(r));
  const needing = needRunsOf(rest, attOf);
  const byNew = (list) => [...list].sort(sort);
  return { open: [...byNew(needing), ...byNew(rest.filter((r) => !needing.includes(r)))], done: byNew(done), parked: byNew(parked), closed: byNew(closed) };
}

// A run's line: what it is doing now, muted; the lead in red when the run needs you.
export function runLineText(r, att, now = Date.now()) {
  if (att?.group === "needs") return { text: rowLead(att, now).lead, red: true };
  return { text: subtitleOf(r.progress, r.statusLine) ?? (att ? rowLead(att, now).lead : ""), red: false };
}

// A parked row: "parked 3d" (one unit: days, hours or minutes) and what its PRs wait on, as the parked card says it
// (without the age, which the first part has).
export function parkedRowText(r, att, now = Date.now()) {
  const ms = r.away?.at ? now - r.away.at : null;
  const age = ms == null ? "parked" : `parked ${ms >= 86400000 ? `${Math.floor(ms / 86400000)}d` : ms >= 3600000 ? `${Math.floor(ms / 3600000)}h` : `${Math.max(1, Math.floor(ms / 60000))}m`}`;
  return { age, waits: parkedLabel(att, null, now) ?? "no pull request waiting" };
}

// The header's totals as parts: "5 open runs", "3 parked", "2 open PRs" (red when one fails). Parked and PRs
// are left out at zero. `open`: the Open block's count (default: every run shown, Done ones too).
export function totalsText(s, open = s.shown.length) {
  const parts = [{ text: `${open} open ${open === 1 ? "run" : "runs"}`, tone: null }];
  if (s.parked.length) parts.push({ text: `${s.parked.length} parked`, tone: null });
  if (s.open.length) parts.push({ text: `${s.open.length} ${openPrsLabel(s.open.length, s.failing, 0)}`, tone: s.failing ? "blocked" : null });
  return parts;
}

// The fold state: a Set of keys of the runs unfolded to their card, one per block ("open:<run key>", "done:<run key>",
// "parked:<run key>"), so a run that moves to another block starts folded there. Each helper returns a new Set.
export const foldKey = (block, r) => `${block}:${r.key}`;

export function toggleOpen(set, key) {
  const next = new Set(set ?? []);
  if (!next.delete(key)) next.add(key);
  return next;
}

// Unfold all / Fold all act on the given runs of one block only (the Open block); what else is unfolded stays.
export const unfoldAll = (set, runs, block = "open") => new Set([...(set ?? []), ...runs.map((r) => foldKey(block, r))]);

export const foldAll = (set, runs, block = "open") => new Set([...(set ?? [])].filter((k) => !runs.some((r) => foldKey(block, r) === k)));

// Whether every one of `runs` is unfolded: the link then offers Fold all.
export const allUnfolded = (set, runs, block = "open") => runs.length > 0 && runs.every((r) => set?.has(foldKey(block, r)));

// The set without keys of runs that are no longer in the block they were unfolded in (`groups`: bridgeGroups' result).
export function pruneFolds(set, groups) {
  const live = new Set(["open", "done", "parked", "closed"].flatMap((b) => (groups[b] ?? []).map((r) => foldKey(b, r))));
  return new Set([...(set ?? [])].filter((k) => live.has(k)));
}

// What the captain watches, from stats(): "watching 2 runs · 1 finished" (crewrows.js watchingText).
export const watchedText = (s) => watchingText(s.live.length, s.docked.length);
