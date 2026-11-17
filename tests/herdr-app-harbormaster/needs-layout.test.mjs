import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

test("the needs layout drops agents and what they leave empty, keeps one picker last, gives Crew the rest", () => {
  const out = jq(main), nodes = all(out);
  assert.equal(out.id, "hn-root");
  assert.equal(nodes.filter((n) => n.content?.mod === "agents").length, 0);
  assert.equal(nodes.some((n) => n.id === "only-agents"), false);
  const pickers = nodes.filter((n) => n.content?.props?.role === "spaces");
  assert.equal(pickers.length, 1);
  assert.deepEqual(pickers[0].size, { px: 34 });
  assert.equal(nodes.filter((n) => n.content?.mod === "spaces").length, 0);
  const lists = nodes.find((n) => n.id === "lists");
  assert.deepEqual(lists.children.map((c) => c.id), ["crew", "spaces-picker"]);
  assert.deepEqual(lists.children[0].size, { weight: 1 });
  assert.equal(lists.children[0].content.props.needs, "box");
});

test("running it again on its own output changes nothing", () => {
  const once = jq(main);
  assert.deepEqual(jq(once), once);
});
