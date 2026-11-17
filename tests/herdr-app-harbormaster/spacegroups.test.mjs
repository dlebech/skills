import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSpaces, repoOf, whereOf } from "../../herdr-app/mods/harbormaster/spacegroups.js";

test("repoOf names the repository and tells a linked worktree from its main checkout", () => {
  assert.deepEqual(repoOf("/h/skills\n/h/skills/.git"), { repo: "/h/skills", linked: false });
  assert.deepEqual(repoOf("/w/skills/run-1\n/h/skills/.git"), { repo: "/h/skills", linked: true });
  assert.equal(repoOf("fatal"), null);
});

test("groupSpaces puts worktrees under their repository, last, and plain folders under Other", () => {
  const s = (id, machine = null) => ({ id, machine });
  const repos = { a: repoOf("/w/r1\n/h/skills/.git"), b: repoOf("/h/skills\n/h/skills/.git"), d: repoOf("/h/api\n/h/api/.git") };
  const groups = groupSpaces([s("a"), s("b"), s("c"), s("d"), s("e", "m1")], repos);
  assert.deepEqual(groups.map((g) => [g.name, g.spaces.map((x) => x.space.id)]),
    [["skills", ["b", "a"]], ["api", ["d"]], ["Other", ["c"]], ["Other", ["e"]]]);
  assert.equal(groups[0].spaces[1].linked, true);
});

test("a submodule is its own repository, not a worktree of its parent", () => {
  assert.deepEqual(repoOf("/h/skills/vendor/x\n/h/skills/.git/modules/x"), { repo: "/h/skills/vendor/x", linked: false });
});

test("a repository named Other still sorts as a repository", () => {
  const groups = groupSpaces([{ id: "a" }, { id: "b" }], { b: repoOf("/h/Other\n/h/Other/.git") });
  assert.deepEqual(groups.map((g) => g.name), ["Other", "Other"]);
  assert.deepEqual(groups.map((g) => g.repo), [true, false]);
});

test("whereOf prefers the first tab's first pane, then the folder the space was made in", () => {
  const space = { folder: "/made", tabs: [{ id: "t1" }] };
  assert.equal(whereOf(space, [{ tab: "t1", cwd: "/now" }]), "/now");
  assert.equal(whereOf(space, []), "/made");
});
