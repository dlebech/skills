#!/usr/bin/env bash
# List herdr-app-orchestrator runs with their live state, for herdr-app-captain.
#
# Usage: runs.sh [--all]
#
# Reads every run directory under ~/.herdr/hc-orchestration that has an
# orchestrator.json, skipping finished runs unless --all is given. For each prints
# its directory, branch, start folder (its repository, or the folder holding
# several), the Status line of its plan.md, its orchestrator terminal's state, the
# dialog it is blocked on, its status.json's progress, tasks, waiting agents, issues,
# PRs and when they were last published, its open question to the user, and
# unhandled messages. Then lists "🐙" tabs that no run directory claims, when the
# Herdr window is open.
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
claimed=" "
found=0

while IFS= read -r run_info <&3; do
  dir=$(dirname "$run_info")
  IFS=$'\x1f' read -r branch folder terminal tab < <(run_facts "$run_info")
  claimed+="$tab "
  status=$(plan_status "$dir")
  [ -n "$all" ] || [ "$status" != finished ] || continue
  found=1
  dialog=

  if [ -z "$terminals" ]; then
    orchestrator="$terminal unknown"
  else
    state=$(terminal_state "$terminals" "$terminal")
    if [ -z "$state" ]; then
      orchestrator="$terminal gone (no live terminal)"
    else
      orchestrator="$terminal $state"
      [ "$state" != blocked ] || dialog=$(hc get "$terminal" --json 2>/dev/null | jq -r '.status.msg // empty')
    fi
  fi

  messages=$(unhandled_messages "$dir" | while read -r f; do printf '%s ' "${f##*/}"; done)

  echo "run: $dir"
  echo "  branch: $branch  folder: $folder"
  echo "  plan: ${status:-no Status line}"
  echo "  orchestrator: $orchestrator"
  [ -z "$dialog" ] || echo "  dialog: $dialog"
  [ ! -e "$dir/status.json" ] || jq -r '
    (if .progress or .tasks then "  progress: \([.progress // empty,
      (.tasks // empty | "\(.merged)/\(.planned) tasks merged")] | join("; "))" else empty end),
    (if (.waiting // [] | length) > 0 then "  waiting agents: \(.waiting | join(" "))" else empty end),
    (.issues[]? | "  issue: \(.)"),
    (.prs[]? | "  pr: \(.repo) \(.url)"),
    (.updated // empty | "  facts updated: \(.)")' "$dir/status.json"
  [ -e "$dir/question.md" ] && echo "  question: $dir/question.md"
  [ -n "$messages" ] && echo "  unhandled: $messages"
done 3< <(run_infos)
[ "$found" = 1 ] || if [ -n "$all" ]; then echo "no runs under $root"; else echo "no unfinished runs under $root (--all includes finished ones)"; fi

layout=$(herdr-app ls 2>/dev/null) || exit 0
jq -r '.spaces[].tabs[] | select(.name | startswith("🐙")) | "\(.id)\t\(.name)"' <<<"$layout" |
  while IFS=$'\t' read -r tab name; do
    case $claimed in *" $tab "*) continue ;; esac
    echo "unclaimed tab: $tab $name"
  done
