#!/usr/bin/env bash
# Watch herdr-app-orchestrator runs and exit as soon as one newly needs the user.
#
# Usage: hc run --bg --name captain-watch <path>/watch-runs.sh
#
# Runs in its own hc terminal, as a child of herdr-app-captain: hc tells the captain
# when it exits, whatever the agent kind, it ends with the captain, and the unique
# name means only one runs at a time. The captain reads its output and starts it
# again. Prints one line per new event, then exits:
#   attention <branch> <reason>    <run-directory>
# Reasons: the plan's "waiting for user" or "blocked" status, finished, the
# orchestrator terminal gone or blocked on a dialog, or the orchestrator idle for two
# minutes while its plan is unfinished. An event is reported once; it can fire again
# after it clears. Exits 1 if hc stops answering.
#
# It checks at once whenever an orchestrator's terminal changes (hc events on the
# role=orchestrator label: status, labels such as set-status.sh's run.status,
# finishing; the filter follows labels, so an orchestrator labelled after the
# stream opened counts too), and otherwise every WATCH_RUNS_INTERVAL seconds, which keeps the idle
# timer and plan.md-only changes going.
#
# Its memory lives in the runs root, so a restart neither repeats events nor
# resets the idle timer: .captain-seen (reported events) and .captain-idle
# ("<since>\t<run-directory>" for orchestrators seen idle).
set -u
. "$(dirname "$0")/lib.sh"

interval=${WATCH_RUNS_INTERVAL:-30}
idle_grace=${WATCH_RUNS_IDLE_GRACE:-120}
max_hc_failures=5

[ $# -eq 0 ] || { echo "usage: watch-runs.sh" >&2; exit 2; }
seen_file=$root/.captain-seen
idle_file=$root/.captain-idle
mkdir -p "$root"
chmod 700 "$root"
touch "$seen_file" "$idle_file"

# Events arrive on fd 4. A restarted stream is checked right away, since it may
# have missed some.
open_events() {
  exec 4< <(hc events --label role=orchestrator 2>/dev/null)
}

# Returns after an event (taking a burst as one), the interval, or the stream ending.
wait_for_change() {
  local line left deadline=$((SECONDS + interval))
  while left=$((deadline - SECONDS)); [ "$left" -gt 0 ]; do
    if read -r -t "$left" -u 4 line; then
      case $line in *'"method":"event"'*) ;; *) continue ;; esac
      while read -r -t 1 -u 4 line; do :; done
      return
    elif [ $? -le 128 ]; then
      sleep 2
      open_events
      return
    fi
  done
}

open_events
hc_failures=0
while :; do
  if ! terminals=$(hc ls --json 2>/dev/null); then
    # Without hc every orchestrator would look gone; wait for it instead.
    hc_failures=$((hc_failures + 1))
    if [ "$hc_failures" -ge "$max_hc_failures" ]; then
      echo "error: hc ls failed $hc_failures times in a row" >&2
      exit 1
    fi
    sleep "$interval"
    continue
  fi
  hc_failures=0
  now=$(date +%s)
  current=()
  idle=()
  while IFS= read -r run_info <&3; do
    dir=$(dirname "$run_info")
    IFS=$'\x1f' read -r branch _ terminal _ < <(run_facts "$run_info")
    status=$(plan_status "$dir")
    reasons=()

    case $status in # the statuses lib.sh lists
      "waiting for user"* | blocked*) reasons+=("$status") ;;
      finished) reasons+=("finished") ;;
    esac
    if [ "$status" != finished ]; then
      case $(terminal_state "$terminals" "$terminal") in
        "") reasons+=("orchestrator gone") ;;
        blocked) reasons+=("orchestrator blocked on a dialog") ;;
        idle | done)
          since=$(awk -F '\t' -v d="$dir" '$2 == d { print $1; exit }' "$idle_file")
          since=${since:-$now}
          idle+=("$since	$dir")
          [ $((now - since)) -ge "$idle_grace" ] && reasons+=("orchestrator idle") ;;
      esac
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
  wait_for_change
done
