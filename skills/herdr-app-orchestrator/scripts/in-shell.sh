#!/bin/sh
# Run a program (an agent) through the user's interactive shell, which execs it.
#
# Usage: in-shell.sh PROGRAM [ARG]...
#
# An agent started with `hc run -- <agent>` (or Herdr's tab.new / space.new with an argv) is the
# terminal's root program: no shell runs before it, so it gets only herdr-core's environment, which
# is the login session's (about ~/.profile). Whatever an installer put in ~/.bashrc is missing, such
# as nvm's node, npm and npx, which an MCP server started with npx needs. So this runs $SHELL -ic
# (interactive, since a standard ~/.bashrc returns early otherwise) and that shell execs the program.
# The exec chain leaves the program as the terminal's root process: hc sees it as before (status,
# exit, first message, trust prompt), and no shell is left once it exits, so its terminal ends.
# The shell's own output (a banner) is cleared before the program starts. The arguments pass as
# arguments, never parsed by a shell. With $SHELL unset, not executable or of a kind not known
# here, the program runs directly. An rc file that never gets to the end (one that attaches tmux,
# execs another shell, asks a question such as oh-my-zsh's update prompt, or exits) keeps the
# agent from starting: Claude Code's task never runs, and start-agent.sh says `timeout` or `exited`.
#
# Harbormaster has the same lines (startrun.js IN_SHELL; tests/herdr-app-harbormaster/
# launch-argv.test.mjs checks they match), for the agents it starts in a tab of its own.
s=${SHELL:-}
[ -x "$s" ] || exec "$@"
case ${s##*/} in
  bash|zsh|ksh|ksh93|mksh) exec "$s" -ic 'printf "\033[H\033[2J\033[3J"; exec "$0" "$@"' "$@" ;;
  fish) exec "$s" -ic 'printf "\x1b[H\x1b[2J\x1b[3J"; exec $argv' "$@" ;;
esac
exec "$@"
