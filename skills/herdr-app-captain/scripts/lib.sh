# Shared by runs.sh, watch-runs.sh and the captain (mark_run); source it, do not run it.
#
# The run-directory protocol (documented in herdr-app-orchestrator's
# references/run-files.md), as written by herdr-app-orchestrator's init-run.sh
# and set-status.sh. <folder> is the last part of the repository's path, or of the
# folder holding a run's several repositories; <branch> has "/" and the like as "-".
#   <root>/<folder>/<branch>/orchestrator.json  {"terminal", "tab_id", "folder", "branch"}
#   <root>/<folder>/<branch>/plan.md            first line "Status: <status>", where
#       <status> is running, "waiting for user: <question>", "blocked: <reason>",
#       or finished (the work is done and its PRs are up; the run stays open,
#       in runs.sh and the user's views, until its orchestrator's terminal is
#       gone: the user closed its tab)
#   <root>/<folder>/<branch>/status.json        {branch, folder, status, state, type, topic, progress,
#       tasks: {merged, planned}, issues: [url], prs: [{repo, url}] (the run's own),
#       related: [{repo, url}] (PRs it is about but did not open, such as the one a
#       review-only run reviews), waiting: [name], updated}, kept by set-status.sh, which also sets the terminal's run.status,
#       run.type, run.topic, progress, and run.prs labels
#   <root>/<folder>/<branch>/question.md        the orchestrator's open question to the user
#   <root>/<folder>/<branch>/inbox/             <UTC time>-<source>.message, from the captain, Harbormaster or the user
#   <root>/<folder>/<branch>/shared/            the run's agents' files; not the captain's
#   <root>/<folder>/<branch>/parked             the user set the run aside for now: its
#       orchestrator's tab was closed on purpose, to resume later
#   <root>/<folder>/<branch>/closed             the user closed the run for good, finished
#       or not
#       Both hold one line, "<time>\t<plan status then>", and are written by the
#       captain (mark_run) or Harbormaster on the user's word, or for closed, by the
#       orchestrator once it has cleaned up (its section 9); init-run.sh deletes both when an
#       orchestrator resumes the run. A finished run whose orchestrator's terminal
#       is gone is closed without a marker.
#   <root>/.captain-decisions.json              the captain's open decisions for the user,
#       [{id, question, run, asked, options, recommended, evidence, risk, blocks}] (the
#       last five optional), kept by decisions.sh; Harbormaster shows them

# The same default as herdr-app-orchestrator's scripts/init-run.sh.
root=${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}

# Prints each run's orchestrator.json path, under <root> or the given folder (a
# machine's copy from read_machines).
run_infos() {
  local info
  for info in "${1:-$root}"/*/*/orchestrator.json; do
    [ -e "$info" ] && echo "$info"
  done
}

# Runs on other machines. hc ls names their terminals "<machine>/<address>", and the
# captain names their run directories "<machine>:<directory>" (run_address), so one
# argument carries both; a run on this machine is its plain directory, as always.

# machines: "<name>\t<state>" for each machine in hc machine ls ("connected" when it
# can be read). CAPTAIN_MACHINES, when set, replaces the list with its names (space
# separated), all taken as connected; set it empty for this machine only, as tests do.
# Fails when hc does not answer.
machines() {
  local m list
  if [ -n "${CAPTAIN_MACHINES+set}" ]; then
    for m in $CAPTAIN_MACHINES; do printf '%s\tconnected\n' "$m"; done
    return 0
  fi
  list=$(hc machine ls --json 2>/dev/null) || return 1
  jq -r '.machines[]? | "\(.name)\t\(.state // "unknown")"' <<<"$list"
}

# What read_machines reads on each machine, in one sh script: its runs root, then
# each run file the captain's scripts read, as \036<path under the root>\037<text>.
# Only what they use: plan.md's Status line, the first line of each unhandled inbox
# message, and the rest capped. The root defaults there as here (init-run.sh's default).
REMOTE_RUNS_SCRIPT='root="${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}"
printf "%s" "$root"
cd "$root" 2>/dev/null || exit 0
for f in */*/orchestrator.json; do
  [ -e "$f" ] || continue
  d=${f%/orchestrator.json}
  for x in orchestrator.json status.json parked closed; do
    [ -e "$d/$x" ] && { printf "\036%s\037" "$d/$x"; head -c 60000 "$d/$x"; }
  done
  [ -e "$d/plan.md" ] && { printf "\036%s\037" "$d/plan.md"; head -n 1 "$d/plan.md"; }
  [ -e "$d/question.md" ] && { printf "\036%s\037" "$d/question.md"; head -c 4000 "$d/question.md"; }
  for m in "$d"/inbox/*.message; do
    [ -e "$m" ] && { printf "\036%s\037" "$m"; head -n 1 "$m"; }
  done
done
exit 0'

# read_machines <dest>: reads the runs of every connected machine, one hc exec each and
# all at once, as Harbormaster does, into <dest>/<machine>/, a copy laid out like a runs
# root with only what the captain's scripts read (REMOTE_RUNS_SCRIPT), so they read it
# as they read this machine's. Prints "<machine>\t<its root>" for each machine read, and
# "<machine>\t!<why>" for each that could not be (not connected, or hc exec failed).
# Fails, printing nothing, when hc machine ls does not answer.
read_machines() {
  local dest=$1 list name state why
  list=$(machines) || return 1
  while IFS=$'\t' read -r name state; do
    [ -n "$name" ] || continue
    if [ "$state" != connected ]; then
      printf '%s\t!%s\n' "$name" "$state" >"$dest/$name.result"
      continue
    fi
    (
      # CAPTAIN_MACHINES_ROOT, for tests, is the runs root to read on every machine instead.
      if hc exec --on "$name" --timeout 30 ${CAPTAIN_MACHINES_ROOT:+--env "HERDR_ORCHESTRATION_ROOT=$CAPTAIN_MACHINES_ROOT"} \
        sh -c "$REMOTE_RUNS_SCRIPT" >"$dest/$name.out" 2>"$dest/$name.err"; then
        unpack_runs "$dest/$name" <"$dest/$name.out" >"$dest/$name.result.tmp"
        printf '%s\t%s\n' "$name" "$(cat "$dest/$name.result.tmp")" >"$dest/$name.result"
      else
        # hc's own errors are JSON; anything else is shown as it is.
        why=$(jq -r '.error.message // empty' "$dest/$name.err" 2>/dev/null) || why=
        [ -n "$why" ] || why=$(tr '\n\t' '  ' <"$dest/$name.err" | sed 's/ *$//' | cut -c1-200)
        printf '%s\t!%s\n' "$name" "${why:-hc exec failed}" >"$dest/$name.result"
      fi
    ) &
  done <<<"$list"
  wait
  while IFS=$'\t' read -r name state; do
    [ -z "$name" ] || cat "$dest/$name.result"
  done <<<"$list"
}

# run_sources <dest>: where to read runs, one source per line,
# "<machine>\x1f<folder to read>\x1f<root there>": this machine's root first (no machine),
# then each other machine's copy under <dest> (read_machines). A machine that could not
# be read is "<machine>\x1f!<why>". Fails, after this machine's line, when hc machine ls
# does not answer.
run_sources() {
  local list m there
  printf '\x1f%s\x1f%s\n' "$root" "$root"
  list=$(read_machines "$1") || return 1
  while IFS=$'\t' read -r m there; do
    [ -z "$m" ] || case $there in
      !*) printf '%s\x1f%s\n' "$m" "$there" ;;
      *) printf '%s\x1f%s\x1f%s\n' "$m" "$1/$m" "$there" ;;
    esac
  done <<<"$list"
}

# unpack_runs <dir>: writes REMOTE_RUNS_SCRIPT's output (on stdin) out as files under
# <dir>, and prints the machine's root.
unpack_runs() {
  local root_there rec path
  mkdir -p "$1"
  IFS= read -r -d $'\036' root_there
  while IFS= read -r -d $'\036' rec || [ -n "$rec" ]; do
    path=${rec%%$'\037'*}
    # Only <folder>/<branch>/<file> and .../inbox/<file>, as the script writes them.
    case /$path/ in */../* | */./* | //*) continue ;; esac
    mkdir -p "$1/${path%/*}"
    printf '%s' "${rec#*$'\037'}" >"$1/$path"
  done
  printf '%s' "$root_there"
}

# run_address <machine> <directory>: how the captain names a run: its directory on this
# machine, "<machine>:<directory>" on another.
run_address() {
  if [ -n "$1" ]; then printf '%s:%s\n' "$1" "$2"; else printf '%s\n' "$2"; fi
}

# split_address <run address>: sets run_machine (empty for this machine) and run_dir.
split_address() {
  run_machine= run_dir=$1
  case $1 in
    /*) ;;
    *:/*)
      run_machine=${1%%:*}
      case $run_machine in */*) run_machine= ;; *) run_dir=${1#*:} ;; esac ;;
  esac
}

# on_machine <machine> <sh script> [args]: runs the script with sh on that machine
# (hc exec --on), or here when <machine> is empty; stdin goes to it either way.
on_machine() {
  local m=$1 script=$2
  shift 2
  if [ -z "$m" ]; then sh -c "$script" sh "$@"
  else hc exec --on "$m" -i sh -c "$script" sh "$@"
  fi
}

# run_facts <orchestrator.json>: branch, folder, terminal and tab id, separated by
# \x1f so empty ones survive: IFS=$'\x1f' read -r branch folder terminal tab
run_facts() {
  jq -r '[.branch // "?", .folder // .repo // "?", .terminal // "", .tab_id // ""] | join("\u001f")' "$1"
}

# plan_status <run-dir>: the plan's Status line without its prefix.
plan_status() {
  head -1 "$1/plan.md" 2>/dev/null | sed 's/^Status: *//'
}

# terminal_state <hc-ls-json> <address>: its status; "starting" for a live terminal
# that has not reported one; "lost" for one with no status and only a shell in its
# foreground, as herdr-core leaves an agent's terminal after a restart (hc keep
# replaces lost programs with a shell) or after the agent exited; empty when gone.
# hc ls lists live terminals only, and names the command a terminal started with, not
# what runs in it now, so the foreground comes from hc get.
terminal_state() {
  local state
  state=$(jq -r --arg t "$2" '.terminals[] | select(.address == $t) | .status // "starting"' <<<"$1" | head -1)
  if [ "$state" = starting ] && is_shell "$(hc get "$2" --json 2>/dev/null | jq -r '.foreground.name // empty')"; then
    state=lost
  fi
  echo "$state"
}

# is_shell <program name>: whether it is an interactive shell.
is_shell() {
  case ${1##*/} in
    bash | zsh | sh | dash | fish | nu | ksh | tcsh | csh | pwsh | powershell | cmd | -bash | -zsh) return 0 ;;
    *) return 1 ;;
  esac
}

# question_title <run-dir>: question.md's one-line summary: its "# " title, else its
# first non-empty line, on one line and cut to 100 characters. Empty without a question.
question_title() {
  [ -s "$1/question.md" ] || return 0
  awk 'NF { sub(/^# +/, ""); gsub(/[\t\r]+/, " "); print substr($0, 1, 100); exit }' "$1/question.md"
}

# unhandled_messages <run-dir>: one inbox message path per line.
unhandled_messages() {
  local f
  for f in "$1"/inbox/*.message; do
    [ -e "$f" ] && echo "$f"
  done
}

# answer_messages <run-dir>: the unhandled inbox messages that may answer a question, one
# path per line: all but level requests ("set autonomy to L2", "set proof tier to T3" as
# their first line, from Harbormaster's level tags), asks to prove ("prove t23 to T2: …",
# from its Proof rows), asks what is blocking ("what is blocking? …", from a stalled run's
# Crew row or pane) and asks to address review comments ("address comments on <PR url>: ask",
# from a run's card or pane; run-files.md), which answer nothing. Harbormaster's data.js
# (NOT_ANSWERS) uses the same pattern.
answer_messages() {
  local f
  unhandled_messages "$1" | while IFS= read -r f; do
    head -n 1 "$f" | grep -qE '^(set (autonomy|proof tier) to |prove [^ ]+( to T[0-3])?: |what is blocking\?|address comments on )' || echo "$f"
  done
}

# run_marker <run-dir>: "closed" or "parked" when the user put the run away (a
# closed marker wins), else nothing.
run_marker() {
  if [ -e "$1/closed" ]; then echo closed
  elif [ -e "$1/parked" ]; then echo parked
  fi
}

# away_state <run-dir> <plan-status> <terminal-state>: "closed" for a closed run (a
# closed marker, or finished with its terminal gone), "parked" for a parked one,
# else nothing. Pass a nonempty <terminal-state> when hc could not answer, so an
# unknown terminal never counts as gone.
away_state() {
  local marker
  marker=$(run_marker "$1")
  if [ -n "$marker" ]; then echo "$marker"
  elif [ "$2" = finished ] && [ -z "$3" ]; then echo closed
  fi
}

# mark_run <run address> parked|closed: writes the marker, "<time>\t<plan status>",
# atomically, on the run's machine. Harbormaster's data.js writes the same line on its own.
mark_run() {
  local run_machine run_dir
  split_address "$1"
  case $2 in parked | closed) ;; *) echo "mark_run: parked or closed, not '$2'" >&2; return 2 ;; esac
  on_machine "$run_machine" '{ date -u +%Y-%m-%dT%H:%M:%SZ | tr -d "\n"; printf "\t"; head -1 "$1/plan.md" 2>/dev/null | sed "s/^Status: *//"; } >"$1/.$2.tmp" &&
    mv "$1/.$2.tmp" "$1/$2"' "$run_dir" "$2" </dev/null
}

# integration_spaces <folder> <branch>: the id of each space that shows one of the
# run's integration worktrees (a linked worktree with <branch> checked out, in <folder>
# or a repository in it), matched as herdr-app-orchestrator's integration-worktree.sh
# does: its first terminal's folder now, else the folder it was made in. Only a space
# made on a worktree (or with no folder of its own) counts, so a repository's own space
# whose first terminal was cd'd into a worktree is left alone. One per line.
integration_spaces() {
  local r paths=() id made first at p
  for r in "$1" "$1"/*/; do
    [ -e "$r/.git" ] || continue
    while IFS= read -r p; do paths+=("$p"); done < <(git -C "$r" worktree list --porcelain 2>/dev/null |
      awk -v b="branch refs/heads/$2" '/^worktree /{p=substr($0,10); n++} $0==b && n>1{print p}')
  done
  [ ${#paths[@]} -gt 0 ] || return 0
  # in_worktree <dir>: whether it is one of the worktrees or under one.
  in_worktree() {
    for p in "${paths[@]}"; do
      case $1 in "$p" | "$p"/*) return 0 ;; esac
    done
    return 1
  }
  while IFS=$'\t' read -r id made first; do
    [ -z "$made" ] || in_worktree "$made" || continue
    at=
    [ -z "$first" ] || at=$(hc get "$first" --json 2>/dev/null | jq -r '.foreground.cwd // .cwd // empty')
    at=${at:-$made}
    [ -z "$at" ] || ! in_worktree "$at" || echo "$id"
  done < <(herdr-app ls 2>/dev/null | jq -r '.spaces[] | select(.machine == null)
    | [.id, .folder // "", ([.tabs[].terminals[].terminal | select(.)] | first // "")] | @tsv')
}

# marker_text <file>: "<time> (was: <status>)" from a parked or closed marker.
marker_text() {
  awk -F '\t' 'NR == 1 { printf "%s (was: %s)", $1, ($2 == "" ? "?" : $2) }' "$1"
}
