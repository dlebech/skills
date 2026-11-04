#!/usr/bin/env bash
# Wait until the captain's watcher exits, for a captain that started it with --no-notify.
#
# Usage: wait-watch.sh [watcher-name]    (default captain-watch)
#
# Run it as a background job of your own harness that wakes you when it ends, such
# as a Claude Code background Bash command. hc's exit note would do the same, but hc
# types notes into the captain's input and presses Enter, and in the captain that is
# the box the user writes in: a note arriving mid-sentence sends their half-written
# message with the note appended. A background job wakes the agent without typing.
#
# hc wait checks in every --timeout seconds without the watcher ending; this waits
# again until it has. Prints hc wait's last JSON ({"ended":true,"exit_code":...}).
# Exits with the watcher's own code once it has ended, so a watcher that failed
# (exit 1: hc stopped answering) makes this fail too, or with hc's code when hc
# fails (3: no such watcher; others: hc stopped answering).
set -u

[ $# -le 1 ] || { echo "usage: wait-watch.sh [watcher-name]" >&2; exit 2; }
name=${1:-captain-watch}
while :; do
  r=$(hc wait "$name" --timeout 3600 --json) || { code=$?; printf '%s\n' "$r"; exit "$code"; }
  [ "$(jq -r .ended <<<"$r")" = true ] && { printf '%s\n' "$r"; exit "$(jq -r '.exit_code // 0' <<<"$r")"; }
done
