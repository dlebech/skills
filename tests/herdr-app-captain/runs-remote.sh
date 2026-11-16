#!/usr/bin/env bash
# Check of herdr-app-captain's runs on other machines (hc machine ls).
#
# Part 1 needs only hc on this machine: lib.sh's run addresses, reading a machine's runs
# (REMOTE_RUNS_SCRIPT, unpack_runs) run here against a scratch root, and runs.sh and
# watch-runs.sh with this machine only (CAPTAIN_MACHINES empty), naming runs as before.
# Part 2 needs a connected machine (MACHINE, default local-ssh). It makes a scratch
# runs root there (removed afterwards) and reads it through hc exec, with
# CAPTAIN_MACHINES and CAPTAIN_MACHINES_ROOT, so no real run on any machine is read
# into the checks or written. A plain sleep in a terminal on that machine stands in
# for an orchestrator. Checks:
#   1. runs.sh lists the machine's runs as "<machine>:<directory>", matches its
#      orchestrator terminal ("<machine>/<address>"), shows the question and unhandled
#      message there, the parked run, and the closed one only with --all;
#   2. a machine that cannot be read is said so, not left out silently, and with hc
#      machine ls failing, its orchestrators are not called unclaimed;
#   3. mark_run and post-message.sh write on the run's machine, also to a run whose
#      path holds spaces, quotes, $(...) and backticks;
#   4. watch-runs.sh reports a remote run's question, and its clearing, with the same
#      address; the events of a machine it cannot read are kept, neither repeated nor
#      cleared, and the machine is reported, and cleared once it can be read.
#
# Usage: tests/herdr-app-captain/runs-remote.sh [--local]   (--local: part 1 only)
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
capt=$repo/skills/herdr-app-captain/scripts
machine=${MACHINE:-local-ssh}
work=$(mktemp -d)
remote=
stand_in=rtest-remote-orc-$$
cleanup() {
  hc kill "$machine/$stand_in" >/dev/null 2>&1
  hc rm "$machine/$stand_in" >/dev/null 2>&1
  case $remote in /tmp/*) hc exec --on "$machine" rm -rf "$remote" >/dev/null 2>&1 ;; esac
  rm -rf "$work"
}
trap cleanup EXIT
failed=0
check() { # check <description> <got> <want>
  if [ "$2" = "$3" ]; then echo "ok   $1: $2"; else echo "FAIL $1: got '$2', want '$3'"; failed=1; fi
}
contains() { # contains <description> <text> <wanted part>
  case $2 in *"$3"*) echo "ok   $1" ;; *) echo "FAIL $1: no '$3' in: $2"; failed=1 ;; esac
}
lacks() { # lacks <description> <text> <unwanted part>
  case $2 in *"$3"*) echo "FAIL $1: '$3' in: $2"; failed=1 ;; *) echo "ok   $1" ;; esac
}

# make_runs <root> [terminal]: a waiting run with a question and two inbox messages (one
# a level request, one handled), a parked one, and a closed one.
make_runs() {
  local r=$1/proj
  mkdir -p "$r/feature-a/inbox" "$r/parked-b" "$r/closed-c"
  printf '{"terminal":"%s","tab_id":"","folder":"/src/proj","branch":"feature/a"}\n' "${2:-}" >"$r/feature-a/orchestrator.json"
  printf 'Status: waiting for user: which db?\n\nt1 planned\n' >"$r/feature-a/plan.md"
  printf '# Which db?\n\nPostgres or SQLite.\n' >"$r/feature-a/question.md"
  printf '{"topic":"Feature A","prs":[{"repo":"o/proj","url":"https://example.com/pr/1"}]}\n' >"$r/feature-a/status.json"
  printf 'set autonomy to L2\n' >"$r/feature-a/inbox/20260101T000000Z-harbormaster.message"
  printf 'old\n' >"$r/feature-a/inbox/20251231T000000Z-captain.handled"
  printf '{"terminal":"","tab_id":"","folder":"/src/proj","branch":"parked-b"}\n' >"$r/parked-b/orchestrator.json"
  printf 'Status: running\n' >"$r/parked-b/plan.md"
  printf '2026-01-01T00:00:00Z\trunning\n' >"$r/parked-b/parked"
  printf '{"terminal":"","tab_id":"","folder":"/src/proj","branch":"closed-c"}\n' >"$r/closed-c/orchestrator.json"
  printf 'Status: running\n' >"$r/closed-c/plan.md"
  : >"$r/closed-c/closed"
  # A closed run with a name the shell would act on, for the writes on another machine.
  mkdir -p "$r/$odd"
  printf '{"terminal":"","tab_id":"","folder":"/src/proj","branch":"odd"}\n' >"$r/$odd/orchestrator.json"
  printf 'Status: running\n' >"$r/$odd/plan.md"
  : >"$r/$odd/closed"
}
odd='a b$(touch pwned)`touch pwned2`'"'q\"q"

echo "== run addresses"
(
  . "$capt/lib.sh"
  split_address /a/b; echo "$run_machine|$run_dir"
  split_address m1:/a/b; echo "$run_machine|$run_dir"
  split_address rel/x:/y; echo "$run_machine|$run_dir"
  run_address "" /a/b; run_address m1 /a/b
) >"$work/addr"
check "addresses" "$(tr '\n' ' ' <"$work/addr")" "|/a/b m1|/a/b |rel/x:/y /a/b m1:/a/b "

echo "== reading a machine's runs, here"
make_runs "$work/src"
printf 'second line, not copied\n' >>"$work/src/proj/feature-a/inbox/20260101T000000Z-harbormaster.message"
(
  . "$capt/lib.sh"
  HERDR_ORCHESTRATION_ROOT=$work/src sh -c "$REMOTE_RUNS_SCRIPT" | unpack_runs "$work/copy" >"$work/copy-root"
)
check "its root" "$(cat "$work/copy-root")" "$work/src"
check "files copied" "$(cd "$work/copy" && find . -type f ! -path "./proj/a b*" | sort | tr '\n' ' ')" \
  "./proj/closed-c/closed ./proj/closed-c/orchestrator.json ./proj/closed-c/plan.md ./proj/feature-a/inbox/20260101T000000Z-harbormaster.message ./proj/feature-a/orchestrator.json ./proj/feature-a/plan.md ./proj/feature-a/question.md ./proj/feature-a/status.json ./proj/parked-b/orchestrator.json ./proj/parked-b/parked ./proj/parked-b/plan.md "
check "plan's Status line only" "$(cat "$work/copy/proj/feature-a/plan.md")" "Status: waiting for user: which db?"
check "a message's first line only" "$(cat "$work/copy/proj/feature-a/inbox/20260101T000000Z-harbormaster.message")" "set autonomy to L2"
check "question kept" "$(cmp -s "$work/src/proj/feature-a/question.md" "$work/copy/proj/feature-a/question.md" && echo same)" same
check "marker kept" "$(cat "$work/copy/proj/parked-b/parked")" "$(cat "$work/src/proj/parked-b/parked")"
check "odd name kept" "$(cat "$work/copy/proj/$odd/plan.md")" "Status: running"

echo "== this machine only, as before"
make_runs "$work/local"
out=$(HERDR_ORCHESTRATION_ROOT=$work/local CAPTAIN_MACHINES= WATCH_RUNS_INTERVAL=1 timeout 60 "$capt/watch-runs.sh")
check "watcher, plain directories" "$out" "attention feature/a waiting for user: which db?	$work/local/proj/feature-a
attention feature/a orchestrator gone	$work/local/proj/feature-a"
out=$(HERDR_ORCHESTRATION_ROOT=$work/local CAPTAIN_MACHINES= "$capt/runs.sh")
contains "runs.sh, plain directory" "$out" "run: $work/local/proj/feature-a"$'\n'
contains "question path" "$out" "  question: $work/local/proj/feature-a/question.md"
lacks "no machine lines" "$out" "machine "

[ "${1:-}" = --local ] && { [ "$failed" = 0 ] && echo "all passed"; exit "$failed"; }

echo "== runs on $machine"
hc machine ls --json | jq -e --arg m "$machine" '.machines[] | select(.name == $m and .state == "connected")' >/dev/null ||
  { echo "FAIL $machine is not connected"; exit 1; }
remote=$(hc exec --on "$machine" mktemp -d) && remote=${remote%$'\n'} || { echo "FAIL mktemp on $machine"; exit 1; }
hc run --bg --on "$machine" --name "$stand_in" --no-notify --label role=orchestrator sleep 300 >/dev/null
terminal=$(hc get "$machine/$stand_in" --json | jq -r .address)
contains "stand-in on $machine" "$terminal" "$machine/"
make_runs "$work/remote" "${terminal#*/}"
tar -C "$work/remote" -cf - . | hc exec --on "$machine" -i tar -xf - -C "$remote" || { echo "FAIL copying runs to $machine"; exit 1; }
export HERDR_ORCHESTRATION_ROOT=$work/here CAPTAIN_MACHINES=$machine CAPTAIN_MACHINES_ROOT=$remote WATCH_RUNS_INTERVAL=1
mkdir -p "$HERDR_ORCHESTRATION_ROOT"
run=$machine:$remote/proj/feature-a

out=$("$capt/runs.sh")
contains "run named by machine" "$out" "run: $run"$'\n'"  branch: feature/a  folder: /src/proj"$'\n'"  plan: waiting for user: which db?"
contains "orchestrator matched" "$out" "  orchestrator: $terminal starting"
contains "its facts" "$out" "  topic: Feature A"
contains "its question there" "$out" "  question: $run/question.md"
contains "its message" "$out" "  unhandled: 20260101T000000Z-harbormaster.message"
contains "parked there" "$out" "run: $machine:$remote/proj/parked-b"$'\n'"  branch: parked-b  folder: /src/proj"$'\n'"  plan: parked 2026-01-01T00:00:00Z (was: running)"
lacks "closed left out" "$out" "closed-c"
lacks "not unclaimed" "$out" "unclaimed orchestrator: $terminal"
contains "closed with --all" "$("$capt/runs.sh" --all)" "run: $machine:$remote/proj/closed-c"

echo "== a machine that cannot be read"
out=$(CAPTAIN_MACHINES="$machine ghost-$$" "$capt/runs.sh")
contains "said so" "$out" "machine ghost-$$: cannot be read (unknown machine"
contains "the other still read" "$out" "run: $run"
# hc machine ls failing, hc ls answering: the machine's orchestrator is not unclaimed.
mkdir -p "$work/bin"
printf '#!/bin/sh\n[ "$1" = machine ] && exit 1\nexec %s "$@"\n' "$(command -v hc)" >"$work/bin/hc"
chmod +x "$work/bin/hc"
out=$(env -u CAPTAIN_MACHINES PATH="$work/bin:$PATH" "$capt/runs.sh")
contains "warned" "$out" "warning: hc machine ls failed"
contains "orchestrator unknown, not unclaimed" "$out" "orchestrator on unreadable machine $machine: $terminal"
lacks "nothing unclaimed there" "$out" "unclaimed orchestrator: $machine/"

echo "== writes go to the run's machine"
(. "$capt/lib.sh" && mark_run "$machine:$remote/proj/closed-c" parked)
check "marker there" "$(hc exec --on "$machine" cut -f2 "$remote/proj/closed-c/parked")" "running"
check "nothing here" "$(ls "$HERDR_ORCHESTRATION_ROOT")" ""
msg=$(printf 'Use $(postgres).\n' | "$capt/post-message.sh" "$run")
contains "message path there" "$msg" "$remote/proj/feature-a/inbox/"
check "message there, as written" "$(hc exec --on "$machine" cat "$msg")" 'Use $(postgres).'
check "no temporary left" "$(hc exec --on "$machine" sh -c "ls -A '$remote/proj/feature-a/inbox' | grep -c tmp")" 0
printf 'x\n' | "$capt/post-message.sh" "$machine:$remote/proj/nothing" 2>"$work/err"
check "no run, no message" "$?:$(cat "$work/err")" "1:no run at $remote/proj/nothing"
hc exec --on "$machine" rm "$msg"
(. "$capt/lib.sh" && mark_run "$machine:$remote/proj/$odd" parked)
check "odd name, marker there" "$(hc exec --on "$machine" cut -f2 "$remote/proj/$odd/parked")" "running"
msg=$(printf 'odd\n' | "$capt/post-message.sh" "$machine:$remote/proj/$odd")
check "odd name, message there" "$(hc exec --on "$machine" cat "$msg")" "odd"
check "nothing ran" "$(hc exec --on "$machine" sh -c 'for d in "$1" "$1/$2" "$HOME"; do ls -A "$d"; done | grep -cxE "pwned2?"' sh "$remote/proj" "$odd")" 0

echo "== the watcher"
watch_once() { timeout 60 "$capt/watch-runs.sh"; }
out=$(watch_once)
contains "question reported" "$out" "attention feature/a waiting for user: which db?	$run"
lacks "parked quiet" "$out" "parked-b"
contains "seen kept by address" "$(cat "$HERDR_ORCHESTRATION_ROOT/.captain-seen")" "	$run"
printf 'Status: running\n' | hc exec --on "$machine" -i sh -c "cat >'$remote/proj/feature-a/plan.md' && rm '$remote/proj/feature-a/question.md'"
# The stand-in says nothing, so it never counts as idle: only the clearing can end this.
out=$(watch_once)
contains "clearing reported" "$out" "cleared feature/a waiting for user: which db?	$run"
# A machine it cannot read: its events stay as they were, so nothing clears or repeats.
printf 'attention gone-b waiting for user: x\tghost-%s:/r/gone-b\n' $$ >>"$HERDR_ORCHESTRATION_ROOT/.captain-seen"
printf 'Status: waiting for user: again?\n' | hc exec --on "$machine" -i sh -c "cat >'$remote/proj/feature-a/plan.md'"
out=$(CAPTAIN_MACHINES="$machine ghost-$$" watch_once)
contains "new event still seen" "$out" "attention feature/a waiting for user: again?	$run"
contains "unreadable machine reported" "$out" "attention machine ghost-$$ cannot be read	ghost-$$:"
lacks "its run not cleared" "$out" "cleared feature/a"
lacks "its event not repeated" "$out" "gone-b"
contains "its event kept" "$(cat "$HERDR_ORCHESTRATION_ROOT/.captain-seen")" "attention gone-b waiting for user: x	ghost-$$:/r/gone-b"
# Readable again (here: no longer configured), the machine's event clears.
out=$(watch_once)
check "machine cleared" "$out" "cleared machine ghost-$$ cannot be read	ghost-$$:"

[ "$failed" = 0 ] && echo "all passed"
exit "$failed"
