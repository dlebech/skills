#!/usr/bin/env bash
# Start an interactive agent in a hidden hc terminal and give it its first task.
#
# Usage: start-agent.sh --name NAME --cwd DIR --kind KIND --task-file FILE
#          [--model MODEL] [--shared DIR] [--arg ARG]... [--label K=V]...
#          [--no-parent] [--accept-trust]
#
# Claude Code gets its task on the command line, as its initial prompt: hc send
# pastes, and Claude Code wraps a long paste in <pasted_content>, so a task such as
# `/herdr-app-orchestrator ...` would arrive as text instead of running the skill.
# The prompt also waits behind the folder trust prompt. Every other kind launches
# with no task, and once it reports a status, gets it sent: kinds differ in how they
# take a first task (opencode's --prompt only fills its input box, pi sits idle
# while a local model loads). The task is a file, because it can hold the user's or
# a run's text, and a shell argument could run part of it; it goes to the agent as
# one argv entry, never through a shell.
#
#   --kind     claude, pi or opencode (tested), codex (untested), or any program
#   --model    claude: sonnet; pi: provider/id; opencode: provider/id
#   --shared   claude only: allow reading and writing this absolute directory
#              without a permission prompt. Claude is also allowed `hc send`, so
#              it can report; other kinds have no such restriction
#   --arg      one extra argument for the agent, repeatable, e.g. --arg --auto
#   --no-parent        an independent agent, not this terminal's child (a run's
#              orchestrator, which must outlive the captain that started it)
#   --accept-trust     answer Claude Code's folder trust prompt with "Yes". Pass it
#              only for a folder the user said to trust. Also resumes a start
#              that stopped at the prompt, under the same name
#
# Claude Code's trust prompt reports no status, and hc send is not refused there:
# its Enter would pick the default, "No, exit". So this never sends until the
# agent has reported.
#
# Prints one line:
#   started <address>      it took the task (exit 0)
#   unconfirmed <address>  sent, but it did not start; hc read it, do not resend (exit 6)
#   trust <address>        stopped at the trust prompt, still open (exit 4)
#   blocked <address>      another dialog is open; hc read it (exit 5)
#   exited <address>       the agent exited during startup; hc read it (exit 7)
#   timeout <address>      it never reported a status; hc read it (exit 8)
# Exits 1 if hc fails, 2 on bad usage.
set -uo pipefail

name= cwd= kind= task_file= model= shared= accept_trust= prompt_arg= ready_wait=${START_AGENT_WAIT:-120}
extra=() labels=() parent=()
while [ $# -gt 0 ]; do
  case $1 in
    --name) name=$2; shift 2 ;;
    --cwd) cwd=$2; shift 2 ;;
    --kind) kind=$2; shift 2 ;;
    --task-file) task_file=$2; shift 2 ;;
    --model) model=$2; shift 2 ;;
    --shared) shared=$2; shift 2 ;;
    --arg) extra+=("$2"); shift 2 ;;
    --label) labels+=(--label "$2"); shift 2 ;;
    --no-parent) parent=(--no-parent); shift ;;
    --accept-trust) accept_trust=1; shift ;;
    *) echo "start-agent.sh: unknown option $1" >&2; exit 2 ;;
  esac
done
if [ -z "$name" ] || [ -z "$cwd" ] || [ -z "$kind" ] || [ -z "$task_file" ]; then
  echo "usage: start-agent.sh --name NAME --cwd DIR --kind KIND --task-file FILE [options]" >&2
  exit 2
fi
[ -r "$task_file" ] || { echo "cannot read $task_file" >&2; exit 2; }
task=$(cat "$task_file")

case $kind in
  claude)
    argv=(claude ${model:+--model "$model"})
    # In --settings, since --add-dir and --allowedTools take every argument after them.
    # additionalDirectories only brings a folder into reach; writing still prompts.
    settings=$(jq -cn --arg dir "$shared" '{permissions: (if $dir == "" then {allow: ["Bash(hc send:*)"]}
      else {additionalDirectories: [$dir],
        allow: ["Bash(hc send:*)", "Read(/\($dir)/**)", "Edit(/\($dir)/**)", "Write(/\($dir)/**)"]} end)}')
    argv+=(--settings "$settings")
    prompt_arg=1 ;;
  pi) argv=(pi ${model:+--model "$model"}) ;;
  opencode)
    argv=(opencode)
    # Its full-screen interface has no --model flag, and `opencode mini`, which
    # has, reports no status. Config from the environment needs a private server,
    # since the background service ignores it, and hc run does not pass on the
    # caller's environment, so the variable goes in the command.
    [ -z "$model" ] ||
      argv=(env "OPENCODE_CONFIG_CONTENT=$(jq -cn --arg m "$model" '{model: $m}')" opencode --standalone) ;;
  codex) argv=(codex --no-daemon ${model:+--model "$model"}) ;; # hc --skill requires --no-daemon
  *) argv=("$kind" ${model:+--model "$model"}) ;;
esac
argv+=(${extra[@]+"${extra[@]}"})
[ -z "$prompt_arg" ] || argv+=(-- "$task")

status() { hc get "$name" --json 2>/dev/null | jq -r '.status.state // empty'; }
state() { hc get "$name" --json 2>/dev/null | jq -r '.state // "gone"'; }
trust_prompt() { hc read "$name" --lines 0 2>/dev/null | grep -qE 'trust this folder|Do you trust'; }

if [ "$(state)" != live ]; then
  hc run --bg --name "$name" --cwd "$cwd" --json \
    ${parent[@]+"${parent[@]}"} ${labels[@]+"${labels[@]}"} -- "${argv[@]}" >/dev/null || exit 1
fi
address=$(hc get "$name" --json | jq -r .address) || exit 1

deadline=$((SECONDS + ready_wait))
while :; do
  [ "$(state)" = live ] || { echo "exited $address"; exit 7; }
  current=$(status)
  case $current in
    blocked) echo "blocked $address"; exit 5 ;;
    "") ;;
    *) break ;;
  esac
  if trust_prompt; then
    [ -n "$accept_trust" ] || { echo "trust $address"; exit 4; }
    hc keys "$name" down enter >/dev/null || exit 1
  fi
  [ "$SECONDS" -lt "$deadline" ] || { echo "timeout $address"; exit 8; }
  hc wait "$name" --timeout 3 >/dev/null 2>&1
done

# Claude Code took the task at launch, also when this resumes a start that stopped
# at the trust prompt; sending it again would run it twice.
[ -z "$prompt_arg" ] || { echo "started $address"; exit 0; }

# Without HC_TERMINAL_ID it arrives as a plain prompt, not in an <hc from="..."> tag,
# which would stop a task such as /skill:herdr-app-orchestrator from running as a command.
result=$(env -u HC_TERMINAL_ID hc send "$name" "$task" --json) || exit 1
if [ "$(jq -r '.started // false' <<<"$result")" = true ]; then
  echo "started $address"
else
  echo "unconfirmed $address"
  exit 6
fi
