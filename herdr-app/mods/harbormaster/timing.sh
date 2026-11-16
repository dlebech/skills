#!/bin/sh
# Where a run's time went, from the logs its orchestrator and agents already leave:
# no orchestrator involvement and no model calls. Harbormaster's stats view and the
# run history (.history.jsonl) are built on what it prints.
#
# Usage: timing.sh <run-directory> <categories>
#   <categories> is the text of categories.tsv (the classification table), or "-" to
#   read it from stdin. It is passed as text, not a path, so the mod can run this on
#   another machine with `sh -c <this script> sh <run-directory> <table text>`.
#
# Prints one JSON object (durations in whole seconds, times ISO UTC), version 1:
#   {"version": 1, "run": "<run directory>", "branch": "...",
#    "start": "<orchestrator.json started, else the first activity>",
#    "end": "<the last activity>", "wall": <end - start>,
#    "categories": {"<category>": <seconds>},   the run's total, all agents summed
#    "idle": <the orchestrator idle with no agent working and no question open>,
#    "agents": [{"name": "orchestrator" | "integration" | "<prefix>-<task>" (as tokens.sh
#                names them), "label": "<the name its brief gave it, e.g. rev-pda-t2>" | null,
#                "role": "orchestrator" | "impl" | "rev" | "fix" | "grunt" | "agent",
#                "task": "<task id>" | null, "kind": "claude" | "pi" | "opencode",
#                "sessions": <n>, "start", "end", "total": <seconds>, "categories": {...}}],
#    "tasks": [{"id": "<task id>", "total": <seconds>, "categories": {...}}],
#    "tokens": <status.json's tokens> | null, "updated": "<when this was computed>"}
# Categories (keys only present when non-zero): test, lint, build, install, ci_wait,
# agent_wait, review, git, model, user_wait, other. Agents work in parallel, so the
# per-agent and category sums can be far more than the wall time; only the
# orchestrator's own categories (with idle) add up to about its part of the wall time.
# Agents are listed orchestrator first, then by total; tasks by total.
#
# How time is counted, per session (one transcript), from its own timestamps:
#   - from a tool call to its result: the call's category (categories.tsv); while
#     calls overlap, the earliest one's;
#   - otherwise, inside a turn: model (the model thinking and writing);
#   - between turns (after the model ended its turn, until the next input; or any
#     gap of over 10 minutes with no tool running): not working. For the orchestrator
#     that is user_wait while a question.md it wrote is open (from the call that wrote
#     it to an answer: an input naming inbox/ or "Answer to", or one not sent by hc),
#     else agent_wait while any agent is in a turn, else idle. An agent's idle time
#     is not counted.
#   - a review agent (role rev) has its time as review, except test, lint, build,
#     install and ci_wait, which stay, to show checks a reviewer reran.
# Only activity from the run's start (orchestrator.json `started`) on counts, and up to
# its `closed` time if it has one. Claude Code sub-agents' transcripts are not read:
# the parent's Agent call covers their time (agent_wait, or review).
#
# Sources, found as skills/herdr-app-orchestrator/scripts/tokens.sh finds them:
#   orchestrator  the run's `sessions` file: "claude <id>", "pi <file>", "opencode <id>"
#   agents        the run's worktrees, <worktrees>/<repo>/<prefix>-* for each repository
#                 in plan.md's Repos line (or the run's folder) and the integration
#                 worktree: Claude Code's projects/<folder>/*.jsonl, pi's
#                 sessions/--<folder>--/*.jsonl, opencode's sessions by directory in
#                 opencode.db (both table generations, read-only with Python's sqlite3,
#                 as many machines have no sqlite3 program) and its older storage/ files.
# An agent's role and label come from its first prompt, "You are <role>-<name>".
#
# Cost: each session's result is cached in the run's .timing/ folder (TIMING_CACHE moves
# it), keyed by the file's size, inode and mtime, the run's start and end, and the
# table, so a rerun on an unchanged run reads no transcript. opencode's sessions are
# cached together, keyed by its database files. Missing files, unknown kinds and a
# truncated last line are skipped.
#
# CLAUDE_CONFIG_DIR, PI_CODING_AGENT_DIR, OPENCODE_DATA_DIR and HERDR_WORKTREES_ROOT move
# where it looks, for tests; they default to ~/.claude, ~/.pi/agent,
# ~/.local/share/opencode and ~/.herdr/worktrees. Needs jq; python3 for opencode.
set -u

[ $# -eq 2 ] || { echo "usage: timing.sh <run-directory> <categories text | ->" >&2; exit 2; }
dir=${1%/}
table=$2
[ "$table" != - ] || table=$(cat)
[ -e "$dir/orchestrator.json" ] || { echo "no orchestrator.json in $dir" >&2; exit 1; }
claude=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
pi=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
opencode=${OPENCODE_DATA_DIR:-$HOME/.local/share/opencode}
worktrees=${HERDR_WORKTREES_ROOT:-$HOME/.herdr/worktrees}
cache=${TIMING_CACHE:-$dir/.timing}
mkdir -p "$cache" || exit 1
tmp=$cache/.tmp.$$
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp" || exit 1

orch=$(jq -c '{branch: (.branch // ""), folder: (.folder // ""), started: (.started // "")}' "$dir/orchestrator.json") || exit 1
branch=$(printf '%s' "$orch" | jq -r .branch)
folder=$(printf '%s' "$orch" | jq -r .folder)
started=$(printf '%s' "$orch" | jq -r .started)
closed=
[ ! -e "$dir/closed" ] || closed=$(cut -f1 "$dir/closed" | head -1)
prefix=$(sed -n 's/^Prefix: *//p' "$dir/plan.md" 2>/dev/null | head -1 | tr -d '[:space:]`')
repos=$(sed -n 's/^Repos: *//p' "$dir/plan.md" 2>/dev/null | head -1 | tr ',' '\n' | awk 'NF { print $1 }')
[ -n "$repos" ] || repos=${folder##*/}
slug=$(printf '%s' "$branch" | sed -E 's/[^A-Za-z0-9._-]+/-/g; s/^-+//; s/-+$//')
tablesum=$(printf '%s' "$table" | cksum | cut -d' ' -f1)
# What every cached result depends on besides its file.
context="$started|$closed|$prefix|$tablesum|1"

claude_dir() { printf '%s/projects/%s' "$claude" "$(printf '%s' "$1" | sed 's/[^A-Za-z0-9-]/-/g')"; }
pi_dir() { printf '%s/sessions/--%s--' "$pi" "$(printf '%s' "${1#/}" | sed 's|/|-|g')"; }

# The transcripts, "<name>\t<kind>\t<file>" a line; opencode's specs for timing-opencode.
list=$tmp/list
specs=$tmp/specs
: >"$list"
: >"$specs"
if [ -e "$dir/sessions" ]; then
  while read -r kind id; do
    case $kind in
      claude)
        for f in "$claude"/projects/*/"$id".jsonl; do
          [ -e "$f" ] && printf 'orchestrator\tclaude\t%s\n' "$f" >>"$list"
        done ;;
      pi) [ -e "$id" ] && printf 'orchestrator\tpi\t%s\n' "$id" >>"$list" ;;
      opencode) printf 'id:%s\n' "$id" >>"$specs" ;;
    esac
  done <"$dir/sessions"
fi
for r in $repos; do
  base=$(claude_dir "$worktrees/$r/")
  integration=$(claude_dir "$worktrees/$r/$slug")
  for d in ${prefix:+"$base$prefix"-*} "$integration"; do
    [ -d "$d" ] || continue
    name=${d#"$base"}
    [ "$d" != "$integration" ] || name=integration
    for f in "$d"/*.jsonl; do
      [ -e "$f" ] && printf '%s\tclaude\t%s\n' "$name" "$f" >>"$list"
    done
  done
  base=$(pi_dir "$worktrees/$r/")
  base=${base%--}
  integration=$(pi_dir "$worktrees/$r/$slug")
  for d in ${prefix:+"$base$prefix"-*--} "$integration"; do
    [ -d "$d" ] || continue
    name=${d#"$base"}
    name=${name%--}
    [ "$d" != "$integration" ] || name=integration
    for f in "$d"/*.jsonl; do
      [ -e "$f" ] && printf '%s\tpi\t%s\n' "$name" "$f" >>"$list"
    done
  done
  printf 'exact:%s\n' "$worktrees/$r/$slug" >>"$specs"
  [ -z "$prefix" ] || printf 'under:%s/%s-\n' "$worktrees/$r" "$prefix" >>"$specs"
done

# Shared jq: times, the classifier, and one session's events → its result.
LIB='
def ms: try (capture("^(?<s>[^.Z]+)(\\.(?<f>[0-9]+))?Z$") | ((.s + "Z") | fromdateiso8601) * 1000 + (((.f // "0") + "00")[0:3] | tonumber)) catch null;
def iso: . / 1000 | floor | todate;
def secs: . / 1000 | round;
# A call input as text: a shell command, else what it is about.
def about: if type != "object" then tostring
  elif (.command | type) == "string" then .command
  else [.command, .description, .subagent_type, .skill, .file_path, .filePath, .path, .pattern, .url, .query]
    | map(select(type == "string")) | join(" ") end;
def rules: [$table | split("\n")[] | select(length > 0 and (startswith("#") | not)) | split("\t")
  | select(length >= 2 and .[0] != "") | {cat: .[0], tool: (.[1] // ""), text: (.[2] // "")}];
# A shell command as its simple commands, here-document bodies dropped.
def commands: split("\n")
  | reduce .[] as $l ({out: [], end: null};
      if .end then (if ($l | gsub("^\\s+|\\s+$"; "")) == .end then .end = null else . end)
      else .out += [$l] | .end = ([$l | match("<<-?\\s*[\"\u0027]?([A-Za-z_][A-Za-z0-9_]*)").captures[0].string] | first) end)
  | .out | join("\n") | [splits("[;&|\n]+")]
  | map(sub("^[\\s(]+"; "") | sub("^([A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)+"; "")) | map(select(length > 0));
def classify($rules): . as $c | ($c.tool // "") as $tool
  | (if ($tool | test("^(bash|shell)$"; "i")) then ($c.text // "" | commands) else [$c.text // ""] end) as $parts
  | (first($rules[] | . as $r | select(($tool | test($r.tool; "i")) and any($parts[]; test($r.text; "i")))) | .cat) // "other";
# Does a call write the run question.md (not an agent "<name>-question.md")?
def asks: if (.tool // "") | test("^(write|edit|multiedit)$"; "i") then (.text // "") | test("(^|/)question\\.md$")
  elif (.tool // "") | test("^(bash|shell)$"; "i") then
    any(.text // "" | commands[]; test("^(mv|cp|tee)\\b.*[/\\s]question\\.md\\b|>\\s*\\S*/\\.?question\\.(md|tmp)\\b"))
  else false end;
def unasks: ((.tool // "") | test("^(bash|shell)$"; "i")) and any(.text // "" | commands[]; test("^rm\\b.*[/\\s]question\\.md\\b"));
def answer: test("inbox/|Answer to") or (startswith("<hc from=") | not);
def addc($k; $v): if $v > 0 then .[$k] = (.[$k] // 0) + $v else . end;
# Events [{t, e: input|model|call|result|end, id, tool, text}] → the session result.
def summary($meta):
  ($meta.name == "orchestrator") as $orc | rules as $rules
  | map(select(.t != null and .t >= $since and ($until == null or .t <= $until))) | sort_by(.t)
  | ([first(.[] | select(.e == "input") | .text // "" | [match("\\bYou are ((impl|rev|review|reviewer|fix|grunt)-[A-Za-z0-9_-]*[A-Za-z0-9])").captures[0].string] | first | select(. != null))] | first) as $label
  | (if $orc then "orchestrator" elif $label == null then "agent"
     else ($label | split("-")[0] | if startswith("rev") then "rev" else . end) end) as $role
  | reduce .[] as $e ({prev: null, open: {}, idle: true, q: false, ss: null, cats: {}, spans: [], waits: []};
      (if .prev != null and $e.t > .prev then ($e.t - .prev) as $dt
        | if (.open | length) > 0 then (.open | to_entries | min_by(.value.t) | .value.cat) as $k | .cats |= addc($k; $dt)
          elif .idle then .waits += [[.prev, $e.t, (if .q then "user" else "idle" end)]]
          elif $dt > 600000 then .waits += [[.prev, $e.t, (if .q then "user" else "idle" end)]] | .spans += [[.ss, .prev]] | .ss = null
          else .cats |= addc("model"; $dt) end
       else . end)
      | (if .ss == null and $e.e != "end" then .ss = $e.t | .idle = false else . end)
      | if $e.e == "input" then (if .q and ($e.text // "" | answer) then .q = false else . end)
        elif $e.e == "call" then .open[$e.id] = {t: $e.t, cat: ($e | classify($rules))}
          | (if $orc and ($e | asks) then .q = true elif $orc and ($e | unasks) then .q = false else . end)
        elif $e.e == "result" then del(.open[$e.id])
        elif $e.e == "end" then .open = {} | (if .ss != null then .spans += [[.ss, $e.t]] else . end) | .ss = null | .idle = true
        else . end
      | .prev = $e.t)
  | (if .ss != null then .spans += [[.ss, .prev]] else . end)
  | .cats as $c
  | (if $role == "rev" then
      reduce ($c | to_entries[]) as $x ({}; if ($x.key | IN("test", "lint", "build", "install", "ci_wait")) then addc($x.key; $x.value) else addc("review"; $x.value) end)
     else $c end) as $cats
  | {name: $meta.name, kind: $meta.kind, file: $meta.file, label: $label, role: $role,
     start: (.spans | map(.[0]) | min), end: (.spans | map(.[1]) | max),
     cats: $cats, spans: .spans, waits: (if $orc then .waits else [] end)};
'

# One transcript line → events.
CLAUDE='
fromjson? | select(type == "object" and .isSidechain != true) | (.timestamp // "" | ms) as $t | select($t != null)
| if .type == "assistant" then
    ((.message.content // []) | if type == "array" then .[] else empty end | select(.type == "tool_use")
      | {t: $t, e: "call", id: .id, tool: .name, text: (.input | about)}),
    {t: $t, e: "model"},
    (if (.message.stop_reason // "") | IN("end_turn", "stop_sequence") then {t: $t, e: "end"} else empty end)
  elif .type == "user" then
    if (.message.content | type) == "array" and any(.message.content[]; .type == "tool_result") then
      (.message.content[] | select(.type == "tool_result") | {t: $t, e: "result", id: .tool_use_id})
    elif .isMeta == true then empty
    else {t: $t, e: "input", text: (.message.content | if type == "string" then . else map(.text? // "") | join(" ") end)} end
  elif .type == "queue-operation" and .operation == "enqueue" then {t: $t, e: "input", text: (.content // "" | tostring)}
  else empty end
'
PI='
fromjson? | select(type == "object" and .type == "message") | (.timestamp // "" | ms) as $t | select($t != null)
| .message as $m
| if $m.role == "user" then {t: $t, e: "input", text: ($m.content | if type == "string" then . else map(.text? // "") | join(" ") end)}
  elif $m.role == "assistant" then
    (($m.content // []) | if type == "array" then .[] else empty end | select(.type == "toolCall")
      | {t: $t, e: "call", id: .id, tool: .name, text: (.arguments | about)}),
    {t: $t, e: "model"},
    (if ($m.stopReason // "") | IN("stop", "aborted", "error") then {t: $t, e: "end"} else empty end)
  elif $m.role == "toolResult" then {t: $t, e: "result", id: $m.toolCallId}
  else empty end
'

jqs() { jq --arg table "$table" --argjson since "${since:-0}" --argjson until "${until:-null}" "$@"; }
since=$(printf '%s\n' "$started" | jqs -R "$LIB"' ms // 0') || exit 1
until=$(printf '%s\n' "$closed" | jqs -R "$LIB"' ms') || exit 1

stat_of() { stat -c '%s %i %Y' "$1" 2>/dev/null || stat -f '%z %i %m' "$1" 2>/dev/null; }

out=$tmp/summaries
: >"$out"
while IFS="$(printf '\t')" read -r name kind f; do
  key=$(printf '%s' "$f" | sed 's/[^A-Za-z0-9]/_/g')
  key=$(printf '%s' "$key" | tail -c 200)
  st=$(stat_of "$f") || continue
  sig="$st|$name|$context"
  if [ -s "$cache/$key.json" ] && [ "$(cat "$cache/$key.sig" 2>/dev/null)" = "$sig" ]; then
    cat "$cache/$key.json" >>"$out"
    continue
  fi
  case $kind in
    claude) prog=$CLAUDE; pat='"type":"(assistant|user|queue-operation)"' ;;
    pi) prog=$PI; pat='"type":"message"' ;;
    *) continue ;;
  esac
  meta=$(jq -nc --arg name "$name" --arg kind "$kind" --arg file "$f" '{name: $name, kind: $kind, file: $file}')
  # The last line may be half written: fromjson? skips it.
  if { grep -aE "$pat" "$f" || :; } | jqs -ncR --argjson meta "$meta" "$LIB [inputs | $prog] | summary(\$meta)" >"$tmp/one" &&
    [ -s "$tmp/one" ]; then
    cp "$tmp/one" "$cache/$key.json" && printf '%s\n' "$sig" >"$cache/$key.sig"
    cat "$tmp/one" >>"$out"
  fi
done <"$list"

# opencode: every session of the run in one read of its database, cached as a whole.
OPENCODE='
import json, os, sqlite3, sys
data, specs = sys.argv[1], sys.argv[2:]
def name_of(sid, d, parent):
    if parent:
        return None
    for s in specs:
        if s == "id:" + sid:
            return "orchestrator"
        if s.startswith("exact:") and (d == s[6:] or d.startswith(s[6:] + "/")):
            return "integration"
        if s.startswith("under:") and d.startswith(s[6:]):
            base = os.path.dirname(s[6:])
            return d[len(base) + 1:].split("/")[0]
    return None
def emit(o):
    print(json.dumps(o))
def text_of(parts):
    return " ".join(p.get("text") or "" for p in parts if isinstance(p, dict) and p.get("type") == "text")
def about(i):
    if not isinstance(i, dict):
        return str(i or "")
    return " ".join(i[k] for k in ("command", "description", "subagent_type", "filePath", "path", "pattern", "url", "query") if isinstance(i.get(k), str))
def v1(sid, name, messages, parts):
    # messages [(data)], parts {message id: [data]}: opencode 1 rows, or storage/ files.
    for m in messages:
        t = m.get("time") or {}
        base = {"s": sid, "name": name}
        if m.get("role") == "user":
            emit(dict(base, t=t.get("created"), e="input", text=text_of(parts.get(m.get("id"), []))))
            continue
        for p in parts.get(m.get("id"), []):
            if p.get("type") == "tool":
                st = p.get("state") or {}
                pt = st.get("time") or {}
                if pt.get("start"):
                    emit(dict(base, t=pt["start"], e="call", id=p.get("callID") or p.get("id"), tool=p.get("tool"), text=about(st.get("input"))))
                if pt.get("end"):
                    emit(dict(base, t=pt["end"], e="result", id=p.get("callID") or p.get("id")))
        done = t.get("completed")
        if done:
            emit(dict(base, t=done, e="model"))
            if m.get("finish") not in (None, "tool-calls", "tool_calls"):
                emit(dict(base, t=done, e="end"))
def load(s):
    try:
        return json.loads(s)
    except ValueError:
        return {}
path = os.path.join(data, "opencode.db")
if os.path.exists(path):
    db = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=5)
    have = {r[0] for r in db.execute("select name from sqlite_master where type = ?", ("table",))}
    if {"session", "message", "part"} <= have:
        for sid, d, parent in db.execute("select id, directory, parent_id from session").fetchall():
            name = name_of(sid, d, parent)
            if not name:
                continue
            ms = []
            for mid, data_ in db.execute("select id, data from message where session_id = ? order by time_created", (sid,)):
                m = load(data_); m["id"] = mid; ms.append(m)
            ps = {}
            for mid, data_ in db.execute("select message_id, data from part where session_id = ? order by id", (sid,)):
                ps.setdefault(mid, []).append(load(data_))
            v1(sid, name, ms, ps)
    if {"session_v2", "session_message"} <= have:
        for sid, d, parent in db.execute("select id, directory, parent_id from session_v2").fetchall():
            name = name_of(sid, d, parent)
            if not name:
                continue
            base = {"s": sid, "name": name}
            for typ, created, data_ in db.execute("select type, time_created, data from session_message where session_id = ? order by seq", (sid,)):
                m = load(data_)
                t = m.get("time") or {}
                if typ == "user":
                    emit(dict(base, t=t.get("created", created), e="input", text=m.get("text") or ""))
                elif typ == "assistant":
                    for c in m.get("content") or []:
                        if isinstance(c, dict) and c.get("type") == "tool":
                            ct = c.get("time") or {}
                            if ct.get("created"):
                                emit(dict(base, t=ct["created"], e="call", id=c.get("id"), tool=c.get("name"), text=about((c.get("state") or {}).get("input"))))
                            if ct.get("completed"):
                                emit(dict(base, t=ct["completed"], e="result", id=c.get("id")))
                    if t.get("completed"):
                        emit(dict(base, t=t["completed"], e="model"))
                elif typ == "idle":
                    emit(dict(base, t=t.get("created", created), e="end"))
# Older opencode: storage/session/<project>/<id>.json, storage/message/<session>/*.json,
# storage/part/<message>/*.json.
st = os.path.join(data, "storage")
sd = os.path.join(st, "session")
if os.path.isdir(sd):
    for proj in os.listdir(sd):
        pd = os.path.join(sd, proj)
        if not os.path.isdir(pd):
            continue
        for fn in os.listdir(pd):
            s = load(open(os.path.join(pd, fn)).read()) if fn.endswith(".json") else {}
            sid = s.get("id")
            name = sid and name_of(sid, s.get("directory") or "", s.get("parentID"))
            if not name:
                continue
            md = os.path.join(st, "message", sid)
            ms = [load(open(os.path.join(md, f)).read()) for f in sorted(os.listdir(md)) if f.endswith(".json")] if os.path.isdir(md) else []
            ms.sort(key=lambda m: (m.get("time") or {}).get("created") or 0)
            ps = {}
            for m in ms:
                pdir = os.path.join(st, "part", m.get("id") or "")
                if os.path.isdir(pdir):
                    ps[m["id"]] = [load(open(os.path.join(pdir, f)).read()) for f in sorted(os.listdir(pdir)) if f.endswith(".json")]
            v1(sid, name, ms, ps)
'
if [ -e "$opencode/opencode.db" ] || [ -d "$opencode/storage/session" ]; then
  if command -v python3 >/dev/null 2>&1; then
    st="$(stat_of "$opencode/opencode.db") $(stat_of "$opencode/opencode.db-wal") $(stat_of "$opencode/storage/message")"
    sig="$st|$(cksum <"$specs" | cut -d' ' -f1)|$context"
    if [ -e "$cache/opencode.json" ] && [ "$(cat "$cache/opencode.sig" 2>/dev/null)" = "$sig" ]; then
      cat "$cache/opencode.json" >>"$out"
    else
      # Specs as arguments, so a folder name is never spliced into the program.
      set --
      while read -r s; do set -- "$@" "$s"; done <"$specs"
      if python3 -I -c "$OPENCODE" "$opencode" "$@" >"$tmp/oc.events" 2>"$tmp/oc.err" &&
        jqs -sc "$LIB"' group_by(.s)[] | summary({name: .[0].name, kind: "opencode", file: ("opencode:" + .[0].s)})' \
          "$tmp/oc.events" >"$tmp/oc.json"; then
        cp "$tmp/oc.json" "$cache/opencode.json" && printf '%s\n' "$sig" >"$cache/opencode.sig"
        cat "$tmp/oc.json" >>"$out"
      else
        echo "timing.sh: could not read opencode's sessions: $(head -c 300 "$tmp/oc.err")" >&2
      fi
    fi
  fi
fi

# Everything together.
tokens=$(jq -c '.tokens // null' "$dir/status.json" 2>/dev/null) || tokens=null
[ -n "$tokens" ] || tokens=null
jqs -s --arg run "$dir" --arg branch "$branch" --arg prefix "$prefix" --argjson tokens "$tokens" "$LIB"'
def merge: sort_by(.[0]) | reduce .[] as $s ([]; if length > 0 and $s[0] <= .[-1][1] then .[-1][1] = ([.[-1][1], $s[1]] | max) else . + [$s] end);
def overlap($a; $b; $u): [$u[] | ([$b, .[1]] | min) - ([$a, .[0]] | max) | select(. > 0)] | add // 0;
def addall($list): reduce $list[] as $c ({}; reduce ($c | to_entries[]) as $x (.; addc($x.key; $x.value)));
def rounded: with_entries(.value |= secs) | with_entries(select(.value > 0));
. as $all
| ([$all[] | select(.name != "orchestrator") | .spans[]] | merge) as $busy
# The orchestrator between turns: waiting on the user, on its agents, or on nothing.
| [$all[] | if .name == "orchestrator" then
      .cats = reduce .waits[] as $w (.cats;
        if $w[2] == "user" then addc("user_wait"; $w[1] - $w[0])
        else overlap($w[0]; $w[1]; $busy) as $o | addc("agent_wait"; $o) | addc("_idle"; $w[1] - $w[0] - $o) end)
    else . end] as $s
| ($s | map(select(.start != null))) as $s
| ($s | map(.start) | min) as $first | ($s | map(.end) | max) as $last
| (if $since > 0 then $since else $first end) as $start
| ($s | group_by([.name, .label // ""]) | map(
    addall(map(.cats)) as $c
    | {name: .[0].name, label: .[0].label, role: .[0].role,
       task: (.[0].name | if $prefix != "" and startswith($prefix + "-") then .[($prefix | length) + 1:] else null end),
       kind: .[0].kind, sessions: length, start: (map(.start) | min | iso), end: (map(.end) | max | iso),
       total: ($c | del(._idle) | add // 0 | secs), categories: ($c | del(._idle) | rounded), _idle: ($c._idle // 0)})
  | sort_by(if .name == "orchestrator" then 0 else 1 end, -.total)) as $agents
| {version: 1, run: $run, branch: $branch,
   start: (if $start then $start | iso else null end), end: (if $last then $last | iso else null end),
   wall: (if $start and $last then ($last - $start) | secs else 0 end),
   categories: (addall($agents | map(.categories)) | with_entries(select(.value > 0))),
   idle: ($agents | map(._idle) | add // 0 | secs),
   agents: ($agents | map(del(._idle))),
   tasks: ($agents | map(select(.task != null)) | group_by(.task) | map(
     addall(map(.categories)) as $c | {id: .[0].task, total: ($c | add // 0), categories: $c}) | sort_by(-.total)),
   tokens: $tokens, updated: (now | floor | todate)}
' "$out"
