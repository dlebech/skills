#!/usr/bin/env python3
"""Reads opencode's token usage from its SQLite database, for tokens.sh.

opencode keeps sessions in $OPENCODE_DATA_DIR/opencode.db (default
~/.local/share/opencode), in two generations of tables, both read here:
  session + message              data.role == "assistant", data.tokens
  session_v2 + session_message   type == "assistant", data.tokens
Both carry tokens as {input, output, reasoning, cache: {read, write}}. The database is
opened read-only (a WAL one: opencode may be writing); there is no sqlite3 program on
many machines, hence Python's own module. Older opencode versions kept JSON files in
storage/ instead; those are not read.

  sessions <data-dir> <pattern>...   "<session>\t<directory>\t<stamp>" for each session
                                     whose directory matches an fnmatch pattern, or
                                     "id:<session>" for that session and its sub-sessions.
                                     The stamp changes when the session gets a message.
  rows <data-dir> <session> <since-ms>
                                     (v2 compactions included) "<message>\t<input>\t<output>\t<cache read>\t<cache write>"
                                     for assistant messages created at or after since-ms
                                     (reasoning counts as output).
  first <data-dir> <directory> <ms>  the earliest session in that directory created at or
                                     after ms (a second of slack), for an orchestrator.
  last <data-dir> <directory>        "<tokens>\t<model>" of the newest call in that
                                     directory, for the context size.
"""
import fnmatch
import json
import os
import sqlite3
import sys

# (sessions table, messages table, how the message says it is the assistant's)
GENERATIONS = [("session", "message"), ("session_v2", "session_message")]


def connect(data_dir):
    path = os.path.join(data_dir, "opencode.db")
    if not os.path.exists(path):
        sys.exit(0)
    return sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=5)


def tables(db):
    return {r[0] for r in db.execute("select name from sqlite_master where type = 'table'")}


def generations(db):
    have = tables(db)
    return [g for g in GENERATIONS if g[0] in have and g[1] in have]


def usage(data, kind):
    """(input, output, cache read, cache write, model) of an assistant message, or None."""
    try:
        d = json.loads(data)
    except ValueError:
        return None
    if kind == "message" and d.get("role") != "assistant":
        return None
    t = d.get("tokens")
    if not isinstance(t, dict):
        return None
    c = t.get("cache") or {}
    m = d.get("model")
    model = d.get("modelID") or (m.get("id") if isinstance(m, dict) else m) or ""
    n = lambda v: int(v) if isinstance(v, (int, float)) else 0
    return (n(t.get("input")), n(t.get("output")) + n(t.get("reasoning")), n(c.get("read")), n(c.get("write")), model)


def assistant_rows(db, sessions, messages, where, args, compactions=True):
    """(id, session, time_created, data) of assistant messages. A v2 compaction is a model
    call with its own usage, so it counts for tokens, but is no turn for the context size."""
    if messages == "message":
        q = "select id, session_id, time_created, data from message where data like '%\"assistant\"%'"
    else:
        types = "'assistant', 'compaction'" if compactions else "'assistant'"
        q = "select id, session_id, time_created, data from session_message where type in (%s)" % types
    return db.execute(q + where, args)


def cmd_sessions(db, patterns):
    found = {}
    for sessions, messages in generations(db):
        cols = "id, directory, parent_id"
        rows = db.execute("select %s from %s" % (cols, sessions)).fetchall()
        children = {}
        for i, _, p in rows:
            children.setdefault(p, []).append(i)
        want = set()
        for p in patterns:
            if p.startswith("id:"):
                todo = [p[3:]]
                while todo:
                    s = todo.pop()
                    if s not in want:
                        want.add(s)
                        todo += children.get(s, [])
        for i, d, _ in rows:
            if i in want or any(not p.startswith("id:") and fnmatch.fnmatchcase(d, p) for p in patterns):
                # time_updated of the newest message and how many there are: a message
                # edited in place or one added both change it.
                stamp = db.execute(
                    "select coalesce(max(time_updated), 0) || '/' || count(*) from %s where session_id = ?" % messages,
                    (i,)).fetchone()[0]
                found[i] = (d, stamp)
    for i, (d, stamp) in sorted(found.items()):
        print("%s\t%s\t%s" % (i, d, stamp))


def cmd_rows(db, session, since):
    seen = set()
    for sessions, messages in generations(db):
        for i, _, created, data in assistant_rows(db, sessions, messages, " and session_id = ?", (session,)):
            u = usage(data, messages)
            if u and i not in seen and created >= since:
                seen.add(i)
                print("%s\t%d\t%d\t%d\t%d" % ((i,) + u[:4]))


def cmd_first(db, directory, ms):
    best = None
    for sessions, _ in generations(db):
        for i, created in db.execute(
                "select id, time_created from %s where directory = ? and time_created >= ?" % sessions,
                (directory, ms - 999)):
            if best is None or created < best[0]:
                best = (created, i)
    if best:
        print(best[1])


def cmd_last(db, directory):
    best = None
    for sessions, messages in generations(db):
        where = " and session_id in (select id from %s where directory = ?)" % sessions
        for i, _, created, data in assistant_rows(db, sessions, messages, where, (directory,), False):
            u = usage(data, messages)
            if u and sum(u[:4]) > 0 and (best is None or created > best[0]):
                best = (created, sum(u[:4]), u[4])
    if best:
        print("%d\t%s" % (best[1], best[2]))


def main(argv):
    if len(argv) < 3:
        sys.exit("usage: opencode-usage.py sessions|rows|first|last <data-dir> ...")
    cmd, data_dir, rest = argv[1], argv[2], argv[3:]
    try:
        db = connect(data_dir)
        if cmd == "sessions":
            cmd_sessions(db, rest)
        elif cmd == "rows":
            cmd_rows(db, rest[0], int(rest[1]))
        elif cmd == "first":
            cmd_first(db, rest[0], int(rest[1]))
        elif cmd == "last":
            cmd_last(db, rest[0])
        else:
            sys.exit("unknown command " + cmd)
    except sqlite3.Error as e:
        sys.exit("opencode.db: %s" % e)


main(sys.argv)
