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

// The open spaces as folder entries: [{folder, name, space, machine}] in the Spaces list's
// order. A space counts by the folder it starts terminals in (its `folder`, else where its first
// terminal is: `whereOf`). Two spaces on one folder both show when their names differ. A linked
// worktree (`rootOf(folder)` names its main repository) is replaced by that repository, which
// has an entry of its own only when no space of its own is open.
export function spaceFolders(spaces, whereOf, rootOf = () => null) {
  const byKey = new Map(), own = new Set();
  for (const s of spaces) {
    const where = trim(s.folder || whereOf(s) || "");
    if (!where) continue;
    const root = (!s.machine && rootOf(where)) || where;
    const mine = root === where, m = s.machine ?? "";
    if (mine) own.add(`${m}\n${root}`);
    const key = `${m}\n${root}${mine ? `\n${s.name}` : ""}`;
    if (!byKey.has(key)) byKey.set(key, { folder: root, name: s.name, space: mine ? s.id : null, machine: s.machine ?? null, mine });
  }
  return [...byKey.values()].filter((e) => e.mine || !own.has(`${e.machine ?? ""}\n${e.folder}`)).map(({ mine, ...e }) => e);
}

// A space id for starting in a folder with none: sp-<name>, as the captain's Start a run makes it,
// unless an open space of that id holds another folder; then the parent's name goes in too.
export function newSpaceId(folder, openSpaces) {
  const slug = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const id = `sp-${slug(base(folder)) || "repo"}`;
  const clash = openSpaces.some((s) => s.id === id && trim(s.folder || "") !== trim(folder));
  return clash ? `${id}-${slug(base(parentOf(folder))) || "root"}` : id;
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

// The entries typed text finds: open spaces and recents by folder name (or space name), then the
// folders found on disk, best match first. `entries` is listFolders(); `found` the scanned paths.
export function matchFolders(query, entries, found = [], limit = 20) {
  const q = String(query).trim();
  if (!q) return entries.slice(0, limit);
  const all = [...entries];
  const seen = new Set(entries.filter((e) => !e.machine).map((e) => e.folder));
  for (const folder of found) if (!seen.has(folder)) { seen.add(folder); all.push({ folder, name: base(folder), space: null, machine: null }); }
  return all
    .map((e, i) => ({ e, i, s: Math.max(fuzzyScore(q, base(e.folder)), fuzzyScore(q, e.name) * 0.9) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}

// A typed path ("~/x", "/x") as an entry, for the user to pick when it is a folder; else null.
export const literalFolder = (text, home) => {
  const t = String(text).trim();
  if (!/^(~|\/)/.test(t)) return null;
  const folder = trim(expandHome(t, home));
  return { folder, name: base(folder), space: null, machine: null, typed: true };
};

// The parents whose children typed text may find: those of the open spaces' and recent folders
// (the folder holding several repositories is itself one, so its own children are found too).
// The home folder is only ever read one level deep (`shallow`): two levels of it is a lot of disk.
export function scanParents(entries, home = "") {
  const out = new Set();
  for (const e of entries) if (!e.machine && e.folder.startsWith("/") && e.folder !== "/") { out.add(parentOf(e.folder)); out.add(e.folder); }
  out.delete("/");
  const shallow = home && out.delete(home) ? home : null;
  return { deep: [...out], shallow };
}

// The shell that finds them: $1 is a folder read one level deep ("-" for none), the rest two
// levels; hidden folders and the usual heavy ones pruned. Run with a timeout by the caller.
export const FIND_SCRIPT = 's=$1; shift; [ "$s" = - ] || find "$s" -maxdepth 1 -mindepth 1 \\( -name ".*" -o -name node_modules -o -name target -o -name vendor \\) -prune -o -type d -print 2>/dev/null; [ $# -eq 0 ] || find "$@" -maxdepth 2 -mindepth 1 \\( -name ".*" -o -name node_modules -o -name target -o -name vendor \\) -prune -o -type d -print 2>/dev/null; true';
export const parseFound = (stdout) => [...new Set(String(stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).map(trim))];
