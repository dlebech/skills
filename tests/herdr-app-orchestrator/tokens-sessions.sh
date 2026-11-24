#!/usr/bin/env bash
# Checks that tokens.sh records the orchestrator's session from its command line for a kind
# without a session map of its own (copilot, as start-agent.sh starts it), so Harbormaster can
# resume it after a restart, and records it once. A fake hc, nothing written outside a
# temporary folder.
#
# Usage: tests/herdr-app-orchestrator/tokens-sessions.sh
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
tokens=$repo/skills/herdr-app-orchestrator/scripts/tokens.sh
command -v jq >/dev/null || { echo "needs jq" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export OPENCODE_DATA_DIR=$tmp/opencode CLAUDE_CONFIG_DIR=$tmp/claude PI_CODING_AGENT_DIR=$tmp/pi HERDR_WORKTREES_ROOT=$tmp/wt
mkdir -p "$tmp/bin" "$tmp/run" "$tmp/repo"
run=$tmp/run
cat >"$tmp/bin/hc" <<'HC'
#!/bin/sh
[ "$1" = get ] && printf '%s' "$HC_GET"
HC
chmod +x "$tmp/bin/hc"
export PATH=$tmp/bin:$PATH
jq -n --arg f "$tmp/repo" '{terminal: "t7", kind: "copilot", branch: "feat-x", folder: $f, started: "2026-01-01T00:00:00Z"}' >"$run/orchestrator.json"
echo '{}' >"$run/status.json"

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fail=1; fi; }

export HC_GET='{"state":"live","argv":["copilot","--session-id=0cb9-26aa"],"foreground":{"pid":1,"argv":["copilot","--session-id=0cb9-26aa"]},"status":{"app":"copilot"}}'
"$tokens" --print "$run" >/dev/null 2>&1
check "copilot's --session-id= is recorded under the run's kind" "$(cat "$run/sessions")" "copilot 0cb9-26aa"
"$tokens" --print "$run" >/dev/null 2>&1
check "and only once" "$(wc -l <"$run/sessions" | tr -d ' ')" "1"

export HC_GET='{"state":"live","foreground":{"pid":1,"argv":["copilot","--resume","f00d"]},"status":{"app":"copilot"}}'
"$tokens" --print "$run" >/dev/null 2>&1
check "a resumed one's --resume <id> is added after it" "$(tail -n 1 "$run/sessions")" "copilot f00d"

export HC_GET='{"state":"live","foreground":{"pid":1,"argv":["/bin/bash"]}}'
"$tokens" --print "$run" >/dev/null 2>&1
check "a shell adds nothing" "$(wc -l <"$run/sessions" | tr -d ' ')" "2"
export HC_GET='{"state":"live","foreground":{"pid":999999,"argv":["claude","--resume","old-id"]},"status":{"app":"claude-code"}}'
jq '.kind = "claude"' "$run/orchestrator.json" >"$run/o.tmp" && mv "$run/o.tmp" "$run/orchestrator.json"
"$tokens" --print "$run" >/dev/null 2>&1
check "a claude without its pid file adds no --resume id from its command line" "$(wc -l <"$run/sessions" | tr -d ' ')" "2"
exit $fail
