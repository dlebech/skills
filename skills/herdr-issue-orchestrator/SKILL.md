---
name: herdr-issue-orchestrator
description: Manually orchestrate a GitHub issue through Herdr worktrees, role-specific agent kinds and models, one independent review per task, and an integration branch that is the only PR branch.
disable-model-invocation: true
argument-hint: "<issue> [start with #dependency] [agent=<kind>] [model=<model>] [implementer/reviewer/specialist overrides] [merge=squash|merge] [push-task-branches=yes|no] [draft-pr=ask|yes|no]"
compatibility: Requires GitHub CLI, git, Herdr, and the herdr agent skill.
metadata:
  required-skills: "herdr"
---

Act as the sole coordinator for a larger GitHub issue. The user talks only to you; manage its agents, worktrees, reviews, fixes, and integration.

## Invariants

- Load the `herdr` skill before issuing any Herdr command. If that skill is unavailable, stop and tell the user to install it.
- Follow the `herdr` skill's environment check, command discovery, identifier handling, focus, and safety rules. If not running in a Herdr-managed pane, stop and tell the user to invoke this skill from one.
- Use Herdr worktrees for every code or documentation change.
- Create one integration branch from the repository's default branch. All completed task branches merge into it.
- Give each task its own branch and Herdr worktree, based on the current integration branch.
- Use the configured Herdr agent kind and model for each role.
- Review each task exactly once, in the same worktree, with a different agent process. The reviewer must not be the implementer.
- Fix all actionable review findings before integration, but do not run a second review.
- Never open a PR for a task branch. Only the integration branch becomes a PR.
- Do not ask the user to review task branches. The user reviews the final integration branch.
- Never commit bulky generated output (evaluation runs, recordings, reports, screenshots). Store it outside the repository and commit only a summary.

## 1. Establish the issue and integration branch

Parse `$ARGUMENTS` for the main issue, an explicitly named starting issue, constraints, options, and optional profiles. A profile is a Herdr agent `kind` (for example `claude`, `pi`, `opencode`, or `codex`) and, optionally, an accepted model:

- `agent=<kind>` and `model=<model>` are shorthand defaults for all roles.
- `implementer=<kind>` and `implementer-model=<model>` override implementation and fixes.
- `reviewer=<kind>` and `reviewer-model=<model>` override review.
- `specialist=<kind>` and `specialist-model=<model>` define an optional stronger profile for a user-assigned or unusually complex task.
- Natural-language equivalents are valid, including models for any other role by name, such as “use Sonnet for implementation, Haiku for review, Opus for complex tasks and for evaluating suggestions.”

Role overrides take precedence. With no configuration, use the orchestrator's agent kind when Herdr can identify it and its normal default model. If it cannot start that kind, ask the user which kind to use. Do not claim the orchestrator's exact model unless Herdr exposes it; if “the same model” cannot be detected, ask the user to name it.

Validate configured kinds with Herdr's current discovery. Select models through the chosen agent's documented Herdr startup arguments. If a requested model or argument cannot be verified, or the issue/kind is invalid, ask the user rather than silently substituting.

Options:

- `push-task-branches` (default `yes`): push task branches to the remote as a backup, so work survives a crash. Never open PRs for them. Use `no` when the remote must stay clean.
- `merge` (default `squash`): `squash` lands each task as one commit with a message you write, so the final PR's history reads like a reviewable changelog. `merge` keeps each task's full commit history in non-fast-forward merges, at the cost of a noisier PR.
- `draft-pr` (default `ask`): ask once at the start whether to open the integration branch as a draft PR right after the first merge. An early draft PR runs CI on every merge, which catches failures local runs hide.

Then:

1. Verify GitHub access with `gh auth status`.
2. Read the main issue and explicitly named dependencies with `gh issue view <number> --json number,title,body,url,labels,assignees,state`.
3. Discover the default branch with `gh repo view --json defaultBranchRef`.
4. Fetch it without changing the user's checkout.
5. Inspect existing branches and worktrees. Reuse an unambiguous integration branch/worktree; otherwise create a labeled one from `origin/<default-branch>` without taking focus.
6. Create a scratch directory outside the repository for briefs, review findings, the decisions log, and generated output.

Use the repository's branch naming convention if one exists. Otherwise use `issue-<number>`. Obtain workspace, pane, and path identifiers as directed by the `herdr` skill; never predict them.

## 2. Plan autonomously

Turn the issue and dependencies into the smallest independently implementable and reviewable tasks. Honor an explicit starting issue first, such as “start #12 with #10.” A task can be non-code (a measurement run, a recording, docs). It gets a worktree when it produces files, and a review only when it changes code or docs.

For each task, record:

- the acceptance criteria it satisfies;
- dependencies on other tasks;
- the files or subsystem it is expected to touch;
- a validation command or observable result;
- whether it can safely run in parallel.

Prefer sequential work for overlapping edit surfaces. Keep planning lightweight and update it as repository evidence changes. Do not stop for confirmation unless a product decision, missing credential, destructive action, or genuine ambiguity blocks progress.

Record every small product or design decision you make yourself (names, defaults, edge-case behaviour) in a decisions log, next to the user's own decisions.

## 3. Implement a task

Keep briefs as files in the scratch directory, and point prompts at them:

- `common.md`: rules every agent follows: environment, the checks that define “done” and how to run them the way CI does, browser-check and end-to-end test guidance, commit and push rules, and how to ask you a question.
- one brief per task: scope, acceptance criteria, what other agents are doing in parallel and which files to avoid, decisions already made, and how to measure success. Where quality is measurable (evals, benchmarks), say how to measure before and after and what counts as not regressing.
- one review template.

When a lesson applies to everyone, amend `common.md` once and notify the running agents.

For every ready task:

1. Ensure the integration worktree is clean and contains prerequisite merges.
2. Create a labeled task worktree from the integration branch without taking focus.
3. Isolate its runtime state before the agent starts: its own databases, ports, storage buckets, and env files, derived from the user's env with names and ports changed. Copy secrets only with the user's explicit permission. Assign shared, ordered resources (migration timestamps, sequence numbers, generated files such as schema types, lockfiles) and tell each agent which values are taken.
4. Start a uniquely named implementer in that worktree's root pane, using the specialist profile for user-designated or deliberately escalated tasks and the implementation profile otherwise.
5. Prompt it to read `common.md` and its task brief. Tell it to work only in its worktree, inspect existing code before editing, make a focused implementation with tests where appropriate, run the relevant validation, commit work in progress regularly, and stop and ask a precise question if blocked.
6. Prompt and monitor it according to the `herdr` skill. A `--wait` timeout does not prove failure; check the status before sending anything again.
7. Independently verify the branch is committed, clean, and satisfies the task's validation before review.

Run independent tasks in parallel only when their likely edit surfaces do not overlap. Do not start more simultaneous agents than can be monitored reliably, or than machine memory allows.

Agent gotchas:

- `done` or `idle` can mean the agent ended its turn while waiting on its own background job. Read its last output before treating it as finished. To wait for real completion, wait until it is `working` again, then wait for it to settle.
- Claude Code shows a suggested next prompt as ghost text in the input box. In a pane read it looks like an unsent user instruction. Ignore it, and clear it (`ctrl+u`) before prompting.

## 4. Review once, then fix

Create another pane in the task worktree's Herdr workspace and start a new agent with the reviewer profile and a distinct reviewer name. Do not reuse the implementer's pane or identity. The implementer and reviewer may use the same kind or model, but they must be separate agent processes. Review may start once the implementation is committed, while slow verification such as long end-to-end runs continues in parallel.

If the reviewer exposes a code-review skill, command, or equivalent, use it with the base branch and task requirements. Otherwise instruct it to inspect the task diff against the integration branch and report only actionable correctness, regression, test, security, and requirement findings. Give it the base branch, task requirements, the review template, and a prohibition on editing files. It writes verified findings to a file (most severe first, each with location, failure scenario, suggested fix, and must-fix or nice-to-have) and replies with one line.

Either approach is the task's one and only review pass. If the selected agent cannot inspect the repository or perform the requested review by either route, ask the user to select another reviewer profile; do not count that failed capability check as the task's review.

Triage the findings: decide each one (fix as suggested, fix differently, defer, reject), and send the file with your decisions to the original implementer. Ask it to fix, validate, and commit. Verify the branch and tests directly; do not review again. If the implementer is unavailable, start a fixer with the implementation profile in the same worktree. It receives the triaged findings and does implementation only. Record deferred findings as follow-ups.

## 5. Merge upward

When a task is implemented, reviewed once, fixed, committed, and validated:

1. Confirm the task branch contains only intended commits.
2. If it is behind and would conflict, have its agent merge the integration branch in its own worktree, resolve conflicts where its environment and tests are, and re-run its checks. This also fixes ordering clashes such as duplicate migration timestamps.
3. From the integration worktree, integrate it:
   - `squash`: write a message with what and why, the issue, and key numbers. Afterwards verify `git diff <task-branch> <squash-commit>` is empty.
   - `merge`: make a non-fast-forward merge with a message naming the task and issue.
4. Run the smallest integration-level validation that covers the merge. If a PR exists, push and watch CI. Fix a red build before merging more, in a short-lived worktree like any change.
5. Mark the task complete and use the updated integration branch as the base for dependent worktrees.
6. Clean up: exit the task's agents, then remove its worktree after checking it is clean, pushed if pushing is on, and identical to what was merged. Drop its throwaway resources, but move anything costly to rebuild, like caches, to the integration worktree or a backup location first. Idle agents still hold memory, so do not wait until the end.

Resolve straightforward mechanical conflicts in the integration worktree. If a conflict requires a product or design choice, ask the user before choosing.

Do not merge the integration branch into a task branch merely to make it current. If an unstarted task becomes stale, create it from the latest integration branch.

Check the PR's size with `git diff --shortstat <default>...<integration>` from time to time; committed generated output is the usual cause of bloat.

## 6. Handle agent questions and user decisions

When Herdr reports an agent as blocked, inspect its question as directed by the `herdr` skill. Answer it when the issue, repository, or user direction determines the answer, and log the decision. Otherwise relay one concise question with context and options and a recommendation, then send the decision back. Ask only when the decision is genuinely the user's. Pass the user's mid-run decisions to every affected running agent without waiting for them to ask. Do not expose routine coordination or ask the user to interact with a task pane.

## 7. Recover from a crash

List agents, worktrees, branches (local and remote), and uncommitted changes. Tell each surviving or restarted agent exactly what state it is in, then resume.

## 8. Finish

Continue until the issue is complete or a real blocker needs input. Keep the integration worktree and branch intact for final review.

1. Optionally run a light whole-branch pass for what per-task reviews miss: duplication across tasks, dead code, inconsistencies, modules grown too large. A cheap model suggests (read-only, at most about 15 suggestions); a strong model evaluates each against the code (now, later, or skip, with reasons); the user picks; the chosen items run as one more task with its own single review.
2. Push the integration branch. Create or update its PR when requested or all planned work is complete. Link the main issue, and include: a table of the merged tasks (what and which issue), validation and measurements, decisions to check (yours and the user's), a pre-launch or deploy checklist (migrations, new env vars, schedules, manual steps), and follow-ups.
3. Report the integration branch/worktree, completed tasks, validation status, and remaining work. Notify the user when the branch is green and ready, if they asked to be pinged. Do not present task branches for review.
