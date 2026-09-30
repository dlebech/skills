---
name: pr-squash
description: Squash-merge a PR with a short commit message written for the main branch's log.
disable-model-invocation: true
argument-hint: "[PR number, defaults to current branch's PR]"
---

The squash commit is a record of what landed on the main branch, read later by someone scanning `git log`. It is not the PR description (written for reviewers) and not GitHub's default (every branch commit pasted together).

1. Get the PR: `gh pr view $ARGUMENTS --json number,title,body,url,baseRefName` and `gh pr diff $ARGUMENTS`. Check `git log --oneline -15 origin/<baseRefName>` to match the repo's message style.
2. Write the message:
   - Subject: what was merged, not how; about 72 characters or less.
   - Body: optional, at most 3 short lines. Only include it if it adds something worth searching for later (a key reason, a notable change or name).
   - Don't copy the branch's commit list or the PR description.
   - Keep any `Co-Authored-By:` trailers at the end.
3. Merge without asking: `gh pr merge <number> --squash --delete-branch --subject "<subject>" --body "<body>"`.
4. Print the PR URL and the message used. Don't switch branches or pull; leave that to the user.
