#!/usr/bin/env bash
# Print the absolute path of an agent program (claude, pi, opencode, codex, ...), or exit 1.
#
# Usage: agent-path.sh PROGRAM
#
# Herdr and its terminals often run with a narrower PATH than the user's own shell: an app
# started from the desktop gets ~/.profile's PATH, never ~/.bashrc's, where installers such as
# opencode's add their folder (~/.opencode/bin). `hc run -- opencode` then fails with "No such
# file or directory". So this looks on PATH, then on the user's interactive login shell's PATH,
# then in the folders installers commonly use, and start-agent.sh runs the program by the path
# it prints.
set -uo pipefail

prog=${1:-}
[ -n "$prog" ] || { echo "usage: agent-path.sh PROGRAM" >&2; exit 2; }
case $prog in */*) [ -x "$prog" ] && { printf '%s\n' "$prog"; exit 0; }; exit 1 ;; esac

found=$(command -v "$prog" 2>/dev/null) && [ "${found#/}" != "$found" ] && { printf '%s\n' "$found"; exit 0; }

# The login shell's PATH. Interactive, since ~/.bashrc returns early otherwise; its output
# (a banner, a job-control warning) is ignored by the marker.
shell_path=$(timeout 5 "${SHELL:-bash}" -lic 'printf "\n__AGENT_PATH__%s\n" "$PATH"' </dev/null 2>/dev/null |
  sed -n 's/^__AGENT_PATH__//p' | tail -n 1)
extra="$HOME/.local/bin:$HOME/.$prog/bin:$HOME/.bun/bin:$HOME/.npm-global/bin:$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin"
found=$(PATH="${shell_path:+$shell_path:}$extra" command -v "$prog" 2>/dev/null) && [ "${found#/}" != "$found" ] &&
  { printf '%s\n' "$found"; exit 0; }
exit 1
