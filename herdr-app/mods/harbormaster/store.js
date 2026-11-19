// Herdr's shared state, read once per render. Each shared(key) is a host call that copies the whole
// value into JS: harbormaster.prs (every run's PRs, ~50 KB) costs about 0.3 ms a read, and a card
// reads it a few times (prsOf, relatedOf, prEntryOf, attention), so the overview with 40 closed
// runs unfolded spent most of the 50 ms a render may take on copies and was interrupted
// (proof t1-timing). Inside oneRead() a key is read from the host once and kept until the draw
// returns; outside it (event handlers, polls) every read goes to the host. A write drops the
// kept value, so a read after it, in the same draw, sees the write. The values are never
// changed in place: every writer builds a new object (`{ ...store, [k]: v }`).

import { shared as hostShared, setShared as hostSetShared } from "herdr";

let kept = null;

export function shared(key) {
  if (!kept) return hostShared(key);
  if (!kept.has(key)) kept.set(key, hostShared(key));
  return kept.get(key);
}

export function setShared(key, value) {
  kept?.delete(key);
  return hostSetShared(key, value);
}

// Runs `draw` with each shared key read at most once; nested calls share the outer one's reads.
export function oneRead(draw) {
  if (kept) return draw();
  kept = new Map();
  try { return draw(); } finally { kept = null; }
}
