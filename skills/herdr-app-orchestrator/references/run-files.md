# Run files: the contract between an orchestrator, Harbormaster, the captain and you

Every run has a directory, `~/.herdr/hc-orchestration/<folder>/<branch>/` (or
`$HERDR_ORCHESTRATION_ROOT/<folder>/<branch>/`). `<folder>` is the last part of the
repository's path (or of the folder holding a run's several repositories), `<branch>` the
integration branch with `/` and the like as `-`. The files in it are the whole interface:
Harbormaster and you read and answer them directly, and `herdr-app-captain` uses the same
ones when it runs. **Nothing here needs the captain running.** The captain is a convenience on top,
and it keeps nothing the files do not.

| File | Written by | Read by | What it is |
| --- | --- | --- | --- |
| `orchestrator.json` | `init-run.sh` | captain, Harbormaster | `{terminal, tab_id, folder, branch, kind, started}`: how to find and resume the run. |
| `spec.md` | orchestrator | orchestrator, agents | The goal, scope and acceptance criteria. |
| `plan.md` | orchestrator | everyone | First line `Status: <one line>` (`running`, `waiting for user: <summary>`, `blocked: <reason>`, `finished`), then `Prefix:` and the tasks with their states. |
| `status.json` | `set-status.sh` | captain, Harbormaster | `{branch, folder, status, state, type, topic, progress, tasks: {merged, planned}, issues, prs, related, waiting, updated}`. Outlives the orchestrator. |
| `decisions.md` | orchestrator | anyone | The decisions log: what was decided, by whom, why. |
| `question.md` | orchestrator | Harbormaster, captain, you | The open question to you, if any (below). Removed once answered. |
| `inbox/*.message` | anyone who answers or instructs | orchestrator | Messages to the orchestrator (below). The orchestrator renames a message it has read to `.handled`. |
| `shared/` | orchestrator, agents | orchestrator, agents | Briefs, findings, reports. Not committed. |
| `parked`, `closed` | captain, Harbormaster, orchestrator | everyone | You put the run away. One line, `<UTC time>\t<plan status then>`; `init-run.sh` deletes them when an orchestrator resumes the run. |

The root also holds `.captain-decisions.json`, the captain's own open decisions (below).

## question.md

The orchestrator writes it atomically (`.question.tmp`, then `mv`) when it needs you, and
sets `plan.md`'s status to `waiting for user: <summary>`. Its modification time is when it was
asked: Harbormaster's queue sorts by it, oldest first. The shape is fixed, so a question can
be answered from its summary alone:

```markdown
# <one-line question, answerable from the summary>

## Question
<context, a few lines>

## Options
1. **<short label>**: <what happens>
2. **<short label>**: <what happens>

## Recommended
<label of one option>: <why, one line>

## Evidence
<what the recommendation rests on: files, numbers, test output>

## Risk
<what goes wrong if the recommendation is wrong; reversible or not>

## Blocks
<what waits on the answer: tasks, agents>
```

- The `# ` title is the summary line (without one, the first non-empty line).
- Options are the numbered or bulleted items under `## Options`. The label is the bold text,
  else the text up to the first `:` or ` — `. `## Recommended`'s first line names an option, by
  label (case-insensitive) or number, and may add why after a `:` or ` — `.
- A file with none of these `## ` sections is a free-form question, as older runs wrote
  them: it is shown as it is and can only be answered with free text.

## inbox/: answering and instructing

Anyone who answers a question, or tells the orchestrator something (Harbormaster, the
captain, you by hand), writes one file:

`inbox/<UTC yyyymmddThhmmssZ>-<source>.message` (Harbormaster adds milliseconds, `…Z-<ms>-<source>`, so two answers in a second don't collide), written to `inbox/.<name>.tmp` and then moved,
so it is never read half-written. For an answer, the text is

```
Answer to "<question title>": <option label>
<optional free text>
```

(or your own words in place of the option label). Then, when the orchestrator is there,
wake it: `hc send <its terminal> "Read and act on <the message file>."`. The message itself
is the content; the `hc send` is only the wake-up. Harbormaster does exactly this when you
click an option or Reply; the captain relays the same way. The orchestrator reads the
message, renames it `.handled`, deletes `question.md` and carries on. While `question.md` is still there and
a message is unhandled, Harbormaster shows "answered, waiting for the orchestrator".

An orchestrator that is gone reads waiting messages when it is resumed, so an answer is not lost.

## .captain-decisions.json

The captain's own open decisions, kept by `herdr-app-captain/scripts/decisions.sh`, oldest first:

```json
[{"id": "board-1068", "question": "Move #1068 to In Progress?", "run": "<run directory or null>",
  "asked": "<UTC time>",
  "options": [{"label": "Yes", "text": "move it"}, {"label": "No", "text": "leave it"}],
  "recommended": "Yes: it is started", "evidence": "…", "risk": "…", "blocks": "…"}]
```

`id`, `question`, `run` and `asked` are always there; the other keys are the same sections
as a `question.md` and are optional, so older entries stay valid. Harbormaster shows them in
its queue with the runs' questions. An answer goes to the captain's input when it is
running, and otherwise, when the decision names a run, to that run's `inbox/`; Harbormaster then removes the decision from this file itself, since no captain is there to.
