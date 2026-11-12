#!/usr/bin/env bash
# Publish a run's facts: plan.md's Status line, status.json in the run directory,
# the orchestrator's tab name, and labels on its terminal.
#
# Usage: set-status.sh <run-directory> [<status>] [--type TYPE] [--topic TEXT] [--progress TEXT] [--tasks MERGED/PLANNED]
#          [--issue URL]... [--pr REPO URL]... [--related REPO URL]... [--waiting "NAME..."]
#
# <status> is running, "waiting for user: <question>", "blocked: <reason>", or
# finished, the vocabulary herdr-app-captain's scripts/lib.sh documents. Without
# it, the status stays what plan.md says, and the rest is published again, as after
# a resume in a new terminal. "waiting for user" goes with a question.md in the run
# directory; without one it is refused (exit 2) and nothing changes: a warning was
# ignored once and left a run waiting with nothing to answer, while writing
# question.md first is cheap. finished means the work is done and its PRs are up;
# the run stays open until the orchestrator's tab is closed.
# The other facts are kept until changed:
#   --type      what kind of run it is: feat (build something), fix (a bug), rev (review
#               work the run did not write) or expl (explore, investigate); the tab and
#               Harbormaster show it before the topic; "" clears it
#   --topic     what the run is about, in 1-3 words of at most 16 characters, e.g. "Road routes";
#               Harbormaster's Crew block shows it beside the issue or PR number;
#               "" clears it
#   --progress  one line on what is going on, e.g. "task 3/7 in review"; "" clears it
#   --tasks     tasks merged out of planned, e.g. 3/7
#   --issue     an issue the run works on; added once
#   --pr        a repository's PR, e.g. --pr acme/api https://github.com/acme/api/pull/9;
#               replaces that repository's earlier one
#   --related   a PR the run is about but did not open, such as the PR a review-only
#               run reviews, or one the run depends on; added once
#   --waiting   every agent now waiting for an answer, space-separated, replacing
#               the earlier list; "" clears it
#
# status.json: {branch, folder, status, state, type, topic, progress, tasks: {merged, planned},
# issues: [url], prs: [{repo, url}], related: [{repo, url}], waiting: [name], updated}, where state is
# running, waiting, blocked, or finished. It outlives the terminal, so it is the
# record of a finished run. The labels, for live lists such as Herdr's Agents list:
# run.status (the state), run.type, run.topic, progress, and run.prs (the PR URLs, space-separated).
# The tab becomes "🐙 <name>", "🐙 ✋ <name>" or "🐙 ✓ <name>", where <name> is
# "<type> · <topic>", with the branch for a missing topic and no type part without one,
# e.g. "🐙 rev · Triage decision", as Harbormaster's orchestratorTabName() names it.
# plan.md and status.json are what count: a closed window, a window on another
# computer (where Harbormaster renames the tab from plan.md and status.json), or an orchestrator with
# no tab, only prints a warning, since the run goes on without one. An unreadable
# status.json fails the call before anything changes.
set -u

usage() {
  echo 'usage: set-status.sh <run-directory> [<status>] [--type feat|fix|rev|expl] [--topic TEXT] [--progress TEXT] [--tasks M/N] [--issue URL]... [--pr REPO URL]... [--related REPO URL]... [--waiting "NAME..."]' >&2
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
type= type_set= topic= topic_set= progress= progress_set= tasks= waiting= waiting_set= issues=() prs=() related=()
while [ $# -gt 0 ]; do
  case $1 in
    --type)
      [ $# -ge 2 ] || usage
      case $2 in feat | fix | rev | expl | '') ;; *) echo "--type is feat, fix, rev or expl, not: $2" >&2; exit 2 ;; esac
      type=$2 type_set=1; shift 2 ;;
    --topic) [ $# -ge 2 ] || usage; topic=$2 topic_set=1; shift 2 ;;
    --progress) [ $# -ge 2 ] || usage; progress=$2 progress_set=1; shift 2 ;;
    --tasks)
      [ $# -ge 2 ] && [[ $2 =~ ^[0-9]+/[0-9]+$ ]] || usage
      tasks=$2; shift 2 ;;
    --issue) [ $# -ge 2 ] || usage; issues+=("$2"); shift 2 ;;
    --pr) [ $# -ge 3 ] || usage; prs+=("$2" "$3"); shift 3 ;;
    --related) [ $# -ge 3 ] || usage; related+=("$2" "$3"); shift 3 ;;
    --waiting) [ $# -ge 2 ] || usage; waiting=$2 waiting_set=1; shift 2 ;;
    *) usage ;;
  esac
done
# One line each: a newline would split the labels apart.
case $status$topic$progress in *$'\n'*) echo "status, --topic and --progress must be one line" >&2; exit 2 ;; esac

new_status=$status
case $status in
  "waiting for user"*)
    [ -e "$dir/question.md" ] || {
      echo "refused: \"waiting for user\" needs $dir/question.md; write the question first, or finish if there is nothing to ask" >&2
      exit 2
    } ;;
esac
if [ -z "$status" ]; then
  status=$(sed -n '1s/^Status: *//p' "$dir/plan.md") || exit 1
  [ -n "$status" ] || { echo "no Status line in $dir/plan.md" >&2; exit 1; }
fi

IFS=$'\x1f' read -r branch folder terminal tab < <(jq -r \
  '[.branch, .folder // "", .terminal // "", .tab_id // ""] | join("\u001f")' \
  "$dir/orchestrator.json") && [ -n "$branch" ] || exit 1
case $status in
  "waiting for user"*) mark="✋ " state=waiting ;;
  blocked*) mark="✋ " state=blocked ;;
  finished) mark="✓ " state=finished ;;
  *) mark= state=running ;;
esac

old='{}'
if [ -e "$dir/status.json" ]; then
  old=$(jq -ce 'objects' "$dir/status.json" 2>/dev/null) ||
    { echo "$dir/status.json is not a JSON object; fix or remove it" >&2; exit 1; }
fi
issues_json=$(jq -cn '$ARGS.positional' --args ${issues[@]+"${issues[@]}"})
pairs='$ARGS.positional as $a | [range(0; $a | length; 2) as $i | {repo: $a[$i], url: $a[$i + 1]}]'
prs_json=$(jq -cn "$pairs" --args ${prs[@]+"${prs[@]}"})
related_json=$(jq -cn "$pairs" --args ${related[@]+"${related[@]}"})
tmp=$dir/.status.tmp
jq -n --argjson old "$old" --argjson issues "$issues_json" --argjson prs "$prs_json" --argjson related "$related_json" \
  --arg branch "$branch" --arg folder "$folder" --arg status "$status" --arg state "$state" \
  --arg type "$type" --arg type_set "$type_set" --arg topic "$topic" --arg topic_set "$topic_set" --arg progress "$progress" --arg progress_set "$progress_set" --arg tasks "$tasks" \
  --arg waiting "$waiting" --arg waiting_set "$waiting_set" --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  {type: null, topic: null, progress: null, tasks: null, issues: [], prs: [], related: [], waiting: []} + $old
  | .branch = $branch | .folder = $folder | .status = $status | .state = $state | .updated = $updated
  | if $type_set != "" then .type = (if $type == "" then null else $type end) else . end
  | if $topic_set != "" then .topic = (if $topic == "" then null else $topic end) else . end
  | if $progress_set != "" then .progress = (if $progress == "" then null else $progress end) else . end
  | if $tasks != "" then .tasks = ($tasks | split("/") | {merged: (.[0] | tonumber), planned: (.[1] | tonumber)}) else . end
  | .issues = reduce $issues[] as $u (.issues; if index([$u]) then . else . + [$u] end)
  | .prs = reduce $prs[] as $p (.prs;
      if any(.[]; .repo == $p.repo) then map(if .repo == $p.repo then $p else . end) else . + [$p] end)
  | .related = reduce $related[] as $p (.related; if any(.[]; .url == $p.url) then . else . + [$p] end)
  | if $waiting_set != "" then .waiting = [$waiting | splits("\\s+") | select(. != "")] else . end
  | {branch, folder, status, state, type, topic, progress, tasks, issues, prs, related, waiting, updated}
  ' >"$tmp" || exit 1
# plan.md first: it is what counts, and status.json is only written once it changed.
if [ -n "$new_status" ]; then
  { echo "Status: $new_status"; tail -n +2 "$dir/plan.md"; } >"$dir/.plan.tmp" &&
    mv "$dir/.plan.tmp" "$dir/plan.md" || { rm -f "$tmp"; exit 1; }
fi
mv "$tmp" "$dir/status.json" || exit 1

# A label change is an hc event, which wakes herdr-app-captain's watcher at once.
if [ -n "$terminal" ]; then
  labels=$(jq -r '"run.status=\(.state)", "run.type=\(.type // "")", "run.topic=\(.topic // "")", "progress=\(.progress // "")", "run.prs=\([.prs[].url] | join(" "))"' \
    "$dir/status.json")
  mapfile -t labels <<<"$labels"
  hc label "$terminal" "${labels[@]}" >/dev/null 2>&1 ||
    echo "warning: could not label terminal $terminal" >&2
fi
if [ -n "$tab" ]; then
  name="🐙 $mark$(jq -r '[.type // empty, .topic // .branch] | join(" · ")' "$dir/status.json")"
  herdr-app do tab.rename --id "$tab" --name "$name" >/dev/null 2>&1 ||
    echo "warning: could not rename tab $tab: no Herdr window on this computer; with the window on another computer, Harbormaster there renames it" >&2
fi
exit 0
