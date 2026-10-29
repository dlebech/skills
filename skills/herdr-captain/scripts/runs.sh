#!/usr/bin/env bash
# List herdr-orchestrator runs with their live Herdr state, for herdr-captain.
#
# Usage: runs.sh [--all]
#
# Reads every run directory under ${XDG_CACHE_HOME:-~/.cache}/herdr-orchestrator
# that has an orchestrator.json, skipping finished runs unless --all is given.
# For each run prints its directory, branch, repository, the Status line of its
# plan.md, its orchestrator pane's state and progress label, and unhandled
# markers in status/. Then lists "orc:" tabs that no run directory claims.
set -u

all=
[ "${1:-}" = --all ] && all=1
root=${XDG_CACHE_HOME:-$HOME/.cache}/herdr-orchestrator
agents=$(herdr agent list 2>/dev/null) || agents='{"result":{"agents":[]}}'
tabs=$(herdr tab list 2>/dev/null) || tabs='{"result":{"tabs":[]}}'
claimed=()
found=0

for info in "$root"/*/*/orchestrator.json; do
  [ -e "$info" ] || continue
  dir=$(dirname "$info")
  claimed+=("$(jq -r '.tab_id // empty' "$info")")
  status=$(head -1 "$dir/plan.md" 2>/dev/null | sed 's/^Status: *//')
  [ -n "$all" ] || [ "$status" != finished ] || continue
  found=1
  pane=$(jq -r '.pane_id // empty' "$info")

  state=$(jq -r --arg p "$pane" '.result.agents[] | select(.pane_id == $p) | .agent_status' <<<"$agents" | head -1)
  if [ -z "$state" ]; then
    orchestrator="$pane gone (no agent in that pane)"
  else
    label=$(herdr pane get "$pane" 2>/dev/null |
      jq -r --arg s "$state" '.result.pane.state_labels[$s] // empty')
    orchestrator="$pane $state${label:+ ($label)}"
  fi

  markers=()
  for f in "$dir"/status/*.done "$dir"/status/*.question "$dir"/status/*.failed "$dir"/status/*.message; do
    [ -e "$f" ] && markers+=("$(basename "$f")")
  done

  echo "run: $dir"
  echo "  branch: $(jq -r '.branch // "?"' "$info")  repo: $(jq -r '.repo // "?"' "$info")"
  echo "  plan: ${status:-no Status line}"
  echo "  orchestrator: $orchestrator"
  [ ${#markers[@]} -gt 0 ] && echo "  unhandled: ${markers[*]}"
done
[ "$found" = 1 ] || if [ -n "$all" ]; then echo "no runs under $root"; else echo "no unfinished runs under $root (--all includes finished ones)"; fi

for tab in $(jq -r '.result.tabs[] | select(.label | startswith("orc:")) | .tab_id' <<<"$tabs"); do
  case " ${claimed[*]} " in *" $tab "*) continue ;; esac
  echo "unclaimed tab: $tab $(jq -r --arg t "$tab" '.result.tabs[] | select(.tab_id == $t) | .label' <<<"$tabs")"
done
