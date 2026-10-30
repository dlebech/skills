---
name: herdr-orchestrator
description: "Manually orchestrate a larger implementation through Herdr worktrees, role-specific agent kinds and models, one independent review per task, and an integration branch that is the only PR branch. The work comes from the current session, a description, a plan file, or one or more GitHub issues (and chosen sub-issues)."
disable-model-invocation: true
argument-hint: "[what to build, a path to a plan/spec, or issues like #185 #190; defaults to this session's discussion] [start with #dependency] [sub-issues=ask|all|none] [agent=<kind>] [model=<model>] [implementer/reviewer/specialist overrides] [merge=squash|merge] [push-task-branches=yes|no] [draft-pr=ask|yes|no] [final-review=ask|yes|no] [branch=<name>]"
compatibility: Requires git, jq, Herdr, and the herdr agent skill. Issues and PRs require the GitHub CLI.
metadata:
  required-skills: "herdr"
---

Act as the sole coordinator for a larger piece of work. The user talks only to you; manage its agents, worktrees, reviews, fixes, and integration.

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
- Agents never see your conversation. Everything they need is in the spec and briefs.
- Never treat an agent's Herdr `idle` or `done` as finished: an agent that ends its turn while its own background job runs looks the same. Agents report completion and questions with marker files (section 3), and you wait for them in the foreground with `wait-agents.sh`.
- Keep the run's state in the run directory (section 1), not only in your context. After a context compaction, re-read this skill, `spec.md`, `plan.md`, and `decisions.md` before your next action.

## 1. Establish the spec and integration branch

Parse `$ARGUMENTS` for the work source, constraints, options, and optional profiles. A profile is a Herdr agent `kind` (for example `claude`, `pi`, `opencode`, or `codex`) and, optionally, an accepted model:

- `agent=<kind>` and `model=<model>` are shorthand defaults for all roles.
- `implementer=<kind>` and `implementer-model=<model>` override implementation and fixes.
- `reviewer=<kind>` and `reviewer-model=<model>` override review.
- `specialist=<kind>` and `specialist-model=<model>` define an optional stronger profile for a user-assigned or unusually complex task, and for the final review of a large branch.
- Natural-language equivalents are valid, such as “use Sonnet for implementation, Haiku for review, Opus for complex tasks.”

Role overrides take precedence. With no configuration, use the orchestrator's agent kind when Herdr can identify it and its normal default model. If it cannot start that kind, ask the user which kind to use. Do not claim the orchestrator's exact model unless Herdr exposes it; if “the same model” cannot be detected, ask the user to name it.

Validate configured kinds with Herdr's current discovery. Select models through the chosen agent's documented Herdr startup arguments. If a requested model or argument cannot be verified, or a kind is invalid, ask the user rather than silently substituting.

Options:

- `push-task-branches` (default `yes`): push task branches to the remote as a backup, so work survives a crash. Never open PRs for them. Use `no` when the remote must stay clean or there is no remote.
- `merge` (default `squash`): `squash` lands each task as one commit with a message you write, so the final PR's history reads like a reviewable changelog. `merge` keeps each task's full commit history in non-fast-forward merges, at the cost of a noisier PR.
- `draft-pr` (default `ask`): ask once at the start whether to open the integration branch as a draft PR right after the first merge. An early draft PR runs CI on every merge, which catches failures local runs hide.
- `final-review` (default `ask`): once every planned task is merged, run one review of the whole integration branch (section 8). Ask at the start, not at the end, so the run does not stall waiting for an answer.
- `sub-issues` (default `ask`, issues only): which open sub-issues of the named issues to include (section 1a).
- `branch`: the integration branch name. Otherwise use the repository's branch naming convention; for issues, `issue-<number>` for one or `issue-<main>-<slug>` for several, where the main issue is the parent or the first named; otherwise a short slug of the goal.

Then:

1. Draft the spec from the work source:
   - **Session (default):** distill this conversation. Include the goal, acceptance criteria, constraints, decisions already made and why, rejected alternatives worth remembering, open questions, and what is out of scope. Prefer the conversation's latest position over earlier ones it replaced. Point at files, docs, or links discussed rather than paraphrasing them.
   - **Description in the arguments:** expand it with what the repository shows; ask only what the repository cannot answer.
   - **Plan or spec file:** read it and link to it from `spec.md`; record only what you add. If it is a `spec.md` inside an existing run directory, this is a handover or a resumed run: use that directory and continue from its `plan.md`.
   - **GitHub issues** (numbers, `#numbers`, or URLs): resolve them as in section 1a. The session's discussion of them also goes in.
2. Choose the integration branch name.
3. Create the run directory at `${XDG_CACHE_HOME:-$HOME/.cache}/herdr-orchestrator/<repo>/<integration-branch>/`, so a fresh session can find it after a crash. If it already exists with a `plan.md`, this is a resumed run: go to section 7. Write `spec.md`, `plan.md` (with `Status: waiting for user: start-of-run questions` until they are answered), and `decisions.md` (the decisions log) there. Briefs, review findings, and generated output also go here, and `status/` holds the markers (section 3).
   Make the run findable by `herdr-captain`: rename your own tab to `orc: <integration-branch>` (`herdr tab rename "$HERDR_TAB_ID" ...`), and write `orchestrator.json` there: `{"pane_id", "tab_id", "repo", "branch"}` (your pane and tab IDs, the repository path, and the integration branch). Rewrite it whenever you move or resume in another pane.
4. Ask the start-of-run questions in one message: the `draft-pr` and `final-review` questions when they are `ask`, the sub-issue choice and any closed or unreadable issue, and, when you drafted the spec from a session or a short description, a brief summary of it (goal, acceptance criteria, open questions, out of scope) and the branch name to confirm. Skip the spec confirmation for a plan file or issues unless something is ambiguous. Update `spec.md` with the answers.
5. When the spec came from a long session, offer to continue in a fresh session to save context for the run: the user starts `/herdr-orchestrator <run-directory>/spec.md` in a new Herdr pane, and this session stops. Recommend it when the conversation is long; otherwise continue here.
6. Discover the default branch (`gh repo view --json defaultBranchRef`, or `git symbolic-ref refs/remotes/origin/HEAD` without GitHub) and fetch it without changing the user's checkout. If there is uncommitted work in the user's checkout that the spec depends on, ask whether to commit it to the integration branch first.
7. Inspect existing branches and worktrees. Reuse an unambiguous integration branch/worktree; otherwise create a labeled one from `origin/<default-branch>` without taking focus.

Obtain workspace, pane, and path identifiers as directed by the `herdr` skill; never predict them.

### 1a. Issues

When the work comes from GitHub issues, also parse an explicitly named starting issue (“start with #175”).

1. Verify GitHub access with `gh auth status`.
2. Read each named issue and dependency with `gh issue view <number> --json number,title,body,url,labels,assignees,state`. A closed issue, or one that cannot be read, goes into the start-of-run questions.
3. List each issue's sub-issues with `gh api repos/{owner}/{repo}/issues/<number>/sub_issues --paginate --jq '.[] | {number, title, state}'`. Also note task-list items in the body that link issues.
4. If any issue has open sub-issues, apply `sub-issues`:
   - `ask`: show the open sub-issues per parent (number, title, and a one-line read of size or dependency) in the start-of-run questions and ask which to solve in this run: all, a subset, or none (the parent's own body only). Recommend a set that fits one reviewable PR, and say which are blocked by others.
   - `all`: include every open sub-issue. `none`: include none.
   Skip closed sub-issues. Read each chosen sub-issue in full, and repeat this step for its own sub-issues.
5. Drop duplicates, such as a named issue that is also a chosen sub-issue of another.

Comments on an issue can change its scope. Read them (`gh issue view <number> --comments`) when the body looks outdated or refers to a discussion.

`spec.md` gets a section per included issue (its link, goal, acceptance criteria, constraints, and decisions from its comments), lists the sub-issues deliberately left out of this run, and ends with an **Issue handling** section, so a resumed run keeps it:

- map every task to the issue(s) it serves, honor an explicit starting issue first, and cover each included issue's acceptance criteria with some task;
- reference the task's issue in each squash or merge commit;
- in the PR, add a `Closes #<number>` line for each included issue the branch fully resolves, `Part of #<number>` for a parent whose remaining sub-issues stay open, and an issue column in the merged-task table;
- in the final report, list each included issue with its status and the sub-issues left for later.

## 2. Plan autonomously

Turn the spec into the smallest independently implementable and reviewable tasks. Honor any ordering in the spec, such as “start with the schema change.” A task can be non-code (a measurement run, a recording, docs). It gets a worktree when it produces files, and a review only when it changes code or docs.

Keep the plan in `plan.md`. Its first line is `Status: <one line>`, kept current: `running`, `waiting for user: <question>`, `blocked: <reason>`, or `finished`. For each task, record:

- the acceptance criteria it satisfies;
- dependencies on other tasks;
- the files or subsystem it is expected to touch;
- a validation command or observable result;
- whether it can safely run in parallel;
- its status (planned, implementing, in review, fixing, merged) and its branch, worktree, and agent names.

Update `plan.md` at every status change, before acting on the next one.

Prefer sequential work for overlapping edit surfaces. Keep planning lightweight and update it as repository evidence changes. Do not stop for confirmation unless a product decision, missing credential, destructive action, or genuine ambiguity blocks progress.

Record every small product or design decision you make yourself (names, defaults, edge-case behaviour) in `decisions.md`, next to the user's own decisions.

## 3. Implement a task

Keep briefs as files in the run directory, and point prompts at them:

- `spec.md`: the overall goal, as above. Every agent reads it.
- `common.md`: rules every agent follows: environment, the checks that define “done” and how to run them the way CI does, browser-check and end-to-end test guidance, and commit and push rules. It also gives the reporting protocol, with the absolute path of `status/` in the run directory:
  - when the assigned work is completely finished, including any background jobs it started, write `status/<agent-name>.done` with a one-line result, then end the turn;
  - to ask you something, write the question with its context and options to `status/<agent-name>.question`, then end the turn and wait for the answer;
  - if the work cannot be completed, write the reason to `status/<agent-name>.failed`.
- one brief per task: scope, acceptance criteria, what other agents are doing in parallel and which files to avoid, decisions already made, and how to measure success. Where quality is measurable (evals, benchmarks), say how to measure before and after and what counts as not regressing.
- one review template.

When a lesson applies to everyone, amend `common.md` once and notify the running agents.

For every ready task:

1. Ensure the integration worktree is clean and contains prerequisite merges.
2. Create a labeled task worktree from the integration branch without taking focus.
3. Isolate its runtime state before the agent starts: its own databases, ports, storage buckets, and env files, derived from the user's env with names and ports changed. Copy secrets only with the user's explicit permission. Assign shared, ordered resources (migration timestamps, sequence numbers, generated files such as schema types, lockfiles) and tell each agent which values are taken.
4. Start a uniquely named implementer in that worktree's root pane, using the specialist profile for user-designated or deliberately escalated tasks and the implementation profile otherwise. Give it write access to the run directory through the agent's startup arguments (for Claude Code, `--add-dir <run-directory>`), or every marker it writes stops at a permission prompt.
5. Prompt it to read `spec.md`, `common.md`, and its task brief. Tell it to work only in its worktree, inspect existing code before editing, make a focused implementation with tests where appropriate, run the relevant validation, commit work in progress regularly, and ask a precise question through a `.question` marker if blocked, and write its `.done` marker only when everything is finished.
6. Prompt it according to the `herdr` skill, then wait for it as below.
7. Independently verify the branch is committed, clean, and satisfies the task's validation before review.

Run independent tasks in parallel only when their likely edit surfaces do not overlap. Do not start more simultaneous agents than can be monitored reliably, or than machine memory allows.

Wait for agents in the foreground, never in a background shell or monitor. A Claude Code orchestrator that ends its turn to wait looks idle in Herdr, and Herdr does not let outside processes mark it busy. Watch CI the same way, in foreground chunks under 10 minutes. Long-running processes such as dev servers stay in the background; they are not waits. Run `<skill-dir>/scripts/wait-agents.sh`:

```bash
<skill-dir>/scripts/wait-agents.sh --status-dir <run-directory>/status \
  --label "waiting: task 3/7 in review" <agent-name>...
```

Pass every running agent's name, and a short label with the plan position. Also check `status/` for `.message` markers whenever you start a new step, since messages can arrive while you are not waiting. It labels your pane until it returns, and returns after at most 9 minutes with one line per event:

- `marker <file>`: read it and act on it, then rename it to `<file>.handled`. A `.question` marker goes to section 6. A `.message` marker is an instruction from the user relayed by `herdr-captain`; treat it as the user's own words, then record it in `decisions.md` if it decides something.
- `blocked <agent>`: an approval or question dialog. Inspect it as in section 6.
- `gone <agent>`: the agent exited. Check its worktree and decide whether to restart it.
- `timeout`, with each agent's state (`unknown` when Herdr did not answer): nothing needs you yet. An agent that has been `idle` or `done` without a marker through several timeouts may have stalled or forgotten its marker; read its last output before prompting it. Then run the wait again.

Agent gotchas:

- A `--wait` timeout on `herdr agent prompt` does not prove failure; check the status before sending anything again.
- Claude Code shows a suggested next prompt as ghost text in the input box. In a pane read it looks like an unsent user instruction. Ignore it, and clear it (`ctrl+u`) before prompting.

## 4. Review once, then fix

Create another pane in the task worktree's Herdr workspace and start a new agent with the reviewer profile, a distinct reviewer name, and run-directory access as in section 3. Do not reuse the implementer's pane or identity. The implementer and reviewer may use the same kind or model, but they must be separate agent processes. Review may start once the implementation is committed, while slow verification such as long end-to-end runs continues in parallel.

If the reviewer exposes a code-review skill, command, or equivalent, use it with the base branch and task requirements. Otherwise instruct it to inspect the task diff against the integration branch and report only actionable correctness, regression, test, security, and requirement findings. Give it the base branch, `spec.md`, the task requirements, the review template, and a prohibition on editing files. It writes verified findings to a file (most severe first, each with location, failure scenario, suggested fix, and must-fix or nice-to-have), then its `.done` marker pointing at that file.

Either approach is the task's one and only review pass. If the selected agent cannot inspect the repository or perform the requested review by either route, ask the user to select another reviewer profile; do not count that failed capability check as the task's review.

Triage the findings: decide each one (fix as suggested, fix differently, defer, reject), and send the file with your decisions to the original implementer. Ask it to fix, validate, and commit. Verify the branch and tests directly; do not review again. If the implementer is unavailable, start a fixer with the implementation profile and run-directory access in the same worktree. It receives the triaged findings and does implementation only. Record deferred findings as follow-ups.

## 5. Merge upward

When a task is implemented, reviewed once, fixed, committed, and validated:

1. Confirm the task branch contains only intended commits.
2. If it is behind and would conflict, have its agent merge the integration branch in its own worktree, resolve conflicts where its environment and tests are, and re-run its checks. This also fixes ordering clashes such as duplicate migration timestamps.
3. From the integration worktree, integrate it:
   - `squash`: write a message with what and why, the task's issue if any, and key numbers. Afterwards verify `git diff <task-branch> <squash-commit>` is empty.
   - `merge`: make a non-fast-forward merge with a message naming the task.
4. Run the smallest integration-level validation that covers the merge. If a PR exists, push and watch CI. Fix a red build before merging more, in a short-lived worktree like any change.
5. Mark the task complete and use the updated integration branch as the base for dependent worktrees.
6. Clean up: exit the task's agents, then remove its worktree after checking it is clean, pushed if pushing is on, and identical to what was merged. Drop its throwaway resources, but move anything costly to rebuild, like caches, to the integration worktree or a backup location first. Idle agents still hold memory, so do not wait until the end.

Resolve straightforward mechanical conflicts in the integration worktree. If a conflict requires a product or design choice, ask the user before choosing.

Do not merge the integration branch into a task branch merely to make it current. If an unstarted task becomes stale, create it from the latest integration branch.

Check the PR's size with `git diff --shortstat <default>...<integration>` from time to time; committed generated output is the usual cause of bloat.

## 6. Handle agent questions and user decisions

Questions arrive as `.question` markers, or as `blocked` when an agent shows an approval or question dialog; inspect the latter as directed by the `herdr` skill. Answer it when the spec, repository, or user direction determines the answer, and log the decision. Otherwise relay one concise question with context and options and a recommendation, then send the decision back. Rename the marker to `.handled` once the agent has its answer. Ask only when the decision is genuinely the user's. Pass the user's mid-run decisions to every affected running agent without waiting for them to ask, and update `spec.md` when they change the goal or scope. Do not expose routine coordination or ask the user to interact with a task pane.

## 7. Recover from a crash

Re-read `spec.md`, `plan.md`, and `decisions.md` from the run directory, and act on any unhandled markers in `status/`. List agents, worktrees, branches (local and remote), and uncommitted changes, and reconcile them with `plan.md`: git and Herdr win where they disagree. Tell each surviving or restarted agent exactly what state it is in, then resume.

## 8. Finish

Continue until the spec is complete or a real blocker needs input. Keep the integration worktree and branch intact for final review.

1. If `final-review` is on, review the whole integration branch once, after every planned task is merged. Start a fresh agent with the reviewer profile (or the specialist profile for a large branch) in the integration worktree. It reviews `<default>...<integration>` against `spec.md` for what per-task reviews miss: bugs across task boundaries, unmet acceptance criteria, duplication across tasks, dead code, inconsistencies, modules grown too large. Same rules as section 4: read-only, findings to a file, at most about 15. Triage them; fix must-fix findings as one more task with no further review, and let the user pick among the nice-to-haves, or record them as follow-ups. This is the only review of the review fixes; do not loop.
2. Push the integration branch. Create or update its PR when requested or all planned work is complete. Include: a short statement of the goal from `spec.md`, a table of the merged tasks, validation and measurements, decisions to check (yours and the user's), a pre-launch or deploy checklist (migrations, new env vars, schedules, manual steps), follow-ups, and the issue lines from `spec.md`'s Issue handling. Without a GitHub remote or `gh`, print the description for the user to paste.
3. Set `plan.md`'s status to `finished`, then report the integration branch/worktree, completed tasks, validation status, remaining work, and for issues their status as in `spec.md`'s Issue handling. Notify the user when the branch is green and ready, if they asked to be pinged. Do not present task branches for review.
