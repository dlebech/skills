#!/usr/bin/env bash
# Print the code-review skills a reviewer of an agent kind can use, best first.
#
# Usage: review-skill.sh <kind> [<worktree>]
#   kind: claude, pi, opencode, codex, or any other agent name.
#   worktree: the folder the reviewer works in; its own skill folders win over the user's.
#
# One line per skill, tab-separated: <name>  <absolute SKILL.md path>  <invocable|read-only>
# `read-only` means the skill's frontmatter has `disable-model-invocation: true`: the reviewer
# can't invoke it, but can read the file and follow it. With no skill, prints nothing, exit 0.
# Only general code-review skills count (security-review, PR writers and the like do not).
# Rank: `code-review`, `review`, `codereview`, `review-code`, then names ending in `code-review`
# (plugin:code-review, so a plugin's code-review ranks below a plain `review`); the same rank keeps folder order, project before user.
# HOME is honoured. HERDR_REVIEW_SKILL_DIRS (colon-separated) replaces the folder list.
set -euo pipefail

kind=${1:-}
[ -n "$kind" ] && [ $# -le 2 ] || { echo "usage: review-skill.sh <kind> [<worktree>]" >&2; exit 2; }
wt=${2:-}
[ -n "$wt" ] && wt=${wt%/}

# Folders, project first. Entries are "dir" or "plugin-name|dir" (names get a plugin: prefix).
dirs=()
w() { [ -n "$wt" ] && dirs+=("$wt/$1") || true; }
if [ -n "${HERDR_REVIEW_SKILL_DIRS:-}" ]; then
  IFS=: read -r -a dirs <<<"$HERDR_REVIEW_SKILL_DIRS"
else
  case $kind in
    claude) w .claude/skills; dirs+=("$HOME/.claude/skills") ;;
    pi) w .pi/skills; w .agents/skills; dirs+=("$HOME/.pi/agent/skills" "$HOME/.agents/skills") ;;
    opencode)
      w .opencode/skills; w .opencode/skill; w .claude/skills; w .agents/skills
      dirs+=("$HOME/.config/opencode/skills" "$HOME/.config/opencode/skill" "$HOME/.claude/skills" "$HOME/.agents/skills") ;;
    codex) w .agents/skills; dirs+=("$HOME/.codex/skills" "$HOME/.agents/skills") ;;
    *) w .agents/skills; dirs+=("$HOME/.agents/skills") ;;
  esac
  # Installed Claude Code plugins: each install path's skills/. Quietly skipped if the file
  # is missing or has another shape.
  plugins=$HOME/.claude/plugins/installed_plugins.json
  if [ "$kind" = claude ] && [ -f "$plugins" ] && command -v jq >/dev/null; then
    while IFS=$'\t' read -r pname ppath; do
      [ -n "$pname" ] && [ -n "$ppath" ] && dirs+=("$pname|$ppath/skills")
    done < <(jq -r '.plugins | to_entries[]? | .key as $k | (.value[]? | .installPath? // empty) |
      [($k | split("@")[0]), .] | @tsv' "$plugins" 2>/dev/null || true)
  fi
fi

# Value of a frontmatter key (first --- block), without quotes.
fm() { # fm <file> <key>
  awk -v k="$2" '
    NR == 1 { if ($0 !~ /^---[ \t\r]*$/) exit; next }
    /^---[ \t\r]*$/ { exit }
    index($0, k ":") == 1 { v = substr($0, length(k) + 2); gsub(/^[ \t]+|[ \t\r]+$/, "", v); gsub(/^["'\'']|["'\'']$/, "", v); print v; exit }
  ' <"$1" 2>/dev/null || true
}

declare -A seen
n=0
out=()
for entry in ${dirs[@]+"${dirs[@]}"}; do
  prefix=
  dir=$entry
  case $entry in *\|*) prefix=${entry%%|*}:; dir=${entry#*|} ;; esac
  [ -d "$dir" ] || continue
  for f in "$dir"/*/SKILL.md; do
    [ -f "$f" ] || continue
    real=$(readlink -f "$f" 2>/dev/null) || continue
    [ -z "${seen[$real]:-}" ] || continue
    seen[$real]=1
    name=$(fm "$f" name)
    [ -n "$name" ] || name=$(basename "$(dirname "$real")")
    lower=$(printf '%s' "$prefix$name" | tr 'A-Z' 'a-z')
    case $lower in
      code-review) rank=1 ;;
      review) rank=2 ;;
      codereview) rank=3 ;;
      review-code) rank=4 ;;
      *code-review) rank=5 ;;
      *) continue ;;
    esac
    mode=invocable
    [ "$(fm "$f" disable-model-invocation | tr 'A-Z' 'a-z')" = true ] && mode=read-only
    n=$((n + 1))
    out+=("$rank"$'\t'"$n"$'\t'"$prefix$name"$'\t'"$real"$'\t'"$mode")
  done
done

[ ${#out[@]} -gt 0 ] || exit 0
printf '%s\n' "${out[@]}" | sort -t $'\t' -k1,1n -k2,2n | cut -f3-
