// The view's action notes: a line of news ("Closing 1 merged run…") that goes away on its own.
// No herdr imports, so the rule is testable. A note is {text, at}; errors stay until dismissed.
export const NOTE_LIFE = 20000;

// Sets (or, with no text, clears) the note, stamped with when it was set.
export function setNote(view, text, now = Date.now()) {
  view.actionNote = text ? { text, at: now } : null;
}

// The text to draw at `now`, or null once the note is no longer news.
export function noteText(view, now = Date.now()) {
  const n = view.actionNote;
  return n && now - n.at < NOTE_LIFE ? n.text : null;
}

// Drops an expired note; true when one went, so the caller redraws. The view's regular refresh
// calls this, so no timer is needed just for notes.
export function expireNote(view, now = Date.now()) {
  if (!view.actionNote || noteText(view, now)) return false;
  view.actionNote = null;
  return true;
}
