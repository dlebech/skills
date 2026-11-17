#!/usr/bin/env bash
# An invisible second Herdr app with fake runs, for shots of Harbormaster's Crew in states no
# real run shows (Done, can't tell, stalled, nothing for you), without touching the user's window,
# hc core or runs.
#
# Usage: crew-sandbox.sh <scratch-dir> <command> [args]
#   up              start Xvfb (:$CREW_DISPLAY, 1600x1000) with a herdr-app on a scratch HERDR_APP_HOME,
#                   its own hc session ($CREW_SESSION) and a scratch HERDR_ORCHESTRATION_ROOT; install
#                   this checkout's Harbormaster into it; create the fake runs (below)
#   runs            (re)create the fake runs only (part of up)
#   do <cmd> [args] herdr-app do, against the scratch app (e.g. do harbormaster.show-crew)
#   shot <file>     herdr-app shot of the scratch app
#   root <file>     a capture of the whole Xvfb screen, to find screen coordinates for click
#   click <x> <y>   left click at screen coordinates on the Xvfb display (XTest; never the user's)
#   hover <x> <y>   move the pointer there (tooltips)
#   hc <args>       hc against the scratch session (e.g. hc label t4 role=)
#   env             print the environment lines (eval them to run herdr-app/hc by hand)
#   down            stop the scratch app, its Xvfb and the scratch hc session; the scratch dir stays
#
# Fake runs (folder "skills", so the default self review flow), each with a live "orchestrator"
# terminal (a sleeping sh, labelled role=orchestrator and with set-status.sh's labels):
#   run-stats     finished, PR dlebech/skills#42 (merged)                 -> Done
#   pane-follows  finished, PR #41 (merged), related #40                  -> Done
#   unreadable-pr finished, PR in a repo that does not exist (gh fails)   -> Everything else, can't tell
#   quiet-run     running, "t2 implementing", no PR, nothing moves       -> idle, then stalled
#                 ("quiet Nm", Needs you, Ask) 30 minutes after the app started (module memory)
#   busy-run      running, both tasks implementing, its orchestrator reporting working (OSC 7501),
#                 status.json dated 75 minutes back                      -> Working, spinner, "t1 implementing 1h15m · +1 task"
#   review-wait   finished, folder "snevagten" (peer), cli/cli#14846 with a reviewer requested
#                                                                         -> Waiting on others, "review from BagToad"
#   asks-you      waiting for user, no PR                                -> Needs you, red, with its wait age
#   gone-run      running, its orchestrator terminal killed              -> Needs you, "orchestrator gone", a row of its own
#   toast-run     running, three decisions; ask it a question by hand     -> a toast (see make_runs)
#   parked-open   parked 3 days ago, open PR cli/cli#14927                 -> Parked, "review proof → merge · 3d…"
#   parked-merged parked 5 days ago, PR #42 (merged)                      -> Parked, "merged — close run · 5d…"
# For the Needs-you box's lines and buttons (t11), read-only gh views of real PRs:
#   approved-merge  finished, folder "snevagten" (peer), snevagten/snelogin#1308 and #1372,
#                   approved by a colleague                               -> approved — merge
#   approved-plan-open  running, folder "snevagten" (peer), 1/2 tasks done, fake-two/api#44 (approved, no comments)
#                       -> Needs you "approved · plan open", the box: "merge once the plan is done (1/2 tasks)"
#   red-ci        finished, cli/cli#14927 (a public PR with a failing check) -> red CI, then
#                 review proof → merge
#   review-proof  finished, dlebech/wapi-beatbox#1, proof.md T2 1/2 pass  -> review proof → merge
#   report-run    finished, no PR, shared/final-report.md (+ t1-report.md) -> finished — read and close
#   asks-question running, question.md with Options, Recommended and Blocks -> a question box
#   asks-and-pr   finished plan (2/2), open self-flow PR dlebech/wapi-beatbox#1 with proof, and a
#                 question.md                                            -> a question box with "Also needs you" under it
#   plan-open     running, 1/3 tasks done, the same open PR                -> Working: no "review proof → merge" until the plan is done
# For an approval over two PRs with comments (t17), fake PRs through fake-gh.sh (installed as
# <scratch>/bin/gh, first on the app's PATH; it answers only owner "fake-two", the real gh the rest):
#   two-prs       running, folder "snevagten" (peer), fake-two/api#1799 (2 comments) and fake-two/web#1372 (9; one PR per repo in status.json),
#                 both approved by mfalkenbrink. Its orchestrator's state follows the file
#                 <scratch>/state-two-prs ("working" or "idle"; none = idle): `echo working > ...`
#                 as the orchestrator does after Handle them
# CREW_ORCH_STATE=idle makes every fake orchestrator report a status, so it is an agent Herdr can focus
# (agent.focus --terminal <t>) and the Crew shows it selected; without it only busy-run is one.
# Hide a run from the Crew with `hc label <t> role=` and bring it back with role=orchestrator.
#
# Needs xvfb-run, ImageMagick's import (root only), jq, gh, python3 and libXtst. The window lands
# at screen offset (162, 90) on the 1600x1000 screen; add that to a shot's coordinates for click.
# Env: CREW_SESSION (default harbormaster-crew-sandbox), CREW_DISPLAY (default 97).
set -euo pipefail

[ $# -ge 2 ] || { sed -n '2,35p' "$0" >&2; exit 2; }
S=$(mkdir -p "$1" && cd "$1" && pwd)
cmd=$2
shift 2
repo=$(cd "$(dirname "$0")/../.." && pwd)
session=${CREW_SESSION:-harbormaster-crew-sandbox}
num=${CREW_DISPLAY:-97}
app=crew-sandbox-app-$num

sandbox_env() {
  export HERDR_APP_HOME=$S/home HC_SESSION=$session HERDR_ORCHESTRATION_ROOT=$S/runs
  export DISPLAY=:$num XAUTHORITY=$S/Xauthority
  unset WAYLAND_DISPLAY
}

# XTest through ctypes: motion, then optionally a left click.
xtest() {
  python3 -I - "$@" <<'EOF'
import ctypes, sys, time
x11 = ctypes.CDLL("libX11.so.6"); xt = ctypes.CDLL("libXtst.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
d = x11.XOpenDisplay(None)
if not d: sys.exit("cannot open the sandbox display")
d = ctypes.c_void_p(d)
x, y, click = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3] == "click"
# Two moves, so the app sees the pointer arrive (hover) even when it was already near.
xt.XTestFakeMotionEvent(d, -1, x - 4, y - 1, 0); x11.XFlush(d); time.sleep(0.15)
xt.XTestFakeMotionEvent(d, -1, x, y, 0); x11.XFlush(d); time.sleep(0.3)
if click:
    xt.XTestFakeButtonEvent(d, 1, 1, 0); x11.XFlush(d); time.sleep(0.08)
    xt.XTestFakeButtonEvent(d, 1, 0, 0); x11.XFlush(d); time.sleep(0.2)
x11.XCloseDisplay(d)
EOF
}

make_runs() {
  sandbox_env
  local scripts=$repo/skills/herdr-app-orchestrator/scripts folder=$S/work/skills space
  mkdir -p "$folder" && git -C "$folder" init -q
  space=$(herdr-app do space.new --name "proof runs" --folder "$S/work" --argv '["sh","-c","echo fake orchestrator run-stats; exec sleep infinity"]' --focus false | jq -r .space)
  # branch status type topic started-UTC tasks t1-state t2-state [set-status args...]
  local first=1
  mkrun() {
    local branch=$1 status=$2 type=$3 topic=$4 started=$5 tasks=$6 s1=$7 s2=$8 out term tab d=$S/runs/skills/$1 f=${RUN_FOLDER:-$folder} state=${ORCH_STATE:-${CREW_ORCH_STATE:-}}
    shift 8
    if [ $first = 1 ]; then
      first=0
      term=$(hc ls --json | jq -r '.terminals[0].address')
    else
      # ORCH_STATE: what the fake orchestrator reports as its status (OSC 7501), e.g. working.
      out=$(herdr-app do tab.new --space "$space" --name "$branch" --argv "[\"sh\",\"$S/fake-orch.sh\",\"$branch\",\"$state\"]" --focus false)
      term=$(jq -r .terminal <<<"$out")
    fi
    tab=$(hc get "$term" --json | jq -r '.labels["herdr.tab"]')
    mkdir -p "$d/inbox" "$d/shared"
    jq -n --arg t "$term" --arg tab "$tab" --arg f "$f" --arg b "$branch" --arg s "$started" \
      '{terminal: $t, tab_id: $tab, folder: $f, branch: $b, kind: "claude", started: $s}' >"$d/orchestrator.json"
    echo "# $topic" >"$d/spec.md"
    printf 'Status: %s\nPrefix: `x`\n\n## Tasks\n\n### t1 build — %s\n- Proof: T1 — tests\n\n### t2 polish — %s\n- Proof: T1 — tests\n' "$status" "$s1" "$s2" >"$d/plan.md"
    HC_TERMINAL_ID=$term "$scripts/set-status.sh" "$d" "$status" --type "$type" --topic "$topic" --tasks "$tasks" "$@" >/dev/null
    hc label "$term" role=orchestrator >/dev/null
    echo "$branch: $term"
  }
  printf '%s\n' 'echo "fake orchestrator $1"' '[ -z "$2" ] || printf "\033]7501;state=%s\007" "$2"' \
    "[ \"\$1\" != two-prs ] || (while :; do [ -f \"$S/state-\$1\" ] && printf '\\033]7501;state=%s\\007' \"\$(cat \"$S/state-\$1\")\"; sleep 2; done) &" \
    'exec sleep infinity' >"$S/fake-orch.sh"
  local day; day=$(date -u +%Y-%m-%d)
  mkrun run-stats finished feat "Run stats" "${day}T08:10:00Z" 2/2 merged merged --progress "PR #42 up" \
    --pr dlebech/skills https://github.com/dlebech/skills/pull/42
  mkrun pane-follows finished feat "Pane follows" "${day}T06:40:00Z" 2/2 merged merged --progress "PRs up" \
    --pr dlebech/skills https://github.com/dlebech/skills/pull/41 --related dlebech/skills https://github.com/dlebech/skills/pull/40
  mkrun unreadable-pr finished fix "Unreadable PR" "${day}T09:05:00Z" 2/2 merged merged --progress "PR #1 up" \
    --pr dlebech/no-such-repo-nyo https://github.com/dlebech/no-such-repo-nyo/pull/1
  mkrun quiet-run running feat "Quiet run" "${day}T10:30:00Z" 1/2 merged implementing --progress "t2 implementing"
  ORCH_STATE=working mkrun busy-run running feat "Busy run" "${day}T07:00:00Z" 0/2 implementing implementing --progress "both tasks under way"
  # Dated back, so the first sight of its tasks (seeded by status.json's updated) shows an age.
  local sj=$S/runs/skills/busy-run/status.json
  jq --arg u "$(date -u -d '75 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" '.updated = $u' "$sj" >"$sj.tmp" && mv "$sj.tmp" "$sj"
  mkdir -p "$S/work/snevagten" && git -C "$S/work/snevagten" init -q
  RUN_FOLDER=$S/work/snevagten mkrun review-wait finished fix "Review wait" "${day}T05:00:00Z" 2/2 merged merged --progress "PR up for review" \
    --pr cli/cli https://github.com/cli/cli/pull/14846
  mkdir -p "$S/runs/skills/asks-you"
  printf '# Which database should t2 use?\n\n## Question\nPostgres or SQLite?\n\n## Options\n1. Postgres\n2. SQLite\n\n## Recommended\n1, it is what production runs.\n' >"$S/runs/skills/asks-you/question.md"
  mkrun asks-you "waiting for user: which database?" feat "Asks you" "${day}T09:40:00Z" 1/2 merged planned --progress "t2 waits on a choice"
  mkrun gone-run running feat "Gone run" "${day}T04:00:00Z" 1/2 merged implementing --progress "t2 implementing"
  hc kill "$(jq -r .terminal "$S/runs/skills/gone-run/orchestrator.json")" >/dev/null
  # Toasts and decisions new since you looked: a working run with three decisions. Later, by
  # hand, append "- [decided] …" lines to its decisions.md (new since you looked), and write its
  # question.md and set-status.sh "waiting for user: …" (a toast a minute later).
  mkrun toast-run running feat "Toast run" "${day}T07:15:00Z" 1/2 merged implementing --progress "t2 implementing"
  printf -- '- [decided] %sT07:20:00Z Layout: one column — the sidebar is narrow\n- [decided] %sT07:40:00Z Tests: node runner — no dependencies\n- [user] %sT07:55:00Z Colours: theme only — the user asked\n' "$day" "$day" "$day" >"$S/runs/skills/toast-run/decisions.md"
  # Parked runs: one with an open PR (a public one), one with a merged PR; out of the Crew.
  local parked
  mkrun parked-open finished feat "Parked open" "${day}T05:00:00Z" 2/2 merged merged --progress "PR up, waiting on QA" \
    --pr cli/cli https://github.com/cli/cli/pull/14927
  parked=$(jq -r .terminal "$S/runs/skills/parked-open/orchestrator.json")
  printf '%s\tfinished\n' "$(date -u -d '3 days ago' +%Y-%m-%dT%H:%M:%SZ)" >"$S/runs/skills/parked-open/parked"
  hc label "$parked" role= >/dev/null
  mkrun parked-merged finished fix "Parked merged" "${day}T04:00:00Z" 2/2 merged merged --progress "PR merged" \
    --pr dlebech/skills https://github.com/dlebech/skills/pull/42
  parked=$(jq -r .terminal "$S/runs/skills/parked-merged/orchestrator.json")
  printf '%s\tfinished\n' "$(date -u -d '5 days ago' +%Y-%m-%dT%H:%M:%SZ)" >"$S/runs/skills/parked-merged/parked"
  hc label "$parked" role= >/dev/null
  RUN_FOLDER=$S/work/snevagten mkrun two-prs running feat "Two PRs" "${day}T04:00:00Z" 2/2 merged merged --progress "PRs approved" \
    --pr fake-two/api https://github.com/fake-two/api/pull/1799 --pr fake-two/web https://github.com/fake-two/web/pull/1372
  RUN_FOLDER=$S/work/snevagten mkrun approved-merge finished feat "Approved merge" "${day}T07:00:00Z" 2/2 merged merged --progress "PRs approved" \
    --pr snevagten/snelogin https://github.com/snevagten/snelogin/pull/1308 --pr snevagten/snelogin https://github.com/snevagten/snelogin/pull/1372
  RUN_FOLDER=$S/work/snevagten mkrun approved-plan-open running feat "Approved plan open" "${day}T07:10:00Z" 1/2 merged planned --progress "PR approved, t2 still to do" \
    --pr fake-two/api https://github.com/fake-two/api/pull/44
  mkrun red-ci finished fix "Red CI" "${day}T07:30:00Z" 2/2 merged merged --progress "PR up, CI red" \
    --pr cli/cli https://github.com/cli/cli/pull/14927
  mkrun review-proof finished feat "Review proof" "${day}T08:00:00Z" 2/2 merged merged --progress "PR up with proof" \
    --pr dlebech/wapi-beatbox https://github.com/dlebech/wapi-beatbox/pull/1
  printf '# Proof: review-proof\nTier: T2\n\n## t1 build\nTier: T1\nChecked: tests\nResult: pass — 12 tests\n\n## t2 polish\nTier: T1\nChecked: tests\nResult: fail — 1 of 9 fails\n' >"$S/runs/skills/review-proof/proof.md"
  mkrun report-run finished rev "Report run" "${day}T05:00:00Z" 2/2 merged merged --progress "review written"
  printf '# Review report\n\nAll good.\n' >"$S/runs/skills/report-run/shared/final-report.md"
  printf '# t1 report\n\nA task'"'"'s own report: never the run'"'"'s.\n' >"$S/runs/skills/report-run/shared/t1-report.md"
  mkrun asks-question running feat "Asks question" "${day}T09:30:00Z" 1/2 merged implementing --progress "waiting on a decision"
  cat >"$S/runs/skills/asks-question/question.md" <<'Q'
# Which groups should Crew use instead of "Everything else"?

## Question
"Everything else" says nothing about what the runs in it are doing.

## Options
1. **Working / Waiting on others**: split by whether a person is awaited
2. **Keep it**: no change

## Recommended
Working / Waiting on others: split by whether a person is awaited

## Evidence
The user's feedback 3 tonight.

## Risk
Low; labels only.

## Blocks
t4 shots, t5 docs
Q
  mkrun asks-and-pr running feat "Asks and PR" "${day}T09:20:00Z" 2/2 merged merged --progress "waiting on a decision" \
    --pr dlebech/wapi-beatbox https://github.com/dlebech/wapi-beatbox/pull/1
  cp "$S/runs/skills/review-proof/proof.md" "$S/runs/skills/asks-and-pr/proof.md"
  cp "$S/runs/skills/asks-question/question.md" "$S/runs/skills/asks-and-pr/question.md"
  mkrun plan-open running feat "Plan open" "${day}T09:10:00Z" 1/3 merged implementing --progress "t2 implementing" \
    --pr dlebech/wapi-beatbox https://github.com/dlebech/wapi-beatbox/pull/1
}

case $cmd in
  up)
    mkdir -p "$S/bin" && cp "$(dirname "$0")/fake-gh.sh" "$S/bin/gh" && sed -i 's|\$REAL_GH|'"$(command -v gh)"'|' "$S/bin/gh"
    [ ! -e "$S/runs" ] || { echo "crew-sandbox: $S/runs exists; run down and remove it, or use a new dir" >&2; exit 1; }
    mkdir -p "$S/home" "$S/runs"
    for f in layouts themes settings.json keys.json; do
      [ ! -e "$HOME/.config/herdr-app/$f" ] || cp -r "$HOME/.config/herdr-app/$f" "$S/home/"
    done
    # The app runs in the caller's hc session (a background job like any other); the
    # sandbox's terminals live in their own session, so they never show in the user's lists.
    hc run --bg --name "$app" --cwd "$S" env -u WAYLAND_DISPLAY PATH="$S/bin:$PATH" HERDR_APP_HOME="$S/home" HC_SESSION="$session" \
      HERDR_ORCHESTRATION_ROOT="$S/runs" \
      xvfb-run -n "$num" -f "$S/Xauthority" -s "-screen 0 1600x1000x24" herdr-app >/dev/null
    sandbox_env
    for _ in $(seq 30); do herdr-app status >/dev/null 2>&1 && break; sleep 1; done
    herdr-app status >/dev/null || { echo "crew-sandbox: the app did not start" >&2; exit 1; }
    # The user's own mods that the copied layouts name (shipped ones the app has put there itself).
    for m in $(jq -r '[.. | objects | .content.mod? // empty] | unique[]' "$S"/home/layouts/*.json 2>/dev/null | sort -u); do
      [ "$m" = harbormaster ] || [ -e "$S/home/mods/$m" ] || [ ! -d "$HOME/.config/herdr-app/mods/$m" ] ||
        cp -r "$HOME/.config/herdr-app/mods/$m" "$S/home/mods/"
    done
    "$repo/herdr-app/install.sh" >/dev/null
    herdr-app do layout.switch '{"name":"harbormaster-main"}' >/dev/null
    make_runs
    sleep 2
    # The first-run welcome frame: close it with its ×.
    if herdr-app status | jq -e '.overlays | index("frame-welcome")' >/dev/null; then xtest 1107 227 click; fi
    herdr-app status | jq -c '{layout, overlays, errors}'
    ;;
  runs) make_runs ;;
  do) sandbox_env; herdr-app do "$@" ;;
  shot) sandbox_env; herdr-app shot "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" ;;
  root) sandbox_env; import -window root "$1" ;;
  click) sandbox_env; xtest "$1" "$2" click ;;
  hover) sandbox_env; xtest "$1" "$2" move ;;
  hc) sandbox_env; hc "$@" ;;
  env)
    echo "export HERDR_APP_HOME=$S/home HC_SESSION=$session HERDR_ORCHESTRATION_ROOT=$S/runs"
    echo "export DISPLAY=:$num XAUTHORITY=$S/Xauthority; unset WAYLAND_DISPLAY"
    ;;
  down)
    # Only what up started: the app's terminal (xvfb-run, Xvfb and the app end with it) and
    # the sandbox's own hc session.
    hc kill "$app" >/dev/null 2>&1 || true
    hc rm "$app" >/dev/null 2>&1 || true
    pkill -f "^Xvfb :$num .*-auth $S/Xauthority" 2>/dev/null || true
    # Its terminals first: a stopped core's holders keep them, and any later hc call in the
    # session starts the core again with them.
    for t in $(HC_SESSION=$session hc ls --json 2>/dev/null | jq -r '.terminals[].address'); do
      HC_SESSION=$session hc kill "$t" >/dev/null 2>&1 || true
      HC_SESSION=$session hc rm "$t" >/dev/null 2>&1 || true
    done
    HC_SESSION=$session hc server stop >/dev/null 2>&1 || true
    echo "stopped; $S is kept"
    ;;
  *) echo "crew-sandbox: unknown command $cmd" >&2; exit 2 ;;
esac
