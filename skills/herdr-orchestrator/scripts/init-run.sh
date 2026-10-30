#!/usr/bin/env bash
# Create this orchestrator's run directory, or register it again after a resume.
#
# Usage: init-run.sh <integration-branch>    (run inside the repository)
#
# Creates ~/.herdr/orchestration/<repo>/<branch>/ with inbox/ and shared/status/,
# with any "/" in the branch name as "-", since herdr-captain scans one level deep;
# keeps the runs root private, and writes orchestrator.json, which is how
# herdr-captain finds the run. A new run also gets plan.md and its tab name.
# Prints "new <run-directory>" or "existing <run-directory>".
set -eu

[ $# -eq 1 ] || { echo "usage: init-run.sh <integration-branch>" >&2; exit 2; }
branch=$1
common=$(git rev-parse --path-format=absolute --git-common-dir)
repo=${common%/.git}
root=$HOME/.herdr/orchestration
dir=$root/${repo##*/}/${branch//\//-}

state=existing
[ -e "$dir/plan.md" ] || state=new
mkdir -p "$dir/inbox" "$dir/shared/status"
chmod 700 "$root"
jq -n --arg pane "${HERDR_PANE_ID:-}" --arg tab "${HERDR_TAB_ID:-}" --arg repo "$repo" --arg branch "$branch" \
  '{pane_id: $pane, tab_id: $tab, repo: $repo, branch: $branch}' >"$dir/orchestrator.json"
if [ "$state" = new ]; then
  echo "Status: running" >"$dir/plan.md"
  [ -z "${HERDR_TAB_ID:-}" ] || herdr tab rename "$HERDR_TAB_ID" "🐙 $branch" >/dev/null
fi
echo "$state $dir"
