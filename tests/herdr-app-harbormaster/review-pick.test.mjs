// A review request with no checkout found still has Review: it opens New run on the PR's URL with
// no folder chosen, and the dialog says when the folder picked is another repository.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { nextAction } from "../../herdr-app/mods/harbormaster/crew.js";
import { initNewRun, newRunView, originNote } from "../../herdr-app/mods/harbormaster/newrun.js";
import { find } from "./gpui-stub.mjs";

const t = new Proxy({}, { get: () => "#888" });
const text = (e) => (e && typeof e === "object" && "kids" in e ? e.kids.map(text).join("") : typeof e === "string" ? e : "");
const URL_ = "https://github.com/acme/app/pull/13";
const item = (local) => ({ kind: "review", repo: "acme/app", number: 13, title: "Fix it", url: URL_, local, run: null });
const click = (el) => el.click({}, cx());

function cx() {
  return { notify() {}, stop_propagation() {}, bind_keys: () => 1, spawn(body) { return Promise.resolve().then(() => body(cx())); } };
}

beforeEach(() => { globalThis.__herdrOpened = null; });

test("a review with no checkout has Review, opening New run on the PR's URL with no folder", () => {
  const btn = nextAction({ t }, item(null), "x");
  assert.equal(text(btn), "Review");
  click(find(btn, "x-act"));
  const p = globalThis.__herdrOpened.props;
  assert.equal(p.kind, "review");
  assert.equal(p.input, URL_);
  assert.equal(p.url, URL_);
  assert.equal(p.prRepo, "acme/app");
  assert.equal(p.repo, undefined);
});

test("a review with a checkout opens New run on that folder with the PR's number, as before", () => {
  click(find(nextAction({ t }, item({ root: "/home/u/projects/app", machine: null }), "x"), "x-act"));
  const p = globalThis.__herdrOpened.props;
  assert.equal(p.repo, "/home/u/projects/app");
  assert.equal(p.input, "13");
});

test("originNote: nothing for the PR's repository, a warning for another one or none", () => {
  assert.equal(originNote("acme/app", "acme/app"), null);
  assert.equal(originNote("Acme/App", "acme/app"), null);
  assert.equal(originNote("acme/app", "lab/api"), "This folder is lab/api; the PR is in acme/app");
  assert.equal(originNote("acme/app", null), "This folder has no GitHub origin; the PR is in acme/app");
  assert.equal(originNote(null, "lab/api"), null);
});

const settle = () => new Promise((r) => setTimeout(r, 30));

test("opened for a PR with no checkout, the dialog chooses no folder and warns on a wrong one", async () => {
  globalThis.__herdrChecking = false;
  globalThis.__herdrExec = async (cmd, args) => {
    if (cmd === "git" && args.includes("rev-parse")) return { code: 0, stdout: `${args[1]}\n${args[1]}/.git\n`, stderr: "" };
    if (cmd === "git" && args.includes("get-url")) return { code: 0, stdout: "git@github.com:lab/api.git\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  globalThis.__herdrProps = { role: "newrun", kind: "review", input: URL_, url: URL_, prRepo: "acme/app", overlay: "ov1" };
  try {
    const view = {};
    initNewRun(view, cx());
    await settle();
    assert.equal(view.nr.folder, null, "no folder is guessed");
    const wrong = { folder: "/home/u/projects/api", name: "api", space: null, machine: null };
    view.nr.entries = [wrong];
    newRunView(view, t); // a render works with no folder
    // Choosing the folder (as a list row's click does) checks its origin.
    view.nr.open = true; view.nr.query = "api";
    view.nr.found = [];
    const row = find(newRunView(view, t), "nr-f-0");
    click(row);
    await settle();
    assert.match(text(newRunView(view, t)), /This folder is lab\/api; the PR is in acme\/app/);
  } finally {
    globalThis.__herdrChecking = undefined;
    globalThis.__herdrProps = undefined;
  }
});
