#!/usr/bin/env bash
# Answer a dialog in an orchestrator's pane with the option the user chose.
#
# Usage: answer-dialog.sh <pane> <screen-text> <option> [text-file]
#
# <screen-text> is text from the dialog the user answered, such as its question
# or the command it asks to approve; keep it short, since long lines wrap. It must
# be in the open dialog, not only in the transcript above it, so a dialog that
# replaced it is never answered by mistake. <option> is the option's exact label.
# [text-file] holds free text to type, for an option such as "Type something.".
#
# Moves the cursor with arrow keys and checks it before pressing Enter, since a
# digit commits at once, and a successful send-keys proves nothing. Then waits for
# the dialog to close. Prints one line and exits 0:
#   answered      the dialog closed
#   next-dialog   the pane is blocked on another dialog; read it and ask the user
# Exits 1 if Herdr fails or the pane is not blocked, 3 if the dialog does not match
# (it has changed, or the option is missing or ambiguous; nothing was pressed), and
# 4 if the dialog is still open after the keys. Tell the user to answer in the tab.
set -u

[ $# -ge 3 ] && [ $# -le 4 ] || {
  echo "usage: answer-dialog.sh <pane> <screen-text> <option> [text-file]" >&2
  exit 2
}
pane=$1 screen_text=$2 option=$3 text_file=${4:-}
settle=${ANSWER_DIALOG_SETTLE:-0.4}
close_wait=${ANSWER_DIALOG_WAIT:-15}

state() { herdr agent get "$pane" 2>/dev/null | jq -r '.result.agent.agent_status // empty'; }
dialog() { # the open dialog: from the last rule above the cursor to the end; else nothing
  herdr agent read "$pane" --source visible --lines 80 2>/dev/null | awk '
    { line[NR] = $0 }
    /^ *────/ { rule = NR }
    /^ *❯ *[0-9]+\. / { cursor = NR; start = rule }
    END { if (cursor) for (i = start + 0; i <= NR; i++) if (i) print line[i] }'
}
cursor() { # the number of the option under the cursor
  sed -n 's/^ *❯ *\([0-9][0-9]*\)\. .*/\1/p' | head -1
}
options_for() { # the numbers of the options labelled exactly $1
  awk -v want="$1" '{
    line = $0
    sub(/^ *(❯ *)?/, "", line)
    if (match(line, /^[0-9]+\. /)) {
      n = substr(line, 1, RLENGTH - 2)
      label = substr(line, RLENGTH + 1)
      sub(/ +$/, "", label)
      if (label == want) print n
    }
  }'
}
press() { herdr agent send-keys "$pane" "$1" >/dev/null || exit 1; sleep "$settle"; }

[ "$(state)" = blocked ] || { echo "$pane is not blocked" >&2; exit 1; }
shown=$(dialog)
grep -qF -- "$screen_text" <<<"$shown" || { echo "dialog changed: screen text not found" >&2; exit 3; }
target=$(options_for "$option" <<<"$shown")
[ "$(wc -w <<<"$target")" -eq 1 ] || { echo "option not found once: $option" >&2; exit 3; }
at=$(cursor <<<"$shown")
[ -n "$at" ] || { echo "no cursor on screen" >&2; exit 3; }

while [ "$at" -lt "$target" ]; do press down; at=$((at + 1)); done
while [ "$at" -gt "$target" ]; do press up; at=$((at - 1)); done
if [ "$(cursor <<<"$(dialog)")" != "$target" ]; then
  echo "cursor is not on $option; nothing was selected" >&2
  exit 4
fi

if [ -n "$text_file" ]; then
  pane_id=$(herdr agent get "$pane" | jq -r .result.agent.pane_id) || exit 1
  herdr pane send-text "$pane_id" "$(cat "$text_file")" >/dev/null || exit 1
  sleep "$settle"
fi
press enter

deadline=$((SECONDS + close_wait))
while [ "$SECONDS" -lt "$deadline" ]; do
  [ "$(state)" = blocked ] || { echo answered; exit 0; }
  shown=$(dialog)
  [ -z "$shown" ] || grep -qF -- "$screen_text" <<<"$shown" || { echo next-dialog; exit 0; }
  sleep 1
done
echo "dialog still open after the keys" >&2
exit 4
