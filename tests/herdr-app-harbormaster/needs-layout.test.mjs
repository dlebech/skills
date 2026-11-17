import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const filter = fileURLToPath(new URL("../../herdr-app/needs-layout.jq", import.meta.url));
const jq = (doc) => JSON.parse(execFileSync("jq", ["-f", filter], { input: JSON.stringify(doc) }));
const block = (id, mod, props) => ({ id, type: "block", content: { mod, ...(props ? { props } : {}) } });
const all = (node) => [node, ...(node.children ?? []).flatMap(all)];

const main = {
  id: "root", type: "row", children: [{
    id: "sidebar", type: "column", children: [
      block("brand", "workspace-chrome"),
      { id: "lists", type: "column", children: [
        block("spaces", "spaces"), block("spaces2", "spaces"),
        block("crew", "harbormaster", { role: "crew" }),
        { id: "only-agents", type: "column", children: [block("agents", "agents")] },
      ] },
    ],
  }],
};

test("the calm transform drops agents and what they leave empty, keeps one picker last, gives Crew the rest", () => {
  const out = jq(main), nodes = all(out);
  assert.equal(out.id, "root");
  assert.equal(nodes.filter((n) => n.content?.mod === "agents").length, 0);
  assert.equal(nodes.some((n) => n.id === "only-agents"), false);
  const pickers = nodes.filter((n) => n.content?.props?.role === "spaces");
  assert.equal(pickers.length, 1);
  assert.deepEqual(pickers[0].size, { px: 34 });
  // only the first Spaces block is converted; a second one is the user's and stays
  assert.deepEqual(nodes.filter((n) => n.content?.mod === "spaces").map((n) => n.id), ["spaces2"]);
  const lists = nodes.find((n) => n.id === "lists");
  assert.deepEqual(lists.children.map((c) => c.id), ["spaces2", "crew", "spaces-picker"]);
  assert.deepEqual(lists.children[1].size, { weight: 1 });
  assert.equal(lists.children[1].content.props.needs, "box");
});

test("only a container the Agents block left empty is dropped; only the first Spaces block becomes the picker", () => {
  const out = jq({ id: "root", type: "row", children: [
    { id: "a", type: "column", children: [block("spaces", "spaces"), block("crew", "harbormaster", { role: "crew" }), { id: "spacer", type: "column", children: [] }] },
    { id: "b", type: "column", children: [block("spaces-b", "spaces"), { id: "ag", type: "column", children: [block("agents", "agents")] }] },
  ] });
  const ids2 = all(out).map((n) => n.id);
  assert.ok(ids2.includes("spacer"));
  assert.equal(ids2.includes("ag"), false);
  assert.ok(ids2.includes("spaces-b"));
  assert.equal(ids2.filter((i) => i === "spaces-picker").length, 1);
});

test("running it again on its own output changes nothing", () => {
  const once = jq(main);
  assert.deepEqual(jq(once), once);
});

// install.sh against a stub herdr-app: layout.clone copies Herdr's main from a fixture.
const install = fileURLToPath(new URL("../../herdr-app/install.sh", import.meta.url));
const herdrMain = { id: "root", type: "row", children: [{ id: "sidebar", type: "column", children: [
  block("brand", "workspace-chrome"), block("spaces", "spaces"), block("agents", "agents")] }] };

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "install-test-"));
  const home = join(dir, "home"), bin = join(dir, "bin");
  mkdirSync(join(home, "layouts"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(dir, "herdr-main.json"), JSON.stringify(herdrMain));
  writeFileSync(join(bin, "herdr-app"), `#!/usr/bin/env bash
case "$1" in
  do) [ "$2" = layout.clone ] && cp "${dir}/herdr-main.json" "$HERDR_APP_HOME/layouts/harbormaster-main.json" ;;
esac
exit 0
`);
  chmodSync(join(bin, "herdr-app"), 0o755);
  const run = () => execFileSync("bash", [install], { env: { ...process.env, HERDR_APP_HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });
  const file = (n) => join(home, "layouts", n);
  const read = (n) => JSON.parse(readFileSync(file(n), "utf8"));
  return { home, run, file, read };
}
const ids = (doc) => all(doc).map((n) => n.id);

test("install: a fresh main is Herdr's main made calm, and a second install changes nothing", () => {
  const s = sandbox();
  s.run();
  const main = s.read("harbormaster-main.json");
  assert.equal(main.id, "root");
  assert.deepEqual(ids(main).filter((i) => ["crew", "spaces-picker", "agents", "spaces"].includes(i)), ["crew", "spaces-picker"]);
  assert.equal(all(main).find((n) => n.id === "crew").content.props.needs, "box");
  const bytes = readFileSync(s.file("harbormaster-main.json"), "utf8");
  s.run();
  assert.equal(readFileSync(s.file("harbormaster-main.json"), "utf8"), bytes);
  assert.equal(existsSync(s.file("harbormaster-needs.json")), false);
});

test("install: an older main (Crew above Agents) is upgraded in place, keeping the user's other blocks", () => {
  const s = sandbox();
  const old = { id: "root", type: "row", children: [{ id: "sidebar", type: "column", children: [
    block("brand", "workspace-chrome"), block("mine", "my-own-mod"), block("spaces", "spaces"),
    block("crew", "harbormaster", { role: "crew" }), block("agents", "agents")] }] };
  writeFileSync(s.file("harbormaster-main.json"), JSON.stringify(old));
  s.run();
  const main = s.read("harbormaster-main.json");
  assert.deepEqual(main.children[0].children.map((c) => c.id), ["brand", "mine", "crew", "spaces-picker"]);
  assert.equal(main.children[0].children[2].content.props.needs, "box");
  const bytes = readFileSync(s.file("harbormaster-main.json"), "utf8");
  s.run();
  assert.equal(readFileSync(s.file("harbormaster-main.json"), "utf8"), bytes);
});

test("install: removes harbormaster-needs only when it is ours (hn-root)", () => {
  const s = sandbox();
  writeFileSync(s.file("harbormaster-needs.json"), JSON.stringify({ id: "hn-root", type: "row", children: [] }));
  writeFileSync(s.file("harbormaster-needs.svg"), "<svg/>");
  s.run();
  assert.equal(existsSync(s.file("harbormaster-needs.json")), false);
  assert.equal(existsSync(s.file("harbormaster-needs.svg")), false);
  writeFileSync(s.file("harbormaster-needs.json"), JSON.stringify({ id: "mine", type: "row", children: [] }));
  s.run();
  assert.equal(s.read("harbormaster-needs.json").id, "mine");
});

test("install: a calm main the user has edited is left byte for byte alone", () => {
  const s = sandbox();
  s.run();
  const main = s.read("harbormaster-main.json");
  const col = main.children[0].children;
  col.find((c) => c.id === "crew").size = { weight: 3 };
  col.unshift(col.pop());                       // picker moved first
  col.push(block("agents", "agents"));          // Agents added back on purpose
  writeFileSync(s.file("harbormaster-main.json"), JSON.stringify(main, null, 2) + "\n");
  const bytes = readFileSync(s.file("harbormaster-main.json"), "utf8");
  s.run();
  assert.equal(readFileSync(s.file("harbormaster-main.json"), "utf8"), bytes);
});
