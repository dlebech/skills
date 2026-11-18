#!/usr/bin/env bash
# Installs Harbormaster into the Herdr app on this computer: the `harbormaster` mod,
# the harbormaster-sea layout, and harbormaster-main (Herdr's main layout made calm: the
# Crew block opens with the Needs-you box and takes the height, Herdr's own Spaces list
# stays below it with "This computer" and each machine, Herdr's Agents list is gone), and
# binds ctrl-shift-h to open and close the overview. Run it from any terminal while the
# Herdr app is open. Safe to run again: it updates the mod and the sea layout, makes
# harbormaster-main calm once and then leaves it alone (except that it swaps the Spaces
# picker of an earlier version for Herdr's Spaces list), and adds the key only if it is missing. It refuses to
# replace a mod or layout of the same name that isn't Harbormaster's, and removes the
# harbormaster-board and harbormaster-needs layouts of earlier versions, and the Harbor 3D
# copy of an earlier version (Harbor 3D is not installed: it runs from the repository).
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

# 1. The mod and the sea layout. Herdr's rule is never to overwrite someone else's mod
#    or layout, so replace them only when they are an earlier Harbormaster.
ours() { # <file> <jq test>: true when the file is missing or passes the test
  [ ! -e "$1" ] || jq -e "$2" "$1" >/dev/null 2>&1
}
{ [ ! -e "$home/mods/harbormaster" ] || jq -e '.title == "Harbormaster"' "$home/mods/harbormaster/mod.json" >/dev/null 2>&1; } \
  || die "mods/harbormaster exists and isn't Harbormaster; move it aside first"
ours "$home/layouts/harbormaster-sea.json" '.id == "hs-root"' \
  || die "layouts/harbormaster-sea.json exists and isn't Harbormaster's; move it aside first"
mkdir -p "$home/mods/harbormaster" "$home/layouts"
# timing.sh and categories.tsv are read by timing.js and run as text, so they need no
# execute bit there.
cp "$here"/mods/harbormaster/*.js "$here"/mods/harbormaster/*.svg "$here"/mods/harbormaster/mod.json \
  "$here"/mods/harbormaster/timing.sh "$here"/mods/harbormaster/categories.tsv "$home/mods/harbormaster/"
cp "$here"/layouts/harbormaster-sea.json "$here"/layouts/harbormaster-sea.svg "$home/layouts/"
echo "installed mods/harbormaster and the harbormaster-sea layout"
# board.js became overview.js.
rm -f "$home/mods/harbormaster/board.js"
# The run board of earlier versions; its views are gone from the mod. Only ours.
if [ -f "$home/layouts/harbormaster-board.json" ] && jq -e '.id == "hb-root"' "$home/layouts/harbormaster-board.json" >/dev/null 2>&1; then
  rm -f "$home/layouts/harbormaster-board.json" "$home/layouts/harbormaster-board.svg"
  echo "removed the harbormaster-board layout of an earlier version"
fi
# The test layout of the calm sidebar; harbormaster-main is that layout now. Only ours
# (a needs layout of the user's own keeps its name and its file).
if [ -f "$home/layouts/harbormaster-needs.json" ] && jq -e '.id == "hn-root"' "$home/layouts/harbormaster-needs.json" >/dev/null 2>&1; then
  rm -f "$home/layouts/harbormaster-needs.json" "$home/layouts/harbormaster-needs.svg"
  echo "removed the harbormaster-needs test layout (harbormaster-main is that layout now)"
fi

# 2. harbormaster-main: a clone of Herdr's main layout (made here, so whatever main
#    looks like in this Herdr), made calm. A Crew block is added above the Agents list
#    when there is none (a fresh clone), then needs-layout.jq drops Herdr's Agents block,
#    keeps Herdr's Spaces block, moved just below Crew (half of Crew's height) and gives Crew the Needs-you box
#    and the height that is left. This happens once: main from an older install is
#    upgraded in place, and a main that already has Crew with the box is left alone.
main="$home/layouts/harbormaster-main.json"
if [ ! -f "$main" ]; then
  herdr-app do layout.clone '{"name":"main","as":"harbormaster-main"}' >/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -f "$main" ] && break; sleep 0.5; done
  [ -f "$main" ] || die "layout.clone did not create layouts/harbormaster-main.json"
fi
# Calm means a Crew block with needs: "box" (only this marker: crew.js draws the calm Crew whatever the prop). Once main has one, it is the user's file:
# nothing is redone (their resizing, an Agents block they added back stay).
calm='[.. | objects | select(.content.mod? == "harbormaster" and .content.props.role? == "crew" and .content.props.needs? == "box")] | length > 0'
if ! jq -e "$calm" "$main" >/dev/null; then
  tmp=$(mktemp)
  jq '
    def crew: {"id": "crew", "type": "block", "size": {"weight": 0.6}, "min": 90,
               "content": {"mod": "harbormaster", "props": {"role": "crew"}}};
    if ([.. | objects | select(.content.mod? == "harbormaster" and .content.props.role? == "crew")] | length) > 0 then .
    else walk(if type == "object" and (.children? | type) == "array" and any(.children[]; .content.mod? == "agents")
              then .children |= map(if .content.mod? == "agents" then (crew, .) else . end) else . end)
    end' "$main" | jq -f "$here/needs-layout.jq" > "$tmp"
  # With no Crew block and no Agents block to put it above there is nothing to build from.
  if ! jq -e "$calm" "$tmp" >/dev/null 2>&1; then
    echo "install.sh: harbormaster-main has no Crew block (and no Agents block to add it above); left unchanged" >&2
  else
    cat "$tmp" > "$main"
    echo "made harbormaster-main the calm layout"
  fi
  rm -f "$tmp"
fi

# 2b. Earlier versions put a one-row Spaces picker in harbormaster-main. Herdr's own Spaces
#     list shows "This computer" and every machine, each with its own "+", so the picker
#     becomes that block, in the same place. Every run; nothing else in the file changes,
#     and a layout without the picker is not touched.
picker='[.. | objects | select(.content.mod? == "harbormaster" and .content.props.role? == "spaces")] | length > 0'
if [ -f "$main" ] && jq -e "$picker" "$main" >/dev/null 2>&1; then
  tmp=$(mktemp)
  if jq --argjson pickerOnly true -f "$here/needs-layout.jq" "$main" > "$tmp" && jq -e . "$tmp" >/dev/null; then
    cat "$tmp" > "$main"
    echo "replaced the Spaces picker in harbormaster-main with Herdr's Spaces list"
  else
    echo "install.sh: could not replace the Spaces picker in harbormaster-main; left unchanged" >&2
  fi
  rm -f "$tmp"
fi

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

# 3b. Harbor 3D is not installed (it runs from the repository); an earlier version copied it
#     to <home>/harbor3d. Only ours (package.json named harbor3d): any other folder stays.
h3="$home/harbor3d"
if [ -f "$h3/package.json" ] && jq -e '.name == "harbor3d"' "$h3/package.json" >/dev/null 2>&1; then
  rm -rf "$h3"
  echo "removed the Harbor 3D copy of an earlier version (it runs from the repository now)"
fi

# 4. Check the mod.
herdr-app check "$home/mods/harbormaster"

cat <<'EOF'

Done. ctrl-shift-h opens and closes the overview. Switch layouts with ctrl-shift-l, or:
  herdr-app do layout.switch '{"name":"harbormaster-main"}'   # your usual window, calm: Needs-you box, Crew, Herdr's Spaces list
  herdr-app do layout.switch '{"name":"harbormaster-sea"}'    # the harbor
To keep the overview beside the captain, click "Pin beside captain" on the captain's card.
EOF
