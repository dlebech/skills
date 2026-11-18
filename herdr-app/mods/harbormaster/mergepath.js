// The path to merge: a run's stages (Build, Proven, AI review, Peer review, Merge; Spec while
// planning), each done, current, waiting on you, wanting a look, failed or not reached. Pure
// (no herdr or gpui), so the pane's strip (overview.js pathStrip) and its tests share one model.
//
// mergePath(input) → [{ key, label, value, state, tip, fold }]. `input` is plain data:
//   { phase, away, counts: {done, planned}, blockedTasks, claims: null | {total, proven, accepted, failed, look},
//     checks: null | "green" | "red" | "pending", reviewed: {kind: "none" | "current" | "behind" | "task-only", behind, sha},
//     flow: "self" | "peer", prs, allMerged, next: null | {label, who}, held, ready, ci: null | "green" | "red" | "running" }
// `fold` is the pane fold the stage opens ("claims"), or null.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The Build stage: tasks merged into the run's branch.
function buildStage({ phase, counts, blockedTasks }) {
  const { done, planned } = counts;
  const finished = phase === "finished";
  const state = blockedTasks > 0 ? "fail" : (planned > 0 && done >= planned) || finished ? "done" : planned === 0 ? "todo" : "current";
  const tip = state === "fail" ? `${plural(blockedTasks, "task")} blocked, ${done} of ${planned} merged into the run's branch`
    : state === "done" ? (planned > 0 ? `All ${plural(planned, "task")} ${planned === 1 ? "is" : "are"} merged into the run's branch` : "The run is finished")
    : state === "todo" ? "No tasks are planned yet"
    : `${done} of ${plural(planned, "task")} merged into the run's branch`;
  return { key: "build", label: state === "done" ? "Built" : "Build", value: planned > 0 ? `${done}/${planned}` : null, state, tip, fold: null };
}

// The Proven stage: claims proven or accepted, else the checks line of an old run; null with neither.
function provenStage({ claims, checks }, buildDone) {
  if (claims && claims.total > 0) {
    const ok = claims.proven + claims.accepted;
    const state = claims.failed > 0 || checks === "red" ? "fail" : ok >= claims.total ? "done" : buildDone ? "look" : ok > 0 ? "current" : "todo";
    const tip = state === "fail" ? (claims.failed > 0 ? `${plural(claims.failed, "claim")} failed, ${ok} of ${claims.total} proven` : "The whole-branch checks are red")
      : state === "done" ? `${ok} of ${claims.total} claims proven`
      : state === "look" ? `${ok} of ${claims.total} claims proven, ${claims.total - ok} still want a look`
      : state === "current" ? `${ok} of ${claims.total} claims proven so far` : "No claim is proven yet";
    return { key: "proven", label: "Proven", value: `${ok}/${claims.total}`, state, tip, fold: "claims" };
  }
  if (!checks) return null;
  const state = checks === "green" ? "done" : checks === "red" ? "fail" : "current";
  const tip = state === "done" ? "The whole-branch checks are green" : state === "fail" ? "The whole-branch checks are red" : "The whole-branch checks are still running";
  return { key: "proven", label: "Checks", value: null, state, tip, fold: "claims" };
}

// The AI review stage: the final review against the branch's head.
function reviewStage({ phase, reviewed }) {
  const k = reviewed?.kind ?? "none", n = reviewed?.behind ?? null;
  if (k === "current" && reviewed.compared === false) return { key: "review", label: "AI review", value: null, state: "current",
    tip: `Reviewed at ${(reviewed.sha ?? "").slice(0, 7)}, not compared with the branch yet`, fold: "claims" };
  if (k === "current") return { key: "review", label: "AI review", value: null, state: "done", tip: "The final AI review covers the branch as it is now", fold: "claims" };
  if (k === "behind") return { key: "review", label: "AI review", value: n > 0 ? `${n} behind` : "behind", state: "look",
    tip: n > 0 ? `The final AI review is ${plural(n, "commit")} behind the branch` : "The final AI review is behind the branch", fold: "claims" };
  if (phase === "finished") return { key: "review", label: "AI review", value: "not run", state: "look",
    tip: k === "task-only" ? "Only single tasks were reviewed, not the whole branch" : "No AI review was recorded for the branch", fold: "claims" };
  return { key: "review", label: "AI review", value: null, state: "todo", tip: "The final AI review has not run yet", fold: "claims" };
}

// The human review stage, from the run's next step (attention.js LABELS).
function humanStage({ flow, prs, next, held, ready }) {
  const label = flow === "self" ? "Your review" : "Peer review";
  const st = (state, value, tip) => ({ key: "human", label, value, state, tip, fold: null });
  if (held || !prs || !next) return st("todo", null, !prs ? "There is no pull request to review yet" : held ? "The run's plan still holds the review back" : "Nothing waits on a review yet");
  const who = (next.who ?? []).join(", ");
  switch (next.label) {
    case "request review": return st("you", "ask", "No reviewer has been asked yet");
    case "review from": return st("current", who, who ? `Waiting for a review from ${who}` : "Waiting for a review");
    case "changes requested": return st("you", "changes requested", who ? `${who} asked for changes` : "A reviewer asked for changes");
    case "review proof → merge": return ready ? st("done", "read the proof", "You read the proof and it is clean") : st("you", "read the proof", "Read the proof, then merge");
    case "approved — merge": return st("done", null, "The pull request is approved");
    case "merged — close run": return st("done", null, "The pull request is merged");
    default: return st("todo", null, "Nothing waits on a review yet");
  }
}

// The Merge stage.
function mergeStage({ allMerged, ci, next, held, ready }) {
  const st = (state, value, tip, label = "Merge") => ({ key: "merge", label, value, state, tip, fold: null });
  if (allMerged) return st("done", null, "Every pull request is merged", "Merged");
  if (ci === "red") return st("fail", "CI red", "CI is failing on a pull request");
  if ((next?.label === "approved — merge" && !held) || ready) return st("you", null, "Ready for you to merge");
  return st("todo", null, "Not ready to merge yet");
}

// The stages of the run's way to merge, in order. A parked or closed run gets the same stages, with
// every "you" a "look": parked runs stay out of Needs you.
export function mergePath(input) {
  const i = { counts: { done: 0, planned: 0 }, blockedTasks: 0, claims: null, checks: null, reviewed: { kind: "none", behind: null }, flow: "self", prs: 0, ...input };
  const out = [];
  if (i.counts.planned === 0 && i.phase !== "finished") out.push({ key: "spec", label: "Spec", value: null, state: "current", tip: "The plan is still being written", fold: null });
  const build = buildStage(i);
  out.push(build);
  const proven = provenStage(i, build.state === "done");
  if (proven) out.push(proven);
  out.push(reviewStage(i), humanStage(i), mergeStage(i));
  return i.away ? out.map((s) => (s.state === "you" ? { ...s, state: "look" } : s)) : out;
}
