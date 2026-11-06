# Shared by runs.sh, watch-runs.sh and the captain (mark_run); source it, do not run it.
#
# The run-directory protocol, as written by herdr-app-orchestrator's init-run.sh
# and set-status.sh. <folder> is the last part of the repository's path, or of the
# folder holding a run's several repositories; <branch> has "/" and the like as "-".
#   <root>/<folder>/<branch>/orchestrator.json  {"terminal", "tab_id", "folder", "branch"}
#   <root>/<folder>/<branch>/plan.md            first line "Status: <status>", where
#       <status> is running, "waiting for user: <question>", "blocked: <reason>",
#       or finished (the work is done and its PRs are up; the run stays open,
#       in runs.sh and the user's views, until its orchestrator's terminal is
#       gone: the user closed its tab)
#   <root>/<folder>/<branch>/status.json        {branch, folder, status, state, progress,
#       tasks: {merged, planned}, issues: [url], prs: [{repo, url}] (the run's own),
#       related: [{repo, url}] (PRs it is about but did not open, such as the one a
#       review-only run reviews), waiting: [name], updated}, kept by set-status.sh, which also sets the terminal's run.status,
#       progress, and run.prs labels
#   <root>/<folder>/<branch>/question.md        the orchestrator's open question to the user
#   <root>/<folder>/<branch>/inbox/             <name>.message, from the captain
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
#       [{id, question, run, asked}], kept by decisions.sh; Harbormaster shows them

# The same default as herdr-app-orchestrator's scripts/init-run.sh.
root=${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}

# Prints each run's orchestrator.json path.
run_infos() {
  local info
  for info in "$root"/*/*/orchestrator.json; do
    [ -e "$info" ] && echo "$info"
  done
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

# unhandled_messages <run-dir>: one inbox message path per line.
unhandled_messages() {
  local f
  for f in "$1"/inbox/*.message; do
    [ -e "$f" ] && echo "$f"
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

# mark_run <run-dir> parked|closed: writes the marker, "<time>\t<plan status>",
# atomically. Harbormaster's data.js writes the same line on its own.
mark_run() {
  { date -u +%Y-%m-%dT%H:%M:%SZ | tr -d '\n'; printf '\t'; plan_status "$1"; } >"$1/.$2.tmp" &&
    mv "$1/.$2.tmp" "$1/$2"
}

# integration_spaces <folder> <branch>: the id of each space that shows one of the
# run's integration worktrees (a linked worktree with <branch> checked out, in <folder>
# or a repository in it), matched as herdr-app-orchestrator's integration-worktree.sh
# does: its first terminal's folder now, else the folder it was made in. One per line.
integration_spaces() {
  local r paths=() id made first at p
  for r in "$1" "$1"/*/; do
    [ -e "$r/.git" ] || continue
    while IFS= read -r p; do paths+=("$p"); done < <(git -C "$r" worktree list --porcelain 2>/dev/null |
      awk -v b="branch refs/heads/$2" '/^worktree /{p=substr($0,10); n++} $0==b && n>1{print p}')
  done
  [ ${#paths[@]} -gt 0 ] || return 0
  while IFS=$'\t' read -r id made first; do
    at=
    [ -z "$first" ] || at=$(hc get "$first" --json 2>/dev/null | jq -r '.foreground.cwd // .cwd // empty')
    at=${at:-$made}
    for p in "${paths[@]}"; do
      case $at in "$p" | "$p"/*) echo "$id"; break ;; esac
    done
  done < <(herdr-app ls 2>/dev/null | jq -r '.spaces[] | select(.machine == null)
    | [.id, .folder // "", ([.tabs[].terminals[].terminal | select(.)] | first // "")] | @tsv')
}

# marker_text <file>: "<time> (was: <status>)" from a parked or closed marker.
marker_text() {
  awk -F '\t' 'NR == 1 { printf "%s (was: %s)", $1, ($2 == "" ? "?" : $2) }' "$1"
}
