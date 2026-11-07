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
# taken over: that exits 3.
#
# The space is made the way the worktree mod's "Open worktree" makes it: space.new
# on the worktree's folder, unnamed, so the sidebar names it after the folder (the
# branch), nests it under the repository's own space, and shows its branch,
# ahead/behind, and changes. space.new always shows the new space, so this switches
# back to the space that was showing, a brief flicker. Only the integration worktree
# gets a space; task worktrees stay hidden.
# (This replaced a space made by starting a plain shell with only a herdr.space
# label. A resumed orchestrator once started inside that shell and moved its folder
# to the main checkout, so the sidebar showed the space as a second, unnested
# checkout, Open worktree made a duplicate, and without herdr.tab the run's
# orchestrator.json got an empty tab_id.)
#
# A space counts as open on the worktree when its first terminal is in it now: the
# rule the worktree mod and the sidebar use, which follow a terminal's live folder.
# Such a space is left alone, so this also reopens a space after a resume. A space
# that was made on the worktree but whose terminal has moved elsewhere no longer
# shows it; that gets a warning, a new space is opened, and the old one is left for
# the user. Never start an orchestrator in this space: it starts in the
# repository's own checkout. A window that cannot be reached only prints a warning:
# the run needs the worktree, not the space. When the window is on another computer,
# connected over ssh, Harbormaster there opens the space. Prints the worktree path.
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

# live_folder <terminal>: where it is now, its foreground program's folder first.
live_folder() {
  hc get "$1" --json 2>/dev/null | jq -r '.foreground.cwd // .cwd // empty'
}

if ! spaces=$(herdr-app ls 2>/dev/null); then
  echo "warning: could not reach the Herdr window; the worktree has no space (with the window on another computer, Harbormaster there opens it)" >&2
else
  shown= drifted=
  while IFS=$'\t' read -r id made first; do
    # As the sidebar does: a space without a terminal folder is where it was made.
    at=
    [ -z "$first" ] || at=$(live_folder "$first")
    at=${at:-$made}
    case $at in
      "$path" | "$path"/*) shown=$id; break ;;
    esac
    [ "$made" != "$path" ] || drifted+="$id (now in $at) "
  done < <(jq -r '.spaces[] | select(.machine == null)
    | [.id, .folder // "", ([.tabs[].terminals[].terminal | select(.)] | first // "")] | @tsv' <<<"$spaces")
  if [ -z "$shown" ]; then
    [ -z "$drifted" ] ||
      echo "warning: spaces made on $path no longer show it, since their terminal moved: $drifted; opening a new one" >&2
    before=$(herdr-app status 2>/dev/null | jq -r '.space // empty')
    if herdr-app do space.new --folder "$path" >/dev/null 2>&1; then
      [ -z "$before" ] || herdr-app do space.select --id "$before" >/dev/null 2>&1 ||
        echo "warning: could not switch back to space $before" >&2
    else
      echo "warning: could not open a space for $path" >&2
    fi
  fi
fi
echo "$path"
