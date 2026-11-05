#!/bin/sh
# Tidies a closed run's worktrees, losing nothing: run it after closing the run.
#
# Usage: tidy-run.sh <run-directory>
#
# In each repository of the run (plan.md's Repos line, else orchestrator.json's
# folder), and only under ~/.herdr/worktrees/, it removes
#   - the integration worktree, when it has no uncommitted changes and a remote branch
#     has its every commit;
#   - each task worktree, when it has no uncommitted changes and its work landed on the
#     integration branch (landed below), then its local branch;
# and deletes the other local task branches whose work landed. A task branch is one
# named <prefix>-* (the plan's Prefix line) that git's reflog says was created from the
# integration branch, as the orchestrator creates them, so the user's own branches
# never count.
# Before removing a worktree it moves the ignored files that are not rebuildable
# (such as .env or local data; not node_modules, build output and caches) to
# <run-directory>/saved/<worktree-name>/, where nothing deletes them.
# Everything else stays: the repository's own checkout, branches with work found
# nowhere else, remote branches, PRs and the run directory. The integration branch
# stays too, so resuming the run, or the app's Open worktree, brings the worktree back.
# Prints one line each:
#   removed integration <path>     removed task <path>     deleted <branch>
#   saved <path>: <ignored entries>     kept <path>: <why>
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

# task <repo> <branch>: one of this run's task branches.
task() {
  [ -n "$prefix" ] && [ "$2" != "$branch" ] || return 1
  case $2 in "$prefix"-*) ;; *) return 1 ;; esac
  [ "$(git -C "$1" reflog show --format=%gs "refs/heads/$2" 2>/dev/null | tail -1)" = "branch: Created from $branch" ]
}

# landed <repo> <task-branch>: its work is on the integration branch, merged (an
# ancestor) or squashed (one commit there has the same patch as the task's whole diff,
# by git patch-id). A squash the orchestrator had to adjust does not count, nor do
# commits that change nothing, since they are nowhere else.
landed() {
  git -C "$1" merge-base --is-ancestor "$2" "$branch" 2>/dev/null && return 0
  mb=$(git -C "$1" merge-base "$branch" "$2" 2>/dev/null) || return 1
  p=$(git -C "$1" diff "$mb" "$2" | git patch-id --stable | cut -d' ' -f1)
  [ -n "$p" ] || return 1
  git -C "$1" log -p --no-merges "$mb..$branch" | git patch-id --stable | cut -d' ' -f1 | grep -qxF "$p"
}

# save <worktree>: moves its ignored entries that are not rebuildable to the run's
# saved/ folder, keeping their paths, and says which.
save() {
  dest=$d/saved/$(basename "$1")
  list=
  git -C "$1" status --porcelain --ignored -z | tr '\0' '\n' | sed -n 's/^!! //p' | sed 's|/$||' >"$d/.tidy-ignored"
  while IFS= read -r e; do
    case /$e in
      */node_modules | */vendor | */.venv | */venv | */__pycache__ | */.mypy_cache | */.ruff_cache | \
      */.pytest_cache | */.tox | */.cache | */.svelte-kit | */.next | */.nuxt | */.turbo | \
      */.parcel-cache | */.gradle | */build | */dist | */target | */coverage) continue ;;
    esac
    mkdir -p "$dest/$(dirname "$e")" && mv "$1/$e" "$dest/$e" && list="$list $e"
  done <"$d/.tidy-ignored"
  rm -f "$d/.tidy-ignored"
  [ -z "$list" ] || echo "saved $dest:$list"
}

# remove <repo> <worktree> <kind>
remove() {
  if [ -n "$(git -C "$2" status --porcelain 2>/dev/null)" ]; then
    echo "kept $2: uncommitted changes"
    return 1
  fi
  save "$2"
  if err=$(git -C "$1" worktree remove "$2" 2>&1); then
    echo "removed $3 $2"
  else
    echo "kept $2: $(printf '%s' "$err" | tail -1 | sed 's/^fatal: //')"
    return 1
  fi
}

printf '%s\n' "$repos" | while IFS= read -r r; do
  case $r in "~/"*) r=$HOME/$(printf '%s' "$r" | cut -c3-) ;; esac
  git -C "$r" rev-parse --git-dir >/dev/null 2>&1 || continue
  git -C "$r" worktree list --porcelain |
    awk '/^worktree /{w=substr($0,10)} /^branch refs\/heads\//{print substr($0,19) "\t" w}' |
    while IFS="	" read -r b w; do
      case $w in "$trees"*) ;; *) continue ;; esac
      if [ "$b" = "$branch" ]; then
        if [ -z "$(git -C "$r" for-each-ref --contains "$b" --format=x refs/remotes)" ]; then
          echo "kept $w: not pushed"
          continue
        fi
        remove "$r" "$w" integration
      elif task "$r" "$b"; then
        landed "$r" "$b" || { echo "kept $w: not merged into $branch"; continue; }
        remove "$r" "$w" task
      fi
    done
  [ -n "$prefix" ] || continue
  git -C "$r" for-each-ref --format='%(refname:short)' "refs/heads/$prefix-*" | while IFS= read -r b; do
    task "$r" "$b" && landed "$r" "$b" || continue
    if git -C "$r" branch -D "$b" >/dev/null 2>&1; then echo "deleted $b"; fi
  done
done
exit 0
