#!/usr/bin/env bash
# Checks that tokens.sh counts opencode sessions, against a throwaway opencode database
# with known token numbers (both table generations, a session before the run's start, a
# sub-session of the orchestrator, a folder outside the run). No model turns, nothing
# written outside a temporary folder.
#
# Usage: tests/herdr-app-orchestrator/tokens-opencode.sh
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
tokens=$repo/skills/herdr-app-orchestrator/scripts/tokens.sh
command -v python3 >/dev/null && command -v jq >/dev/null || { echo "needs python3 and jq" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export OPENCODE_DATA_DIR=$tmp/opencode CLAUDE_CONFIG_DIR=$tmp/claude PI_CODING_AGENT_DIR=$tmp/pi
export HERDR_WORKTREES_ROOT=$tmp/wt
mkdir -p "$OPENCODE_DATA_DIR" "$CLAUDE_CONFIG_DIR" "$PI_CODING_AGENT_DIR"
run=$tmp/run
mkdir -p "$run"
started=2026-11-16T10:00:00.000Z
jq -n --arg s "$started" --arg f "$tmp/repo" '{branch: "feat-x", folder: $f, started: $s}' >"$run/orchestrator.json"
printf 'Status: running\nPrefix: xx\nRepos: repo %s\n' "$tmp/repo" >"$run/plan.md"
echo "opencode ses_orch" >"$run/sessions"

wt=$tmp/wt/repo
python3 - "$OPENCODE_DATA_DIR/opencode.db" "$wt" "$tmp/repo" "$(date -u -d "$started" +%s%3N)" <<'PY'
import sqlite3, sys, json
db, wt, repo, t0 = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
c = sqlite3.connect(db)
# The columns opencode creates (from its own database), both generations.
c.executescript("""
CREATE TABLE `session` (`id` text PRIMARY KEY, `project_id` text NOT NULL, `parent_id` text, `slug` text NOT NULL,
  `directory` text NOT NULL, `title` text NOT NULL, `version` text NOT NULL, `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL);
CREATE TABLE `message` (`id` text PRIMARY KEY, `session_id` text NOT NULL, `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL, `data` text NOT NULL);
CREATE TABLE `session_v2` (`id` text PRIMARY KEY, `project_id` text NOT NULL, `parent_id` text, `slug` text NOT NULL,
  `directory` text NOT NULL, `title` text, `version` text NOT NULL, `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL);
CREATE TABLE `session_message` (`id` text PRIMARY KEY, `session_id` text NOT NULL, `type` text NOT NULL,
  `seq` integer NOT NULL, `time_created` integer NOT NULL, `time_updated` integer NOT NULL, `data` text NOT NULL);
""")
def session(table, sid, directory, parent=None):
    c.execute("insert into %s (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)"
              " values (?, 'p', ?, 's', ?, 't', '1', ?, ?)" % table, (sid, parent, directory, t0 + 1, t0 + 1))
n = [0]
def tokens(i, o, r, w, reasoning=0):
    return {"input": i, "output": o, "reasoning": reasoning, "cache": {"read": r, "write": w}}
def v1(sid, role, when, tk=None):
    n[0] += 1
    d = {"role": role}
    if tk: d["tokens"] = tk
    c.execute("insert into message values (?, ?, ?, ?, ?)", ("m%d" % n[0], sid, t0 + when, t0 + when, json.dumps(d)))
def v2(sid, typ, when, tk=None):
    n[0] += 1
    d = {"time": {"created": t0 + when}}
    if tk: d["tokens"] = tk
    c.execute("insert into session_message values (?, ?, ?, ?, ?, ?, ?)", ("m%d" % n[0], sid, typ, n[0], t0 + when, t0 + when, json.dumps(d)))
session("session", "ses_A", wt + "/xx-t1")
v1("ses_A", "user", 1000)
v1("ses_A", "assistant", 2000, tokens(10, 20, 30, 40, reasoning=5))
v1("ses_A", "assistant", 3000, tokens(1, 2, 3, 4))
v1("ses_A", "assistant", -5000, tokens(1000, 1000, 1000, 1000))     # before the run started
session("session_v2", "ses_B", wt + "/xx-t2")
v2("ses_B", "user", 1000)
v2("ses_B", "assistant", 2000, tokens(100, 200, 300, 400))
v2("ses_B", "compaction", 3000, tokens(7, 0, 0, 0))
session("session_v2", "ses_C", wt + "/feat-x")
v2("ses_C", "assistant", 2000, tokens(1, 1, 1, 1))
session("session_v2", "ses_D", wt + "/other")                          # not this run's
v2("ses_D", "assistant", 2000, tokens(9999, 9999, 9999, 9999))
session("session_v2", "ses_orch", repo)
v2("ses_orch", "assistant", 2000, tokens(5, 5, 5, 5))
session("session_v2", "ses_sub", repo, parent="ses_orch")
v2("ses_sub", "assistant", 2000, tokens(2, 2, 2, 2))
c.commit()
PY

fail=0
check() { # check <what> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok   $1: $3"; else echo "FAIL $1: expected $2, got $3"; fail=1; fi
}
count() { "$tokens" --print "$run" | jq -c "$1"; }

# A: 11 27 33 44   B (+ compaction): 107 200 300 400   C: 1 1 1 1   orchestrator: 7 7 7 7
check "input" 126 "$(count .input)"
check "output (reasoning included)" 235 "$(count .output)"
check "cache read" 341 "$(count .cache_read)"
check "cache write" 452 "$(count .cache_write)"
check "total" 1154 "$(count .total)"
check "by agent" '[["orchestrator",28],["xx-t2",1007],["xx-t1",115],["integration",4]]' \
  "$(count '[.by_agent[] | [.name, .total]] | sort_by(if .[0] == "orchestrator" then 0 else 1 end, -.[1])')"
check "rerun is the same" 1154 "$(count .total)"

# A message added later is counted once more, and the earlier ones are not counted again.
python3 - "$OPENCODE_DATA_DIR/opencode.db" "$(date -u -d "$started" +%s%3N)" <<'PY'
import sqlite3, sys, json
c = sqlite3.connect(sys.argv[1]); t = int(sys.argv[2]) + 9000
c.execute("insert into message values ('m_new', 'ses_A', ?, ?, ?)",
          (t, t, json.dumps({"role": "assistant", "tokens": {"input": 1, "output": 1, "reasoning": 0, "cache": {"read": 1, "write": 1}}})))
c.commit()
PY
check "a new message" 1158 "$(count .total)"

# A count never drops: opencode deleting a message leaves what was counted.
python3 -c "
import sqlite3, sys
c = sqlite3.connect(sys.argv[1]); c.execute(\"delete from message where id = 'm_new'\"); c.commit()" "$OPENCODE_DATA_DIR/opencode.db"
check "after a message is deleted" 1158 "$(count .total)"

# No database: nothing from opencode, and no failure.
rm -rf "$run/.tokens"; check "no opencode data" 0 "$(OPENCODE_DATA_DIR=$tmp/none count .total)"
exit $fail
