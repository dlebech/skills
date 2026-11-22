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
# writes orchestrator.json ({terminal, tab_id, folder, branch, kind, started}), which is how
# herdr-app-captain finds the run and resumes it with the same kind of agent; started is
# when the run was created, kept on a resume (absent for runs from before it). A new
# run also gets plan.md; either way set-status.sh then publishes the run's
# status.json, labels, and tab name, so a resumed run's new terminal carries them too.
# A resumed run is active again: its parked and closed markers are deleted.
# Warns when this terminal has no tab (herdr.tab label), so the tab cannot be
# renamed or closed, or when it runs in a linked worktree, such as the integration
# worktree's space, instead of the repository's own checkout.
# Prints "new <run-directory>" or "existing <run-directory>". Exits 3 if the
# directory belongs to a run from another folder of the same name.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

[ $# -eq 1 ] || { echo "usage: init-run.sh <integration-branch>" >&2; exit 2; }
[ -n "${HC_TERMINAL_ID:-}" ] || { echo "not in an hc terminal: HC_TERMINAL_ID is unset" >&2; exit 1; }
branch=$1
if common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
  folder=${common%/.git}
  [ "$(git rev-parse --show-toplevel)" = "$folder" ] ||
    echo "warning: running in a linked worktree; start orchestrators from the repository's own checkout, $folder" >&2
else
  folder=$(pwd -P)
fi
# The same default as herdr-app-captain's scripts/lib.sh.
root=${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}
dir=$root/${folder##*/}/$(branch_slug "$branch")

started=
if [ -e "$dir/orchestrator.json" ]; then
  started=$(jq -r '.started // empty' "$dir/orchestrator.json")
  owner=$(jq -r '.folder // empty' "$dir/orchestrator.json")
  if [ -n "$owner" ] && [ "$owner" != "$folder" ]; then
    echo "$dir belongs to a run started in $owner; choose another branch name" >&2
    exit 3
  fi
fi
state=existing
[ -e "$dir/plan.md" ] || state=new
[ "$state" = existing ] || [ -n "$started" ] || started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p "$dir/inbox" "$dir/shared"
chmod 700 "$root"
me=$(hc get "$HC_TERMINAL_ID" --json)
# Codex started without --no-daemon runs its commands in a shared server whose HC_TERMINAL_ID is that of
# the terminal that first started it, often one long gone. Registering that would orphan this run.
[ "$(jq -r '.state // empty' <<<"$me")" = live ] || {
  echo "HC_TERMINAL_ID=$HC_TERMINAL_ID is not a live terminal; if this is Codex, restart it with: codex --no-daemon" >&2
  exit 1
}
tab=$(jq -r '.labels["herdr.tab"] // empty' <<<"$me")
[ -n "$tab" ] ||
  echo "warning: this terminal has no tab (no herdr.tab label), so the run's tab cannot be renamed or closed" >&2
# The agent kind start-agent.sh takes: claude-code reports itself as claude-code. An agent that has not
# reported a status yet (codex, at its first command) is named by the program in the foreground, so a
# resume starts the same kind rather than defaulting to claude.
kind=$(jq -r '(.status.app // .foreground.name // empty) | if . == "claude-code" then "claude" else . end
  | if IN("claude","codex","pi","opencode") then . else empty end' <<<"$me")
jq -n --arg terminal "$HC_TERMINAL_ID" --arg tab "$tab" --arg folder "$folder" --arg branch "$branch" \
  --arg kind "$kind" --arg started "$started" '{terminal: $terminal, tab_id: $tab, folder: $folder, branch: $branch}
  + (if $kind == "" then {} else {kind: $kind} end)
  + (if $started == "" then {} else {started: $started} end)' >"$dir/orchestrator.json"
hc label "$HC_TERMINAL_ID" role=orchestrator >/dev/null
for marker in parked closed; do
  [ ! -e "$dir/$marker" ] || { rm -f "$dir/$marker"; echo "note: the run was $marker; it is active again" >&2; }
done
if [ "$state" = new ]; then
  echo "Status: running" >"$dir/plan.md"
  "$(dirname "$0")/set-status.sh" "$dir" running
else
  "$(dirname "$0")/set-status.sh" "$dir"
fi
echo "$state $dir"
