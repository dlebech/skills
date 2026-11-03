#!/usr/bin/env bash
# Create or reuse the run's integration worktree, and show it as a Herdr app space.
#
# Usage: integration-worktree.sh <integration-branch> <base>    (run inside the repository)
#
# A branch already checked out in another worktree is reused there. Otherwise the
# worktree goes where the app's own worktree mod puts them:
# ~/.herdr/worktrees/<repo>/<branch as branch_slug in lib.sh writes it>. An existing
# branch is checked out there; a new one starts from <base>, such as origin/main.
# A branch checked out in the repository's main checkout, the user's, is not
# taken over: that exits 3. The app then nests the space under its repository's space
# and shows its branch, ahead/behind, and changes. The space comes from a plain
# shell started with hc and labelled with a space id of our own, which, unlike
# herdr-app's space.new, leaves the user's view where it is. The shell outlives
# the orchestrator, so the space stays until the user removes it. A space already
# open on the worktree is left alone, so this also reopens one after a resume.
# A window that cannot be reached only prints a warning: the run needs the
# worktree, not the space. Prints the worktree path.
set -u
. "$(dirname "$0")/lib.sh"

[ $# -eq 2 ] || { echo "usage: integration-worktree.sh <integration-branch> <base>" >&2; exit 2; }
branch=$1
base=$2
common=$(git rev-parse --path-format=absolute --git-common-dir) || exit 1
repo=${common%/.git}
slug=$(branch_slug "$branch")
path=$HOME/.herdr/worktrees/${repo##*/}/$slug
checked_out=$(git -C "$repo" worktree list --porcelain |
  awk -v b="branch refs/heads/$branch" '/^worktree /{w = substr($0, 10)} $0 == b {print w; exit}')
if [ "$checked_out" = "$repo" ]; then
  echo "$branch is checked out in $repo, the main checkout; ask the user to switch it" >&2
  exit 3
fi
[ -z "$checked_out" ] || path=$checked_out

if ! git -C "$path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$repo" worktree add -q "$path" "$branch" >&2 || exit 1
  else
    git -C "$repo" worktree add -q -b "$branch" "$path" "$base" >&2 || exit 1
  fi
fi

if ! spaces=$(herdr-app ls 2>/dev/null); then
  echo "warning: could not reach the Herdr window; the worktree has no space" >&2
elif ! jq -e --arg p "$path" 'any(.spaces[]; .folder == $p)' <<<"$spaces" >/dev/null; then
  space=sp-$(printf '%s' "wt-${repo##*/}-$slug" | sed -E 's/[^A-Za-z0-9-]+/-/g')
  hc run --bg --no-parent --no-notify --cwd "$path" --label "herdr.space=$space" >/dev/null 2>&1 ||
    echo "warning: could not open a space for $path" >&2
fi
echo "$path"
