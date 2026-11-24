#!/usr/bin/env bash
# Count the tokens a run has used, across its orchestrator and all its agents, and
# publish them in status.json, where Harbormaster reads them.
#
# Usage: tokens.sh [--print] <run-directory>
#
# set-status.sh runs it with --print on every publish and merges the object it prints in
# its own write of status.json; without --print it writes status.json's `tokens` itself,
# under the same lock (lib.sh's status_update). Run it by hand to see errors, which
# set-status.sh keeps quiet. It reads the agents' own session files, on this computer,
# so it works after agents are killed and their worktrees removed:
#   orchestrator  each session its terminal has had: `hc get <terminal>` gives the pid,
#                 Claude Code's sessions/<pid>.json the session id, and the id is
#                 added to the run's `sessions` file, one "<kind> <id or file>" a line,
#                 so a resumed orchestrator's earlier sessions still count. The
#                 orchestrator works in the repository's own checkout, shared with
#                 other sessions, so its folder alone cannot tell which are its. pi has
#                 no pid to session map: best effort, the earliest session in its folder
#                 whose header names that folder and that started after its terminal did.
#                 opencode likewise: the earliest session in its folder created after its
#                 terminal, with that session's sub-sessions.
#                 Any other kind (copilot): the session its command line names
#                 (--session-id, --session or --resume), recorded under the run's kind.
#   agents        every session in the run's worktrees, <worktrees>/<repo>/<prefix>-*
#                 for each repository in plan.md's Repos line (or the run's folder) and
#                 the integration worktree, with Claude Code's sub-agent transcripts. An
#                 agent is named by its worktree, e.g. pda-t3; the integration
#                 worktree's as "integration". opencode keeps all sessions in one SQLite
#                 database, found by each session's folder; opencode-usage.py (python3,
#                 read-only) reads it, and without either opencode adds nothing.
# Only messages from the run's start (orchestrator.json `started`) on count, for both:
# what a session said before the run, or an older run that used the same prefix, is not
# this run's. Claude Code logs one API response once per content block, each line
# carrying the same usage, so responses are counted once by message id, across files
# too, as a resumed session repeats earlier messages; pi by session and entry id, since
# its 8-character entry ids repeat across sessions; opencode by message id. Its
# reasoning tokens count as output and a v2 compaction is a call like any other. A token is any of input, output,
# cache read and cache write: `total` is their sum, as the context size Harbormaster
# shows is.
#
# Reading only what changed: each session file's parsed usage is cached in the run's
# .tokens/ folder with how far it was read and a checksum of its start and of the bytes
# before that point, so a rerun reads only the bytes appended since, and rereads a file
# that was replaced, shrank or was rewritten. When no session file is newer than the
# last count and none came or went, the last count is used as is, for up to a minute.
# opencode's database is not append-only, so a session's cache is keyed by a stamp (its
# newest message's update time and message count) and re-read whole when that changes;
# rows once seen are kept, so a message opencode deletes later still counts.
# The cache is what is summed, so a session file Claude Code deletes later (after 30
# days by default) still counts; and a count lower than the one in status.json, or one
# where a file could not be read into the cache, is never written.
#
# Writes (or prints) status.json's `tokens`: {total, input, output, cache_read,
# cache_write, by_agent: [{name, total, input, output, cache_read, cache_write}], updated}, the orchestrator first, then agents
# by size. Exits 1, writing nothing, when the count failed.
#
# CLAUDE_CONFIG_DIR, PI_CODING_AGENT_DIR, OPENCODE_DATA_DIR and HERDR_WORKTREES_ROOT move
# where it looks, for tests; they default to ~/.claude, ~/.pi/agent,
# ~/.local/share/opencode and ~/.herdr/worktrees.
set -u
. "$(dirname "$0")/lib.sh"

print=
[ "${1:-}" != --print ] || { print=1; shift; }
[ $# -eq 1 ] || { echo "usage: tokens.sh [--print] <run-directory>" >&2; exit 2; }
dir=${1%/}
[ -e "$dir/orchestrator.json" ] || { echo "no orchestrator.json in $dir" >&2; exit 1; }
claude=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
pi=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
opencode=${OPENCODE_DATA_DIR:-$HOME/.local/share/opencode}
oc_usage=$(dirname "$0")/opencode-usage.py
worktrees=${HERDR_WORKTREES_ROOT:-$HOME/.herdr/worktrees}
cache=$dir/.tokens
mkdir -p "$cache" || exit 1

IFS=$'\x1f' read -r branch folder terminal started < <(jq -r \
  '[.branch // "", .folder // "", .terminal // "", .started // ""] | join("\u001f")' "$dir/orchestrator.json")
# Transcripts stamp messages to the millisecond: "...:55Z" would sort after "...:55.123Z".
case $started in *Z) [[ $started == *.* ]] || started=${started%Z}.000Z ;; esac
# A run from before init-run.sh recorded its start: every message counts. Not empty,
# since read would merge two tabs into one.
started=${started:--}
prefix=$(sed -n 's/^Prefix: *//p' "$dir/plan.md" 2>/dev/null | head -1 | tr -d '[:space:]')
# "Repos: web /src/web, api /src/api" → web api; without the line, the run's folder.
repos=$(sed -n 's/^Repos: *//p' "$dir/plan.md" 2>/dev/null | head -1 | tr ',' '\n' | awk 'NF { print $1 }')
[ -n "$repos" ] || repos=${folder##*/}

# How each program names a folder's session directory.
claude_dir() { printf '%s/projects/%s' "$claude" "$(printf '%s' "$1" | sed 's/[^A-Za-z0-9-]/-/g')"; }
pi_dir() { printf '%s/sessions/--%s--' "$pi" "$(printf '%s' "${1#/}" | sed 's|/|-|g')"; }

# opencode_usage <command> <argument>...: opencode-usage.py on opencode's data, which is
# there only when the database is and python3 is.
opencode_usage() {
  [ -e "$opencode/opencode.db" ] && command -v python3 >/dev/null || return 0
  python3 "$oc_usage" "$1" "$opencode" "${@:2}"
}

# Remember the orchestrator's current session.
touch "$dir/sessions" || exit 1
if [ -n "$terminal" ] && me=$(hc get "$terminal" --json 2>/dev/null); then
  IFS=$'\x1f' read -r app pid cwd created < <(jq -r \
    '[.status.app // .agent // "", .foreground.pid // "", .foreground.cwd // .cwd // "", .created_ms // 0] | map(tostring) | join("\u001f")' <<<"$me")
  entry=
  case $app in
    claude*)
      id=$(jq -r '.sessionId // empty' "$claude/sessions/$pid.json" 2>/dev/null)
      [ -z "$id" ] || entry="claude $id" ;;
    pi)
      # The first line of a pi session is its header: {type: "session", id, timestamp, cwd}.
      d=$(pi_dir "$cwd")
      id=$(for f in "$d"/*.jsonl; do [ -e "$f" ] && head -n 1 "$f"; done | jq -rRs --arg cwd "$cwd" --argjson created "${created:-0}" '
        [split("\n")[] | fromjson? | select(.type == "session" and .cwd == $cwd)
         | select(((.timestamp // "") | sub("\\.[0-9]+Z$"; "Z") | try fromdateiso8601 catch 0) * 1000 >= $created - 999)]
        | sort_by(.timestamp) | first | .id // empty' 2>/dev/null)
      for f in "$d"/*"$id".jsonl; do [ -n "$id" ] && [ -e "$f" ] && entry="pi $f"; done ;;
    opencode*)
      # Like pi: no pid to session map, so the earliest session in its folder that started after its terminal.
      id=$(opencode_usage first "$cwd" "${created:-0}" 2>/dev/null)
      [ -z "$id" ] || entry="opencode $id" ;;
  esac
  # Any other kind: the session its command line names (--session-id, --session or --resume,
  # with the id after it or after "="), as start-agent.sh starts copilot, under the run's kind.
  if [ -z "$entry" ]; then
    okind=$(jq -r '.kind // empty' "$dir/orchestrator.json" 2>/dev/null)
    sid=$(jq -r '(.foreground.argv // .argv // []) as $a | [range(0; $a | length) as $i
      | if ($a[$i] | IN("--session-id", "--session", "--resume")) then $a[$i + 1]
        elif ($a[$i] | test("^--(session-id|session|resume)=")) then ($a[$i] | sub("^[^=]*="; ""))
        else empty end | select(. != null and . != "")] | last // empty' <<<"$me" 2>/dev/null)
    [ -z "$okind" ] || [ -z "$sid" ] || entry="$okind $sid"
  fi
  [ -z "$entry" ] || grep -qxF -e "$entry" "$dir/sessions" || echo "$entry" >>"$dir/sessions" || exit 1
fi

# The sources, as three parallel lists: name, kind, file.
names=() kinds=() files=()
add() { names+=("$1"); kinds+=("$2"); files+=("$3"); }
while read -r kind id; do
  case $kind in
    claude)
      for f in "$claude"/projects/*/"$id".jsonl "$claude"/projects/*/"$id"/subagents/*.jsonl; do
        [ -e "$f" ] && add orchestrator claude "$f"
      done ;;
    pi) [ -e "$id" ] && add orchestrator pi "$id" ;;
  esac
done <"$dir/sessions"
for r in $repos; do
  base=$(claude_dir "$worktrees/$r/")
  integration=$(claude_dir "$worktrees/$r/$(branch_slug "$branch")")
  for d in ${prefix:+"$base$prefix"-*} "$integration"; do
    [ -d "$d" ] || continue
    name=${d#"$base"}
    [ "$d" != "$integration" ] || name=integration
    for f in "$d"/*.jsonl "$d"/*/subagents/*.jsonl; do
      [ -e "$f" ] && add "$name" claude "$f"
    done
  done
  base=$(pi_dir "$worktrees/$r/")
  base=${base%--}
  integration=$(pi_dir "$worktrees/$r/$(branch_slug "$branch")")
  for d in ${prefix:+"$base$prefix"-*--} "$integration"; do
    [ -d "$d" ] || continue
    name=${d#"$base"}
    name=${name%--}
    [ "$d" != "$integration" ] || name=integration
    for f in "$d"/*.jsonl; do
      [ -e "$f" ] && add "$name" pi "$f"
    done
  done
done

# Publishes a count: prints it, and without --print merges it into status.json.
publish() {
  if [ -z "$print" ]; then
    status_update "$dir" "$STATUS_TOKENS_FILTER" --argjson tokens "$1" || exit 1
  fi
  printf '%s\n' "$1"
}

# Nothing new since the last count, less than a minute ago: use it.
stamp=$cache/.stamp
trap 'rm -f "$stamp.$$" "$cache/.chunk.$$" "$cache/tokens.json.$$" "$cache"/*.tsv.$$ "$cache"/*.at.$$' EXIT
if [ -s "$cache/tokens.json" ] && [ -e "$stamp" ] && [ "$(<"$stamp")" = "${#files[@]}" ] &&
  jq -e '(.by_agent // []) | all(has("cache_read"))' "$cache/tokens.json" >/dev/null 2>&1 &&
  [ -n "$(find "$stamp" -mmin -1 2>/dev/null)" ] &&
  { [ ${#files[@]} -eq 0 ] || [ -z "$(find "${files[@]}" -newer "$stamp" -print -quit 2>/dev/null)" ]; } &&
  # opencode.db's WAL changes with every opencode session on the machine, so with one
  # running this rarely holds; the full read below is cheap (a stamp query per session).
  [ -z "$(find "$opencode" -maxdepth 1 -name 'opencode.db*' -newer "$stamp" -print -quit 2>/dev/null)" ]; then
  publish "$(<"$cache/tokens.json")"
  exit 0
fi
# Stamped before reading, so a file written while it reads is newer than the stamp.
echo "${#files[@]}" >"$stamp.$$" || exit 1

# opencode keeps every session in one database, so they are listed through it, as three
# parallel lists: name, session id, stamp (which changes when a session gets a message).
# The orchestrator's sessions, with their sub-sessions, then those in the run's worktrees.
oc_names=() oc_ids=() oc_stamps=()
add_oc() {
  local name=$1 id dir stamp listed
  shift
  [ $# -gt 0 ] || return 0
  listed=$(opencode_usage sessions "$@") || { echo "could not read opencode's database in $opencode" >&2; exit 1; }
  while IFS=$'\t' read -r id dir stamp; do
    [ -n "$id" ] || continue
    oc_names+=("${name:-${dir##*/}}"); oc_ids+=("$id"); oc_stamps+=("$stamp")
  done <<<"$listed"
}
patterns=()
while read -r kind id; do
  [ "$kind" != opencode ] || patterns+=("id:$id")
done <"$dir/sessions"
add_oc orchestrator ${patterns[@]+"${patterns[@]}"}
patterns=()
for r in $repos; do
  patterns+=(${prefix:+"$worktrees/$r/$prefix-*"} "$worktrees/$r/$(branch_slug "$branch")")
done
add_oc "" "${patterns[@]}"
for i in "${!oc_names[@]}"; do
  [ "${oc_names[$i]}" != "$(branch_slug "$branch")" ] || oc_names[$i]=integration
done

# Usage rows "<id>\t<input>\t<output>\t<cache read>\t<cache write>" from transcript lines.
parse() {
  case $1 in
    claude) grep -aF -e '"usage"' | jq -rR --arg since "$2" 'fromjson?
      | select(.type == "assistant" and (.message.id // "") != "" and .message.usage != null)
      | select($since == "-" or (.timestamp // "") >= $since)
      | .message.usage as $u
      | [.message.id, $u.input_tokens // 0, $u.output_tokens // 0, $u.cache_read_input_tokens // 0, $u.cache_creation_input_tokens // 0]
      | @tsv' ;;
    pi) grep -aF -e '"usage"' | jq -rR --arg since "$2" --arg session "$3" 'fromjson?
      | select(.type == "message" and .message.role == "assistant" and .message.usage != null)
      | select($since == "-" or (.timestamp // "") >= $since)
      | .message.usage as $u
      | ["pi:\($session):\(.id)", $u.input // 0, $u.output // 0, $u.cacheRead // 0, $u.cacheWrite // 0]
      | @tsv' ;;
  esac
}

# A checksum of what a file held up to `off`: its first 4 kB and the 256 bytes before off.
signature() {
  local f=$1 off=$2 h=4096 t=256
  [ "$off" -ge "$h" ] || h=$off
  [ "$off" -ge "$t" ] || t=$off
  { head -c "$h" "$f"; tail -c +$((off - t + 1)) "$f" | head -c "$t"; } | cksum | cut -d' ' -f1
}

# Brings one file's cache up to date: reads from where it stopped, up to the last whole
# line (an agent may be writing the next one), or from the start when the file was
# replaced, shrank, was rewritten, or the run's start changed. Its .at file holds
# "<offset>\t<inode>\t<mtime>\t<since>\t<signature>\t<name>\t<kind>". Fails only when the
# cache cannot be written; a file gone since it was listed keeps its cache.
update() {
  local name=$1 kind=$2 f=$3 key at size inode mtime off=0 o_inode=- o_mtime=- o_since=- o_sig=- rest chunk partial
  # The path as a file name, without forking; its end, which tells files apart, when long.
  key=${f//[^A-Za-z0-9]/_}
  [ ${#key} -le 200 ] || key=${key: -200}
  at=$cache/$key.at
  # GNU stat, then BSD/macOS.
  read -r size inode mtime < <(stat -c '%s %i %Y' "$f" 2>/dev/null || stat -f '%z %i %m' "$f" 2>/dev/null) || return 0
  [ ! -e "$at" ] || IFS=$'\t' read -r off o_inode o_mtime o_since o_sig rest <"$at" || return 1
  if [ "$o_inode" = "$inode" ] && [ "$o_mtime" = "$mtime" ] && [ "$o_since" = "$started" ] && [ "$off" -eq "$size" ]; then
    return 0
  fi
  if [ "$o_inode" != "$inode" ] || [ "$o_since" != "$started" ] || [ "$off" -gt "$size" ] ||
    [ "$(signature "$f" "$off")" != "$o_sig" ]; then
    off=0
    : >"$cache/$key.tsv" || return 1
  fi
  if [ "$off" -lt "$size" ]; then
    chunk=$cache/.chunk.$$
    tail -c +$((off + 1)) "$f" | head -c $((size - off)) >"$chunk" || { rm -f "$chunk"; return 1; }
    partial=0
    [ -z "$(tail -c 1 "$chunk")" ] || partial=$(tail -n 1 "$chunk" | wc -c)
    head -c $((size - off - partial)) "$chunk" | parse "$kind" "$started" "${f##*/}" >>"$cache/$key.tsv" ||
      { rm -f "$chunk"; return 1; }
    rm -f "$chunk"
    off=$((size - partial))
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$off" "$inode" "$mtime" "$started" "$(signature "$f" "$off")" "$name" "$kind" \
    >"$at.$$" && mv "$at.$$" "$at" || return 1
}

for i in "${!files[@]}"; do
  update "${names[$i]}" "${kinds[$i]}" "${files[$i]}" || { echo "could not update the cache in $cache" >&2; exit 1; }
done

# An opencode session's cache is its rows, kept once seen, and an .at line in the same
# shape as the files', with the session's stamp where the offset is: it is read again
# only when the stamp changed or the run's start did.
since_ms=0
# jq, not GNU date -d, so this works on macOS too.
[ "$started" = - ] || since_ms=$(jq -rn --arg s "$started" '$s | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601 * 1000' 2>/dev/null) || since_ms=0
for i in "${!oc_ids[@]}"; do
  key=opencode_${oc_ids[$i]//[^A-Za-z0-9]/_}
  at=$cache/$key.at
  o_stamp=- o_since=-
  [ ! -e "$at" ] || IFS=$'\t' read -r o_stamp _ _ o_since _ <"$at" || o_stamp=-
  [ "$o_stamp" != "${oc_stamps[$i]}" ] || [ "$o_since" != "$started" ] || continue
  [ "$o_since" = "$started" ] || : >"$cache/$key.tsv" || exit 1
  # opencode writes an assistant message with no tokens and fills them in when the step
  # ends, so a message seen again takes the larger of each kind; one gone from the read
  # (deleted since) stays as cached. A failed read caches nothing and leaves the stamp.
  rows=$(opencode_usage rows "${oc_ids[$i]}" "$since_ms") || { echo "could not read opencode's database in $opencode" >&2; exit 1; }
  { cat "$cache/$key.tsv" 2>/dev/null; [ -z "$rows" ] || printf '%s\n' "$rows"; } |
    awk -F'\t' '{ if (!($1 in id)) order[++n] = $1; id[$1]
      for (k = 2; k <= 5; k++) if ($k + 0 > v[$1, k]) v[$1, k] = $k + 0 }
      END { for (j = 1; j <= n; j++) { m = order[j]; print m "\t" v[m, 2] + 0 "\t" v[m, 3] + 0 "\t" v[m, 4] + 0 "\t" v[m, 5] + 0 } }' \
      >"$cache/$key.tsv.$$" && mv "$cache/$key.tsv.$$" "$cache/$key.tsv" &&
    printf '%s\t-\t-\t%s\t-\t%s\topencode\n' "${oc_stamps[$i]}" "$started" "${oc_names[$i]}" >"$at.$$" &&
    mv "$at.$$" "$at" || { echo "could not update the cache in $cache" >&2; exit 1; }
done

# Every file ever cached, so one deleted since still counts; the orchestrator's first,
# so a response both logged is counted for it.
first=() rest=()
for at in "$cache"/*.at; do
  [ -e "$at" ] || continue
  IFS=$'\t' read -r _ _ _ _ _ name _ <"$at" || continue
  [ -n "$name" ] && [ -e "${at%.at}.tsv" ] || continue
  if [ "$name" = orchestrator ]; then first+=("$at" "${at%.at}.tsv"); else rest+=("$at" "${at%.at}.tsv"); fi
done

# Each response once; then the totals and each agent's share.
tokens=$(awk -F'\t' '
  FILENAME ~ /\.at$/ { name = $6; next }
  NF == 5 && !seen[$1]++ {
    i += $2; o += $3; r += $4; w += $5
    bi[name] += $2; bo[name] += $3; br[name] += $4; bw[name] += $5
  }
  END {
    printf "%d\t%d\t%d\t%d\n", i, o, r, w
    for (n in bi) printf "%s\t%d\t%d\t%d\t%d\n", n, bi[n], bo[n], br[n], bw[n]
  }' /dev/null ${first[@]+"${first[@]}"} ${rest[@]+"${rest[@]}"} | jq -Rnc --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  [inputs | split("\t")] as $l
  | ($l[0] | map(tonumber)) as [$i, $o, $r, $w]
  | {total: ($i + $o + $r + $w), input: $i, output: $o, cache_read: $r, cache_write: $w,
     by_agent: ($l[1:] | map((.[1:] | map(tonumber)) as [$ai, $ao, $ar, $aw]
         | {name: .[0], total: ($ai + $ao + $ar + $aw), input: $ai, output: $ao, cache_read: $ar, cache_write: $aw})
       | sort_by(if .name == "orchestrator" then 0 else 1 end, -.total)),
     updated: $updated}') && [ -n "$tokens" ] || exit 1

printf '%s\n' "$tokens" >"$cache/tokens.json.$$" && mv "$cache/tokens.json.$$" "$cache/tokens.json" && mv "$stamp.$$" "$stamp" || exit 1
publish "$tokens"
