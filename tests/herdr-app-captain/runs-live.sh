#!/usr/bin/env bash
# Live check of the run bookkeeping, against the real hc core and Herdr window.
#
# Uses a throwaway runs root, git repo, and Herdr space (closed afterwards), with
# plain programs as stand-in orchestrators, so it costs no model turns. Checks:
#   1. a labelled terminal gets a tab; init-run.sh records it and names it 🐙;
#   2. set-status.sh changes plan.md, the tab, and the run.status label;
#   2b. integration-worktree.sh creates the worktree and its space, keeps the
#      active space, and does nothing more the second time;
#   3. runs.sh shows the run, its question, and its unhandled message;
#   4. repo-spaces.sh finds the space;
#   5. watch-runs.sh, in its own terminal, tells this terminal when it exits, and
#      reports an event once: waiting for user, finished, orchestrator gone; with
#      a 10-minute interval, so only hc events can wake it for finished;
#   6. a second watcher is refused by name;
#   7. a --no-parent terminal outlives the agent that started it.
#
# Usage: tests/herdr-app-captain/runs-live.sh
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
orch=$repo/skills/herdr-app-orchestrator/scripts
capt=$repo/skills/herdr-app-captain/scripts
[ -n "${HC_TERMINAL_ID:-}" ] || { echo "Run this inside an hc terminal." >&2; exit 1; }
herdr-app ls >/dev/null || { echo "Open the Herdr window first." >&2; exit 1; }

work=$(mktemp -d)
export HERDR_ORCHESTRATION_ROOT=$work/runs WATCH_RUNS_INTERVAL=1
suffix=$$
fake=rtest-orc-$suffix
watch=rtest-watch-$suffix
toy=$work/hctoy-$suffix
wt=$HOME/.herdr/worktrees/hctoy-$suffix/feature-x
space=
wt_space=
active_space() { herdr-app ls | jq -r 'first(.spaces[] | select(.active) | .id) // empty'; }
cleanup() {
  for n in "$fake" "$watch" "$watch-2" "$fake-free" "$fake-kid"; do hc kill "$n" >/dev/null 2>&1; hc rm "$n" >/dev/null 2>&1; done
  for space in $wt_space $space; do
    # Closing a space leaves its finished shells behind.
    shells=$(hc ls --all --label "herdr.space=$space" --json | jq -r '.terminals[].address')
    herdr-app do space.close --id "$space" --confirmed true >/dev/null 2>&1
    for t in $shells; do
      hc kill "$t" >/dev/null 2>&1
      hc wait "$t" --timeout 5 >/dev/null 2>&1
      hc rm "$t" >/dev/null 2>&1
    done
  done
  git -C "$toy" worktree remove --force "$wt" >/dev/null 2>&1
  rmdir "${wt%/*}" 2>/dev/null
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
tab_name() { herdr-app ls | jq -r --arg t "$1" '.spaces[].tabs[] | select(.id == $t) | .name'; }
start_watcher() { # [interval]; hc run does not pass on this environment, so it goes in the command
  hc run --bg --name "$watch" --no-notify --cwd "$work" -- env HERDR_ORCHESTRATION_ROOT="$HERDR_ORCHESTRATION_ROOT" \
    WATCH_RUNS_INTERVAL="${1:-1}" "$capt/watch-runs.sh" >/dev/null
}
watch_once() { # start the watcher, wait for it to exit, print what it said
  start_watcher
  hc wait "$watch" --timeout 20 >/dev/null
  hc read "$watch" --lines 20 | sed 's/ *$//' | grep -v '^$'
  hc rm "$watch" >/dev/null
}

git init -q "$toy"
git -C "$toy" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init

echo "== a labelled terminal gets a tab"
# As herdr-app-captain does for a repository without a space: a space id of our own.
before=$(active_space)
space=sp-hctest-$suffix
# A stand-in orchestrator: runs init-run.sh as if it were the agent in that tab.
cat >"$work/fake.sh" <<SCRIPT
export HERDR_ORCHESTRATION_ROOT="$HERDR_ORCHESTRATION_ROOT"
sleep 3 # an agent takes longer than this to boot, and Herdr needs a moment for the tab
cd "$toy" && "$orch/init-run.sh" feature/x >"$work/init.out"
exec sleep 300
SCRIPT
hc run --bg --name "$fake" --no-notify --cwd "$toy" --label "herdr.space=$space" --label "herdr.tab=tb-$fake" bash "$work/fake.sh" >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$work/init.out" ] && break; hc wait "$fake" --output nothing --timeout 1 >/dev/null 2>&1; done
address=$(hc get "$fake" --json | jq -r .address)
tab=tb-$fake
contains "Herdr made the tab" "$(tab_name "$tab")" "🐙"
check "space from the label" "$(herdr-app ls | jq -r --arg s "$space" '.spaces[] | select(.id == $s) | .folder')" "$toy"
check "focus kept for the repo space" "$(active_space)" "$before"
read -r state dir <"$work/init.out"
check "init-run" "$state" new
check "dashes for slashes" "${dir##*/}" feature-x
check "recorded terminal" "$(jq -r .terminal "$dir/orchestrator.json")" "$address"
check "recorded tab" "$(jq -r .tab_id "$dir/orchestrator.json")" "$tab"
check "role label" "$(hc get "$fake" --json | jq -r .labels.role)" orchestrator
check "tab name, running" "$(tab_name "$tab")" "🐙 feature/x"

echo "== set-status.sh"
echo "t1 planned" >>"$dir/plan.md"
"$orch/set-status.sh" "$dir" "waiting for user: which db?"
check "plan line" "$(head -1 "$dir/plan.md")" "Status: waiting for user: which db?"
check "plan body kept" "$(tail -1 "$dir/plan.md")" "t1 planned"
check "tab name, waiting" "$(tab_name "$tab")" "🐙 ✋ feature/x"
check "status label" "$(hc get "$fake" --json | jq -r '.labels["run.status"]')" waiting

echo "== integration-worktree.sh"
before=$(active_space)
out=$(cd "$toy" && "$orch/integration-worktree.sh" feature/x HEAD 2>"$work/wt.err")
check "prints the path" "$out" "$wt"
check "on the branch" "$(git -C "$wt" branch --show-current)" feature/x
space_of() { herdr-app ls | jq -r --arg p "$1" '.spaces[] | select(.folder == $p) | .id'; }
for _ in 1 2 3 4 5; do wt_space=$(space_of "$wt"); [ -n "$wt_space" ] && break; sleep 1; done
contains "space opened" "$wt_space" sp
check "focus kept" "$(active_space)" "$before"
check "no warnings" "$(cat "$work/wt.err")" ""
(cd "$toy" && "$orch/integration-worktree.sh" feature/x HEAD >/dev/null 2>&1)
check "second time, one space" "$(herdr-app ls | jq --arg p "$wt" '[.spaces[] | select(.folder == $p)] | length')" 1
contains "repo-spaces sees a worktree" "$("$capt/repo-spaces.sh" "$toy")" "$wt_space	worktree"

echo "== runs.sh"
echo "Which db?" >"$dir/question.md"
echo "use sqlite" >"$dir/inbox/captain-1.message"
hc label "$fake" progress="task 1/2" >/dev/null
out=$("$capt/runs.sh")
contains "shows plan" "$out" "plan: waiting for user: which db?"
contains "shows question" "$out" "question: $dir/question.md"
contains "shows message" "$out" "unhandled: captain-1.message"
contains "shows progress" "$out" "(task 1/2)"

echo "== repo-spaces.sh"
out=$("$capt/repo-spaces.sh" "$toy")
contains "finds the space" "$out" "$space"
contains "primary" "$out" primary

echo "== watcher"
out=$(watch_once)
contains "waiting for user" "$out" "attention feature/x waiting for user: which db?"
start_watcher 600
hc wait "$watch" --output nothing --timeout 3 >/dev/null 2>&1
check "reported once" "$(hc get "$watch" --json | jq -r .state)" live
hc run --bg --name "$watch" --no-notify --cwd "$work" sleep 1 >/dev/null 2>"$work/second"
contains "second watcher refused" "$(cat "$work/second")" name_taken
"$orch/set-status.sh" "$dir" finished
check "tab name, finished" "$(tab_name "$tab")" "🐙 ✓ feature/x"
hc wait "$watch" --timeout 15 >/dev/null
contains "finished" "$(hc read "$watch" --lines 20)" "attention feature/x finished"
hc rm "$watch" >/dev/null
"$orch/set-status.sh" "$dir" running
hc kill "$fake" >/dev/null
out=$(watch_once)
contains "gone" "$out" "attention feature/x orchestrator gone"

echo "== --no-parent outlives its starter"
hc run --bg --name "$watch-2" --no-notify --cwd "$work" -- bash -c \
  "hc run --bg --no-parent --no-notify --name $fake-free sleep 60 >/dev/null; hc run --bg --no-notify --name $fake-kid sleep 60 >/dev/null" >/dev/null
hc wait "$watch-2" --timeout 10 >/dev/null
hc wait "$fake-kid" --output nothing --timeout 2 >/dev/null 2>&1
check "independent one lives" "$(hc get "$fake-free" --json | jq -r .state)" live
check "child one ended" "$(hc get "$fake-kid" --json 2>/dev/null | jq -r '.state // "gone"')" finished

exit "$failed"
