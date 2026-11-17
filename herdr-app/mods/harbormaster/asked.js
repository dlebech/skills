// The asked state of Address comments, kept in shared state harbormaster.commentsAsked,
// {[PR url]: {sig, at}} (comments.js): what was asked from any copy of the mod, valid while the
// PR's open comments are unchanged, so it survives a reload and shows in every copy. The pure
// rules (valid, pruned) are in comments.js; this file only reads and writes the store.

import { shared, setShared } from "herdr";
import { askedUrls, markAsked, unmarkAsked, prunedAsked } from "./comments.js";

const KEY = "harbormaster.commentsAsked";

export const askedStore = () => shared(KEY) ?? {};

// The URLs among `prs` asked about, from the store and the run's unread asks (run.commentsAsked).
export const askedPrsOf = (run, prs, now = Date.now()) => new Set([...askedUrls(askedStore(), prs, now), ...(run?.commentsAsked ?? [])]);

// Marks `prs` asked now (the click), and unmarks one whose send failed before reaching the inbox.
export const markPrsAsked = (run, prs) => setShared(KEY, markAsked(askedStore(), run, prs));
export function unmarkPrAsked(url) {
  const store = askedStore();
  const next = unmarkAsked(store, url);
  if (next !== store) setShared(KEY, next);
}

// After a run read: drops asks that no longer hold (a week old, merged, comments moved). Writes
// only on a change.
export function pruneAsked(prs) {
  const store = shared(KEY);
  const next = prunedAsked(store, prs);
  if (next !== store) setShared(KEY, next);
}
