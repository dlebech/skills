// One run's attention (attention.js assess) from what Harbormaster knows now: its files
// (data.js), its PR read, its live agents, and the times and settings tracking.js keeps.

import { prEntryOf, taskAgents, shownStage, isClosed, isParked, filesFresh } from "./data.js";
import { orchestratorState, orchestratorsOf, agentStatus, workersOf, needReason } from "./live.js";
import { assess, prRead, reviewFlow, stalled, ciState } from "./attention.js";
import { proofTasks, proofCounts, gatheringStage } from "./proof.js";
import { stepSince, stepAges, lastActivity, ciUsualOf, reviewFlows } from "./tracking.js";
import { needLine, needsRun } from "./crewrows.js";

// Whether a run's files are a fresh read: data.js filesFresh, here where it has always been.
export { filesFresh };

// attention.js assess() for a run, with every input gathered. `run` may be null for an
// orchestrator without a readable run directory; `term` is then its terminal, for its status.
export function attentionOf(run, ctx, now = Date.now(), term = null) {
  if (!run) return assess(null, { orch: term ? agentStatus(term, ctx) : null, now });
  const orch = orchestratorState(run, ctx);
  const working = orch === "working" || workersOf(run.terminal, ctx).some((w) => agentStatus(w, ctx) === "working");
  const closed = isClosed(run, ctx);
  // A parked run's PRs are read on the closed runs' slower schedule (main.js refresh).
  const pr = prRead(run, prEntryOf(run), now, closed || isParked(run));
  const prs = pr.readable ? pr.list : [];
  const ci = ciState(prs);
  const stall = stalled(run, { now, lastActivity: lastActivity(run), prs, ciUsual: ci.pr?.repo ? ciUsualOf(ci.pr.repo) : null, orch });
  const stages = run.tasks.map((k) => shownStage(k, taskAgents(k, run, ctx)));
  return assess(run, {
    orch, working, pr, stall, now, closed,
    flow: reviewFlow(run, reviewFlows()),
    stages,
    proofFailed: proofFailed(run, stages),
    since: stepSince(run),
    ages: stepAges(run),
    filesOk: filesFresh(run, now),
  });
}

// Whether a proof task failed, counted as the box counts it (overview.js needItemsOf: proof.js's
// rows, a task still under way pending), so the pill and the Crew never say merge over it.
// Kept per run read (a new read is a new object) and which tasks are still under way, since
// every poll and the harbor's animation ask again and proof.md can be long.
const proofFailedSeen = new WeakMap();
export function proofFailed(run, stages = []) {
  if (!run.proof?.md) return false;
  const under = run.tasks.map((_, i) => (gatheringStage(stages[i]) ? 1 : 0)).join("");
  const seen = proofFailedSeen.get(run);
  if (seen?.under === under) return seen.failed;
  const gathering = (id) => {
    const i = run.tasks.findIndex((x) => x.id === id);
    return i >= 0 && under[i] === "1";
  };
  const finished = run.phase === "finished" || Boolean(run.away);
  const failed = proofCounts(proofTasks(run.tasks, run.proof.md, run.proof.files, { accepted: run.proof.accepted, gathering, finished })).fail > 0;
  proofFailedSeen.set(run, { under, failed });
  return failed;
}

// The orchestrators without a run directory among `runs`, as the Crew judges them ({term, r:
// null, a}): one blocked on a dialog needs you, though no view has a run for it
// (crewrows.js needCount counts it).
export const runlessOrchs = (runs, ctx) => orchestratorsOf(ctx).filter((term) => !runs.some((r) => r.terminal === term.address))
  .map((term) => ({ term, r: null, a: attentionOf(null, ctx, Date.now(), term) }));

// Whether a run needs you now, one rule for every view that counts it (the overview's header
// and order, its cards and panes, the harbor, the Crew): exactly the Crew's Needs you group (a
// question, a blocker or dialog, or what its PRs, a stall or a gone orchestrator wait on you
// for); never a parked or closed run (crewrows.js needsRun). A question read from a stale run
// read is under Can't tell there, and so not counted here, nor queued (data.js decisionQueue). `att`: the run's attentionOf, when the caller has it.
export function needsYouNow(run, ctx, att = null) {
  return needsRun(run, att ?? attentionOf(run, ctx));
}

// What a run needs you for, in a few words, or null: its question, dialog or plan's reason
// first, else why it is in Needs you ("review proof → merge", "orchestrator gone").
export const needWhy = (run, ctx, att = null) => needReason(run, orchestratorState(run, ctx)) ?? needLine(att ?? attentionOf(run, ctx));
