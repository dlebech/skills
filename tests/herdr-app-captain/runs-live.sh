#!/usr/bin/env bash
# Live check of the run bookkeeping, against the real hc core and Herdr window.
#
# Uses a throwaway runs root, git repo, and Herdr space (closed afterwards), with
# plain programs as stand-in orchestrators, so it costs no model turns. Checks:
#   1. a labelled terminal gets a tab; init-run.sh records it and names it 🐙;
#   2. set-status.sh changes plan.md, the tab, and the run.status label; publishes
#      progress, tasks, issues, PRs and waiting agents to status.json and labels,
#      keeping each until changed, and publishes them again without a status and
#      when init-run.sh resumes the run; refuses a newline, and changes nothing
#      when status.json is unreadable; refuses "waiting for user" without a
#      question.md;
#   2b. integration-worktree.sh creates the worktree and opens its space with
#      space.new, switching back to the active space, and does nothing more the
#      second time; reuses a worktree that already has the branch, and refuses the
#      main checkout's branch;
#   3. runs.sh shows the run, its question, its unhandled message, and its
#      status.json facts and their age, also once its terminal is gone; keeps a
#      finished run while its terminal lives, and leaves it out (but not with
#      --all) once it is gone;
#   3a. an orchestrator whose terminal is live with only a shell in it, as after a
#      restart, shows as lost: a finished run stays open, and the watcher reports it gone;
#   3b. a parked run stays in runs.sh, marked parked, and the watcher says
#      nothing about it; a closed one is left out (but not with --all), finished
#      or not; init-run.sh resuming a run deletes its marker; it records no kind
#      for a program that reports none, and warns in a linked worktree and in a
#      terminal without a tab;
#   4. decisions.sh adds, rewords and removes the captain's open decisions;
#      repo-spaces.sh finds the space;
#   5. watch-runs.sh, in its own terminal, is waited for by wait-watch.sh, and
#      reports an event once: waiting for user, its clearing (not beside finished, not
#      when parked), finished, orchestrator gone; with
#      a 10-minute interval, so only hc events can wake it for finished;
#   6. a second watcher is refused by name;
#   7. a run started in a folder holding two repositories: init-run.sh names it
#      after the folder, and repo-spaces.sh lists the folder's space; another
#      folder of the same name cannot take its run directory;
#   8. a --no-parent terminal outlives the agent that started it.
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
other_space=
multi_space=
active_space() { herdr-app ls | jq -r 'first(.spaces[] | select(.active) | .id) // empty'; }
cleanup() {
  for n in "$fake" "$fake-multi" "$fake-lost" "$watch" "$watch-2" "$fake-free" "$fake-kid"; do hc kill "$n" >/dev/null 2>&1; hc rm "$n" >/dev/null 2>&1; done
  for space in $wt_space $other_space $space $multi_space; do
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
  git -C "$toy" worktree remove --force "$work/elsewhere" >/dev/null 2>&1
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
check "no kind for a plain program" "$(jq -r '.kind // "none"' "$dir/orchestrator.json")" none
check "tab name, running" "$(tab_name "$tab")" "🐙 feature/x"

echo "== set-status.sh"
echo "t1 planned" >>"$dir/plan.md"
err=$("$orch/set-status.sh" "$dir" "waiting for user: which db?" 2>&1)
check "refused without question.md" "$?:$(head -1 "$dir/plan.md")" "2:Status: running"
contains "says why" "$err" "needs $dir/question.md"
echo "Which db?" >"$dir/question.md"
"$orch/set-status.sh" "$dir" "waiting for user: which db?"
check "plan line" "$(head -1 "$dir/plan.md")" "Status: waiting for user: which db?"
check "plan body kept" "$(tail -1 "$dir/plan.md")" "t1 planned"
check "tab name, waiting" "$(tab_name "$tab")" "🐙 ✋ feature/x"
check "status label" "$(hc get "$fake" --json | jq -r '.labels["run.status"]')" waiting
"$orch/set-status.sh" "$dir" --issue https://example.com/i/1 --tasks 1/2 --progress "task 2/2 in review" \
  --pr acme/api https://example.com/pr/1 --pr acme/web https://example.com/pr/2 --waiting "impl-x rev-y"
check "status kept without one" "$(head -1 "$dir/plan.md")" "Status: waiting for user: which db?"
check "status.json" "$(jq -c '[.branch, .state, .progress, .tasks, .issues, [.prs[].repo], .waiting]' "$dir/status.json")" \
  '["feature/x","waiting","task 2/2 in review",{"merged":1,"planned":2},["https://example.com/i/1"],["acme/api","acme/web"],["impl-x","rev-y"]]'
labels() { hc get "$fake" --json | jq -c '[.labels.progress, .labels["run.prs"]]'; }
check "fact labels" "$(labels)" '["task 2/2 in review","https://example.com/pr/1 https://example.com/pr/2"]'
"$orch/set-status.sh" "$dir" --pr acme/api https://example.com/pr/3 --issue https://example.com/i/1 --waiting ""
check "facts kept, PR replaced" "$(jq -c '[.progress, .issues, .prs, .waiting]' "$dir/status.json")" \
  '["task 2/2 in review",["https://example.com/i/1"],[{"repo":"acme/api","url":"https://example.com/pr/3"},{"repo":"acme/web","url":"https://example.com/pr/2"}],[]]'
"$orch/set-status.sh" "$dir" --related acme/api https://example.com/pr/7 --related acme/api https://example.com/pr/8 \
  --related acme/api https://example.com/pr/7
check "related PRs added once, own PRs untouched" "$(jq -c '[[.related[].url], [.prs[].url]]' "$dir/status.json")" \
  '[["https://example.com/pr/7","https://example.com/pr/8"],["https://example.com/pr/3","https://example.com/pr/2"]]'
hc label "$fake" progress= run.prs= >/dev/null
"$orch/set-status.sh" "$dir"
check "labels published again" "$(labels)" '["task 2/2 in review","https://example.com/pr/3 https://example.com/pr/2"]'
hc label "$fake" progress= run.prs= role= >/dev/null
out=$(cd "$toy" && HC_TERMINAL_ID=$address "$orch/init-run.sh" feature/x)
check "init-run on a resume" "$out" "existing $dir"
check "labels after a resume" "$(labels)" '["task 2/2 in review","https://example.com/pr/3 https://example.com/pr/2"]'
check "role after a resume" "$(hc get "$fake" --json | jq -r .labels.role)" orchestrator
"$orch/set-status.sh" "$dir" --waiting $'impl-x\t rev-y\n'
check "waiting split on any space" "$(jq -c .waiting "$dir/status.json")" '["impl-x","rev-y"]'
"$orch/set-status.sh" "$dir" --waiting ""
"$orch/set-status.sh" "$dir" --progress $'two\nlines' 2>/dev/null
check "newline refused" "$?:$(jq -r .progress "$dir/status.json")" "2:task 2/2 in review"
cp "$dir/status.json" "$work/status.good"
echo '{broken' >"$dir/status.json"
"$orch/set-status.sh" "$dir" blocked 2>/dev/null
check "unreadable status.json changes nothing" "$?:$(head -1 "$dir/plan.md")" "1:Status: waiting for user: which db?"
mv "$work/status.good" "$dir/status.json"

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
git -C "$toy" worktree add -q -b feature/z "$work/elsewhere" HEAD
out=$(cd "$toy" && "$orch/integration-worktree.sh" feature/z HEAD 2>/dev/null)
check "reuses a worktree elsewhere" "$out" "$work/elsewhere"
for _ in 1 2 3 4 5; do other_space=$(space_of "$work/elsewhere"); [ -n "$other_space" ] && break; sleep 1; done
out=$(cd "$toy" && "$orch/integration-worktree.sh" "$(git -C "$toy" branch --show-current)" HEAD 2>/dev/null)
check "refuses the main checkout's branch" "$?:$out" "3:"

echo "== runs.sh"
echo "Which db?" >"$dir/question.md"
echo "use sqlite" >"$dir/inbox/captain-1.message"
out=$("$capt/runs.sh")
contains "shows plan" "$out" "plan: waiting for user: which db?"
contains "shows question" "$out" "question: $dir/question.md"
contains "shows message" "$out" "unhandled: captain-1.message"
contains "shows progress" "$out" "progress: task 2/2 in review; 1/2 tasks merged"
contains "shows a PR" "$out" "pr: acme/api https://example.com/pr/3"
contains "shows an issue" "$out" "issue: https://example.com/i/1"
contains "shows the facts' age" "$out" "facts updated: 20"

echo "== decisions.sh"
"$capt/decisions.sh" add board --run "$dir" "Move #12 to Test?"
"$capt/decisions.sh" add merge "Merge #3?"
"$capt/decisions.sh" add board "Move #12 and #13 to Test?"
out=$("$capt/decisions.sh" ls)
check "two open" "$(wc -l <<<"$out")" 2
check "reworded, first asked kept" "$(head -1 <<<"$out" | cut -f1,3,4)" "board	$dir	Move #12 and #13 to Test?"
"$capt/decisions.sh" done board unknown
check "done removes it" "$("$capt/decisions.sh" ls | cut -f1)" merge
"$capt/decisions.sh" add 'Bad id' x 2>/dev/null
check "bad id refused" "$?" 2
"$capt/decisions.sh" done merge
check "file empties" "$(jq length "$HERDR_ORCHESTRATION_ROOT/.captain-decisions.json")" 0

echo "== repo-spaces.sh"
out=$("$capt/repo-spaces.sh" "$toy")
contains "finds the space" "$out" "$space"
contains "primary" "$out" primary

echo "== watcher"
out=$(watch_once)
contains "waiting for user" "$out" "attention feature/x waiting for user: which db?"
# Answered in the orchestrator's own tab: the question clears, and the watcher says so.
"$orch/set-status.sh" "$dir" running
out=$(watch_once)
contains "answered elsewhere" "$out" "cleared feature/x waiting for user: which db?"
"$orch/set-status.sh" "$dir" "waiting for user: which db?"
out=$(watch_once)
contains "asked again" "$out" "attention feature/x waiting for user: which db?"
start_watcher 600
hc wait "$watch" --output nothing --timeout 3 >/dev/null 2>&1
check "reported once" "$(hc get "$watch" --json | jq -r .state)" live
hc run --bg --name "$watch" --no-notify --cwd "$work" sleep 1 >/dev/null 2>"$work/second"
contains "second watcher refused" "$(cat "$work/second")" name_taken
"$orch/set-status.sh" "$dir" finished
check "tab name, finished" "$(tab_name "$tab")" "🐙 ✓ feature/x"
contains "finished run stays open" "$("$capt/runs.sh")" "plan: finished, PR open until its tab is closed"
# As the captain waits: wait-watch.sh ends once the watcher has, with its exit.
out=$(timeout 15 "$capt/wait-watch.sh" "$watch")
check "wait-watch.sh ends with the watcher" "$(jq -r '"\(.ended) \(.exit_code)"' <<<"$out")" "true 0"
out=$(hc read "$watch" --lines 20)
contains "finished" "$out" "attention feature/x finished"
# The question went with the run finishing: finished says it, not cleared as well.
check "no cleared beside finished" "$(grep -c '^cleared' <<<"$out")" 0
hc rm "$watch" >/dev/null
timeout 5 "$capt/wait-watch.sh" "$watch" >/dev/null 2>&1
check "wait-watch.sh fails for no watcher" "$?" 3
"$orch/set-status.sh" "$dir" running
hc kill "$fake" >/dev/null
out=$(watch_once)
contains "gone" "$out" "attention feature/x orchestrator gone"
contains "PR after the terminal ends" "$("$capt/runs.sh")" "pr: acme/web https://example.com/pr/2"
"$orch/set-status.sh" "$dir" finished 2>/dev/null
check "closed run left out" "$("$capt/runs.sh" | grep -c "run: $dir")" 0
contains "closed run with --all" "$("$capt/runs.sh" --all)" "plan: finished, closed"

echo "== a lost orchestrator"
# As herdr-core leaves an agent's terminal after a restart: live, with only a shell in
# it. A hand-made run directory names it as its orchestrator.
hc run --bg --name "$fake-lost" --no-notify --cwd "$toy" bash >/dev/null
hc wait "$fake-lost" --output nothing --timeout 1 >/dev/null 2>&1
ldir=$HERDR_ORCHESTRATION_ROOT/hclost-$suffix/feature-z
mkdir -p "$ldir/inbox"
jq -n --arg t "$(hc get "$fake-lost" --json | jq -r .address)" --arg f "$toy" \
  '{terminal: $t, tab_id: "", folder: $f, branch: "feature/z", kind: "claude"}' >"$ldir/orchestrator.json"
echo "Status: finished" >"$ldir/plan.md"
out=$("$capt/runs.sh")
contains "lost finished run stays open" "$out" "plan: finished, PR open; its orchestrator is lost, its tab still open"
contains "lost orchestrator shown gone" "$out" "gone (lost: only a shell is left in its terminal"
echo "Status: running" >"$ldir/plan.md"
out=$(watch_once)
contains "lost orchestrator reported gone" "$out" "attention feature/z orchestrator gone"
hc kill "$fake-lost" >/dev/null; hc rm "$fake-lost" >/dev/null 2>&1
rm -rf "${ldir%/*}"

echo "== parked and closed"
# With lib.sh's mark_run, as herdr-app-captain writes them.
# Parked with a question open: the question is put away, not answered.
"$orch/set-status.sh" "$dir" "waiting for user: which db?"
out=$(watch_once)
contains "waiting before parking" "$out" "attention feature/x waiting for user: which db?"
(. "$capt/lib.sh" && mark_run "$dir" parked)
out=$("$capt/runs.sh")
contains "parked run listed" "$out" "plan: parked 20"
contains "parked from its status" "$out" "(was: waiting for user: which db?)"
start_watcher
hc wait "$watch" --output nothing --timeout 4 >/dev/null 2>&1
check "watcher quiet about a parked run, no cleared" "$(hc get "$watch" --json | jq -r .state)" live
hc kill "$watch" >/dev/null; hc rm "$watch" >/dev/null 2>&1
rm "$dir/parked"
(. "$capt/lib.sh" && mark_run "$dir" closed)
check "closed unfinished run left out" "$("$capt/runs.sh" | grep -c "run: $dir")" 0
contains "closed run with --all, marked" "$("$capt/runs.sh" --all)" "plan: closed 20"

echo "== a run across two repositories"
multi=$work/hcmulti-$suffix
for r in api web; do
  git init -q "$multi/$r"
  git -C "$multi/$r" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
done
multi_space=sp-hcmulti-$suffix
cat >"$work/fake-multi.sh" <<SCRIPT
export HERDR_ORCHESTRATION_ROOT="$HERDR_ORCHESTRATION_ROOT"
sleep 3
cd "$multi" && "$orch/init-run.sh" feature/y >"$work/init-multi.out"
exec sleep 300
SCRIPT
hc run --bg --name "$fake-multi" --no-notify --cwd "$multi" --label "herdr.space=$multi_space" --label "herdr.tab=tb-$fake-multi" bash "$work/fake-multi.sh" >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$work/init-multi.out" ] && break; hc wait "$fake-multi" --output nothing --timeout 1 >/dev/null 2>&1; done
read -r state mdir <"$work/init-multi.out"
check "init-run outside a repository" "$state" new
check "named after the folder" "$mdir" "$HERDR_ORCHESTRATION_ROOT/hcmulti-$suffix/feature-y"
check "records the folder" "$(jq -r .folder "$mdir/orchestrator.json")" "$multi"
contains "runs.sh shows the folder" "$("$capt/runs.sh")" "folder: $multi"
contains "repo-spaces lists the folder" "$("$capt/repo-spaces.sh" "$multi")" "$multi_space	folder	$multi"
(. "$capt/lib.sh" && mark_run "$mdir" parked)
maddr=$(hc get "$fake-multi" --json | jq -r .address)
err=$(cd "$multi" && HC_TERMINAL_ID=$maddr "$orch/init-run.sh" feature/y 2>&1 >/dev/null)
check "resume deletes the marker" "$([ -e "$mdir/parked" ] && echo kept || echo deleted)" deleted
contains "resume says so" "$err" "was parked"
err=$(cd "$wt" && HERDR_ORCHESTRATION_ROOT=$work/runs-wt HC_TERMINAL_ID=$maddr "$orch/init-run.sh" feature/w 2>&1 >/dev/null)
contains "warns in a linked worktree" "$err" "linked worktree"
# A made-up terminal, so a wrong result cannot label this one.
mkdir -p "$work/other/hcmulti-$suffix"
(cd "$work/other/hcmulti-$suffix" && HC_TERMINAL_ID=t0-none "$orch/init-run.sh" feature/y >/dev/null 2>&1)
check "same name, other folder" "$?" 3

echo "== --no-parent outlives its starter"
hc run --bg --name "$watch-2" --no-notify --cwd "$work" -- bash -c \
  "hc run --bg --no-parent --no-notify --name $fake-free sleep 60 >/dev/null; hc run --bg --no-notify --name $fake-kid sleep 60 >/dev/null" >/dev/null
hc wait "$watch-2" --timeout 10 >/dev/null
hc wait "$fake-kid" --output nothing --timeout 2 >/dev/null 2>&1
check "independent one lives" "$(hc get "$fake-free" --json | jq -r .state)" live
check "child one ended" "$(hc get "$fake-kid" --json 2>/dev/null | jq -r '.state // "gone"')" finished
free=$(hc get "$fake-free" --json | jq -r .address)
err=$(cd "$toy" && HERDR_ORCHESTRATION_ROOT=$work/runs-free HC_TERMINAL_ID=$free "$orch/init-run.sh" feature/v 2>&1 >/dev/null)
contains "warns without a tab" "$err" "no tab"

exit "$failed"
