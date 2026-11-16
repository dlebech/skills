#!/usr/bin/env bash
# Checks herdr-app/mods/harbormaster/timing.sh on synthetic logs with known answers, in a
# throwaway root (no model turns, no real logs read):
#   - an orchestrator (Claude Code) that waits on its agents with `hc wait`, writes a
#     question.md and waits for the answer (user_wait), then idles while an agent works
#     (agent_wait) and while none does (idle); lines before the run's start, a
#     sub-agent's line and a half-written last line are left out;
#   - an implementer and a reviewer sharing a worktree (Claude Code), told apart by their
#     first prompt; parallel tool calls; a here-document that mentions `npm test` is
#     not a test; a reviewer's time is review, but its test run stays test; its idle
#     time between turns is not counted;
#   - a pi agent, an opencode agent in each of opencode.db's table generations, and one
#     in opencode's older storage/ files;
#   - one category a call: a commit message quoting `npm test` is git, `timeout 300 bash
#     tests/a.sh`, a for loop over tests and a quoted `hc run` of a test are test; sleep
#     is agent_wait for the orchestrator, other for an agent; a question.md written
#     elsewhere (a demo) does not open a question; a call over 30 minutes is
#     capped; a call with no result ends at the next prompt; a <tagged> harness message
#     does not answer an open question;
#   - per-task sums, critical_path, the tokens copied from status.json, the cache (an
#     unchanged rerun gives the same result; a changed file is reread, from where it
#     stopped; a change to the script's logic rereads all; reading in small chunks gives
#     the same result; a killed run's scratch folder is cleaned up), the table on stdin,
#     a log written with spaces in its JSON, and a closed run's end.
# Needs jq and python3.
set -u
here=$(cd "$(dirname "$0")" && pwd)
script=$here/../../herdr-app/mods/harbormaster/timing.sh
table=$here/../../herdr-app/mods/harbormaster/categories.tsv
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fails=0
check() { # <what> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected $2, got $3"; fails=$((fails + 1)); fi
}

export CLAUDE_CONFIG_DIR=$T/claude PI_CODING_AGENT_DIR=$T/pi OPENCODE_DATA_DIR=$T/opencode HERDR_WORKTREES_ROOT=$T/wt
run=$T/runs/demo/feat-x
mkdir -p "$run" "$T/wt/demo"
cat >"$run/orchestrator.json" <<EOF
{"terminal": "t1", "folder": "/src/demo", "branch": "feat/x", "kind": "claude", "started": "2026-11-16T10:00:00Z"}
EOF
printf 'Status: running\nPrefix: dx\nRepos: demo /src/demo\n' >"$run/plan.md"
printf 'claude orc-1\ncursor whatever\n' >"$run/sessions"
echo '{"tokens": {"total": 1234, "by_agent": []}}' >"$run/status.json"

python3 -I - "$T" <<'PY'
import json, os, sqlite3, sys
T = sys.argv[1]
RUN = os.path.join(T, "runs", "demo", "feat-x")
def iso(hms, day="2026-11-16"):
    return "%sT%s.000Z" % (day, hms)
def ms(hms):
    h, m, s = map(int, hms.split(":"))
    return 1794787200000 + ((h * 60 + m) * 60 + s) * 1000  # 2026-11-16T00:00:00Z
assert ms("00:00:00") // 1000 == 1794787200
def mangle(p):
    return "".join(c if c.isalnum() or c == "-" else "-" for c in p)

# Claude Code lines.
def user(t, text, **kw):
    return dict(type="user", timestamp=iso(t), isSidechain=False, message=dict(role="user", content=text), **kw)
def use(t, id, name, inp, stop="tool_use"):
    return dict(type="assistant", timestamp=iso(t), isSidechain=False,
                message=dict(id="m" + id, stop_reason=stop, content=[dict(type="tool_use", id=id, name=name, input=inp)]))
def res(t, id):
    return dict(type="user", timestamp=iso(t), isSidechain=False,
                message=dict(role="user", content=[dict(type="tool_result", tool_use_id=id, content="x")]))
def text(t, stop="end_turn"):
    return dict(type="assistant", timestamp=iso(t), isSidechain=False,
                message=dict(id="mt" + t, stop_reason=stop, content=[dict(type="text", text="ok")]))
def write(path, lines, tail="", compact=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for l in lines:
            f.write((json.dumps(l, separators=(",", ":")) if compact else json.dumps(l)) + "\n")
        f.write(tail)

orc = [
    user("09:00:00", "before the run"), text("09:00:05"),
    user("10:00:00", "/herdr-app-orchestrator build it"),
    use("10:00:10", "a", "Bash", {"command": "hc wait --children any --timeout 540"}),
    dict(type="assistant", timestamp=iso("10:01:00"), isSidechain=True, message=dict(id="side", stop_reason="end_turn", content=[])),
    res("10:05:10", "a"),
    use("10:05:20", "b", "Bash", {"command": "R=%s; cat > $R/.question.tmp <<'EOF'\n# Which?\nEOF\nmv $R/.question.tmp $R/question.md" % RUN}),
    res("10:05:21", "b"),
    text("10:05:30"),
    # The harness, not an answer: the question stays open.
    user("10:08:00", "<task-notification>a background job finished</task-notification>"), text("10:08:05"),
    user("10:15:30", "Read and act on /runs/x/inbox/20261116T101530Z-captain.message."),
    use("10:15:32", "s", "Bash", {"command": "sleep 5"}), res("10:15:37", "s"),
    # A demo question.md in another folder: not this run waiting.
    use("10:15:38", "z", "Bash", {"command": "D=~/demo/run; mv $D/.q.tmp $D/question.md"}), res("10:15:39", "z"),
    text("10:15:40"),
    dict(type="queue-operation", operation="enqueue", timestamp=iso("10:20:00"), content='<hc from="t9 impl-dx-t1">done: impl-dx-t1: ok</hc>'),
    text("10:20:05"),
]
proj = os.path.join(T, "claude", "projects", mangle("/src/demo"))
write(os.path.join(proj, "orc-1.jsonl"), orc, '{"type":"assistant","timestamp":"2026-11-16T10:30')
# A sub-agent's transcript: its time is the parent's Agent call, so it is not read.
write(os.path.join(proj, "orc-1", "subagents", "agent-1.jsonl"), [user("10:00:20", "x"), text("10:59:00")])

wt = os.path.join(T, "claude", "projects", mangle(os.path.join(T, "wt", "demo", "dx-t1")))
impl = [
    user("10:00:30", "You are impl-dx-t1. Read the brief."),
    dict(type="assistant", timestamp=iso("10:00:40"), isSidechain=False, message=dict(id="mc", stop_reason="tool_use", content=[
        dict(type="tool_use", id="c", name="Bash", input={"command": "cd /w && npm test", "description": "Run tests"}),
        dict(type="tool_use", id="d", name="Read", input={"file_path": "/w/a.js"})])),
    res("10:00:41", "d"), res("10:02:40", "c"),
    use("10:02:50", "e", "Bash", {"command": "bash -n x.sh; node --check a.js"}), res("10:02:55", "e"),
    use("10:03:00", "f", "Bash", {"command": "git commit -qm wip"}), res("10:03:02", "f"),
    use("10:03:10", "g", "Bash", {"command": "cat > notes.md <<'EOF'\nnpm test\nEOF"}), res("10:03:11", "g"),
    use("10:03:15", "h", "Bash", {"command": "sleep 880"}), res("10:17:55", "h"),
    text("10:18:00"),
]
write(os.path.join(wt, "impl-1.jsonl"), impl)
rev = [
    user("10:20:00", "You are rev-dx-t1. Read the review template."),
    use("10:20:10", "r1", "Bash", {"command": "npm test"}), res("10:21:10", "r1"),
    use("10:21:20", "r2", "Bash", {"command": "git diff feat/x...HEAD"}), res("10:21:22", "r2"),
    text("10:21:30"),
    user("10:50:00", "one more look"), text("10:50:10"),
]
write(os.path.join(wt, "rev-1.jsonl"), rev)
wt5 = os.path.join(T, "claude", "projects", mangle(os.path.join(T, "wt", "demo", "dx-t5")))
t5 = [
    user("10:20:10", "You are impl-dx-t5."),
    use("10:20:20", "A", "Bash", {"command": 'git commit -m "wip; npm test passes"'}), res("10:20:22", "A"),
    use("10:20:30", "B", "Bash", {"command": "timeout 300 bash tests/a.sh"}), res("10:20:40", "B"),
    use("10:20:50", "C", "Bash", {"command": "for f in a b; do bash tests/$f.sh; done"}), res("10:21:00", "C"),
    use("10:21:10", "D", "Bash", {"command": "sleep 30"}), res("10:21:40", "D"),
    use("10:21:50", "E", "Bash", {"command": 'hc run --bg --name x "bash tests/b.sh"'}), res("10:21:55", "E"),
    # 32 minutes: most likely a permission prompt; capped at 30.
    use("10:22:00", "F", "Bash", {"command": "npm test"}), res("10:54:00", "F"),
    # No result: the session was cut off and resumed hours later.
    use("10:54:05", "G", "Bash", {"command": "npm run build"}),
    user("13:00:00", "are you there?"), text("13:00:10"),
]
write(os.path.join(wt5, "impl-5.jsonl"), t5)

# pi
pd = os.path.join(T, "pi", "sessions", "--" + os.path.join(T, "wt", "demo", "dx-t2")[1:].replace("/", "-") + "--")
pi = [
    dict(type="session", id="s1", timestamp=iso("10:05:00"), cwd="x"),
    dict(type="message", id="1", timestamp=iso("10:05:00"), message=dict(role="user", content=[dict(type="text", text="You are impl-dx-t2.")])),
    dict(type="message", id="2", timestamp=iso("10:05:20"), message=dict(role="assistant", stopReason="toolUse", content=[
        dict(type="toolCall", id="p1", name="bash", arguments={"command": "pytest -q"})])),
    dict(type="message", id="3", timestamp=iso("10:06:20"), message=dict(role="toolResult", toolCallId="p1", toolName="bash", content=[])),
    dict(type="message", id="4", timestamp=iso("10:06:30"), message=dict(role="assistant", stopReason="stop", content=[dict(type="text", text="done")])),
]
write(os.path.join(pd, "2026-11-16T10-05-00-000Z_s1.jsonl"), pi, compact=False)

# opencode: both table generations, and the older storage/ files.
od = os.path.join(T, "opencode")
os.makedirs(od)
db = sqlite3.connect(os.path.join(od, "opencode.db"))
db.executescript("""
create table session (id text primary key, directory text, parent_id text);
create table message (id text primary key, session_id text, time_created integer, data text);
create table part (id text primary key, message_id text, session_id text, time_created integer, data text);
create table session_v2 (id text primary key, directory text, parent_id text);
create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, data text);
""")
d3 = os.path.join(T, "wt", "demo", "dx-t3")
db.execute("insert into session_v2 values ('v2', ?, null)", (d3,))
db.execute("insert into session_v2 values ('v2child', ?, 'v2')", (d3,))
msgs = [
    ("user", ms("10:10:00"), {"time": {"created": ms("10:10:00")}, "text": "You are impl-dx-t3."}),
    ("assistant", ms("10:10:00"), {"time": {"created": ms("10:10:00"), "completed": ms("10:10:20")}, "content": [
        {"type": "tool", "id": "o1", "name": "bash", "state": {"status": "completed", "input": {"command": "npm run build"}},
         "time": {"created": ms("10:10:20"), "completed": ms("10:11:00")}}]}),
    ("assistant", ms("10:11:00"), {"time": {"created": ms("10:11:00"), "completed": ms("10:11:10")}, "content": []}),
    ("idle", ms("10:11:10"), {"time": {"created": ms("10:11:10")}, "outcome": "succeeded"}),
]
for i, (typ, t, data) in enumerate(msgs):
    db.execute("insert into session_message values (?, 'v2', ?, ?, ?, ?)", ("sm%d" % i, typ, i, t, json.dumps(data)))
db.execute("insert into session_message values ('x', 'v2child', 'user', 0, ?, ?)", (ms("10:12:00"), json.dumps({"time": {"created": ms("10:12:00")}, "text": "child"})))
integ = os.path.join(T, "wt", "demo", "feat-x")
db.execute("insert into session values ('v1', ?, null)", (integ,))
db.execute("insert into message values ('u1', 'v1', ?, ?)", (ms("10:30:00"), json.dumps({"role": "user", "time": {"created": ms("10:30:00")}})))
db.execute("insert into message values ('a1', 'v1', ?, ?)", (ms("10:30:00"), json.dumps(
    {"role": "assistant", "time": {"created": ms("10:30:00"), "completed": ms("10:30:40")}, "finish": "stop"})))
db.execute("insert into part values ('p1', 'u1', 'v1', 0, ?)", (json.dumps({"type": "text", "text": "You are fix-dx-final."}),))
db.execute("insert into part values ('p2', 'a1', 'v1', 0, ?)", (json.dumps({"type": "tool", "tool": "bash", "callID": "k1",
    "state": {"status": "completed", "input": {"command": "gh pr checks 7 --watch"}, "time": {"start": ms("10:30:05"), "end": ms("10:30:35")}}}),))
db.commit()
st = os.path.join(od, "storage")
def put(rel, obj):
    p = os.path.join(st, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(obj, open(p, "w"))
put("session/proj/ses_s.json", {"id": "ses_s", "directory": os.path.join(T, "wt", "demo", "dx-t4")})
put("message/ses_s/m1.json", {"id": "m1", "role": "user", "time": {"created": ms("10:40:00")}})
put("message/ses_s/m2.json", {"id": "m2", "role": "assistant", "time": {"created": ms("10:40:00"), "completed": ms("10:40:35")}, "finish": "stop"})
put("part/m1/p1.json", {"type": "text", "text": "You are impl-dx-t4."})
put("part/m2/p2.json", {"type": "tool", "tool": "bash", "callID": "s1", "state": {"input": {"command": "eslint ."}, "time": {"start": ms("10:40:10"), "end": ms("10:40:30")}}})
PY

out=$(sh "$script" "$run" "$(cat "$table")") || { echo "FAIL timing.sh exited $?"; exit 1; }
q() { printf '%s' "$out" | jq -c "$@"; }
agent() { q --arg l "$1" '.agents[] | select((.label // .name) == $l) | [.role, .task, .total, .categories]'; }

check "run times" '["2026-11-16T10:00:00Z","2026-11-16T13:00:10Z",10810]' "$(q '[.start, .end, .wall]')"
check "orchestrator" '["orchestrator",null,1085,{"agent_wait":445,"model":43,"other":2,"user_wait":595}]' \
  "$(q '.agents[0] | [.name, .task, .total, (.categories | to_entries | sort_by(.key) | from_entries)]')"
check "orchestrator idle" 120 "$(q .idle)"
check "critical path" '{"agent_wait":445,"idle":120,"model":43,"other":2,"user_wait":595}' "$(q '.critical_path | to_entries | sort_by(.key) | from_entries')"
check "one category a call, capped, orphan" '["impl","t5",1925,{"git":2,"model":68,"other":30,"test":1825}]' "$(agent impl-dx-t5 | jq -c '.[3] |= (to_entries | sort_by(.key) | from_entries)')"
check "implementer" '["impl","t1",1050,{"git":2,"lint":5,"model":42,"other":881,"test":120}]' "$(agent impl-dx-t1 | jq -c '.[3] |= (to_entries | sort_by(.key) | from_entries)')"
check "reviewer" '["rev","t1",100,{"review":40,"test":60}]' "$(agent rev-dx-t1 | jq -c '.[3] |= (to_entries | sort_by(.key) | from_entries)')"
check "pi agent" '["impl","t2",90,{"model":30,"test":60}]' "$(agent impl-dx-t2 | jq -c '.[3] |= (to_entries | sort_by(.key) | from_entries)')"
check "opencode v2 agent" '["impl","t3",70,{"build":40,"model":30}]' "$(agent impl-dx-t3 | jq -c '.[3] |= (to_entries | sort_by(.key) | from_entries)')"
check "opencode v1 integration" '["fix",null,40,{"ci_wait":30,"model":10}]' "$(agent fix-dx-final | jq -c '.[3] |= (to_entries | sort_by(.key) | from_entries)')"
check "opencode storage agent" '["impl","t4",35,{"lint":20,"model":15}]' "$(agent impl-dx-t4 | jq -c '.[3] |= (to_entries | sort_by(.key) | from_entries)')"
check "agent names and kinds" '[["orchestrator","claude"],["dx-t5","claude"],["dx-t1","claude"],["dx-t1","claude"],["dx-t2","pi"],["dx-t3","opencode"],["integration","opencode"],["dx-t4","opencode"]]' \
  "$(q '[.agents[] | [.name, .kind]]')"
check "run categories" '{"agent_wait":445,"build":40,"ci_wait":30,"git":4,"lint":25,"model":238,"other":913,"review":40,"test":2065,"user_wait":595}' \
  "$(q '.categories | to_entries | sort_by(.key) | from_entries')"
check "tasks" '[["t5",1925],["t1",1150],["t2",90],["t3",70],["t4",35]]' "$(q '[.tasks[] | [.id, .total]]')"
check "tokens" 1234 "$(q .tokens.total)"
check "cache written" yes "$( [ -n "$(ls "$run/.timing"/*.sig 2>/dev/null)" ] && echo yes || echo no)"

# Unchanged: the same result, from the cache, with the table on stdin.
again=$(sh "$script" "$run" - <"$table")
check "rerun from cache" "$(q 'del(.updated)')" "$(printf '%s' "$again" | jq -c 'del(.updated)')"
# Calls are classified as they are read: a changed table reclassifies them.
retabled=$(sh "$script" "$run" "$(printf 'build\t^bash$\t^sleep\\b\n'; cat "$table")")
check "table change reclassifies" '[30,null]' "$(printf '%s' "$retabled" | jq -c '.agents[] | select(.label == "impl-dx-t5") | [.categories.build, .categories.other]')"
sh "$script" "$run" "$(cat "$table")" >/dev/null
# Read in 300-byte chunks (most lines are longer): the same result.
small=$(TIMING_CACHE=$T/small TIMING_CHUNK=300 sh "$script" "$run" "$(cat "$table")")
check "small chunks" "$(q 'del(.updated)')" "$(printf '%s' "$small" | jq -c 'del(.updated)')"
# A change to the script's logic (here a comment in its jq) rereads every session; a
# killed run's scratch folder is removed.
mkdir "$run/.timing/.tmp.99999" && touch -d '1 hour ago' "$run/.timing/.tmp.99999"
sigs=$(cat "$run"/.timing/*.sig)
sed 's/^# A call input as text/# A call input, as text/' "$script" >"$T/changed.sh"
changed=$(sh "$T/changed.sh" "$run" "$(cat "$table")")
check "logic change rereads" yes "$([ "$sigs" != "$(cat "$run"/.timing/*.sig)" ] && echo yes || echo no)"
check "logic change result" "$(q 'del(.updated)')" "$(printf '%s' "$changed" | jq -c 'del(.updated)')"
check "stale scratch removed" no "$([ -e "$run/.timing/.tmp.99999" ] && echo yes || echo no)"
# A changed transcript is reread: the pi agent's second turn adds 15 s of model time.
pf=$(ls "$T"/pi/sessions/*/*.jsonl)
# Mark the events read so far (by this script's logic, after the changed copy above):
# a reread from the start would drop the mark.
sh "$script" "$run" "$(cat "$table")" >/dev/null
pev=$(ls "$run"/.timing/*s1_jsonl.ev)
printf '%s\n' '{"t":0,"e":"model","mark":1}' >>"$pev"
printf '%s\n' '{"type":"message","id":"5","timestamp":"2026-11-16T10:07:00.000Z","message":{"role":"user","content":[{"type":"text","text":"again"}]}}' \
  '{"type":"message","id":"6","timestamp":"2026-11-16T10:07:15.000Z","message":{"role":"assistant","stopReason":"stop","content":[]}}' >>"$pf"
check "changed file reread" 105 "$(sh "$script" "$run" "$(cat "$table")" | jq --arg l impl-dx-t2 '.agents[] | select(.label == $l) | .total')"
check "read from where it stopped" '[1,2]' "$(jq -sc '[(map(select(.mark)) | length), (map(select(.e == "end")) | length)]' "$pev")"
# A closed run ends at its closed time: the reviewer's second turn and dx-t4 drop out.
printf '2026-11-16T10:35:00Z\tfinished\n' >"$run/closed"
check "closed run" '["2026-11-16T10:30:40Z",30]' "$(sh "$script" "$run" "$(cat "$table")" | jq -c '[.end, (.agents[] | select(.label == "rev-dx-t1") | .categories.review)]')"
# Missing pieces: no plan.md, no sessions, no status.json.
rm -f "$run/plan.md" "$run/sessions" "$run/status.json" "$run/closed"
check "bare run" '[1,null]' "$(sh "$script" "$run" "$(cat "$table")" | jq -c '[(.agents | length), .tokens]')"
check "usage" 2 "$(sh "$script" "$run" >/dev/null 2>&1; echo $?)"

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
