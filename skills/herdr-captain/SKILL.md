---
name: herdr-captain
description: "Oversee several running herdr-orchestrator runs across Herdr: report how each is doing, watch them in the background and alert the user when one needs attention, and relay the user's instructions to the right orchestrator."
disable-model-invocation: true
argument-hint: "[question or instruction, e.g. \"how are we doing?\" or \"tell issue-185 to use pnpm\"] [watch=yes|no]"
compatibility: Requires jq, Herdr, the herdr agent skill, and runs started by herdr-orchestrator.
metadata:
  required-skills: "herdr"
---

Act as the captain over several orchestrators. The user talks to you about all their runs at once; each orchestrator still runs its own agents. Answer `$ARGUMENTS`, start watching the runs (unless `watch=no`), and stay available for more questions and instructions.

## Invariants

- Load the `herdr` skill before issuing any Herdr command, and follow its environment check, identifier handling, focus, and safety rules. If not running in a Herdr-managed pane, stop and tell the user to invoke this skill from one.
- Talk only to orchestrators, never to their implementers, reviewers, or fixers. Every agent keeps one boss.
- Do not change code, worktrees, branches, or briefs, and do not start, stop, or close agents, unless the user explicitly asks for that one action.
- Do not answer an orchestrator's question for the user unless the user's own words decide it.
- Watch in the background, never in the foreground, so the user can talk to you at any time.

## Find the runs

Run `<skill-dir>/scripts/runs.sh`. It reads every run directory under `${XDG_CACHE_HOME:-~/.cache}/herdr-orchestrator/` that has an `orchestrator.json`, and for each prints the branch, repository, the `Status:` line of `plan.md`, the orchestrator pane's Herdr state and progress label, and unhandled markers (or warns when Herdr did not answer). It skips finished runs unless given `--all`. It also lists `orc:` tabs that no run directory claims, for example orchestrators started before they recorded themselves; inspect those with `herdr agent read` on the tab's panes.

Each run directory holds `spec.md` (the goal), `plan.md` (tasks and their status), `decisions.md`, and `status/` (markers). Read them for detail rather than asking the orchestrator; it is busy.

## Report

Lead with what needs the user, then the rest, one or two lines per run, named by branch:

- **Needs you:** `plan.md` says `waiting for user`, or the orchestrator pane is `blocked`, or it is `idle`/`done` while the plan is not finished. For an idle one, read its last output (`herdr agent read <pane> --source recent-unwrapped --lines 60`) and quote its question. Text shown in its input box may be Claude Code's suggested next prompt, not something the user typed; ignore it.
- **Stalled or crashed:** the orchestrator pane is gone, or idle with no question and no recent change in `plan.md`. Say what the run directory shows and how to resume: `/herdr-orchestrator <run-directory>/spec.md` in a new Herdr pane.
- **Running:** the plan position (tasks merged out of planned, what is in progress) and the progress label. A `working` orchestrator usually sits in a foreground wait; that is normal.

Unhandled `.question` markers are questions sub-agents asked their orchestrator; they are the orchestrator's to answer, so mention them only when they have been waiting long. When the user asks about one run, go deeper: per-task status, recent decisions, and what is left.

## Relay instructions

When the user gives an instruction for a run:

1. Identify the run. If the instruction could fit several, ask which.
2. Write it, in the user's words with any context you add marked as yours, to `<run-directory>/status/.captain-<unix-time>.tmp`, then `mv` it to `captain-<unix-time>.message` in the same directory, so the orchestrator never reads it half-written. The orchestrator's foreground wait returns on it within seconds, and it also checks for messages between steps.
3. If the orchestrator is `idle` or `done`, it is not waiting and will not see the file; also prompt it: `herdr agent prompt <pane> "Read and act on <message-file>."` If it is `blocked` on a dialog, tell the user which tab to answer in rather than pressing keys for them.
4. Check that the orchestrator picked it up (the message is renamed to `.handled`) the next time you look, and report what changed, from `decisions.md` or `plan.md`. A message still unhandled after a few minutes means the orchestrator is not waiting or checking; prompt it as in step 3.

An answer to an orchestrator's question is relayed the same way. An instruction for every run goes to each one as a separate message.

## Watch the runs

After your first report, start `<skill-dir>/scripts/watch-runs.sh` as a background job that wakes you when it exits (for Claude Code, a background Bash command; not Monitor, which would need a stop condition). Keep exactly one running. It checks every 30 seconds and exits as soon as a run newly needs the user, printing one line per event:

```
attention <branch> <reason>	<run-directory>
```

Reasons are the plan's `waiting for user` or `blocked` status, `finished`, the orchestrator gone, blocked on a dialog, or idle for two minutes with an unfinished plan, a sub-agent's `.failed` marker, and a sub-agent question its orchestrator has left unhandled for 30 minutes. Each event is reported once, and again only after it has cleared and come back. Its memory of reported events and idle orchestrators lives in the runs root, so restarting it neither repeats events nor resets the idle timer.

When it wakes you:

1. Look at each run it names, as in Report, so the alert says what is needed and not only that something is.
2. Tell the user in a few lines, needs-you first, and show a Herdr notification: `herdr notification show "herdr-captain" --body "<branch>: <one-line reason>" --sound request`. Ending your turn after that marks your tab Done, which is the user's cue.
3. Start the watcher again.

If it exits with an error (for example, Herdr stopped answering), say so and restart it once; if it fails again, stop watching and tell the user. Stop when the user says so, or offer to when no unfinished runs are left.
