# Close a run

Read this when the user closes the run for good: through Harbormaster's Close button or `herdr-app-captain`, which put a message in `inbox/` saying so and wake you, or by telling you in your tab. It is the skill's section 9.

Closing means the run's agents and worktrees go; the run directory, its branches with work, and its PRs stay. Clean up after yourself, then end:

1. Rename the message to `.handled`, and set `--progress "closing"` with `set-status.sh`.
2. Stop and remove every agent and background terminal of this run, CI watches included (`hc kill`, then `hc rm`).
3. Make sure the code survives, since the worktrees are about to go: commit uncommitted work worth keeping to its branch, push each integration branch, and push each task branch whose work is not on the integration branch, even with `push-task-branches=no`. If something cannot be pushed, such as with no remote or a rejected push, delete nothing: ask the user (the skill's section 6) and wait for the answer.
4. Close the integration worktree's space, if one shows its folder in `herdr-app ls` (Harbormaster's Close already closed it): `herdr-app do space.close '{"id":"<space-id>","confirmed":true}'`. Do it before deleting the worktree: a space whose folder is gone can no longer be placed under its repository and shows as a space of its own.
5. Delete every worktree of the run, the task worktrees and the integration worktree, with `git worktree remove --force`. Ignored files such as `.env`, dependencies and build output are the worktree's and go with it. Never touch the repository's own checkout.
6. Delete each local task branch whose work is on the integration branch, merged or squashed. Keep the integration branch, locally and on the remote, and every branch with work found nowhere else, so the run can still be resumed.
7. Mark the run closed, finished or not: write `<time>\t<status>` (the time from `date -u +%Y-%m-%dT%H:%M:%SZ`, the status from `plan.md`) to `<run-directory>/.closed.tmp` and `mv` it to `closed`.
8. Report in a few lines what you deleted and what you kept and why, then close your own tab, the `tab_id` in `orchestrator.json` (or the tab holding your terminal in `herdr-app ls`): `herdr-app do tab.close '{"id":"<tab-id>","confirmed":true}'`. That ends you; do nothing after it.

`herdr-app` reaches only a Herdr window on this computer. When it cannot (`no Herdr window`), as when the user's Herdr runs on another computer connected over ssh, skip steps 4 and 8's `herdr-app` commands and do the rest. Harbormaster, in the user's window, closes the run's leftover space and, once your turn ends, your tab, as soon as it sees the `closed` marker. Say so in your report, and that without Harbormaster the user closes them by hand. Do not retry.
