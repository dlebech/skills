#!/usr/bin/env bash
# Installs Harbormaster into the Herdr app on this computer: the `harbormaster` mod,
# the harbormaster-board and harbormaster-sea layouts, and harbormaster-main (Herdr's
# main layout with a Crew block above its own, unchanged Agents list). Run it from
# any terminal while the Herdr app is open. Safe to run again: it updates the mod
# and the two layouts, and adds the Crew block to harbormaster-main only if missing.
#
# Usage: herdr-app/install.sh [--captain-pane]
#   --captain-pane  also opens the runs overview as a pane beside the captain
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
captain_pane=
case ${1:-} in
  "") ;;
  --captain-pane) captain_pane=1 ;;
  *) echo "usage: install.sh [--captain-pane]" >&2; exit 2 ;;
esac

die() { echo "install.sh: $*" >&2; exit 1; }
command -v herdr-app >/dev/null || die "herdr-app is not on PATH"
command -v jq >/dev/null || die "needs jq"
herdr-app status >/dev/null 2>&1 || die "open the Herdr app first; this uses its layout.clone"

# 1. The mod and both layouts are ours: copy them over whatever is there.
mkdir -p "$home/mods/harbormaster" "$home/layouts"
cp "$here"/mods/harbormaster/* "$home/mods/harbormaster/"
cp "$here"/layouts/harbormaster-board.json "$here"/layouts/harbormaster-board.svg \
   "$here"/layouts/harbormaster-sea.json "$here"/layouts/harbormaster-sea.svg "$home/layouts/"
echo "installed mods/harbormaster and layouts harbormaster-board, harbormaster-sea"

# 2. harbormaster-main: a clone of Herdr's main layout (made here, so whatever main
#    looks like in this Herdr) with the Crew block inserted above the Agents list.
main="$home/layouts/harbormaster-main.json"
if [ ! -f "$main" ]; then
  herdr-app do layout.clone '{"name":"main","as":"harbormaster-main"}' >/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -f "$main" ] && break; sleep 0.5; done
  [ -f "$main" ] || die "layout.clone did not create layouts/harbormaster-main.json"
fi
tmp=$(mktemp)
jq '
  def crew: {"id": "crew", "type": "block", "size": {"weight": 0.6}, "min": 90,
             "content": {"mod": "harbormaster", "props": {"role": "crew"}}};
  if ([.. | objects | select(.content.mod? == "harbormaster" and .content.props.role? == "crew")] | length) > 0 then .
  else walk(if type == "object" and (.children? | type) == "array" and any(.children[]; .content.mod? == "agents")
            then .children |= map(if .content.mod? == "agents" then (crew, .) else . end) else . end)
  end' "$main" > "$tmp"
if ! cmp -s "$tmp" "$main"; then
  cat "$tmp" > "$main"
  echo "added the Crew block to harbormaster-main"
fi
rm -f "$tmp"
grep -q '"role": "crew"' "$main" || echo "install.sh: no Agents block found in main; harbormaster-main has no Crew block" >&2

# 3. Check the mod.
herdr-app check "$home/mods/harbormaster"

if [ -n "$captain_pane" ]; then
  "$here/captain-pane.sh"
fi

cat <<'EOF'

Done. Switch layouts with ctrl-shift-l, or:
  herdr-app do layout.switch '{"name":"harbormaster-main"}'   # your usual window, with the Crew block
  herdr-app do layout.switch '{"name":"harbormaster-board"}'  # the run board
  herdr-app do layout.switch '{"name":"harbormaster-sea"}'    # the harbor
Open the overview beside the captain: herdr-app/captain-pane.sh
EOF
