#!/usr/bin/env bash
# Live check of herdr-app-orchestrator's agent flow, for each agent kind.
#
# Plays the orchestrator from this terminal. For each kind, in a throwaway git repo:
#   1. start-agent.sh starts a hidden child and delivers a task from a file;
#   2. the agent reports with hc send, which ends hc wait with reason "message";
#   3. the agent is removed.
# A report arrives as input to this terminal. For a plain shell that input is a
# stray command, so run this from an agent, or ignore what lands at the prompt.
# Claude also proves the --settings path: a file in --shared and hc send, in
# default permission mode, with no prompt, and that a long slash command as its
# task runs as a command. Also checks that trust stops the start
# and that --accept-trust resumes it.
#
# Usage: tests/herdr-app-orchestrator/agent-kinds-live.sh [kinds...]
#   Default kinds: claude pi opencode. Models: CLAUDE_MODEL (haiku),
#   LOCAL_MODEL (ollama/ornith-1.5:9b) for pi and opencode.
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
start=$repo/skills/herdr-app-orchestrator/scripts/start-agent.sh
claude_model=${CLAUDE_MODEL:-haiku}
local_model=${LOCAL_MODEL:-ollama/ornith-1.5:9b}
[ -n "${HC_TERMINAL_ID:-}" ] || { echo "Run this inside an hc terminal." >&2; exit 1; }
[ $# -gt 0 ] || set -- claude pi opencode

work=$(mktemp -d)
names=()
cleanup() {
  for n in ${names[@]+"${names[@]}"}; do hc kill "$n" >/dev/null 2>&1; hc rm "$n" >/dev/null 2>&1; done
  rm -rf "$work"
}
trap cleanup EXIT
failed=0
check() { # check <description> <got> <want>
  if [ "$2" = "$3" ]; then echo "ok   $1: $2"; else echo "FAIL $1: got '$2', want '$3'"; failed=1; fi
}

for kind in "$@"; do
  echo "== $kind"
  name=kindtest-$kind-$$
  names+=("$name")
  dir=$work/$kind
  mkdir -p "$dir/repo" "$dir/shared"
  git -C "$dir/repo" init -q
  task=$dir/shared/task.md
  steps="Do exactly these two steps, in order, then stop:
1. With your file-writing tool, create $dir/shared/result.txt containing only the word ok.
2. With your shell tool, run: hc send $HC_TERMINAL_ID \"done: $name: ok\""
  if [ "$kind" = claude ]; then
    # A long slash command, as the captain sends /herdr-app-orchestrator: pasted, it
    # would arrive as <pasted_content> text instead of running the skill.
    mkdir -p "$dir/repo/.claude/skills/kindtest-run"
    printf -- '---\nname: kindtest-run\ndescription: kinds test\ndisable-model-invocation: true\n---\n%s\n\nIgnore the arguments: $ARGUMENTS\n' \
      "$steps" >"$dir/repo/.claude/skills/kindtest-run/SKILL.md"
    { printf '/kindtest-run'; for i in $(seq 150); do printf ' padding%d' "$i"; done; } >"$task"
  else
    printf '%s\n' "$steps" >"$task"
  fi
  args=(--name "$name" --cwd "$dir/repo" --kind "$kind" --task-file "$task")
  case $kind in
    claude) args+=(--model "$claude_model" --shared "$dir/shared" --arg --permission-mode --arg default) ;;
    *) args+=(--model "$local_model") ;;
  esac

  out=$("$start" "${args[@]}")
  code=$?
  if [ "$kind" = claude ]; then
    check "trust stops the start" "${out%% *}" trust
    check "trust exit code" "$code" 4
    out=$("$start" "${args[@]}" --accept-trust)
    code=$?
  fi
  check "started" "${out%% *}" started
  check "start exit code" "$code" 0

  reason=
  for _ in 1 2 3 4 5 6 7 8; do
    reason=$(hc wait --children any --timeout 30 --json | jq -r .reason)
    [ "$reason" != message ] || break
    [ ! -e "$dir/shared/result.txt" ] || [ "$(hc get "$name" --json | jq -r .status.state)" = working ] || break
  done
  check "report ended the wait" "$reason" message
  if [ "$kind" = opencode ]; then
    hc read "$name" --lines 0 | grep -qF "${local_model##*/}"
    check "chose the model" "$?" 0
  fi
  check "file in shared written" "$(cat "$dir/shared/result.txt" 2>/dev/null)" ok
  if [ "$kind" = claude ]; then
    sessions=~/.claude/projects/$(printf %s "$dir/repo" | sed 's/[^A-Za-z0-9]/-/g')
    grep -qs 'command-name>/kindtest-run' "$sessions"/*.jsonl
    check "long slash command ran as a command" "$?" 0
  fi
  check "agent is a hidden child" \
    "$(hc get "$name" --json | jq -r '[.parent, (.labels["herdr.tab"] // "none")] | join(" ")')" "$HC_TERMINAL_ID none"
done

exit "$failed"
