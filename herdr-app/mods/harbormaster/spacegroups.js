// Where a space is and which repository that folder belongs to (pure, so tests can run it;
// repospaces.js uses it for New run).

// The folder a space is in now: its first tab's first pane, else the folder it was made in.
export function whereOf(space, ps) {
  const first = space.tabs?.[0]?.id;
  return (first ? ps.find((p) => p.tab === first)?.cwd : null) || space.folder || "";
}

// What `git rev-parse --show-toplevel --git-common-dir` printed for a folder, as the
// repository's path and whether the folder is a linked worktree of it; null for no repository.
export function repoOf(out) {
  const [top, common] = (out ?? "").split("\n");
  if (!top || !common) return null;
  // A submodule's git dir is inside its parent's .git/modules: it is its own repository.
  if (common.includes("/.git/modules/")) return { repo: top, linked: false };
  const repo = common.endsWith("/.git") ? common.slice(0, -5) : common.replace(/\.git$/, "");
  return { repo, linked: common !== `${top}/.git` };
}
