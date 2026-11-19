# AGENTS.md

Rules for agents working in this repository.

## No real people or repositories

- Never name real people or real repositories in code, tests, docs, commit messages or PR descriptions: no real GitHub logins, names, email addresses, organisations or repositories. Use placeholders: people `kim`, `anna`, `noor`, `bo`, `cy`; repositories `acme/app`, `lab/api`, `o/r`. Bots whose behaviour the code handles (`coderabbitai`) are fine.
- The one exception: this repository's own install command, `npx skills add dlebech/skills`, which must name it.
- Before opening or updating a PR, check its diff: `git diff origin/main...HEAD | grep '^+'` for logins, names and owner/repo pairs.
