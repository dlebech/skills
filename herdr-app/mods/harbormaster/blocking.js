// "Ask what's blocking" on a stalled run: the inbox message Harbormaster writes, and whether
// the ask still waits. No herdr imports, so the tests drive it under plain node.
//
// The message's first line starts "what is blocking?", which the orchestrator acts on and the
// read of the run's files finds (data.js NOT_ANSWERS). Like a level request or an ask to prove,
// it answers no question, so an open question.md never reads as answered because of it.

import { askSig, BLOCKING } from "./inbox.js";

// The message builders and the unread prefix live in inbox.js; re-exported so imports keep working.
export { BLOCKING, blockingRequest, ciRequest, askSig } from "./inbox.js";

// Whether a "what is blocking?" message is among the first lines of the run's unhandled
// inbox messages (data.js reads them with the level requests).
export const blockingPending = (lines) => (lines ?? "").split("\n").some((l) => BLOCKING.test(l.trim()));

// Whether the run shows "asked…": its message is still unread (run.blockingAsked), or it was
// asked from here (`asked`: {sig} from askSig at the click) and nothing has moved since.
export const blockingAsked = (run, asked = null) => Boolean(run?.blockingAsked) || (asked != null && asked.sig === askSig(run));
