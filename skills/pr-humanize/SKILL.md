---
name: pr-humanize
description: Rewrite a PR description into a short "For humans" section and a detailed "For AI" section.
disable-model-invocation: true
argument-hint: "[PR number, defaults to current branch's PR]"
---

1. Get the PR: `gh pr view $ARGUMENTS --json number,title,body,url` and `gh pr diff $ARGUMENTS`.
   - If the body already has `## For humans` / `## For AI` sections, rewrite them in place rather than nesting new ones.
2. Write `## For humans`:
   - One sentence on what changed and why.
   - At most 4 bullets: user-visible effects, what's unaffected, deploy/manual steps.
   - No file paths, class names or config keys unless the reader has to act on them.
3. Write `## For AI`:
   - Full detail: files, packages, config values, the reasoning behind non-obvious choices, what's deliberately not touched, test plan.
   - Keep everything useful from the existing body; drop nothing.
   - Base claims on the diff; don't invent behavior or test results that aren't there.
4. Keep the existing attribution footer (if any) at the very end, after both sections.
5. Apply with `gh pr edit <number> --body-file -` (pipe the new body via stdin) and print the PR URL.
