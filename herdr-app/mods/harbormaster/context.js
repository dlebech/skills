// How full each crew agent's context is: the tokens its last model call carried,
// read from the agent's own session file. No status line or hook is needed.
//   Claude Code  ~/.claude/sessions/<pid>.json names the session, whose transcript in
//                ~/.claude/projects/*/<session>.jsonl has each call's usage
//   pi           the newest ~/.pi/agent/sessions/--<cwd>--/*.jsonl (by folder, so a second
//                pi in the same folder can be mistaken for it)
//   opencode     the newest assistant message of any session in the terminal's folder in
//                ~/.local/share/opencode/opencode.db (read-only, with python3; a second
//                opencode in the same folder can be mistaken for it). The terminal's app is
//                taken to be named opencode*: check `hc get` on one if it does not show.
// Other programs show nothing until a case is added below.

import { exec } from "herdr";

// Prints "<address>\t<tokens>\t<model>" for each address it can read. The addresses
// come in as arguments, never spliced into the text. Each line is parsed as JSON (grep
// only narrows them down): a match can sit inside another entry, a synthetic message
// can carry no usage, and tail -c cuts the first line short. String.raw keeps the
// backslashes, but it is still a template: no "${" or backticks in the shell below.
const SCRIPT = String.raw`
for a; do
  j=$(hc get "$a" --json 2>/dev/null) || continue
  app=$(printf '%s' "$j" | jq -r '.status.app // .agent // empty')
  pid=$(printf '%s' "$j" | jq -r '.foreground.pid // empty')
  cwd=$(printf '%s' "$j" | jq -r '.foreground.cwd // .cwd // empty')
  case $app in
    claude*)
      s=$(jq -r '.sessionId // empty' "$HOME/.claude/sessions/$pid.json" 2>/dev/null)
      [ -n "$s" ] || continue
      for f in "$HOME"/.claude/projects/*/"$s".jsonl; do [ -e "$f" ] && break; done
      [ -e "$f" ] || continue
      tail -c 4000000 "$f" | grep -F '"type":"assistant"' | jq -rR --arg a "$a" 'fromjson?
        | select(.type == "assistant" and .isSidechain != true) | .message
        | ((.usage.input_tokens // 0) + (.usage.cache_creation_input_tokens // 0)
          + (.usage.cache_read_input_tokens // 0) + (.usage.output_tokens // 0)) as $n
        | select($n > 0) | [$a, $n, (.model // "")] | @tsv' 2>/dev/null | tail -1 ;;
    pi)
      d="$HOME/.pi/agent/sessions/--$(printf '%s' "$cwd" | sed 's|^/||; s|/|-|g')--"
      f=$(ls -t "$d"/*.jsonl 2>/dev/null | head -1)
      [ -n "$f" ] || continue
      tail -c 4000000 "$f" | grep -F '"usage"' | jq -rR --arg a "$a" 'fromjson? | .message
        | select(.role == "assistant" and (.usage.totalTokens // 0) > 0)
        | [$a, .usage.totalTokens, (.model // "")] | @tsv' 2>/dev/null | tail -1 ;;
    opencode*)
      python3 - "$a" "$cwd" 2>/dev/null <<'PY'
import json, os, sqlite3, sys
a, cwd = sys.argv[1:3]
path = os.path.join(os.environ.get("OPENCODE_DATA_DIR") or os.path.expanduser("~/.local/share/opencode"), "opencode.db")
if not os.path.exists(path):
    sys.exit()
db = sqlite3.connect("file:" + path + "?mode=ro", uri=True, timeout=5)
tables = {r[0] for r in db.execute("select name from sqlite_master where type = 'table'")}
best = None
# Both table generations: session + message, session_v2 + session_message.
for s, m, where in (("session", "message", "data like '%\"assistant\"%'"), ("session_v2", "session_message", "type = 'assistant'")):
    if s not in tables or m not in tables:
        continue
    q = "select time_created, data from %s where %s and session_id in (select id from %s where directory = ?)" % (m, where, s)
    for created, data in db.execute(q, (cwd,)):
        try:
            d = json.loads(data)
        except ValueError:
            continue
        t = d.get("tokens")
        if d.get("role", "assistant") != "assistant" or not isinstance(t, dict):
            continue
        c = t.get("cache") or {}
        n = sum(int(x or 0) for x in (t.get("input"), t.get("output"), t.get("reasoning"), c.get("read"), c.get("write")))
        mod = d.get("modelID") or (d.get("model") or {}).get("id") or ""
        if n > 0 and (best is None or created > best[0]):
            best = (created, n, mod)
if best:
    print("%s\t%d\t%s" % (a, best[1], best[2]))
PY
      ;;
  esac
done
`;

// "<machine>/t12" → machine and the address there; a bare "t12" is this machine.
const splitAddress = (address) => {
  const i = address.lastIndexOf("/");
  return i < 0 ? { on: null, local: address } : { on: address.slice(0, i), local: address.slice(i + 1) };
};

let cache = { at: 0, key: "", contexts: {}, pending: null, pendingKey: "" };

// { [address]: { tokens, model } } for the given addresses, read at most every 15 s.
export function loadContexts(addresses) {
  const key = addresses.join(" ");
  if (key === cache.key && Date.now() - cache.at < 15000) return Promise.resolve(cache.contexts);
  if (cache.pending) {
    // A read for other agents is under way: wait for it, then read these.
    return cache.pendingKey === key ? cache.pending : cache.pending.then(() => loadContexts(addresses));
  }
  cache.pendingKey = key;
  cache.pending = (async () => {
    const byMachine = new Map();
    for (const a of addresses) {
      const { on, local } = splitAddress(a);
      if (!byMachine.has(on)) byMachine.set(on, []);
      byMachine.get(on).push({ a, local });
    }
    const contexts = {};
    await Promise.all([...byMachine].map(async ([on, list]) => {
      const out = await exec("sh", ["-c", SCRIPT, "sh", ...list.map((x) => x.local)], { on }).catch(() => null);
      for (const line of (out?.stdout ?? "").split("\n")) {
        const [local, tokens, model] = line.split("\t");
        const hit = list.find((x) => x.local === local);
        if (hit && Number(tokens) > 0) contexts[hit.a] = { tokens: Number(tokens), model: model || null };
      }
    }));
    cache = { at: Date.now(), key, contexts, pending: null, pendingKey: "" };
    return contexts;
  })().catch(() => {
    cache = { ...cache, pending: null, pendingKey: "" };
    return cache.contexts;
  });
  return cache.pending;
}

// 143217 → "143k", 1200000 → "1.2M".
export const tokenText = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : `${Math.round(n / 1000)}k`;
