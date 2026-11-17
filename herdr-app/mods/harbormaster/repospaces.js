// The repositories open in the Herdr window, for the New run dialog and the review requests: the
// same idea as skills/herdr-app-captain/scripts/repo-spaces.sh, from the window's own spaces,
// plus the clones found beside them (a review can open a space for one). A space counts when its
// first tab's first pane (else its folder) is in a repository's own checkout (a "primary" space);
// linked worktrees belong to runs and are left out. Which repository a folder is: spacegroups.js,
// as the Spaces picker has it.

import { exec, spaces, panes } from "herdr";
import { whereOf, repoOf } from "./spacegroups.js";

// "git@github.com:o/r.git", "https://github.com/o/r" → "o/r" (lower-cased: GitHub ignores case).
export function ownerRepo(url) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(url ?? "").trim());
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

const sh = (script, args = []) => exec("sh", ["-c", script, "_", ...args], { timeout: 5000 });
const base = (p) => p.replace(/\/+$/, "").split("/").at(-1);

const known = new Map(); // cwd → {root, kind, origin} | null; a folder's repository rarely changes
async function inspect(cwd) {
  if (known.has(cwd)) return known.get(cwd);
  const rev = await exec("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { timeout: 3000 }).catch(() => null);
  const found = rev?.code === 0 ? repoOf(rev.stdout.trim()) : null;
  const repo = found ? { root: found.repo, kind: found.linked ? "worktree" : "primary", origin: null } : null;
  if (repo) {
    const o = await exec("git", ["-C", repo.root, "remote", "get-url", "origin"]).catch(() => null);
    repo.origin = o?.code === 0 ? ownerRepo(o.stdout) : null;
  }
  if (repo) known.set(cwd, repo); // a folder that is no repository yet may become one
  return repo;
}

// This machine's open repository spaces: [{space, name, root, origin}], one per repository.
export async function repoSpaces() {
  const ps = panes(), seen = new Set(), out = [];
  for (const s of spaces()) {
    if (s.machine) continue; // start-agent.sh and git run here
    const cwd = whereOf(s, ps);
    const repo = cwd ? await inspect(cwd) : null;
    if (!repo || repo.kind !== "primary" || seen.has(repo.root)) continue;
    seen.add(repo.root);
    out.push({ space: s.id, name: base(repo.root), root: repo.root, origin: repo.origin });
  }
  return out;
}

// The space id start-agent.sh makes Herdr open for a repository with none ("sp-<name>": letters,
// digits and "-"; as herdr-app-captain's Start a run does).
export const spaceIdFor = (name) => `sp-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo"}`;

// Clones found beside the open repositories: the repositories in the parent folders of the open
// repository spaces' roots (one level down), that are not open themselves. [{space: null, name,
// root, origin}]. Cached a few minutes per parent folder, at most 60 folders each: one `ls`.
const CLONES_MS = 5 * 60000, CLONES_MAX = 60;
const cloneCache = new Map(); // parent → {at, list}
export async function cloneRepos(open) {
  const isOpen = new Set(open.map((r) => r.root));
  const parents = [...new Set(open.map((r) => r.root.replace(/\/[^/]+\/?$/, "")).filter(Boolean))];
  const out = [];
  for (const parent of parents) {
    let c = cloneCache.get(parent);
    if (!c || Date.now() - c.at > CLONES_MS) {
      const ls = await sh('ls -d "$1"/*/.git 2>/dev/null | head -n "$2"', [parent, String(CLONES_MAX)]).catch(() => null);
      const list = [];
      for (const g of String(ls?.stdout ?? "").split("\n").filter(Boolean)) {
        const repo = await inspect(g.replace(/\/\.git$/, ""));
        if (repo?.kind === "primary" && repo.origin) list.push({ space: null, name: base(repo.root), root: repo.root, origin: repo.origin });
      }
      c = { at: Date.now(), list };
      cloneCache.set(parent, c);
    }
    out.push(...c.list.filter((r) => !isOpen.has(r.root) && !out.some((o) => o.root === r.root)));
  }
  return out;
}

// Every repository a review can run in: the open spaces, then the clones found.
export async function knownRepos() {
  const open = await repoSpaces();
  return [...open, ...await cloneRepos(open).catch(() => [])];
}
