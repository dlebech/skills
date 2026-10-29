---
name: herdr-captain
description: Oversee several running herdr-orchestrator or herdr-issue-orchestrator runs across Herdr: report how each is doing, say which need the user, and relay the user's instructions to the right orchestrator.
disable-model-invocation: true
argument-hint: "[question or instruction, e.g. \"how are we doing?\" or \"tell issue-185 to use pnpm\"]"
compatibility: Requires jq, Herdr, the herdr agent skill, and runs started by herdr-orchestrator.
metadata:
  required-skills: "herdr"
---

Act as the captain over several orchestrators. The user talks to you about all their runs at once; each orchestrator still runs its own agents. Answer `$ARGUMENTS`, then stay available for more questions and instructions.

## Invariants

- Load the `herdr` skill before issuing any Herdr command, and follow its environment check, identifier handling, focus, and safety rules. If not running in a Herdr-managed pane, stop and tell the user to invoke this skill from one.
- Talk only to orchestrators, never to their implementers, reviewers, or fixers. Every agent keeps one boss.
- Do not change code, worktrees, branches, or briefs, and do not start, stop, or close agents, unless the user explicitly asks for that one action.
- Do not answer an orchestrator's question for the user unless the user's own words decide it.
- Work on demand. Do not start a waiting loop of your own unless the user asks you to keep watch.

## Find the runs

Run `scripts/runs.sh` from this skill's directory. It reads every run directory under `${XDG_CACHE_HOME:-~/.cache}/herdr-orchestrator/` that has an `orchestrator.json`, and for each prints the branch, repository, the `Status:` line of `plan.md`, the orchestrator pane's Herdr state and progress label, and unhandled markers. It skips finished runs unless given `--all`. It also lists `orc:` tabs that no run directory claims, for example orchestrators started before they recorded themselves; inspect those with `herdr agent read` on the tab's panes.

Each run directory holds `spec.md` (the goal), `plan.md` (tasks and their status), `decisions.md`, and `status/` (markers). Read them for detail rather than asking the orchestrator; it is busy.

## Report

Lead with what needs the user, then the rest, one or two lines per run, named by branch:

- **Needs you:** `plan.md` says `waiting for user`, or the orchestrator pane is `blocked`, or it is `idle`/`done` while the plan is not finished. For an idle one, read its last output (`herdr agent read <pane> --source recent-unwrapped --lines 60`) and quote its question.
- **Stalled or crashed:** the orchestrator pane is gone, or idle with no question and no recent change in `plan.md`. Say what the run directory shows and how to resume: `/herdr-orchestrator <run-directory>/spec.md` in a new Herdr pane.
- **Running:** the plan position (tasks merged out of planned, what is in progress) and the progress label. A `working` orchestrator usually sits in a foreground wait; that is normal.

Unhandled `.question` markers are questions sub-agents asked their orchestrator; they are the orchestrator's to answer, so mention them only when they have been waiting long. When the user asks about one run, go deeper: per-task status, recent decisions, and what is left.

## Relay instructions

When the user gives an instruction for a run:

1. Identify the run. If the instruction could fit several, ask which.
2. Write it, in the user's words with any context you add marked as yours, to `<run-directory>/status/captain-<unix-time>.message`. The orchestrator's foreground wait returns on it within seconds, and it also checks for messages between steps.
3. If the orchestrator is `idle` or `done`, it is not waiting and will not see the file; also prompt it: `herdr agent prompt <pane> "Read and act on <message-file>."` If it is `blocked` on a dialog, tell the user which tab to answer in rather than pressing keys for them.
4. Confirm once the orchestrator has picked it up: the message is renamed to `.handled`. Report what changed, from `decisions.md` or `plan.md`.

An answer to an orchestrator's question is relayed the same way. An instruction for every run goes to each one as a separate message.

## Keep watch, if asked

When the user asks you to watch the runs, check them with `scripts/runs.sh` on an interval the user accepts (or about every 10 minutes), and report only changes: a run that newly needs the user, stalled, or finished. Stop when the user says so.
