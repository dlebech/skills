// The stores tell.js's rules read and the toasts they post:
//   - harbormaster.notified, {[run key]: {told, cand, since, by?, at?}}: which Needs-you reasons
//     of each run were told (tell.js nextToasts). Persisted, so a reload or a restart does not
//     tell them again. Written only when a run's reasons change (rare).
//   - harbormaster.toasts: false once the user turned the toasts off (the overview's header); on
//     by default.
//   - harbormaster.decisionsSeen, {[run key]: ms}: the newest decision's time when the user last
//     unfolded the run's Decisions, so the card, pane and Crew hover can say "7 new since you looked".
//   - harbormaster.proofSeen, {[run key]: signature}: the proof as shown when the user last read it
//     (proofseen.js), so a run's box can say the proof is read and the merge is next.
// Only the copies that poll for the whole window (the Crew block and the overview, not a run's
// pane or a popup) run observeTelling, after each run read. Several of them may: each claims a
// toast in the shared store (`by`) and posts it only if its claim still stands after writing.

import { notify } from "herdr";
import { shared, setShared } from "./store.js";
import { cachedRuns, prsOf, isClosed, decisionQueue, filesFresh } from "./data.js";
import { pruneAsked, migrateCommentsAsked } from "./inbox.js";
import { claimRows } from "./claims.js";
import { attentionOf } from "./attend.js";
import { orchestratorState } from "./live.js";
import { runName } from "./ui.js";
import { openRunAction } from "./commands.js";
import { pruneProofSeen } from "./proofseen.js";
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
// `atts`: each live run's attention (observeTelling reads it once), by run.
function observeToasts(runs, atts, ctx, failed, now) {
  const seen = runs.map((r) => ({ key: r.key, ...(r.stale ? { known: false, prKnown: false, parts: [] } : toastParts(r, atts.get(r))) }));
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

// The item a mark's signature is read from, where the run alone does not give it: the PR of an
// Address comments mark, the claim row of an Ask to prove. Undefined (the mark is kept) for a stale
// run, or one that no longer has it.
function markItem(run, family, key, queue = null) {
  // Not a fresh read (a stale run, a machine that failed, or polls older than two minutes): the
  // queue is missing items only because nothing was read, so every mark is kept.
  if (!filesFresh(run)) return undefined;
  // An answer's queue item by id; false once it is not in the queue (the question is gone). A
  // captain decision belongs to its own machine (its key is "dec-<machine>:<id>"): gone only
  // when that machine answered this read too.
  if (family === "answer") {
    const item = queue?.get(key);
    if (item || !key.startsWith("dec-")) return item ?? false;
    return filesFresh({ machine: key.slice(4, key.indexOf(":")) || null }) ? false : undefined;
  }
  if (family === "comments") return (prsOf(run) ?? []).find((p) => p.url === key);
  if (family === "proof") return claimRows(run.proof, run).find((k) => k.id === key);
  return undefined;
}

export function observeTelling(runs, ctx, now = Date.now()) {
  const failed = cachedRuns().failed ?? [];
  const seen = shared(SEEN_KEY) ?? {};
  const nextS = nextSeen(seen, runs, { failed });
  if (nextS !== seen) setShared(SEEN_KEY, nextS);
  // Proofs read (proofseen.js): forget the runs that are gone.
  pruneProofSeen(runs, failed);
  // Each live run's attention once: it reads the PRs, CI, stall, proof and asks, and both the
  // toasts and the prune below need it.
  const live = runs.filter((r) => !r.stale);
  const atts = new Map(live.map((r) => [r, attentionOf(r, ctx, now)]));
  observeToasts(runs, atts, ctx, failed, now);
  // The marks of the shared asked store (inbox.js): the signature moved, the run is closed or gone, or
  // a week passed. A comments mark reads its PR, a proof mark its claim row; a stale run's marks
  // are kept (its files are not a fresh read), and age out.
  const busy = new Set(live.filter((r) => atts.get(r).working).flatMap((r) => (prsOf(r) ?? []).map((p) => p.url)));
  const queue = new Map(decisionQueue(runs, cachedRuns().decisions ?? [], ctx).map((x) => [x.id, x]));
  // A run absent from `runs` is gone only when its machine was read fresh this time; after a
  // reload, or while a machine fails, it may only be unread. Then its marks are kept (they age out),
  // and the old comments asks of no listed run wait for a read that lists every machine.
  const read = cachedRuns().at > 0;
  const machineOf = (rk) => rk.slice(0, Math.max(rk.indexOf(":/"), 0)) || null;
  if (read && runs.length) migrateCommentsAsked(runs, prsOf, { offline: failed.length > 0 });
  pruneAsked(runs, { now, gone: (rk) => read && !failed.includes(machineOf(rk)), closed: (r) => isClosed(r, ctx), busy, lookup: (run, family, key) => markItem(run, family, key, queue) });
}
