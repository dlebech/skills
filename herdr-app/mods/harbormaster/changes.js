// "Ask for changes" on a run that is ready to merge: the inbox message Harbormaster writes. No
// herdr imports, so the tests drive it under plain node.
//
// The first line starts "changes asked from Harbormaster: ", followed by the user's own words.
// The orchestrator acts on it as the user's instruction (SKILL.md): it sets the status back to
// running, plans the work as tasks and finishes again. Like a level request or an ask to prove,
// it answers no question (data.js NOT_ANSWERS, the captain's lib.sh answer_messages).

export const CHANGES = /^changes asked from Harbormaster: /;

// The message for the user's `text` (one line or several), or null for an empty one.
export function changesRequest(text) {
  const t = String(text ?? "").trim();
  return t ? `changes asked from Harbormaster: ${t}` : null;
}
