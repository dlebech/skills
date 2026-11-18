// The run pane's section order and compact flags (paneorder.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { paneSections, agentsSummary, auditDecisions } from "../../herdr-app/mods/harbormaster/paneorder.js";

const keys = (o) => paneSections(o).map((s) => s.key + (s.compact ? "*" : "")).join(" ");

test("a finished run: decisions first, tasks and agents compact", () => {
  assert.equal(keys({ finished: true }), "decisions claims prs issues tasks* agents* tokens");
});

test("a running run: agents and tasks first, none compact", () => {
  assert.equal(keys({ finished: false }), "agents tasks claims decisions prs issues tokens");
});

test("agents summary: 0, 1, 3 and 5 agents", () => {
  assert.deepEqual(agentsSummary([]), { head: "Agents · 0", names: "" });
  assert.deepEqual(agentsSummary(["a"]), { head: "Agents · 1", names: "a" });
  assert.deepEqual(agentsSummary(["a", "b", "c"]), { head: "Agents · 3", names: "a, b, c" });
  assert.deepEqual(agentsSummary(["a", "b", "c", "d", "e"]), { head: "Agents · 5", names: "a, b, c, +2" });
});

test("audit decisions: the newest three the orchestrator made, never the user's", () => {
  const d = (n, by = "decided") => ({ by, decision: String(n) });
  const list = [d(6), d(5, "user"), d(4), d(3), d(2, "user"), d(1)];
  assert.deepEqual(auditDecisions(list).map((x) => x.decision), ["6", "4", "3"]);
  assert.deepEqual(auditDecisions([d(1, "user")]), []);
  assert.deepEqual(auditDecisions([d(2), d(1)]).map((x) => x.decision), ["2", "1"]);
});
