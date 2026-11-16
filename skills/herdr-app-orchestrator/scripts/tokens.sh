#!/usr/bin/env bash
# Count the tokens a run has used, across its orchestrator and all its agents, and
# publish them in status.json, where Harbormaster reads them.
#
# Usage: tokens.sh <run-directory>
#
# set-status.sh runs it after every publish, so the numbers follow the run's progress;
# run it by hand to see errors, which set-status.sh keeps quiet. It reads the agents'
# own session files, on this computer, so it works after agents are killed and their
# worktrees removed:
#   orchestrator  each session its terminal has had: `hc get <terminal>` gives the pid,
#                 Claude Code's sessions/<pid>.json the session id, and the id is
#                 added to the run's `sessions` file, one "<kind> <id or file>" a line,
#                 so a resumed orchestrator's earlier sessions still count. The
#                 orchestrator works in the repository's own checkout, shared with
#                 other sessions, so its folder alone cannot tell which are its. pi has
#                 no pid to session map: the newest session in its folder is taken, as
#                 Harbormaster's context.js does.
#   agents        every session in the run's worktrees, <worktrees>/<repo>/<prefix>-*
#                 for each repository in plan.md's Repos line (or the run's folder) and
#                 the integration worktree, with Claude Code's sub-agent transcripts;
#                 only messages from the run's start (orchestrator.json `started`) on,
#                 so an older run that used the same prefix is not counted. An agent
#                 is named by its worktree, e.g. pda-t3; the integration worktree's as
#                 "integration".
# Claude Code logs one API response once per content block, each line carrying the
# same usage, so responses are counted once by message id; pi logs each once, by
# entry id. A token is any of input, output, cache read and cache write: `total` is
# their sum, as the context size Harbormaster shows is.
#
# Reading only what changed: each session file's parsed usage is cached in the run's
# .tokens/ folder with how far it was read, so a rerun reads only the bytes appended
# since (a few lines), and a file read before and not grown is not opened.
#
# Writes status.json's `tokens`: {total, input, output, cache_read, cache_write,
# by_agent: [{name, total}], updated}, the orchestrator first, then agents by size,
# keeping the other fields; prints the same object.
#
# CLAUDE_CONFIG_DIR, PI_CODING_AGENT_DIR and HERDR_WORKTREES_ROOT move where it looks,
# for tests; they default to ~/.claude, ~/.pi/agent and ~/.herdr/worktrees.
set -u
. "$(dirname "$0")/lib.sh"

[ $# -eq 1 ] || { echo "usage: tokens.sh <run-directory>" >&2; exit 2; }
dir=${1%/}
[ -e "$dir/orchestrator.json" ] || { echo "no orchestrator.json in $dir" >&2; exit 1; }
claude=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
pi=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
worktrees=${HERDR_WORKTREES_ROOT:-$HOME/.herdr/worktrees}
cache=$dir/.tokens
mkdir -p "$cache" || exit 1

IFS=$'\x1f' read -r branch folder terminal started < <(jq -r \
  '[.branch // "", .folder // "", .terminal // "", .started // ""] | join("\u001f")' "$dir/orchestrator.json")
# Transcripts stamp messages to the millisecond: "...:55Z" would sort after "...:55.123Z".
case $started in *Z) [[ $started == *.* ]] || started=${started%Z}.000Z ;; esac
# A run from before init-run.sh recorded its start: every session in its worktrees counts.
started=${started:--}
prefix=$(sed -n 's/^Prefix: *//p' "$dir/plan.md" 2>/dev/null | head -1 | tr -d '[:space:]')
# "Repos: web /src/web, api /src/api" → web api; without the line, the run's folder.
repos=$(sed -n 's/^Repos: *//p' "$dir/plan.md" 2>/dev/null | head -1 | tr ',' '\n' | awk 'NF { print $1 }')
[ -n "$repos" ] || repos=${folder##*/}

# How each program names a folder's session directory.
claude_dir() { printf '%s/projects/%s' "$claude" "$(printf '%s' "$1" | sed 's/[^A-Za-z0-9-]/-/g')"; }
pi_dir() { printf '%s/sessions/--%s--' "$pi" "$(printf '%s' "${1#/}" | sed 's|/|-|g')"; }

# Remember the orchestrator's current session.
touch "$dir/sessions"
if [ -n "$terminal" ] && me=$(hc get "$terminal" --json 2>/dev/null); then
  IFS=$'\x1f' read -r app pid cwd < <(jq -r \
    '[.status.app // .agent // "", .foreground.pid // "", .foreground.cwd // .cwd // ""] | map(tostring) | join("\u001f")' <<<"$me")
  entry=
  case $app in
    claude*)
      id=$(jq -r '.sessionId // empty' "$claude/sessions/$pid.json" 2>/dev/null)
      [ -z "$id" ] || entry="claude $id" ;;
    pi)
      f=$(ls -t "$(pi_dir "$cwd")"/*.jsonl 2>/dev/null | head -1)
      [ -z "$f" ] || entry="pi $f" ;;
  esac
  [ -z "$entry" ] || grep -qxF -e "$entry" "$dir/sessions" || echo "$entry" >>"$dir/sessions"
fi

# The sources, one "<name>\t<kind>\t<since>\t<file>" a line; since is - for no limit
# (not empty: read would merge two tabs into one).
sources() {
  local kind id f d r base name integration
  while read -r kind id; do
    case $kind in
      claude)
        for f in "$claude"/projects/*/"$id".jsonl "$claude"/projects/*/"$id"/subagents/*.jsonl; do
          [ -e "$f" ] && printf 'orchestrator\tclaude\t-\t%s\n' "$f"
        done ;;
      pi) [ -e "$id" ] && printf 'orchestrator\tpi\t-\t%s\n' "$id" ;;
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
        [ -e "$f" ] && printf '%s\tclaude\t%s\t%s\n' "$name" "$started" "$f"
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
        [ -e "$f" ] && printf '%s\tpi\t%s\t%s\n' "$name" "$started" "$f"
      done
    done
  done
}

# Usage rows "<id>\t<input>\t<output>\t<cache read>\t<cache write>" from transcript lines.
parse() {
  case $1 in
    claude) grep -aF -e '"usage"' | jq -rR --arg since "$2" 'fromjson?
      | select(.type == "assistant" and (.message.id // "") != "" and .message.usage != null)
      | select($since == "-" or (.timestamp // "") >= $since)
      | .message.usage as $u
      | [.message.id, $u.input_tokens // 0, $u.output_tokens // 0, $u.cache_read_input_tokens // 0, $u.cache_creation_input_tokens // 0]
      | @tsv' ;;
    pi) grep -aF -e '"usage"' | jq -rR --arg since "$2" 'fromjson?
      | select(.type == "message" and .message.role == "assistant" and .message.usage != null)
      | select($since == "-" or (.timestamp // "") >= $since)
      | .message.usage as $u
      | ["pi:\(.id)", $u.input // 0, $u.output // 0, $u.cacheRead // 0, $u.cacheWrite // 0]
      | @tsv' ;;
  esac
}

# Brings one file's cache up to date: reads from where it stopped, up to the last whole
# line (an agent may be writing the next one), or from the start when the file was
# replaced, shrank, or the run's start changed.
update() {
  local kind=$1 since=$2 f=$3 key size inode off=0 old_inode= old_since= chunk partial
  key=$(printf '%s' "$f" | cksum | tr ' ' -)
  # GNU stat, then BSD/macOS.
  read -r size inode < <(stat -c '%s %i' "$f" 2>/dev/null || stat -f '%z %i' "$f" 2>/dev/null) || return 0
  [ ! -e "$cache/$key.at" ] || IFS=$'\t' read -r off old_inode old_since <"$cache/$key.at"
  if [ "$old_inode" != "$inode" ] || [ "$old_since" != "$since" ] || [ "$off" -gt "$size" ]; then
    off=0
    : >"$cache/$key.tsv"
  fi
  [ "$off" -lt "$size" ] || { echo "$cache/$key.tsv"; return 0; }
  chunk=$cache/.chunk.$$
  tail -c +$((off + 1)) "$f" | head -c $((size - off)) >"$chunk"
  partial=0
  [ -z "$(tail -c 1 "$chunk")" ] || partial=$(tail -n 1 "$chunk" | wc -c)
  head -c $((size - off - partial)) "$chunk" | parse "$kind" "$since" >>"$cache/$key.tsv"
  rm -f "$chunk"
  printf '%s\t%s\t%s\n' $((size - partial)) "$inode" "$since" >"$cache/$key.at"
  echo "$cache/$key.tsv"
}

rows=$(sources | while IFS=$'\t' read -r name kind since f; do
  t=$(update "$kind" "$since" "$f") && [ -n "$t" ] && awk -v n="$name" -F'\t' 'NF == 5 { print n "\t" $0 }' "$t"
done)

# Each response once, counted for the first source that logged it (the orchestrator
# comes first); then the totals and each agent's share.
tokens=$(printf '%s\n' "$rows" | awk -F'\t' '
  NF == 6 && !seen[$2]++ {
    i += $3; o += $4; r += $5; w += $6; by[$1] += $3 + $4 + $5 + $6
  }
  END {
    printf "%d\t%d\t%d\t%d\n", i, o, r, w
    for (n in by) printf "%s\t%d\n", n, by[n]
  }' | jq -Rn --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  [inputs | split("\t")] as $l
  | ($l[0] | map(tonumber)) as [$i, $o, $r, $w]
  | {total: ($i + $o + $r + $w), input: $i, output: $o, cache_read: $r, cache_write: $w,
     by_agent: ($l[1:] | map({name: .[0], total: (.[1] | tonumber)})
       | sort_by(if .name == "orchestrator" then 0 else 1 end, -.total)),
     updated: $updated}') || exit 1

status_merge "$dir" "{\"tokens\": $tokens}" || exit 1
printf '%s\n' "$tokens"
