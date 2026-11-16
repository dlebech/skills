#!/usr/bin/env bash
# The captain's open decisions: what it asked the user and is still waiting on.
#
# Usage: decisions.sh add <id> [--run <run-directory>] [--option "label: text"]...
#                  [--recommended <label>[: why]] [--evidence <text>] [--risk <text>]
#                  [--blocks <text>] <question>
#        decisions.sh done <id>...
#        decisions.sh ls
#
# Kept in <root>/.captain-decisions.json, an array of
#   {"id", "question", "run" (a run directory, or null), "asked" (UTC time)}
# and, when given, the same sections as a run's question.md (run-files.md):
#   "options": [{"label", "text"}], "recommended", "evidence", "risk", "blocks"
# oldest first, so Harbormaster's "Waiting on you" queue can show them beside the
# runs' own question.md files, with one button per option, and they survive the
# back and forth that buries a question in the captain's tab. Entries without the
# sections stay valid. add rewords a decision with the same id in place, keeping its
# run unless --run gives another, its sections unless a flag gives them again (--option
# then replaces the whole list), and when it was first asked; done removes them (an
# unknown id is fine); ls prints one per line: "<id>\t<asked>\t<run or ->\t<question>".
# Writes are atomic.
set -u
. "$(dirname "$0")/lib.sh"

file=$root/.captain-decisions.json
usage() { echo "usage: decisions.sh add <id> [--run <run-directory>] [--option \"label: text\"]... [--recommended <label>] [--evidence <text>] [--risk <text>] [--blocks <text>] <question> | done <id>... | ls" >&2; exit 2; }
# A missing or empty file is no decisions; anything else that is not a list is
# refused, so a write never replaces a file this script did not write.
current() {
  if [ ! -s "$file" ]; then echo '[]'
  elif jq -e 'type == "array"' "$file" >/dev/null 2>&1; then cat "$file"
  else echo "$file is not a JSON list; fix or remove it" >&2; return 1
  fi
}
save() { # filter, then jq args: applied to the current list
  local tmp
  mkdir -p "$root" && tmp=$(mktemp "$root/.captain-decisions.XXXXXX") || exit 1
  { list=$(current) && jq "$1" "${@:2}" <<<"$list" >"$tmp" && mv "$tmp" "$file"; } || { rm -f "$tmp"; exit 1; }
}

[ $# -ge 1 ] || usage
cmd=$1; shift
case $cmd in
  add)
    [ $# -ge 2 ] || usage
    id=$1; shift
    run= recommended= evidence= risk= blocks=
    options='[]' has_options=false
    while [ $# -gt 1 ]; do
      case $1 in
        --run) run=$2 ;;
        --recommended) recommended=$2 ;;
        --evidence) evidence=$2 ;;
        --risk) risk=$2 ;;
        --blocks) blocks=$2 ;;
        --option)
          has_options=true
          # "label: text" (or "label — text"); without a separator the label is all of it
          options=$(jq -c --arg o "$2" '. + [($o | capture("^(?<label>.+?)(: | — )(?<text>.*)$") // {label: $o, text: ""})]' <<<"$options") || exit 1 ;;
        *) usage ;;
      esac
      shift 2
    done
    [ $# -eq 1 ] && [ -n "$1" ] || usage
    case $id in -* | *[!a-z0-9_-]* | "") echo "id: use a-z 0-9 - _ only, not starting with -" >&2; exit 2 ;; esac
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    # Sections not given are left out of a new entry, and kept on an existing one.
    save '(if $run == "" then null else $run end) as $r
      | ({options: (if $hasopt then $opts else null end), recommended: $rec, evidence: $ev, risk: $risk, blocks: $blocks}
         | with_entries(select(.value != null and .value != "" and .value != []))) as $x
      | if any(.id == $id) then map(if .id == $id then (.question = $q | .run = ($r // .run)) + $x else . end)
        else . + [{id: $id, question: $q, run: $r, asked: $now} + $x] end' \
      --arg id "$id" --arg q "$1" --arg run "$run" --arg now "$now" --argjson opts "$options" \
      --argjson hasopt "$has_options" --arg rec "$recommended" --arg ev "$evidence" --arg risk "$risk" --arg blocks "$blocks"
    ;;
  done)
    [ $# -ge 1 ] || usage
    save 'map(select(.id as $i | $ARGS.positional | index($i) | not))' --args -- "$@"
    ;;
  ls)
    [ $# -eq 0 ] || usage
    list=$(current) || exit 1
    jq -r '.[] | [.id, .asked, (.run // "-"), (.question | gsub("[\t\n]"; " "))] | @tsv' <<<"$list"
    ;;
  *) usage ;;
esac
