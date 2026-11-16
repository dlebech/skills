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
# Hide a run from the Crew with `hc label <t> role=` and bring it back with role=orchestrator.
#
# Needs xvfb-run, ImageMagick's import (root only), jq, gh, python3 and libXtst. The window lands
# at screen offset (162, 90) on the 1600x1000 screen; add that to a shot's coordinates for click.
# Env: CREW_SESSION (default harbormaster-crew-sandbox), CREW_DISPLAY (default 97).
set -euo pipefail

[ $# -ge 2 ] || { sed -n '2,32p' "$0" >&2; exit 2; }
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
    local branch=$1 status=$2 type=$3 topic=$4 started=$5 tasks=$6 s1=$7 s2=$8 out term tab d=$S/runs/skills/$1
    shift 8
    if [ $first = 1 ]; then
      first=0
      term=$(hc ls --json | jq -r '.terminals[0].address')
    else
      out=$(herdr-app do tab.new --space "$space" --name "$branch" --argv "[\"sh\",\"-c\",\"echo fake orchestrator $branch; exec sleep infinity\"]" --focus false)
      term=$(jq -r .terminal <<<"$out")
    fi
    tab=$(hc get "$term" --json | jq -r '.labels["herdr.tab"]')
    mkdir -p "$d/inbox" "$d/shared"
    jq -n --arg t "$term" --arg tab "$tab" --arg f "$folder" --arg b "$branch" --arg s "$started" \
      '{terminal: $t, tab_id: $tab, folder: $f, branch: $b, kind: "claude", started: $s}' >"$d/orchestrator.json"
    echo "# $topic" >"$d/spec.md"
    printf 'Status: %s\nPrefix: `x`\n\n## Tasks\n\n### t1 build — %s\n- Proof: T1 — tests\n\n### t2 polish — %s\n- Proof: T1 — tests\n' "$status" "$s1" "$s2" >"$d/plan.md"
    HC_TERMINAL_ID=$term "$scripts/set-status.sh" "$d" "$status" --type "$type" --topic "$topic" --tasks "$tasks" "$@" >/dev/null
    hc label "$term" role=orchestrator >/dev/null
    echo "$branch: $term"
  }
  local day; day=$(date -u +%Y-%m-%d)
  mkrun run-stats finished feat "Run stats" "${day}T08:10:00Z" 2/2 merged merged --progress "PR #42 up" \
    --pr dlebech/skills https://github.com/dlebech/skills/pull/42
  mkrun pane-follows finished feat "Pane follows" "${day}T06:40:00Z" 2/2 merged merged --progress "PRs up" \
    --pr dlebech/skills https://github.com/dlebech/skills/pull/41 --related dlebech/skills https://github.com/dlebech/skills/pull/40
  mkrun unreadable-pr finished fix "Unreadable PR" "${day}T09:05:00Z" 2/2 merged merged --progress "PR #1 up" \
    --pr dlebech/no-such-repo-nyo https://github.com/dlebech/no-such-repo-nyo/pull/1
  mkrun quiet-run running feat "Quiet run" "${day}T10:30:00Z" 1/2 merged implementing --progress "t2 implementing"
}

case $cmd in
  up)
    [ ! -e "$S/runs" ] || { echo "crew-sandbox: $S/runs exists; run down and remove it, or use a new dir" >&2; exit 1; }
    mkdir -p "$S/home" "$S/runs"
    for f in layouts themes settings.json keys.json; do
      [ ! -e "$HOME/.config/herdr-app/$f" ] || cp -r "$HOME/.config/herdr-app/$f" "$S/home/"
    done
    # The app runs in the caller's hc session (a background job like any other); the
    # sandbox's terminals live in their own session, so they never show in the user's lists.
    hc run --bg --name "$app" --cwd "$S" env -u WAYLAND_DISPLAY HERDR_APP_HOME="$S/home" HC_SESSION="$session" \
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
