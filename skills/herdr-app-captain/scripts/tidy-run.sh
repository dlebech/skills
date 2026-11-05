#!/bin/sh
# Tidies a closed run's worktrees, losing nothing: run it after closing the run.
#
# Usage: tidy-run.sh <run-directory>
#
# In each repository of the run (plan.md's Repos line, else orchestrator.json's
# folder), and only under ~/.herdr/worktrees/, it removes
#   - the integration worktree, when it is clean and its upstream has every commit;
#   - each task worktree (<prefix>-*, the plan's Prefix line), when it is clean and
#     merged into the integration branch, then its local branch;
# and deletes local task branches without a worktree that are merged the same way.
# Everything else stays: the repository's own checkout, branches with work found
# nowhere else, remote branches, PRs and the run directory. The integration branch
# stays too, so resuming the run, or the app's Open worktree, brings the worktree back.
# Prints one line each: "removed <path>", "kept <path>: <why>", "deleted <branch>".
#
# Harbormaster's Close runs the same script, as TIDY in its data.js, since the mod is
# installed without this skill: change both together. Keep it POSIX sh, with no "${"
# or backticks, so it fits in a JavaScript template there.
d=$1
branch=$(jq -r '.branch // empty' "$d/orchestrator.json" 2>/dev/null)
[ -n "$branch" ] || { echo "no branch in $d/orchestrator.json" >&2; exit 2; }
prefix=$(sed -n 's/^Prefix: *//p' "$d/plan.md" 2>/dev/null | head -1)
repos=$(sed -n 's/^Repos: *//p' "$d/plan.md" 2>/dev/null | head -1 | tr ',' '\n' | sed 's/^ *[^ ]* *//; s/ *$//')
[ -n "$repos" ] || repos=$(jq -r '.folder // empty' "$d/orchestrator.json")
trees=$HOME/.herdr/worktrees/
printf '%s\n' "$repos" | while IFS= read -r r; do
  case $r in "~/"*) r=$HOME/$(printf '%s' "$r" | cut -c3-) ;; esac
  git -C "$r" rev-parse --git-dir >/dev/null 2>&1 || continue
  git -C "$r" worktree list --porcelain |
    awk '/^worktree /{w=substr($0,10)} /^branch refs\/heads\//{print substr($0,19) "\t" w}' |
    while IFS="	" read -r b w; do
      case $w in "$trees"*) ;; *) continue ;; esac
      if [ "$b" = "$branch" ]; then
        git -C "$w" merge-base --is-ancestor HEAD '@{u}' 2>/dev/null ||
          { echo "kept $w: not pushed"; continue; }
      elif [ -n "$prefix" ] && case $b in "$prefix"-*) true ;; *) false ;; esac; then
        git -C "$r" merge-base --is-ancestor "$b" "$branch" 2>/dev/null ||
          { echo "kept $w: not merged into $branch"; continue; }
      else
        continue
      fi
      if err=$(git -C "$r" worktree remove "$w" 2>&1); then
        echo "removed $w"
      else
        case $err in
          *"modified or untracked"*) echo "kept $w: uncommitted changes" ;;
          *) echo "kept $w: $(printf '%s' "$err" | tail -1 | sed 's/^fatal: //')" ;;
        esac
      fi
    done
  [ -n "$prefix" ] || continue
  git -C "$r" for-each-ref --format='%(refname:short)' "refs/heads/$prefix-*" | while IFS= read -r b; do
    [ "$b" != "$branch" ] || continue
    git -C "$r" merge-base --is-ancestor "$b" "$branch" 2>/dev/null || continue
    git -C "$r" branch -D "$b" >/dev/null 2>&1 && echo "deleted $b"
  done
done
