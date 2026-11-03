# Shared by runs.sh and watch-runs.sh; source it, do not run it.
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
#       tasks: {merged, planned}, issues: [url], prs: [{repo, url}], waiting: [name],
#       updated}, kept by set-status.sh, which also sets the terminal's run.status,
#       progress, and run.prs labels
#   <root>/<folder>/<branch>/question.md        the orchestrator's open question to the user
#   <root>/<folder>/<branch>/inbox/             <name>.message, from the captain
#   <root>/<folder>/<branch>/shared/            the run's agents' files; not the captain's

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
# that has not reported one; empty when gone. hc ls lists live terminals only.
terminal_state() {
  jq -r --arg t "$2" '.terminals[] | select(.address == $t) | .status // "starting"' <<<"$1" | head -1
}

# unhandled_messages <run-dir>: one inbox message path per line.
unhandled_messages() {
  local f
  for f in "$1"/inbox/*.message; do
    [ -e "$f" ] && echo "$f"
  done
}
