// The path to merge (mergepath.js): the stage model behind the run pane's strip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePath } from "../../herdr-app/mods/harbormaster/mergepath.js";

const base = (o = {}) => ({
  phase: "running", away: null, counts: { done: 0, planned: 0 }, blockedTasks: 0, claims: null, checks: null,
  reviewed: { kind: "none", behind: null, sha: null }, flow: "peer", prs: 0, allMerged: false, next: null, held: false, ready: false, ci: null, ...o,
});
const line = (s) => s.map((x) => `${x.label}${x.value ? ` ${x.value}` : ""}:${x.state}`).join(" | ");
const by = (stages, key) => stages.find((s) => s.key === key);
const finished = (o = {}) => base({ phase: "finished", counts: { done: 3, planned: 3 }, claims: { total: 6, proven: 6, accepted: 0, failed: 0, look: 0 },
  reviewed: { kind: "current", behind: null, sha: "abc" }, prs: 1, ...o });

test("a planning run starts at Spec", () => {
  const s = mergePath(base());
  assert.equal(s[0].key, "spec");
  assert.equal(s[0].state, "current");
  assert.equal(by(s, "build").state, "todo");
  assert.equal(by(s, "build").value, null);
  assert.equal(by(s, "proven"), undefined);
});

test("running 2 of 5 with a task blocked: Build fails, no Spec", () => {
  const s = mergePath(base({ counts: { done: 2, planned: 5 }, blockedTasks: 1 }));
  assert.equal(s[0].key, "build");
  assert.equal(s[0].state, "fail");
  assert.equal(s[0].value, "2/5");
  assert.equal(s[0].label, "Build");
});

test("running 2 of 5 is current", () => {
  assert.equal(by(mergePath(base({ counts: { done: 2, planned: 5 } })), "build").state, "current");
});

test("finished, 6/6 proven, AI review 2 behind, peer, request review", () => {
  const s = mergePath(finished({ reviewed: { kind: "behind", behind: 2, sha: "abc" }, next: { label: "request review", who: [] } }));
  assert.equal(line(s), "Built 3/3:done | Proven 6/6:done | AI review 2 behind:look | Peer review ask:you | Merge:todo");
  assert.match(by(s, "review").tip, /2 commits behind/);
  assert.equal(by(s, "human").tip, "No reviewer has been asked yet");
  assert.equal(by(s, "proven").fold, "claims");
  assert.equal(by(s, "review").fold, "claims");
  assert.equal(by(s, "build").fold, "tasks");
});

test("peer review from anna", () => {
  const h = by(mergePath(finished({ next: { label: "review from", who: ["anna", "bo"] } })), "human");
  assert.equal(h.state, "current");
  assert.equal(h.value, "anna, bo");
  assert.match(h.tip, /anna, bo/);
});

test("self flow: review proof → merge, not ready then ready", () => {
  const next = { label: "review proof → merge", who: [] };
  const a = mergePath(finished({ flow: "self", next }));
  assert.equal(by(a, "human").label, "Your review");
  assert.equal(by(a, "human").state, "you");
  assert.equal(by(a, "human").value, "read the proof");
  assert.equal(by(a, "merge").state, "todo");
  const b = mergePath(finished({ flow: "self", next, ready: true }));
  assert.equal(by(b, "human").state, "done");
  assert.equal(by(b, "merge").state, "you");
});

test("approved: review done, merge waits on you", () => {
  const s = mergePath(finished({ next: { label: "approved — merge", who: ["anna"] } }));
  assert.equal(by(s, "human").state, "done");
  assert.equal(by(s, "merge").state, "you");
});

test("changes requested waits on you", () => {
  const h = by(mergePath(finished({ next: { label: "changes requested", who: ["anna"] } })), "human");
  assert.equal(h.state, "you");
  assert.equal(h.value, "changes requested");
});

test("CI red fails Merge", () => {
  const m = by(mergePath(finished({ ci: "red", next: { label: "review from", who: ["anna"] } })), "merge");
  assert.equal(m.state, "fail");
  assert.equal(m.value, "CI red");
});

test("all merged", () => {
  const s = mergePath(finished({ allMerged: true, next: { label: "merged — close run", who: [] } }));
  assert.equal(by(s, "human").state, "done");
  assert.equal(by(s, "merge").state, "done");
  assert.equal(by(s, "merge").label, "Merged");
  assert.equal(by(s, "merge").tip, "Every pull request is merged");
});

test("an old run without claims shows green checks", () => {
  const s = mergePath(finished({ claims: null, checks: "green", reviewed: { kind: "none", behind: null } }));
  const p = by(s, "proven");
  assert.equal(p.label, "Checks");
  assert.equal(p.value, null);
  assert.equal(p.state, "done");
  assert.equal(mergePath(finished({ claims: null, checks: "red" })).find((x) => x.key === "proven").state, "fail");
  assert.equal(mergePath(finished({ claims: null, checks: "pending" })).find((x) => x.key === "proven").state, "current");
  assert.equal(by(mergePath(finished({ claims: null })), "proven"), undefined);
  assert.equal(by(s, "review").value, "not run");
  assert.equal(by(s, "review").state, "look");
});

test("a parked run turns you into look", () => {
  const s = mergePath(finished({ away: { how: "parked" }, next: { label: "approved — merge", who: [] } }));
  assert.ok(s.every((x) => x.state !== "you"));
  assert.equal(by(s, "merge").state, "look");
  const t = mergePath(finished({ away: { how: "closed" }, next: { label: "request review", who: [] } }));
  assert.equal(by(t, "human").state, "look");
});

test("a held step is todo", () => {
  const s = mergePath(base({ counts: { done: 1, planned: 3 }, prs: 1, held: true, next: { label: "request review", who: [] } }));
  assert.equal(by(s, "human").state, "todo");
  assert.equal(by(s, "merge").state, "todo");
  const h = by(mergePath(finished({ held: true, next: { label: "approved — merge", who: [] } })), "merge");
  assert.equal(h.state, "todo");
});

test("no PR: human review is todo", () => {
  assert.equal(by(mergePath(base({ counts: { done: 1, planned: 3 } })), "human").state, "todo");
});

test("proven: failed claim, look when built, current while building", () => {
  const claims = (o) => ({ total: 6, proven: 3, accepted: 1, failed: 0, look: 0, ...o });
  assert.equal(by(mergePath(finished({ claims: claims({ failed: 1 }) })), "proven").state, "fail");
  assert.equal(by(mergePath(finished({ claims: claims() })), "proven").state, "look");
  assert.equal(by(mergePath(base({ counts: { done: 1, planned: 3 }, claims: claims() })), "proven").state, "current");
  assert.equal(by(mergePath(base({ counts: { done: 1, planned: 3 }, claims: claims({ proven: 0, accepted: 0 }) })), "proven").state, "todo");
  assert.equal(by(mergePath(finished({ checks: "red" })), "proven").state, "fail");
});

test("AI review: unknown behind count, task-only on a finished run", () => {
  assert.equal(by(mergePath(finished({ reviewed: { kind: "behind", behind: null } })), "review").value, "behind");
  const t = by(mergePath(finished({ reviewed: { kind: "task-only", behind: null } })), "review");
  assert.equal(t.value, "not run");
  assert.equal(by(mergePath(base({ counts: { done: 1, planned: 3 }, reviewed: { kind: "task-only" } })), "review").state, "todo");
});

test("AI review not compared with the branch yet is current, without a tick", () => {
  const r = by(mergePath(finished({ reviewed: { kind: "current", behind: null, sha: "abcdef123456", compared: false } })), "review");
  assert.equal(r.state, "current");
  assert.equal(r.value, null);
  assert.equal(r.tip, "Reviewed at abcdef1, not compared with the branch yet");
  assert.equal(by(mergePath(finished({ reviewed: { kind: "current", behind: null, sha: "abc", compared: true } })), "review").state, "done");
});

test("a run the user marked as waiting on someone shows the review stage as a wait, not as theirs", () => {
  const stages = mergePath({ phase: "finished", counts: { done: 2, planned: 2 }, flow: "peer", prs: 1, next: { label: "request review", who: [] }, waitingOn: "Kari — preview check" });
  const human = stages.find((s) => s.key === "human");
  assert.equal(human.state, "current");
  assert.equal(human.value, "waiting on Kari — preview check");
  assert.ok(!stages.some((s) => s.state === "you"));
});
