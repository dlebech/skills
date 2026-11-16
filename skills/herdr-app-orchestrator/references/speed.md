# Speed rules

Short rules that make a run faster without weakening its proof. SKILL.md points here.

## 1. Verify once per commit

Every test, lint or build run that backs a claim is recorded with the commit it ran on, as one line
in the proof file (`shared/proof/<task>-<what>.txt`, and in `proof.md`'s section as `Ran:`):

```
Ran: <short sha> <command> — <result>
```

Example: `Ran: 45084ea bash tests/herdr-app-captain/runs-live.sh — pass (12 checks)`. Use the sha of the
commit the command ran against, from a clean tree (`git rev-parse --short HEAD`). A failing run
is recorded too (`— fail: <one line>`), and the output goes in the file beside it.

Reviewers and the orchestrator reuse a `Ran:` line instead of rerunning it when its sha is the
branch's current HEAD (or the integration commit that squashed the same tree) and the command is
the one they need. They rerun only when the sha changed, the line is missing, or the result is not
`pass`. Say in the review brief which `Ran:` lines exist.

## 2. Targeted tests, full suite once

Task agents run only the tests for what they changed (and what directly depends on it), plus the
syntax or type checks of the files they touched. The full suite runs once on the integration
branch, after the last task is merged and before the final review or PR, plus CI. A red full run
becomes a fix task. Put this in `common.md`'s definition of "done".

## 3. No separate review for T0 tasks

A task gets no task review only when the plan explicitly marks it `Proof: T0` and you judge it
wording, docs or config with no change in behaviour. T0 is also the default tier, so the run's
default or a missing `Proof:` line never skips a review. After its `done` report, verify it as in section 3 step 7 and merge. The final review
covers it. With `final-review=no`, a run that merged T0 tasks without a task review still gets
a final review of the branch (`task-review=no` already turns it on); skipping it means asking
the user, once, at the start (`final-review=no` is honoured only after that answer). Record the choice in `decisions.md`.

## 4. Grunt agents: cheaper models for watching commands

`grunt=<kind>` and `grunt-model=<model>` (same kinds and model forms as the other profiles) set a
profile for work that never edits files. Without them, nobody is started as a grunt and everything
works as before.

A grunt is named `grunt-<prefix>-<task>` (`-<n>` for more than one), starts in the task's worktree
(or the integration worktree) and only:

- runs and watches commands: tests, lint, type checks, builds, CI (`gh pr checks --watch`);
- boils a failure down to the failing test or file, the message, and the likely cause, in a file in
  `shared/` for the implementer;
- gathers proof: records `Ran:` lines and output in `shared/proof/`.

Every file change in the repository, lint auto-fixes included, stays with the implementer or
fixer. Use a grunt when a run is long or slow (full suite, CI, builds) and the implementer would
otherwise sit waiting; skip it for a quick command.

Keeping it from editing:

- The brief says: do not change files in the worktree, report instead; never run `--fix`, a
  formatter, `git add`, `git commit` or `git checkout`; write only to `shared/`.
- `claude`: also start it with `--arg --disallowedTools --arg "Edit,Write,NotebookEdit,Bash(git add:*),Bash(git commit:*),Bash(git checkout:*),Bash(git restore:*),Bash(git stash:*)"`.
  `start-agent.sh` passes `--arg` values through to `claude` before the task prompt. This only blocks
  those tools (it also overrides the `shared/` Edit/Write allow; the grunt reports through the
  shell). Bash can still write anywhere (`sed -i`, `tee`, formatters), so only the brief
  constrains the shell.
- `pi` and `opencode` have no such flag: the brief is the only guard.
- For every kind, after a grunt's `done` report check `git status` in the worktree and discard
  any changes it made.

Harbormaster shows a live grunt on its task as stage "implement" (the `grunt-` name is recognised, no stage of its own).
