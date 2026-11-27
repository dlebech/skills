---
name: herdr-run
description: "Start a Herdr app run: a short alias for herdr-app-orchestrator, with the same arguments and defaults. For the Herdr app (herdr-core, `hc`), not the older Herdr TUI."
disable-model-invocation: true
argument-hint: "[what to build, a path to a plan/spec, or issues like #185 #190; defaults to this session's discussion] [start with #dependency] [sub-issues=ask|all|none] [agent=<kind>] [model=<model>] [implementer/reviewer/specialist overrides] [merge=squash|merge] [push-task-branches=yes|no] [draft-pr=ask|yes|no] [task-review=yes|no] [final-review=ask|yes|no] [review-rounds=<n>] [close-issues=mine|sub|all|none] [grunt=<kind>] [grunt-model=<model>] [type=feat|fix|rev|expl] [branch=<name>]"
compatibility: Requires the herdr-app-orchestrator skill, installed beside this one, and everything it requires.
metadata:
  required-skills: "herdr-core herdr-app-orchestrator"
---

This skill is an alias. Read `../herdr-app-orchestrator/SKILL.md` (the `herdr-app-orchestrator` skill directory beside this one) in full now, and follow it as if the user had invoked `herdr-app-orchestrator` with `$ARGUMENTS`.

In that skill, `<skill-dir>`, `scripts/` and `references/` all mean the `herdr-app-orchestrator` directory, never this one. Resuming a run, from Harbormaster, the captain or by hand, uses `herdr-app-orchestrator`, as that skill says: it is the same run.

If `../herdr-app-orchestrator/SKILL.md` is missing, stop and tell the user to install it: `npx skills add dlebech/skills --skill herdr-app-orchestrator`.
