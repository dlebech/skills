# Herdr orchestration

Runs of agent work driven by an orchestrator, watched and steered by a person from Harbormaster.

## Language

### Talking to an orchestrator

**Inbox message**:
A message left in a run's inbox for its orchestrator to read and act on. Every inbox message has a kind, and is either an ask or an answer.
_Avoid_: request, note, tell

**Ask**:
An inbox message that answers no question: what is blocking, a red CI, changes, review comments, a claim to prove, an autonomy or proof-tier level.
_Avoid_: request, nudge

**Answer**:
An inbox message that answers the run's open question.
_Avoid_: reply (Reply is only the button for your own words)

**Unread**:
An inbox message the orchestrator has not handled yet.
_Avoid_: pending, queued

**Asked**:
How an ask reads while it is unread, or while what it asked about has not moved since it was sent.
_Avoid_: requested, sent

**Wake**:
Telling an orchestrator to read a new inbox message. A gone orchestrator is never woken; its message waits until the run is resumed.
_Avoid_: ping, notify
