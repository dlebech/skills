#!/usr/bin/env bash
# Watch herdr-orchestrator runs and exit as soon as one newly needs the user.
#
# Usage: watch-runs.sh [--interval SECONDS] [--idle-grace SECONDS] [--question-age MINUTES]
#
# Meant to run as a background job of herdr-captain, which reports the events
# and starts it again. Prints one line per new event, then exits:
#   attention <branch> <reason>    <run-directory>
# Reasons: the plan's "waiting for user" or "blocked" status, finished, the
# orchestrator pane gone or blocked on a dialog, the orchestrator idle for
# --idle-grace seconds (default 120) while its plan is unfinished, a .failed
# marker, or a sub-agent .question unhandled for --question-age minutes
# (default 30). An event is reported once; it can fire again after it clears.
set -u

interval=30
idle_grace=120
question_age=30
while [ $# -gt 0 ]; do
  case $1 in
    --interval) interval=$2; shift 2 ;;
    --idle-grace) idle_grace=$2; shift 2 ;;
    --question-age) question_age=$2; shift 2 ;;
    *) echo "usage: watch-runs.sh [--interval S] [--idle-grace S] [--question-age MIN]" >&2; exit 2 ;;
  esac
done

root=${XDG_CACHE_HOME:-$HOME/.cache}/herdr-orchestrator
seen_file=$root/.captain-seen
mkdir -p "$root"
touch "$seen_file"
declare -A idle_since

while :; do
  agents=$(herdr agent list 2>/dev/null) || agents='{"result":{"agents":[]}}'
  now=$(date +%s)
  current=()
  for info in "$root"/*/*/orchestrator.json; do
    [ -e "$info" ] || continue
    dir=$(dirname "$info")
    branch=$(jq -r '.branch // "?"' "$info")
    pane=$(jq -r '.pane_id // empty' "$info")
    status=$(head -1 "$dir/plan.md" 2>/dev/null | sed 's/^Status: *//')
    reasons=()

    case $status in
      "waiting for user"* | blocked*) reasons+=("$status") ;;
      finished) reasons+=("finished") ;;
    esac
    if [ "$status" != finished ]; then
      state=$(jq -r --arg p "$pane" '.result.agents[] | select(.pane_id == $p) | .agent_status' <<<"$agents" | head -1)
      case $state in
        "") reasons+=("orchestrator gone") ;;
        blocked) reasons+=("orchestrator blocked on a dialog") ;;
        idle | done)
          idle_since[$dir]=${idle_since[$dir]:-$now}
          [ $((now - idle_since[$dir])) -ge "$idle_grace" ] && reasons+=("orchestrator idle") ;;
        *) unset "idle_since[$dir]" ;;
      esac
      for f in "$dir"/status/*.failed; do
        [ -e "$f" ] && reasons+=("failed: $(basename "$f" .failed)")
      done
      for f in "$dir"/status/*.question; do
        [ -e "$f" ] || continue
        [ $((now - $(stat -c %Y "$f"))) -ge $((question_age * 60)) ] &&
          reasons+=("unanswered question: $(basename "$f" .question)")
      done
    fi
    for r in "${reasons[@]}"; do current+=("attention $branch $r	$dir"); done
  done

  new=()
  for line in "${current[@]}"; do
    grep -qxF -- "$line" "$seen_file" || new+=("$line")
  done
  # Remember only what is still true, so a cleared event can fire again.
  printf '%s\n' "${current[@]}" | sed '/^$/d' >"$seen_file"
  if [ ${#new[@]} -gt 0 ]; then
    printf '%s\n' "${new[@]}"
    exit 0
  fi
  sleep "$interval"
done
