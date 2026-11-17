// The stores tell.js's rules read and the toasts they post:
//   - harbormaster.notified, {[run key]: {told, cand, since, by?, at?}}: which Needs-you reasons
//     of each run were told (tell.js nextToasts). Persisted, so a reload or a restart does not
//     tell them again. Written only when a run's reasons change (rare).
//   - harbormaster.toasts: false once the user turned the toasts off (the overview's header); on
//     by default.
//   - harbormaster.decisionsSeen, {[run key]: ms}: the newest decision's time when the user last
//     unfolded the run's Decisions, so the card, pane and Crew hover can say "7 new since you looked".
// Only the copies that poll for the whole window (the Crew block and the overview, not a run's
// pane or a popup) run observeTelling, after each run read. Several of them may: each claims a
// toast in the shared store (`by`) and posts it only if its claim still stands after writing.

import { shared, setShared, notify } from "herdr";
import { cachedRuns, prsOf } from "./data.js";
import { pruneAsked } from "./asked.js";
import { attentionOf } from "./attend.js";
import { orchestratorState } from "./live.js";
import { runName } from "./ui.js";
import { openRunAction } from "./commands.js";
import { toastParts, nextToasts, toastText, nextSeen, latestDecision } from "./tell.js";

const NOTIFIED_KEY = "harbormaster.notified";
const TOASTS_KEY = "harbormaster.toasts";
const SEEN_KEY = "harbormaster.decisionsSeen";
const ME = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---- toasts ----

export const toastsOn = () => shared(TOASTS_KEY) !== false;
export const setToastsOn = (on) => setShared(TOASTS_KEY, on ? null : false);

// A toast for a run: its name, what it needs, and a click that goes to its orchestrator, or
// to its card (harbormaster.open-run) when it has none here.
function post(run, parts, ctx) {
  const name = runName(run.branch, run.topic).title + (run.machine ? ` (${run.machine})` : "");
  const live = run.terminal && orchestratorState(run, ctx) !== "gone";
  const action = live ? { name: "agent.focus", args: { terminal: run.terminal } } : { name: openRunAction(run), args: {} };
  try { notify({ ...toastText(name, parts), level: "error", action }); } catch (e) { console.log(`harbormaster: toast failed: ${e?.message ?? e}`); }
}

// After a run read: steps the toast store and posts what is new, while the toasts are on (off,
// the store still steps, so turning them on again tells only what is new from then).
function observeToasts(runs, ctx, failed, now) {
  const seen = runs.map((r) => ({ key: r.key, ...(r.stale ? { known: false, prKnown: false, parts: [] } : toastParts(r, attentionOf(r, ctx, now))) }));
  const store = shared(NOTIFIED_KEY) ?? {};
  const { store: next, toasts } = nextToasts(store, seen, now, { failed, me: ME });
  if (next === store) return;
  setShared(NOTIFIED_KEY, next);
  if (!toastsOn()) return;
  const after = shared(NOTIFIED_KEY) ?? {};
  for (const t of toasts) {
    // Another copy told it at the same poll and its write came last: it posts, not this one.
    if (after[t.key]?.by !== ME || after[t.key]?.at !== now) continue;
    const run = runs.find((r) => r.key === t.key);
    if (run) post(run, t.parts, ctx);
  }
}

// ---- decisions seen ----

// When the user last unfolded the run's Decisions (its newest decision's time then), or null
// before the run was first seen.
export const decisionsSeen = (run) => shared(SEEN_KEY)?.[run.key] ?? null;

// Marks every decision the run has now as seen (its Decisions were unfolded).
export function markDecisionsSeen(run) {
  const store = shared(SEEN_KEY) ?? {};
  const at = latestDecision(run.decided);
  if (store[run.key] !== at) setShared(SEEN_KEY, { ...store, [run.key]: at });
}

// ---- after each run read ----

export function observeTelling(runs, ctx, now = Date.now()) {
  const failed = cachedRuns().failed ?? [];
  const seen = shared(SEEN_KEY) ?? {};
  const nextS = nextSeen(seen, runs, { failed });
  if (nextS !== seen) setShared(SEEN_KEY, nextS);
  observeToasts(runs, ctx, failed, now);
  // Asks for Address comments that no longer hold go from their store (asked.js).
  const live = runs.filter((r) => !r.stale);
  const busy = new Set(live.filter((r) => attentionOf(r, ctx, now).working).flatMap((r) => (prsOf(r) ?? []).map((p) => p.url)));
  pruneAsked(live.flatMap((r) => prsOf(r) ?? []), busy);
}
