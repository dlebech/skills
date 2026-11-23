// The folders the New run dialog offers (pure, so tests drive it; newrun.js draws and asks the
// system): Herdr's own spaces by their folders, the folders runs were started in, and, for typed
// text, folder names found under the parents of those. A folder need not be a repository: a
// folder holding several is a fine place for one orchestrator.

export const RECENT_MAX = 8;
export const base = (p) => String(p).replace(/\/+$/, "").split("/").at(-1) || "/";
const trim = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
export const parentOf = (p) => trim(p).replace(/\/[^/]+$/, "") || "/";

// "~/x" with the home folder; anything else as given.
export const expandHome = (p, home) => (p === "~" ? home : p.startsWith("~/") ? `${home}/${p.slice(2)}` : p);
// The folder with the home folder as "~", for display.
export const tilde = (p, home) => (home && p === home ? "~" : home && p.startsWith(`${home}/`) ? `~/${p.slice(home.length + 1)}` : p);

// Where a space is, as Herdr's Spaces list names it: where its first terminal is now, unless that
// is its `folder` or inside it. Herdr's `folder` is only where it was made and goes stale: a space
// made in one folder whose terminal now works in another is that other folder's space, not the
// first one's, so New run must not start a run in it for the first. Its `folder` when no
// terminal's folder is known (`ps`: panes()).
export function placeOf(space, ps) {
  const folder = trim(String(space.folder || ""));
  const first = space.tabs?.[0]?.id;
  const cwd = trim(String((first ? ps.find((p) => p.tab === first)?.cwd : null) || ""));
  if (!cwd || (folder && (cwd === folder || cwd.startsWith(`${folder}/`)))) return folder;
  return cwd;
}

// The open spaces as folder entries: [{folder, name, space, machine}] in the Spaces list's
// order. A space counts by where it is (`whereOf`: placeOf, else its `folder`). Two spaces on
// one folder both show when their names differ. A linked worktree (`rootOf(folder)` names its
// main repository) is replaced by that repository, which has an entry of its own only when no
// space of its own is open.
export function spaceFolders(spaces, whereOf, rootOf = () => null) {
  const byKey = new Map(), own = new Set();
  for (const s of spaces) {
    const where = trim(whereOf(s) || s.folder || "");
    if (!where) continue;
    const root = (!s.machine && rootOf(where)) || where;
    const mine = root === where, m = s.machine ?? "";
    if (mine) own.add(`${m}\n${root}`);
    const key = `${m}\n${root}${mine ? `\n${s.name}` : ""}`;
    if (!byKey.has(key)) byKey.set(key, { folder: root, name: s.name, space: mine ? s.id : null, machine: s.machine ?? null, mine });
  }
  return [...byKey.values()].filter((e) => e.mine || !own.has(`${e.machine ?? ""}\n${e.folder}`)).map(({ mine, ...e }) => e);
}

// A space's id as its own machine names it: Herdr prefixes another machine's ids with "<machine>/".
export const ownId = (id, machine) => (machine && String(id ?? "").startsWith(`${machine}/`) ? String(id).slice(machine.length + 1) : id);

// A space id for starting in a folder with none: sp-<name>, as the captain's Start a run makes it,
// unless an open space of that id on the same machine (`machine`, null for this one) holds another
// folder; then the parent's name goes in too. The id is as that machine names it (no prefix).
export function newSpaceId(folder, openSpaces, machine = null) {
  const slug = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const id = `sp-${slug(base(folder)) || "repo"}`;
  const clash = openSpaces.some((s) => (s.machine ?? null) === machine && ownId(s.id, machine) === id && trim(s.folder || "") !== trim(folder));
  return clash ? `${id}-${slug(base(parentOf(folder))) || "root"}` : id;
}

// The space a New run in `folder` starts in, on `machine` (null: this one): one that is there
// (placeOf), one whose own `folder` is it too first. Exact folder only; a space with only some
// other tab there does not count, nor do another machine's spaces. Null for none.
export function spaceAt(folder, spaces, panes, machine = null) {
  const want = trim(String(folder || ""));
  if (!want) return null;
  const here = spaces.filter((s) => (s.machine ?? null) === machine && placeOf(s, panes) === want);
  return (here.find((s) => trim(String(s.folder || "")) === want) ?? here[0])?.id ?? null;
}

// The folders runs were started in or have: the dialog's own history first (newest first), then
// the run directories' `folder`s; no duplicates, RECENT_MAX in all (`runFolders` newest run first).
export function recentFolders(history = [], runFolders = []) {
  const out = [];
  for (const f of [...history, ...runFolders]) {
    const t = typeof f === "string" && f ? trim(f) : null;
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, RECENT_MAX);
}

// What the dialog shows with nothing typed: the spaces, then the recents that have no space.
export function listFolders({ spaces, recents }) {
  const have = new Set(spaces.filter((s) => !s.machine).map((s) => s.folder));
  return [...spaces, ...recents.filter((f) => !have.has(f)).map((folder) => ({ folder, name: base(folder), space: null, machine: null, recent: true }))];
}

// How well `query` matches `text`, 0 for no match: whole name > prefix > word start > inside >
// letters in order. Case-insensitive; shorter names win ties.
export function fuzzyScore(query, text) {
  const q = String(query).toLowerCase().trim(), t = String(text).toLowerCase();
  if (!q) return 1;
  if (t === q) return 1000;
  let score = 0;
  if (t.startsWith(q)) score = 800;
  else if (new RegExp(`[^a-z0-9]${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)) score = 600;
  else if (t.includes(q)) score = 400;
  else {
    let i = 0;
    for (const c of t) if (c === q[i]) i++;
    if (i < q.length) return 0;
    score = 100;
  }
  return score - Math.min(t.length, 99) / 100;
}

// Words that pick this machine in a query: "local", "here", "this".
const HERE = new Set(["local", "here", "this"]);

// A query split into the machine it names and the rest: a word that is a machine's exact name
// (any case), or "<name>:" before the rest, picks that machine; "local"/"here"/"this" this one
// (null). Never a prefix: "des ign" must not hide a "design" folder behind a machine "desk".
// `machine` is undefined when no word names one. `machines`: the other machines' names.
export function machineQuery(query, machines = []) {
  const q = String(query).trim();
  const names = [...new Set(machines.filter(Boolean))];
  const named = (w) => {
    const x = w.toLowerCase();
    if (HERE.has(x)) return null;
    return names.find((n) => n.toLowerCase() === x);
  };
  // "<name>:rest" (no space needed).
  const colon = /^([^\s/~:]+):\s*(.*)$/s.exec(q);
  if (colon) {
    const m = named(colon[1]);
    if (m !== undefined) return { machine: m, text: colon[2].trim() };
  }
  const words = q.split(/\s+/).filter(Boolean);
  // A single word is a folder's name, maybe the same as a machine's.
  if (words.length < 2) return { machine: undefined, text: q };
  for (let i = 0; i < words.length; i++) {
    const m = named(words[i]);
    if (m !== undefined) return { machine: m, text: words.filter((_, j) => j !== i).join(" ") };
  }
  return { machine: undefined, text: q };
}

// How well a query matches an entry: its folder's name, its space's name, or its path, so
// "work/api" or "work api" tell two folders of one name apart. A word with "/" or "~" is matched
// against the path; any other word against the path only as a plain substring (letters scattered
// along a long path match almost anything). Every word must match.
export function entryScore(q, e, home = "") {
  const words = String(q).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const path = tilde(e.folder, home);
  let total = 0;
  for (const w of words) {
    const s = /[/~]/.test(w)
      ? fuzzyScore(w, path) * 0.95
      : Math.max(fuzzyScore(w, base(e.folder)), fuzzyScore(w, e.name ?? "") * 0.9, path.toLowerCase().includes(w.toLowerCase()) ? 200 : 0);
    if (s <= 0) return 0;
    total += s;
  }
  return total / words.length;
}

// The entries typed text finds: open spaces and recents by folder name (or space name, or path),
// then the folders found on disk, best match first; a machine's name in the query keeps only that
// machine's folders (machineQuery). `entries` is listFolders(); `found` this machine's scanned paths.
export function matchFolders(query, entries, found = [], limit = 20, home = "") {
  const all = [...entries];
  const seen = new Set(entries.filter((e) => !e.machine).map((e) => e.folder));
  for (const folder of found) if (!seen.has(folder)) { seen.add(folder); all.push({ folder, name: base(folder), space: null, machine: null }); }
  const { machine, text } = machineQuery(query, entries.map((e) => e.machine));
  if (!String(query).trim()) return entries.slice(0, limit);
  const pool = machine === undefined ? all : all.filter((e) => (e.machine ?? null) === machine);
  if (!text) return pool.slice(0, limit);
  return pool
    .map((e, i) => ({ e, i, s: entryScore(text, e, home) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}

// Where an entry is, for the list and the input: "this computer" or the machine's name.
export const machineLabel = (e) => e?.machine ?? "this computer";

// A typed path ("~/x", "/x") as an entry, for the user to pick when it is a folder; else null.
export const literalFolder = (text, home) => {
  const t = String(text).trim();
  if (!/^(~|\/)/.test(t)) return null;
  const folder = trim(expandHome(t, home));
  return { folder, name: base(folder), space: null, machine: null, typed: true };
};

// The parents on this machine whose children typed text may find: those of the open spaces' and
// recent folders (the folder holding several repositories is itself one, so its own children are
// found too), and the parents of another machine's spaces, looked for here: the same folders are
// often in both places, and a laptop used as a thin client may have no space of its own open.
// The home folder is only ever read one level deep (`shallow`): two levels of it is a lot of disk.
export function scanParents(entries, home = "") {
  const out = new Set();
  for (const e of entries) {
    if (!e.folder?.startsWith("/") || e.folder === "/") continue;
    out.add(parentOf(e.folder));
    if (!e.machine) out.add(e.folder);
  }
  out.delete("/");
  const shallow = home && out.delete(home) ? home : null;
  return { deep: [...out], shallow };
}

// The shell that finds them: $1 is a folder read one level deep ("-" for none), the rest two
// levels; hidden folders and the usual heavy ones pruned. Run with a timeout by the caller.
export const FIND_SCRIPT = 's=$1; shift; [ "$s" = - ] || find "$s" -maxdepth 1 -mindepth 1 \\( -name ".*" -o -name node_modules -o -name target -o -name vendor \\) -prune -o -type d -print 2>/dev/null; [ $# -eq 0 ] || find "$@" -maxdepth 2 -mindepth 1 \\( -name ".*" -o -name node_modules -o -name target -o -name vendor \\) -prune -o -type d -print 2>/dev/null; true';
export const parseFound = (stdout) => [...new Set(String(stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).map(trim))];
