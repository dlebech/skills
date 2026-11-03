#!/usr/bin/env bash
# Opens the Harbormaster runs overview (the `harbormaster` mod) as a pane to the right of the captain's
# terminal, in the captain's tab. Run from any terminal while the Herdr app is open.
set -euo pipefail
command -v jq >/dev/null || { echo "captain-pane.sh: needs jq" >&2; exit 1; }
captain=$(hc ls --json --label role=captain | jq -r '.terminals[0].address // empty')
[ -n "$captain" ] || { echo "captain-pane.sh: no terminal labelled role=captain; start /herdr-app-captain first" >&2; exit 1; }
layout=$(herdr-app ls)
pane=$(jq -r --arg t "$captain" '.spaces[].tabs[].terminals[] | select(.terminal == $t) | .pane' <<<"$layout" | head -1)
[ -n "$pane" ] || { echo "captain-pane.sh: the captain ($captain) has no pane in this window" >&2; exit 1; }
herdr-app do pane.split "$(jq -nc --arg p "$pane" '{direction: "right", pane: $p, mod: "harbormaster"}')"
