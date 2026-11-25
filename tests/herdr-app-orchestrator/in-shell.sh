#!/usr/bin/env bash
# Checks that an agent started with start-agent.sh gets the user's interactive shell environment:
# it sees a PATH folder only ~/.bashrc adds, behind the standard "not interactive: return" guard
# (as nvm's lines are), for a plain kind, Claude Code's task argument and opencode's `env ...`
# form; that the shell execs it (the agent is the process hc started, so no shell is left once it
# exits); and that with no usable $SHELL it still starts, without that folder. A fake hc runs the
# command as herdr-core would, with a bare environment and a throwaway HOME. No model turns,
# nothing written outside a temporary folder.
#
# Usage: bash tests/herdr-app-orchestrator/in-shell.sh
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
start=$repo/skills/herdr-app-orchestrator/scripts/start-agent.sh
command -v jq >/dev/null || { echo "needs jq" >&2; exit 1; }
bash=$(command -v bash)

tmp=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
failed=0
check() { # check <description> <got> <want>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "  got:  $(printf %q "$2")"; echo "  want: $(printf %q "$3")"; failed=1; fi
}

home=$tmp/home bin=$tmp/bin out=$tmp/out
mkdir -p "$home/nvm/bin" "$bin" "$out"
cat >"$home/.bashrc" <<'RC'
# ~/.bashrc: executed by bash(1) for non-login shells.
case $- in
    *i*) ;;
      *) return;;
esac
echo "Welcome, have a banner"
export PATH="$HOME/nvm/bin:$PATH"
RC
printf '#!/bin/sh\necho npx\n' >"$home/nvm/bin/npx"; chmod +x "$home/nvm/bin/npx"

# The fake hc: `run` starts the argv after -- with only what herdr-core gives a terminal (a bare
# PATH, HOME, SHELL as the test sets it), records its pid and waits for it; the rest say it is live
# and idle (once started) and took its task.
cat >"$bin/hc" <<'HC'
#!/usr/bin/env bash
case $1 in
  run)
    while [ "$1" != -- ]; do shift; done; shift
    env -i HOME="$FAKE_HOME" OUT="$OUT" PATH=/usr/bin:/bin ${FAKE_SHELL:+SHELL="$FAKE_SHELL"} "$@" </dev/null >"$OUT/screen" 2>&1 &
    echo $! >"$OUT/hc-pid"
    wait $!
    echo '{}' ;;
  get) [ -e "$OUT/hc-pid" ] && echo '{"state": "live", "address": "t1", "status": {"state": "idle"}}' || echo '{"state": "gone"}' ;;
  send) echo '{"started": true}' ;;
  *) ;;
esac
HC
# The agent: what it sees, and its own pid (bash's $$, kept by exec).
cat >"$bin/agent" <<'AGENT'
#!/usr/bin/env bash
{ echo "pid $$"; echo "path $PATH"; echo "npx $(command -v npx)"; echo "config ${OPENCODE_CONFIG_CONTENT:-}"
  i=0; for a in "$@"; do echo "arg$i $a"; i=$((i + 1)); done; } >"$OUT/seen"
AGENT
chmod +x "$bin/hc" "$bin/agent"
for k in claude opencode; do ln -s agent "$bin/$k"; done
export PATH=$bin:$PATH OUT=$out FAKE_HOME=$home

seen() { sed -n "s/^$1 //p" "$out/seen"; }
task_file=$tmp/task
printf '%s' "/herdr-app-orchestrator 12 \$(touch $tmp/ran) \"quoted\" 'single'" >"$task_file"
go() { rm -f "$out/seen" "$out/hc-pid"; FAKE_SHELL=$1 bash "$start" --name a --cwd "$tmp" --task-file "$task_file" "${@:2}" >/dev/null; }

go "$bash" --kind "$bin/agent"
check "plain kind: sees ~/.bashrc's PATH folder" "$(seen npx)" "$home/nvm/bin/npx"
check "plain kind: is the process hc started (exec, no shell left)" "$(seen pid)" "$(cat "$out/hc-pid")"
check "plain kind: the banner was printed, then cleared" "$(tr -d '\n' <"$out/screen" | grep -c $'have a banner.*\033\[3J')" "1"

go "$bash" --kind claude --model sonnet
check "claude: sees ~/.bashrc's PATH folder" "$(seen npx)" "$home/nvm/bin/npx"
check "claude: its task is its last argument, unchanged" "$(seen "arg$(($(grep -c '^arg' "$out/seen") - 1))")" "$(cat "$task_file")"
check "claude: the task was not run by a shell" "$([ -e "$tmp/ran" ] && echo ran)" ""
check "claude: --model and --settings first" "$(seen arg0) $(seen arg1) $(seen arg2)" "--model sonnet --settings"

go "$bash" --kind opencode --model lab/qwen
check "opencode with a model: env form gets its config" "$(seen config)" '{"model":"lab/qwen"}'
check "opencode with a model: --standalone" "$(seen arg0)" "--standalone"
check "opencode with a model: sees ~/.bashrc's PATH folder" "$(seen npx)" "$home/nvm/bin/npx"
check "opencode with a model: env exec'd it too" "$(seen pid)" "$(cat "$out/hc-pid")"

go "" --kind "$bin/agent"
check "no SHELL: still starts, as the process hc started" "$(seen pid)" "$(cat "$out/hc-pid")"
check "no SHELL: the bare PATH" "$(seen path)" "/usr/bin:/bin"

go /bin/false-shell --kind "$bin/agent"
check "SHELL not there: still starts" "$(seen path)" "/usr/bin:/bin"

printf '#!/bin/sh\nexit 3\n' >"$bin/csh"; chmod +x "$bin/csh"
go "$bin/csh" --kind "$bin/agent"
check "a shell in-shell.sh does not know: started directly" "$(seen path)" "/usr/bin:/bin"

if zsh=$(command -v zsh); then
  printf 'export PATH="$HOME/nvm/bin:$PATH"\n' >"$home/.zshrc"
  go "$zsh" --kind "$bin/agent"
  check "zsh: sees ~/.zshrc's PATH folder" "$(seen npx)" "$home/nvm/bin/npx"
else echo "skip zsh: not installed"; fi
if fish=$(command -v fish); then
  mkdir -p "$home/.config/fish"; printf 'set -gx PATH $HOME/nvm/bin $PATH\n' >"$home/.config/fish/config.fish"
  go "$fish" --kind "$bin/agent" --arg 'two words'
  check "fish: sees config.fish's PATH folder" "$(seen npx)" "$home/nvm/bin/npx"
  check "fish: an argument with a space stays one" "$(seen arg0)" "two words"
else echo "skip fish: not installed"; fi

exit $failed
