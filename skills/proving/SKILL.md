---
name: proving
description: Capture proof that a task, branch or PR works, for a tier T0–T3 (tests, test output, screenshots, demo), and write the PR's Evidence section.
argument-hint: "[tier T0-T3] [run=<run-directory>] [task, branch or PR to prove]"
---

Capture evidence that a change works, at the depth a tier asks for, so a reviewer can trust it without redoing it. Proof is a review aid: record what was checked and what happened, honestly, including what could not be checked.

## 1. Pick the target and tier

`$ARGUMENTS` is free text: a tier (`T0`–`T3`), optionally `run=<run-directory>` (the orchestrator passes it), and what to prove (a task, a branch, a PR). Default tier `T0`; default target the current branch. In an orchestrator run, take the tier from the task's `Proof:` line in `plan.md`.

| Tier | Evidence |
| --- | --- |
| T0 | Tests green (CI, or the repo's local suite). |
| T1 | Tests green, plus output for the changed behaviour. |
| T2 | Tests green, output for the changed behaviour, and screenshots or a recording. |
| T3 | Tests green, output for the changed behaviour, screenshots or a recording, and a guided demo. |

Each row stands alone and is cumulative. Harbormaster shows these texts on hover over a tier tag: they are copied into `herdr-app/mods/harbormaster/proof.js` (`TIER_TEXT`) and `tests/herdr-app-harbormaster/tiers.sh` fails when the two differ, so change both together.

## 2. Find where proof goes

- `run=<run-directory>` in the arguments wins: use it when it holds an `orchestrator.json`. You often work in a task or integration worktree, whose folder and branch are not the run's, so the path cannot be derived there.
- Otherwise derive it. Root: `${HERDR_ORCHESTRATION_ROOT:-~/.herdr/hc-orchestration}`. The run directory is `<root>/<repository name>/<integration branch, with / and the like as ->`, where the repository name is the main checkout's folder: `basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`, the same from any worktree. If it holds an `orchestrator.json`, you are in a run: files go in `<run>/shared/proof/`, the summary in `<run>/proof.md`.
- Otherwise: `${TMPDIR:-/tmp}/proof-<branch as ->/`, with the files and `proof.md` together in it.

Never commit proof or put it in the repository. Name files `<task-id>-<what>.<ext>`.

## 3. Capture, by tier

1. **T0**: find the repo's checks (CI workflow files, `README`, `CLAUDE.md`/`AGENTS.md`, `package.json` scripts, `Makefile`) and run them. With a PR, `gh pr checks <pr>` counts for CI. Save the command and its output. Finding none is `partial` with the note `no checks found`, never `pass`.
2. **T1**: run the specific tests or commands for the changed behaviour, with realistic input (old and new formats where it matters). Save command and output, and a before/after when the change is a fix.
3. **T2**: screenshot or record the change working, with the first of these that exists: a browser tool (a browser MCP, Playwright), the app's own capture (`herdr-app shot` for a Herdr mod, if `command -v herdr-app` finds it; see its `--help`), or a terminal capture for a CLI. Look at each image before keeping it.
   For a Herdr mod, never switch the user's space or tab to get the shot. Harbormaster (if installed) shows one run's pane as a brief centered dialog: `herdr-app do 'harbormaster.show-run:<branch>'`, wait a second, `herdr-app shot shared/proof/<name>.png`, then `herdr-app do 'harbormaster.close-popup'` (about a second in all; it closes itself after a minute). For another mod's view, open its overlay the same way if it has one, else say the shot was skipped. Without Harbormaster or a shown copy of it the popup doesn't appear: look at the shot before keeping it, and mark `partial` if it shows something else.
4. **T3**: a short guided demo with the `demo-video` skill if available; without it write `T3 demo skipped: demo-video skill not available` and mark `partial`. A change with nothing to see (a script, a library) gets a terminal walkthrough of real commands instead.

A missing tool is never a silent skip: note it in one line in `proof.md` (`T2 screenshot skipped: no browser tool available`) and mark the result `partial`. A failing check is `fail`, with the output saved; do not retry until it passes without saying so.

## 4. Write proof.md

One section per task (or one for a plain branch), in this shape. Update the section rather than adding a second one, and set the top `Tier:` to the highest tier of its tasks. Write the `Checks:` line too: `green` or `red`, then what ran (CI or the local suite); Harbormaster shows it in the verdict line.

```markdown
# Proof: <branch>
Tier: T2
Checks: green — <what ran>

## <task id> <task name>
Tier: T1
Checked: <what was checked>
Result: pass | fail | partial — <one line>
Files: shared/proof/<file>, shared/proof/<file>
Ran: <short sha> <command> — <result>
```

Record every test, lint or build run as a `Ran:` line with the sha it ran against (`git rev-parse --short HEAD`, clean tree); the result is `pass` or `fail: <one line>`. Reuse a line only when its sha is HEAD, or `git diff --quiet <sha> HEAD` (same tree), the tree is clean, and the result starts with `pass`; otherwise rerun.

`Files:` is comma-separated paths only; put notes in `Checked:`. Use `##` only for task sections.

## 5. The PR's Evidence section

Write `## Evidence` text from `proof.md`: per task, what was checked, the result and the local file names (proof is not hosted, so say they are local). Hand it to the caller (the orchestrator puts it in the PR body), or when asked, update the PR body yourself with `gh pr edit`, replacing only that section: read the body with `gh pr view <pr> --json body -q .body`, swap the text from `## Evidence` to the next `## ` heading, and write it back with `gh pr edit <pr> --body-file -`. Do not paste screenshots or logs into the PR; describe them.
