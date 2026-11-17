// The repositories open in the Herdr window, for the New run dialog and the review requests: the
// same idea as skills/herdr-app-captain/scripts/repo-spaces.sh, from the window's own spaces.
// A space counts when its first tab's first pane (else its folder) is in a repository's own
// checkout (a "primary" space); linked worktrees belong to runs and are left out.

import { exec, spaces, panes } from "herdr";

// "git@github.com:o/r.git", "https://github.com/o/r" → "o/r" (lower-cased: GitHub ignores case).
export function ownerRepo(url) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(url ?? "").trim());
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

// git rev-parse --path-format=absolute --git-common-dir --show-toplevel: two lines → the root and its kind.
export function repoFromRevParse(out) {
  const [common, top] = String(out).trim().split("\n");
  if (!common || !top) return null;
  const root = common.replace(/\/\.git\/?$/, "");
  return { root, kind: top === root ? "primary" : "worktree" };
}

const known = new Map(); // cwd → {root, kind, origin} | null; a folder's repository rarely changes
async function inspect(cwd) {
  if (known.has(cwd)) return known.get(cwd);
  const rev = await exec("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"]).catch(() => null);
  const repo = rev?.code === 0 ? repoFromRevParse(rev.stdout) : null;
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
    const first = s.tabs?.[0]?.id;
    const cwd = (first ? ps.find((p) => p.tab === first)?.cwd : null) || s.folder;
    const repo = cwd ? await inspect(cwd) : null;
    if (!repo || repo.kind !== "primary" || seen.has(repo.root)) continue;
    seen.add(repo.root);
    out.push({ space: s.id, name: repo.root.split("/").pop(), root: repo.root, origin: repo.origin });
  }
  return out;
}
