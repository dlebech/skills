#!/usr/bin/env bash
# Checks review-skill.sh against a throwaway HOME and worktree: which skills are found for
# each agent kind, their order, read-only marking, symlink dedup, plugins, bad usage.
# No model turns, nothing written outside a temporary folder.
#
# Usage: bash tests/herdr-app-orchestrator/review-skill.sh
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
script=$repo/skills/herdr-app-orchestrator/scripts/review-skill.sh
command -v jq >/dev/null || { echo "needs jq" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failed=0
check() { # check <description> <got> <want>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "  got:  $(printf %q "$2")"; echo "  want: $(printf %q "$3")"; failed=1; fi
}
skill() { # skill <dir> <folder> <name> [extra frontmatter line]
  mkdir -p "$1/$2"
  { echo "---"; echo "name: $3"; [ -n "${4:-}" ] && echo "$4"; echo "description: x"; echo "---"; echo body; } >"$1/$2/SKILL.md"
}
fresh() { rm -rf "$tmp/h" "$tmp/wt"; mkdir -p "$tmp/h" "$tmp/wt"; export HOME=$tmp/h; }
run() { bash "$script" "$@" 2>&1; }
H=$tmp/h W=$tmp/wt

fresh
check "nothing installed: no output" "$(run claude "$W")" ""
bash "$script" claude "$W" >/dev/null 2>&1; check "nothing installed: exit 0" "$?" 0
check "no worktree given" "$(run pi)" ""

fresh; skill "$H/.claude/skills" code-review code-review
check "user code-review for claude" "$(run claude "$W")" "code-review	$H/.claude/skills/code-review/SKILL.md	invocable"

fresh; skill "$H/.claude/skills" code-review code-review; skill "$W/.claude/skills" mine code-review
check "project skill ranks before the user's" "$(run claude "$W" | cut -f2)" "$W/.claude/skills/mine/SKILL.md
$H/.claude/skills/code-review/SKILL.md"

fresh; skill "$H/.claude/skills" cr code-review "disable-model-invocation: true"
check "disable-model-invocation: read-only" "$(run claude "$W" | cut -f3)" "read-only"

fresh; skill "$H/.agents/skills" code-review code-review; mkdir -p "$H/.claude"; ln -s "$H/.agents/skills" "$H/.claude/skills"
check "symlinked folder listed once" "$(run claude "$W" | wc -l)" "1"
check "symlink resolves to the real path" "$(run claude "$W" | cut -f2)" "$H/.agents/skills/code-review/SKILL.md"

fresh; skill "$H/.claude/skills" a security-review; skill "$H/.claude/skills" b pr-writer; skill "$H/.claude/skills" c Review; skill "$H/.claude/skills" d codereview
skill "$H/.claude/skills" e my-code-review; skill "$H/.claude/skills" f code-review
check "ignores others, ranks the rest" "$(run claude "$W" | cut -f1 | tr '\n' ' ')" "code-review Review codereview my-code-review "

fresh; skill "$H/.agents/skills" folder-name ""; sed -i '/^name:/d' "$H/.agents/skills/folder-name/SKILL.md"
check "no name: falls back to non-match" "$(run pi "$W")" ""
fresh; skill "$H/.agents/skills" code-review ""; sed -i '/^name:/d' "$H/.agents/skills/code-review/SKILL.md"
check "no name: folder name used" "$(run pi "$W" | cut -f1)" "code-review"

fresh; skill "$H/.agents/skills" code-review code-review
check "pi sees ~/.agents" "$(run pi "$W" | cut -f1)" "code-review"
check "opencode sees ~/.agents" "$(run opencode "$W" | cut -f1)" "code-review"
check "claude does not see ~/.agents" "$(run claude "$W")" ""
check "other kind sees ~/.agents" "$(run mystery "$W" | cut -f1)" "code-review"
skill "$W/.pi/skills" p code-review
check "pi: project .pi/skills first" "$(run pi "$W" | head -1 | cut -f2)" "$W/.pi/skills/p/SKILL.md"
check "codex ignores .pi/skills" "$(run codex "$W" | cut -f2)" "$H/.agents/skills/code-review/SKILL.md"

fresh; skill "$W/.claude/skills" code-review code-review
check "opencode reads project .claude/skills" "$(run opencode "$W" | cut -f1)" "code-review"

# Plugin skills, in the shape of ~/.claude/plugins/installed_plugins.json.
fresh; skill "$tmp/plug/skills" code-review code-review; skill "$tmp/plug/skills" other other
mkdir -p "$H/.claude/plugins"
jq -n --arg p "$tmp/plug" '{version: 2, plugins: {"cr@market": [{scope: "user", installPath: $p, version: "1"}]}}' >"$H/.claude/plugins/installed_plugins.json"
check "plugin skill is plugin:skill" "$(run claude "$W")" "cr:code-review	$tmp/plug/skills/code-review/SKILL.md	invocable"
skill "$H/.claude/skills" code-review code-review
check "plain code-review beats plugin" "$(run claude "$W" | cut -f1 | tr '\n' ' ')" "code-review cr:code-review "
skill "$H/.claude/skills" r review
check "plain review beats plugin code-review" "$(run claude "$W" | cut -f1 | tr '\n' ' ')" "code-review review cr:code-review "
rm -rf "$H/.claude/skills/r"
check "pi ignores plugins" "$(run pi "$W")" ""
echo '{"plugins": "oops"}' >"$H/.claude/plugins/installed_plugins.json"
check "odd plugins file is skipped" "$(run claude "$W" | cut -f1)" "code-review"
echo 'not json' >"$H/.claude/plugins/installed_plugins.json"
check "broken plugins file is skipped" "$(run claude "$W" | cut -f1)" "code-review"

fresh; skill "$tmp/x" code-review code-review
check "HERDR_REVIEW_SKILL_DIRS replaces folders" "$(HERDR_REVIEW_SKILL_DIRS=$tmp/nope:$tmp/x run claude "$W" | cut -f1)" "code-review"

bash "$script" >/dev/null 2>&1; check "no args: exit 2" "$?" 2
bash "$script" claude a b >/dev/null 2>&1; check "too many args: exit 2" "$?" 2

[ $failed = 0 ] && echo "all passed" || echo "FAILED"
exit $failed
