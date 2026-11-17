---
name: proving
description: Capture proof that a task, branch or PR works, for a tier T0–T3 (tests, test output, screenshots, demo), and write the PR's Evidence section.
argument-hint: "[tier T0-T3] [run=<run-directory>] [task, branch or PR to prove]"
---

Capture evidence that a change works, at the depth a tier asks for, so a reviewer can trust it without redoing it. Proof is a review aid: record what was checked and what happened, honestly, including what could not be checked.

## 1. Pick the target and tier

`$ARGUMENTS` is free text: a tier (`T0`–`T3`), optionally `run=<run-directory>` (the orchestrator passes it), and what to prove (a task, a branch, a PR). Default tier `T0`; default target the current branch. In an orchestrator run, take the tier from the task's `Proof:` line in `plan.md`, and find the claims the task serves in its `## Claims` (`C1 <claim> — AC 3 — tasks t1, t3 — bar T3`): each claim's bar is its own `bar`, else the run's `Proof tier:`.

| Tier | Proved with |
| --- | --- |
| T0 | passing tests (CI, or the repo's local suite) |
| T1 | passing tests and their output for the changed behaviour |
| T2 | passing tests, their output for the changed behaviour, and screenshots or a recording |
| T3 | passing tests, their output for the changed behaviour, screenshots or a recording, and a guided demo where one can be recorded |

Each row stands alone and is cumulative. As a claim's bar, T2 asks for a screenshot (a clip will do) and T3 for a clip. Harbormaster shows these texts on hover over a tier tag, as a definition ("Proof tier T2 — proved with …"): they are copied into `herdr-app/mods/harbormaster/levels.js` (`TIER_TEXT`), and `tests/herdr-app-harbormaster/tiers.sh` and `levels.test.mjs` fail when the two differ, so change both together.

## 2. Find where proof goes

- `run=<run-directory>` in the arguments wins: use it when it holds an `orchestrator.json`. You often work in a task or integration worktree, whose folder and branch are not the run's, so the path cannot be derived there.
- Otherwise derive it. Root: `${HERDR_ORCHESTRATION_ROOT:-~/.herdr/hc-orchestration}`. The run directory is `<root>/<repository name>/<integration branch, with / and the like as ->`, where the repository name is the main checkout's folder: `basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`, the same from any worktree. If it holds an `orchestrator.json`, you are in a run: files go in `<run>/shared/proof/`, the summary in `<run>/proof.md`.
- Otherwise: `${TMPDIR:-/tmp}/proof-<branch as ->/`, with the files and `proof.md` together in it.

Never commit proof or put it in the repository. Name files `<task-id>-<what>.<ext>`.

## 3. Capture, by tier

1. **T0**: find the repo's checks (CI workflow files, `README`, `CLAUDE.md`/`AGENTS.md`, `package.json` scripts, `Makefile`) and run them. With a PR, `gh pr checks <pr>` counts for CI. Save the command and its output. Finding none is `partial` with the note `no checks found`, never `pass`.
2. **T1**: run the specific tests or commands for the changed behaviour, with realistic input (old and new formats where it matters). Save command and output, and a before/after when the change is a fix.
3. **T2**: screenshot or record the change working, with the first of these that exists: a browser tool (a browser MCP, Playwright), the app's own capture (`herdr-app shot` for a Herdr mod, if `command -v herdr-app` finds it; see its `--help`), or a terminal capture for a CLI. Look at each image before keeping it.
   For a Herdr mod, never switch the user's space or tab to get the shot. Harbormaster (if installed) shows one run's pane as a brief centered dialog: `herdr-app do 'harbormaster.show-run:<branch>'`, wait a second, `herdr-app shot shared/proof/<name>.png`, then `herdr-app do 'harbormaster.close-popup'` (about a second in all; it closes itself after a minute). `harbormaster.show-stats` (or `show-stats:<branch>`) shows the Stats view the same way. For another mod's view, open its overlay the same way if it has one, else say the shot was skipped. Without Harbormaster or a shown copy of it the popup doesn't appear: look at the shot before keeping it, and mark `partial` if it shows something else.
4. **T3**: a short guided demo with a demo-video skill when one is installed (the user's `demo-video`, or any skill whose name or description says it records demo videos); if it can't be invoked as a skill, read its SKILL.md and follow it. Without one, write the line `T3 demo skipped: no demo-video skill` in `proof.md` and do not mark the task `partial` for that alone: the demo is a soft extra. If the skill can't record this change (say a Herdr mod or a CLI) or fails, write one line `T3 demo skipped: <why>` and go on, again without `partial`. A change with nothing to see (a script, a library) gets a terminal walkthrough of real commands instead.

A missing tool is never a silent skip: note it in one line in `proof.md` (`T2 screenshot skipped: no browser tool available`) and mark the result `partial` (except the T3 demo, above). A failing check is `fail`, with the output saved; do not retry until it passes without saying so.

## 4. Write proof.md

In a run whose plan has `## Claims`, proof.md has one section per claim: update the `## C<n>` section of each claim the task serves (add it if it isn't there yet), never a second one. Write the evidence that shows the claim itself, what the user can now do, not just that something ran. Set the top `Tier:` to the run's tier and write the `Checks:` line: `green` or `red`, then what ran on the whole branch (suite, build, lint, CI); Harbormaster shows it as one line under the claims.

```markdown
# Proof: <branch>
Tier: T2
Checks: green — 1497 tests, build, lint, CI

## C1 Drag a card to reorder the list
Result: pass | fail | partial | pending — <one line>
Shot: shared/proof/t1-drag.png
Test: reorder moves the card — pass
Clip: shared/proof/t3-reorder.mp4
Ran: <short sha> <command> — <result>
```

`Shot:` (a screenshot; comma-separated paths are fine), `Test: <name> — pass|fail` (one test by name) and `Clip:` (a recording, for flows) are repeatable. A claim's result is `pass` only when its evidence meets its bar (a `Shot:` or `Clip:` at T2, a `Clip:` at T3); below it, Harbormaster reads "needs a screenshot" or "needs a clip".

Without claims (a plain branch, or an old run), write one section per task (or one for the branch) instead: `## <task id> <task name>`, then `Tier:`, `Checked: <what was checked>`, `Result:`, `Files: <comma-separated paths>` and `Ran:` lines.

Record every test, lint or build run as a `Ran:` line with the sha it ran against (`git rev-parse --short HEAD`, clean tree); the result is `pass` or `fail: <one line>`. Reuse a line only when its sha is HEAD, or `git diff --quiet <sha> HEAD` (same tree), the tree is clean, and the result starts with `pass`; otherwise rerun.

Use `pending — <why>` only while the claim's proof is still being gathered elsewhere (a later task takes its screenshots: `pending — waiting for t4`), and replace it with the real result once it is in; Harbormaster shows a pending claim as nothing for the user to do yet.

Paths go on their own lines; put notes in the `Result:` line. Use `##` only for claim (or task) sections.

A `proof-accepted.json` beside `proof.md` records the claims the user accepted as they are (from Harbormaster); leave it alone. An acceptance lapses by itself once a claim's `Result:` line changes.

## 5. The PR's Evidence section

Write `## Evidence` from `proof.md` for a reviewer of the PR, using the same claims: one line per claim (`C1 Drag a card to reorder the list — proven: <what was seen, or the tests by name>`), then the checks line, and the last review (`proof.md`'s latest `Reviewed:` line: which review, at which commit, and whether commits came after it, or that nothing was reviewed). It cites only what they can see or rerun:

- the checks: CI (linked or named), and the test, lint and build commands they can run, with counts and the commit (say when there is no CI);
- how to see the change themselves, when that is possible: a command, a sandbox, the URL of a preview deploy, steps in the app;
- what was checked by hand (screens, flows, sizes), as plain statements of what was seen, not references to files;
- what was not checked, honestly.

Never mention local proof files, `shared/proof/`, the run directory or "kept locally", and never claim media the reviewer cannot open. Those stay in `proof.md` for Harbormaster and the user. Proving never hosts media anywhere (no branches, gists or releases); if the user uploads media to the PR, it may be referenced. Do not paste logs into the PR.

Hand the text to the caller (the orchestrator puts it in the PR body), or when asked, update the PR body yourself with `gh pr edit`, replacing only that section: read the body with `gh pr view <pr> --json body -q .body`, swap the text from `## Evidence` to the next `## ` heading, and write it back with `gh pr edit <pr> --body-file -`.
