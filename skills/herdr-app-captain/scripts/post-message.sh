#!/usr/bin/env bash
# Write a message to a run's inbox, on whichever machine the run is, for herdr-app-captain.
#
# Usage: post-message.sh <run> < message
#
# <run> is as runs.sh prints it: a directory on this machine, or
# "<machine>:<directory>" for a run on another (lib.sh's run_address). Writes stdin to
# <run-directory>/inbox/.captain-<time>.tmp on the run's machine, then moves it to
# <time>-captain.message there, so the orchestrator never reads half a message
# (run-files.md, inbox/). Prints the message's path on its machine, the one to name in
# the orchestrator's wake-up. Fails without writing when the run directory is not there.
set -u
. "$(dirname "$0")/lib.sh"

[ $# -eq 1 ] && [ -n "$1" ] || { echo "usage: post-message.sh <run> < message" >&2; exit 2; }
split_address "$1"
# The time is taken where the message is written, as the orchestrator sorts its inbox there.
on_machine "$run_machine" '[ -e "$1/orchestrator.json" ] || { echo "no run at $1" >&2; exit 1; }
mkdir -p "$1/inbox" || exit 1
t=$(date -u +%Y%m%dT%H%M%SZ)
cat >"$1/inbox/.captain-$t.tmp" && mv "$1/inbox/.captain-$t.tmp" "$1/inbox/$t-captain.message" &&
  echo "$1/inbox/$t-captain.message"' "$run_dir"
