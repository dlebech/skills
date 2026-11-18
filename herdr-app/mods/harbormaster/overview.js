// The serious views: the runs overview (totals, what's waiting on you, captain, run cards) and the Crew block.

import { div, svg } from "gpui-kit";
import { openStartCaptain } from "./newrun.js";
import { openOverlay, props } from "herdr";
import { v_flex, h_flex, Input, HoverCard } from "gpui-base";
import { stats, decisionQueue, acceptProof, unacceptProof, compactRun, isCompact, isBudgetQuestion, overBudget, dropDecision, runPhase, taskTone, taskCounts, taskAgents, shownStage, taskStage, prsOf, relatedOf, unknownPr, oneWay, PR_TONE, isClosed, isParked, putAway, resumeRun, deleteRun, deleteRuns, newestFirst, runTime } from "./data.js";
import { facts, exactStatus, orchestratorState, agentStatus, workersOf, captainOf, programOf, captainPane, paneBeside, togglePin, needReason, focusAgent, openUrl, replyToCaptain, closeOwnPane, openStats } from "./live.js";
import { CAPTAIN, OCTOPUS, programIcon, zoom, plural, ago, shortRef, stateText, runName, withTip, typeTag } from "./ui.js";
import { tokenText, tokenHeadline, tokenDetail, startedTip, runAgeText } from "./context.js";
import { liveUsage, hotText, memText } from "./resources.js";
import { claimRows, claimCounts, claimsVerdict, claimsGaps, claimResultLine, claimPill, claimActions, checksLine, reviewedLine, reviewedState, worthALook, hasClaims, proofState, withSaid, withAsked } from "./claims.js";
import { oneLine, needHead, questionSections, queueLines, paragraphs, plain, replyId, replyItem } from "./question.js";
import { thumbs } from "./viewer.js";
import { setNote, noteText } from "./note.js";
import { levelChoices } from "./levels.js";
import { attentionOf, needsYouNow as needsYouOf, runlessOrchs } from "./attend.js";
import { stepText, quietText, flowState, flowSetting, runDot, ciState } from "./attention.js";
import { mergePath } from "./mergepath.js";
import { parkedLabel, parkedHeading, openPrsLabel, newDecisions, newSinceText } from "./tell.js";
import { reviewText, prStateText, prFacts } from "./prfacts.js";
import { toastsOn, setToastsOn, decisionsSeen, markDecisionsSeen } from "./telling.js";
import { markProofSeen } from "./proofseen.js";
import { rowEdge, badgeOf, needLine, closableDone, needCount, needRunsOf, runlessNeeds, watchingText, workerTree } from "./crewrows.js";
import { asked as inboxAsked, unmarkAsked, askedLevel } from "./inbox.js";
import { askClick } from "./askclick.js";
import { defaultMode, commentLines, commentsText, hasComments, botCount } from "./comments.js";
import { reviewFlows, setReviewFlow } from "./tracking.js";
import { needActions, ownAddressRows, isPrimary, detailsLabel } from "./needaction.js";

// How each runPhase() reads on a card. Running is muted, not the working colour: colour means
// something to look at (see AMBER), and the run's spinning dot already says it works.
const PHASE = {
  running: { label: "Running", tone: "muted" },
  waiting: { label: "Needs you", tone: "blocked" },
  blocked: { label: "Blocked", tone: "blocked" },
  finished: { label: "Finished", tone: "done" },
  unknown: { label: "Starting", tone: "dim" },
  parked: { label: "Parked", tone: "dim" },
  closed: { label: "Closed", tone: "dim" },
  cant: { label: "Can't tell", tone: "dim" },
};

function pill(t, text, tone, solid = false) {
  const c = String(tone ?? "").startsWith("#") ? tone : t[tone] ?? t.dim;
  return div().flex_none().px(7).h(18).rounded(9).flex().items_center()
    .bg(solid ? c : c + "22").text_size(10.5).font_semibold().text_color(solid ? t.background : c).child(text);
}

// Adds how full an agent's context is, "144k", with the exact count on hover; nothing
// when unknown. For an orchestrator, `run` adds the run's token total to the tooltip,
// where a narrow row has room for it. For .map() on the row it goes in.
const withContext = (view, t, id, address, run = null) => (el) => {
  const c = view.contexts?.[address];
  if (!c) return el;
  return el.child(div().id(`${id}-ctx`).flex_none().text_size(10.5).text_color(t.dim).child(tokenText(c.tokens))
    .tooltip(contextTip(view, address, run)));
};
// What withContext's hover says: the context size, and for an orchestrator the run's total; null without either.
export const contextTip = (view, address, run = null) => {
  const c = view.contexts?.[address];
  return [c && `Context: ${c.tokens.toLocaleString("en")} tokens${c.model ? ` (${c.model})` : ""}, as of its last turn`,
    run?.tokens && `Run total: ${tokenHeadline(run.tokens)} (${run.tokens.total.toLocaleString("en")} in all), all its agents`].filter(Boolean).join("\n") || null;
};

// A small "85% · 2.1G" badge for an agent and the commands it runs, above resources.js's HOT
// limits, so a busy machine can be explained at a glance; nothing otherwise. The tooltip names
// what uses it: the agent itself and its busiest programs, and `more` (a run's total) after them.
export const withUsage = (t, id, u, whose, more = null) => (el) => {
  const text = hotText(u);
  if (!text) return el;
  const progs = (u.programs ?? []).slice(0, 4).map((g) => `${g.name}: ${Math.round(g.cpu)}% · ${memText(g.rssKb)}`);
  const tip = [`${whose}: ${Math.round(u.cpu)}% CPU (100% is one core), ${memText(u.rssKb)} memory`,
    u.own ? `the agent itself: ${Math.round(u.own.cpu)}% · ${memText(u.own.rssKb)}` : null, ...progs, more].filter(Boolean).join("\n");
  return el.child(div().id(`${id}-use`).flex_none().px(5).rounded(4).text_size(10).font_semibold()
    .bg(t.working + "22").text_color(t.working).tooltip(tip).child(text));
};


// A working agent's status is a ring spun natively, like Herdr's own Agents list (spin(900)). The Agents
// list already redraws the window while any agent works, so the ring rides on those frames: measured in a
// software-rendered window it cost about 1.2 CPU s/min less than stepped text frames (proof t19-spinner).
// Other motion holds still: loop() pulses redraw the whole window about 30 times a second.
export function statusDot(t, status) {
  if (status === "working") return svg("mods/harbormaster/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().size(8).flex_none().rounded(4).bg(t.blocked).border(1.5).border_color(t.blocked + "66");
  if (status === "gone") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.dim);
  if (status === "idle") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(8).flex_none().rounded(4).bg(t[status] ?? t.dim);
}


// A link chip: the run's issues, and PRs it is about but did not open, side by side.
// A PR chip's icon takes its state's color; its title and state are in the tooltip.
function linkChip(t, id, url, icon, tip) {
  return h_flex().id(id).gap(4).px(6).h(20).items_center().rounded(5).bg(t.raised).text_size(11).text_color(t.muted).cursor_pointer()
    .hover((s) => s.text_color(t.foreground)).tooltip(tip ?? url)
    .on_click((_e, cx) => { cx.stop_propagation(); openUrl(url); })
    .child(icon).child(shortRef(url));
}

// A task's life-cycle stages (data.js taskStage) as they read and color, and which
// are marked because an agent is at it. Implementing is a neutral bright tone, not amber: amber
// means look soon (see AMBER), and the light edge on an active segment (and the spinner on rows)
// says it is at work. Review takes the accent, fixing the implementer's second pass a colour of
// its own, so implementing and reviewing tasks tell apart. The agent rows' stage text uses the same.
const STAGE = {
  planned: { label: "Planned", color: (t) => t.border },
  implement: { label: "Implementing", color: (t) => t.muted, active: true },
  review: { label: "In review", color: (t) => t.accent, active: true },
  fix: { label: "Fixing", color: (t) => t.ansi5 ?? t.muted, active: true },
  done: { label: "Done", color: (t) => t.done },
  blocked: { label: "Blocked", color: (t) => t.blocked },
};
// A task's color: its stage's, else its tone's (a state that names no stage); a task at work
// that names no stage ("validating") is neutral, as Implementing is, never amber.
const taskColor = (t, task, stage) => {
  if (stage) return STAGE[stage].color(t);
  const tone = taskTone(task.state);
  return tone === "working" ? t.muted : t[tone] ?? t.border;
};
const pulse = (stage, task) => (stage ? STAGE[stage].active : taskTone(task.state) === "working");
const stageText = (task, stage) => (stage ? STAGE[stage].label : stateText(task.state));

// Each task's stage and live agents, in plan.md's order. A done task shows none: they
// are leftovers, or another round's ("final review" and "final review 2" share an id).
export const stagesOf = (r, ctx) => r.tasks.map((task) => {
  const agents = taskAgents(task, r, ctx);
  const stage = shownStage(task, agents);
  return { agents: stage === "done" ? [] : agents, stage };
});

// "1 implementing · 4 in review": the tasks under way, by stage.
function stageSummary(stages) {
  return ["implement", "review", "fix"].map((s) => [s, stages.filter((x) => x.stage === s).length])
    .filter(([, n]) => n > 0).map(([s, n]) => `${n} ${STAGE[s].label.toLowerCase()}`).join(" · ");
}

// One segment per planned task, coloured by its stage, hover for its name and stage, and how
// many are done and under way below it; only for runs that plan at least one. Proof is told by
// claims (the Claims section), not per task.
function taskStrip(t, r, counts, stages, names = true) {
  return v_flex().gap(5)
    .child(h_flex().gap(3).h(6).children(Array.from({ length: counts.planned }, (_, i) => {
      const task = r.tasks[i];
      const color = task ? taskColor(t, task, stages[i].stage) : i < counts.done ? t.done : t.border;
      return div().id(`seg-${r.key}-${i}`).flex_1().h_full().rounded(3).bg(color)
        .when(Boolean(task), (el) => el.tooltip([[task.id, task.name].filter(Boolean).join(" "), stageText(task, stages[i].stage)].filter(Boolean).join(" · ")))
        // An agent is at it: a light edge, still (see statusDot for why not a pulse).
        .when(Boolean(task) && pulse(stages[i].stage, task), (el) => el.border(1).border_color(t.foreground + "88"));
    })))
    .when(names, (el) => el.child(div().text_size(11).text_color(t.dim).child(tasksText(r, counts, stages))));
}

// "21/22 done · 1 in review": the tasks done (data.js taskCounts, as the header counts them),
// then those under way by stage.
function tasksText(r, counts, stages) {
  return [`${counts.done}/${counts.planned} done`, stageSummary(stages)].filter(Boolean).join(" · ");
}

// What a card offers: Park and Close while its orchestrator runs, finished or not (a
// finished run may still wait on review or QA), Resume, Park and Close once it is gone,
// Resume and Close once parked, Resume and Delete once closed.
function actionsOf(r, orch, closed) {
  if (closed) return ["resume", "delete"];
  if (isParked(r)) return ["resume", "close"];
  if (orch === "gone") return ["resume", "park", "close"];
  return ["park", "close"];
}

const ACTION = {
  park: { label: "Park", tip: "Set this run aside: closes its orchestrator's tab and its integration worktree's space, keeping the worktree; resume it any time" },
  close: { label: "Close", tip: "Close this run for good: its orchestrator ends its agents, deletes the run's worktrees once their code is pushed, and closes its tab; it can still be resumed" },
  delete: { label: "Delete", tip: "Delete this run for good: its run directory goes, so it leaves Harbormaster and can't be resumed; branches and PRs stay" },
  resume: { label: "Resume", tip: "Start a new orchestrator that picks this run up where it stopped" },
};

// The question a card asks before acting, naming what is left.
function confirmText(r, action, counts) {
  const left = [counts.planned ? `${counts.done} of ${counts.planned} tasks done` : null,
    r.prs.length ? plural(r.prs.length, "PR") + " stay open" : null].filter(Boolean).join(", ");
  if (action === "park") return `Park ${r.branch}? Its orchestrator and agents end and its integration worktree's space closes (the worktree stays); the run waits here until you resume it.${left ? ` ${left}.` : ""}`;
  const clean = "Its orchestrator pushes what isn't pushed, deletes the worktrees and closes its tab; branches and PRs stay.";
  if (action === "close") return r.phase === "finished" ? `Close ${r.branch}? ${clean}`
    : `Close ${r.branch} for good, unfinished?${left ? ` ${left}.` : ""} ${clean}`;
  if (action === "delete") return `Delete ${r.branch} for good? Its run directory goes: spec, plan, decisions and status, so it can't be resumed. This can't be undone. Branches and PRs stay on git and GitHub.`;
  return `Resume ${r.branch}? A new orchestrator starts in ${r.repo}${r.machine ? ` on ${r.machine}` : ""}, restarting unfinished tasks.`;
}

// The action note and error lines, each with a small × that dismisses it now. A note also goes by
// itself (note.js); an error stays until dismissed, since it needs reading.
export function noteRows(view, t, fixed) {
  const line = (id, text, color, clear) => {
    const row = h_flex().id(id).w_full().px(4).gap(6).items_start().text_size(11).text_color(color);
    if (fixed) row.flex_none().pt(4);
    return row.child(div().flex_1().min_w(0).child(text))
      .child(div().id(`${id}-x`).flex_none().cursor_pointer().px(3).text_size(14).text_color(t.dim).hover((s) => s.text_color(t.foreground)).tooltip("Dismiss")
        .on_click((_e, cx) => { cx.stop_propagation(); clear(); cx.notify(); }).child("×"));
  };
  const note = noteText(view);
  return [
    note ? line("action-note", note, t.muted, () => { view.actionNote = null; }) : null,
    view.actionError ? line("action-error", view.actionError, t.blocked, () => { view.actionError = null; }) : null,
  ].filter(Boolean);
}

export function actionButton(t, id, label, tip, onClick, primary = false) {
  const b = div().id(id).flex_none().px(9).h(22).rounded(5).flex().items_center().text_size(11.5).font_medium()
    .bg(primary ? t.accent : t.raised).text_color(primary ? t.background : t.muted);
  // No click: an action is already under way on this card.
  // A greyed-out button still takes its click, so a clickable card around it does not.
  if (!onClick) return b.opacity(0.45).on_click((_e, cx) => cx.stop_propagation()).child(label);
  return b.cursor_pointer().tooltip(tip ?? label)
    .hover((s) => s.opacity(0.85).text_color(primary ? t.background : t.foreground))
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(label);
}

const BUSY = { delete: "Deleting…", park: "Parking…", close: "Closing…" };

// The card's buttons, or, after one is clicked, its question with a confirm and Cancel,
// or, while the confirmed action runs, what it is doing with the buttons dimmed.
// It asks on the card, not in the app's confirm dialog, which can only run a Herdr
// command, not putAway's marker write.
function actionRow(view, t, r, orch, closed, counts) {
  const busy = view.busy?.[r.key];
  const asking = view.confirm?.key === r.key ? view.confirm.action : null;
  const set = (cx, value) => { view.confirm = value; view.actionError = null; view.actionNote = null; cx.notify(); };
  if (busy) {
    return h_flex().gap(6).justify_end().items_center()
      .child(div().flex_1().text_size(11.5).text_color(t.muted).child(busy.label))
      .children(actionsOf(r, orch, closed).map((a) => actionButton(t, `${a}-${r.key}`, ACTION[a].label, null, null, a === "resume")));
  }
  // A Close or Resume asked from the need box confirms there, in sight; the row keeps its buttons.
  if (asking && !view.confirm.box) return confirmBlock(view, t, r, orch, counts, asking, r.key);
  return h_flex().gap(6).justify_end()
    .children(actionsOf(r, orch, closed).map((a) => actionButton(t, `${a}-${r.key}`, ACTION[a].label, ACTION[a].tip,
      (cx) => set(cx, { key: r.key, action: a }), a === "resume")));
}

// The question a card asks before `asking` (park, close, delete, resume) with its confirm and
// Cancel, and the confirmed action. `id` keeps the action row's and the need box's apart.
function confirmBlock(view, t, r, orch, counts, asking, id) {
  const set = (cx, value) => { view.confirm = value; view.actionError = null; view.actionNote = null; cx.notify(); };
  const yes = (cx) => {
    set(cx, null);
    if (asking === "resume") return resumeRun(r);
    const busy = { label: BUSY[asking], at: Date.now(), branch: r.branch };
    view.busy[r.key] = busy;
    // The click's cx dies with the click; the awaited work notifies through cx.spawn's.
    // Owned by no view, so closing or reloading a copy can't cancel it halfway; the
    // label clears once the action ends, and the view's timer gives up on it after
    // BUSY_LIMIT should the task never end at all.
    cx.spawn(async (cx) => {
      const done = () => {
        if (view.busy[r.key] === busy) delete view.busy[r.key];
        view.redraw = true;
        try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
      };
      try {
        if (asking === "delete") await deleteRun(r);
        else {
          const note = await putAway(r, asking === "park" ? "parked" : "closed", orch);
          if (note) setNote(view, `${r.branch}: ${note}`);
        }
      } catch (e) { view.actionError = `${r.branch}: ${e?.message ?? e}`; }
      done();
      // Show the outcome now rather than at the next 5 s refresh.
      try { await view.load(cx); } catch { /* the next refresh shows it */ }
    }, { owner: null });
  };
  return v_flex().gap(6).p(8).rounded(7).bg(t.raised)
    .child(div().text_size(12).text_color(t.foreground).child(confirmText(r, asking, counts)))
    .child(h_flex().gap(6)
      .child(actionButton(t, `yes-${id}`, ACTION[asking].label, null, yes, true))
      .child(actionButton(t, `no-${id}`, "Cancel", null, (cx) => set(cx, null))));
}

// A Crew row's edge colour from its name (crewrows.js rowEdge): red for Needs you, amber for a
// stall, a review wait cyan (a calm colour apart from Done's blue), grey for can't tell; a run
// at work or briefly idle takes the border's: fine needs no colour.
// Rows add their own alpha to the edge colour ("…14"), so it must be opaque: theme colours
// such as border can carry alpha (#ffffff18), which would make "#ffffff1814", not a colour.
// Such a colour is laid over the sidebar's own (`bg`) as it would show there, so a faint border
// stays faint rather than turning into its full, unfaded colour.
const hex = (c, i) => parseInt(c.slice(i, i + 2), 16);
function opaque(c, bg = null) {
  if (typeof c !== "string" || !/^#[0-9a-f]{8}$/i.test(c)) return c;
  if (typeof bg !== "string" || !/^#[0-9a-f]{6}/i.test(bg)) return c.slice(0, 7);
  const a = hex(c, 7) / 255;
  return `#${[1, 3, 5].map((i) => Math.round(hex(c, i) * a + hex(bg, i) * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
}
// The selected Crew row's fill: the accent faintly over the sidebar, on any edge colour.
export const SELECTED = (t) => opaque(`${opaque(t.accent)}40`, t.chrome);
export const edgeColor = (t, edge) => opaque(edge === "amber" ? AMBER(t) : edge === "pass" ? PASS(t) : edge === "review" ? t.ansi6 ?? t.accent : edge === "neutral" ? t.border : t[edge] ?? t.border, t.chrome);

// ---- ask what's blocking, the review flow, close all merged ----

// The notes after "<branch>: " when an ask to what is blocking, or a red CI, waits or is blocked.
const ASK_NOTES = {
  waits: "the ask waits in its inbox until the run is resumed",
  blocked: "its orchestrator is blocked on a dialog; it reads the ask once that is answered",
};

// A stalled run's "Ask what's blocking" (`short`: "Ask", for the narrow Crew row), or "asked…"
// while the ask waits: its message is unread, or nothing moved since it was asked here. Null for
// a run that is not stalled, is put away, or whose orchestrator is not known here.
export function blockingAction(view, t, r, att, id, short = false) {
  if (!r?.dir || !r.localTerminal || r.away || !att?.stall) return null;
  if (inboxAsked(r, "blocking", "", r)) {
    return div().id(`blk-${id}`).flex_none().text_size(11).text_color(AMBER(t))
      .tooltip("Asked its orchestrator what is blocking; waiting for its progress or status to change").child("asked…");
  }
  const quiet = quietText(att.stall).replace(/^quiet /, "");
  const step = stepText(att.step) || null;
  return actionButton(t, `blk-${id}`, short ? "Ask" : "Ask what's blocking",
    `Ask what's blocking: a message in the run's inbox that wakes its orchestrator ("what is blocking? … quiet for ${quiet}…"); it asks you with a question if it needs you, else carries on`,
    // Written but not woken: the ask is in the inbox, so it stays asked (inbox.js send).
    (cx) => askClick(view, cx, r, "blocking", { quiet, step }, { asks: [{ key: "", item: r }], notes: ASK_NOTES }));
}

// A red CI's "Ask the orchestrator" in a Needs-you box, or "asked…" while the ask waits: the same
// "what is blocking?" message (inbox.js ciRequest), so it reads asked as Ask what's blocking does.
function ciAction(view, t, r, action, id) {
  if (!r?.dir || !r.localTerminal || r.away) return null;
  if (inboxAsked(r, "ci", "", r)) {
    return div().id(`ci-${id}`).flex_none().text_size(11).text_color(t.muted)
      .tooltip("Asked its orchestrator to see to the red CI; waiting for its progress or status to change").child("asked…");
  }
  const pr = action.pr;
  const url = pr?.failed?.url ?? pr?.url ?? null;
  return actionButton(t, `ci-${id}`, action.label,
    `A message in the run's inbox that wakes its orchestrator ("what is blocking? … CI red on #${pr?.number ?? "?"}…"): it fixes what is the run's to fix, or asks you`,
    (cx) => askClick(view, cx, r, "ci", { pr: pr?.number ?? null, check: action.check, url }, { asks: [{ key: "", item: r }], notes: ASK_NOTES }));
}

// PRs asked to address their comments are kept in the shared asked store (inbox.js), so every
// copy and a reload know; the unread message (run.commentsAsked) says it too until it is read.

const MODE_TIP = {
  ask: "Ask me: its orchestrator writes you one question listing each comment with what it proposes (fix, reply or leave, and why); it acts on your answer",
  handle: "Handle them: its orchestrator fixes what it agrees with, pushes, replies on each thread it acted on (\"🤖 AI: …\"), never resolving one, and reports; it never merges",
};

// Address comments, on a run's card and pane: for each of its approved or changes-requested PRs
// with open review comments, "Address 9 threads on #42" and two buttons, Ask me and Handle them,
// the run's autonomy's default (comments.js defaultMode) highlighted; a click writes an inbox
// message for that PR (inbox.js) and the row reads "asked…" while the message is
// unread and, once read, until the PR's open comments change (while the run works, until a new
// one appears). Null when there are none, the run
// is put away, or its orchestrator is not known here; and while the run has an open question
// (an Ask me's question is answered in its box, and a second ask would only queue a duplicate).
function commentsAction(view, t, r, att, id) {
  if (!r?.dir || !r.localTerminal || r.away || r.question) return null;
  const prs = (att?.next?.comments?.prs ?? []).filter((p) => hasComments(p.comments) && p.url);
  if (!prs.length) return null;
  const first = defaultMode(r.autonomy);
  const rows = prs.map((p, i) => {
    const b = botCount(p.comments.bots);
    const what = `Address ${commentsText(p.comments)}${p.comments.count > 0 && b ? ` (+${b} from bots)` : ""}${prs.length > 1 || p.number ? ` on #${p.number}` : ""}`;
    const label = div().id(`cmt-${id}-${i}-label`).flex_none().text_size(11.5).text_color(t.muted)
      .tooltip(commentLines([p], 20).join("\n")).child(what);
    if (addressAsked(r, p, att)) return h_flex().gap(8).items_center().child(label).child(askedNote(t, `cmt-${id}-${i}`));
    return h_flex().gap(6).items_center().child(label)
      .child(actionButton(t, `cmt-${id}-${i}-ask`, "Ask me", modeTip(r, "ask"), addressSend(view, r, p, "ask"), first === "ask"))
      .child(actionButton(t, `cmt-${id}-${i}-handle`, "Handle them", modeTip(r, "handle"), addressSend(view, r, p, "handle"), first === "handle"));
  });
  return v_flex().gap(4).children(rows);
}

// Whether a PR's Address comments was asked and is still being handled (inbox.js asked).
// The run's assessment (`att`) has the PRs asked about, judged with whether the run is working
// (a moving comment list under a working orchestrator is its own doing); without one, the store.
function addressAsked(r, p, att = null) {
  return att?.askedPrs ? att.askedPrs.has(p.url) : inboxAsked(r, "comments", p.url, p);
}
const askedNote = (t, id) => div().id(id).flex_none().text_size(11).text_color(t.muted)
  .tooltip("Asked its orchestrator to address these comments; while its orchestrator works on them, or until its open comments change (a comment the reviewer adds later ends it)").child("asked…");
const modeTip = (r, mode) => `${MODE_TIP[mode]}.${mode === defaultMode(r.autonomy) ? ` The default at ${r.autonomy ?? "L0"}.` : ""}`;

// The click of an Ask me or Handle them: writes the run's inbox message for the PR (inbox.js);
// the button reads "asked…" until the PR's open comments change.
const addressSend = (view, r, p, mode) => addressSendAll(view, r, [p], mode);

// The click of Ask me about all / Handle all: one message for all the PRs (inbox.js), so the
// orchestrator is woken once. Each PR reads "asked…" at once; all are unmarked if the message
// did not reach the inbox.
const addressSendAll = (view, r, prs, mode) => (cx) => askClick(view, cx, r, "comments-all", { prs, mode },
  { asks: prs.map((p) => ({ key: p.url, item: p })), notes: ASK_NOTES });

// The card's and pane's own Address rows, only while the run is in Needs you and its box does
// not carry them (needaction.js ownAddressRows).
const addressRows = (view, t, r, ctx, f, id) => (ownAddressRows(f.need, f.need ? needItemsOf(r, ctx, f.att) : [])
  ? commentsAction(view, t, r, f.att, id) : null);

// Who reviews the run's pull requests, peer (a colleague on GitHub) or self (you, from the
// proof), as a two-way toggle with the folder's default marked. A click sets it for the whole
// repository folder (tracking.js setReviewFlow), so every run of it changes at once; picking
// the default removes the setting.
function flowToggle(t, r, id) {
  const st = flowState(r, reviewFlows());
  const tip = (f) => `${f === "peer" ? "Peer: a colleague reviews on GitHub (request review, review from, approved — merge)" : "Self: you review the proof and merge (review proof → merge)"}.
`
    + `For every run in ${st.key}${f === st.fallback ? "; the default for it" : ""}.`;
  const seg = (f) => {
    const on = st.flow === f;
    return div().id(`flow-${id}-${f}`).flex_none().px(7).h(18).flex().items_center().rounded(4).text_size(10.5)
      .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.dim).when(on, (e) => e.font_semibold())
      .tooltip(tip(f))
      .when(!on, (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); setReviewFlow(st.key, flowSetting(f, st.fallback)); cx.notify(); }))
      .child(f === st.fallback ? `${f} (default)` : f);
  };
  return h_flex().id(`flow-${id}`).flex_none().gap(3).items_center().text_size(10.5).text_color(t.dim)
    .child(div().flex_none().pr(2).child("Review")).child(seg("self")).child(seg("peer"));
}

// Close all merged, from the Crew's Done heading: closes each run as its card's Close does
// (data.js putAway), one at a time, after the heading asked, naming how many.
const CLOSE_ALL_KEY = "done:close-all";
function closeAll(view, runs, ctx, cx) {
  if (!runs.length) return;
  const at = Date.now();
  const batch = { label: `Closing ${plural(runs.length, "merged run")}…`, at, branch: "merged runs", limit: 2 * 60000 + runs.length * 30000 };
  view.busy[CLOSE_ALL_KEY] = batch;
  for (const r of runs) view.busy[r.key] = { label: "Closing…", at, branch: r.branch, limit: batch.limit };
  const orchs = new Map(runs.map((r) => [r.key, orchestratorState(r, ctx)]));
  // As a card's action: owned by no view, notifying through cx.spawn's cx.
  cx.spawn(async (cx) => {
    const failed = [], notes = [];
    for (const r of runs) {
      try {
        const note = await putAway(r, "closed", orchs.get(r.key));
        if (note && /blocked/.test(note)) notes.push(`${r.branch}: ${note}`);
      } catch (e) { failed.push(`${r.branch} (${e?.message ?? e})`); }
      if (view.busy[r.key]?.at === at) delete view.busy[r.key];
    }
    if (view.busy[CLOSE_ALL_KEY]?.at === at) delete view.busy[CLOSE_ALL_KEY];
    const done = runs.length - failed.length;
    setNote(view, [done ? `Closing ${plural(done, "merged run")}: their orchestrators clean up and close their tabs.` : null, ...notes].filter(Boolean).join("\n") || null);
    if (failed.length) view.actionError = `${failed.length} not closed: ${failed.join("; ")}`;
    view.redraw = true;
    try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
    try { await view.load(cx); } catch { /* the next refresh shows it */ }
  }, { owner: null });
}

// The Done heading's right side: Close all merged, its question once clicked, or what it is doing.
export function closeAllControl(view, t, rows, ctx) {
  const busy = view.busy?.[CLOSE_ALL_KEY];
  if (busy) return { button: div().flex_none().text_size(10.5).font_normal().text_color(t.muted).child(busy.label), confirm: null };
  const runs = closableDone(rows, view.busy ?? {});
  if (!runs.length) return { button: null, confirm: null };
  const set = (cx, value) => { view.confirm = value; view.actionError = null; view.actionNote = null; cx.notify(); };
  if (view.confirm?.key !== CLOSE_ALL_KEY) {
    return { button: actionButton(t, "close-all-merged", "Close all merged",
      `Close ${plural(runs.length, "run")} whose pull requests are all merged or closed, as each card's Close does`,
      (cx) => set(cx, { key: CLOSE_ALL_KEY })), confirm: null };
  }
  const names = runs.map((r) => r.branch).join(", ");
  return {
    button: null,
    confirm: v_flex().id("close-all-confirm").flex_none().gap(6).p(8).rounded(7).bg(t.raised)
      .child(div().text_size(12).text_color(t.foreground)
        .child(`Close ${plural(runs.length, "merged run")} (${names})? Each orchestrator pushes what isn't pushed, deletes the worktrees and closes its tab; branches and PRs stay.`))
      .child(h_flex().gap(6)
        .child(actionButton(t, "close-all-yes", `Close ${runs.length}`, null, (cx) => { set(cx, null); closeAll(view, runs, ctx, cx); }, true))
        .child(actionButton(t, "close-all-no", "Cancel", null, (cx) => set(cx, null)))),
  };
}

// What card() and runDetail() both show: the run's state, its links and the header row.
// Each run's attention (attend.js), once per facts() snapshot: the overview's header, its
// order and every card read it, and a render takes one snapshot.
const attention = new WeakMap();
export function attOf(r, ctx) {
  let m = attention.get(ctx);
  if (!m) attention.set(ctx, (m = new Map()));
  if (!m.has(r)) m.set(r, attentionOf(r, ctx));
  return m.get(r);
}

// Whether a run needs you (attend.js needsYouNow), with this render's attention.
const needsYouNow = (r, ctx) => needsYouOf(r, ctx, attOf(r, ctx));

// A run's dot (Crew row, card, pane): working while its orchestrator or any of its agents
// works, or its CI runs; blocked while any is blocked on a dialog (attention.js runDot). The
// orchestrator's own status alone sits idle between its turns while five agents implement.
export const runStatus = (own, workers, att, ctx) =>
  runDot(own, workers.map((w) => agentStatus(w, ctx)), { ciRunning: att?.reasons?.[0]?.key === "ci-running" });

export function runFacts(r, ctx) {
  const orch = orchestratorState(r, ctx);
  const parked = isParked(r);
  const att = attOf(r, ctx);
  const need = needsYouNow(r, ctx);
  let badge = (parked ? PHASE.parked : r.away?.how === "closed" ? PHASE.closed : PHASE[r.phase]) ?? PHASE.unknown;
  // A run in Needs you or Done, or a finished one, says what comes next instead, as its Crew
  // card does ("approved — merge", "review from anna"); a parked or closed one keeps saying so.
  const next = !r.away && badgeOf(att, r.phase === "finished");
  if (next) badge = next;
  // A question or blocker read from a stale run read: under Can't tell, as in the Crew, never
  // a red Needs you the header and the Crew don't count.
  else if (!r.away && att.group === "cant" && (badge === PHASE.waiting || badge === PHASE.blocked)) badge = PHASE.cant;
  const workers = workersOf(r.terminal, ctx);
  return {
    orch, parked, need, badge, att,
    // A parked run keeps its pill, with what its PRs wait on muted beside it.
    parkedNext: parked ? parkedLabel(att, r.away) : null,
    dot: runStatus(orch, workers, att, ctx),
    closed: isClosed(r, ctx),
    reason: needReason(r, orch) ?? needLine(att),
    counts: taskCounts(r),
    prs: prsOf(r) ?? r.prs.map((p) => unknownPr(p.url, p.repo)),
    related: relatedOf(r),
    workers,
    stages: stagesOf(r, ctx),
  };
}

function cardHeader(view, t, r, f, meta, lead = null) {
  return h_flex().gap(8).items_center()
    .child(div().flex_none().text_size(15).child(OCTOPUS))
    .child(v_flex().flex_1().min_w(0)
      .child(h_flex().gap(6).items_center().min_w(0)
        .when(Boolean(r.type), (el) => el.child(runTypeTag(t, r, r.key)))
        .children(levelTags(view, t, r, r.key))
        .child(withTip(div().id(`title-${r.key}`).truncate().font_semibold().text_size(13.5).text_color(t.foreground), runName(r.branch, r.topic)))
        .when(Boolean(r.machine), (el) => el.child(div().flex_none().text_size(10.5).px(5).rounded(4).bg(t.raised).text_color(t.muted).child(r.machine))))
      .child(metaLine(t, r, meta, lead)))
    .map(withContext(view, t, `run-${r.key}`, r.terminal))
    .child(runPin(t, `pin-${r.key}`, r, f.orch))
    .child(statusDot(t, f.dot))
    .when(Boolean(f.parkedNext), (el) => el.child(div().id(`parked-next-${r.key}`).min_w(0).truncate().text_size(11).text_color(t.dim)
      .tooltip("What its pull requests wait on, and how long it has been parked. Parked runs stay out of Needs you.").child(f.parkedNext)))
    .child(f.badge.tip ? div().id(`badge-${r.key}`).flex_none().tooltip(f.badge.tip).child(pill(t, f.badge.label, badgeColor(t, f), f.need))
      : pill(t, f.badge.label, badgeColor(t, f), f.need));
}

// A card's pill colour: red in Needs you, except a run that is ready to merge (green).
const badgeColor = (t, f) => (f.badge.ready ? PASS(t) : f.need ? "blocked" : f.badge.tone);

// What a run needs you for (needaction.js needActions), with this render's attention: its
// proof and its reports, for the lines that point at them.
export function needItemsOf(r, ctx, att = attOf(r, ctx)) {
  if (att?.group !== "needs") return [];
  return needActions(att, { run: r, prs: prsOf(r) ?? [], now: Date.now(), proof: needProof(r, stagesOf(r, ctx)), reports: (r.reports ?? []).map((n) => `shared/${n}`) });
}

// A run's proof in the shape needActions takes ({tier, pass, total, fail, failed, accepted,
// gaps}): a claim proven is a pass, and the failed one is named by its words. An old run has only
// its checks line: red is its one failure, else there is nothing to read (null).
function needProof(r, stages) {
  const tier = r.proof.tier?.tier ?? null;
  if (!hasClaims(r)) return r.proof.md?.checks?.state === "red" ? { tier, pass: 0, total: 0, fail: 1, failed: "the checks", gaps: "checks red" } : null;
  const rows = claimRowsOf(r, stages);
  const c = claimCounts(rows);
  const failed = rows.find((k) => k.state === "fail");
  return { tier, pass: c.proven, fail: c.fail, accepted: c.accepted, total: c.total,
    gaps: claimsGaps(rows, r.proof.md), failed: failed ? `${failed.id} ${failed.name}` : null };
}

// One of a need item's buttons (needaction.js action kinds). `where` is "card" or "pane": the
// pane unfolds its own Proof section, the card opens the run's pane as a popup with it unfolded.
export function needButton(view, t, r, f, x, id, where, primary) {
  const confirm = (action) => (cx) => { view.confirm = { key: r.key, action, box: where }; view.actionError = null; view.actionNote = null; cx.notify(); };
  switch (x.kind) {
    case "open": return actionButton(t, id, x.label, x.url, () => openUrl(x.url), primary);
    // Ask me and Handle them share one "asked…" once either was clicked.
    case "address": return addressAsked(r, x.pr, f.att) ? (x.mode === "ask" ? askedNote(t, id) : null)
      : actionButton(t, id, x.label, modeTip(r, x.mode), addressSend(view, r, x.pr, x.mode), primary);
    // Asked and being handled: its row says so, with Open beside.
    case "asked": return askedNote(t, id);
    case "address-all": return x.prs.every((p) => addressAsked(r, p, f.att)) ? null
      : actionButton(t, id, x.label, `${modeTip(r, x.mode)} For each of the ${x.prs.length} PRs.`, addressSendAll(view, r, x.prs.filter((p) => !addressAsked(r, p, f.att)), x.mode), primary);
    case "focus": return actionButton(t, id, x.label, "Show its terminal", () => focusAgent(x.address), primary);
    case "ask-ci": return ciAction(view, t, r, x, id);
    case "ask-blocking": return blockingAction(view, t, r, f.att, id);
    case "report": return pathLink(t, r, id, x.path, x.label);
    case "close": return actionButton(t, id, x.label, ACTION.close.tip, confirm("close"), primary);
    case "resume": return actionButton(t, id, x.label, ACTION.resume.tip, confirm("resume"), primary);
    case "proof": return actionButton(t, id, x.label, where === "pane" ? "Show every claim, the first worth a look unfolded" : "Open this run's pane with its claims unfolded", (cx) => {
      // Opening it is reading it: the box then says what to do next (needaction.js).
      markProofRead(r);
      if (where !== "pane") {
        openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: { ...runProps(r), proof: true } });
        return;
      }
      view.folds ??= new Map(); view.folds.set(`pf-${r.key}`, true);
      const k = firstToOpen(r, stagesOf(r, facts()));
      if (k) { view.proofRows ??= new Set(); view.proofRows.add(`${r.key}-${k.id}`); }
      cx.notify();
    }, primary);
    case "changes": return changesButton(view, t, r, id);
    default: return null;
  }
}

// Marks the run's proof, as it shows now, as read (proofseen.js).
const markProofRead = (r) => markProofSeen(r, proofState(r, stageNames(r, stagesOf(r, facts()))).sig);

// The claim the Proof button unfolds: the first worth a look, else the first still being proved.
const firstToOpen = (r, stages) => {
  const rows = claimRowsOf(r, stages);
  return rows.find(worthALook) ?? rows.find((k) => k.state === "pending") ?? null;
};

// Ask for changes on a ready run: opens the Reply field under the box; Enter writes the text to the
// run's inbox as "changes asked from Harbormaster: …" and wakes the orchestrator (submitReply).
const changesId = (r) => `changes:${r.key}`;
function changesButton(view, t, r, id) {
  const open = view.replying === changesId(r);
  const can = Boolean(r.dir && r.localTerminal && !r.away);
  return actionButton(t, id, open ? "Cancel" : "Ask for changes",
    can ? "Say what to change: a message in the run's inbox that wakes its orchestrator, which plans it as tasks and finishes again" : "Its orchestrator is not known here: open the run to ask",
    can ? (cx) => {
      view.replying = open ? null : changesId(r);
      view.reply.set_value("");
      if (!open) view.reply.focus();
      cx.notify();
    } : null);
}

// The need items as lines, each with its buttons; the first item's first button stands out, unless
// the actions say which does (`primary`). Actions about one PR each (`row`: "#1799 · 15 comments")
// go in a row per PR, led by it.
export function needLines(view, t, r, f, items, where, underQuestion = false) {
  return items.map((it, i) => {
    const buttons = it.actions.map((x, j) => ({ row: x.row ?? null,
      el: needButton(view, t, r, f, x, `need-${where}-${r.key}-${i}-${j}`, where, isPrimary(x, i, j, underQuestion)) })).filter((b) => b.el);
    const rows = [];
    for (const b of buttons) {
      if (!rows.length || rows[rows.length - 1].row !== b.row) rows.push({ row: b.row, els: [] });
      rows[rows.length - 1].els.push(b.el);
    }
    // A ready run: a headline and what is done, in the pass colour (needaction.js readyItem).
    const head = it.ready
      ? v_flex().id(`needt-${where}-${r.key}-${i}`).gap(1)
        .child(div().text_size(14).font_semibold().text_color(PASS(t)).child(it.headline))
        .child(div().text_size(12).text_color(PASS(t)).child(oneLine(it.detail, 220)))
      : div().id(`needt-${where}-${r.key}-${i}`).text_size(12).text_color(t.foreground).when(Boolean(it.tip), (el) => el.tooltip(it.tip)).child(oneLine(it.line, 220));
    return v_flex().id(`needl-${where}-${r.key}-${i}`).gap(4)
      .child(head)
      .children(rows.map((x) => h_flex().flex_wrap().gap(6).items_center()
        .when(Boolean(x.row), (el) => el.child(div().flex_none().min_w(0).pr(2).text_size(11).text_color(t.muted).child(x.row)))
        .children(x.els)));
  });
}

// A Close or Resume clicked in this need box, confirmed here rather than in the action row at
// the bottom, which a long pane may have scrolled away; null otherwise.
export const boxConfirm = (view, t, r, f, where) => (view.confirm?.key === r.key && view.confirm.box === where && !view.busy?.[r.key]
  ? confirmBlock(view, t, r, f.orch, f.counts, view.confirm.action, `need-${where}-${r.key}`) : null);

// "Open the orchestrator", small: never the headline, since most reasons are done elsewhere.
const orchLink = (t, r, f, id) => (f.orch === "gone" || !r.terminal ? null
  : div().id(id).flex_none().text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
    .tooltip("Show its orchestrator's terminal").on_click((_e, cx) => { cx.stop_propagation(); focusAgent(r.terminal); }).child("Open the orchestrator"));

// What a run needs you for, on its card and in its pane. Without a question: a line per reason
// saying what to do and why, with the buttons that do it (needaction.js), and a small link to
// the orchestrator. With one: what it asks, the recommendation in short and what it blocks, then
// a Details fold with the question's sections, a button per option and Reply, answered the way
// Waiting on you answers (answerParts, sendAnswer: the run's inbox, then a wake); any other
// reason under it. `where` tells the card's and the pane's ids apart.
export function needBox(view, t, r, f, ctx, where) {
  const focus = (_e, cx) => { cx.stop_propagation(); if (f.orch !== "gone") focusAgent(r.terminal); };
  const it = r.ask ? decisionQueue([r], [], ctx).find((x) => x.kind === "run") : null;
  const all = needItemsOf(r, ctx, f.att);
  // A run that is ready to merge is the one thing here that is good news: green, "Ready", "✓".
  const ready = !it && all.length === 1 && all[0].ready;
  const tint = ready ? PASS(t) : t.blocked;
  const box = h_flex().id(`need-${where}-${r.key}`).gap(8).p(8).rounded(7).bg(tint + "1c").items_start()
    // Clicks on its buttons and links stay in the box, never the card's open-the-orchestrator.
    .on_click((_e, cx) => cx.stop_propagation())
    .child(div().flex_none().text_color(tint).font_bold().child(r.question ? "?" : ready ? "✓" : "!"));
  if (!it) {
    // A question.md that did not parse into a title, or a reason the map has no line for: say it as is.
    const items = all.length ? all : [{ key: "other", line: (f.reason ?? "needs you").slice(0, 220), actions: [] }];
    // No small link when the first line's own button already opens the orchestrator.
    const first = items[0].actions[0];
    const link = first?.kind === "focus" && first.address === r.terminal ? null : orchLink(t, r, f, `need-orch-${where}-${r.key}`);
    return box.child(v_flex().flex_1().min_w(0).gap(6)
      // The sidebar's box sits under the red "Needs you · N" heading already; a second label is a line spent on nothing.
      .when(!ready && where !== "sidebar", (el) => el.child(div().text_size(11).font_semibold().text_color(tint).child("Needs you")))
      .children(needLines(view, t, r, f, items, where))
      .when(ready && view.replying === changesId(r), (el) => el.child(v_flex().gap(4)
        .child(Input.new(view.reply))
        .child(div().text_size(10.5).text_color(t.dim).child("What should change? Enter writes it to the run's inbox and tells its orchestrator"))))
      .children([boxConfirm(view, t, r, f, where)].filter(Boolean))
      .when(Boolean(link), (el) => el.child(h_flex().child(link))));
  }
  const head = needHead(r.ask);
  const key = `q-${r.key}`;
  const open = isOpen(view, key);
  const a = answerParts(view, t, it, ctx, "box");
  const sections = questionSections(r.ask, r.question);
  // The details, folded: what is long. The options are already above as buttons, so here they are
  // their whole text, a line each, for choosing between them.
  const fold = h_flex().id(`qfold-${where}-${r.key}`).gap(6).items_center().min_w(0).rounded(4).cursor_pointer()
    .text_size(11.5).text_color(t.foreground).hover((st) => st.bg(t.hover))
    .tooltip(open ? "Hide the question's details" : "The whole question, what each option does, the evidence and the risk")
    .on_click((_e, cx) => { cx.stop_propagation(); view.folds ??= new Map(); view.folds.set(key, !open); cx.notify(); })
    .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.muted))
    .child(div().truncate().child(detailsLabel(sections, it.options)))
    .child(div().flex_none().text_color(t.dim).child(it.since ? `asked ${ago(it.since)}` : ""));
  // A section's text whole, as paragraphs (question.js), under its small label.
  const part = (label, text, color) => v_flex().gap(2)
    .when(Boolean(label), (el) => el.child(div().text_size(10.5).font_semibold().text_color(color ?? t.dim).child(label)))
    .children(paragraphs(text).map((l) => div().text_size(11.5).text_color(t.foreground).child(l)));
  const options = it.options.length > 0 && v_flex().gap(4)
    .child(div().text_size(10.5).font_semibold().text_color(t.dim).child("What each option does"))
    .children(it.options.map((o, i) => div().text_size(11.5).text_color(t.muted)
      .child(`${i === it.recommended ? "★ " : ""}${o.label}${o.text && o.text !== o.label ? `: ${plain(o.text)}` : ""}`)));
  const tone = { Recommended: t.accent, Risk: t.blocked };
  const details = open && detailsLabel(sections, it.options) && v_flex().id(`qdetail-${where}-${r.key}`).gap(8).pt(4)
    // Clicks in here never fall through to the card's open-the-orchestrator.
    .on_click((_e, cx) => cx.stop_propagation())
    .children(sections.filter((x) => !x.label || x.label === "Question").map((x) => part(x.label, x.text)))
    .when(Boolean(options), (el) => el.child(options))
    .children(sections.filter((x) => x.label && x.label !== "Question").map((x) => part(x.label, x.text, tone[x.label])));
  // The answers: a button per option (the recommended one highlighted, its text on hover) and Reply,
  // right under what is asked, so they read as its answers and nothing else does.
  const answers = (it.options.length > 0 || a.replyBtn) && h_flex().id(`qans-${where}-${r.key}`).flex_wrap().gap(6).items_center()
    .children(it.options.map((_o, i) => a.optionButton(i)))
    .when(Boolean(a.replyBtn), (el) => el.child(a.replyBtn));
  // Anything else it needs you for (a red CI, a PR to merge), as without a question, set apart.
  const others = all.filter((x) => x.key !== "question");
  return box.child(v_flex().flex_1().min_w(0).gap(4)
    .child(div().id(`qtitle-${where}-${r.key}`).cursor_pointer().text_size(12.5).font_medium().text_color(t.foreground)
      .tooltip(f.orch !== "gone" ? "Open the orchestrator" : "The orchestrator is gone: answer here, it waits in the run's inbox")
      .on_click(focus).child(oneLine(head.title, 300)))
    // What waits on the answer, the urgency cue, right under what is asked.
    .when(Boolean(head.blocks), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(oneLine(head.blocks, 160))))
    .when(Boolean(head.rec), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(oneLine(head.rec, 200))))
    .when(Boolean(answers), (el) => el.child(div().pt(2).child(answers)))
    .when(Boolean(a.input), (el) => el.child(a.input))
    .when(Boolean(a.note), (el) => el.child(a.note))
    .when(Boolean(detailsLabel(sections, it.options)), (el) => el.child(fold))
    .when(Boolean(details), (el) => el.child(details))
    .when(others.length > 0, (el) => el.child(v_flex().id(`qalso-${where}-${r.key}`).gap(6).mt(4).pt(8).border_t(1).border_color(t.border)
      .child(div().text_size(11).font_semibold().text_color(t.muted).child("Also needs you"))
      .children(needLines(view, t, r, f, others, where, true))))
    .children([boxConfirm(view, t, r, f, where)].filter(Boolean)));
}

// The one-line notes under the progress: parked or closed, gone, waiting agents, unread messages.
// `decisions`: false in the pane, whose Decisions heading says what is new itself.
function cardNotes(t, r, f, decisions = true) {
  const note = (text, tone = "muted") => div().text_size(11.5).text_color(t[tone]).child(text);
  return [
    r.away && note(`${f.parked ? "Parked" : "Closed"} ${ago(r.away.at)}${r.away.was ? ` · was: ${r.away.was}` : ""}`),
    // The Needs you box says so already when it shows.
    !r.away && !f.need && f.orch === "gone" && r.phase !== "finished" && note("Orchestrator is gone: resume, park or close this run.", "blocked"),
    !r.away && f.orch === "gone" && r.phase === "finished" && note("Orchestrator is gone, only a shell is left in its tab: resume it if the PR needs more work, or park or close the run."),
    r.waiting.length > 0 && note(`Waiting on an answer: ${r.waiting.join(", ")}`),
    r.unhandled > 0 && note(`${plural(r.unhandled, "relayed message")} not read yet`),
    decisions && newDecisionsNote(r) && note(newDecisionsNote(r), "accent"),
  ].filter(Boolean);
}

// "7 decisions new since you looked", or null: the run's decision lines newer than when its
// Decisions were last unfolded (telling.js).
export function newDecisionsNote(r) {
  const n = newDecisions(r.decided, decisionsSeen(r)).length;
  return n ? `${plural(n, "decision")} new since you looked` : null;
}

const unscopedOf = (r) => (r.proof.tier ? r.tasks.filter((k) => !k.proof).length : 0);
// The tokens segment, only once over the soft budget ("over budget 92M/100M", in the blocked
// colour); otherwise the tokens are in the Tokens section, not the header.
const tokenMeta = (r) => (r.tokens && r.budget && overBudget(r) ? `over budget ${tokenText(r.tokens.total)}/${tokenText(r.budget)}` : null);
const runMeta = (r, f) => [r.repo, f.workers.length ? plural(f.workers.length, "agent") : null, tokenMeta(r), unscopedOf(r) ? `${unscopedOf(r)} unscoped` : null, r.updated ? `updated ${ago(r.updated)}` : null].filter(Boolean).join(" · ");
// The meta line as three texts, around the tokens segment: it has the breakdown on hover, and
// the blocked colour once over budget.
const metaLine = (t, r, meta, lead = null) => {
  // The pane's first segment, when the run started and how long it has gone, with its date in the hover.
  if (lead) {
    const rest = meta;
    return h_flex().min_w(0).text_size(11.5).text_color(t.dim)
      .child(div().id(`age-${r.key}`).flex_none().tooltip(startedTip(r.started)).child(lead))
      .when(Boolean(rest), (el) => el.child(div().flex_none().px(5).child("·")).child(div().min_w(0).flex_1().child(metaLine(t, r, rest))));
  }
  const tok = tokenMeta(r), at = tok ? meta.indexOf(tok) : -1;
  const line = h_flex().min_w(0).text_size(11.5).text_color(t.dim);
  if (at < 0) return div().truncate().text_size(11.5).text_color(t.dim).child(meta);
  const over = overBudget(r);
  const tip = !r.budget ? tokenDetail(r.tokens) : `${tokenDetail(r.tokens)}\n${over ? "Over its" : "Under its"} soft budget of ${r.budget.toLocaleString("en")} tokens`;
  return line.child(div().flex_none().child(meta.slice(0, at)))
    .child((over ? div().id(`over-${r.key}`).text_color(t.blocked).font_semibold() : div().id(`tokmeta-${r.key}`)).min_w(0).truncate().tooltip(tip).child(tok))
    .child(div().truncate().child(meta.slice(at + tok.length)));
};
// A card's edge: red when it needs you, else its pill's colour; a muted pill (running) has none.
const runEdge = (t, f) => (f.badge.ready ? PASS(t) : f.need ? t.blocked : f.badge.tone === "muted" ? t.border : t[f.badge.tone] ?? t.border);
const relatedTip = (p) => [p.number ? p.title : null, prStateText(p), p.url].filter(Boolean).join(" · ");

function card(view, t, r, ctx, compact = false) {
  const f = runFacts(r, ctx);
  const { orch, closed, need, counts, prs, related } = f;
  const links = [
    ...r.issues.map((url) => linkChip(t, `is-${r.key}-${url}`, url, div().child("◎"))),
    ...related.map((p) => linkChip(t, `rel-${r.key}-${p.url}`, p.url,
      svg("mods/harbormaster/pr.svg").size(11).flex_none().text_color(t[PR_TONE[p.state]] ?? t.dim), relatedTip(p))),
  ];
  const focus = () => orch !== "gone" && focusAgent(r.terminal);
  const facts = factsLine(t, r, prs, 12.5, f.att);
  // Not on a finished or put-away run's smaller card; a live card shows it even when narrow.
  const proof = r.phase !== "finished" && !r.away ? claimsSummary(t, r) : null;
  // A stalled run's Ask what's blocking is in its need box.
  const blocking = need ? null : blockingAction(view, t, r, f.att, `card-${r.key}`);
  const comments = addressRows(view, t, r, ctx, f, `card-${r.key}`);
  return v_flex().id(`run-${r.key}`).relative().overflow_hidden().flex_none().gap(8).p(12).pl(16).rounded(10).bg(t.surface)
    .border(1).border_color(need ? t.blocked + "88" : t.border).cursor_pointer()
    .hover((s) => s.bg(t.raised)).on_click(focus)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).bg(runEdge(t, f)))
    .child(cardHeader(view, t, r, f, runMeta(r, f)))
    .when(need, (el) => el.child(needBox(view, t, r, f, ctx, "card")))
    .when(Boolean(facts), (el) => el.child(facts))
    .when(Boolean(r.progress), (el) => el.child(progressLine(t, r, f.att)))
    .children(cardNotes(t, r, f))
    .when(Boolean(blocking), (el) => el.child(h_flex().child(blocking)))
    .when(Boolean(comments), (el) => el.child(comments))
    .when(Boolean(proof), (el) => el.child(h_flex().id(`proof-${r.key}`).flex_wrap().items_center().gap(6).px(2).text_size(11.5).when(Boolean(proof.tip), (e) => e.tooltip(proof.tip))
      .child(div().flex_none().text_size(11).font_semibold().text_color(t.dim).child("Claims"))
      .child(h_flex().flex_wrap().items_center().children(joined(t, proof.parts)))))
    .when(!compact && counts.planned > 0, (el) => el.child(taskStrip(t, r, counts, f.stages)))
    .when(links.length > 0, (el) => el.child(h_flex().flex_wrap().gap(6).children(links)))
    .when(prs.length > 0 && !r.away, (el) => el.child(flowToggle(t, r, `card-${r.key}`)))
    .when(prs.length === 0 && related.length === 0 && r.phase !== "finished" && !compact, (el) => el.child(div().text_size(11).text_color(t.dim).child("No pull request yet")))
    .child(actionRow(view, t, r, orch, closed, counts));
}

// ---- shared by the card and the pane ----

// Status colours, one meaning each: red = you must act (a failure, Needs you); amber = look soon
// (a stall, CI past its usual time, partial or missing proof); cyan = waiting on a reviewer;
// no colour = fine (work going on, CI within its usual time, a wait on the orchestrator). The
// spinner (runDot) says a run works. Green for a pass and green checks (the theme's green,
// apart from done's blue). Amber is the theme's working colour, so no row's edge, tint, pill,
// status text, task strip segment or agent row's stage text uses it for work going on: the task
// strip's Implementing segments are a neutral bright tone (STAGE), and amber there is only
// proof that wants a look. A passed proof marks a done segment (a green underline) rather than
// recolouring done. Herdr's own Agents list is not Harbormaster's and keeps its colours.
export const PASS = (t) => t.ansi2 ?? "#3fa055";
export const AMBER = (t) => t.working;

// Texts joined by dim dots, each in its own colour: [{ text, color?, bold?, el? }]; `el`
// is a ready element (a link) used as is.
function joined(t, items) {
  return items.filter(Boolean).flatMap((x, i) => [
    i > 0 ? div().flex_none().px(5).text_color(t.dim).child("·") : null,
    x.el ?? div().flex_none().when(Boolean(x.color), (e) => e.text_color(x.color)).when(Boolean(x.bold), (e) => e.font_semibold()).child(x.text),
  ]).filter(Boolean);
}

// The facts line, the one prominent line under the header: when the run started and how
// long it has gone, then each of its PRs (a link) with its checks, a one-way door, and its review.
// "Started today 09:28 · finished after 8h 7m · PR #42 open · checks ✓". Null when it has none of them.
// `parts: "live"` (the pane) leaves out the start time and the PRs, which its header and the strip say.
function factsLine(t, r, prs, size = 13, att = null, { parts = "all" } = {}) {
  const items = [];
  if (r.started && parts !== "live") items.push({ el: div().id(`age-${r.key}`).flex_none().tooltip(startedTip(r.started)).child(runAgeText(r)) });
  // The current step and its age, as the Crew shows it, while the run is not finished; the
  // progress line carries its own age (progressLine). A stalled run says so, in amber.
  const live = att && r.phase !== "finished" && !r.away;
  if (live && att.stall) items.push({ text: quietText(att.stall), color: AMBER(t), bold: true });
  if (live && att.step?.text && att.step.text !== r.progress) items.push({ text: stepText(att.step), color: t.muted });
  // Each PR (a link) with its checks, a one-way door and its review; PRs that all say the same
  // as one ("2 PRs open · checks ✓ · Approved by anna"), each one's title and link in its hover.
  for (const x of parts === "live" ? [] : prFacts(prs, { away: Boolean(r.away), oneWay })) {
    if (x.kind === "pr") {
      const p = x.pr;
      items.push({ el: div().id(`fact-pr-${r.key}-${x.i}`).flex_none().cursor_pointer().hover((s) => s.text_color(t.accent)).tooltip(`${p.title ?? ""}\n${p.url}`.trim())
        .on_click((_e, cx) => { cx.stop_propagation(); openUrl(p.url); }).child(x.text) });
    } else if (x.kind === "prs") {
      items.push({ el: div().id(`fact-prs-${r.key}`).flex_none().tooltip(x.prs.map((p) => `${p.number ? `#${p.number} ` : ""}${p.title ?? ""}\n${p.url}`).join("\n")).child(x.text) });
    } else items.push({ text: x.text, color: x.tone === "pass" ? PASS(t) : t[x.tone], bold: x.bold });
  }
  if (items.length === 0) return null;
  return h_flex().flex_wrap().items_center().text_size(size).font_medium().text_color(t.foreground).children(joined(t, items));
}

// The strip's input from what runFacts has: plain data for mergepath.js.
function pathInput(r, f, stages) {
  const rows = hasClaims(r) ? claimRowsOf(r, stages) : null;
  const c = rows ? claimCounts(rows) : null;
  const md = r.proof?.md;
  const reviewed = reviewedState(md, r.reviewedGap);
  const state = md?.checks?.state;
  return {
    phase: r.phase, away: r.away, counts: f.counts, blockedTasks: r.tasks.filter((k) => taskTone(k.state) === "blocked").length,
    claims: c ? { total: c.total, proven: c.proven, accepted: c.accepted, failed: c.fail, look: c.look } : null,
    checks: state === "green" || state === "red" ? state : state ? "pending" : null,
    reviewed, flow: flowState(r, reviewFlows()).flow, prs: f.prs.length,
    allMerged: f.prs.length > 0 && f.prs.every((p) => p.state === "MERGED"),
    next: f.att?.next ? { label: f.att.next.label, who: f.att.next.who ?? [] } : null,
    held: Boolean(f.att?.held), ready: Boolean(f.att?.ready), ci: ciState(f.prs).state,
  };
}

// The path-to-merge strip under the pane's header: each stage with its value and mark, a click on
// one that has a section unfolds it ("Built 3/3 ✓ › Proven 6/6 ✓ › AI review ⚠ 2 behind › Peer review ● you › Merge").
function pathStrip(view, t, r, f, stages) {
  // A stage opens the Claims section, which an old run without claims does not have.
  const stops = mergePath(pathInput(r, f, stages)).map((s) => (s.fold && !hasClaims(r) ? { ...s, fold: null } : s));
  const open = (fold) => { view.folds ??= new Map(); if (fold === "claims") view.folds.set(`pf-${r.key}`, true); };
  const part = (s) => {
    const ask = s.value === "ask" || s.value === "read the proof";
    const label = div().flex_none().child(s.label);
    const value = (c) => (s.value ? div().flex_none().text_color(c).child(s.value) : null);
    const tone = {
      done: [t.muted, t.muted], current: [t.foreground, t.muted], you: [t.foreground, t.muted], look: [t.foreground, AMBER(t)],
      fail: [t.foreground, t.blocked], todo: [t.dim, t.dim],
    }[s.state];
    // Each piece sets its own colour, so a clickable stage's hover goes on every piece (a hover on the
    // stage alone would be overridden by them).
    const hov = (el, n) => (s.fold ? el.id(`path-${s.key}-${r.key}-${n}`).hover((x) => x.text_color(t.accent)) : el);
    const mark = (c, text, bold = false) => div().flex_none().text_color(c).when(bold, (e) => e.font_semibold()).child(text);
    const kids = [label.text_color(tone[0]).when(s.state === "current", (e) => e.font_medium()).when(s.state === "you", (e) => e.font_semibold())];
    if (s.state === "done") kids.push(s.value ? value(t.muted) : null, mark(PASS(t), "✓"));
    else if (s.state === "you") kids.push(ask ? null : value(t.muted), mark(t.blocked, ask ? `● you · ${s.value}` : "● you", true));
    else if (s.state === "look") kids.push(mark(AMBER(t), s.value ? `⚠ ${s.value}` : "⚠"));
    else if (s.state === "fail") kids.push(mark(t.blocked, s.value ? `✗ ${s.value}` : "✗"));
    else if (s.value) kids.push(value(tone[1]));
    return h_flex().id(`path-${s.key}-${r.key}`).flex_none().gap(4).items_center().tooltip(s.tip)
      .when(Boolean(s.fold), (e) => e.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); open(s.fold); cx.notify(); }))
      .children(kids.map((k, n) => (k ? hov(k, n) : null)).filter(Boolean));
  };
  return h_flex().flex_wrap().items_center().gap_y(2).text_size(12.5)
    .children(stops.flatMap((s, i) => [part(s), i < stops.length - 1 ? div().flex_none().px(6).text_color(t.dim).child("›") : null]).filter(Boolean));
}

// A red line under the strip while any PR is a one-way door: the warning the facts line used to carry.
function oneWayLine(t, r, prs) {
  if (!prs.some((p) => p.danger && oneWay(p.danger))) return null;
  return div().id(`oneway-${r.key}`).text_size(12.5).font_semibold().text_color(t.blocked).child("one-way door");
}

// The orchestrator's own progress note: under the facts, smaller and muted, since it is in
// its words and can lag behind. While it is the run's current step, with that step's age.
const progressLine = (t, r, att = null) => div().text_size(11.5).text_color(t.muted)
  .child(att?.step?.text === r.progress && r.phase !== "finished" && !r.away ? stepText(att.step) : r.progress);

// The claims verdict (claims.js claimsVerdict) as coloured parts, for the card and the Claims
// section's fold line; an old run (no claims) has only its red checks, if any. Null when there is
// nothing to say. `stages` is stagesOf()'s (null: by plan.md's states).
function claimsSummary(t, r, stages = null) {
  const color = { pass: PASS(t), fail: t.blocked, amber: AMBER(t), muted: t.muted, dim: t.dim };
  const paint = (p) => ({ text: p.text, bold: p.bold, color: p.tone ? color[p.tone] : null });
  if (!hasClaims(r)) {
    const red = r.proof.md?.checks?.state === "red" ? checksLine(r.proof.md) : null;
    return red ? { parts: [paint(red)], tip: red.tip } : null;
  }
  const rows = claimRowsOf(r, stages);
  const v = claimsVerdict(rows, { tier: r.proof.tier?.tier, md: r.proof.md, reviewed: reviewedLine(r.proof.md, r.reviewedGap) });
  return { parts: v.parts.map(paint), rows, tip: v.tip || null };
}

// What was clicked on a claim row (Accept, Unaccept) and not read back from the run's files yet
// (claims.js withSaid). Shared by the pane and the card, so both show it at once. An Ask to prove
// is an inbox message: its "asked…" comes from inbox.js (claims.js withAsked).
export const said = new Map();

const isFinished = (r) => r.phase === "finished" || Boolean(r.away);

// Each task's stage name from stagesOf()'s, or null for none (claims.js falls back to plan.md's states).
const stageNames = (r, stages) => (stages ? r.tasks.map((_, i) => stages[i]?.stage ?? null) : null);

// The run's claims (claims.js claimRows) with the clicks its files don't show yet.
const claimRowsOf = (r, stages = null) => withAsked(withSaid(claimRows(r.proof, r, stageNames(r, stages), isFinished(r)), said, r.key, r.proof), r);

// ---- one run on its own, as the pane pinned beside its orchestrator ----

// Every top-level section of the pane is one lightly raised block, so they read as separate things.
// The rows inside (claims, PRs) are a shade brighter (raised + "88") and stand out from it.
const boxed = (t, el) => el.p(8).rounded(8).bg(t.raised + "33");

const section = (t, title, ...rest) => boxed(t, v_flex().gap(4))
  .child(h_flex().gap(6).px(2).items_center().text_size(11).font_semibold().text_color(t.dim).child(title)
    .children(rest.filter(Boolean).map((x) => div().font_normal().child(x))));

// Folds with a header (Claims, Decisions, Tokens) look the same: a dim chevron, the section's
// name in semibold, then a one-line summary in normal text; colour only on status words. Open state per key in
// view.folds, closed by default and not persisted.
export const isOpen = (view, key) => Boolean(view.folds?.get(key));
// `title`: a header like Decisions', the section's name in semibold text ahead of the summary,
// with no small grey label above.
function foldLine(view, t, key, tip, items, onOpen = null, title = null) {
  const open = isOpen(view, key);
  return h_flex().id(`fold-${key}`).gap(6).px(2).items_center().min_w(0).rounded(4).cursor_pointer().text_size(11.5).text_color(t.foreground)
    .hover((s) => s.bg(t.hover)).tooltip(tip)
    .on_click((_e, cx) => { cx.stop_propagation(); view.folds ??= new Map(); view.folds.set(key, !open); if (!open) onOpen?.(); cx.notify(); })
    .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
    .child(h_flex().flex_1().min_w(0).flex_wrap().items_center().children(joined(t, [title && { el: div().flex_none().font_semibold().text_color(t.foreground).child(title) }, ...items])));
}

// A PR as a row with room to spare: its whole title, then repo, checks and review.
// `away`: the run is parked or closed, so failing checks are dim, not red (prfacts.js prFacts).
function prDetail(t, pr, i, related = false, away = false) {
  const tone = PR_TONE[pr.state] ?? "dim";
  const c = pr.checks ?? {};
  const checkText = c.fail ? `✗ ${c.fail} failing` : c.pending ? `… ${c.pending} running` : c.pass ? `✓ ${c.pass} checks` : null;
  const checkColor = c.fail ? (away ? t.dim : t.blocked) : c.pending ? t.dim : PASS(t);
  const review = reviewText(pr);
  const state = prStateText(pr);
  return h_flex().id(`prd-${related ? "rel" : "own"}-${i}-${pr.url}`).gap(8).items_start().p(8).rounded(7).bg(t.raised + "88").cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(pr.url).on_click((_e, cx) => { cx.stop_propagation(); openUrl(pr.url); })
    .child(svg("mods/harbormaster/pr.svg").size(14).flex_none().mt(1).text_color(t[tone] ?? t.dim))
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(12.5).text_color(t.foreground).child(pr.title ?? pr.url))
      .child(h_flex().flex_wrap().gap_x(10).text_size(11).text_color(t.dim)
        .child(div().child(`${pr.repo ?? shortRef(pr.url)}${pr.number ? ` #${pr.number}` : ""}`))
        .when(Boolean(checkText), (el) => el.child(div().text_color(checkColor).child(checkText)))
        .when(Boolean(review), (el) => el.child(div().text_color(review[1] === "done" ? PASS(t) : t[review[1]]).child(review[0]))))
      // Merge danger lives here only, in full: red for a one-way door.
      .when(Boolean(pr.danger), (el) => el.child(div().id(`danger-${pr.url}`).text_size(11).text_color(oneWay(pr.danger) ? t.blocked : t.muted)
        .child(`Merge danger: ${pr.danger}`))))
    .when(Boolean(state), (el) => el.child(pill(t, state, tone)));
}

// ---- proof ----

// The colour of a claim's pill (claims.js claimPill's tone).
const PILL_COLOR = { pass: PASS, fail: (t) => t.blocked, amber: AMBER, dim: () => "dim", muted: () => "muted" };

// ---- the run's level tags ----

// A run's tags, as the pane header and its Crew row show them: its type, then its autonomy and,
// with a tier, its proof tier. `r` may be a stand-in for a run without a directory
// ({type, autonomy} from its terminal's labels): its tags then only say what they are.
// `short`, for the narrow Crew block, writes a pending request "T3…" instead of "T3 requested…".
// The type tag on its own, apart from the level tags.
export const runTypeTag = (t, r, id) => (r.type ? typeTag(t, r.type, `type-${id}`) : null);
export function levelTags(view, t, r, id, short = false) {
  return [
    levelTag(view, t, r, "autonomy", `auto-${id}`, short),
    r.proof?.tier ? levelTag(view, t, r, "tier", `tier-${id}`, short) : null,
  ].filter(Boolean);
}

// An autonomy ("L1") or proof tier ("T2") tag. Resting the pointer on it opens a card that
// lists every level with its definition, the run's own highlighted; clicking another asks the
// orchestrator to change it (inbox.js: a message in the run's inbox). Until
// status.json or plan.md shows the new level, the tag reads "T3 requested…": from the request
// still unread in the inbox (r.pending), so it survives a reload, and from the click itself
// until the next read sees that message (at most 15 s, should the orchestrator be quicker).
function levelTag(view, t, r, kind, id, short = false) {
  const cur = kind === "autonomy" ? r.autonomy : r.proof.tier.tier;
  const label = (l) => (kind === "autonomy" ? l : `T${l}`);
  // The click's own mark goes once the run's files show the request, or the level itself, or
  // after 15 s (inbox.js askedLevel).
  const pending = askedLevel(r, kind, cur);
  // A request waits on the orchestrator, not on you: no colour, its "requested…" says it.
  const tag = div().flex_none().text_size(10).font_semibold().px(5).rounded(4).bg(t.raised)
    .text_color(pending !== null ? t.foreground : kind === "autonomy" && cur === "L0" ? t.dim : t.muted)
    .child(pending !== null ? `${label(pending)}${short ? "…" : " requested…"}` : label(cur));
  const canAsk = Boolean(r.dir && r.localTerminal);
  const notes = kind === "tier" ? [r.proof.tier.byUser && "Set by user", r.tasks.some((k) => !k.proof) && `${plural(r.tasks.filter((k) => !k.proof).length, "task")} not scoped`] : [];
  const choice = (c) => {
    const ask = canAsk && !c.current && !c.pending;
    return h_flex().id(`${id}-${c.label}`).gap(8).items_start().px(6).py(4).rounded(5)
      .when(c.current, (el) => el.bg(t.selected))
      .when(ask, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => {
        cx.stop_propagation();
        // Written but not woken: the request is in the inbox, so it stays requested.
        askClick(view, cx, r, "level", { kind, level: c.level }, { asks: [{ key: kind, item: { level: c.level, current: cur } }] });
      }))
      .child(div().flex_none().w(20).font_semibold().text_color(c.current ? t.foreground : t.muted).child(c.label))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_color(c.current ? t.foreground : t.muted).child(c.text))
        .when(c.current || c.pending, (el) => el.child(div().text_size(10.5).text_color(t.dim)
          .child(c.pending ? "Requested, waiting for the orchestrator" : "This run"))));
  };
  return HoverCard.new(id).anchor("top_left").open_delay(300)
    .trigger(tag)
    .content(v_flex().w(320).p(6).gap(2).rounded(8).bg(t.popover ?? t.surface).border(1).border_color(t.border).shadow_lg().text_size(11.5)
      .child(div().px(6).pt(2).pb(4).text_size(11).font_semibold().text_color(t.dim)
        .child(kind === "autonomy" ? "Autonomy: how much the orchestrator decides itself" : "Proof tier: what proves a claim (its bar, unless it names its own)"))
      .children(levelChoices(kind, cur, pending).map(choice))
      .children(notes.filter(Boolean).map((n) => div().px(6).text_size(10.5).text_color(t.dim).child(n)))
      .child(div().px(6).pt(4).text_size(10.5).text_color(t.dim)
        .child(canAsk ? "Click a level to ask the orchestrator to change it" : "Its orchestrator isn't known here, so it can't be changed from here")));
}

// A path under the run as a link that opens on this machine; for a run on another machine
// it is plain text, since nothing here can open a file there.
function pathLink(t, r, id, rel, label) {
  if (r.machine) return div().text_size(11).text_color(t.dim).tooltip(`On ${r.machine}`).child(`${label} (${r.dir}/${rel})`);
  return h_flex().id(id).gap(4).px(6).h(20).items_center().rounded(5).bg(t.raised).text_size(11).text_color(t.muted).cursor_pointer()
    .hover((s) => s.text_color(t.foreground)).tooltip(`Open ${r.dir}/${rel}`)
    .on_click((_e, cx) => { cx.stop_propagation(); openUrl(`${r.dir}/${rel}`); })
    .child(div().child("▤")).child(label);
}

// "Decisions": the heading row is the fold, at the top, with its chevron and the counts
// ("Decisions · 57 · 45 by the orchestrator, 12 from you"), in normal text with only the
// chevron and the counts muted. Folded, that row is all of it. Unfolded, every decision as its
// one-line title (yours marked "You"); clicking one shows all of it and its reason. A line that
// did not parse shows its raw text.
function decisionsSection(view, t, r) {
  const key = `dec-${r.key}`, open = isOpen(view, key);
  // Unfolding marks every line seen (telling.js); the lines new then stay marked while it is
  // open, by the seen time from before (view.decWas).
  const seen = decisionsSeen(r);
  const fresh = new Set(newDecisions(r.decided, open ? view.decWas?.get(key) ?? seen : seen));
  const since = !open ? newSinceText(fresh.size) : null;
  const you = r.decided.filter((d) => d.by === "user").length, orch = r.decided.length - you;
  const counts = [orch > 0 && `${orch} by the orchestrator`, you > 0 && `${you} from you`].filter(Boolean).join(", ");
  const title = (d) => `${d.by === "user" ? "You · " : ""}${d.topic ? `${d.topic}: ${d.decision}` : d.decision}`;
  const when = (d) => div().flex_none().w(34).text_color(t.dim).child(d.at ? ago(d.at).replace(" ago", "") : "—");
  // One line each, cut to fit; a click shows its whole title and its reason under it.
  // Every row clicks, since any title can be cut, reason or not. Keyed on the line itself, not
  // its place: a new decision moves every row down one.
  const line = (d, i) => {
    const id = `${r.key}-${d.raw}`, more = view.decRows?.has(id);
    return h_flex().id(`decl-${r.key}-${i}`).gap(8).items_start().px(2).rounded(4).text_size(11.5)
      .cursor_pointer().hover((st) => st.bg(t.hover)).tooltip(more ? "Show one line" : d.why ? "Show all of it and the reason" : "Show all of it")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        view.decRows ??= new Set();
        if (more) view.decRows.delete(id); else view.decRows.add(id);
        cx.notify();
      })
      .child(fresh.has(d) ? div().flex_none().w(6).h(6).mt(5).rounded(3).bg(t.accent).tooltip("New since you last looked") : div().flex_none().w(6))
      .child(when(d))
      .child(v_flex().flex_1().min_w(0)
        .child(div().when(!more, (el) => el.truncate()).text_color(t.foreground).when(fresh.has(d), (el) => el.font_semibold()).child(title(d)))
        .when(Boolean(more && d.why), (el) => el.child(div().text_size(11).text_color(t.dim).child(d.why))));
  };
  return boxed(t, v_flex().gap(4))
    .child(h_flex().id(`fold-${key}`).gap(6).px(2).items_center().min_w(0).rounded(4).cursor_pointer().text_size(11)
      .hover((st) => st.bg(t.hover)).tooltip(open ? "Fold the decisions" : "Show every decision")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        view.folds ??= new Map();
        view.folds.set(key, !open);
        view.decWas ??= new Map();
        if (open) view.decWas.delete(key);
        else { view.decWas.set(key, seen); markDecisionsSeen(r); }
        cx.notify();
      })
      .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().flex_none().font_semibold().text_color(t.foreground).child("Decisions"))
      .child(div().flex_none().text_color(t.muted).child(`· ${r.decided.length}`))
      .when(Boolean(since), (el) => el.child(div().flex_none().text_color(t.accent).font_semibold().child(`· ${since}`)))
      .child(div().min_w(0).truncate().text_color(t.muted).child(counts ? `· ${counts}` : "")))
    .when(open, (el) => el.children(r.decided.map(line)));
}

// "Tokens": what the run has used, across its orchestrator and every agent it ran. One line:
// fresh tokens (input, output and cache writes, as in the headline) in cyan, the output part of
// them in magenta, cache reads in grey and the total in bold; colours apart from the status ones.
// It folds out to each agent's bar, scaled to the run's total, stacked fresh over cache reads,
// with the exact numbers on hover.
function tokensSection(view, t, r) {
  const FRESH = t.ansi6 ?? t.accent, OUT = t.ansi5 ?? "#b07cd8";
  const { total, input, output, cacheRead, cacheWrite, byAgent, updated } = r.tokens;
  const n = (v) => v.toLocaleString("en");
  const fresh = (x) => x.input + x.output + x.cacheWrite;
  const tip = (x) => `fresh ${n(fresh(x))} (in ${n(x.input)}, out ${n(x.output)}, cache write ${n(x.cacheWrite)}) · cache read ${n(x.cacheRead)}`;
  const pct = (v) => `${((100 * v) / total).toFixed(2)}%`;
  const key = `tok-${r.key}`, open = isOpen(view, key);
  const row = (a) => h_flex().id(`tok-${r.key}-${a.name}`).gap(8).items_center().px(2).h(18).text_size(11.5)
    .tooltip(a.split ? `${a.name}: ${tip(a)}` : `${a.name}: ${n(a.total)} tokens`)
    .child(div().flex_none().w(96).truncate().text_color(a.name === "orchestrator" ? t.foreground : t.muted).child(a.name))
    .child(div().flex_1().min_w(0).h(5).rounded(3).bg(t.raised).overflow_hidden().flex()
      // A count from before the split has only a total: all of it fresh.
      .child(div().h_full().flex_none().bg(FRESH).w(pct(a.split ? fresh(a) : a.total)))
      .child(div().h_full().flex_none().bg(t.dim).w(pct(a.split ? a.cacheRead : 0))))
    .child(div().flex_none().w(44).text_color(t.dim).child(tokenText(a.total)));
  // A count from before the split has only a total: show just that.
  const split = input + output + cacheWrite + cacheRead > 0;
  const items = !split ? [{ text: `total ${tokenText(total)}`, bold: true }] : [
    { text: `fresh ${tokenText(input + output + cacheWrite)}`, color: FRESH },
    { text: `of it out ${tokenText(output)}`, color: OUT },
    { text: `cache read ${tokenText(cacheRead)}`, color: t.muted },
    { text: `total ${tokenText(total)}`, bold: true },
  ];
  const head = [updated && { el: div().flex_none().text_color(t.dim).child(`counted ${ago(updated)}`) }];
  return boxed(t, v_flex().gap(4))
    .child(byAgent.length > 0 ? foldLine(view, t, key, `${tokenDetail(r.tokens)}\n${open ? "Hide" : "Show"} each agent's tokens`, [...items, ...head], null, "Tokens")
      : h_flex().id(key).px(2).flex_wrap().items_center().text_size(11.5).text_color(t.foreground).tooltip(tokenDetail(r.tokens))
        .children(joined(t, [{ text: "Tokens", bold: true }, ...items, ...head])))
    .when(Boolean(r.budget), (el) => el.child(div().id(`budget-${r.key}`).px(2).text_size(11).text_color(overBudget(r) ? t.blocked : t.dim)
      .tooltip("A soft budget: crossing it asks you whether to continue, compact or stop; nothing stops by itself")
      .child(`${overBudget(r) ? "Over" : "Under"} its soft budget of ${tokenText(r.budget)} tokens`)))
    .when(open, (el) => el.children(byAgent.map(row)));
}

// The Claims section: what the run lets you do, each claim with the evidence that shows it.
// The verdict is the fold line ("3 of 4 proven · not yet: Drag to reorder"); folded, only the
// claims worth a look (failed, partial, below their bar, unproven) show under it; unfolded, every
// claim in plan order. A row is its id, its words, its evidence (thumbnails that open the viewer,
// a ▶ clip for the system player, "4 tests ✓" with their names on hover) and its pill; clicking
// it adds what the pill doesn't say: the result's why, where the claim comes from (AC, tasks, bar)
// and, unless it is proven or still being proved, Accept and Ask to prove (or Unaccept). Each fact
// once: the status is the pill's alone. The whole-branch checks are one line under the claims
// (dim while still running). An old run (no `## Claims` in plan.md) shows just that checks line.
// Not persisted.
function claimsSection(view, t, r, stages) {
  const { md } = r.proof;
  const checks = checksLine(md);
  const checksRow = checks && div().id(`pf-checks-${r.key}`).px(2).truncate().text_size(11.5)
    .text_color(checks.tone === "pass" ? PASS(t) : checks.tone === "fail" ? t.blocked : t.dim).tooltip(checks.tip).child(checks.text);
  // Quiet like the checks line; amber once commits came after the last review.
  const rev = reviewedLine(md, r.reviewedGap, { finished: isFinished(r), claims: hasClaims(r) });
  const reviewRow = rev && div().id(`pf-reviewed-${r.key}`).px(2).truncate().text_size(11.5)
    .text_color(rev.tone === "amber" ? AMBER(t) : t.dim).tooltip(rev.tip).child(rev.text);
  if (!hasClaims(r)) {
    // No fold, but the same header line as with claims: "Claims · <checks>".
    return boxed(t, v_flex().gap(4)).child(h_flex().gap(6).px(2).items_center().min_w(0).text_size(11.5).text_color(t.foreground)
      .child(div().flex_none().font_semibold().child("Claims"))
      .child(div().flex_none().text_color(t.dim).child("·"))
      .child(checksRow ?? div().text_color(t.dim).child("No claims: planned before claims")));
  }
  const s = claimsSummary(t, r, stages);
  const finished = isFinished(r);
  const key = `pf-${r.key}`, open = isOpen(view, key);
  const row = (k) => {
    const id = `${r.key}-${k.id}`;
    const more = view.proofRows?.has(id);
    const p = claimPill(k, finished);
    const failing = k.tests.filter((x) => !x.ok).length;
    const tests = k.tests.length > 0 && div().id(`pf-tests-${id}`).flex_none().text_size(11)
      // Red only when the pill doesn't already say fail.
      .text_color(failing && k.state !== "fail" ? t.blocked : t.dim).tooltip(k.tests.map((x) => `${x.ok ? "✓" : "✗"} ${x.name}`).join("\n"))
      .child(failing ? `${failing} of ${plural(k.tests.length, "test")} ✗` : `${plural(k.tests.length, "test")} ✓`);
    const where = [k.ac && `AC ${k.ac}`, k.tasks.length > 0 && `tasks ${k.tasks.join(", ")}`, k.tier !== null && `bar T${k.tier}`].filter(Boolean).join(" · ");
    const actions = claimActions(k);
    return v_flex().id(`pf-${id}`).gap(4).px(8).py(5).rounded(7).bg(t.raised + "88").cursor_pointer()
      .hover((st) => st.bg(t.hover)).on_click((_e, cx) => {
        cx.stop_propagation();
        view.proofRows ??= new Set();
        if (more) view.proofRows.delete(id); else view.proofRows.add(id);
        cx.notify();
      })
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().w(22).text_size(11).font_semibold().text_color(t.dim).child(k.id))
        .child(div().flex_1().min_w(0).when(!more, (e) => e.truncate()).text_size(12).text_color(t.foreground).child(k.name))
        .when(k.files.length > 0, (e) => e.child(thumbs(view, t, r, k.id, k.files)))
        .when(Boolean(tests), (e) => e.child(tests))
        .when(k.asked && !more, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.muted).child("asked…")))
        .child(pill(t, p.text, PILL_COLOR[p.tone](t))))
      .when(more, (el) => el
        .when(Boolean(k.why), (e) => e.child(div().pl(30).text_size(11.5).text_color(t.muted).child(k.why)))
        .when(Boolean(where), (e) => e.child(div().pl(30).text_size(11).text_color(t.dim).child(where)))
        .when(Boolean(k.accepted), (e) => e.child(div().pl(30).text_size(11).text_color(t.dim)
          .child(`You accepted it as it is${k.accepted.at ? ` ${ago(Date.parse(k.accepted.at))}` : ""}`)))
        .when(actions.length > 0, (e) => e.child(h_flex().gap(6).pl(30).pt(2).items_center().children(actions.map((a) => proofAction(view, t, r, k, a))))));
  };
  const shown = open ? s.rows : s.rows.filter(worthALook);
  return boxed(t, v_flex().gap(4))
    .child(foldLine(view, t, key, `${s.tip ? `${s.tip}\n` : ""}${open ? "Show only the claims worth a look" : `Show every claim (${s.rows.length})`}`, s.parts,
      // Unfolding the Claims section is reading it.
      () => markProofRead(r), "Claims"))
    .children(shown.map(row))
    .when(Boolean(checksRow), (el) => el.child(checksRow))
    .when(Boolean(reviewRow), (el) => el.child(reviewRow))
    .when(open && Boolean(md), (el) => el.child(h_flex().px(2).pt(2).child(pathLink(t, r, `pf-md-${r.key}`, "proof.md", "proof.md"))));
}

// A claim row's button: Accept (Harbormaster records it in proof-accepted.json itself, so it works
// with the orchestrator gone), Unaccept, Ask to prove (a "prove C<n> to T<n>: …" message in the
// run's inbox), or "asked…" while that waits. An Accept or Unaccept shows at once (`said`), before
// the next read of the run's files; an ask is marked asked in inbox.js.
const PROOF_ACTION = {
  accept: { label: "Accept", tip: "Accept this claim as it is: it stops needing a look, until its result changes" },
  unaccept: { label: "Unaccept", tip: "Take the acceptance back: it needs a look again" },
  ask: { label: "Ask to prove", tip: "Ask the orchestrator to prove this claim to its bar (a message in its inbox)" },
};
// `button` draws it (actionButton's arguments): the sidebar's box passes a quieter one.
export function proofAction(view, t, r, k, a, button = actionButton) {
  if (a === "asked") return div().id(`pfx-${r.key}-${k.id}`).text_size(11).text_color(t.muted).tooltip("Waiting for the orchestrator to prove it").child("asked…");
  const line = claimResultLine(k);
  const { label, tip } = PROOF_ACTION[a];
  return button(t, `pf${a}-${r.key}-${k.id}`, label, tip, (cx) => {
    if (a === "ask") return askClick(view, cx, r, "proof", { row: k }, { asks: [{ key: k.id, item: k }] });
    const key = `${r.key}:${k.id}`;
    said.set(key, { kind: a, line, at: Date.now() });
    view.actionError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (a === "accept") await acceptProof(r, k);
        else await unacceptProof(r, k);
      } catch (e) {
        said.delete(key);
        view.actionError = `${r.branch}: ${e?.message ?? e}`;
      }
      view.redraw = true;
      try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
      try { await view.load(cx); } catch { /* the next refresh shows it */ }
    }, { owner: null });
  });
}

function issueRow(t, url) {
  return h_flex().id(`isd-${url}`).gap(8).items_center().h(28).px(8).rounded(7).bg(t.raised + "88").cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(url).on_click((_e, cx) => { cx.stop_propagation(); openUrl(url); })
    .child(div().flex_none().w(14).text_color(t.muted).child("◎"))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(shortRef(url)));
}

// The connectors before a nested worker, drawn as lines (as Herdr's Agents list does) so they join
// across the 4px gap between rows: a cell per level, 20px wide, its vertical under the parent's
// icon centre (7px in), bending at mid-height into an arm that reaches the child's icon.
const TREE_CELL = 20, ROW_H = 24, ROW_GAP = 4;
function treeLines(t, { depth, last, guides }) {
  if (depth === 0) return [];
  const cell = () => div().relative().flex_none().w(TREE_CELL).h(ROW_H);
  const vertical = (h) => div().absolute().left(7).top(-ROW_GAP).h(h).w(1).bg(t.dim);
  const through = guides.map((more) => (more ? cell().child(vertical(ROW_H + ROW_GAP)) : cell()));
  const elbow = cell().child(vertical(last ? ROW_H / 2 + ROW_GAP : ROW_H + ROW_GAP))
    .child(div().absolute().left(7).top(ROW_H / 2).w(TREE_CELL - 8).h(1).bg(t.dim));
  return [...through, elbow];
}

// One of the run's agents: its name, the task it works on and that task's stage, when
// its name says (impl-<prefix>-<task>); a helper it started (a dev server) indented below it.
function workerRow(t, w, ctx, work, line) {
  const nested = line.depth > 0;
  const status = agentStatus(w, ctx);
  const color = work?.stage ? STAGE[work.stage].color(t) : null;
  return h_flex().id(`wk-${w.address}`).gap(8).items_center().h(24).px(8).rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); focusAgent(w.address); })
    .tooltip(work?.task.about ? `${w.name ?? w.address}: ${work.task.about}` : "Show this agent")
    .children(treeLines(t, line))
    .child(programIcon(programOf(w, ctx), 14, nested ? t.muted : t.foreground))
    .child(div().flex_none().text_size(12).text_color(nested ? t.muted : t.foreground).child(w.name ?? w.address))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim)
      .child(work ? [work.task.id, work.task.name].filter(Boolean).join(" ") : ""))
    .when(Boolean(color), (el) => el.child(div().flex_none().text_size(11).text_color(color).child(STAGE[work.stage].label)))
    .map(withUsage(t, `wk-${w.address}`, liveUsage(w.address), "This agent and its commands"))
    .child(statusDot(t, status));
}

// The run's card laid out for a pane of its own: the same header, need, progress and
// buttons, then its PRs with their whole titles, issues and related PRs one per row,
// the tasks as a bar, counted by stage, and the agents working on it.
function runDetail(view, t, r, ctx) {
  const f = runFacts(r, ctx);
  const { orch, closed, need, counts, prs, related, workers, stages } = f;
  // Each agent's task and that task's stage, by address.
  const workOf = new Map(stages.flatMap(({ agents, stage }, i) => agents.map((a) => [a.agent.address, { task: r.tasks[i], stage }])));
  const facts = factsLine(t, r, prs, 13, f.att, { parts: "live" });
  const strip = pathStrip(view, t, r, f, stages);
  const door = oneWayLine(t, r, prs);
  const notes = cardNotes(t, r, f, false);
  const blocking = need ? null : blockingAction(view, t, r, f.att, `pane-${r.key}`);
  const comments = addressRows(view, t, r, ctx, f, `pane-${r.key}`);
  // Most important first: who and what, whether it needs you, when and its PR, then the PR
  // itself, proof, tasks, decisions and agents; tokens last, since they are about cost.
  return v_flex().id(`run-${r.key}`).relative().overflow_hidden().flex_none().gap(14).p(14).pl(18).rounded(10).bg(t.surface)
    .border(1).border_color(need ? t.blocked + "88" : t.border)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).bg(runEdge(t, f)))
    .child(div().id(`head-${r.key}`).cursor_pointer().on_click(() => orch !== "gone" && focusAgent(r.terminal))
      .child(cardHeader(view, t, r, f, runMeta(r, f), r.started ? runAgeText(r) : null)))
    .child(v_flex().gap(4).child(strip).when(Boolean(door), (e) => e.child(door)))
    .when(need, (el) => el.child(needBox(view, t, r, f, ctx, "pane")))
    .when(Boolean(facts) || Boolean(r.progress) || notes.length > 0 || Boolean(blocking) || Boolean(comments), (el) => el.child(v_flex().gap(4)
      .when(Boolean(facts), (e) => e.child(facts))
      .when(Boolean(r.progress), (e) => e.child(progressLine(t, r, f.att)))
      .children(notes)
      .when(Boolean(blocking), (e) => e.child(h_flex().pt(2).child(blocking)))
      .when(Boolean(comments), (e) => e.child(div().pt(2).child(comments)))))
    // Who reviews means nothing before there is a PR to review: the toggle comes with the first.
    .child(section(t, prs.length ? `Pull requests · ${prs.length}` : "Pull requests", r.away || !prs.length ? null : flowToggle(t, r, `pane-${r.key}`))
      .children(prs.map((p, i) => prDetail(t, p, i, false, Boolean(r.away))))
      .when(prs.length === 0, (el) => el.child(div().px(2).text_size(11.5).text_color(t.dim).child(r.phase === "finished" ? "None" : "No pull request yet"))))
    .when(r.issues.length + related.length > 0, (el) => el.child(section(t, "Issues and related PRs")
      .children(r.issues.map((url) => issueRow(t, url)))
      .children(related.map((p, i) => prDetail(t, p, i, true, Boolean(r.away))))))
    .when(hasClaims(r) || Boolean(r.proof.md?.checks) || Boolean(r.proof.md?.reviewed?.length), (el) => el.child(claimsSection(view, t, r, stages)))
    .when(counts.planned > 0 || r.tasks.length > 0, (el) => el.child(section(t, "Tasks", tasksText(r, counts, stages))
      .child(div().px(2).pb(2).child(taskStrip(t, r, counts, stages, false)))))
    .when(r.decided.length > 0, (el) => el.child(decisionsSection(view, t, r)))
    .when(workers.length > 0, (el) => el.child(section(t, `Agents · ${workers.length}`)
      .children(workerTree(workers, r.terminal).map((line) => workerRow(t, line.w, ctx, workOf.get(line.w.address), line)))))
    .when(Boolean(r.tokens), (el) => el.child(tokensSection(view, t, r)))
    .child(actionRow(view, t, r, orch, closed, counts));
}

// Adds or removes a Harbormaster pane beside an agent: the runs overview beside the
// captain, or one run's card beside its orchestrator (`run`). Shown greyed out, with the
// reason, while the agent's terminal is not on screen.
function pinButton(t, id, spot, { run = null, labelled = false } = {}) {
  if (!spot) return div();
  const who = run ? "orchestrator" : "captain";
  const what = run ? "this run's card" : "the runs";
  const usable = Boolean(spot.pinned || spot.pane);
  const tip = spot.pinned ? `Close the Harbormaster pane beside the ${who}`
    : usable ? `Keep ${what}${run ? " (PRs, related PRs, issues, tasks)" : ""} open as a pane beside the ${who}`
    : `The ${who}'s terminal isn't on screen. Show its tab, then pin.`;
  return h_flex().id(id).flex_none().gap(5).items_center().px(labelled ? 8 : 4).h(22).rounded(5).tooltip(tip)
    .text_size(11).text_color(spot.pinned ? t.accent : t.dim).opacity(usable ? 1 : 0.45)
    .when(usable, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .on_click((_e, cx) => { cx.stop_propagation(); togglePin(spot, run ? runProps(run) : undefined); })
    .child(svg("mods/harbormaster/pin.svg").size(13))
    .when(labelled, (el) => el.child(spot.pinned ? "Unpin" : `Pin beside ${who}`));
}

// Whether a run's card can open beside its orchestrator: the orchestrator is there.
export const cardBesideOrchestrator = (r, orch) => Boolean(r?.terminal) && orch !== "gone" && !r.away;

// The pin for a run's card beside its orchestrator, while the orchestrator is there.
const runPin = (t, id, r, orch) => (cardBesideOrchestrator(r, orch) ? pinButton(t, id, paneBeside(r.terminal), { run: r }) : div());

// What the captain watches, from stats(): "watching 2 runs · 1 finished" (crewrows.js watchingText).
export const watchedText = (s) => watchingText(s.live.length, s.docked.length);

export function captainStrip(view, t, ctx, s) {
  const watched = watchedText(s);
  const cap = captainOf(ctx);
  if (!cap.terminal) return h_flex().flex_none().gap(8).p(10).rounded(10).border(1).border_color(t.border).text_size(12).text_color(t.dim)
    .items_center().child(CAPTAIN).child(div().flex_1().child("No captain running."))
    .child(div().id("start-captain").flex_none().px(10).h(24).rounded(6).flex().items_center().bg(t.raised).text_color(t.foreground).cursor_pointer()
      .hover((st) => st.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); openStartCaptain(); }).child("Start captain"));
  return h_flex().id("captain").flex_none().gap(10).p(10).px(12).rounded(10).bg(t.accent + "18").border(1).border_color(t.accent + "55")
    .items_center().cursor_pointer().hover((s) => s.bg(t.accent + "26"))
    .on_click(() => focusAgent(cap.terminal.address))
    .child(div().text_size(18).child(CAPTAIN))
    .child(v_flex().flex_1().min_w(0)
      .child(div().font_semibold().text_size(13).text_color(t.foreground).child("Captain"))
      .child(div().text_size(11.5).text_color(cap.watching ? t.muted : t.blocked)
        .child(cap.watching ? `${watched[0].toUpperCase()}${watched.slice(1)}` : "Watcher is not running — ask the captain to watch")))
    .child(pinButton(t, "pin-captain", captainPane(ctx), { labelled: true }))
    .map(withContext(view, t, "captain", cap.terminal.address))
    .child(statusDot(t, agentStatus(cap.terminal, ctx)));
}

// Sends an answer to an item of the queue. A captain decision goes to the captain, typed
// into its input, when it is there; otherwise, and for a run's question, to the run's inbox
// (inbox.js, the answer kind), which wakes its orchestrator. Marks the item answered (inbox.js
// asked) before the write, so a second click meanwhile is ignored.
// Returns false when there is nowhere to send it.
export function sendAnswer(view, it, text, cx, option = false) {
  const cap = captainOf(facts()).terminal;
  if (it.kind === "decision" && cap) {
    replyToCaptain(cap.address, it.decision, text);
    return true;
  }
  const run = it.run;
  if (!run?.localTerminal || noAnswer(it)) return false;
  const key = it.id;
  // The captain isn't there to clear its decision, so it goes with the answer.
  const drop = async () => { if (it.kind === "decision") await dropDecision(it.decision).catch(() => {}); };
  // The budget question's Compact button compacts the orchestrator first (never a typed reply).
  const compact = option && isCompact(text) && isBudgetQuestion(it);
  askClick(view, cx, run, "answer", { title: it.title, answer: text }, {
    asks: [{ key, item: it }],
    via: compact ? async () => { await compactRun(run, it.title, text); return { outcome: "sent" }; } : null,
    after: drop,
    // Written but the wake failed: the answer is in the inbox, so it stays answered and
    // a captain decision still goes (else each click would write another message).
    onError: async (e) => {
      if (e?.inInbox) await drop();
      else unmarkAsked(run, "answer", key);
    },
  });
  return true;
}

// Sends the inline reply as the answer to the item being replied to.
export function submitReply(view, cx) {
  const text = view.reply.value().trim();
  // Ask for changes on a ready run (changesButton): its own message, not an answer.
  if (view.replying?.startsWith("changes:")) return sendChanges(view, view.replying.slice(8), text, cx);
  // A need box's Reply answers the same item (question.js replyId).
  const id = replyItem(view.replying);
  const it = decisionQueue(view.runs, view.decisions, facts()).find((x) => x.id === id);
  if (!text || !it || !sendAnswer(view, it, text, cx)) return;
  view.reply.set_value("");
  view.replying = null;
  cx.notify();
}

// Writes the user's changes to the run's inbox (inbox.js); the field closes once it is written.
function sendChanges(view, key, text, cx) {
  const run = view.runs.find((x) => x.key === key);
  if (!text || !run) return;
  askClick(view, cx, run, "changes", { text }, {
    before: () => { view.reply.set_value(""); view.replying = null; },
    notes: {
      waits: "the changes wait in its inbox until the run is resumed",
      blocked: "its orchestrator is blocked on a dialog; it reads the changes once that is answered",
      sent: "changes sent to its orchestrator",
    },
  });
}

// A gone or lost orchestrator: an answer only waits in its inbox, and nothing is typed into its terminal.
const runGone = (run) => orchestratorState(run, facts()) === "gone";

// Why an item can't be answered from here, or null when it can.
function noAnswer(it) {
  if (it.kind === "attention") {
    const line = it.run ? needItemsOf(it.run, facts())[0]?.line : null;
    return `${line ?? "This run needs you without a question"}. Nothing to answer here: click it to open its orchestrator`;
  }
  if (it.kind === "decision" && !captainOf(facts()).terminal) {
    if (!it.run?.localTerminal) return "The captain isn't running and this decision names no run: start the captain (⚓+ in the sidebar, or Start captain in the overview) to answer it";
    // Nobody reads a gone run's inbox, and this decision is about the run itself (resume, park or close).
    if (runGone(it.run)) return "This run is gone and the captain isn't running: start the captain (⚓+ in the sidebar, or Start captain in the overview), or use the run's own Resume, Park or Close";
  }
  if (it.kind !== "decision" && !it.run?.localTerminal) return "This run's orchestrator isn't known: open the run to answer";
  return null;
}

// The answering half of a queue item, shared by Waiting on you and a run's need box: a button
// per option (the recommended one starred), Reply with its input, and once answered what
// happens next. `slot` keeps the two apart: the queue's ids as they were, the box's prefixed
// ("box:"), so a card and the queue in one overview never open the same Reply twice.
// {replyBtn, optionButton(i), canPick, note, input}; replyBtn, note and input may be false.
export function answerParts(view, t, it, ctx, slot = "") {
  const cap = captainOf(ctx);
  const rid = replyId(slot, it.id);
  const open = view.replying === rid;
  // A message waiting in the run's inbox counts too: someone else (the captain, by hand) answered.
  const sent = it.run ? inboxAsked(it.run, "answer", it.id, it) : false;
  const answered = sent || Boolean(it.answered);
  const why = noAnswer(it);
  const replyBtn = it.kind !== "attention" && h_flex().id(rid + "-reply").flex_none().items_center().px(8).h(22).rounded(5)
    .text_size(11).text_color(open ? t.accent : t.dim)
    .when(Boolean(why), (el) => el.opacity(0.45).tooltip(why))
    .when(!why, (el) => el.cursor_pointer().tooltip(slot ? "Answer in your own words" : "Answer in your own words, without leaving the overview")
      .hover((st) => st.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        view.replying = open ? null : rid;
        view.reply.set_value("");
        if (!open) view.reply.focus();
        cx.notify();
      }))
    .child(open ? "Cancel" : "Reply");
  // /compact is typed into the orchestrator, so only while it sits idle or done.
  const orchNow = it.run ? (orchestratorState(it.run, ctx) === "gone" ? "gone" : exactStatus(it.run.terminal, ctx) ?? "unknown") : null;
  const compactWhy = (o) => (isCompact(o.label) && isBudgetQuestion(it) && !["idle", "done"].includes(orchNow)
    ? `Compact needs the orchestrator idle or done (it is ${orchNow})` : null);
  const canPick = !answered && !why;
  // Greyed out once answered or when it can't be answered from here; a click picks that option.
  const optionButton = (i) => {
    const o = it.options[i];
    // Disabled always says why: from here it can't be answered, it was, or Compact must wait.
    const off = why || (answered && "Already answered") || compactWhy(o);
    const b = actionButton(t, `${rid}-opt-${i}`, i === it.recommended ? `★ ${o.label}` : o.label,
      `${o.text || o.label}${i === it.recommended ? " (recommended)" : ""}`,
      off ? null : (cx) => { sendAnswer(view, it, o.label, cx, true); }, i === it.recommended);
    return off ? b.tooltip(off) : b;
  };
  const note = answered && div().text_size(11).text_color(t.muted).child(it.run && runGone(it.run) ? "Waits in its inbox until the run is resumed" : sent ? "Answered, waiting for the orchestrator" : "Message waiting for the orchestrator");
  const input = open && v_flex().gap(4)
    .child(Input.new(view.reply))
    .child(div().text_size(10.5).text_color(t.dim).child(it.kind === "decision" && cap.terminal ? "Enter sends it to the captain, with this decision attached" : it.run && runGone(it.run) ? "Enter writes it to the run's inbox, where it waits until the run is resumed" : "Enter writes it to the run's inbox and tells its orchestrator"));
  return { replyBtn, optionButton, canPick, note, input };
}

// Everything waiting on the person, in one queue at the top of the overview, oldest first
// (the work blocked longest): each run's question.md, the captain's open decisions
// (decisions.sh) and the runs that need them without a question. Each item can be answered
// from what it shows: its recommended option, evidence and risk, a button per option and a
// free-text Reply. An answer goes to the run's inbox, or to the captain for its decisions.
function waitingOnYou(view, t, s, decisions, runs, ctx) {
  const cap = captainOf(ctx);
  const items = decisionQueue(runs, decisions, ctx);
  if (!items.length) return null;
  const row = (it) => {
    const why = noAnswer(it);
    const address = it.kind === "decision" ? cap.terminal?.address : it.run?.terminal;
    const meta = [it.kind === "decision" ? "captain asks" : null, it.run?.branch ?? (it.decision?.run ?? "").split("/").pop(),
      it.run?.machine ?? it.decision?.machine, it.since ? `asked ${ago(it.since)}` : null];
    const line = (label, text, color) => text && div().text_size(11).text_color(t.muted)
      .child(div().flex().gap(4).child(div().flex_none().font_semibold().text_color(color ?? t.dim).child(label)).child(div().flex_1().min_w(0).child(oneLine(text))));
    // Blocks right under the title, the urgency cue, and no recommendation the starred option
    // says already (question.js queueLines), as the need box shows a question.
    const tone = { blocks: t.blocked, rec: t.accent, risk: t.blocked };
    const lines = queueLines(it);
    const body = h_flex().id(it.id + "-body").flex_1().min_w(0).gap(8).items_start()
      .when(Boolean(address), (el) => el.cursor_pointer().on_click(() => focusAgent(address)))
      .child(div().flex_none().text_size(14).child(it.kind === "decision" ? CAPTAIN : OCTOPUS))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12.5).text_color(t.foreground).child(oneLine(it.title, 300)))
        .children(lines.filter((x) => x.key === "blocks").map((x) => line(x.label, x.text, tone.blocks)))
        .child(div().truncate().text_size(11).text_color(t.dim).child(meta.filter(Boolean).join(" · ")))
        .children(lines.filter((x) => x.key !== "blocks").map((x) => line(x.label, x.text, tone[x.key]))));
    const a = answerParts(view, t, it, ctx);
    const buttons = a.canPick && !why && it.options.length > 0 && h_flex().flex_wrap().gap(6).pl(22)
      .children(it.options.map((_o, i) => a.optionButton(i)));
    return v_flex().id(it.id).gap(6).p(8).rounded(7).bg(t.surface)
      .child(h_flex().gap(8).items_start().child(body).when(Boolean(a.replyBtn), (el) => el.child(a.replyBtn)))
      .when(Boolean(buttons), (el) => el.child(buttons))
      .when(Boolean(a.note), (el) => el.child(a.note.pl(22)))
      .when(Boolean(a.input), (el) => el.child(a.input));
  };
  return v_flex().id("waiting").flex_none().gap(6).p(10).rounded(10).bg(t.blocked + "14").border(1).border_color(t.blocked + "66")
    .child(div().text_size(11.5).font_semibold().text_color(t.blocked).child(`Waiting on you · ${items.length}`))
    .children(items.map(row));
}

// The totals across runs, as small stats under the overview's title. "need you" counts as the
// Crew's Needs you heading does (crewrows.js needCount): the runs that need you, orchestrators
// without a run blocked on a dialog and the captain's open decisions; it focuses the first.
function totals(t, s, need, decisions, ctx, runless = []) {
  const stat = (id, value, label, tone, onClick) => h_flex().id(id).flex_none().gap(4).items_baseline().px(6).h(22).rounded(5)
    .when(Boolean(onClick), (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click(onClick))
    .child(div().text_size(13).font_semibold().text_color(tone ? t[tone] : t.foreground).child(String(value)))
    .child(div().text_size(11).text_color(t.dim).child(label));
  const blocked = runlessNeeds(runless);
  const firstNeed = (decisions.length ? captainOf(ctx).terminal?.address : null) ?? need[0]?.terminal ?? blocked[0]?.term.address;
  const needs = needCount(need, runless, decisions.length);
  return h_flex().flex_wrap().gap(2).items_center()
    .child(stat("t-runs", s.live.length, "running", null))
    .child(stat("t-need", needs, "need you", needs ? "blocked" : null, firstNeed ? () => focusAgent(firstNeed) : null))
    .when(s.docked.length > 0, (el) => el.child(stat("t-done", s.docked.length, "finished", "done")))
    .child(stat("t-agents", s.workers, s.workers === 1 ? "agent" : "agents", null))
    .when(s.planned > 0, (el) => el.child(stat("t-tasks", `${s.done}/${s.planned}`, "tasks done", null)))
    .child(stat("t-prs", s.open.length, openPrsLabel(s.open.length, s.failing, s.parkedOpen), s.failing ? "blocked" : s.open.length ? "done" : null));
}

// Deleting closed runs by age, from the closed runs' header: each preset's cutoff in days
// (null: all of them).
const BULK_KEY = "closed:bulk";
const BULK_AGES = [{ id: "week", label: "1 week", days: 7 }, { id: "month", label: "30 days", days: 30 }, { id: "all", label: "all", days: null }];
const DAY = 86400000;

// The closed runs a preset deletes: closed longer ago than its cutoff (by the closed
// marker's time, else the last update); a run with neither only goes with "all".
function bulkRuns(closed, days) {
  if (days == null) return closed;
  const cutoff = Date.now() - days * DAY;
  return closed.filter((r) => { const at = runTime(r); return at > 0 && at < cutoff; });
}

// "Delete 3 runs closed more than 30 days ago", "Delete all 5 closed runs".
const bulkText = (n, age) => (age.days ? `Delete ${plural(n, "run")} closed more than ${age.label} ago`
  : n === 1 ? "Delete the closed run" : `Delete all ${n} closed runs`);

// "4 on local-ssh, 3 here", or nothing when they are all on this machine.
function machinesText(runs) {
  const counts = new Map();
  for (const r of runs) counts.set(r.machine ?? null, (counts.get(r.machine ?? null) ?? 0) + 1);
  if (counts.size === 1 && counts.has(null)) return "";
  return [...counts].map(([m, n]) => `${n} ${m ? `on ${m}` : "here"}`).join(", ");
}

// The closed runs' header: the fold toggle and, while unfolded, Delete older than a preset;
// after a preset is clicked, its question with a confirm and Cancel; while deleting, how many.
function closedHeader(view, t, closed) {
  const toggle = h_flex().id("finished-toggle").gap(6).items_center().cursor_pointer()
    .hover((st) => st.text_color(t.foreground))
    .on_click((_e, cx) => { view.showDone = !view.showDone; view.confirm = view.confirm?.key === BULK_KEY ? null : view.confirm; cx.notify(); })
    .child(svg(`mods/harbormaster/chevron-${view.showDone ? "down" : "right"}.svg`).size(11))
    .child(`${closed.length} closed`);
  const head = h_flex().flex_wrap().pt(6).px(4).gap(6).items_center().text_size(11).text_color(t.dim).child(toggle);
  const busy = view.busy?.[BULK_KEY];
  if (busy) return head.child(div().flex_1()).child(div().flex_none().text_color(t.muted).child(busy.label));
  if (!view.showDone) return head;
  // Runs a card's action is already deleting (or putting away) are left to it.
  closed = closed.filter((r) => !view.busy[r.key]);
  const set = (cx, value) => { view.confirm = value; view.actionError = null; view.actionNote = null; cx.notify(); };
  const asking = view.confirm?.key === BULK_KEY ? BULK_AGES.find((a) => a.id === view.confirm.action) : null;
  if (!asking) {
    return head.child(div().flex_1())
      .child(div().flex_none().child("Delete older than"))
      .children(BULK_AGES.map((a) => {
        const n = bulkRuns(closed, a.days).length;
        return actionButton(t, `bulk-${a.id}`, a.label, n ? bulkText(n, a) : null,
          n ? (cx) => set(cx, { key: BULK_KEY, action: a.id }) : null);
      }));
  }
  const runs = bulkRuns(closed, asking.days);
  const where = machinesText(runs);
  const yes = (cx) => {
    set(cx, null);
    if (!runs.length) return;
    const label = `Deleting ${plural(runs.length, "closed run")}…`;
    const at = Date.now();
    // Each delete is one sh on its machine; give the whole batch room on the busiest one.
    const most = Math.max(...[...new Set(runs.map((r) => r.machine ?? ""))].map((m) => runs.filter((r) => (r.machine ?? "") === m).length));
    const batch = { label, at, branch: "closed runs", limit: 2 * 60000 + most * 30000 };
    view.busy[BULK_KEY] = batch;
    for (const r of runs) view.busy[r.key] = { label: "Deleting…", at, branch: r.branch, limit: batch.limit };
    // As a card's action: owned by no view, notifying through cx.spawn's cx.
    cx.spawn(async (cx) => {
      let failed = [];
      try { failed = await deleteRuns(runs); } catch (e) { failed = runs.map((run) => ({ run, error: e?.message ?? String(e) })); }
      for (const key of [BULK_KEY, ...runs.map((r) => r.key)]) if (view.busy[key]?.at === at) delete view.busy[key];
      const done = runs.length - failed.length;
      if (done) setNote(view, `Deleted ${plural(done, "closed run")}.`);
      if (failed.length) view.actionError = `${failed.length} not deleted: ${failed.map((f) => `${f.run.branch}${f.run.machine ? ` on ${f.run.machine}` : ""} (${f.error})`).join("; ")}`;
      view.redraw = true;
      try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
      try { await view.load(cx); } catch { /* the next refresh shows it */ }
    }, { owner: null });
  };
  return v_flex().gap(4)
    .child(head)
    .child(v_flex().gap(6).p(8).rounded(7).bg(t.raised)
      .child(div().text_size(12).text_color(t.foreground)
        .child(`${bulkText(runs.length, asking)}${where ? ` (${where})` : ""} for good? ${runs.length === 1 ? "Its run directory goes" : "Their run directories go"}: spec, plan, decisions and status, so ${runs.length === 1 ? "it" : "they"} can't be resumed. This can't be undone. Branches and PRs stay on git and GitHub.`))
      .child(h_flex().gap(6)
        .child(actionButton(t, "bulk-yes", `Delete ${runs.length}`, null, yes, true))
        .child(actionButton(t, "bulk-no", "Cancel", null, (cx) => set(cx, null)))));
}

// The cards list: what's waiting on you, captain, runs that need you, the others, finished
// runs still open, then closed runs folded; each group newest first (runTime).
export function cards(view, t, runs, errors, decisions = []) {
  const ctx = facts();
  const s = stats(runs, ctx);
  // Runs that need you, as the Crew counts them (finished ones too: a PR to merge), come first.
  const need = needRunsOf(s.shown, (r) => attOf(r, ctx));
  const needing = new Set(need);
  const sorted = (list) => [...list].sort(newestFirst);
  const live = [...sorted(need), ...sorted(s.live.filter((r) => !needing.has(r)))];
  const docked = s.docked.filter((r) => !needing.has(r));
  const closed = sorted(s.closed);
  const narrow = (view.size?.width ?? 600) / zoom() < 360;
  const waiting = waitingOnYou(view, t, s, decisions, runs, ctx);
  return v_flex().id("root").size_full().min_h(0).bg(t.canvas ?? t.chrome).text_size(13)
    .on_size_change((size, cx) => { view.size = size; cx.notify(); })
    .child(v_flex().flex_none().px(10).pt(10).pb(6).gap(2)
      .child(h_flex().px(4).items_center()
        .child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).child("Runs"))
        .child(div().id("open-stats").flex_none().px(6).h(18).rounded(4).flex().items_center().text_size(11).text_color(t.dim)
          .cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
          .tooltip("Where the time goes, tokens, CPU and memory: per run, task and agent, and past runs")
          .on_click(() => openStats()).child("Stats"))
        .child(toastsToggle(t)))
      .child(totals(t, s, need, decisions, ctx, runlessOrchs(view.runs, ctx))))
    .child(v_flex().id("runs-list").flex_1().min_h(0).px(10).pb(12).gap(8).overflow_y_scrollbar()
      .when(Boolean(waiting), (el) => el.child(waiting))
      .child(captainStrip(view, t, ctx, s))
      .when(s.shown.length === 0, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child("No runs in progress. Ask the captain to start one, e.g. “start issue 185 in my-app”.")))
      .children(live.map((r) => card(view, t, r, ctx, narrow)))
      .children(sorted(docked).map((r) => card(view, t, r, ctx, true)))
      .when(s.parked.length > 0, (el) => el.child(div().pt(6).px(4).text_size(11).font_semibold().text_color(t.dim).child(parkedHeading(s.parked.length, s.parkedWithOpen))))
      .children(sorted(s.parked).map((r) => card(view, t, r, ctx, true)))
      .when(closed.length > 0, (el) => el.child(closedHeader(view, t, closed)))
      .when(Boolean(view.showDone), (el) => el.children(closed.map((r) => card(view, t, r, ctx, true))))
      .children(noteRows(view, t, false))
      .when(errors.length > 0, (el) => el.child(div().px(4).text_size(11).text_color(t.blocked).child(errors.join("\n")))));
}

// Toasts on or off (telling.js): a toast when a run starts needing you. On by default.
function toastsToggle(t) {
  const on = toastsOn();
  return div().id("toasts-toggle").flex_none().px(6).h(18).rounded(4).flex().items_center().text_size(11).text_color(on ? t.dim : t.muted)
    .cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
    .tooltip(on ? "A toast when a run starts needing you (a question, a PR to merge, red CI…). Click to turn them off."
      : "Toasts are off. Click to get one when a run starts needing you.")
    .on_click((_e, cx) => { cx.stop_propagation(); setToastsOn(!on); cx.notify(); })
    .child(on ? "Toasts on" : "Toasts off");
}

// The props of a run's own pane. Herdr stores pane props as given and shows them on every
// screen of the run's machine, while a run's key and terminal address carry this screen's
// name for that machine ("local-ssh:" here, none on the machine itself). So the pane names
// the run by what every screen reads the same: its directory and its orchestrator's
// terminal as its own machine names it.
export const runProps = (r) => ({ role: "run", dir: r.dir, terminal: r.localTerminal });

// The run a run pane's props name. Panes saved before runProps() carry `run`, a run key
// ("<machine>:<dir>"), whose machine may be another screen's name: only its dir counts.
// The orchestrator's terminal comes first: an orchestrator can move its run to another
// directory (a new integration branch), and its pane should follow it there.
export function runOfProps(runs, p) {
  const byTerminal = p.terminal ? runs.filter((x) => x.localTerminal === p.terminal) : [];
  if (byTerminal.length) return byTerminal.find((x) => x.dir === p.dir) ?? byTerminal.find((x) => !x.away) ?? byTerminal[0];
  const dir = p.dir ?? (typeof p.run === "string" ? p.run.slice(p.run.indexOf(":") + 1) : null);
  return runs.find((x) => x.dir === dir) ?? null;
}


// One run's card, as a pane pinned beside its orchestrator (props() as runProps() gives them).
export function runPane(view, t, p) {
  const ctx = facts();
  const r = runOfProps(view.runs, p);
  // A popup opened with "details" (show-run) starts with the question's Details unfolded, once.
  if (p.details && r && !view.detailsShown) { view.folds ??= new Map(); view.folds.set(`q-${r.key}`, true); view.detailsShown = true; }
  // One opened with "proof" starts with every claim listed and the first worth a look (else the
  // first still being proved) unfolded, once the run's claims have been read.
  if (p.proof && r && !view.proofShown && hasClaims(r)) {
    const k = firstToOpen(r, stagesOf(r, ctx));
    view.folds ??= new Map(); view.folds.set(`pf-${r.key}`, true);
    if (k) { view.proofRows ??= new Set(); view.proofRows.add(`${r.key}-${k.id}`); }
    view.proofShown = true;
  }
  return v_flex().id("run-pane").size_full().min_h(0).bg(t.canvas ?? t.chrome).text_size(13)
    .child(v_flex().id("run-pane-list").flex_1().min_h(0).p(10).gap(8).overflow_y_scrollbar()
      .child(r ? runDetail(view, t, r, ctx) : view.runs.length
        ? v_flex().p(12).gap(8).items_start().text_size(12).text_color(t.dim)
          .child("This run is no longer in the harbor. Pin its card again from the overview or the Crew block.")
          .child(actionButton(t, "close-pane", "Close this pane", null, () => closeOwnPane()))
        : div().p(12).text_size(12).text_color(t.dim).child("Reading the run…"))
      .children(noteRows(view, t, false)));
}
