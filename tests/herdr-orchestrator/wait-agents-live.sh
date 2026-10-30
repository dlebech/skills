#!/usr/bin/env bash
# Live check of skills/herdr-orchestrator/scripts/wait-agents.sh in a real Herdr pane.
#
# Starts a throwaway Claude Code sub-agent (Haiku by default) in a new pane below
# this one and plays the orchestrator from this pane:
#   1. the sub-agent starts a background job that writes its .done marker when it
#      ends; Herdr shows the sub-agent idle meanwhile, but the wait must not return
#      until the marker appears, and this pane carries the progress label;
#   2. the sub-agent hits a permission prompt; the wait must return "blocked";
#   3. herdr-captain relays a message; the wait must return on its marker.
# Closes the pane afterwards. Costs a few cheap agent turns.
#
# Usage: tests/herdr-orchestrator/wait-agents-live.sh [model]
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
wait_agents=$repo/skills/herdr-orchestrator/scripts/wait-agents.sh
model=${1:-haiku}
job_s=30

[ "${HERDR_ENV:-}" = 1 ] || { echo "Run this inside a Herdr pane." >&2; exit 1; }

status_dir=$(mktemp -d)
pane=$(herdr pane split --current --direction down --cwd "$repo" --no-focus | jq -r .result.pane.pane_id)
trap 'herdr pane close "$pane" >/dev/null 2>&1 || true; rm -rf "$status_dir"' EXIT
name=waittest$$

herdr agent start "$name" --kind claude --pane "$pane" -- \
  --model "$model" --permission-mode default --add-dir "$status_dir" \
  --allowedTools "Bash(sleep *)" "Bash(touch $status_dir/*)" >/dev/null

failed=0
check() { # check <description> <got> <want>
  if [ "$2" = "$3" ]; then echo "ok   $1: $2"; else echo "FAIL $1: got '$2', want '$3'"; failed=1; fi
}
state() { herdr agent get "$name" | jq -r .result.agent.agent_status; }

echo "== background job with a completion marker"
herdr agent prompt "$name" "Start this exact shell command as a background task (run_in_background), then end your turn at once with a one-word reply. Do not wait for it or check on it: sleep $job_s; touch $status_dir/$name.done" \
  --wait --timeout 90000 >/dev/null
start=$SECONDS
WAIT_AGENTS_POLL=2 "$wait_agents" --status-dir "$status_dir" --label "waiting: live test" \
  --max $((job_s * 3)) "$name" >"$status_dir/out" &
waiter=$!
sleep 8
s=$(state)
case $s in
  idle | done) echo "ok   sub-agent looks finished to Herdr while its job runs: $s" ;;
  *) echo "note sub-agent state while its job runs: $s" ;;
esac
check "wait still running despite that" "$(kill -0 $waiter 2>/dev/null && echo running)" running
check "progress label on this pane" \
  "$(herdr pane get "$HERDR_PANE_ID" | jq -r '.result.pane.state_labels.working // empty')" "waiting: live test"
wait $waiter
check "wait returned on the marker" "$(cat "$status_dir/out")" "marker $status_dir/$name.done"
elapsed=$((SECONDS - start))
check "and not before the job ended" "$([ $elapsed -ge $((job_s - 10)) ] && echo yes)" yes
check "label cleared afterwards" \
  "$(herdr pane get "$HERDR_PANE_ID" | jq -r '.result.pane.state_labels.working // empty')" ""
mv "$status_dir/$name.done" "$status_dir/$name.done.handled"

echo "== permission prompt"
herdr agent wait "$name" --timeout 90000 >/dev/null || true
herdr agent prompt "$name" "Run this exact shell command now, in the foreground: touch /tmp/wait-agents-live-$$" >/dev/null
check "wait returned blocked" \
  "$(WAIT_AGENTS_POLL=2 "$wait_agents" --status-dir "$status_dir" --max 90 "$name")" "blocked $name"
herdr agent send-keys "$name" esc >/dev/null 2>&1 || true

echo "== relayed message"
inbox=$status_dir/inbox
mkdir "$inbox"
echo "use pnpm" >"$inbox/.captain-1.tmp"
mv "$inbox/.captain-1.tmp" "$inbox/captain-1.message"
check "wait returned on the message" \
  "$(WAIT_AGENTS_POLL=2 "$wait_agents" --status-dir "$status_dir" --inbox "$inbox" --max 30)" "marker $inbox/captain-1.message"

exit "$failed"
