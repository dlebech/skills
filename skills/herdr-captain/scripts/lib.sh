# Shared by runs.sh and watch-runs.sh; source it, do not run it.
#
# The run-directory protocol, as written by herdr-orchestrator:
#   <root>/<repo>/<branch>/orchestrator.json  {"pane_id", "tab_id", "repo", "branch"}
#   <root>/<repo>/<branch>/plan.md            first line "Status: <status>"
#   <root>/<repo>/<branch>/inbox/             <name>.message, from the captain
#   <root>/<repo>/<branch>/shared/status/     sub-agents' markers, see MARKER_SUFFIXES

root=$HOME/.herdr/orchestration
MARKER_SUFFIXES="done question failed"

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

# pane_state <agent-list-json> <pane-id>: the pane's agent status; empty when gone.
pane_state() {
  jq -r --arg p "$2" '.result.agents[] | select(.pane_id == $p) | .agent_status' <<<"$1" | head -1
}

# unhandled_markers <run-dir>: one marker path per line.
unhandled_markers() {
  local s f
  for s in $MARKER_SUFFIXES; do
    for f in "$1"/shared/status/*."$s"; do
      [ -e "$f" ] && echo "$f"
    done
  done
  for f in "$1"/inbox/*.message; do
    [ -e "$f" ] && echo "$f"
  done
}

# mtime <file>: modification time in epoch seconds (GNU or BSD stat); fails if gone.
mtime() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null
}
