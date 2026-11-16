// One run's attention (attention.js assess) from what Harbormaster knows now: its files
// (data.js), its PR read, its live agents, and the times and settings tracking.js keeps.

import { cachedRuns, prEntryOf, taskAgents, shownStage, isClosed, isParked } from "./data.js";
import { orchestratorState, agentStatus, workersOf, needReason } from "./live.js";
import { assess, prRead, reviewFlow, stalled, ciState } from "./attention.js";
import { stepSince, stepAges, lastActivity, ciUsualOf, reviewFlows } from "./tracking.js";
import { needLine } from "./crewrows.js";

// A run read older than this no longer counts as read: the polls have stopped answering.
const FILES_MAX_AGE = 2 * 60000;

// Whether the run's files are a fresh read in `cache` (data.js cachedRuns): not carried from
// an earlier read of a machine that failed (data.js carryRuns), its machine answered the
// last poll, and that poll is recent.
export function filesFresh(run, now = Date.now(), cache = cachedRuns()) {
  return !run.stale && now - cache.at < FILES_MAX_AGE && !(cache.failed ?? []).includes(run.machine ?? null);
}

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
  return assess(run, {
    orch, working, pr, stall, now, closed,
    flow: reviewFlow(run, reviewFlows()),
    stages: run.tasks.map((k) => shownStage(k, taskAgents(k, run, ctx))),
    since: stepSince(run),
    ages: stepAges(run),
    filesOk: filesFresh(run, now),
  });
}

// Whether a run needs you now, one rule for every view that counts it (the overview's header
// and order, its cards and panes, the harbor, the Crew): exactly the Crew's Needs you group (a
// question, a blocker or dialog, or what its PRs, a stall or a gone orchestrator wait on you
// for); never a parked or closed run. A question read from a stale run read is under Can't tell
// there, and so not counted here either. `att`: the run's attentionOf, when the caller has it.
export function needsYouNow(run, ctx, att = null) {
  if (run.away) return false;
  return (att ?? attentionOf(run, ctx)).group === "needs";
}

// What a run needs you for, in a few words, or null: its question, dialog or plan's reason
// first, else why it is in Needs you ("review proof → merge", "orchestrator gone").
export const needWhy = (run, ctx, att = null) => needReason(run, orchestratorState(run, ctx)) ?? needLine(att ?? attentionOf(run, ctx));
