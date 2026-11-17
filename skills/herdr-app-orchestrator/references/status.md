# set-status.sh: the status, the tab, and the run's facts

Read this before your first `set-status.sh` call of a session, and when you need a flag you have not used yet. The skill's section 2 says when the status changes; this file says what the script does and what each flag is for. What the files it writes hold is in [run-files.md](run-files.md).

## The status and your tab

`<skill-dir>/scripts/set-status.sh <run-directory> "<status>"` sets `plan.md`'s Status line and also renames your tab, so the user sees it in Herdr's Agents list: `🐙 <name>` while running, `🐙 ✋ <name>` when waiting for the user or blocked, and `🐙 ✓ <name>` when finished, where `<name>` is the run's type and topic (`🐙 rev · Triage decision`), or the integration branch until there is a topic. It refuses `waiting for user` without a `question.md`.

When the user's Herdr window is on another computer, connected over ssh, `herdr-app` cannot reach it and the script warns that it could not rename the tab: that is expected, since Harbormaster in the user's window renames the tab from `plan.md` and `status.json`. Do not retry or report it.

## The run's facts

The same script publishes the run's other facts, to `status.json` in the run directory and to labels on your terminal, for the captain, for anything the user builds on Herdr's lists, and as the record of a finished run. Pass them with or without a status, whenever one changes; each is kept until changed. Keep `--progress` and the status to one line.

- `--type <feat|fix|rev|expl>`: what kind of run it is, with the topic, and again whenever it changes, such as an exploration that turns into building the feature, so the user can tell reviews from features at a glance. `rev` when the run reviews work it did not write, such as a PR or branch; `fix` when it fixes a bug or regression, such as issues labelled as bugs; `expl` when it investigates or explores with no change to ship as the goal; `feat` otherwise, unless the `type` argument names one.
- `--topic "<1-3 words>"`: what the run is about, as soon as you know it, before the start-of-run questions, and again if the user changes the goal, so the user can tell runs apart when scanning Harbormaster's Crew block, which shows it beside the issue or PR number. The change itself in the user's words and language, at most 16 characters, since a longer one is cut off, with no issue number, branch, repository, type, or status, since the row shows those (`Road routes`, `Login redirect`, `Invoice CSV`).
- `--issue <url>`: each issue the run works on, once the spec names them.
- `--tasks <merged>/<planned>`: when the plan is made and after every merge.
- `--progress "<one line>"`: whenever you start a new step.
- `--pr <owner/repo> <url>`: as soon as a repository's PR exists, for the run's own PRs only.
- `--related <owner/repo> <url>`: each PR the run is about but did not open, such as the PR a review-only run reviews or one the run depends on.
- `--waiting "<agent names>"`: while agents wait for an answer from you or the user, naming every one each time, since it replaces the list; `--waiting ""` once none do.
- `--autonomy L0|L1|L2`: at the start, and when the user changes it (the skill's section 6).
- `--budget <tokens>` and `--budget-answered`: below.

## Soft budget

With `budget=<tokens>`, start with `set-status.sh --budget <it>`. Read every `set-status.sh` output: the `over budget: …` line prints once. When it does, ask the budget question (Continue, Compact or Stop; template in [run-files.md](run-files.md#soft-budget)) whatever the autonomy level, and carry out the answer, then run `set-status.sh --budget-answered`. On resume, `budget_asked` equal to `budget` without a matching `budget_answered` means ask it.
