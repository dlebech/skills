#!/usr/bin/env bash
# Wait in the foreground until one of the orchestrator's agents needs attention.
#
# Usage: wait-agents.sh --status-dir DIR [--label TEXT] [--max SECONDS] <agent>...
#
# <agent> is a Herdr agent name or pane ID. Returns when:
#   - an agent wrote a marker in DIR: <agent>.done, <agent>.question or <agent>.failed,
#     or herdr-captain relayed a user message as <name>.message;
#   - a listed agent is blocked on an approval or question dialog;
#   - a listed agent is gone (exited or released); a failed Herdr call never
#     counts as gone;
#   - --max seconds passed (default 540, under Claude Code's 10-minute tool limit).
# Prints one line per event:
#   marker <file>         rename it to <file>.handled once dealt with
#   blocked <agent>
#   gone <agent>
#   timeout               followed by "state <agent> <status>" for each listed agent;
#                         the status is "unknown" when Herdr did not answer
#
# Herdr's idle/done never counts as finished: an agent that ends its turn while
# its own background job runs looks idle too. Waiting in the foreground keeps
# the caller's own pane honestly working; --label adds a progress label to it.
set -u

status_dir=
label="waiting on agents"
max=540
poll=${WAIT_AGENTS_POLL:-5}
agents=()
while [ $# -gt 0 ]; do
  case $1 in
    --status-dir) status_dir=$2; shift 2 ;;
    --label) label=$2; shift 2 ;;
    --max) max=$2; shift 2 ;;
    -*) echo "wait-agents.sh: unknown option $1" >&2; exit 2 ;;
    *) agents+=("$1"); shift ;;
  esac
done
if [ -z "$status_dir" ]; then
  echo "usage: wait-agents.sh --status-dir DIR [--label TEXT] [--max SECONDS] <agent>..." >&2
  exit 2
fi
mkdir -p "$status_dir"

now_ns() { # nanoseconds, for Herdr's metadata ordering (date has no %N on macOS)
  local ns
  ns=$(date +%s%N)
  case $ns in *N) echo "$(date +%s)000000000" ;; *) echo "$ns" ;; esac
}

# Label the caller's pane. The label expires by itself if this script is killed.
if [ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_PANE_ID:-}" ]; then
  self=$HERDR_PANE_ID
  self_agent=$(herdr agent get "$self" 2>/dev/null | jq -r '.result.agent.agent // empty')
  label_args=(--source herdr-orchestrator --agent "${self_agent:-claude}")
  herdr pane report-metadata "$self" "${label_args[@]}" --state-label working="$label" \
    --ttl-ms $(((max + 30) * 1000)) --seq "$(now_ns)" >/dev/null 2>&1
  trap 'herdr pane report-metadata "$self" "${label_args[@]}" --clear-state-labels \
    --seq "$(($(now_ns) + 1))" >/dev/null 2>&1' EXIT
fi

status_of() { # status_of <agent-list-json> <agent>; empty when gone
  [ -n "$1" ] || { echo unknown; return; }
  jq -r --arg a "$2" \
    '.result.agents[] | select(.name == $a or .pane_id == $a) | .agent_status' <<<"$1" | head -1
}

start=$SECONDS
list=
while :; do
  events=()
  for f in "$status_dir"/*.done "$status_dir"/*.question "$status_dir"/*.failed "$status_dir"/*.message; do
    [ -e "$f" ] && events+=("marker $f")
  done
  if [ ${#agents[@]} -gt 0 ]; then
    list=$(herdr agent list 2>/dev/null) || list=
    for a in "${agents[@]}"; do
      s=$(status_of "$list" "$a")
      case $s in
        "") events+=("gone $a") ;;
        blocked) events+=("blocked $a") ;;
      esac
    done
  fi
  if [ ${#events[@]} -gt 0 ]; then
    printf '%s\n' "${events[@]}"
    exit 0
  fi
  if [ $((SECONDS - start)) -ge "$max" ]; then
    echo timeout
    for a in ${agents[@]+"${agents[@]}"}; do
      echo "state $a $(status_of "$list" "$a")"
    done
    exit 0
  fi
  sleep "$poll"
done
