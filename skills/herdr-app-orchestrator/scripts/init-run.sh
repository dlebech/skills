#!/usr/bin/env bash
# Create this orchestrator's run directory, or register it again after a resume.
#
# Usage: init-run.sh <integration-branch>    (run in an hc terminal, from the folder the
#        orchestrator started in: a repository, or a folder holding the run's repositories)
#
# Creates ~/.herdr/hc-orchestration/<folder>/<branch>/ with inbox/ and shared/, where
# <folder> is the last part of the repository's path, or of the start folder's for a
# run across several, and <branch> is the branch as branch_slug in lib.sh writes it,
# since herdr-app-captain scans one level deep; keeps the runs root private, and
# writes orchestrator.json, which is how herdr-app-captain finds the run. A new run
# also gets plan.md and its tab name.
# Prints "new <run-directory>" or "existing <run-directory>". Exits 3 if the
# directory belongs to a run from another folder of the same name.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

[ $# -eq 1 ] || { echo "usage: init-run.sh <integration-branch>" >&2; exit 2; }
[ -n "${HC_TERMINAL_ID:-}" ] || { echo "not in an hc terminal: HC_TERMINAL_ID is unset" >&2; exit 1; }
branch=$1
if common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
  folder=${common%/.git}
else
  folder=$(pwd -P)
fi
# The same default as herdr-app-captain's scripts/lib.sh.
root=${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}
dir=$root/${folder##*/}/$(branch_slug "$branch")

if [ -e "$dir/orchestrator.json" ]; then
  owner=$(jq -r '.folder // empty' "$dir/orchestrator.json")
  if [ -n "$owner" ] && [ "$owner" != "$folder" ]; then
    echo "$dir belongs to a run started in $owner; choose another branch name" >&2
    exit 3
  fi
fi
state=existing
[ -e "$dir/plan.md" ] || state=new
mkdir -p "$dir/inbox" "$dir/shared"
chmod 700 "$root"
tab=$(hc get "$HC_TERMINAL_ID" --json | jq -r '.labels["herdr.tab"] // empty')
jq -n --arg terminal "$HC_TERMINAL_ID" --arg tab "$tab" --arg folder "$folder" --arg branch "$branch" \
  '{terminal: $terminal, tab_id: $tab, folder: $folder, branch: $branch}' >"$dir/orchestrator.json"
hc label "$HC_TERMINAL_ID" role=orchestrator >/dev/null
if [ "$state" = new ]; then
  echo "Status: running" >"$dir/plan.md"
  "$(dirname "$0")/set-status.sh" "$dir" running
fi
echo "$state $dir"
