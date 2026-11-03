# Shared by runs.sh and watch-runs.sh; source it, do not run it.
#
# The run-directory protocol, as written by herdr-app-orchestrator:
#   <root>/<repo>/<branch>/orchestrator.json  {"terminal", "tab_id", "repo", "branch"}
#   <root>/<repo>/<branch>/plan.md            first line "Status: <status>"
#   <root>/<repo>/<branch>/question.md        the orchestrator's open question to the user
#   <root>/<repo>/<branch>/inbox/             <name>.message, from the captain

root=${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}

# Prints each run's orchestrator.json path.
run_infos() {
  local info
  for info in "$root"/*/*/orchestrator.json; do
    [ -e "$info" ] && echo "$info"
  done
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
