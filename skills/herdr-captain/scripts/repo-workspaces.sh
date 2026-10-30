#!/usr/bin/env bash
# List Herdr workspaces by git repository, for herdr-captain.
#
# Usage: repo-workspaces.sh [repository name or path]
#
# Prints one line per workspace and repository, filtered to the given
# repository if any:
#   <workspace-id>    primary|worktree    <repo-root>    <label>
# "primary" is the repository's own checkout, where an orchestrator starts;
# "worktree" is a linked worktree, which belongs to a run.
#
# Asks git about each pane's directory, because Herdr's workspace list leaves
# out .worktree for many workspaces.
set -u

[ $# -le 1 ] || { echo "usage: repo-workspaces.sh [repository name or path]" >&2; exit 2; }
repo=${1:-}
path=$repo
[ -z "$repo" ] || [ ! -d "$repo" ] || path=$(cd "$repo" && pwd -P)
workspaces=$(herdr workspace list) || exit 1
panes=$(herdr pane list) || exit 1

jq -r '.result.panes[] | "\(.workspace_id)\t\(.cwd)"' <<<"$panes" | sort -u |
  while IFS=$'\t' read -r ws cwd; do
    common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || continue
    top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || continue
    root=${common%/.git}
    kind=worktree
    [ "$top" = "$root" ] && kind=primary
    case $repo in
      "" | "${root##*/}") ;;
      *) [ "$path" = "$root" ] || continue ;;
    esac
    label=$(jq -r --arg w "$ws" '.result.workspaces[] | select(.workspace_id == $w) | .label' <<<"$workspaces")
    printf '%s\t%s\t%s\t%s\n' "$ws" "$kind" "$root" "$label"
  done | sort -u
