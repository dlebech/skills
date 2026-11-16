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
#    "end": "<the last activity in any session>", "wall": <end - start>,
#    "critical_path": {"<category>": <seconds>, "idle": <seconds>},
#    "categories": {"<category>": <seconds>},
#    "idle": <seconds>,
#    "agents": [{"name": "orchestrator" | "integration" | "<prefix>-<task>" (as tokens.sh
#                names them), "label": "<the name its brief gave it, e.g. rev-pda-t2>" | null,
#                "role": "orchestrator" | "impl" | "rev" | "fix" | "grunt" | "agent",
#                "task": "<task id>" | null, "kind": "claude" | "pi" | "opencode",
#                "sessions": <n>, "start", "end", "total": <seconds, idle left out>,
#                "categories": {...}}],
#    "tasks": [{"id": "<task id>", "total": <seconds>, "categories": {...}}],
#    "tokens": <status.json's tokens> | null, "updated": "<when this was computed>"}
# Categories (a key is there only when non-zero; read a missing one as 0): test, lint,
# build, install, ci_wait, agent_wait, review, git, model, user_wait, other.
# Which figure is for what:
#   critical_path  where the run's elapsed time went: the orchestrator's own categories
#                  plus `idle` (the orchestrator between turns with no agent working and
#                  no question open). They add up to the orchestrator's part of the wall
#                  time. Use it for "where the time goes"; empty without an orchestrator.
#   agents, tasks  effort: each agent's (or task's) working time. Agents work in parallel,
#   categories     so these sums can be far more than the wall time, and `categories`
#                  (all agents summed, the orchestrator included) counts the
#                  orchestrator's agent_wait on top of the agents' own time.
# Agents are listed orchestrator first, then by total; tasks by total.
#
# How time is counted, per session (one transcript), from its own timestamps:
#   - from a tool call to its result: the call's category (categories.tsv); while
#     calls overlap, the earliest one's. One call is one category: a shell call that
#     runs several commands takes the first of them (in the order they are written)
#     that is not git or other, else git, else other.
#   - a call is capped at 30 minutes (agent_wait calls are not): the rest is idle, as
#     the call was most likely waiting on a permission prompt. A call that has no
#     result when the next prompt comes (it was cut off, or the session was resumed)
#     ends at the last event before that prompt; its later time is not counted.
#   - otherwise, inside a turn: model (the model thinking and writing);
#   - between turns (after the model ended its turn, until the next input; or any
#     gap of over 10 minutes with no tool running): not working. For the orchestrator
#     that is user_wait while a question.md it wrote is open (from the call that wrote
#     it to an answer: an input naming an inbox/*.message, one starting "Answer to", or
#     plain text from a person, not a <tagged> message from hc or the harness; or a call
#     that removes question.md), else agent_wait while any agent is in a turn, else
#     idle. Only this run's question.md counts (a Write to it, or a shell command whose
#     target, with the call's own VAR= settings, ~ and $HOME expanded, is it); a
#     question.md elsewhere, as a demo, is not. An agent's idle time is not counted.
#   - agent_wait: for the orchestrator, waiting on its agents (`hc wait`, `sleep`
#     while polling, its idle time while agents work); for any other agent, waiting on
#     its own sub-agents or background jobs (an Agent call, `hc wait`).
#   - a review agent (role rev) has its time as review, except test, lint, build,
#     install and ci_wait, which stay, to show checks a reviewer reran.
# Only activity from the run's start (orchestrator.json `started`) on counts, and up to
# its `closed` time if it has one. For a run that is not closed, `end` is the last
# activity in any of its sessions, so a session continued later in a run's worktree
# moves it.
#
# Limits:
#   - herdr-core's terminal times (`hc get`: created_ms, finished_ms, parents) are not
#     used: the terminals are gone after a run, and the transcripts give finer times.
#     Agents are grouped under their run by worktree, as tokens.sh does.
#   - Claude Code sub-agents' transcripts are not read: the parent's Agent call covers
#     their time (agent_wait, or review when its description says so). A sub-agent run
#     in the background (its call returns at once) is not counted.
#   - Time waiting on a permission prompt is in the call it was for, up to the cap.
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
# Cost: in the run's .timing/ folder (TIMING_CACHE moves it), per transcript, the events
# read from it so far (<key>.ev) and how far it was read (<key>.at: offset, inode, logic
# checksum, a checksum of its start and of the bytes before the offset), so a growing
# transcript is read only from where it stopped, in chunks of TIMING_CHUNK bytes (16 MB),
# each kept as soon as it is read, so a run cut short still makes progress; and its result
# (<key>.json), with what it depends on (<key>.sig: the file's size, inode and mtime, the
# run's start and end, the table, and a checksum of this script's jq and Python), so an
# unchanged run reads no transcript, and a change to this script's logic or the table is
# picked up. opencode's sessions are cached together, keyed by its database files.
# Missing files, unknown kinds and a half-written last line are skipped.
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
# Absolute, as the paths a call writes are compared with it.
dir=$(cd "$dir" && pwd -P) || exit 1
claude=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
pi=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
opencode=${OPENCODE_DATA_DIR:-$HOME/.local/share/opencode}
worktrees=${HERDR_WORKTREES_ROOT:-$HOME/.herdr/worktrees}
cache=${TIMING_CACHE:-$dir/.timing}
chunk=${TIMING_CHUNK:-16777216}
mkdir -p "$cache" || exit 1
# Scratch space of runs that were killed (as by timing.js's timeout).
find "$cache" -maxdepth 1 -name '.tmp.*' -mmin +10 -exec rm -rf {} + 2>/dev/null
tmp=$cache/.tmp.$$
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
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

# opencode sessions → events, one JSON object a line with the session ("s") and its agent name.
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
def shell: test("^(bash|shell)$"; "i");
# The table: <category> TAB <tool> TAB <text> [TAB orchestrator].
def rules: [$table | split("\n")[] | select(length > 0 and (startswith("#") | not)) | split("\t")
  | select(length >= 2 and .[0] != "") | {cat: .[0], tool: (.[1] // ""), text: (.[2] // ""), who: (.[3] // "")}];
# A shell command as its simple commands, in order: here-document bodies dropped, no
# split at ; & | or a newline inside quotes, and wrappers (VAR=x, time, timeout N, env,
# sudo, nice, command, exec, a loop or if body) taken off the front.
def commands: split("\n")
  | reduce .[] as $l ({out: [], end: null};
      if .end then (if ($l | gsub("^\\s+|\\s+$"; "")) == .end then .end = null else . end)
      else .out += [$l] | .end = ([$l | match("<<-?\\s*[\"\u0027]?([A-Za-z_][A-Za-z0-9_]*)").captures[0].string] | first) end)
  | .out | join("\n")
  | gsub("\"(?<q>[^\"]*)\""; "\"" + (.q | gsub("[;&|\n]"; " ")) + "\"")
  | gsub("\u0027(?<q>[^\u0027]*)\u0027"; "\u0027" + (.q | gsub("[;&|\n]"; " ")) + "\u0027")
  | [splits("[;&|\n]+")]
  | map(sub("^[\\s({!]+"; "")
      | sub("^((time|env|sudo|command|exec|do|then|else|nice(\\s+-n\\s*-?[0-9]+)?|timeout(\\s+-\\S+)*\\s+[0-9.]+[smhd]?|[A-Za-z_][A-Za-z0-9_]*=\\S*)\\s+)+"; "")
      | .[0:300])
  | map(select(length > 0));
def parts: if (.tool // "" | shell) then (.parts // (.text // "" | commands)) else [.text // ""] end;
def classify($rules; $orc): (.tool // "") as $tool | parts as $parts
  | [$rules[] | . as $r | select(($tool | test($r.tool; "i")) and ($r.who == "" or ($r.who == "orchestrator" and $orc)))] as $rs
  | [$parts[] | . as $p | ([$rs[] | . as $r | select($p | test($r.text; "i")) | .cat] | first) // "other"] as $cats
  | ([$cats[] | select(. != "git" and . != "other")] | first)
    // (if any($cats[]; . == "git") then "git" else "other" end);
# The question.md files a shell call writes (w) or removes (r), with the variables it
# sets ("R=/x; mv $R/.question.tmp $R/question.md") and ~ or $HOME expanded.
def vars: [match("(?:^|[\\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=(\"[^\"]*\"|\u0027[^\u0027]*\u0027|[^\\s;&|]*)"; "g")
  | {key: .captures[0].string, value: (.captures[1].string | gsub("^[\"\u0027]|[\"\u0027]$"; ""))}] | from_entries;
def expand($v): gsub("\\$\\{?(?<n>[A-Za-z_][A-Za-z0-9_]*)\\}?"; $v[.n] // (if .n == "HOME" then $home else "$" + .n end)) | sub("^~"; $home);
def qfind($raw; $parts): ($raw | vars) as $v
  | {w: [$parts[] | select(test("^(mv|cp|tee)\\b.*question\\.md\\b|>\\s*\\S*question\\.(md|tmp)\\b"))
          | [match("\\S*question\\.(md|tmp)\\b"; "g").string] | last | expand($v)],
     r: [$parts[] | select(test("^rm\\b.*question\\.md\\b")) | [match("\\S*question\\.md\\b"; "g").string] | last | expand($v)]};
def qinfo: .q // (if (.tool // "" | shell) and ((.text // "") | test("question\\.(md|tmp)")) then qfind(.text; parts) else {w: [], r: []} end);
# Is a path the question.md of this run (or the .question.tmp written before it)? A demo
# or a question of another run is not this run waiting.
def inrun: sub("/\\.?question\\.(md|tmp)$"; "") == $rundir;
def asks: if (.tool // "") | test("^(write|edit|multiedit)$"; "i") then (.text // "") == ($rundir + "/question.md")
  else any(qinfo.w[]; inrun) end;
def unasks: any(qinfo.r[]; inrun);
# Does an input answer the open question: an inbox message, "Answer to", or a person
# typing (not a <tagged> message from hc or the harness, nor a compaction summary)?
def answer: test("/inbox/\\S+\\.message|^\\s*Answer to")
  or ((test("^\\s*<") or test("^This session is being continued")) | not);
def addc($k; $v): if $v > 0 then .[$k] = (.[$k] // 0) + $v else . end;
# Not working from $a to $b: waiting on the user while a question is open, else idle.
def pause($a; $b): .waits += [[$a, $b, (if .q then "user" else "idle" end)]]
  | if .ss != null then .spans += [[.ss, $a]] | .ss = null else . end;
# Events [{t, e: input|model|call|result|end, id, tool, parts|text, queued}] → the result.
def summary($meta):
  ($meta.name == "orchestrator") as $orc | rules as $rules
  | map(select(.t != null and .t >= $since and ($until == null or .t <= $until))) | sort_by(.t)
  | ([first(.[] | select(.e == "input") | .text // "" | [match("\\bYou are ((impl|rev|review|reviewer|fix|grunt)-[A-Za-z0-9_-]*[A-Za-z0-9])").captures[0].string] | first | select(. != null))] | first) as $label
  | (if $orc then "orchestrator" elif $label == null then "agent"
     else ($label | split("-")[0] | if startswith("rev") then "rev" else . end) end) as $role
  | reduce .[] as $e ({prev: null, open: {}, idle: true, q: false, ss: null, cats: {}, spans: [], waits: [], excess: 0};
      (if .prev != null and $e.t > .prev then ($e.t - .prev) as $dt
        | if (.open | length) > 0 and $e.e == "input" and ($e.queued | not) then .open = {} | pause(.prev; $e.t)
          elif (.open | length) > 0 then (.open | to_entries | min_by(.value.t) | .value) as $o
            | if $o.cat == "agent_wait" then .cats |= addc("agent_wait"; $dt)
              else ([0, ([$dt, $o.t + 1800000 - .prev] | min)] | max) as $in
                | .cats |= addc($o.cat; $in) | .excess += ($dt - $in) end
          elif .idle or $dt > 600000 then pause(.prev; $e.t)
          else .cats |= addc("model"; $dt) end
       else . end)
      | (if .ss == null and $e.e != "end" then .ss = $e.t | .idle = false else . end)
      | if $e.e == "input" then (if .q and ($e.text // "" | answer) then .q = false else . end)
        elif $e.e == "call" then .open[$e.id] = {t: $e.t, cat: ($e | classify($rules; $orc))}
          | (if $orc and ($e | asks) then .q = true elif $orc and ($e | unasks) then .q = false else . end)
        elif $e.e == "result" then del(.open[$e.id])
        elif $e.e == "end" then .open = {} | (if .ss != null then .spans += [[.ss, $e.t]] else . end) | .ss = null | .idle = true
        else . end
      | .prev = $e.t)
  | (if .ss != null then .spans += [[.ss, .prev]] else . end)
  | .excess as $excess | .cats as $c
  | (if $role == "rev" then
      reduce ($c | to_entries[]) as $x ({}; if ($x.key | IN("test", "lint", "build", "install", "ci_wait")) then addc($x.key; $x.value) else addc("review"; $x.value) end)
     elif $orc then $c | addc("_idle"; $excess)
     else $c end) as $cats
  | {name: $meta.name, kind: $meta.kind, file: $meta.file, label: $label, role: $role,
     start: (.spans | map(.[0]) | min), end: (.spans | map(.[1]) | max),
     cats: $cats, spans: .spans, waits: (if $orc then .waits else [] end)};
'

# One transcript line → events. A shell call keeps its commands, already split, not
# its text, which may be a long here-document.
CLAUDE='
fromjson? | select(type == "object" and .isSidechain != true) | (.timestamp // "" | ms) as $t | select($t != null)
| if .type == "assistant" then
    ((.message.content // []) | if type == "array" then .[] else empty end | select(.type == "tool_use")
      | {t: $t, e: "call", id: .id, tool: .name}
        + if (.name // "" | shell) then (.input | about) as $raw | ($raw | commands) as $p
            | {parts: $p} + (if $raw | test("question\\.(md|tmp)") then {q: qfind($raw; $p)} else {} end) else {text: (.input | about | .[0:500])} end),
    {t: $t, e: "model"},
    (if (.message.stop_reason // "") | IN("end_turn", "stop_sequence") then {t: $t, e: "end"} else empty end)
  elif .type == "user" then
    if (.message.content | type) == "array" and any(.message.content[]; .type == "tool_result") then
      (.message.content[] | select(.type == "tool_result") | {t: $t, e: "result", id: .tool_use_id})
    elif .isMeta == true then empty
    else {t: $t, e: "input", text: (.message.content | if type == "string" then . else map(.text? // "") | join(" ") end | .[0:2000])} end
  elif .type == "queue-operation" and .operation == "enqueue" then {t: $t, e: "input", queued: true, text: (.content // "" | tostring | .[0:2000])}
  else empty end
'
PI='
fromjson? | select(type == "object" and .type == "message") | (.timestamp // "" | ms) as $t | select($t != null)
| .message as $m
| if $m.role == "user" then {t: $t, e: "input", text: ($m.content | if type == "string" then . else map(.text? // "") | join(" ") end | .[0:2000])}
  elif $m.role == "assistant" then
    (($m.content // []) | if type == "array" then .[] else empty end | select(.type == "toolCall")
      | {t: $t, e: "call", id: .id, tool: .name}
        + if (.name // "" | shell) then (.arguments | about) as $raw | ($raw | commands) as $p
            | {parts: $p} + (if $raw | test("question\\.(md|tmp)") then {q: qfind($raw; $p)} else {} end) else {text: (.arguments | about | .[0:500])} end),
    {t: $t, e: "model"},
    (if ($m.stopReason // "") | IN("stop", "aborted", "error") then {t: $t, e: "end"} else empty end)
  elif $m.role == "toolResult" then {t: $t, e: "result", id: $m.toolCallId}
  else empty end
'
# Lines worth parsing; spaces allowed, for a log written by another JSON writer.
CLAUDE_PAT='"type": *"(assistant|user|queue-operation)"'
PI_PAT='"type": *"message"'

jqs() { jq --arg rundir "$dir" --arg home "$HOME" --arg table "$table" --argjson since "${since:-0}" --argjson until "${until:-null}" "$@"; }
since=$(printf '%s\n' "$started" | jqs -R "$LIB"' ms // 0') || exit 1
until=$(printf '%s\n' "$closed" | jqs -R "$LIB"' ms') || exit 1
# What every cached result depends on besides its file: a change to this logic or the
# table makes every session be read again.
logic=$(printf '%s' "$LIB$CLAUDE$PI$OPENCODE$CLAUDE_PAT$PI_PAT" | cksum | cut -d' ' -f1)
context="$started|$closed|$prefix|$(printf '%s' "$table" | cksum | cut -d' ' -f1)|$logic"

stat_of() { stat -c '%s %i %Y' "$1" 2>/dev/null || stat -f '%z %i %m' "$1" 2>/dev/null; }
# Moves a finished file into the cache whole, so a reader never sees half of it.
keep() { mv "$1" "$2"; }

# A checksum of what a file held up to `off`: its first 4 kB and the 256 bytes before off.
signature() {
  h=4096 t=256
  [ "$2" -ge "$h" ] || h=$2
  [ "$2" -ge "$t" ] || t=$2
  { head -c "$h" "$1"; tail -c +$(($2 - t + 1)) "$1" | head -c "$t"; } | cksum | cut -d' ' -f1
}

# events <file> <key> <kind> <size> <inode>: brings <key>.ev up to date, reading only
# what was added since, up to the last whole line, a chunk at a time; rereads a file that
# was replaced, shrank or rewritten, or when the logic changed.
events() {
  case $3 in
    claude) prog=$CLAUDE pat=$CLAUDE_PAT ;;
    pi) prog=$PI pat=$PI_PAT ;;
    *) return 1 ;;
  esac
  ev=$cache/$2.ev at=$cache/$2.at off=0
  if [ -e "$ev" ] && [ -e "$at" ] && read -r o_off o_inode o_logic o_sig <"$at" &&
    [ "$o_inode" = "$5" ] && [ "$o_logic" = "$logic" ] && [ "$o_off" -le "$4" ] &&
    [ "$(signature "$1" "$o_off")" = "$o_sig" ]; then
    off=$o_off
  else
    rm -f "$at" && : >"$ev" || return 1
  fi
  lim=$chunk
  while [ "$off" -lt "$4" ]; do
    n=$(($4 - off)) cut=0
    [ "$n" -le "$lim" ] || { n=$lim; cut=1; }
    tail -c +$((off + 1)) "$1" | head -c "$n" >"$tmp/chunk" || return 1
    if [ -n "$(tail -c 1 "$tmp/chunk")" ]; then
      n=$((n - $(tail -n 1 "$tmp/chunk" | wc -c)))
      if [ "$n" -le 0 ]; then
        # The end of the file, still being written; or a line longer than the chunk.
        [ "$cut" = 1 ] || break
        lim=$((lim * 2))
        continue
      fi
    fi
    head -c "$n" "$tmp/chunk" | { grep -aE "$pat" || :; } | jqs -cR "$LIB $prog" >"$tmp/ev" || return 1
    cat "$tmp/ev" >>"$ev" || return 1
    off=$((off + n)) lim=$chunk
    printf '%s %s %s %s\n' "$off" "$5" "$logic" "$(signature "$1" "$off")" >"$tmp/at" && keep "$tmp/at" "$at" || return 1
  done
}

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
  set -- $st
  meta=$(jq -nc --arg name "$name" --arg kind "$kind" --arg file "$f" '{name: $name, kind: $kind, file: $file}')
  if events "$f" "$key" "$kind" "$1" "$2" &&
    jqs -sc --argjson meta "$meta" "$LIB summary(\$meta)" "$cache/$key.ev" >"$tmp/one" && [ -s "$tmp/one" ]; then
    keep "$tmp/one" "$cache/$key.json" && printf '%s\n' "$sig" >"$tmp/sig" && keep "$tmp/sig" "$cache/$key.sig"
    cat "$cache/$key.json" >>"$out"
  else
    echo "timing.sh: could not read $f" >&2
  fi
done <"$list"

# opencode: every session of the run in one read of its database, cached as a whole and
# read again when the database, or a file in its older storage/, changed.
if [ -e "$opencode/opencode.db" ] || [ -d "$opencode/storage/session" ]; then
  if command -v python3 >/dev/null 2>&1; then
    sig="$(stat_of "$opencode/opencode.db") $(stat_of "$opencode/opencode.db-wal")|$(cksum <"$specs" | cut -d' ' -f1)|$context"
    if [ -e "$cache/opencode.json" ] && [ "$(cat "$cache/opencode.sig" 2>/dev/null)" = "$sig" ] &&
      [ -z "$(find "$opencode/storage" -newer "$cache/opencode.json" -print 2>/dev/null | head -1)" ]; then
      cat "$cache/opencode.json" >>"$out"
    else
      # Specs as arguments, so a folder name is never spliced into the program.
      set --
      while read -r s; do set -- "$@" "$s"; done <"$specs"
      if python3 -I -c "$OPENCODE" "$opencode" "$@" >"$tmp/oc.events" 2>"$tmp/oc.err" &&
        jqs -sc "$LIB"' group_by(.s)[] | summary({name: .[0].name, kind: "opencode", file: ("opencode:" + .[0].s)})' \
          "$tmp/oc.events" >"$tmp/oc.json"; then
        keep "$tmp/oc.json" "$cache/opencode.json" && printf '%s\n' "$sig" >"$tmp/sig" && keep "$tmp/sig" "$cache/opencode.sig"
        cat "$cache/opencode.json" >>"$out"
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
   critical_path: ($agents | map(select(.name == "orchestrator"))
     | addall(map(.categories)) + {idle: (map(._idle) | add // 0 | secs)} | with_entries(select(.value > 0))),
   categories: (addall($agents | map(.categories)) | with_entries(select(.value > 0))),
   idle: ($agents | map(._idle) | add // 0 | secs),
   agents: ($agents | map(del(._idle))),
   tasks: ($agents | map(select(.task != null)) | group_by(.task) | map(
     addall(map(.categories)) as $c | {id: .[0].task, total: ($c | add // 0), categories: $c}) | sort_by(-.total)),
   tokens: $tokens, updated: (now | floor | todate)}
' "$out"
