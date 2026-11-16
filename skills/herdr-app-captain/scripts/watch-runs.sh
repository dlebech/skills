#!/usr/bin/env bash
# Watch herdr-app-orchestrator runs and exit as soon as one newly needs the user.
#
# Usage: hc run --bg --no-notify --name captain-watch <path>/watch-runs.sh
#
# Runs in its own hc terminal, as a child of herdr-app-captain: it ends with the
# captain, and the unique name means only one runs at a time. The captain learns
# that it exited from wait-watch.sh, run as its own background job, rather than
# from hc's exit note, which would be typed into the box the user writes in. The
# captain reads its output and starts it again. Prints one line per new event, then
# exits:
#   attention <branch> <reason>    <run-directory>
#   cleared <branch> <reason>      <run-directory>
#   update <branch> pr <url>       <run-directory>
# Every line is the whole update: the captain reads the run's files for detail.
# Reasons: the plan's "waiting for user" or "blocked" status, a question.md (its
# title, for a new or reworded one), finished, the
# orchestrator terminal gone or blocked on a dialog, or the orchestrator idle for two
# minutes while its plan is unfinished. Parked and closed runs (their markers) raise
# nothing. An event is reported once; it can fire again after it clears. A reported
# "waiting for user", "blocked" or dialog event that clears is reported as cleared,
# since the user may have answered it in the orchestrator's tab, unless the run has a
# new event of its own (finished, orchestrator gone, a new question). Exits 1 if hc
# stops answering.
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
prs_flag=$root/.captain-seen-prs
mkdir -p "$root"
chmod 700 "$root"
touch "$seen_file" "$idle_file"
copies=$(mktemp -d)
trap 'rm -rf "$copies"' EXIT

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
  copy_of= # "<address>\t<copy>" lines, for the runs of other machines
  # Each other machine's runs, read at once (lib.sh's run_sources). One that cannot be
  # read keeps what was reported for it (carried below), so it neither repeats nor clears.
  rm -rf "$copies" && mkdir -p "$copies"
  unread=
  sources=$(run_sources "$copies") || unread=" *"
  while IFS=$'\x1f' read -r machine from there <&5; do
    case $from in !*) unread+=" $machine"; continue ;; esac
    while IFS= read -r run_info <&3; do
      dir=$(dirname "$run_info")
      IFS=$'\x1f' read -r branch _ terminal _ < <(run_facts "$run_info")
      [ -z "$machine" ] || [ -z "$terminal" ] || terminal=$machine/$terminal
      address=$(run_address "$machine" "$there${dir#"$from"}")
      [ -z "$machine" ] || copy_of+="$address"$'\t'"$dir"$'\n'
      # The user put it away; resuming deletes the marker and brings it back.
      [ -z "$(run_marker "$dir")" ] || continue
      status=$(plan_status "$dir")
      reasons=()

      case $status in # the statuses lib.sh lists
        "waiting for user"* | blocked*) reasons+=("$status") ;;
        finished) reasons+=("finished") ;;
      esac
      if [ "$status" != finished ]; then
        case $(terminal_state "$terminals" "$terminal") in
          "" | lost) reasons+=("orchestrator gone") ;;
          blocked) reasons+=("orchestrator blocked on a dialog") ;;
          idle | done)
            since=$(awk -F '\t' -v d="$address" '$2 == d { print $1; exit }' "$idle_file")
            since=${since:-$now}
            idle+=("$since	$address")
            [ $((now - since)) -ge "$idle_grace" ] && reasons+=("orchestrator idle") ;;
        esac
      fi
      # An open question is a reason of its own unless the plan status already carries
      # it; its title is the one-line summary, so a new or reworded question is news. Not while
      # an inbox message waits: that is the answer, and the orchestrator is still clearing the question.
      # Level requests, asks to prove and asks what is blocking are no answers, so they do not hide the question.
      if [ "$status" != finished ] && [ -z "$(answer_messages "$dir")" ]; then
        case $status in "waiting for user"*) ;; *)
          title=$(question_title "$dir")
          [ -z "$title" ] || reasons+=("question: $title") ;;
        esac
      fi
      for r in ${reasons[@]+"${reasons[@]}"}; do current+=("attention $branch $r	$address"); done
      # PRs are news, not a call for the user: one line each, once. A finished run's
      # "finished" line already says its PRs are up.
      [ "$status" = finished ] || while IFS= read -r url; do
        [ -z "$url" ] || current+=("update $branch pr $url	$address")
      done < <(jq -r '(.prs // [])[]?.url // empty' "$dir/status.json" 2>/dev/null)
    done 3< <(run_infos "$from")
  done 5<<<"$sources"
  # carried <address>: whether it is on a machine that could not be read this time.
  carried() {
    case $1 in /*) return 1 ;; esac
    case "$unread " in *" * "* | *" ${1%%:*} "*) return 0 ;; esac
    return 1
  }
  while IFS= read -r line; do
    [ -n "$line" ] && carried "${line##*	}" && current+=("$line")
  done <"$seen_file"
  while IFS= read -r line; do
    [ -n "$line" ] && carried "${line##*	}" && idle+=("$line")
  done <"$idle_file"

  # Remember only what is still true, so a cleared event can fire again.
  printf '%s\n' ${idle[@]+"${idle[@]}"} | sed '/^$/d' >"$idle_file"
  new=()
  for line in ${current[@]+"${current[@]}"}; do
    grep -qxF -- "$line" "$seen_file" && continue
    # The first pass after PR updates existed (no flag yet) only records the PRs
    # already open, so an upgrade does not dump them all at once.
    case $line in "update "*) [ -e "$prs_flag" ] || continue ;; esac
    new+=("$line")
  done
  # A question or dialog reported earlier that is gone now, typically answered in the
  # orchestrator's own tab, so the captain can say it no longer needs the user.
  # Parked and closed runs drop out of current too; those are not answers. Nor is a
  # dialog that went with its orchestrator: a run with a new event of its own, such as
  # orchestrator gone or finished, is reported by that event instead.
  reported=
  for line in ${new[@]+"${new[@]}"}; do reported+=${line#*$'\t'}$'\n'; done
  while IFS= read -r line; do
    case $line in
      "attention "*" waiting for user"* | "attention "*" blocked"* | "attention "*" question: "* | "attention "*" orchestrator blocked on a dialog"*) ;;
      *) continue ;;
    esac
    printf '%s\n' ${current[@]+"${current[@]}"} | grep -qxF -- "$line" && continue
    address=${line##*	}
    # Where its files are read: its directory here, or the copy of another machine's.
    dir=$address
    case $address in /*) ;; *) dir=$(awk -F '\t' -v a="$address" '$1 == a { print $2; exit }' <<<"$copy_of") ;; esac
    [ -n "$dir" ] && [ -d "$dir" ] && [ -z "$(run_marker "$dir")" ] || continue
    printf '%s\n' "$reported" | grep -qxF -- "$address" && continue
    new+=("cleared ${line#attention }")
  done <"$seen_file"
  printf '%s\n' ${current[@]+"${current[@]}"} | sed '/^$/d' >"$seen_file"
  touch "$prs_flag"
  if [ ${#new[@]} -gt 0 ]; then
    printf '%s\n' "${new[@]}"
    exit 0
  fi
  wait_for_change
done
