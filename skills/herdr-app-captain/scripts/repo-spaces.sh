#!/usr/bin/env bash
# List the Herdr window's spaces by git repository or plain folder, for herdr-app-captain.
#
# Usage: repo-spaces.sh [repository or folder name or path]
#
# Prints one line per space and repository, filtered to the given one if any:
#   <space-id>    primary|worktree|folder    <root>    <name>
# "primary" is the repository's own checkout, where an orchestrator starts;
# "worktree" is a linked worktree, which belongs to a run; "folder" is a folder
# outside any repository, such as one holding a frontend and a backend
# repository, where an orchestrator for both starts.
#
# Asks git about each terminal's working directory. Uses the foreground program's,
# since the terminal's own stays where its shell began. Exits 1 if no window is open.
set -u

[ $# -le 1 ] || { echo "usage: repo-spaces.sh [repository or folder name or path]" >&2; exit 2; }
repo=${1:-}
path=$repo
[ -z "$repo" ] || [ ! -d "$repo" ] || path=$(cd "$repo" && pwd -P)
layout=$(herdr-app ls) || exit 1

jq -r '.spaces[] | select(.machine == null) | . as $s | .tabs[].terminals[] | "\($s.id)\t\(.terminal)\t\($s.name // "")"' <<<"$layout" |
  while IFS=$'\t' read -r space terminal name; do
    cwd=$(hc get "$terminal" --json 2>/dev/null | jq -r '.foreground.cwd // .cwd // empty')
    [ -n "$cwd" ] || continue
    if common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) &&
      top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null); then
      root=${common%/.git}
      kind=worktree
      [ "$top" = "$root" ] && kind=primary
    else
      root=$(cd "$cwd" 2>/dev/null && pwd -P) || continue
      kind=folder
    fi
    case $repo in
      "" | "${root##*/}") ;;
      *) [ "$path" = "$root" ] || continue ;;
    esac
    printf '%s\t%s\t%s\t%s\n' "$space" "$kind" "$root" "$name"
  done | sort -u
