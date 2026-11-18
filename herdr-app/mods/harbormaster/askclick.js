// The click every ask button shares: tell the run's orchestrator through inbox.js and show how
// it went. inbox.js sends and keeps the asked state; this is the view side, written once: clear
// the last error, send, note a message that waits or is blocked, show an error, redraw, reload.

import { send, markAsked } from "./inbox.js";
import { setNote } from "./note.js";

// `view` is the window's view (actionError, redraw, load), `cx` the click's context.
// `asks` ([{key, item}]) are the items to read asked from the click (see inbox.js send).
// `notes` are this button's texts, after "<branch>: ": `waits` (the orchestrator is gone, the
// message waits in the inbox), `blocked` (it is on a dialog) and optionally `sent`.
// `before(cx)` runs first, for what only this button does (closing a text field).
// `via()` sends in place of inbox.js send, for a button that does more than write (Compact); it
// resolves to {outcome} as send does. `after()` runs once the send succeeded, `onError(e)` when it
// failed (before the error is shown), each awaited and never failing the click.
export function askClick(view, cx, run, kind, payload, { asks = [], notes = {}, before = null, via = null, after = null, onError = null } = {}) {
  if (before) before();
  // Marked now, before the first redraw, as the buttons always did; send marks again (the same
  // mark) and takes it back if the message never reached the inbox.
  for (const a of asks) markAsked(run, kind, a.key, a.item);
  view.actionError = null;
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const { outcome } = await (via ? via() : send(run, kind, payload, { asks }));
      if (after) await after(outcome);
      const note = outcome === "waits" ? notes.waits : outcome === "blocked" ? notes.blocked : notes.sent;
      if (note) setNote(view, `${run.branch}: ${note}`);
    } catch (e) {
      if (onError) await onError(e);
      view.actionError = `${run.branch}: ${e?.message ?? e}`;
    }
    view.redraw = true;
    try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
    try { await view.load(cx); } catch { /* the next refresh shows it */ }
  }, { owner: null });
}
