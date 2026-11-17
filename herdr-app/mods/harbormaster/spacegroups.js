// Which repository each space belongs to and how the Spaces popup groups them (pure, so
// tests can run it; spaces.js draws).

const base = (p) => p.replace(/\/+$/, "").split("/").at(-1);

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

// Groups in the order their first space appears: [{ key, name, machine, repo, spaces: [{ space, linked }] }],
// each repository's own spaces before its worktrees', non-repositories last under "Other".
// `repos` maps a space id to repoOf(...) (absent while git is still being asked).
export function groupSpaces(all, repos) {
  const groups = [], byKey = new Map();
  const group = (key, name, machine, repo) => {
    if (!byKey.has(key)) { const g = { key, name, machine, repo, spaces: [] }; byKey.set(key, g); groups.push(g); }
    return byKey.get(key);
  };
  for (const s of all) {
    const r = repos[s.id], machine = s.machine ?? null;
    if (r) group(`${machine}\n${r.repo}`, base(r.repo), machine, true).spaces.push({ space: s, linked: r.linked });
    else group(`${machine}\n`, "Other", machine, false).spaces.push({ space: s, linked: false });
  }
  for (const g of groups) g.spaces.sort((a, b) => Number(a.linked) - Number(b.linked));
  return [...groups.filter((g) => g.repo), ...groups.filter((g) => !g.repo)];
}

