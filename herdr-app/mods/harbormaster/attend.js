// One run's attention (attention.js assess) from what Harbormaster knows now: its files
// (data.js), its PR read, its live agents, and the times and settings tracking.js keeps.

import { prEntryOf, relatedOf, taskAgents, shownStage, isClosed, isParked, filesFresh } from "./data.js";
import { orchestratorState, orchestratorsOf, agentStatus, workersOf, needReason } from "./live.js";
import { assess, prRead, reviewFlow, stalled, ciState } from "./attention.js";
import { gatheringStage, proofRead } from "./proof.js";
import { proofState } from "./claims.js";
import { proofSeenSig } from "./proofseen.js";
import { stepSince, stepAges, lastActivity, ciUsualOf, reviewFlows } from "./tracking.js";
import { needLine, needsRun } from "./crewrows.js";
import { askedPrsOf } from "./asked.js";

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
    related: run.type === "rev" ? relatedOf(run) : null,
    orch, working, pr, stall, now, closed,
    flow: reviewFlow(run, reviewFlows()),
    stages,
    proofFailed: proofFailed(run, stages),
    changesAsked: Boolean(run.changesAsked),
    // Read and clean: the ready-to-merge state (attention.js assess) needs both.
    ...proofReadState(run, stages),
    since: stepSince(run),
    ages: stepAges(run),
    filesOk: filesFresh(run, now),
    askedPrs: askedPrsOf(run, prs, now, working),
  });
}

// A run's proof as the box counts it (claims.js proofState: by its claims, or an old run by its
// checks line): whether a claim failed, whether it is clean, and the signature the user's reading
// is kept against. Kept per run read (a new read is a new object) and which tasks are still under
// way, since every poll and the harbor's animation ask again and proof.md can be long.
const proofSeenOf = new WeakMap();
export function proofStateOf(run, stages = []) {
  const under = run.tasks.map((_, i) => (gatheringStage(stages[i]) ? 1 : 0)).join("");
  const seen = proofSeenOf.get(run);
  if (seen?.under === under) return seen.state;
  const state = proofState(run, stages.length ? stages : null);
  proofSeenOf.set(run, { under, state });
  return state;
}

// Whether a claim (or an old run's checks) failed, so the pill and the Crew never say merge over it.
export const proofFailed = (run, stages = []) => proofStateOf(run, stages).failed;

// assess()'s proofRead (the user opened this proof as it is now) and proofClean (every claim proven or accepted).
function proofReadState(run, stages) {
  const { clean, sig } = proofStateOf(run, stages);
  return { proofClean: clean, proofRead: proofRead(proofSeenSig(run), sig) };
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
