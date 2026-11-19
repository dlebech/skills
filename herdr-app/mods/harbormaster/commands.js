// The commands Harbormaster hears (`herdr-app do 'harbormaster.<command>'`, or a toast's click),
// parsed, and the run a command names. Pure, so the tests drive the parse.

// "show-run:feat/x details" → {name: "show-run", arg: "feat/x details"}. The separator is a
// colon or spaces; the arg keeps any colon of its own after it.
export function parseCommand(c) {
  const [, name, arg] = /^([\w-]+)(?::|\s+|$)(.*)$/s.exec(String(c).trim()) ?? [];
  return { name: name ?? null, arg: arg?.trim() ?? "" };
}

// A toast's click for a run (telling.js): its card by the run's key, which is unique across
// machines ("<machine>:<dir>", ":<dir>" for a local run), where a directory alone is not.
export const openRunAction = (run) => `harbormaster.open-run:key=${run.key}`;

// The run a command's name means: "key=<run key>" names exactly that run; anything else is a
// branch, run directory, key or orchestrator terminal, the first run it matches.
export function runNamed(runs, name) {
  if (name.startsWith("key=")) return runs.find((x) => x.key === name.slice(4));
  return runs.find((x) => [x.branch, x.dir, x.key, x.localTerminal].includes(name));
}

// "repo=skills kind=review input=123" → {repo, kind, input}; keys in any order, input= takes the rest
// (so it may hold spaces and other key=value text).
// "skills=peer" → {key: "skills", flow: "peer"}; "skills=default" → flow null (the built-in
// default again); anything else null. The key is a folder name, as attention.js flowKey makes it.
export function flowArgs(arg) {
  const m = /^([^\s=/]+)=(peer|self|default)$/.exec(String(arg ?? "").trim());
  return m ? { key: m[1], flow: m[2] === "default" ? null : m[2] } : null;
}

export function newRunArgs(arg) {
  const out = {};
  let rest = String(arg).trim();
  for (let m; (m = /^(repo|kind|input)=(.*)$/s.exec(rest));) {
    if (m[1] === "input") { out.input = m[2]; break; }
    const [, v = "", tail = ""] = /^(\S*)\s*(.*)$/s.exec(m[2]);
    if (v) out[m[1]] = v;
    rest = tail;
  }
  return out;
}
