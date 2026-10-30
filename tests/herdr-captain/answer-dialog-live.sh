#!/usr/bin/env bash
# Live check of skills/herdr-captain/scripts/answer-dialog.sh in real Herdr panes.
#
# Starts two throwaway Claude Code agents (Haiku by default) in new panes below this
# one, standing in for two orchestrators with open questions, and plays the captain:
#   1. both ask a question at once; each gets its own answer, and a prompt is refused;
#   2. a stale answer, or one naming no such option, presses nothing;
#   3. a free-text answer arrives, and text for an option that takes none is refused;
#   4. a dialog with two questions is answered and submitted;
#   5. a permission prompt is approved.
# Closes the panes afterwards. Costs a few cheap agent turns.
#
# Usage: tests/herdr-captain/answer-dialog-live.sh [model]
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
model=${1:-haiku}

[ "${HERDR_ENV:-}" = 1 ] || { echo "Run this inside a Herdr pane." >&2; exit 1; }

dir=$(mktemp -d)
a=dialoga$$
b=dialogb$$
pane_a=$(herdr pane split --current --direction down --cwd "$repo" --no-focus | jq -r .result.pane.pane_id)
pane_b=$(herdr pane split --current --direction down --cwd "$repo" --no-focus | jq -r .result.pane.pane_id)
trap 'herdr pane close "$pane_a" >/dev/null 2>&1; herdr pane close "$pane_b" >/dev/null 2>&1; rm -rf "$dir"' EXIT

for pair in "$a $pane_a" "$b $pane_b"; do
  set -- $pair
  herdr agent start "$1" --kind claude --pane "$2" -- \
    --model "$model" --permission-mode default --add-dir "$dir" \
    --allowedTools "Bash(touch $dir/q-*)" >/dev/null
done

failed=0
check() { # check <description> <got> <want>
  if [ "$2" = "$3" ]; then echo "ok   $1: $2"; else echo "FAIL $1: got '$2', want '$3'"; failed=1; fi
}
state() { herdr agent get "$1" | jq -r .result.agent.agent_status; }
ask() { # ask <agent> <question> <file-prefix>
  herdr agent prompt "$1" "Call the AskUserQuestion tool with one question, exactly: '$2'. Header 'Q'. Options, exactly: 'alpha', 'beta', 'gamma'. After it is answered, run this and nothing else: touch $dir/q-$3-<answer as one lowercase word>" >/dev/null
}
answer() { # answer <agent> <screen-text> <option> [text]
  printf '%s\n' "${@:2}" >"$dir/answer"
  "$repo/skills/herdr-captain/scripts/answer-dialog.sh" "$1" "$dir/answer"
}
blocked() { herdr agent wait "$1" --until blocked --timeout 90000 >/dev/null; sleep 2; }
settled() { herdr agent wait "$1" --timeout 90000 >/dev/null; sleep 1; }
exists() { # exists <file>; waits for an agent's last step
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do [ -e "$1" ] && { echo yes; return; }; sleep 2; done
  echo no
}

echo "== two questions at once"
ask "$a" "Which database for run A?" a
ask "$b" "Which queue for run B?" b
blocked "$a"
blocked "$b"
check "A is blocked" "$(state "$a")" blocked
check "B is blocked" "$(state "$b")" blocked
check "a prompt is refused" \
  "$(herdr agent prompt "$a" beta 2>&1 | jq -r .error.code)" agent_blocked
check "answer A" "$(answer "$a" "Which database for run A?" beta)" answered
check "A got its answer" "$(exists "$dir/q-a-beta")" yes
check "B is still waiting" "$(state "$b")" blocked
check "answer B" "$(answer "$b" "Which queue for run B?" gamma)" answered
check "B got its answer" "$(exists "$dir/q-b-gamma")" yes
settled "$a"
settled "$b"

echo "== a mismatched answer presses nothing"
ask "$a" "Which cache for run A?" stale
blocked "$a"
answer "$a" "Which database for run A?" beta >/dev/null 2>&1
check "stale question exits 3" "$?" 3
answer "$a" "Which cache for run A?" delta >/dev/null 2>&1
check "unknown option exits 3" "$?" 3
check "dialog stays open" "$(state "$a")" blocked
check "and answering it still works" "$(answer "$a" "Which cache for run A?" alpha)" answered
check "with the right answer" "$(exists "$dir/q-stale-alpha")" yes
settled "$a"

echo "== free text"
ask "$a" "Which colour for run A?" text
blocked "$a"
answer "$a" "Which colour for run A?" beta "not an option" >/dev/null 2>&1
check "text for a plain option exits 3" "$?" 3
check "answer with text" "$(answer "$a" "Which colour for run A?" "Type something." teal)" answered
check "the text arrived" "$(exists "$dir/q-text-teal")" yes
settled "$a"

echo "== two questions in one dialog"
herdr agent prompt "$a" "Call AskUserQuestion once with two questions in the same call: 'Which shape?' header 'Shape' with options 'circle' and 'square', and 'Which size?' header 'Size' with options 'small' and 'large'. After it is answered, run this and nothing else: touch $dir/q-multi-<shape>-<size>" >/dev/null
blocked "$a"
check "first question" "$(answer "$a" "Which shape?" square)" next-dialog
check "second question" "$(answer "$a" "Which size?" large)" next-dialog
check "submit" "$(answer "$a" "Ready to submit" "Submit answers")" answered
check "both answers arrived" "$(exists "$dir/q-multi-square-large")" yes
settled "$a"

echo "== permission prompt"
outside=/tmp/answer-dialog-live-$$
herdr agent prompt "$a" "Run this exact shell command now, in the foreground: touch $outside" >/dev/null
blocked "$a"
check "approve" "$(answer "$a" "touch $outside" Yes)" answered
check "the command ran" "$(exists "$outside")" yes
rm -f "$outside"

exit "$failed"
