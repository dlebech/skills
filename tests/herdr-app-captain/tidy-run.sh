#!/usr/bin/env bash
# Checks tidy-run.sh against a throwaway repository, remote and HOME; needs only git,
# jq and node, not Herdr. Checks:
#   1. merged task worktrees go with their branches, merged task branches without a
#      worktree go, unmerged or dirty task worktrees stay;
#   2. the integration worktree stays while it has unpushed commits, then goes; its
#      branch stays;
#   3. a "~/" path on the plan's Repos line is found, and the user's checkout and a
#      worktree outside ~/.herdr/worktrees are never touched;
#   4. Harbormaster's copy (TIDY in data.js) is the script from "d=$1" on.
set -u
repo=$(cd "$(dirname "$0")/../.." && pwd)
tidy=$repo/skills/herdr-app-captain/scripts/tidy-run.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export HOME=$work/home
trees=$HOME/.herdr/worktrees/app
app=$HOME/app
failed=0
check() { # check <description> <got> <want>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$2', want '$3'"; failed=1; fi
}
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=main "$@"; }
exists() { [ -e "$1" ] && echo yes || echo no; }
has_branch() { git -C "$app" show-ref -q --verify "refs/heads/$1" && echo yes || echo no; }

g init -q --bare "$work/origin"
mkdir -p "$HOME" && g init -q "$app" && g -C "$app" commit -q --allow-empty -m init
g -C "$app" remote add origin "$work/origin" && g -C "$app" push -q origin main
g -C "$app" worktree add -q -b issue-9 "$trees/issue-9" main
for t in a b c d; do
  g -C "$app" worktree add -q -b "9-$t" "$trees/9-$t" issue-9
  g -C "$trees/9-$t" commit -q --allow-empty -m "$t"
done
g -C "$trees/issue-9" merge -q 9-a 9-b 9-d >/dev/null
g -C "$app" worktree remove "$trees/9-b"            # merged, no worktree left
echo wip >"$trees/9-d/wip"                            # merged, but with new work
g -C "$app" worktree add -q -b 9-out "$work/9-out" issue-9   # outside ~/.herdr/worktrees
g -C "$trees/issue-9" push -q -u origin issue-9
g -C "$trees/issue-9" commit -q --allow-empty -m unpushed
mkdir "$work/run"
echo '{"branch":"issue-9","folder":"/nowhere"}' >"$work/run/orchestrator.json"
printf 'Status: finished\nPrefix: 9\nRepos: app ~/app\n' >"$work/run/plan.md"

echo "== first close: the integration branch has an unpushed commit"
out=$("$tidy" "$work/run")
check "merged task worktree removed" "$(exists "$trees/9-a")" no
check "its branch deleted" "$(has_branch 9-a)" no
check "merged branch without a worktree deleted" "$(has_branch 9-b)" no
check "unmerged task worktree kept" "$(exists "$trees/9-c")" yes
check "dirty task worktree kept" "$(exists "$trees/9-d/wip")" yes
check "says why" "$(grep -c "kept $trees/9-d: uncommitted changes" <<<"$out")" 1
check "unpushed integration worktree kept" "$(exists "$trees/issue-9")" yes
check "says so" "$(grep -c "kept $trees/issue-9: not pushed" <<<"$out")" 1
check "worktree elsewhere untouched" "$(exists "$work/9-out")" yes
check "user's checkout untouched" "$(git -C "$app" rev-parse --abbrev-ref HEAD)" main

echo "== pushed"
g -C "$trees/issue-9" push -q
out=$("$tidy" "$work/run")
check "integration worktree removed" "$(exists "$trees/issue-9")" no
check "integration branch kept" "$(has_branch issue-9)" yes
check "removed line" "$(grep -c "^removed $trees/issue-9$" <<<"$out")" 1

echo "== Harbormaster's copy"
embedded=$(node --input-type=module -e '
  import fs from "fs";
  const m = fs.readFileSync(process.argv[1], "utf8").match(/const TIDY = String\.raw`([\s\S]*?)`;/);
  process.stdout.write(m ? eval("String.raw`" + m[1] + "`") : "");' "$repo/herdr-app/mods/harbormaster/data.js")
check "TIDY matches tidy-run.sh" "$(diff <(sed -n '/^d=\$1$/,$p' "$tidy") <(printf '%s\n' "$embedded") >/dev/null && echo same || echo differs)" same

exit $failed
