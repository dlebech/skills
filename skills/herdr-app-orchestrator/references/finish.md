# Finish: final review, PR, CI, finished

Read this when every planned task is merged, or the plan is done and you have nothing to ask. It is the skill's section 8. Keep the integration worktree and branch intact for the final review. Merging the PR is never automatic: it is the user's.

## 1. Full suite and final review

Run the full test suite once on the integration branch, reusing a `Ran:` line for its HEAD if there is one ([speed.md](speed.md) §1–2).

If `final-review` is on, or T0 tasks merged without a task review ([speed.md](speed.md) §3), review the whole integration branch after every planned task is merged, once per `review-rounds`:

- Start a fresh agent with the reviewer profile (or the specialist profile for a large branch) named `rev-<prefix>-final` in the integration worktree, or with several repositories, in the first one with the others' paths in its task.
- Name a code-review skill in its task as in the skill's section 4 (`<skill-dir>/scripts/review-skill.sh <kind> <integration worktree>`).
- It reviews `<default>...<integration>` in each against `spec.md` for what per-task reviews miss: bugs across task and repository boundaries, such as an API and its client disagreeing, unmet acceptance criteria, duplication across tasks, dead code, inconsistencies, modules grown too large. Same rules as the skill's section 4: read-only, findings to a file, at most about 15.
- Triage them, and fix must-fix findings as one more task with no task review.
- With rounds left, remove the reviewer and start another fresh one, named `rev-<prefix>-final-<round>`, on the branch with those fixes merged.
- After the last round, let the user pick among the nice-to-haves, or record them as follow-ups.
- After each final review round, append `Reviewed: <short sha of the HEAD it reviewed> final review — <result>` to `proof.md`'s header (run-files.md); Harbormaster warns the user in amber when commits come after the latest one. Every whole-branch review gets such a line, also one run after more work arrived once the run had finished: Harbormaster reads only header lines that start `Reviewed: <sha>`, so a review written another way (`Reviewed (round 3): …` under a claim, with no sha) leaves it counting the commits since the last line it can read.
- Fix check: when the last round's must-fix fixes are merged, the fixer's commits come after that line. Keep the last round's reviewer until then, and ask it to review only `<reviewed sha>..HEAD`: is each must-fix finding fixed, and does the fix diff break anything? It looks for nothing else, stays read-only, and writes its answer to a file. If that reviewer is gone, start a fresh one, `rev-<prefix>-final-check`, with the findings file, your triage decisions and that range. Skip the fix check when the last round fixed nothing, and after earlier rounds (the next round reviews their fixes).
- If the fix check passes, append `Reviewed: <short sha of HEAD> final review (fix check) — <n> of <n> fixed`. If it fails, append no line, so Harbormaster stays amber (it ignores the result after ` — `, so a `Reviewed:` line for a failed check would show the fixes as reviewed), and do not fix again: name what is not fixed in the finish report and the PR's follow-ups. The rounds and this one check are the only review of the review fixes; do not loop.
- Remove the final reviewer and any fixer once they are done.

## 2. Push and open the PR

Push each integration branch. Create or update one PR per repository when requested or all planned work is complete. With several, each PR links the others and says they merge together; put the `Closes` lines only in the one meant to merge last, and `Part of` lines in the rest. Start the body with the issue lines from `spec.md`'s Issue handling ([issues.md](issues.md)), one per line at the very top before anything else, so they are easy to scan. Then include:

- a short statement of the goal from `spec.md`;
- a table of the merged tasks;
- `## Evidence`, written for the PR's reviewer: what they can see or rerun, never local proof files (rules in `proving` §5, or [run-files.md](run-files.md#the-pr-body-evidence-and-merge-danger) without the skill). For tasks of tier T1 and above, capture what is missing with the `proving` skill if available, passing it `run=<run-directory>`, else the same way yourself;
- `## Merge danger`: one line, `One-way door` or `Two-way door`, then ` — ` and the blast radius (formats in [run-files.md](run-files.md#the-pr-body-evidence-and-merge-danger));
- decisions to check, yours and the user's;
- a pre-launch or deploy checklist (migrations, new env vars, schedules, manual steps);
- follow-ups.

Publish each PR with `set-status.sh <run-directory> --pr <owner/repo> <url>` as soon as it exists. Without a GitHub remote or `gh`, print the description for the user to paste.

## 3. Watch CI

Watch each PR's CI to the end, with `gh pr checks <url> --watch --interval 60` run with `hc run --bg`, so you stay reachable. Keep the 60 s interval: each check is several GraphQL requests, so the default 10 s spends the account's hourly rate limit, which Harbormaster and the user share, and CI takes minutes anyway. Fix a red build in a short-lived worktree like any change, push, and watch again. After pushing more commits to an open PR, update its `## Evidence` so the commit and counts match the head (`proving` §5's `gh pr edit` way). If you cannot make it green, ask the user (the skill's section 6) instead of finishing. Without CI, go on.

## 4. Finished

Set the status to `finished` with `set-status.sh`, then report each integration branch/worktree and PR, completed tasks, validation status, remaining work, and for issues their status as in `spec.md`'s Issue handling. Do not present task branches for review.

Then end your turn and stay open: the user closes your tab when the run is over. If they give you more work, set the status to `running` and carry on as before, finishing again the same way. Leave the integration space open; closing the run removes it. A parked or closed run comes back the same way when resumed ([recovery.md](recovery.md)).
