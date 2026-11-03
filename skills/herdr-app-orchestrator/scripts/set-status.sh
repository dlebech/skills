#!/usr/bin/env bash
# Publish a run's facts: plan.md's Status line, status.json in the run directory,
# the orchestrator's tab name, and labels on its terminal.
#
# Usage: set-status.sh <run-directory> [<status>] [--progress TEXT] [--tasks MERGED/PLANNED]
#          [--issue URL]... [--pr REPO URL]... [--waiting "NAME..."]
#
# <status> is running, "waiting for user: <question>", "blocked: <reason>", or
# finished, the vocabulary herdr-app-captain's scripts/lib.sh documents. Without
# it, the status stays what plan.md says, and the rest is published again, as after
# a resume in a new terminal. The other facts are kept until changed:
#   --progress  one line on what is going on, e.g. "task 3/7 in review"; "" clears it
#   --tasks     tasks merged out of planned, e.g. 3/7
#   --issue     an issue the run works on; added once
#   --pr        a repository's PR, e.g. --pr acme/api https://github.com/acme/api/pull/9;
#               replaces that repository's earlier one
#   --waiting   the agents waiting for an answer, space-separated; "" clears them
#
# status.json: {branch, folder, status, state, progress, tasks: {merged, planned},
# issues: [url], prs: [{repo, url}], waiting: [name], updated}, where state is
# running, waiting, blocked, or finished. It outlives the terminal, so it is the
# record of a finished run. The labels, for live lists such as Herdr's Agents list:
# run.status (the state), progress, and run.prs (the PR URLs, space-separated).
# The tab becomes "🐙 <branch>", "🐙 ✋ <branch>" or "🐙 ✓ <branch>".
# plan.md and status.json are what count: a closed window, or an orchestrator with
# no tab, only prints a warning, since the run goes on without one.
set -u

usage() {
  echo 'usage: set-status.sh <run-directory> [<status>] [--progress TEXT] [--tasks M/N] [--issue URL]... [--pr REPO URL]... [--waiting "NAME..."]' >&2
  exit 2
}
[ $# -ge 1 ] || usage
dir=$1
shift
status=
if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then
  status=$1
  shift
fi
progress= progress_set= tasks= waiting= waiting_set= issues=() prs=()
while [ $# -gt 0 ]; do
  case $1 in
    --progress) [ $# -ge 2 ] || usage; progress=$2 progress_set=1; shift 2 ;;
    --tasks)
      [ $# -ge 2 ] && [[ $2 =~ ^[0-9]+/[0-9]+$ ]] || usage
      tasks=$2; shift 2 ;;
    --issue) [ $# -ge 2 ] || usage; issues+=("$2"); shift 2 ;;
    --pr) [ $# -ge 3 ] || usage; prs+=("$2" "$3"); shift 3 ;;
    --waiting) [ $# -ge 2 ] || usage; waiting=$2 waiting_set=1; shift 2 ;;
    *) usage ;;
  esac
done

if [ -n "$status" ]; then
  tmp=$dir/.plan.tmp
  { echo "Status: $status"; tail -n +2 "$dir/plan.md"; } >"$tmp" && mv "$tmp" "$dir/plan.md" || exit 1
else
  status=$(head -1 "$dir/plan.md" | sed 's/^Status: *//') || exit 1
  [ -n "$status" ] || { echo "no Status line in $dir/plan.md" >&2; exit 1; }
fi

IFS=$'\x1f' read -r branch folder terminal tab < <(jq -r \
  '[.branch, .folder // "", .terminal // "", .tab_id // ""] | join("\u001f")' \
  "$dir/orchestrator.json") && [ -n "$branch" ] || exit 1
case $status in
  "waiting for user"*) name="🐙 ✋ $branch" state=waiting ;;
  blocked*) name="🐙 ✋ $branch" state=blocked ;;
  finished) name="🐙 ✓ $branch" state=finished ;;
  *) name="🐙 $branch" state=running ;;
esac

old='{}'
[ -e "$dir/status.json" ] && old=$(cat "$dir/status.json")
issues_json=$(jq -cn '$ARGS.positional' --args ${issues[@]+"${issues[@]}"})
prs_json=$(jq -cn '$ARGS.positional as $a | [range(0; $a | length; 2) as $i | {repo: $a[$i], url: $a[$i + 1]}]' \
  --args ${prs[@]+"${prs[@]}"})
tmp=$dir/.status.tmp
jq -n --argjson old "$old" --argjson issues "$issues_json" --argjson prs "$prs_json" \
  --arg branch "$branch" --arg folder "$folder" --arg status "$status" --arg state "$state" \
  --arg progress "$progress" --arg progress_set "$progress_set" --arg tasks "$tasks" \
  --arg waiting "$waiting" --arg waiting_set "$waiting_set" --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  {progress: null, tasks: null, issues: [], prs: [], waiting: []} + $old
  | .branch = $branch | .folder = $folder | .status = $status | .state = $state | .updated = $updated
  | if $progress_set != "" then .progress = (if $progress == "" then null else $progress end) else . end
  | if $tasks != "" then .tasks = ($tasks | split("/") | {merged: (.[0] | tonumber), planned: (.[1] | tonumber)}) else . end
  | .issues = reduce $issues[] as $u (.issues; if index([$u]) then . else . + [$u] end)
  | .prs = reduce $prs[] as $p (.prs;
      if any(.[]; .repo == $p.repo) then map(if .repo == $p.repo then $p else . end) else . + [$p] end)
  | if $waiting_set != "" then .waiting = ($waiting | split(" ") | map(select(. != ""))) else . end
  | {branch, folder, status, state, progress, tasks, issues, prs, waiting, updated}
  ' >"$tmp" && mv "$tmp" "$dir/status.json" || exit 1

# A label change is an hc event, which wakes herdr-app-captain's watcher at once.
if [ -n "$terminal" ]; then
  labels=$(jq -r '"run.status=\(.state)", "progress=\(.progress // "")", "run.prs=\([.prs[].url] | join(" "))"' \
    "$dir/status.json")
  mapfile -t labels <<<"$labels"
  hc label "$terminal" "${labels[@]}" >/dev/null 2>&1 ||
    echo "warning: could not label terminal $terminal" >&2
fi
if [ -n "$tab" ]; then
  herdr-app do tab.rename --id "$tab" --name "$name" >/dev/null 2>&1 ||
    echo "warning: could not rename tab $tab (is the Herdr window open?)" >&2
fi
exit 0
