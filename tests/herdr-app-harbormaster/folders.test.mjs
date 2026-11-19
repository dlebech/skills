// The New run dialog's folder list: spaces by folder, recents, fuzzy matching, remembered folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  spaceFolders, newSpaceId, spaceAt, machineQuery, ownId, recentFolders, listFolders, fuzzyScore, matchFolders, literalFolder, scanParents, parseFound, tilde,
} from "../../herdr-app/mods/harbormaster/folders.js";
import { parsePrefs, remember } from "../../herdr-app/mods/harbormaster/startrun.js";

const sp = (id, name, folder, machine = null) => ({ id, name, folder, machine });
const none = () => "";

test("every open space shows by its folder, names and folders crossed or not", () => {
  const out = spaceFolders([sp("s1", "acme-login", "/h/projects/herdr"), sp("s2", "herdr", "/h/projects/acme-login"), sp("s3", "acme", "/h/projects/acme")], none);
  assert.deepEqual(out.map((e) => [e.name, e.folder, e.space]), [
    ["acme-login", "/h/projects/herdr", "s1"], ["herdr", "/h/projects/acme-login", "s2"], ["acme", "/h/projects/acme", "s3"]]);
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
  assert.ok(s("fit") > s("fitkit") && s("fitkit") > s("my-fit") && s("my-fit") > s("outfit") && s("outfit") > s("f-i-t"));
  assert.equal(fuzzyScore("fit", "acme"), 0);
  assert.equal(fuzzyScore("FK", "fitkit") > 0, true);
});

test("typed text finds folders on disk and in the list, best first", () => {
  const entries = listFolders({ spaces: spaceFolders([sp("s", "skills", "/h/projects/skills")], none), recents: [] });
  const found = ["/h/projects/fitkit", "/h/projects/acme/fit-api", "/h/projects/skills", "/h/projects/other"];
  assert.deepEqual(matchFolders("fit", entries, found).map((e) => e.folder), ["/h/projects/fitkit", "/h/projects/acme/fit-api"]);
  assert.deepEqual(matchFolders("skil", entries, found).map((e) => [e.folder, e.space]), [["/h/projects/skills", "s"]]);
  assert.equal(matchFolders("", entries, found).length, 1);
});

test("a typed ~ path becomes a folder entry", () => {
  assert.equal(literalFolder("~/projects/x/", "/home/me").folder, "/home/me/projects/x");
  assert.equal(literalFolder("fit", "/home/me"), null);
  assert.equal(tilde("/home/me/a", "/home/me"), "~/a");
});

test("what is scanned: the parents of spaces and recents, and the folders themselves", () => {
  const e = [{ folder: "/h/projects/skills" }, { folder: "/h/projects/acme" }, { folder: "/x", machine: "box" }];
  assert.deepEqual(scanParents(e).deep.sort(), ["/h/projects", "/h/projects/acme", "/h/projects/skills"]);
  // the home folder is read one level deep only
  const h = scanParents([{ folder: "/h/projects" }], "/h");
  assert.deepEqual(h, { deep: ["/h/projects"], shallow: "/h" });
  assert.deepEqual(parseFound("/a/b\n\nnoise\n/a/b/\n/c"), ["/a/b", "/c"]);
  // another machine's space: its parent is looked for here too (the same folders in both places), not the folder itself
  assert.deepEqual(scanParents([{ folder: "/h/projects/api", machine: "desk" }], "/h"), { deep: ["/h/projects"], shallow: null });
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

test("New run finds the open space on its folder: its own folder, else a terminal live there", () => {
  const tabbed = (id, name, folder, tabs, machine = null) => ({ ...sp(id, name, folder, machine), tabs: tabs.map((t) => ({ id: t })) });
  const pane = (tab, cwd) => ({ tab, cwd });
  // stale folder, its only terminal live in the picked folder
  const stale = [tabbed("sp840046", "skills", "/h/worktrees/acme-api/issue-1235", ["t1"])];
  assert.equal(spaceAt("/h/projects/skills", stale, [pane("t1", "/h/projects/skills")]), "sp840046");
  assert.equal(spaceAt("/h/projects/skills", stale, [pane("t1", "/h/worktrees/acme-api/issue-1235")]), null);
  // a space whose own folder matches wins over another space with a live pane there
  const both = [tabbed("other", "a", "/h/x", ["t2"]), tabbed("own", "b", "/h/projects/skills", ["t3"])];
  assert.equal(spaceAt("/h/projects/skills", both, [pane("t2", "/h/projects/skills")]), "own");
  // a remote space with a live pane there is not chosen
  const remote = [tabbed("r1", "r", "/h/elsewhere", ["t4"], "box")];
  assert.equal(spaceAt("/h/projects/skills", remote, [pane("t4", "/h/projects/skills")]), null);
  // a pane of another space's tab does not count
  assert.equal(spaceAt("/h/projects/skills", [tabbed("s9", "z", "", ["t5"])], [pane("t6", "/h/projects/skills")]), null);
  // nothing matches, exact folder only (no subfolder or parent matching)
  assert.equal(spaceAt("/h/projects/skills", [tabbed("other", "a", "/h/x", ["t2"])], [pane("t2", "/h/projects/skills/sub"), pane("t2", "/h/projects")]), null);
  assert.equal(spaceAt("/h/projects/skills", [], []), null);
  // trailing slashes on either side still match
  assert.equal(spaceAt("/h/projects/skills/", [sp("s1", "a", "/h/projects/skills")], []), "s1");
  assert.equal(spaceAt("/h/projects/skills", [sp("s2", "a", "/h/projects/skills/")], []), "s2");
  assert.equal(spaceAt("/h/projects/skills", [tabbed("s3", "a", "", ["t7"])], [pane("t7", "/h/projects/skills/")]), "s3");
});

test("a machine's name in the query keeps only its folders; local/here this machine's", () => {
  const e = (folder, machine = null) => ({ folder, name: folder.split("/").at(-1), space: "x", machine });
  const entries = [e("/h/projects/api"), e("/h/projects/api", "desk"), e("/h/projects/skills", "desk"), e("/h/work/api")];
  const pick = (q) => matchFolders(q, entries, [], 20, "/h").map((x) => `${x.machine ?? "here"}:${x.folder}`);
  assert.deepEqual(pick("desk ap"), ["desk:/h/projects/api"]);
  assert.deepEqual(pick("desk:ap"), ["desk:/h/projects/api"]);
  assert.deepEqual(pick("de ap"), ["desk:/h/projects/api"], "a prefix of one machine's name");
  assert.deepEqual(pick("local ap"), ["here:/h/projects/api", "here:/h/work/api"]);
  assert.deepEqual(pick("desk"), [], "one word is a folder's name, not a machine");
  assert.equal(pick("ap").length, 3);
  // a path piece tells two folders of one name apart
  assert.deepEqual(pick("work/ap"), ["here:/h/work/api"]);
  assert.deepEqual(pick("work ap"), ["here:/h/work/api"]);
  assert.deepEqual(machineQuery("desk ap", ["desk"]), { machine: "desk", text: "ap" });
  assert.deepEqual(machineQuery("ap", ["desk"]), { machine: undefined, text: "ap" });
});

test("another machine's spaces: their own ids, and spaceAt/newSpaceId per machine", () => {
  assert.equal(ownId("desk/sp-skills", "desk"), "sp-skills");
  assert.equal(ownId("sp-skills", null), "sp-skills");
  const open = [{ id: "desk/sp-skills", folder: "/h/proj/skills", machine: "desk" }];
  assert.equal(spaceAt("/h/proj/skills", open, [], "desk"), "desk/sp-skills");
  assert.equal(spaceAt("/h/proj/skills", open, []), null, "not this machine's");
  assert.equal(newSpaceId("/h/work/skills", open, "desk"), "sp-skills-work");
  assert.equal(newSpaceId("/h/work/skills", open), "sp-skills", "another machine's ids do not clash here");
});
