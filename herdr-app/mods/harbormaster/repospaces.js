// The repositories open in the Herdr window, for the New run dialog and the review requests: the
// same idea as skills/herdr-app-captain/scripts/repo-spaces.sh, from the window's own spaces,
// plus the clones found beside them (a review can open a space for one). A space counts when its
// first tab's first pane (else its folder) is in a repository's own checkout (a "primary" space);
// linked worktrees belong to runs and are left out. Which repository a folder is: spacegroups.js (whereOf, repoOf).

import { exec, spaces, panes } from "herdr";
import { whereOf, repoOf } from "./spacegroups.js";
import { spaceFolders, parseFound, scanParents, FIND_SCRIPT } from "./folders.js";

// "git@github.com:o/r.git", "https://github.com/o/r" → "o/r" (lower-cased: GitHub ignores case).
export function ownerRepo(url) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(url ?? "").trim());
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

// `on`: the machine (a space's `machine`), null for this one.
const sh = (script, args = [], on = null) => exec("sh", ["-c", script, "_", ...args], { timeout: 5000, ...(on ? { on } : {}) });
const base = (p) => p.replace(/\/+$/, "").split("/").at(-1);

// "<machine>\n<cwd>" → {root, kind, origin} | null; a folder's repository rarely changes. The same
// path on two machines is two folders: git is asked on the folder's own machine (`on`).
const known = new Map();
async function inspect(cwd, on = null) {
  const k = `${on ?? ""}\n${cwd}`;
  if (known.has(k)) return known.get(k);
  const where = on ? { on } : {};
  const rev = await exec("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { timeout: on ? 8000 : 3000, ...where }).catch(() => null);
  const found = rev?.code === 0 ? repoOf(rev.stdout.trim()) : null;
  const repo = found ? { root: found.repo, kind: found.linked ? "worktree" : "primary", origin: null } : null;
  if (repo) {
    const o = await exec("git", ["-C", repo.root, "remote", "get-url", "origin"], { timeout: 8000, ...where }).catch(() => null);
    repo.origin = o?.code === 0 ? ownerRepo(o.stdout) : null;
  }
  if (repo) known.set(k, repo); // a folder that is no repository yet may become one
  return repo;
}

// The open repository spaces on every machine: [{space, name, root, origin, machine}], one per
// repository and machine, this machine's first. From openFolders(), the spaces' own folders: the
// old way read only each space's first pane (whose live folder may be elsewhere than the space's,
// and the dedupe by root hid a second space), so a space could drop out of the list. Another
// machine's spaces count too: a review started there runs there (newrun.js).
export async function repoSpaces() {
  const seen = new Set(), out = [];
  const entries = (await openFolders()).filter((e) => e.space);
  const found = await Promise.all(entries.map((e) => inspect(e.folder, e.machine).catch(() => null)));
  entries.forEach((e, i) => {
    const repo = found[i], k = `${e.machine ?? ""}\n${repo?.root}`;
    if (!repo || repo.kind !== "primary" || seen.has(k)) return;
    seen.add(k);
    out.push({ space: e.space, name: base(repo.root), root: repo.root, origin: repo.origin, machine: e.machine ?? null });
  });
  return [...out.filter((r) => !r.machine), ...out.filter((r) => r.machine)];
}

// The space id start-agent.sh makes Herdr open for a repository with none ("sp-<name>": letters,
// digits and "-"; as herdr-app-captain's Start a run does).

// The repository a folder is in (its toplevel), else the folder itself: the key drafts modes are remembered under.
export async function repoRoot(folder, on = null) {
  return (await inspect(folder, on).catch(() => null))?.root ?? folder;
}

// Clones found beside the open repositories: the repositories in the parent folders of the open
// repository spaces' roots (one level down), on the same machine, that are not open themselves.
// [{space: null, name, root, origin, machine}]. Cached a few minutes per machine and parent folder,
// at most 60 folders each: one `ls`.
const CLONES_MS = 5 * 60000, CLONES_MAX = 60;
const cloneCache = new Map(); // "<machine>\n<parent>" → {at, list}
export async function cloneRepos(open) {
  const at = (r) => `${r.machine ?? ""}\n${r.root}`;
  const isOpen = new Set(open.map(at));
  const parents = [...new Map(open.map((r) => [`${r.machine ?? ""}\n${r.root.replace(/\/[^/]+\/?$/, "")}`, { on: r.machine ?? null, parent: r.root.replace(/\/[^/]+\/?$/, "") }])).values()].filter((p) => p.parent);
  const out = [];
  for (const { on, parent } of parents) {
    const ck = `${on ?? ""}\n${parent}`;
    let c = cloneCache.get(ck);
    if (!c || Date.now() - c.at > CLONES_MS) {
      const ls = await sh('ls -d "$1"/*/.git 2>/dev/null | head -n "$2"', [parent, String(CLONES_MAX)], on).catch(() => null);
      const list = [];
      for (const g of String(ls?.stdout ?? "").split("\n").filter(Boolean)) {
        const repo = await inspect(g.replace(/\/\.git$/, ""), on);
        if (repo?.kind === "primary" && repo.origin) list.push({ space: null, name: base(repo.root), root: repo.root, origin: repo.origin, machine: on });
      }
      if (ls) { c = { at: Date.now(), list }; cloneCache.set(ck, c); } else c = { list };
    }
    out.push(...c.list.filter((r) => !isOpen.has(at(r)) && !out.some((o) => at(o) === at(r))));
  }
  return out;
}

// Every repository a review can run in: the open spaces, then the clones found.
export async function knownRepos() {
  const open = await repoSpaces();
  return [...open, ...await cloneRepos(open).catch(() => [])];
}

// ---- the folders the New run dialog offers (folders.js has the rules) ----

// Every open space by its folder, as Herdr's Spaces list has them, not only the repositories: a
// folder holding several is a place for one orchestrator. Git is asked only to leave out the
// linked worktrees of runs (their repository is listed instead).
export async function openFolders() {
  const ps = panes(), all = spaces(), roots = new Map(); // linked worktree folder → its repository
  await Promise.all(all.map(async (s) => {
    const where = s.folder || whereOf(s, ps);
    const repo = where && !s.machine ? await inspect(where).catch(() => null) : null;
    if (repo?.kind === "worktree") roots.set(where, repo.root);
  }));
  return spaceFolders(all, (s) => whereOf(s, ps), (f) => roots.get(f) ?? null);
}

// The `folder` of every run directory (<runs root>/<folder>/<branch>/orchestrator.json).
export async function runFolders(root) {
  const r = await sh('ls -t "$1"/*/*/orchestrator.json 2>/dev/null | head -n 40 | while read -r f; do jq -r ".folder // empty" "$f" 2>/dev/null; done', [root]).catch(() => null);
  return String(r?.stdout ?? "").split("\n").filter((l) => l.startsWith("/"));
}

// Folders under the parents, two levels deep: one find, cached a few minutes per set of parents.
const SCAN_MS = 5 * 60000;
const scanCache = new Map(); // parents → {at, list}
export async function scanFolders(entries, home) {
  const { deep, shallow } = scanParents(entries, home);
  if (!deep.length && !shallow) return [];
  const key = `${shallow}\n${deep.join("\n")}`, c = scanCache.get(key);
  if (c && Date.now() - c.at < SCAN_MS) return c.list;
  const r = await exec("sh", ["-c", FIND_SCRIPT, "_", shallow ?? "-", ...deep], { timeout: 4000 }).catch(() => null);
  const list = parseFound(r?.stdout);
  if (r && list.length) scanCache.set(key, { at: Date.now(), list }); // a timeout or nothing is asked again
  return list;
}

// Whether a typed path is a folder here (or on machine `on`).
export const isFolder = async (path, on = null) => (await sh('[ -d "$1" ]', [path], on).catch(() => null))?.code === 0;
