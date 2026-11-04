#!/usr/bin/env bash
# The captain's open decisions: what it asked the user and is still waiting on.
#
# Usage: decisions.sh add <id> [--run <run-directory>] <question>
#        decisions.sh done <id>...
#        decisions.sh ls
#
# Kept in <root>/.captain-decisions.json, an array of
#   {"id", "question", "run" (a run directory, or null), "asked" (UTC time)}
# oldest first, so Harbormaster's "Waiting on you" list can show them beside the
# runs' own question.md files, and they survive the back and forth that buries a
# question in the captain's tab. add rewords a decision with the same id in place,
# keeping its run unless --run gives another, and
# when it was first asked; done removes them (an unknown id is fine); ls prints one
# per line: "<id>\t<asked>\t<run or ->\t<question>". Writes are atomic.
set -u
. "$(dirname "$0")/lib.sh"

file=$root/.captain-decisions.json
usage() { echo "usage: decisions.sh add <id> [--run <run-directory>] <question> | done <id>... | ls" >&2; exit 2; }
current() { if [ -s "$file" ] && jq -e 'type == "array"' "$file" >/dev/null 2>&1; then cat "$file"; else echo '[]'; fi; }
save() { # filter, then jq args: applied to the current list
  local tmp
  mkdir -p "$root" && tmp=$(mktemp "$root/.captain-decisions.XXXXXX") || exit 1
  current | jq "$1" "${@:2}" >"$tmp" && mv "$tmp" "$file" || { rm -f "$tmp"; exit 1; }
}

[ $# -ge 1 ] || usage
cmd=$1; shift
case $cmd in
  add)
    [ $# -ge 2 ] || usage
    id=$1; shift
    run=
    if [ "$1" = --run ]; then [ $# -ge 3 ] || usage; run=$2; shift 2; fi
    [ $# -eq 1 ] && [ -n "$1" ] || usage
    case $id in *[!a-z0-9_-]* | "") echo "id: use a-z 0-9 - _ only" >&2; exit 2 ;; esac
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    save '(if $run == "" then null else $run end) as $r
      | if any(.id == $id) then map(if .id == $id then .question = $q | .run = ($r // .run) else . end)
        else . + [{id: $id, question: $q, run: $r, asked: $now}] end' \
      --arg id "$id" --arg q "$1" --arg run "$run" --arg now "$now"
    ;;
  done)
    [ $# -ge 1 ] || usage
    save 'map(select(.id as $i | $ARGS.positional | index($i) | not))' --args "$@"
    ;;
  ls)
    [ $# -eq 0 ] || usage
    current | jq -r '.[] | [.id, .asked, (.run // "-"), (.question | gsub("[\t\n]"; " "))] | @tsv'
    ;;
  *) usage ;;
esac
