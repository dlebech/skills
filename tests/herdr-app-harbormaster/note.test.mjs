// Action notes: shown for 20 s, then gone; setting nothing clears.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setNote, noteText, expireNote, NOTE_LIFE } from "../../herdr-app/mods/harbormaster/note.js";

test("a note shows until it is 20 s old, then not", () => {
  const v = {};
  setNote(v, "Closing 1 merged run.", 1000);
  assert.equal(noteText(v, 1000), "Closing 1 merged run.");
  assert.equal(noteText(v, 1000 + NOTE_LIFE - 1), "Closing 1 merged run.");
  assert.equal(noteText(v, 1000 + NOTE_LIFE), null);
});
test("expiring drops the note once and says so, so the view redraws", () => {
  const v = {};
  setNote(v, "x", 0);
  assert.equal(expireNote(v, 5000), false);
  assert.equal(expireNote(v, NOTE_LIFE + 1), true);
  assert.equal(v.actionNote, null);
  assert.equal(expireNote(v, NOTE_LIFE + 2), false);
});
test("no text clears; a newer note restarts the clock", () => {
  const v = {};
  setNote(v, "a", 0);
  setNote(v, "b", 15000);
  assert.equal(noteText(v, 30000), "b");
  setNote(v, null, 30000);
  assert.equal(v.actionNote, null);
  assert.equal(noteText(v, 30000), null);
});
