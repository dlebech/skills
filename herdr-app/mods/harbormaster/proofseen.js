// Whether the user has read a run's proof: {[run key]: signature} in harbormaster.proofSeen, the
// signature being claims.js proofState's sig of the proof as shown when they opened it (the Proof button
// of the need box, or the Proof section unfolded in a pane). A changed proof is a new signature,
// so it reads as unread. Kept apart from telling.js, which imports attend.js, which reads this.

import { shared, setShared } from "herdr";

const KEY = "harbormaster.proofSeen";

// The signature stored for the run when its proof was last read, or null.
export const proofSeenSig = (run) => shared(KEY)?.[run.key] ?? null;

// Marks the proof with signature `sig` as read for the run.
export function markProofSeen(run, sig) {
  if (!sig) return;
  const store = shared(KEY) ?? {};
  if (store[run.key] !== sig) setShared(KEY, { ...store, [run.key]: sig });
}

// Entries for runs that are gone from a machine that answered (not in `failed`, its machines as
// key prefixes, "" here) are forgotten, as tell.js nextSeen does; the same object when unchanged.
export function nextProofSeen(store, runs, { failed = [] } = {}) {
  const next = { ...(store ?? {}) };
  let changed = false;
  const listed = new Set(runs.map((r) => r.key));
  const down = new Set((failed ?? []).map((m) => m ?? ""));
  for (const key of Object.keys(next)) {
    if (!listed.has(key) && !down.has(key.slice(0, key.indexOf(":")))) { delete next[key]; changed = true; }
  }
  return changed ? next : store;
}

export function pruneProofSeen(runs, failed) {
  const store = shared(KEY);
  if (!store) return;
  const next = nextProofSeen(store, runs, { failed });
  if (next !== store) setShared(KEY, next);
}
