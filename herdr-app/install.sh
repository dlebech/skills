#!/usr/bin/env bash
# Installs the runs view into the Herdr app on this computer: the `runs` mod, the
# runs-board and runs-pasture layouts, and agents-runs (Herdr's Agents list,
# cloned and patched) in a main-runs layout. Run it from any terminal while the
# Herdr app is open. Safe to run again: it updates the runs mod and layouts, and
# re-patches agents-runs only when it lacks this version's changes.
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
herdr-app status >/dev/null 2>&1 || die "open the Herdr app first; this uses its mod.clone and layout.clone"
command -v patch >/dev/null || die "needs patch"

# 1. The runs mod and both layouts are ours: copy them over whatever is there.
mkdir -p "$home/mods/runs" "$home/layouts"
cp "$here"/mods/runs/* "$home/mods/runs/"
cp "$here"/layouts/runs-board.json "$here"/layouts/runs-board.svg \
   "$here"/layouts/runs-pasture.json "$here"/layouts/runs-pasture.svg "$home/layouts/"
echo "installed mods/runs and layouts runs-board, runs-pasture"

# 2. agents-runs: a clone of Herdr's own Agents list, with the patch applied.
mods="$home/mods"
if [ -f "$mods/agents-runs/main.js" ] && grep -q "roleCard" "$mods/agents-runs/main.js"; then
  echo "mods/agents-runs is already patched"
else
  if [ -e "$mods/agents-runs" ]; then
    # Outside mods/, so Herdr does not load the old copy as a second mod.
    backup="$home/agents-runs.backup-$(date +%Y%m%d%H%M%S)"
    mv "$mods/agents-runs" "$backup"
    echo "moved the old mods/agents-runs to $backup"
  fi
  herdr-app do mod.clone '{"name":"agents","as":"agents-runs"}' >/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -f "$mods/agents-runs/main.js" ] && break; sleep 0.5; done
  [ -f "$mods/agents-runs/main.js" ] || die "mod.clone did not create mods/agents-runs"
  if ! patch -s -d "$mods/agents-runs" -p1 < "$here/agents-runs.patch"; then
    rm -f "$mods/agents-runs"/*.orig "$mods/agents-runs"/*.rej
    die "the patch does not fit this Herdr's agents mod (it was made for Herdr 0.1.12). Give an agent in the app the prompt in docs/herdr-app-runs-view.md instead."
  fi
  rm -f "$mods/agents-runs"/*.orig
  echo "cloned and patched mods/agents-runs"
fi

# 3. main-runs: a clone of the main layout whose Agents block shows agents-runs.
if [ ! -f "$home/layouts/main-runs.json" ]; then
  herdr-app do layout.clone '{"name":"main","as":"main-runs"}' >/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -f "$home/layouts/main-runs.json" ] && break; sleep 0.5; done
fi
if grep -Eq '"mod": *"agents"' "$home/layouts/main-runs.json"; then
  tmp=$(mktemp)
  sed -E 's/("mod": *)"agents"/\1"agents-runs"/' "$home/layouts/main-runs.json" > "$tmp"
  cat "$tmp" > "$home/layouts/main-runs.json"
  rm -f "$tmp"
  echo "pointed main-runs's Agents block at agents-runs"
fi

# 4. Check both mods.
herdr-app check "$mods/runs"
herdr-app check "$mods/agents-runs"

if [ -n "$captain_pane" ]; then
  "$here/captain-pane.sh"
fi

cat <<'EOF'

Done. Switch layouts with ctrl-shift-l, or:
  herdr-app do layout.switch '{"name":"main-runs"}'     # your usual window, runs in the Agents list
  herdr-app do layout.switch '{"name":"runs-board"}'    # the run board
  herdr-app do layout.switch '{"name":"runs-pasture"}'  # the pasture
Open the overview beside the captain: herdr-app/captain-pane.sh
EOF
