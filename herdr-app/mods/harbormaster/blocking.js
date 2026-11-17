// "Ask what's blocking" on a stalled run: the inbox message Harbormaster writes, and whether
// the ask still waits. No herdr imports, so the tests drive it under plain node.
//
// The message's first line starts "what is blocking?", which the orchestrator acts on and the
// read of the run's files finds (data.js NOT_ANSWERS). Like a level request or an ask to prove,
// it answers no question, so an open question.md never reads as answered because of it.

import { stepSig } from "./attention.js";

export const BLOCKING = /^what is blocking\?/;

// The message, in the user's voice: what Harbormaster sees, then what to do.
// `quiet` is how long the run has been quiet ("34m"), `step` its current step with its age
// ("CI on #42 · 50m"), or null.
export function blockingRequest({ quiet, step = null }) {
  return `what is blocking? Harbormaster sees this run quiet for ${quiet}${step ? ` (step: ${step})` : ""}.\n`
    + "Asked from Harbormaster: if you need me, write question.md and ask; else carry on and update your progress line.";
}

// The same message for a red CI (a Needs-you box's Ask the orchestrator): which PR's CI failed,
// its first failing check and where to read it. The orchestrator acts on it as on any "what is
// blocking?": it fixes what is the run's to fix, or asks with a question.
export function ciRequest({ pr, check = null, url = null }) {
  return `what is blocking? Harbormaster sees CI red on ${pr ? `#${pr}` : "the PR"}${check ? ` (failing: ${check})` : ""}${url ? `: ${url}` : ""}.\n`
    + "Asked from Harbormaster: fix it if it is the run's to fix (as a task, reviewed as usual) and update your progress line; if you need me, write question.md and ask.";
}

// Whether a "what is blocking?" message is among the first lines of the run's unhandled
// inbox messages (data.js reads them with the level requests).
export const blockingPending = (lines) => (lines ?? "").split("\n").some((l) => BLOCKING.test(l.trim()));

// What the run looked like when it was asked: its progress line, plan task states and status.
// The ask reads "asked…" until this changes (or while its message is still unread).
export const askSig = (run) => `${stepSig(run)}\n${run?.statusLine ?? ""}`;

// Whether the run shows "asked…": its message is still unread (run.blockingAsked), or it was
// asked from here (`asked`: {sig} from askSig at the click) and nothing has moved since.
export const blockingAsked = (run, asked = null) => Boolean(run?.blockingAsked) || (asked != null && asked.sig === askSig(run));
