import { test } from "node:test";
import assert from "node:assert/strict";
import { repoOf, whereOf } from "../../herdr-app/mods/harbormaster/spacegroups.js";

test("repoOf names the repository and tells a linked worktree from its main checkout", () => {
  assert.deepEqual(repoOf("/h/skills\n/h/skills/.git"), { repo: "/h/skills", linked: false });
  assert.deepEqual(repoOf("/w/skills/run-1\n/h/skills/.git"), { repo: "/h/skills", linked: true });
  assert.equal(repoOf("fatal"), null);
});

test("a submodule is its own repository, not a worktree of its parent", () => {
  assert.deepEqual(repoOf("/h/skills/vendor/x\n/h/skills/.git/modules/x"), { repo: "/h/skills/vendor/x", linked: false });
});

test("whereOf prefers the first tab's first pane, then the folder the space was made in", () => {
  const space = { folder: "/made", tabs: [{ id: "t1" }] };
  assert.equal(whereOf(space, [{ tab: "t1", cwd: "/now" }]), "/now");
  assert.equal(whereOf(space, []), "/made");
});
