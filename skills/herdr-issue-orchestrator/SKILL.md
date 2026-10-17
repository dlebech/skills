---
name: herdr-issue-orchestrator
description: Manually orchestrate a GitHub issue through Herdr worktrees, role-specific agent kinds and models, one independent review per task, and an integration branch that is the only PR branch.
disable-model-invocation: true
argument-hint: "<issue> [start with #dependency] [agent=<kind>] [model=<model>] [implementer/reviewer/specialist overrides]"
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
- Never push or open a PR for a task branch. Only the integration branch may be pushed or turned into a PR.
- Do not ask the user to review task branches. The user reviews the final integration branch.

## 1. Establish the issue and integration branch

Parse `$ARGUMENTS` for the main issue, an explicitly named starting issue, constraints, and optional profiles. A profile is a Herdr agent `kind` (for example `claude`, `pi`, `opencode`, or `codex`) and, optionally, an accepted model:

- `agent=<kind>` and `model=<model>` are shorthand defaults for all roles.
- `implementer=<kind>` and `implementer-model=<model>` override implementation and fixes.
- `reviewer=<kind>` and `reviewer-model=<model>` override review.
- `specialist=<kind>` and `specialist-model=<model>` define an optional stronger profile for a user-assigned or unusually complex task.
- Natural-language equivalents are valid, such as “use Sonnet for implementation, Haiku for review, and Opus for complex tasks.”

Role overrides take precedence. With no configuration, use the orchestrator's agent kind when Herdr can identify it and its normal default model. If it cannot start that kind, ask the user which kind to use. Do not claim the orchestrator's exact model unless Herdr exposes it; if “the same model” cannot be detected, ask the user to name it.

Validate configured kinds with Herdr's current discovery. Select models through the chosen agent's documented Herdr startup arguments. If a requested model or argument cannot be verified, or the issue/kind is invalid, ask the user rather than silently substituting.

1. Verify GitHub access with `gh auth status`.
2. Read the main issue and explicitly named dependencies with `gh issue view <number> --json number,title,body,url,labels,assignees,state`.
3. Discover the default branch with `gh repo view --json defaultBranchRef`.
4. Fetch it without changing the user's checkout.
5. Inspect existing branches and worktrees. Reuse an unambiguous integration branch/worktree; otherwise create a labeled one from `origin/<default-branch>` without taking focus.

Use the repository's branch naming convention if one exists. Otherwise use `issue-<number>`. Obtain workspace, pane, and path identifiers as directed by the `herdr` skill; never predict them.

## 2. Plan autonomously

Turn the issue and dependencies into the smallest independently implementable and reviewable tasks. Honor an explicit starting issue first, such as “start #185 with #175.”

For each task, record:

- the acceptance criteria it satisfies;
- dependencies on other tasks;
- the files or subsystem it is expected to touch;
- a validation command or observable result;
- whether it can safely run in parallel.

Prefer sequential work for overlapping edit surfaces. Keep planning lightweight and update it as repository evidence changes. Do not stop for confirmation unless a product decision, missing credential, destructive action, or genuine ambiguity blocks progress.

## 3. Implement a task

For every ready task:

1. Ensure the integration worktree is clean and contains prerequisite merges.
2. Create a labeled task worktree from the integration branch without taking focus.
3. Start a uniquely named implementer with the implementation profile in that worktree's root pane, using native model arguments when configured.
4. Prompt it with the issue context, exact task scope, acceptance criteria, repository conventions, and required validation. Tell it to:
   - work only in its assigned worktree;
   - inspect existing code before editing;
   - make a focused implementation with tests where appropriate;
   - run the smallest relevant validation;
   - commit all task changes to its branch;
   - stop and ask a precise question if blocked.
5. Prompt and monitor it according to the `herdr` skill. A timeout does not prove failure; inspect before sending anything again.
6. Independently verify the branch is committed, clean, and satisfies the task's validation before review.

Run independent tasks in parallel only when their likely edit surfaces do not overlap. Do not start more simultaneous agents than can be monitored reliably.

## 4. Review once, then fix

Create another pane in the task worktree's Herdr workspace and start a new agent with the reviewer profile and a distinct reviewer name. Do not reuse the implementer's pane or identity. The implementer and reviewer may use the same kind or model, but they must be separate agent processes.

If the reviewer exposes a code-review skill, command, or equivalent, use it with the base branch and task requirements. Otherwise instruct it to inspect the task diff against the integration branch and report only actionable correctness, regression, test, security, and requirement findings. Give it the base branch, task requirements, expected output format, and a prohibition on editing files.

Either approach is the task's one and only review pass. If the selected agent cannot inspect the repository or perform the requested review by either route, ask the user to select another reviewer profile; do not count that failed capability check as the task's review.

If there are findings, send them to the original implementer and ask it to fix valid findings, explain rejected ones, validate, and commit. Verify the branch and tests directly; do not review again. If unavailable, start a fixer with the implementation profile in the same worktree. It receives the existing findings and does implementation only.

## 5. Merge upward

When a task is implemented, reviewed once, fixed, committed, and validated:

1. Confirm the task branch contains only intended commits.
2. Merge it with a non-fast-forward message naming the task and issue.
3. Run the smallest integration-level validation that covers the merge.
4. Mark the task complete and use the updated integration branch as the base for dependent worktrees.

Resolve straightforward mechanical conflicts in the integration worktree. If a conflict requires a product or design choice, ask the user before choosing.

Never merge the integration branch into a task branch merely to make it current. If an unstarted task becomes stale, create it from the latest integration branch.

## 6. Handle agent questions

When Herdr reports an agent as blocked, inspect its question as directed by the `herdr` skill. Answer it when the issue, repository, or user direction determines the answer. Otherwise relay one concise question with context and options, then send the decision back. Do not expose routine coordination or ask the user to interact with a task pane.

## 7. Finish

Continue until the issue is complete or a real blocker needs input. Keep the integration worktree and branch intact for final review.

- Push only the integration branch.
- Create its PR only when requested or all planned work is complete. Link the main issue and summarize merged tasks, validation, and limitations.
- Report the integration branch/worktree, completed tasks, validation status, and remaining work. Do not present task branches for review.
