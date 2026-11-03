#!/usr/bin/env bash
# Answer a dialog in an orchestrator's terminal with the option the user chose.
#
# Usage: answer-dialog.sh <terminal> <answer-file>
#
# <answer-file> holds, one per line, text from the dialog the user answered (its
# question, or the command it asks to approve; keep it short, since long lines
# wrap), then the option's exact label. Any further lines are free text to type,
# which needs the option "Type something.". It is a file because all of it comes
# from the dialog or the user, and a shell argument could run part of it.
#
# The text must be in the open dialog, not only in the transcript above it, so a
# dialog that replaced it is never answered by mistake. Moves the cursor with arrow
# keys, since a digit commits at once, and checks the dialog again before pressing
# Enter, since a successful hc keys proves nothing. Prints one line and exits 0:
#   answered      the dialog closed
#   next-dialog   the dialog changed or another followed; read it and ask the user
# Exits 1 if hc fails or the terminal is not blocked, 3 if the dialog does not match
# (it changed, or the option is missing, ambiguous, or takes no text), and 4 if
# nothing changed after the keys, as with a multi-select or a second identical
# prompt. On 3 no answer was given. On 1 or 4, tell the user to answer in the tab.
set -uo pipefail

[ $# -eq 2 ] || { echo "usage: answer-dialog.sh <terminal> <answer-file>" >&2; exit 2; }
terminal=$1
{ IFS= read -r screen_text && IFS= read -r option; } <"$2" || {
  echo "answer file needs the dialog text and the option" >&2
  exit 2
}
text=$(tail -n +3 "$2") || exit 2
[ -z "$text" ] || [ "$option" = "Type something." ] || {
  echo "option takes no text: $option" >&2
  exit 3
}
settle=0.4
close_wait=15

state() { hc get "$terminal" --json 2>/dev/null | jq -er '.status.state'; }
dialog() { # the open dialog: from the last rule above the cursor to the end; else nothing
  hc read "$terminal" --lines 0 2>/dev/null | awk '
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
press() { hc keys "$terminal" "$1" >/dev/null || exit 1; sleep "$settle"; }
matches() { # matches <dialog>: is it the user's dialog, with the option once?
  grep -qF -- "$screen_text" <<<"$1" && [ "$(options_for "$option" <<<"$1" | wc -l)" -eq 1 ]
}

current=$(state) || { echo "cannot read $terminal from hc" >&2; exit 1; }
[ "$current" = blocked ] || { echo "$terminal is not blocked" >&2; exit 1; }
shown=$(dialog) || exit 1
matches "$shown" || { echo "dialog does not match" >&2; exit 3; }
target=$(options_for "$option" <<<"$shown")
position=$(cursor <<<"$shown")
[ -n "$position" ] || { echo "no cursor on screen" >&2; exit 3; }

while [ "$position" -lt "$target" ]; do press down; position=$((position + 1)); done
while [ "$position" -gt "$target" ]; do press up; position=$((position - 1)); done
before=$(dialog) || exit 1
matches "$before" || { echo "dialog does not match" >&2; exit 3; }
if [ "$(cursor <<<"$before")" != "$target" ]; then
  echo "cursor is not on $option; nothing was selected" >&2
  exit 4
fi

if [ -n "$text" ]; then
  # --force, since a blocked terminal refuses text; this is the user's own answer.
  # hc send presses Enter itself. Without HC_TERMINAL_ID it goes in as the user's
  # plain words, not wrapped in an <hc from="..."> tag.
  env -u HC_TERMINAL_ID hc send --force "$terminal" "$text" >/dev/null || exit 1
  sleep "$settle"
else
  press enter
fi

deadline=$((SECONDS + close_wait))
while [ "$SECONDS" -lt "$deadline" ]; do
  current=$(state) || { echo "cannot read $terminal from hc" >&2; exit 1; }
  [ "$current" = blocked ] || { echo answered; exit 0; }
  shown=$(dialog) || exit 1
  [ -z "$shown" ] || [ "$shown" = "$before" ] || { echo next-dialog; exit 0; }
  sleep 1
done
echo "nothing changed after the keys" >&2
exit 4
