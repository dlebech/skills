# Recover from a crash, or resume a run

Read this when `init-run.sh` prints `existing`: a run that crashed, or one the user parked, closed, or whose tab they closed, then resumed with `/herdr-app-orchestrator <run-directory>/spec.md`. It is the skill's section 7.

1. Run `init-run.sh` first, since your terminal changed, from the `folder` in the run's `orchestrator.json` (the repository's own checkout, not the integration worktree), so it finds the same run directory and makes a parked or closed run active again.
2. Options given after the `spec.md` path (such as `ask=text` from the captain) apply when `spec.md` does not set them; `spec.md` wins. Write any you apply into `spec.md`. Re-read `spec.md`, `plan.md`, and `decisions.md` from the run directory, and act on any unhandled `.message` files in `inbox/` ([inbox.md](inbox.md)).
3. Run `integration-worktree.sh` for each repository as in the skill's section 1 step 6, which reopens the integration space if the user closed it. Over ssh it warns that it could not reach the user's window: that is expected; do not retry or report it.
4. If `status.json` has no `type` or no `topic`, publish them ([status.md](status.md)).
5. An unanswered `question.md` still stands: ask it again unless an `inbox/` message answers it. If `plan.md` says `waiting for user` or `blocked` with no `question.md`, write the question the status stands for and ask it, or, with nothing to ask and the plan done, finish (the skill's section 8), so the resumed run shows what it needs.
6. If `budget_asked` in `status.json` equals `budget`, without a matching `budget_answered`, the run is over budget: ask the budget question ([status.md](status.md#soft-budget)).
7. Your agents ended with the old orchestrator, and any report that had not reached `plan.md` is lost. List `hc ls --all`, worktrees, branches (local, and remote when task branches are pushed; worktrees hold unpushed work), and uncommitted changes, and reconcile them with `plan.md`: git wins where they disagree.
8. Remove finished terminals of this run, restart each unfinished task in its existing worktree, and tell each new agent exactly what state it is in, and to read the task's notes file `shared/impl-<prefix>-<task>-notes.md` first when one exists, and to keep writing to it, then resume.
