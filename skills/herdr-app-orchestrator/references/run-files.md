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
| `status.json` | `set-status.sh`, `tokens.sh` | captain, Harbormaster | `{branch, folder, status, state, type, topic, progress, tasks: {merged, planned}, autonomy, issues, prs, related, waiting, updated, tokens, budget, budget_asked, budget_answered}`. Outlives the orchestrator. `set-status.sh` keeps fields other scripts write. |
| `sessions` | `tokens.sh` | `tokens.sh` | Every session the orchestrator's terminal has had, one `<kind> <session id or file>` a line (below). |
| `.tokens/` | `tokens.sh` | `tokens.sh` | Its cache: each session file's parsed usage and how far it was read (below). |
| `.resources.json` | Harbormaster | Harbormaster, run history | CPU and memory per agent and program, added to on each 5 s poll while the run is open (below). |
| `.history.jsonl` | Harbormaster | stats view | In the runs root, not a run directory: one summary line per closed run (below). Outlives the run. |
| `.timing/` | Harbormaster's `timing.sh` | `timing.sh` | Its cache: each session's events read so far and its time by category, keyed by the file's size, inode and mtime and the script's logic. Safe to delete. |
| `decisions.md` | orchestrator | anyone | The decisions log: what was decided, by whom, why (the line format is below). |
| `question.md` | orchestrator | Harbormaster, captain, you | The open question to you, if any (below). Removed once answered. |
| `inbox/*.message` | anyone who answers or instructs | orchestrator | Messages to the orchestrator (below). The orchestrator renames a message it has read to `.handled`. |
| `shared/` | orchestrator, agents | orchestrator, agents | Briefs, findings, reports. Not committed. `shared/proof/` holds captured proof. |
| `proof.md` | orchestrator, `proving` skill | Harbormaster, you | Per-task proof results (below). Not committed. |
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

## plan.md: proof lines and tier

Proof is a review aid: each task names the evidence that shows it is done, when it is
planned. A task you cannot name evidence for is not scoped yet. Harbormaster reads the lines
below and shows them in the run's Proof section.

- Below `Status:` and `Prefix:`, `Proof tier: T<n>` is the run's tier, the orchestrator's
  proposal. When the user overrides it the line reads `Proof tier: T<n> (set by user)`.
  Without the line, the run's tier is the highest of its tasks'.
- Every task has a proof line, in any of the task shapes Harbormaster reads: `- Proof: T1 — <the
  evidence>` under a heading task, a `proof` column in a task table, or `Proof: T1 — …` inside
  a list item under `## Tasks`. The tier is `T0` to `T3`; the text after the dash is the evidence.
- Tiers: `T0` CI or the local test suite is green (the default, so not by itself a sign that a task needs no review); `T1` T0 plus test output for the
  changed behaviour; `T2` T1 plus screenshots or a recording; `T3` T2 plus a guided demo. The proving skill's tier table has the canonical wording, which Harbormaster shows on hover; `tests/herdr-app-harbormaster/tiers.sh` checks they match.

## proof.md and shared/proof/

`<run>/proof.md` and the files in `<run>/shared/proof/` are the captured proof, written by
whoever captures it: the `proving` skill if available, otherwise the orchestrator the same way. They are never committed: the PR
describes them in text. Harbormaster lists the file names (up to 40) and reads `proof.md`:

```markdown
# Proof: <branch>
Tier: T2
Checks: green — <what ran, e.g. the repo's checks on the integration branch>

## <task id> <task name>
Tier: T1
Checked: <what was checked>
Result: pass | fail | partial — <one line>
Files: shared/proof/<file>, shared/proof/<file>
Ran: <short sha> <command> — <result>
```

`Ran:` (one line per test, lint or build run, repeatable) records the commit a run was made against, so
reviewers and the orchestrator reuse it instead of rerunning it on the same sha; see
[speed.md](speed.md). The result is `pass` or `fail: <one line>`. Reuse a line only when its sha is HEAD, or `git diff --quiet <sha> HEAD` (same tree), the tree is clean, and the result starts with `pass`; otherwise rerun.

A task's `## ` section is matched to the task by its id; its `Result` shows beside the task's
row in the Proof section. The optional header line `Checks: green — …` or `Checks: red — …` (CI or
the local suite on the integration branch) shows as "checks green" in the verdict line. A T2 or T3
task with a `Result:` whose `Files:` has no image or video (png, jpg, jpeg, gif, webp; mp4, webm, mov, m4v) counts as "n tasks without a screenshot" (tasks, not images; an image missing from `shared/proof/` does not count). `Files:` is comma-separated paths only: a note in parentheses after a path is ignored, and notes belong in `Checked:`. Only a `## ` section with a `Result:` or `Tier:` is a task; Harbormaster reads the first 64 kB of proof.md and marks the verdict "(proof.md cut)" past that.
A run with no `proof.md` shows its plan's evidence only.

## The PR body: Evidence and Merge danger

The orchestrator's PR body has `## Evidence` (per task: what was checked, the result, and the
local file names from `proof.md`; it replaces "validation and measurements") and `## Merge
danger`. The first line of `## Merge danger` is `One-way door — <blast radius>` or
`Two-way door — <blast radius>`, e.g. `Two-way door — Harbormaster mod and two skills; revert the
squash commit to undo.` Harbormaster reads that line from the PR body and shows it on the PR row,
red for a one-way door. `pr-humanize` keeps both sections verbatim, between `## For humans` and
`## For AI`.

## inbox/: answering and instructing

Anyone who answers a question, or tells the orchestrator something (Harbormaster, the
captain, you by hand), writes one file:

`inbox/<UTC yyyymmddThhmmssZ>-<source>.message` (Harbormaster adds milliseconds, `…Z-<ms>-<source>`, so two answers in a second don't collide; the captain writes `…Z-captain`). Only the `.message` suffix and the atomic write are required; the names sort by time, so waiting messages are read in the order they were written. Written to `inbox/.<name>.tmp` and then moved,
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

An orchestrator that is gone or lost is never woken (its terminal is gone, or only a shell, which would run the wake-up as a command): the message waits, and Harbormaster says so ("waits in its inbox until the run is resumed"). The resumed orchestrator reads waiting messages in name order, so an answer is not lost.

## Autonomy and decisions.md

`set-status.sh --autonomy L0|L1|L2` stores `autonomy` in `status.json` (missing means `L0`) and the
terminal label `run.autonomy`; the run card shows it as a tag. L3 (auto-merge) is not built.

- `L0`: you approve decisions, as before.
- `L1`: the orchestrator decides small things itself and stops only for a direction or design call.
  `herdr-app-captain`, if it runs, may answer the routine questions of an L1 run.
- `L2`: the orchestrator runs to a merge-ready PR with proof and stops only at merge.

`decisions.md` may hold free text, but each decision is also one appended line:

```
- [decided] 2026-11-16T09:30:00Z Tag colour: grey, like the type tag — keeps the card calm
- [user] 2026-11-16T09:41:00Z Merge order: t1 before t2 — t2 builds on it
```

`[decided]` is a decision the orchestrator made itself, `[user]` one you made (the orchestrator logs one when it acts on your answer, section 6 of its skill). Harbormaster reads the
last 60 lines of either kind and shows them as "Decided for you": one summary line (`Decided for you · 20 by the
orchestrator, 1 from you · latest: <the newest line>`), which on the pane expands to the list, newest first.
A line that does not read as `<UTC time> <topic>: <decision> — <why>` is shown as its raw text.

## Tokens: status.json `tokens`, sessions and .tokens/

`set-status.sh` runs `scripts/tokens.sh --print <run-directory>` on every publish and merges what it
prints in its own write of `status.json` (quietly: a failed count never stops the status, and keeps the
last one; run `tokens.sh <run-directory>` by hand to see why, which also writes the count). It is
`status.json`'s `tokens`:

```json
{"total": 26222515, "input": 588, "output": 212199, "cache_read": 25133155, "cache_write": 876573,
 "by_agent": [{"name": "orchestrator", "total": 8844538, "input": 120, "output": 61000, "cache_read": 8500000, "cache_write": 283418},
              {"name": "pda-t1", "total": 4690650, "input": 40, "output": 30000, "cache_read": 4600000, "cache_write": 60610}],
 "updated": "2026-11-16T09:02:56Z"}
```

`total` is the sum of the four kinds, as Harbormaster's context size is; each agent has the four kinds too
(a count from before that lacks them shows its bar in one colour); `by_agent` lists the
orchestrator first, then agents by size. A count only grows: one lower than the count already in
`status.json` is never written. What it counts, from the session files on this computer, and only
messages from orchestrator.json's `started` on (what a session said before the run, or an older run
that used the same prefix, is not this run's):

- **The orchestrator**: each session listed in `sessions`. On every count it asks `hc get <terminal>`
  for the orchestrator's pid, reads the session id from Claude Code's `~/.claude/sessions/<pid>.json`,
  and appends `claude <id>` if new. So a resumed orchestrator's earlier sessions still count, although
  the orchestrator works in the repository's checkout, whose folder other sessions share. Its
  sub-agents' transcripts count too. pi has no pid to session map, so a pi orchestrator is best effort:
  `pi <file>` is the earliest session in its folder whose header names that folder and that started
  after its terminal did; a session started there with `/new` later is missed. opencode is the same
  (`opencode <session id>`, in a terminal whose `status.app` starts with `opencode`), with the
  session's sub-sessions counted too.
- **Agents**: every session in the run's worktrees, `~/.herdr/worktrees/<repo>/<prefix>-*` for each
  repository in plan.md's `Repos:` (or the run's folder) and the integration worktree, found by Claude
  Code's (`~/.claude/projects/<folder with each character other than A-Z a-z 0-9 - as ->/`, with
  `<session>/subagents/*.jsonl`) and pi's (`~/.pi/agent/sessions/--<folder with / as ->--/`) folder
  naming, so they are found after the worktrees are removed. opencode keeps every session in one
  SQLite database, `~/.local/share/opencode/opencode.db` (`OPENCODE_DATA_DIR` moves it), and each
  session names its folder, so its sessions are listed by folder the same way. It is read, read-only,
  by `scripts/opencode-usage.py`, which needs `python3` (there is often no `sqlite3` program); without
  either, opencode adds nothing. Both of opencode's table generations are read (`session` + `message`,
  `session_v2` + `session_message`); its older JSON files in `storage/` are not (tokens read the database only; the stats view's timing, `timing.sh`, reads `storage/` too, so a storage-only opencode install gets time but no tokens). Each is named by its worktree
  (`pda-t3`), the integration worktree's as `integration`.
- **Each response once**: Claude Code writes one line per content block of a response, each with the
  same usage, so it counts each `message.id` once (they are one to one with `requestId`), across files
  too, as a resumed session repeats earlier messages; pi by session file and entry id, since pi's
  8-character entry ids repeat across sessions; opencode by message id. opencode's reasoning tokens
  count as output, and a compaction is a call like any other.

opencode's database is not append-only, so its sessions are cached differently: `.tokens/opencode_<session>.tsv`
holds the session's rows and its `.at` line holds a stamp (the newest message's update time and the
message count) where the offset is. A session is read again, whole, only when its stamp changes, and rows
once cached stay, so a message opencode deletes later still counts.

`.tokens/` keeps, per session file, the usage rows read so far and an `.at` line: how far it read, the
file's inode and mtime, the run start used, a checksum of its first 4 kB and of the 256 bytes before
that point, and the agent's name. A rerun reads only bytes added since, up to the last whole line, and
rereads a file that was replaced, shrank or was rewritten. The count sums every cached file, so a
session file deleted later (Claude Code removes old ones after `cleanupPeriodDays`, 30 by default)
still counts. When no session file is newer than the last count and none came or went, a count less
than a minute old is reused as is (`.tokens/tokens.json`, `.tokens/.stamp`). Deleting `.tokens/` is
safe while the session files are there. Writes to `status.json` go through `lib.sh`'s
`status_update`, under a lock (`.status.lock`), so `set-status.sh` and `tokens.sh` publishing at once
do not undo each other. Harbormaster reads only `status.json`, so the numbers show for runs on other
machines and stay after the orchestrator is gone.

## CPU and memory: .resources.json

Harbormaster's poll (`herdr-app/mods/harbormaster/resources.js`) adds a process snapshot to this file
every 5 s while the run is open and its orchestrator is there; the orchestrator never writes it. One
JSON object, `sampled_ms` always its first key:

```json
{"sampled_ms": 1794830000000, "version": 2, "os": "linux", "estimated": false,
 "samples": 720, "seconds": 3600, "cpu_s": 812.4, "peak_rss_mb": 3120.5, "avg_rss_mb": 1840.2, "rss_mbs": 6624720,
 "programs": {"test runner": {"cpu_s": 210.3}, "short-lived": {"cpu_s": 40.1}},
 "agents": {
   "impl-rss-t7": {"terminals": ["t53c"], "parent": "orc-skills-stats", "first_ms": 0, "last_ms": 0, "seconds": 1800,
     "cpu_s": 300.2, "own_cpu_s": 120.0, "peak_rss_mb": 900.1, "avg_rss_mb": 610.4,
     "programs": {"test runner": {"cpu_s": 150.0, "peak_rss_mb": 400.0, "avg_rss_mb": 80.2}},
     "raw": {"terms": {}, "own_ms": 0, "done_ms": {}, "rss_mbs": 0, "prog_mbs": {}, "prog_peak": {}}}}}
```

- `agents` is keyed by terminal name (its address without one): the orchestrator, its agents and the
  terminals they started with `hc run`, each with its `parent`'s name, so the task is in the name
  (`impl-<prefix>-<task>`). `own_cpu_s` is the agent's own process; `programs` its commands, by program,
  each with the CPU of its own workers that exited (a test runner's or a build's forks count for it);
  `short-lived` the agent's own commands no poll saw alive (shorter than 5 s). `cpu_s` is their sum.
- CPU seconds come from cumulative counters, kept as the largest value seen per process, so a
  sample counted twice adds nothing and a total never goes down. A process that leaves the tree without
  being reaped in it (a detached server, reparented to init) keeps what it had used until then; what it
  uses afterwards is not counted. A file of another `version` is started afresh. Memory is in MB of RSS: `peak_*` the largest sample, `avg_*` weighted by
  the time since the sample before, at most 15 s (the app may have been closed). The run's own peak and
  average are of the sum of its agents at each sample. `seconds` is the time samples cover.
- `estimated: true` (macOS): no exited commands are known, so CPU totals are what the polls saw.
- `raw` is the bookkeeping these come from; read the other fields.
- Writes go to a temporary file and `mv`, under a `.resources.json.lock` directory, and only when the file
  still has the `sampled_ms` the poll read, so two windows polling at once cannot interleave or count twice.
  `raw` keeps per-process bookkeeping only for terminals still alive, so the file grows with agents, not time.

## Run history: .history.jsonl

When Harbormaster sees a run's `closed` marker (whoever wrote it) and, if no line is there yet, just before
it deletes the run, it appends one line to `.history.jsonl` in the runs root of the run's machine, so
the stats view can show runs whose directory is gone. A parked run is not written, as it may resume.
One JSON object per line, built from `timing.sh`, `status.json` and `.resources.json`; a piece that is not
known is `null`:

```json
{"v": 1, "run": "<run directory>", "folder": "...", "branch": "...", "type": "feat", "topic": "...", "machine": null,
 "started": "<ISO>", "ended": "<ISO, timing end>", "closed": "<ISO, the closed marker's time, or the delete time>",
 "status": "<plan status at close>", "tasks_merged": 5, "tasks_planned": 5,
 "wall": 7200, "critical_path": {"agent_wait": 5000, "idle": 300}, "categories": {"test": 900, "model": 4000},
 "tasks": [{"id": "t1", "total": 900, "categories": {}, "cpu_s": 120.5, "peak_rss_mb": 800.0}],
 "agents": [{"name": "impl-x-t1", "role": "impl", "task": "t1", "kind": "claude", "total": 900, "categories": {},
             "cpu_s": 120.5, "peak_rss_mb": 800.0, "avg_rss_mb": 500.0}],
 "tokens": {"total": 0, "input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
 "resources": {"cpu_s": 0, "peak_rss_mb": 0, "avg_rss_mb": 0, "estimated": false, "programs": {"test runner": {"cpu_s": 0, "peak_rss_mb": 0}}},
 "recorded": "<ISO>"}
```

- A run's key is `run` + `started`. A line is added once per closing (`closed` differs): a run resumed and
  closed again gets a second line, and readers keep the last line per key.
- A run closed, resumed and deleted while open (never closed again) has no line for its second stretch: the
  delete finds the first closing's line and writes nothing.
- A closed run already closed when Harbormaster started is written at most one a minute per machine, one
  timing read at a time; one whose logs cannot be read is written without timing on its second failure.
- Agents are matched between timing (worktree names, labels like `impl-x-t1`) and resources (terminal names)
  by label or name; the orchestrator is the terminal with no parent. A task's `cpu_s` is its agents' sum and
  its `peak_rss_mb` the largest of theirs.
- Written under a `.history.jsonl.lock` directory (a lock older than a minute is broken), one write of one
  line, after checking the file for the closing. Readers skip lines that do not parse. Nothing else rewrites
  the file.
- A failure never blocks closing or deleting: a closed run whose timing cannot be read is tried again later,
  and a delete waits at most 90 s for the write.

## Soft budget

`set-status.sh --budget <tokens>` (`30M`, `50M`, `500k`, `1.5M` or a plain number; `""` clears it) stores
`budget` in `status.json`, a number compared with `tokens.total` (cache reads included, and they dominate: a run of a few tasks is tens of millions, so `30M` or `50M` are realistic, `2M` is crossed in the first turns). It is soft:
nothing stops by itself. The orchestrator sets it at the start when the user gave `budget=`.

Every `set-status.sh` call checks it after the token count. When `tokens.total >= budget` and
`budget_asked` is not this budget, it records `budget_asked: <budget>` and prints one line:
`over budget: <total> of <budget> tokens; ask the budget question (run-files.md)`. It prints once per
budget value, so raising the budget arms it again. It never writes `question.md` (one may be open).
Harbormaster marks a run over budget from `status.json` alone (`2.9M tok (+28M cached) · 31M/30M budget`, in the blocked colour),
even when the orchestrator is gone.

On that line the orchestrator asks this question, at any autonomy level (it is always yours to decide,
and the captain does not answer it):

```markdown
# Over the token budget: <total> of <budget>. Continue, compact or stop?

## Question
<where the run stands: tasks merged, what is left, the biggest token users>

## Options
1. **Continue**: raise the budget and carry on; reply with a new number, else it doubles
2. **Compact**: compact the orchestrator's context, then carry on
3. **Stop**: finish the current step, commit and push everything, then park the run

## Recommended
<Continue when most tasks are merged, else Compact>: <why, one line>

## Evidence
<tokens.by_agent, tasks done/planned>

## Risk
<what each choice costs; Stop is resumable>

## Blocks
Nothing: it is a soft budget
```

Whatever the answer, run `set-status.sh --budget-answered` (it records `budget_answered`, the budget the
question was for, so Harbormaster stops offering it; given together with `--budget` it is still the old budget, so the new
one's crossing is asked again):

- **Continue**: `set-status.sh --budget <the number in the answer, else twice the old one> --budget-answered`, then carry on.
- **Compact**: the answerer has already put the answer in `inbox/`, typed `/compact` into the orchestrator's
  terminal (Claude Code and pi take it as input) while it was idle or done, never working or blocked, and
  woken it only once the compaction was over (an answer typed meanwhile may be queued or lost). After the
  compaction, re-read the skill, `spec.md`, `plan.md` and `decisions.md` (as always), run
  `set-status.sh --budget-answered`, then carry on.
- **Stop**: finish the current step, commit and push everything, run `set-status.sh --budget-answered`,
  set the status to `blocked: stopped at budget` and end the turn. The user resumes it later (and may raise
  the budget first).

Read every `set-status.sh` call's output: the line is printed once and `budget_asked` is already recorded.
A resumed orchestrator whose `status.json` has `budget_asked` equal to `budget` and no matching
`budget_answered` has not had its question answered: it asks it (or finds it in `question.md`).

When a run is over budget with no `question.md` (the orchestrator is gone, or idle or done without having
asked), and `budget_answered` is not this budget, Harbormaster shows the same three options in its queue
and answers them through `inbox/`. It does not while the orchestrator is working (it may be about to ask),
nor when the run needs you for another reason (a dialog, `blocked: stopped at budget`): that reason shows
instead. Its Compact button is enabled only while the orchestrator reports idle or done, and writes the
answer, sends `/compact`, waits (up to 10 minutes) for the compaction to end, then wakes it.

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
