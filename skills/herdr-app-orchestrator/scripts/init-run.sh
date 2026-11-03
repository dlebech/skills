#!/usr/bin/env bash
# Create this orchestrator's run directory, or register it again after a resume.
#
# Usage: init-run.sh <integration-branch>    (run inside the repository, in an hc terminal)
#
# Creates ~/.herdr/hc-orchestration/<repo>/<branch>/ with inbox/ and shared/,
# with any "/" in the branch name as "-", since herdr-app-captain scans one level
# deep; keeps the runs root private, and writes orchestrator.json, which is how
# herdr-app-captain finds the run. A new run also gets plan.md and its tab name.
# Prints "new <run-directory>" or "existing <run-directory>".
set -eu

[ $# -eq 1 ] || { echo "usage: init-run.sh <integration-branch>" >&2; exit 2; }
[ -n "${HC_TERMINAL_ID:-}" ] || { echo "not in an hc terminal: HC_TERMINAL_ID is unset" >&2; exit 1; }
branch=$1
common=$(git rev-parse --path-format=absolute --git-common-dir)
repo=${common%/.git}
root=${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}
dir=$root/${repo##*/}/${branch//\//-}

state=existing
[ -e "$dir/plan.md" ] || state=new
mkdir -p "$dir/inbox" "$dir/shared"
chmod 700 "$root"
tab=$(hc get "$HC_TERMINAL_ID" --json | jq -r '.labels["herdr.tab"] // empty')
jq -n --arg terminal "$HC_TERMINAL_ID" --arg tab "$tab" --arg repo "$repo" --arg branch "$branch" \
  '{terminal: $terminal, tab_id: $tab, repo: $repo, branch: $branch}' >"$dir/orchestrator.json"
hc label "$HC_TERMINAL_ID" role=orchestrator >/dev/null
if [ "$state" = new ]; then
  echo "Status: running" >"$dir/plan.md"
  "$(dirname "$0")/set-status.sh" "$dir" running
fi
echo "$state $dir"
