// Telling the user without being polled: a toast when a run starts needing them, the decisions
// a run made since they last looked, and what parked runs still wait on. Pure rules only, so the
// tests drive every one; telling.js keeps the stores and posts the toasts.

import { ageText, stepTextOf } from "./attention.js";

// A Needs-you reason must hold this long before it is told, so one that flaps (a state read
// mid-change, an orchestrator's terminal missing for a moment after a restart) never toasts.
export const TOAST_HOLD = 60000;

// ---- toasts ----

// What a run's attention (attention.js assess) says the user is needed for, as parts a toast
// can tell: {known, prKnown, parts: [{id, text}]}. An id names one reason and what it is about
// ("question:<asked at>", "pr/approved — merge:#1799,#1372"), so a new question or another PR
// is a new part, and the same reason read again is not. PR parts start with "pr/".
//   known: false when nothing can be said (its files could not be read): the run is skipped.
//   prKnown: false when its PRs could not be read (can't tell): its PR parts are carried over.
// Stalled is left out: it is a nudge (amber), not a decision, a long build or test run trips it,
// and the Crew shows it; a toast every time an agent works quietly for 30 min would be noise.
export function toastParts(run, att) {
  if (!run || !att || (att.group === "cant" && !att.reasons.some((r) => r.key !== "cant-tell"))) return { known: false, prKnown: false, parts: [] };
  const prKnown = !att.cantTell;
  if (run.away || att.group !== "needs") return { known: true, prKnown, parts: [] };
  const nums = (prs) => (prs ?? []).map((p) => (p.number ? `#${p.number}` : null)).filter(Boolean);
  const parts = [];
  for (const r of att.reasons) {
    if (r.key === "question") parts.push({ id: `question:${run.askedAt ?? r.text}`, text: r.text === "blocked on a dialog" ? "Blocked on a dialog" : `Asks you: ${r.text}` });
    else if (r.key === "gone") parts.push({ id: "gone", text: "Its orchestrator is gone: resume it" });
    else if (r.key === "finished") parts.push({ id: "finished", text: "Finished — read its report and close it" });
    else if (r.key === "red-ci") parts.push({ id: `pr/red-ci:${r.text}`, text: r.text.replace(/^red CI/, "Red CI") });
    else if (r.key !== "stalled") {
      const which = nums(att.next?.prs);
      // The step's words, as the pill and the Crew say them (red CI, a draft, a failed proof),
      // one PR at a time; the id keeps the key, so a toast already told is not told again.
      const label = (r.key === "approved — merge" && att.next?.comments?.count) || r.key === "review proof → merge"
        ? stepTextOf({ ...att, next: { ...att.next, count: 1 } }) : r.key;
      parts.push({ id: `pr/${r.key}:${which.join(",")}`, text: which.length ? `${which.join(", ")} ${label}` : label });
    }
  }
  return { known: true, prKnown, parts };
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// One poll's step of the toast store, {[run key]: {told, cand, since, by?, at?}}:
//   told   the reason ids already told (or there when the run was first seen)
//   cand   the ids read now, and `since` when they were first read so
// `seen`: [{key, known, prKnown, parts}] (toastParts with the run's key) for every listed run.
// A run seen for the first time is seeded silently: what already needs you when Harbormaster
// starts, or a machine is added, is not news. Once the ids read hold for `hold`, the ones not
// told yet are told (a toast) and `told` becomes them, so a reason that went and comes back
// later is news again, while one that flaps inside `hold` is not. A run that is gone from a
// machine that answered (not in `failed`, its machines as key prefixes, "" here) is forgotten.
// `me` marks the entries this copy told, so of several Harbormaster copies only the one whose
// claim stands posts the toast (telling.js). Returns {store (the same object when unchanged),
// toasts: [{key, parts: [{id, text}]}]}.
export function nextToasts(store, seen, now, { hold = TOAST_HOLD, failed = [], me = null } = {}) {
  const next = { ...(store ?? {}) };
  const toasts = [];
  let changed = false;
  for (const s of seen) {
    if (!s.known) continue;
    const prev = next[s.key];
    let ids = [...new Set(s.parts.map((p) => p.id))];
    // Unreadable PRs say nothing about PR reasons: the ones read before stand.
    if (!s.prKnown) {
      if (!prev) continue;
      ids = [...new Set([...ids, ...prev.cand.filter((id) => id.startsWith("pr/"))])];
    }
    ids.sort();
    if (!prev) { next[s.key] = { told: ids, cand: ids, since: now }; changed = true; continue; }
    if (!same(ids, prev.cand)) { next[s.key] = { ...prev, cand: ids, since: now }; changed = true; continue; }
    if (now - prev.since < hold || same(prev.told, prev.cand)) continue;
    // Only an id with a part this poll can be told: a PR id carried over while the PRs can't
    // be read has no text, so it waits (not told) until they are read again.
    const parts = prev.cand.filter((id) => !prev.told.includes(id)).map((id) => s.parts.find((p) => p.id === id)).filter(Boolean);
    const told = prev.cand.filter((id) => prev.told.includes(id) || parts.some((p) => p.id === id));
    if (same(told, prev.told)) continue;
    next[s.key] = { told, cand: prev.cand, since: prev.since, ...(parts.length ? { by: me, at: now } : {}) };
    changed = true;
    if (parts.length) toasts.push({ key: s.key, parts });
  }
  const listed = new Set(seen.map((s) => s.key));
  const down = new Set((failed ?? []).map((m) => m ?? ""));
  for (const key of Object.keys(next)) {
    if (!listed.has(key) && !down.has(key.slice(0, key.indexOf(":")))) { delete next[key]; changed = true; }
  }
  return { store: changed ? next : store, toasts };
}

// A toast's text: {title, body}. The title is the run's name; the body what it needs, its new
// reasons joined.
export const toastText = (name, parts) => ({ title: name, body: parts.map((p) => p.text).join(" · ") });

// ---- decisions new since you looked ----

// The time of a run's newest decision line, ms (0 for none or none with a time).
export const latestDecision = (decided) => Math.max(0, ...(decided ?? []).map((d) => d.at ?? 0));

// The decision lines newer than `seenAt` (when the user last unfolded the run's Decisions, as
// the newest decision's time then), or none before the run was first seen. A line without a
// time can't be told new.
export const newDecisions = (decided, seenAt) => (seenAt == null ? [] : (decided ?? []).filter((d) => d.at && d.at > seenAt));

// "7 new since you looked", or null for none.
export const newSinceText = (n) => (n > 0 ? `${n} new since you looked` : null);

// One poll's step of the seen store, {[run key]: ms}: a run seen for the first time takes its
// newest decision (what is there already is not new); a run gone from a machine that answered
// is forgotten. The same object when unchanged.
export function nextSeen(store, runs, { failed = [] } = {}) {
  const next = { ...(store ?? {}) };
  let changed = false;
  for (const r of runs) {
    if (r.stale || next[r.key] != null) continue;
    next[r.key] = latestDecision(r.decided);
    changed = true;
  }
  const listed = new Set(runs.map((r) => r.key));
  const down = new Set((failed ?? []).map((m) => m ?? ""));
  for (const key of Object.keys(next)) {
    if (!listed.has(key) && !down.has(key.slice(0, key.indexOf(":")))) { delete next[key]; changed = true; }
  }
  return changed ? next : store;
}

// ---- a card's PR facts ----

// A PR's state as a word ("Open", "Draft", "Merged"), or null when it could not be read.
export const prStateText = (pr) => (pr.state === "UNKNOWN" ? null : pr.state === "DRAFT" ? "Draft" : pr.state[0] + pr.state.slice(1).toLowerCase());

// A PR's review as [text, tone]: who approved or asked for changes, when we know.
export function reviewText(pr) {
  const who = (list) => (list?.length ? ` by ${list.join(", ")}` : "");
  if (pr.review === "CHANGES_REQUESTED") return [`Changes requested${who(pr.changesBy)}`, "blocked"];
  if (pr.review === "APPROVED") return [`Approved${who(pr.approvedBy)}`, "done"];
  if (pr.review === "REVIEW_REQUIRED") return ["Review needed", "dim"];
  return null;
}

// A PR's checks as {text, tone}, or null without any. Failing checks are red ("act") on a live
// run, dim on a parked or closed one (`away`): it never needs you, so red would ask for nothing.
function checksFact(pr, away) {
  const c = pr.checks ?? {};
  if (c.fail) return { text: `checks ✗ ${c.fail} failing`, tone: away ? "dim" : "blocked" };
  if (c.pending) return { text: `checks … ${c.pending} running`, tone: "dim" };
  if (c.pass) return { text: "checks ✓", tone: "pass" };
  return null;
}

// The facts line's PR part: [{kind: "pr", pr, i, text} | {kind: "prs", prs, text} | {kind: "text",
// text, tone, bold?}], tone a theme colour name or "pass" (green). Each PR is "PR #42 open", then
// its checks, "one-way door" (`oneWay(danger)` says which dangers are) and its review. Several
// PRs that all say the same (state, checks and review, and no one-way door) are said once:
// "2 PRs open · checks ✓ · Approved by anna", rather than the same three facts per PR.
export function prFacts(prs, { away = false, oneWay = () => false } = {}) {
  const per = (prs ?? []).map((pr, i) => {
    const state = prStateText(pr);
    const review = reviewText(pr);
    return {
      pr, i, state,
      head: `${pr.number ? `PR #${pr.number}` : "PR"}${state ? ` ${state.toLowerCase()}` : ""}`,
      rest: [checksFact(pr, away), pr.danger && oneWay(pr.danger) ? { text: "one-way door", tone: "blocked", bold: true } : null,
        review ? { text: review[0], tone: review[1] === "done" ? "pass" : review[1] } : null].filter(Boolean),
    };
  });
  const sig = (x) => [x.state, ...x.rest.map((f) => f.text)].join("\n");
  const alike = per.length > 1 && per.every((x) => x.state && sig(x) === sig(per[0])) && !per[0].rest.some((f) => f.text === "one-way door");
  if (alike) {
    return [{ kind: "prs", prs: per.map((x) => x.pr), text: `${per.length} PRs ${per[0].state.toLowerCase()}` }, ...per[0].rest.map((f) => ({ kind: "text", ...f }))];
  }
  return per.flatMap((x) => [{ kind: "pr", pr: x.pr, i: x.i, text: x.head }, ...x.rest.map((f) => ({ kind: "text", ...f }))]);
}

// ---- parked runs ----

// A parked run's next step, muted beside its pill: "approved — merge · 3d" (how long it has
// been parked), or null when its PRs say nothing (none, or they could not be read). Red CI comes
// first, as the Crew row and the pill put it: "red CI · review proof · 3d".
export function parkedLabel(att, away, now = Date.now()) {
  if (!att?.next || att.cantTell) return null;
  const red = att.reasons?.some((r) => r.key === "red-ci");
  const label = `${red ? "red CI · " : ""}${stepTextOf(att)}`;
  if (!away?.at) return label;
  // Days alone past a day ("3d", as the card's "Parked 3d ago"): hours add nothing at that scale.
  const ms = now - away.at;
  return `${label} · ${ms < 86400000 ? ageText(ms) : `${Math.floor(ms / 86400000)}d`}`;
}

// The Parked heading: "Parked · 3 · 2 with open PRs". `withOpen`: how many of them have an open PR.
export const parkedHeading = (n, withOpen) => `Parked · ${n}${withOpen ? ` · ${withOpen} with open PRs` : ""}`;

// The overview header's PR stat label after its number: "open PRs · 1 failing (+4 parked)". The
// parked runs' open PRs are not in the number, so it says so.
export function openPrsLabel(open, failing, parkedOpen) {
  const base = failing ? `open PRs · ${failing} failing` : open === 1 ? "open PR" : "open PRs";
  return parkedOpen ? `${base} (+${parkedOpen} parked)` : base;
}
