#!/usr/bin/env bash
# Set a run's status: the first line of plan.md, the orchestrator's tab name, and
# its terminal's run.status label (running, waiting, blocked, or finished).
#
# Usage: set-status.sh <run-directory> <status>
#
# <status> is running, "waiting for user: <question>", "blocked: <reason>", or
# finished, the vocabulary herdr-app-captain's scripts/lib.sh documents. The tab becomes "🐙 <branch>", "🐙 ✋ <branch>" or "🐙 ✓ <branch>".
# plan.md is what counts: a closed window, or an orchestrator with no tab, only
# prints a warning, since the run goes on without one.
set -u

[ $# -eq 2 ] || { echo "usage: set-status.sh <run-directory> <status>" >&2; exit 2; }
dir=$1
status=$2
tmp=$dir/.plan.tmp
{ echo "Status: $status"; tail -n +2 "$dir/plan.md"; } >"$tmp" && mv "$tmp" "$dir/plan.md" || exit 1

IFS=$'\x1f' read -r branch terminal tab < <(jq -r '[.branch, .terminal // "", .tab_id // ""] | join("\u001f")' \
  "$dir/orchestrator.json") && [ -n "$branch" ] || exit 1
case $status in
  "waiting for user"*) name="🐙 ✋ $branch" word=waiting ;;
  blocked*) name="🐙 ✋ $branch" word=blocked ;;
  finished) name="🐙 ✓ $branch" word=finished ;;
  *) name="🐙 $branch" word=running ;;
esac
# The label change is an hc event, which wakes herdr-app-captain's watcher at once.
if [ -n "$terminal" ]; then
  hc label "$terminal" "run.status=$word" >/dev/null 2>&1 ||
    echo "warning: could not label terminal $terminal" >&2
fi
if [ -n "$tab" ]; then
  herdr-app do tab.rename --id "$tab" --name "$name" >/dev/null 2>&1 ||
    echo "warning: could not rename tab $tab (is the Herdr window open?)" >&2
fi
exit 0
