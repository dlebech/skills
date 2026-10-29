---
name: herdr-issue-orchestrator
description: Manually orchestrate one or more GitHub issues (and chosen sub-issues) through Herdr worktrees, role-specific agent kinds and models, one independent review per task, and an integration branch that is the only PR branch. Builds on herdr-orchestrator.
disable-model-invocation: true
argument-hint: "<issue> [<issue>...] [start with #dependency] [sub-issues=ask|all|none] [agent=<kind>] [model=<model>] [implementer/reviewer/specialist overrides] [merge=squash|merge] [push-task-branches=yes|no] [draft-pr=ask|yes|no] [final-review=ask|yes|no]"
compatibility: Requires GitHub CLI, git, Herdr, the herdr agent skill, and the herdr-orchestrator skill.
metadata:
  required-skills: "herdr herdr-orchestrator"
---

Orchestrate one or more GitHub issues with the `herdr-orchestrator` skill. This skill turns the issues into its spec, integration branch name, and PR additions; everything else follows `herdr-orchestrator`.

## 0. Load the orchestrator

Load the `herdr-orchestrator` skill before doing anything else. If it is unavailable, stop and tell the user to install it (`npx skills add dlebech/skills`).

Pass every option and profile in `$ARGUMENTS` through to it, except the issue-specific ones below.

## 1. Resolve the issues

Parse `$ARGUMENTS` for one or more issues (numbers, `#numbers`, or URLs), an explicitly named starting issue (“start with #175”), and `sub-issues` (default `ask`).

1. Verify GitHub access with `gh auth status`.
2. Read each named issue and dependency with `gh issue view <number> --json number,title,body,url,labels,assignees,state`. If one is closed, ask whether to include it.
3. List each issue's sub-issues with `gh api repos/{owner}/{repo}/issues/<number>/sub_issues --paginate --jq '.[] | {number, title, state}'`. Also note task-list items in the body that link issues.
4. If any issue has open sub-issues, apply `sub-issues`:
   - `ask`: show the open sub-issues per parent (number, title, and a one-line read of size or dependency) and ask which to solve in this run: all, a subset, or none (the parent's own body only). Recommend a set that fits one reviewable PR, and say which are blocked by others. Ask this once, together with `herdr-orchestrator`'s start-of-run questions.
   - `all`: include every open sub-issue. `none`: include none.
   Skip closed sub-issues. Read each chosen sub-issue in full, and repeat this step for its own sub-issues.
5. Drop duplicates, such as a named issue that is also a chosen sub-issue of another.

Comments on an issue can change its scope. Read them (`gh issue view <number> --comments`) when the body looks outdated or refers to a discussion.

## 2. Hand over to the orchestrator

Supply these to `herdr-orchestrator` as the calling skill:

- **Spec:** write `spec.md` with a section per included issue: its link, goal, acceptance criteria, and constraints, plus decisions from its comments. List which sub-issues are deliberately out of this run. Anything the user said in this session about the issues also goes in.
- **Integration branch:** the repository's branch naming convention if one exists; otherwise `issue-<number>` for one issue, or `issue-<main>-<slug>` for several, where the main issue is the parent or the first named.
- **Planning:** map every task to the issue(s) it serves, and honor an explicit starting issue first. Each included issue's acceptance criteria must be covered by some task.
- **Commit messages:** reference the task's issue in each squash or merge commit.
- **PR additions:** a `Closes #<number>` line for each included issue that the branch fully resolves, and `Part of #<number>` for a parent whose remaining sub-issues stay open. Add an issue column to the merged-task table.

Then follow `herdr-orchestrator` from its section 1, with the spec and branch name above. Continue until every included issue is complete or a real blocker needs input. In the final report, list each included issue with its status and the sub-issues left for later.
