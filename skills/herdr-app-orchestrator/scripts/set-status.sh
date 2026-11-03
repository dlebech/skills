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
# a resume in a new terminal. "waiting for user" goes with a question.md in the run
# directory; without one it warns. finished means the work is done and its PRs are
# up; the run stays open until the orchestrator's tab is closed.
# The other facts are kept until changed:
#   --progress  one line on what is going on, e.g. "task 3/7 in review"; "" clears it
#   --tasks     tasks merged out of planned, e.g. 3/7
#   --issue     an issue the run works on; added once
#   --pr        a repository's PR, e.g. --pr acme/api https://github.com/acme/api/pull/9;
#               replaces that repository's earlier one
#   --waiting   every agent now waiting for an answer, space-separated, replacing
#               the earlier list; "" clears it
#
# status.json: {branch, folder, status, state, progress, tasks: {merged, planned},
# issues: [url], prs: [{repo, url}], waiting: [name], updated}, where state is
# running, waiting, blocked, or finished. It outlives the terminal, so it is the
# record of a finished run. The labels, for live lists such as Herdr's Agents list:
# run.status (the state), progress, and run.prs (the PR URLs, space-separated).
# The tab becomes "🐙 <branch>", "🐙 ✋ <branch>" or "🐙 ✓ <branch>".
# plan.md and status.json are what count: a closed window, or an orchestrator with
# no tab, only prints a warning, since the run goes on without one. An unreadable
# status.json fails the call before anything changes.
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
# One line each: a newline would split the labels apart.
case $status$progress in *$'\n'*) echo "status and --progress must be one line" >&2; exit 2 ;; esac

new_status=$status
case $status in
  "waiting for user"*)
    [ -e "$dir/question.md" ] ||
      echo "warning: \"waiting for user\" without $dir/question.md; write the question first, or finish if there is nothing to ask" >&2 ;;
esac
if [ -z "$status" ]; then
  status=$(sed -n '1s/^Status: *//p' "$dir/plan.md") || exit 1
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
if [ -e "$dir/status.json" ]; then
  old=$(jq -ce 'objects' "$dir/status.json" 2>/dev/null) ||
    { echo "$dir/status.json is not a JSON object; fix or remove it" >&2; exit 1; }
fi
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
  | if $waiting_set != "" then .waiting = [$waiting | splits("\\s+") | select(. != "")] else . end
  | {branch, folder, status, state, progress, tasks, issues, prs, waiting, updated}
  ' >"$tmp" || exit 1
# plan.md first: it is what counts, and status.json is only written once it changed.
if [ -n "$new_status" ]; then
  { echo "Status: $new_status"; tail -n +2 "$dir/plan.md"; } >"$dir/.plan.tmp" &&
    mv "$dir/.plan.tmp" "$dir/plan.md" || { rm -f "$tmp"; exit 1; }
fi
mv "$tmp" "$dir/status.json" || exit 1

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
