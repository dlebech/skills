# Review runs: review a pull request and hand the user draft comments

Read this only for a `review <PR>` run ([start.md](start.md#review-runs)). There is no plan, no integration branch and no merge: the run is one reviewer agent and one ask.

## 1. Review

1. Resolve the PR: `gh pr view <pr> --json number,title,url,author,headRefName,headRefOid,baseRefName,body,headRepository`. Note the head sha; if it changes before you post, say so in the question.
   Right away publish the PR so Harbormaster shows it is being reviewed: `set-status.sh <run-directory> --related <owner/repo> <pr url>`.
2. Check out the PR head in a worktree, never in the user's checkout: `gh pr checkout` is not used. Fetch `refs/pull/<n>/head` and run `git worktree add --detach ~/.herdr/worktrees/<repo>/review-<n> <sha>`; if `review-<n>` already exists (an earlier or crashed run), remove it first (`git worktree remove --force`) and add it again. Remove it when the run closes.
3. Start the reviewer there (section 3's Starting an agent, name `rev-<prefix>`, reviewer profile, `shared/` access, no editing files). Tell it: the PR's title, description and base branch, to review the diff against the base, and to follow the repository's own conventions: its CONTRIBUTING, review guidelines and any code-review skill or command it exposes (use it). It reports only actionable correctness, regression, test, security and requirement findings, verified against the code, and writes them to `shared/review-drafts.md`, then sends its `done` report.
4. Write the run's `review-drafts.md` from that file, one entry per comment, most severe first:

   ```markdown
   ## src/app.js:42 · must-fix
   The retry loop never stops if `fetch` keeps throwing; cap it or rethrow after N tries.
   ```

   `path:line` is a line in the PR's head (use `path` alone for a whole-file or general note, `general` for the review body), then the severity (`must-fix`, `suggestion` or `nit`), then the body. A comment is the user's voice: concise, specific, kind, no AI boilerplate, no praise padding, no "As an AI"; apply any prefix convention the repository has (such as `nit:`). Drop what is not worth the author's time. Zero findings is a result: say so in one line and finish without a question.

Never resolve threads, merge, or approve on your own. The post-review question is always the user's: never decide it yourself at any autonomy level, and the captain never answers it.

## 2. Hand them over, by `review-drafts`

**`herdr`** (default). Ask with `question.md` ([run-files.md](run-files.md#questionmd), section 6), `plan.md` status `waiting for user: N draft review comments`:

```markdown
# N draft review comments ready for <repo>#<n>

## Question
<PR title>, by <author>. Nothing is posted yet. The drafts are in <run dir>/review-drafts.md.

## Options
1. **Post as pending review**: creates a pending review on GitHub; you submit it there
2. **Post review**: submits the review now as comments
3. **Edit first**: change review-drafts.md or reply with changes, then I ask again
4. **Discard**: post nothing

## Recommended
Post as pending review: you see them in GitHub's UI before anyone else does

## Evidence
- src/app.js:42 must-fix: retry loop never stops
- (the other drafts, one short line each; at most 8, then "and N more")

## Risk
Only you can answer this: it posts in your name. A review is visible to the PR's author; a pending review is visible only to you.

## Blocks
Nothing else.
```

Answers: *Post as pending review* and *Post review* act as below; *Edit first* re-reads `review-drafts.md` (and applies a reply's changes), then asks again; *Discard* ends the run with nothing posted.

**`pending`**. Create a pending review and never submit it. Before posting, check for an existing pending review of yours (`gh api repos/<o>/<r>/pulls/<n>/reviews`, state `PENDING`, your login): GitHub allows one, so if there is one, never delete it; ask (question.md) whether to add to it or leave it. Build the JSON from `review-drafts.md` (`comments`: `path`, `line`, `side: "RIGHT"`, `body`; a `general` or `path`-only entry has no line, so it goes into the review `body` as `path: text`), without `event`:

```bash
gh api -X POST repos/<o>/<r>/pulls/<n>/reviews --input review.json   # no "event" key: stays PENDING
```

Set `commit_id` to the sha you reviewed (re-read `headRefOid` first; if the head moved, GitHub maps the lines to the reviewed sha, and the report says so), in any mode. Finish with a one-line report and the PR link: "N draft comments are a pending review on <url>; submit it there."

**`direct`**. Submit the same JSON with `"event": "COMMENT"`. Never `APPROVE` or `REQUEST_CHANGES` unless the user said so in this run.

GitHub rejects the whole request (422) if one comment's line is outside the diff, and may not say which: check every comment's line against `gh pr diff`, fold the ones not in it into the body with their `path:line`, and post once more; say so in the report.

## 3. Finish

Report in one line (what was posted and where, or that nothing was), mark the run done, remove the review worktree and the reviewer agent, and close as in section 9.
