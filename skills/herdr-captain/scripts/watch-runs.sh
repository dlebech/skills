#!/usr/bin/env bash
# Watch herdr-orchestrator runs and exit as soon as one newly needs the user.
#
# Usage: watch-runs.sh
#
# Meant to run as a background job of herdr-captain, which reports the events
# and starts it again. Prints one line per new event, then exits:
#   attention <branch> <reason>    <run-directory>
# Reasons: the plan's "waiting for user" or "blocked" status, finished, the
# orchestrator pane gone or blocked on a dialog, the orchestrator idle for two
# minutes while its plan is unfinished, a .failed marker, or a sub-agent
# .question unhandled for 30 minutes. An event is reported once; it can fire
# again after it clears. Exits 1 if Herdr stops answering, and 3 if another
# watcher is already running, since two would split the events between them.
# Exits silently once the captain in its pane is gone, since closing a tab does
# not stop a background job and an orphan would hold the lock.
#
# Its memory lives in the runs root, so a restart neither repeats events nor
# resets the idle timer: .captain-seen (reported events) and .captain-idle
# ("<since>\t<run-directory>" for orchestrators seen idle).
set -u
. "$(dirname "$0")/lib.sh"

interval=${WATCH_RUNS_INTERVAL:-30}
idle_grace=120
question_age=$((30 * 60))
max_herdr_failures=5

[ $# -eq 0 ] || { echo "usage: watch-runs.sh" >&2; exit 2; }
seen_file=$root/.captain-seen
idle_file=$root/.captain-idle
mkdir -p "$root"
chmod 700 "$root"
touch "$seen_file" "$idle_file"

lock=$root/.captain-watcher
if pid=$(cat "$lock" 2>/dev/null) && ps -p "$pid" -o args= 2>/dev/null | grep -q watch-runs; then
  echo "another watcher is already running (pid $pid)" >&2
  exit 3
fi
echo $$ >"$lock"
trap 'rm -f "$lock"' EXIT

herdr_failures=0
while :; do
  if ! agents=$(herdr agent list 2>/dev/null); then
    # Without Herdr every orchestrator would look gone; wait for it instead.
    herdr_failures=$((herdr_failures + 1))
    if [ "$herdr_failures" -ge "$max_herdr_failures" ]; then
      echo "error: herdr agent list failed $herdr_failures times in a row" >&2
      exit 1
    fi
    sleep "$interval"
    continue
  fi
  herdr_failures=0
  if [ -n "${HERDR_PANE_ID:-}" ] && ! herdr agent get "$HERDR_PANE_ID" >/dev/null 2>&1; then
    exit 0
  fi
  now=$(date +%s)
  current=()
  idle=()
  while IFS= read -r run_info <&3; do
    dir=$(dirname "$run_info")
    branch=$(jq -r '.branch // "?"' "$run_info")
    pane=$(jq -r '.pane_id // empty' "$run_info")
    status=$(plan_status "$dir")
    reasons=()

    case $status in
      "waiting for user"* | blocked*) reasons+=("$status") ;;
      finished) reasons+=("finished") ;;
    esac
    if [ "$status" != finished ]; then
      case $(pane_state "$agents" "$pane") in
        "") reasons+=("orchestrator gone") ;;
        blocked) reasons+=("orchestrator blocked on a dialog") ;;
        idle | done)
          since=$(awk -F '\t' -v d="$dir" '$2 == d { print $1; exit }' "$idle_file")
          since=${since:-$now}
          idle+=("$since	$dir")
          [ $((now - since)) -ge "$idle_grace" ] && reasons+=("orchestrator idle") ;;
      esac
      for f in "$dir"/shared/status/*.failed; do
        [ -e "$f" ] && reasons+=("failed: $(basename "$f" .failed)")
      done
      for f in "$dir"/shared/status/*.question; do
        # The marker may be handled (renamed) between the glob and stat.
        asked=$(mtime "$f") || continue
        [ $((now - asked)) -ge "$question_age" ] &&
          reasons+=("unanswered question: $(basename "$f" .question)")
      done
    fi
    for r in ${reasons[@]+"${reasons[@]}"}; do current+=("attention $branch $r	$dir"); done
  done 3< <(run_infos)

  # Remember only what is still true, so a cleared event can fire again.
  printf '%s\n' ${idle[@]+"${idle[@]}"} | sed '/^$/d' >"$idle_file"
  new=()
  for line in ${current[@]+"${current[@]}"}; do
    grep -qxF -- "$line" "$seen_file" || new+=("$line")
  done
  printf '%s\n' ${current[@]+"${current[@]}"} | sed '/^$/d' >"$seen_file"
  if [ ${#new[@]} -gt 0 ]; then
    printf '%s\n' "${new[@]}"
    exit 0
  fi
  sleep "$interval"
done
