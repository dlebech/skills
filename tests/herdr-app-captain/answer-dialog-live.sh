#!/usr/bin/env bash
# Live check of skills/herdr-app-captain/scripts/answer-dialog.sh against a real
# Claude Code agent (Haiku by default) in a hidden hc terminal:
#   1. a permission prompt: a wrong dialog text gives exit 3 and leaves it open;
#      the right one, with "Yes", gives "answered" and the command runs;
#   2. a question dialog answered with an option;
#   3. a question dialog answered with free text, which must reach the agent as
#      plain words, not in an <hc from="..."> tag;
#   4. a terminal that is not blocked gives exit 1.
# Removes the agent afterwards. Costs a few cheap agent turns.
#
# Usage: tests/herdr-app-captain/answer-dialog-live.sh [model]
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
answer=$repo/skills/herdr-app-captain/scripts/answer-dialog.sh
start=$repo/skills/herdr-app-orchestrator/scripts/start-agent.sh
model=${1:-haiku}
[ -n "${HC_TERMINAL_ID:-}" ] || { echo "Run this inside an hc terminal." >&2; exit 1; }

work=$(mktemp -d)
name=dialogtest-$$
trap 'hc kill "$name" >/dev/null 2>&1; hc rm "$name" >/dev/null 2>&1; rm -rf "$work"' EXIT
git -C "$work" init -q
failed=0
check() { # check <description> <got> <want>
  if [ "$2" = "$3" ]; then echo "ok   $1: $2"; else echo "FAIL $1: got '$2', want '$3'"; failed=1; fi
}
state() { hc get "$name" --json | jq -r .status.state; }
wait_for() { # wait_for <status>: until it reports that status, or 90 seconds
  local i
  for i in $(seq 18); do
    [ "$(state)" = "$1" ] && return 0
    hc wait "$name" --timeout 5 >/dev/null 2>&1
  done
  return 1
}
answer_file() { printf '%s\n' "$@" >"$work/answer"; }

echo "== permission prompt"
echo "Run this exact command with your shell tool: touch $work/touched. Then stop." >"$work/task"
"$start" --name "$name" --cwd "$work" --kind claude --model "$model" --task-file "$work/task" \
  --arg --permission-mode --arg default --accept-trust >/dev/null
wait_for blocked || echo "FAIL never blocked"
check "kind" "$(hc get "$name" --json | jq -r .status.kind)" permission
answer_file "text that is not there" Yes
"$answer" "$name" "$work/answer" >/dev/null 2>&1
check "wrong text is refused" "$?" 3
check "and stays open" "$(state)" blocked
answer_file "Do you want to proceed?" Yes
check "answer" "$("$answer" "$name" "$work/answer" 2>&1)" answered
hc wait "$name" --timeout 30 >/dev/null
[ -e "$work/touched" ]
check "command ran" "$?" 0

echo "== question dialog, option"
hc send "$name" "Use your AskUserQuestion tool to ask whether I prefer red or blue, with exactly those two options. Nothing else." >/dev/null
wait_for blocked || echo "FAIL never blocked"
check "kind" "$(hc get "$name" --json | jq -r .status.kind)" question
answer_file "prefer red or blue" Blue
check "answer" "$("$answer" "$name" "$work/answer" 2>&1)" answered
hc wait "$name" --timeout 30 >/dev/null
hc read "$name" --lines 30 | grep -q '→ Blue'
check "agent got the option" "$?" 0

echo "== question dialog, free text"
hc send "$name" "Use your AskUserQuestion tool to ask whether I prefer cats or dogs, with exactly those two options. Nothing else." >/dev/null
wait_for blocked || echo "FAIL never blocked"
answer_file "prefer cats or dogs" "Type something." "Neither, thanks."
check "answer" "$("$answer" "$name" "$work/answer" 2>&1)" answered
hc wait "$name" --timeout 30 >/dev/null
hc read "$name" --lines 30 | grep -q '→ Neither, thanks\.'
check "agent got the plain words" "$?" 0

echo "== not blocked"
"$answer" "$name" "$work/answer" >/dev/null 2>&1
check "exit code" "$?" 1

exit "$failed"
