#!/usr/bin/env bash
# List herdr-app-orchestrator runs with their live state, for herdr-app-captain.
#
# Usage: runs.sh [--all]
#
# Reads every run directory under ~/.herdr/hc-orchestration that has an
# orchestrator.json, skipping closed runs (a closed marker, or finished with the
# orchestrator terminal gone) unless --all is given. A finished run whose
# orchestrator is still there is open: its plan line says "finished, PR open until
# its tab is closed". A parked run is listed, its plan line saying "parked <time>
# (was: <status>)". For each prints
# its directory, branch, start folder (its repository, or the folder holding
# several), the Status line of its plan.md, its orchestrator terminal's state, the
# dialog it is blocked on, its status.json's type, topic, progress, tasks, waiting agents, issues,
# PRs, related PRs (ones the run is about but did not open) and when they were last
# published, its open question to the user, and unhandled messages. Then lists orchestrator terminals (role=orchestrator) that no
# run directory claims, and "🐙" tabs that none claims, when the Herdr window is open.
set -u
. "$(dirname "$0")/lib.sh"

all=
case ${1:-} in
  "") ;;
  --all) all=1 ;;
  *) echo "usage: runs.sh [--all]" >&2; exit 2 ;;
esac
if ! terminals=$(hc ls --json 2>/dev/null); then
  terminals=
  echo "warning: hc ls failed; orchestrator states are unknown"
fi
claimed=" " claimed_terminals=" "
found=0

# Each other machine's runs, read at once into a copy (lib.sh's run_sources).
copies=$(mktemp -d)
trap 'rm -rf "$copies"' EXIT
machines_listed=1
sources=$(run_sources "$copies") || {
  machines_listed=
  echo "warning: hc machine ls failed; runs on other machines are not listed"
}

# list_runs <machine> <folder to read> <root there>: prints the runs in one source.
list_runs() {
  local machine=$1 from=$2 there=$3
  while IFS= read -r run_info <&3; do
    dir=$(dirname "$run_info")
    IFS=$'\x1f' read -r branch folder terminal tab < <(run_facts "$run_info")
    # A run on another machine: its terminal and tab as hc ls and the window name them
    # here, and its directory there.
    [ -z "$machine" ] || [ -z "$terminal" ] || terminal=$machine/$terminal
    [ -z "$machine" ] || [ -z "$tab" ] || tab=$machine/$tab
    address=$(run_address "$machine" "$there${dir#"$from"}")
    claimed+="$tab "
    claimed_terminals+="$terminal "
    status=$(plan_status "$dir")
    state=
    [ -z "$terminals" ] || state=$(terminal_state "$terminals" "$terminal")
    # Without hc, a terminal's state is unknown, so only a closed marker closes a run.
    known=$state
    [ -n "$terminals" ] || known=unknown
    away=$(away_state "$dir" "$status" "$known")
    [ "$away" != closed ] || [ -n "$all" ] || continue
    found=1
    dialog=

    if [ -z "$terminals" ]; then
      orchestrator="$terminal unknown"
    else
      if [ -z "$state" ]; then
        orchestrator="$terminal gone (no live terminal)"
      elif [ "$state" = lost ]; then
        orchestrator="$terminal gone (lost: only a shell is left in its terminal, as after a restart; its tab is still open)"
      else
        orchestrator="$terminal $state"
        [ "$state" != blocked ] || dialog=$(hc get "$terminal" --json 2>/dev/null | jq -r '.status.msg // empty')
      fi
    fi

    messages=$(unhandled_messages "$dir" | while read -r f; do printf '%s ' "${f##*/}"; done)

    echo "run: $address"
    echo "  branch: $branch  folder: $folder"
    plan=${status:-no Status line}
    marker=$(run_marker "$dir")
    if [ -n "$marker" ]; then plan="$marker $(marker_text "$dir/$marker")"
    elif [ "$status" = finished ]; then
      if [ "$state" = lost ]; then plan="finished, PR open; its orchestrator is lost, its tab still open"
      elif [ -n "$state" ]; then plan="finished, PR open until its tab is closed"
      elif [ -n "$terminals" ]; then plan="finished, closed"; fi
    fi
    echo "  plan: $plan"
    echo "  orchestrator: $orchestrator"
    [ -z "$dialog" ] || echo "  dialog: $dialog"
    [ ! -e "$dir/status.json" ] || jq -r '
      (.type // empty | "  type: \(.)"),
      (.topic // empty | "  topic: \(.)"),
      (.autonomy // empty | "  autonomy: \(.)"),
      (if .progress or .tasks then "  progress: \([.progress // empty,
        (.tasks // empty | "\(.merged)/\(.planned) tasks merged")] | join("; "))" else empty end),
      (if (.waiting // [] | length) > 0 then "  waiting agents: \(.waiting | join(" "))" else empty end),
      (.issues[]? | "  issue: \(.)"),
      (.prs[]? | "  pr: \(.repo) \(.url)"),
      (.related[]? | "  related pr: \(.repo) \(.url)"),
      (.updated // empty | "  facts updated: \(.)")' "$dir/status.json"
    [ -e "$dir/question.md" ] && echo "  question: $address/question.md"
    [ -n "$messages" ] && echo "  unhandled: $messages"
  done 3< <(run_infos "$from")
}
unread=
while IFS=$'\x1f' read -r machine from there <&5; do
  case $from in
    !*) unread+="$machine"$'\t'"${from#!}"$'\n' ;;
    *) list_runs "$machine" "$from" "$there" ;;
  esac
done 5<<<"$sources"
[ "$found" = 1 ] || if [ -n "$all" ]; then echo "no runs under $root"; else echo "no open runs under $root (--all includes closed ones)"; fi
# Not "no runs": a machine whose runs could not be read may well have some.
while IFS=$'\t' read -r m why; do
  [ -z "$m" ] || echo "machine $m: cannot be read ($why); its runs are not listed"
done <<<"$unread"

# The captain labels the orchestrators it starts role=orchestrator, as init-run.sh
# does. One that no run directory names has not run init-run.sh: still starting, or
# working without the skill.
[ -z "$terminals" ] || hc ls --json --label role=orchestrator 2>/dev/null |
  jq -r '.terminals[] | [.address, (.name // "-"), (.status // "starting"), (.where // "-")] | join("\t")' |
  while IFS=$'\t' read -r address name state where; do
    case $claimed_terminals in *" $address "*) continue ;; esac
    # Without hc machine ls, no other machine's runs were read: none of theirs is unclaimed.
    case $address in */*) case ${machines_listed:-*}$'\n'$unread in "*"* | *$'\n'"${address%%/*}"$'\t'*)
      echo "orchestrator on unreadable machine ${address%%/*}: $address $name $state ($where), its run unknown"
      continue ;; esac ;; esac
    echo "unclaimed orchestrator: $address $name $state ($where), no run directory"
  done

layout=$(herdr-app ls 2>/dev/null) || exit 0
jq -r '.spaces[].tabs[] | select(.name | startswith("🐙")) | "\(.id)\t\(.name)"' <<<"$layout" |
  while IFS=$'\t' read -r tab name; do
    case $claimed in *" $tab "*) continue ;; esac
    echo "unclaimed tab: $tab $name"
  done
