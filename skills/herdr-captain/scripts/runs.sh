#!/usr/bin/env bash
# List herdr-orchestrator runs with their live Herdr state, for herdr-captain.
#
# Usage: runs.sh [--all]
#
# Reads every run directory under ~/.herdr/orchestration
# that has an orchestrator.json, skipping finished runs unless --all is given.
# For each prints its directory, branch, repository, the Status line of its
# plan.md, its orchestrator pane's state and progress label, its open question
# to the user, and unhandled markers. Then lists "🐙" and older "orc:" tabs that
# no run directory claims.
set -u
. "$(dirname "$0")/lib.sh"

all=
case ${1:-} in
  "") ;;
  --all) all=1 ;;
  *) echo "usage: runs.sh [--all]" >&2; exit 2 ;;
esac
if ! agents=$(herdr agent list 2>/dev/null); then
  agents=
  echo "warning: herdr agent list failed; orchestrator states are unknown"
fi
tabs=$(herdr tab list 2>/dev/null) || tabs='{"result":{"tabs":[]}}'
claimed=" "
found=0

while IFS= read -r run_info <&3; do
  dir=$(dirname "$run_info")
  claimed+="$(jq -r '.tab_id // empty' "$run_info") "
  status=$(plan_status "$dir")
  [ -n "$all" ] || [ "$status" != finished ] || continue
  found=1
  pane=$(jq -r '.pane_id // empty' "$run_info")

  if [ -z "$agents" ]; then
    orchestrator="$pane unknown"
  else
    state=$(pane_state "$agents" "$pane")
    if [ -z "$state" ]; then
      orchestrator="$pane gone (no agent in that pane)"
    else
      label=$(herdr pane get "$pane" 2>/dev/null |
        jq -r --arg s "$state" '.result.pane.state_labels[$s] // empty')
      orchestrator="$pane $state${label:+ ($label)}"
    fi
  fi

  markers=$(unhandled_markers "$dir" | while read -r f; do printf '%s ' "${f##*/}"; done)

  echo "run: $dir"
  echo "  branch: $(jq -r '.branch // "?"' "$run_info")  repo: $(jq -r '.repo // "?"' "$run_info")"
  echo "  plan: ${status:-no Status line}"
  echo "  orchestrator: $orchestrator"
  [ -e "$dir/question.md" ] && echo "  question: $dir/question.md"
  [ -n "$markers" ] && echo "  unhandled: $markers"
done 3< <(run_infos)
[ "$found" = 1 ] || if [ -n "$all" ]; then echo "no runs under $root"; else echo "no unfinished runs under $root (--all includes finished ones)"; fi

for tab in $(jq -r '.result.tabs[] | select(.label | startswith("🐙") or startswith("orc:")) | .tab_id' <<<"$tabs"); do
  case $claimed in *" $tab "*) continue ;; esac
  echo "unclaimed tab: $tab $(jq -r --arg t "$tab" '.result.tabs[] | select(.tab_id == $t) | .label' <<<"$tabs")"
done
