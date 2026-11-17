// The New run dialog's folder list: spaces by folder, recents, fuzzy matching, remembered folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  spaceFolders, newSpaceId, recentFolders, listFolders, fuzzyScore, matchFolders, literalFolder, scanParents, parseFound, tilde,
} from "../../herdr-app/mods/harbormaster/folders.js";
import { parsePrefs, remember } from "../../herdr-app/mods/harbormaster/startrun.js";

const sp = (id, name, folder, machine = null) => ({ id, name, folder, machine });
const none = () => "";

test("every open space shows by its folder, names and folders crossed or not", () => {
  const out = spaceFolders([sp("s1", "snelogin", "/h/projects/herdr"), sp("s2", "herdr", "/h/projects/snelogin"), sp("s3", "snevagten", "/h/projects/snevagten")], none);
  assert.deepEqual(out.map((e) => [e.name, e.folder, e.space]), [
    ["snelogin", "/h/projects/herdr", "s1"], ["herdr", "/h/projects/snelogin", "s2"], ["snevagten", "/h/projects/snevagten", "s3"]]);
});

test("a space with no folder uses where its first terminal is; one with neither is left out", () => {
  const out = spaceFolders([sp("s1", "a", ""), sp("s2", "b", "")], (s) => (s.id === "s1" ? "/h/a" : ""));
  assert.deepEqual(out.map((e) => e.folder), ["/h/a"]);
});

test("a run's worktree space gives way to its repository, whose own space wins", () => {
  const rootOf = (f) => (f.includes("/worktrees/") ? "/h/skills" : null);
  const wt = sp("w", "calm", "/h/worktrees/skills/calm");
  assert.deepEqual(spaceFolders([wt], none, rootOf).map((e) => [e.folder, e.space]), [["/h/skills", null]]);
  assert.deepEqual(spaceFolders([wt, sp("m", "skills", "/h/skills")], none, rootOf).map((e) => [e.folder, e.space]), [["/h/skills", "m"]]);
  assert.deepEqual(spaceFolders([sp("m", "skills", "/h/skills"), wt], none, rootOf).map((e) => [e.folder, e.space]), [["/h/skills", "m"]]);
});

test("two spaces on one folder both show when their names differ", () => {
  const out = spaceFolders([sp("a", "api", "/h/x"), sp("b", "api", "/h/x"), sp("c", "web", "/h/x")], none);
  assert.deepEqual(out.map((e) => e.space), ["a", "c"]);
});

test("a new space's id is sp-<name>, with the parent's name when another folder holds it", () => {
  assert.equal(newSpaceId("/h/proj/skills", []), "sp-skills");
  assert.equal(newSpaceId("/h/proj/skills", [{ id: "sp-skills", folder: "/h/proj/skills" }]), "sp-skills");
  assert.equal(newSpaceId("/h/work/skills", [{ id: "sp-skills", folder: "/h/proj/skills" }]), "sp-skills-work");
  assert.equal(newSpaceId("/h/My Repo!", []), "sp-my-repo");
});

test("a space on another machine is its own entry", () => {
  const out = spaceFolders([sp("a", "x", "/h/x"), sp("m/a", "x", "/h/x", "box")], none);
  assert.equal(out.length, 2);
  assert.equal(out[1].machine, "box");
});

test("recents: history first, newest first and capped, then run folders, no duplicates", () => {
  const hist = Array.from({ length: 12 }, (_, i) => `/h/p${i}`);
  const r = recentFolders(hist, ["/h/p1", "/h/run/", "/h/x"]);
  assert.equal(r.join(), hist.slice(0, 8).join()); // capped in all
  assert.deepEqual(recentFolders(["/h/a"], ["/h/a", "/h/run/", "/h/x"]), ["/h/a", "/h/run", "/h/x"]);
});

test("the plain list: spaces, then recents that have no space", () => {
  const spaces = spaceFolders([sp("s1", "skills", "/h/skills")], none);
  const list = listFolders({ spaces, recents: ["/h/skills", "/h/old"] });
  assert.deepEqual(list.map((e) => [e.folder, e.space]), [["/h/skills", "s1"], ["/h/old", null]]);
});

test("fuzzy: names rank whole, prefix, word start, inside, then letters in order", () => {
  const s = (t) => fuzzyScore("fit", t);
  assert.ok(s("fit") > s("fitkeep") && s("fitkeep") > s("my-fit") && s("my-fit") > s("outfit") && s("outfit") > s("f-i-t"));
  assert.equal(fuzzyScore("fit", "snevagten"), 0);
  assert.equal(fuzzyScore("FK", "fitkeep") > 0, true);
});

test("typed text finds folders on disk and in the list, best first", () => {
  const entries = listFolders({ spaces: spaceFolders([sp("s", "skills", "/h/projects/skills")], none), recents: [] });
  const found = ["/h/projects/fitkeep", "/h/projects/snevagten/fit-api", "/h/projects/skills", "/h/projects/other"];
  assert.deepEqual(matchFolders("fit", entries, found).map((e) => e.folder), ["/h/projects/fitkeep", "/h/projects/snevagten/fit-api"]);
  assert.deepEqual(matchFolders("skil", entries, found).map((e) => [e.folder, e.space]), [["/h/projects/skills", "s"]]);
  assert.equal(matchFolders("", entries, found).length, 1);
});

test("a typed ~ path becomes a folder entry", () => {
  assert.equal(literalFolder("~/projects/x/", "/home/me").folder, "/home/me/projects/x");
  assert.equal(literalFolder("fit", "/home/me"), null);
  assert.equal(tilde("/home/me/a", "/home/me"), "~/a");
});

test("what is scanned: the parents of spaces and recents, and the folders themselves", () => {
  const e = [{ folder: "/h/projects/skills" }, { folder: "/h/projects/snevagten" }, { folder: "/x", machine: "box" }];
  assert.deepEqual(scanParents(e).deep.sort(), ["/h/projects", "/h/projects/skills", "/h/projects/snevagten"]);
  // the home folder is read one level deep only
  const h = scanParents([{ folder: "/h/projects" }], "/h");
  assert.deepEqual(h, { deep: ["/h/projects"], shallow: "/h" });
  assert.deepEqual(parseFound("/a/b\n\nnoise\n/a/b/\n/c"), ["/a/b", "/c"]);
});

test("remembering a folder: newest first, once, capped; old prefs have none", () => {
  assert.deepEqual(parsePrefs("{}").folders, []);
  let p = parsePrefs("{}");
  for (let i = 0; i < 10; i++) p = remember(p, { kind: "issue", profile: {}, repo: `/h/p${i}`, drafts: "herdr" });
  p = remember(p, { kind: "review", profile: {}, repo: "/h/p5", drafts: "herdr" });
  assert.equal(p.folders.length, 8);
  assert.equal(p.folders[0], "/h/p5");
  assert.equal(p.folders.filter((f) => f === "/h/p5").length, 1);
});
