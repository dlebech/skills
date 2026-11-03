#!/usr/bin/env bash
# Installs Harbormaster into the Herdr app on this computer: the `harbormaster` mod,
# the harbormaster-board and harbormaster-sea layouts, and harbormaster-main (Herdr's
# main layout with a Crew block above its own, unchanged Agents list), and binds
# ctrl-shift-h to open and close the overview. Run it from any terminal while the
# Herdr app is open. Safe to run again: it updates the mod and the two layouts, and
# adds the Crew block and the key only if they are missing. It refuses to replace a
# mod or layout of the same name that isn't Harbormaster's.
#
# Usage: herdr-app/install.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
[ $# -eq 0 ] || { echo "usage: install.sh" >&2; exit 2; }

die() { echo "install.sh: $*" >&2; exit 1; }
command -v herdr-app >/dev/null || die "herdr-app is not on PATH"
command -v jq >/dev/null || die "needs jq"
herdr-app status >/dev/null 2>&1 || die "open the Herdr app first; this uses its layout.clone"

# 1. The mod and both layouts. Herdr's rule is never to overwrite someone else's mod
#    or layout, so replace them only when they are an earlier Harbormaster.
ours() { # <file> <jq test>: true when the file is missing or passes the test
  [ ! -e "$1" ] || jq -e "$2" "$1" >/dev/null 2>&1
}
{ [ ! -e "$home/mods/harbormaster" ] || jq -e '.title == "Harbormaster"' "$home/mods/harbormaster/mod.json" >/dev/null 2>&1; } \
  || die "mods/harbormaster exists and isn't Harbormaster; move it aside first"
for layout in board:hb-root sea:hs-root; do
  ours "$home/layouts/harbormaster-${layout%%:*}.json" ".id == \"${layout#*:}\"" \
    || die "layouts/harbormaster-${layout%%:*}.json exists and isn't Harbormaster's; move it aside first"
done
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
jq -e '[.. | objects | select(.content.mod? == "harbormaster" and .content.props.role? == "crew")] | length > 0' "$main" >/dev/null \
  || echo "install.sh: no Agents block found in main; harbormaster-main has no Crew block" >&2

# 3. ctrl-shift-h opens and closes the overview as a popup, unless that key is taken
#    in any section (a layout's or mod's own binding wins over global). keys.json holds
#    every key, so without one there is nothing safe to add to.
keys="$home/keys.json"
bind_hint='add "ctrl-shift-h": "mod.open:harbormaster" (or another free key) under "global" in keys.json'
if [ ! -f "$keys" ]; then
  echo "no keys.json yet; to toggle the overview with a key, $bind_hint"
elif jq -e '[.[] | objects | to_entries[] | select(.value == "mod.open:harbormaster")] | length > 0' "$keys" >/dev/null; then
  :
elif jq -e '[.[] | objects | has("ctrl-shift-h")] | any' "$keys" >/dev/null; then
  echo "ctrl-shift-h is taken in keys.json; to toggle the overview with a key, $bind_hint"
else
  tmp=$(mktemp)
  jq '.global = ((.global // {}) + {"ctrl-shift-h": "mod.open:harbormaster"})' "$keys" > "$tmp" && cat "$tmp" > "$keys"
  rm -f "$tmp"
  echo "bound ctrl-shift-h to open and close the overview"
fi

# 4. Check the mod.
herdr-app check "$home/mods/harbormaster"

cat <<'EOF'

Done. ctrl-shift-h opens and closes the overview. Switch layouts with ctrl-shift-l, or:
  herdr-app do layout.switch '{"name":"harbormaster-main"}'   # your usual window, with the Crew block
  herdr-app do layout.switch '{"name":"harbormaster-board"}'  # the run board
  herdr-app do layout.switch '{"name":"harbormaster-sea"}'    # the harbor
To keep the overview beside the captain, click "Pin beside captain" on the captain's card.
EOF
