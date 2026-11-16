// The serious views: the runs overview (totals, what's waiting on you, captain, run cards) and the Crew block.

import { div, svg } from "gpui-kit";
import { openOverlay } from "herdr";
import { v_flex, h_flex, Input, HoverCard } from "gpui-base";
import { stats, decisionQueue, answerRun, requestLevel, acceptProof, unacceptProof, askProof, compactRun, isCompact, isBudgetQuestion, overBudget, dropDecision, runPhase, taskTone, taskCounts, taskAgents, shownStage, taskStage, prsOf, relatedOf, unknownPr, oneWay, PR_TONE, isClosed, isParked, putAway, resumeRun, deleteRun, deleteRuns, newestFirst, runTime, askBlocking, askComments } from "./data.js";
import { facts, exactStatus, orchestratorsOf, orchestratorState, agentStatus, workersOf, captainOf, captainPane, paneBeside, togglePin, needReason, adrift, agentNames, focusAgent, focusWithPane, currentAgent, openUrl, replyToCaptain, closeOwnPane, openStats } from "./live.js";
import { CAPTAIN, OCTOPUS, CRAB, programIcon, zoom, plural, ago, shortRef, stateText, runName, withTip, typeTag } from "./ui.js";
import { tokenText, tokenHeadline, tokenDetail, startedTip, runAgeText } from "./context.js";
import { liveUsage, treeUsage, hotText, memText } from "./resources.js";
import { proofVerdict, proofTasks, tierTip, proofTone, proofToneText, proofCounts, proofRowParts, needsLook, resultLine, pendingLine, gatheringStage } from "./proof.js";
import { oneLine, needHead, questionSections, paragraphs, plain, replyId, replyItem } from "./question.js";
import { thumbs } from "./viewer.js";
import { levelChoices } from "./levels.js";
import { attentionOf, needsYouNow as needsYouOf } from "./attend.js";
import { stepText, quietText, flowState, flowSetting, runDot } from "./attention.js";
import { GROUPS, groupRows, rowLead, rowEdge, rowTip, badgeOf, needLine, closableDone, emptyNote, crewEntries, needCount, runlessNeeds, captainNeedNote, watchingText } from "./crewrows.js";
import { blockingAsked, askSig } from "./blocking.js";
import { commentsAsked, commentsSig, defaultMode, commentLines, hasComments, botCount } from "./comments.js";
import { reviewFlows, setReviewFlow } from "./tracking.js";

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
const contextTip = (view, address, run = null) => {
  const c = view.contexts?.[address];
  return [c && `Context: ${c.tokens.toLocaleString("en")} tokens${c.model ? ` (${c.model})` : ""}, as of its last turn`,
    run?.tokens && `Run total: ${tokenHeadline(run.tokens)} (${run.tokens.total.toLocaleString("en")} in all), all its agents`].filter(Boolean).join("\n") || null;
};

// A small "85% · 2.1G" badge for an agent and the commands it runs, above resources.js's HOT
// limits, so a busy machine can be explained at a glance; nothing otherwise. The tooltip names
// what uses it: the agent itself and its busiest programs, and `more` (a run's total) after them.
const withUsage = (t, id, u, whose, more = null) => (el) => {
  const text = hotText(u);
  if (!text) return el;
  const progs = (u.programs ?? []).slice(0, 4).map((g) => `${g.name}: ${Math.round(g.cpu)}% · ${memText(g.rssKb)}`);
  const tip = [`${whose}: ${Math.round(u.cpu)}% CPU (100% is one core), ${memText(u.rssKb)} memory`,
    u.own ? `the agent itself: ${Math.round(u.own.cpu)}% · ${memText(u.own.rssKb)}` : null, ...progs, more].filter(Boolean).join("\n");
  return el.child(div().id(`${id}-use`).flex_none().px(5).rounded(4).text_size(10).font_semibold()
    .bg(t.working + "22").text_color(t.working).tooltip(tip).child(text));
};

const usageLine = (label, u) => (u ? `${label}: ${Math.round(u.cpu)}% · ${memText(u.rssKb)}` : null);

// A working agent's status is a ring spun natively, like Herdr's own Agents list (spin(900)). The Agents
// list already redraws the window while any agent works, so the ring rides on those frames: measured in a
// software-rendered window it cost about 1.2 CPU s/min less than stepped text frames (proof t19-spinner).
// Other motion holds still: loop() pulses redraw the whole window about 30 times a second.
function statusDot(t, status) {
  if (status === "working") return svg("mods/harbormaster/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().size(8).flex_none().rounded(4).bg(t.blocked).border(1.5).border_color(t.blocked + "66");
  if (status === "gone") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.dim);
  if (status === "idle") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(8).flex_none().rounded(4).bg(t[status] ?? t.dim);
}

// A PR's review as [text, tone]: who approved or asked for changes, when we know.
function reviewText(pr) {
  const who = (list) => (list?.length ? ` by ${list.join(", ")}` : "");
  if (pr.review === "CHANGES_REQUESTED") return [`Changes requested${who(pr.changesBy)}`, "blocked"];
  if (pr.review === "APPROVED") return [`Approved${who(pr.approvedBy)}`, "done"];
  if (pr.review === "REVIEW_REQUIRED") return ["Review needed", "dim"];
  return null;
}

// A link chip: the run's issues, and PRs it is about but did not open, side by side.
// A PR chip's icon takes its state's color; its title and state are in the tooltip.
function linkChip(t, id, url, icon, tip) {
  return h_flex().id(id).gap(4).px(6).h(20).items_center().rounded(5).bg(t.raised).text_size(11).text_color(t.muted).cursor_pointer()
    .hover((s) => s.text_color(t.foreground)).tooltip(tip ?? url)
    .on_click((_e, cx) => { cx.stop_propagation(); openUrl(url); })
    .child(icon).child(shortRef(url));
}
const prStateText = (pr) => (pr.state === "UNKNOWN" ? null : pr.state === "DRAFT" ? "Draft" : pr.state[0] + pr.state.slice(1).toLowerCase());

// A task's life-cycle stages (data.js taskStage) as they read and color, and which
// are marked because an agent is at it. Review takes the accent, fixing the implementer's
// second pass a color of its own, so implementing and reviewing tasks tell apart.
const STAGE = {
  planned: { label: "Planned", color: (t) => t.border },
  implement: { label: "Implementing", color: (t) => t.working, active: true },
  review: { label: "In review", color: (t) => t.accent, active: true },
  fix: { label: "Fixing", color: (t) => t.ansi5 ?? t.working, active: true },
  done: { label: "Done", color: (t) => t.done },
  blocked: { label: "Blocked", color: (t) => t.blocked },
};
// A task's color: its stage's, else its tone's (a state that names no stage).
const taskColor = (t, task, stage) => (stage ? STAGE[stage].color(t) : t[taskTone(task.state)] ?? t.border);
const pulse = (stage, task) => (stage ? STAGE[stage].active : taskTone(task.state) === "working");
const stageText = (task, stage) => (stage ? STAGE[stage].label : stateText(task.state));

// Each task's stage and live agents, in plan.md's order. A done task shows none: they
// are leftovers, or another round's ("final review" and "final review 2" share an id).
const stagesOf = (r, ctx) => r.tasks.map((task) => {
  const agents = taskAgents(task, r, ctx);
  const stage = shownStage(task, agents);
  return { agents: stage === "done" ? [] : agents, stage };
});

// "1 implementing · 4 in review": the tasks under way, by stage.
function stageSummary(stages) {
  return ["implement", "review", "fix"].map((s) => [s, stages.filter((x) => x.stage === s).length])
    .filter(([, n]) => n > 0).map(([s, n]) => `${n} ${STAGE[s].label.toLowerCase()}`).join(" · ");
}

// Each of r.tasks' proof on the tasks bar, in plan.md's order: {tone, text} (proof.js
// proofTone), or null while proof has nothing to say. All null for a run without proof.
// `stages` is stagesOf()'s, for whether a task is done: only a done task can be "not checked".
function taskProof(r, stages) {
  const none = r.tasks.map(() => null);
  if (!hasProof(r)) return none;
  const rows = proofRows(r, stages);
  const finished = isFinished(r);
  return none.map((_, i) => {
    const tone = proofTone(rows[i], finished, taskDone(r, stages, i));
    return tone ? { tone, text: proofToneText(tone, rows[i]) } : null;
  });
}
// Whether r.tasks[i] is done: by its stage (stagesOf()), else its plan.md state.
function taskDone(r, stages, i) {
  const stage = stages?.[i]?.stage;
  return stage ? stage === "done" : taskTone(r.tasks[i].state) === "done";
}
const PROOF_COLOR = { pass: (t) => PASS(t), accepted: (t) => PASS(t), fail: (t) => t.blocked, partial: (t) => AMBER(t), unchecked: (t) => AMBER(t) };

// One segment per planned task, hover for its name, stage and proof, and how many are done
// and under way below it; only for runs that plan at least one. A task's proof result, once it
// has one, colours its segment (green pass, red fail, amber partial, no screenshot or, once the
// run is finished, not checked); its stage colours it otherwise. The one task bar: the Proof
// section has none of its own.
function taskStrip(t, r, counts, stages, names = true) {
  const proof = taskProof(r, stages);
  return v_flex().gap(5)
    .child(h_flex().gap(3).h(6).children(Array.from({ length: counts.planned }, (_, i) => {
      const task = r.tasks[i];
      const p = proof[i] ?? null;
      const color = p ? PROOF_COLOR[p.tone](t) : task ? taskColor(t, task, stages[i].stage) : i < counts.merged ? t.done : t.border;
      return div().id(`seg-${r.key}-${i}`).flex_1().h_full().rounded(3).bg(color)
        .when(Boolean(task), (el) => el.tooltip([[task.id, task.name].filter(Boolean).join(" "), stageText(task, stages[i].stage), p?.text].filter(Boolean).join(" · ")))
        // An agent is at it: a light edge, still (see statusDot for why not a pulse).
        .when(Boolean(task) && pulse(stages[i].stage, task), (el) => el.border(1).border_color(t.foreground + "88"));
    })))
    .when(names, (el) => el.child(div().text_size(11).text_color(t.dim).child(tasksText(r, counts, stages))));
}

// "21/22 done · 1 in review": the tasks done, then those under way by stage.
function tasksText(r, counts, stages) {
  const done = r.tasks.length ? r.tasks.filter((task) => taskTone(task.state) === "done").length : counts.merged;
  return [`${done}/${counts.planned} done`, stageSummary(stages)].filter(Boolean).join(" · ");
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
  const left = [counts.planned ? `${counts.merged} of ${counts.planned} tasks done` : null,
    r.prs.length ? plural(r.prs.length, "PR") + " stay open" : null].filter(Boolean).join(", ");
  if (action === "park") return `Park ${r.branch}? Its orchestrator and agents end and its integration worktree's space closes (the worktree stays); the run waits here until you resume it.${left ? ` ${left}.` : ""}`;
  const clean = "Its orchestrator pushes what isn't pushed, deletes the worktrees and closes its tab; branches and PRs stay.";
  if (action === "close") return r.phase === "finished" ? `Close ${r.branch}? ${clean}`
    : `Close ${r.branch} for good, unfinished?${left ? ` ${left}.` : ""} ${clean}`;
  if (action === "delete") return `Delete ${r.branch} for good? Its run directory goes: spec, plan, decisions and status, so it can't be resumed. This can't be undone. Branches and PRs stay on git and GitHub.`;
  return `Resume ${r.branch}? A new orchestrator starts in ${r.repo}${r.machine ? ` on ${r.machine}` : ""}, restarting unfinished tasks.`;
}

function actionButton(t, id, label, tip, onClick, primary = false) {
  const b = div().id(id).flex_none().px(9).h(22).rounded(5).flex().items_center().text_size(11.5).font_medium()
    .bg(primary ? t.accent : t.raised).text_color(primary ? t.background : t.muted);
  // No click: an action is already under way on this card.
  if (!onClick) return b.opacity(0.45).child(label);
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
  if (asking) {
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
            if (note) view.actionNote = `${r.branch}: ${note}`;
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
        .child(actionButton(t, `yes-${r.key}`, ACTION[asking].label, null, yes, true))
        .child(actionButton(t, `no-${r.key}`, "Cancel", null, (cx) => set(cx, null))));
  }
  return h_flex().gap(6).justify_end()
    .children(actionsOf(r, orch, closed).map((a) => actionButton(t, `${a}-${r.key}`, ACTION[a].label, ACTION[a].tip,
      (cx) => set(cx, { key: r.key, action: a }), a === "resume")));
}

// A Crew row's edge colour from its name (crewrows.js rowEdge): red for Needs you, amber for a
// stall, a review wait cyan (a calm colour apart from Done's blue), grey for can't tell; a run
// at work or briefly idle takes the border's: fine needs no colour.
// Rows add their own alpha to the edge colour ("…14"), so it must be opaque: theme colours
// such as border can carry alpha (#ffffff18), which would make "#ffffff1814", not a colour.
const opaque = (c) => (typeof c === "string" && /^#[0-9a-f]{8}$/i.test(c) ? c.slice(0, 7) : c);
const edgeColor = (t, edge) => opaque(edge === "amber" ? AMBER(t) : edge === "review" ? t.ansi6 ?? t.accent : edge === "neutral" ? t.border : t[edge] ?? t.border);

// ---- ask what's blocking, the review flow, close all merged ----

// Runs asked what is blocking from here, by run key: {sig} (blocking.js askSig at the click).
// Shared by the Crew, the cards and the panes of this copy; the ask's unread message in the
// inbox (run.blockingAsked) carries it across copies and reloads.
const blockAsked = new Map();

// A stalled run's "Ask what's blocking" (`short`: "Ask", for the narrow Crew row), or "asked…"
// while the ask waits: its message is unread, or nothing moved since it was asked here. Null for
// a run that is not stalled, is put away, or whose orchestrator is not known here.
function blockingAction(view, t, r, att, id, short = false) {
  if (!r?.dir || !r.localTerminal || r.away || !att?.stall) return null;
  const mine = blockAsked.get(r.key);
  if (mine && mine.sig !== askSig(r)) blockAsked.delete(r.key);
  if (blockingAsked(r, blockAsked.get(r.key))) {
    return div().id(`blk-${id}`).flex_none().text_size(11).text_color(AMBER(t))
      .tooltip("Asked its orchestrator what is blocking; waiting for its progress or status to change").child("asked…");
  }
  const quiet = quietText(att.stall).replace(/^quiet /, "");
  const step = stepText(att.step) || null;
  return actionButton(t, `blk-${id}`, short ? "Ask" : "Ask what's blocking",
    `Ask what's blocking: a message in the run's inbox that wakes its orchestrator ("what is blocking? … quiet for ${quiet}…"); it asks you with a question if it needs you, else carries on`,
    (cx) => {
      blockAsked.set(r.key, { sig: askSig(r) });
      view.actionError = null;
      cx.notify();
      cx.spawn(async (cx) => {
        try {
          const out = await askBlocking(r, { quiet, step });
          if (out?.waits) view.actionNote = `${r.branch}: the ask waits in its inbox until the run is resumed`;
          else if (out?.blocked) view.actionNote = `${r.branch}: its orchestrator is blocked on a dialog; it reads the ask once that is answered`;
        } catch (e) {
          // Written but not woken: the ask is in the inbox, so it stays asked.
          if (!e?.inInbox) blockAsked.delete(r.key);
          view.actionError = `${r.branch}: ${e?.message ?? e}`;
        }
        view.redraw = true;
        try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
        try { await view.load(cx); } catch { /* the next refresh shows it */ }
      }, { owner: null });
    });
}

// PRs asked to address their comments from here, by PR URL: {sig} (comments.js commentsSig at
// the click). The unread message (run.commentsAsked) carries it across copies and reloads.
const commentsAskedHere = new Map();

const MODE_TIP = {
  ask: "Ask me: its orchestrator writes you one question listing each comment with what it proposes (fix, reply or leave, and why); it acts on your answer",
  handle: "Handle them: its orchestrator fixes what it agrees with, pushes, replies on each thread it acted on (\"🤖 AI: …\"), resolves the threads it addressed and reports; it never merges",
};

// Address comments, on a run's card and pane: for each of its approved or changes-requested PRs
// with open review comments, "Address N comments on #42" and two buttons, Ask me and Handle them,
// the run's autonomy's default (comments.js defaultMode) highlighted; a click writes an inbox
// message for that PR (data.js askComments) and the row reads "asked…" until the PR's comments
// or the run's status change, or while the message is unread. Null when there are none, the run
// is put away, or its orchestrator is not known here; and while the run has an open question
// (an Ask me's question is answered in its box, and a second ask would only queue a duplicate).
function commentsAction(view, t, r, att, id) {
  if (!r?.dir || !r.localTerminal || r.away || r.question) return null;
  const prs = (att?.next?.comments?.prs ?? []).filter((p) => hasComments(p.comments) && p.url);
  if (!prs.length) return null;
  const first = defaultMode(r.autonomy);
  const rows = prs.map((p, i) => {
    const mine = commentsAskedHere.get(p.url);
    if (mine && mine.sig !== commentsSig(r, p)) commentsAskedHere.delete(p.url);
    const n = p.comments.count, b = botCount(p.comments.bots);
    const what = `Address ${n} comment${n === 1 ? "" : "s"}${b ? ` (+${b} from bots)` : ""}${prs.length > 1 || p.number ? ` on #${p.number}` : ""}`;
    const label = div().id(`cmt-${id}-${i}-label`).flex_none().text_size(11.5).text_color(t.muted)
      .tooltip(commentLines([p], 20).join("\n")).child(what);
    if (commentsAsked(r, p, commentsAskedHere.get(p.url))) {
      return h_flex().gap(8).items_center().child(label)
        .child(div().id(`cmt-${id}-${i}`).flex_none().text_size(11).text_color(t.muted)
          .tooltip("Asked its orchestrator to address these comments; waiting for the comments or the run's status to change").child("asked…"));
    }
    const send = (mode) => (cx) => {
      commentsAskedHere.set(p.url, { sig: commentsSig(r, p) });
      view.actionError = null;
      cx.notify();
      cx.spawn(async (cx) => {
        try {
          const out = await askComments(r, p, mode);
          if (out?.waits) view.actionNote = `${r.branch}: the ask waits in its inbox until the run is resumed`;
          else if (out?.blocked) view.actionNote = `${r.branch}: its orchestrator is blocked on a dialog; it reads the ask once that is answered`;
        } catch (e) {
          // Written but not woken: the ask is in the inbox, so it stays asked.
          if (!e?.inInbox) commentsAskedHere.delete(p.url);
          view.actionError = `${r.branch}: ${e?.message ?? e}`;
        }
        view.redraw = true;
        try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
        try { await view.load(cx); } catch { /* the next refresh shows it */ }
      }, { owner: null });
    };
    const tip = (mode) => `${MODE_TIP[mode]}.${mode === first ? ` The default at ${r.autonomy ?? "L0"}.` : ""}`;
    return h_flex().gap(6).items_center().child(label)
      .child(actionButton(t, `cmt-${id}-${i}-ask`, "Ask me", tip("ask"), send("ask"), first === "ask"))
      .child(actionButton(t, `cmt-${id}-${i}-handle`, "Handle them", tip("handle"), send("handle"), first === "handle"));
  });
  return v_flex().gap(4).children(rows);
}

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
    view.actionNote = [done ? `Closing ${plural(done, "merged run")}: their orchestrators clean up and close their tabs.` : null, ...notes].filter(Boolean).join("\n") || null;
    if (failed.length) view.actionError = `${failed.length} not closed: ${failed.join("; ")}`;
    view.redraw = true;
    try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
    try { await view.load(cx); } catch { /* the next refresh shows it */ }
  }, { owner: null });
}

// The Done heading's right side: Close all merged, its question once clicked, or what it is doing.
function closeAllControl(view, t, rows, ctx) {
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
function attOf(r, ctx) {
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
const runStatus = (own, workers, att, ctx) =>
  runDot(own, workers.map((w) => agentStatus(w, ctx)), { ciRunning: att?.reasons?.[0]?.key === "ci-running" });

function runFacts(r, ctx) {
  const orch = orchestratorState(r, ctx);
  const parked = isParked(r);
  const att = attOf(r, ctx);
  const need = needsYouNow(r, ctx);
  let badge = (parked ? PHASE.parked : r.away?.how === "closed" ? PHASE.closed : PHASE[r.phase]) ?? PHASE.unknown;
  // A run in Needs you or Done, or a finished one, says what comes next instead, as its Crew
  // card does ("approved — merge", "review from anna"); a parked or closed one keeps saying so.
  const next = !r.away && badgeOf(att, r.phase === "finished");
  if (next) badge = next;
  const workers = workersOf(r.terminal, ctx);
  return {
    orch, parked, need, badge, att,
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

function cardHeader(view, t, r, f, meta) {
  return h_flex().gap(8).items_center()
    .child(div().flex_none().text_size(15).child(OCTOPUS))
    .child(v_flex().flex_1().min_w(0)
      .child(h_flex().gap(6).items_center().min_w(0)
        .when(Boolean(r.type), (el) => el.child(runTypeTag(t, r, r.key)))
        .children(levelTags(view, t, r, r.key))
        .child(withTip(div().id(`title-${r.key}`).truncate().font_semibold().text_size(13.5).text_color(t.foreground), runName(r.branch, r.topic)))
        .when(Boolean(r.machine), (el) => el.child(div().flex_none().text_size(10.5).px(5).rounded(4).bg(t.raised).text_color(t.muted).child(r.machine))))
      .child(metaLine(t, r, meta)))
    .map(withContext(view, t, `run-${r.key}`, r.terminal))
    .child(runPin(t, `pin-${r.key}`, r, f.orch))
    .child(statusDot(t, f.dot))
    .child(f.badge.tip ? div().id(`badge-${r.key}`).flex_none().tooltip(f.badge.tip).child(pill(t, f.badge.label, f.need ? "blocked" : f.badge.tone, f.need))
      : pill(t, f.badge.label, f.need ? "blocked" : f.badge.tone, f.need));
}

// What a run needs you for, on its card and in its pane. Without a question: why, and a click
// opens the orchestrator. With one: what it asks and the recommendation in short, then a
// Details fold with the question's sections, a button per option and Reply, answered the way
// Waiting on you answers (answerParts, sendAnswer: the run's inbox, then a wake). `where`
// tells the card's and the pane's ids apart.
function needBox(view, t, r, f, ctx, where) {
  const focus = (_e, cx) => { cx.stop_propagation(); if (f.orch !== "gone") focusAgent(r.terminal); };
  const it = r.ask ? decisionQueue([r], [], ctx).find((x) => x.kind === "run") : null;
  const box = h_flex().id(`need-${where}-${r.key}`).gap(8).p(8).rounded(7).bg(t.blocked + "1c").items_start()
    .child(div().flex_none().text_color(t.blocked).font_bold().child(r.question ? "?" : "!"));
  // Its orchestrator is gone: nothing to open, and Resume (with the run's actions) is the way on.
  if (!it && f.orch === "gone") {
    return box.child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(11).font_semibold().text_color(t.blocked).child("Needs you — its orchestrator is gone"))
      .child(div().text_size(12).text_color(t.foreground).child(r.question ? (f.reason ?? "").slice(0, 220) : "Resume it to carry on, or park or close the run.")));
  }
  if (!it) {
    return box.cursor_pointer().on_click(focus).child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(11).font_semibold().text_color(t.blocked).child(r.question ? "Waiting for your answer — click to open the orchestrator" : "Needs you — click to open the orchestrator"))
      .child(div().text_size(12).text_color(t.foreground).child((f.reason ?? "").slice(0, 220))));
  }
  const head = needHead(r.ask);
  const key = `q-${r.key}`;
  const open = isOpen(view, key);
  const a = answerParts(view, t, it, ctx, "box");
  const sections = questionSections(r.ask, r.question);
  const count = it.options.length ? plural(it.options.length, "option") : "reply in your own words";
  const fold = h_flex().id(`qfold-${where}-${r.key}`).gap(6).items_center().min_w(0).rounded(4).cursor_pointer()
    .text_size(11.5).text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground))
    .tooltip(open ? "Hide the question's details" : "The whole question, its options and Reply")
    .on_click((_e, cx) => { cx.stop_propagation(); view.folds ??= new Map(); view.folds.set(key, !open); cx.notify(); })
    .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
    .child(div().flex_none().font_semibold().child("Details"))
    .child(div().truncate().text_color(t.dim).child([count, it.since ? `asked ${ago(it.since)}` : null].filter(Boolean).join(" · ")));
  // A section's text whole, as paragraphs (question.js), under its small label.
  const part = (label, text, color) => v_flex().gap(2)
    .when(Boolean(label), (el) => el.child(div().text_size(10.5).font_semibold().text_color(color ?? t.dim).child(label)))
    .children(paragraphs(text).map((l) => div().text_size(11.5).text_color(t.foreground).child(l)));
  const options = it.options.length > 0 && v_flex().gap(4)
    .child(div().text_size(10.5).font_semibold().text_color(t.dim).child("Options"))
    .children(it.options.map((o, i) => h_flex().gap(8).items_start()
      .child(a.optionButton(i))
      .child(div().flex_1().min_w(0).pt(3).text_size(11.5).text_color(t.muted).child(plain(o.text)))));
  const tone = { Recommended: t.accent, Risk: t.blocked };
  const details = open && v_flex().id(`qdetail-${where}-${r.key}`).gap(8).pt(4)
    // Clicks in here answer or type; they never fall through to the card's open-the-orchestrator.
    .on_click((_e, cx) => cx.stop_propagation())
    .children(sections.filter((x) => !x.label || x.label === "Question").map((x) => part(x.label, x.text)))
    .when(Boolean(options), (el) => el.child(options))
    .children(sections.filter((x) => x.label && x.label !== "Question").map((x) => part(x.label, x.text, tone[x.label])))
    .when(Boolean(a.replyBtn), (el) => el.child(h_flex().child(a.replyBtn)))
    .when(Boolean(a.input), (el) => el.child(a.input));
  return box.child(v_flex().flex_1().min_w(0).gap(4)
    .child(div().id(`qtitle-${where}-${r.key}`).cursor_pointer().text_size(12.5).font_medium().text_color(t.foreground)
      .tooltip(f.orch !== "gone" ? "Open the orchestrator" : "The orchestrator is gone: answer here, it waits in the run's inbox")
      .on_click(focus).child(oneLine(head.title, 300)))
    .when(Boolean(head.rec), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(oneLine(head.rec, 200))))
    .when(Boolean(a.note), (el) => el.child(a.note))
    .child(fold)
    .when(Boolean(details), (el) => el.child(details)));
}

// The one-line notes under the progress: parked or closed, gone, waiting agents, unread messages.
function cardNotes(t, r, f) {
  const note = (text, tone = "muted") => div().text_size(11.5).text_color(t[tone]).child(text);
  return [
    r.away && note(`${f.parked ? "Parked" : "Closed"} ${ago(r.away.at)}${r.away.was ? ` · was: ${r.away.was}` : ""}`),
    // The Needs you box says so already when it shows.
    !r.away && !f.need && f.orch === "gone" && r.phase !== "finished" && note("Orchestrator is gone: resume, park or close this run.", "blocked"),
    !r.away && f.orch === "gone" && r.phase === "finished" && note("Orchestrator is gone, only a shell is left in its tab: resume it if the PR needs more work, or park or close the run."),
    r.waiting.length > 0 && note(`Waiting on an answer: ${r.waiting.join(", ")}`),
    r.unhandled > 0 && note(`${plural(r.unhandled, "relayed message")} not read yet`),
  ].filter(Boolean);
}

const unscopedOf = (r) => (r.proof.tier ? r.tasks.filter((k) => !k.proof).length : 0);
// The tokens segment, only once over the soft budget ("over budget 92M/100M", in the blocked
// colour); otherwise the tokens are in the Tokens section, not the header.
const tokenMeta = (r) => (r.tokens && r.budget && overBudget(r) ? `over budget ${tokenText(r.tokens.total)}/${tokenText(r.budget)}` : null);
const runMeta = (r, f) => [r.repo, f.workers.length ? plural(f.workers.length, "agent") : null, tokenMeta(r), unscopedOf(r) ? `${unscopedOf(r)} unscoped` : null, r.updated ? `updated ${ago(r.updated)}` : null].filter(Boolean).join(" · ");
// The meta line as three texts, around the tokens segment: it has the breakdown on hover, and
// the blocked colour once over budget.
const metaLine = (t, r, meta) => {
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
const runEdge = (t, f) => (f.need ? t.blocked : f.badge.tone === "muted" ? t.border : t[f.badge.tone] ?? t.border);
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
  const proof = r.phase !== "finished" && !r.away ? proofSummary(t, r) : null;
  const blocking = blockingAction(view, t, r, f.att, `card-${r.key}`);
  const comments = commentsAction(view, t, r, f.att, `card-${r.key}`);
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
      .child(div().flex_none().text_size(11).font_semibold().text_color(t.dim).child("Proof"))
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
// apart from done's blue). Amber is the theme's working colour, so nothing at work uses it
// for an edge, tint, pill or text.
const PASS = (t) => t.ansi2 ?? "#3fa055";
const AMBER = (t) => t.working;

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
function factsLine(t, r, prs, size = 13, att = null) {
  const items = [];
  if (r.started) items.push({ el: div().id(`age-${r.key}`).flex_none().tooltip(startedTip(r.started)).child(runAgeText(r)) });
  // The current step and its age, as the Crew shows it, while the run is not finished; the
  // progress line carries its own age (progressLine). A stalled run says so, in amber.
  const live = att && r.phase !== "finished" && !r.away;
  if (live && att.stall) items.push({ text: quietText(att.stall), color: AMBER(t), bold: true });
  if (live && att.step?.text && att.step.text !== r.progress) items.push({ text: stepText(att.step), color: t.muted });
  prs.forEach((p, i) => {
    const state = prStateText(p);
    items.push({ el: div().id(`fact-pr-${r.key}-${i}`).flex_none().cursor_pointer().hover((s) => s.text_color(t.accent)).tooltip(`${p.title ?? ""}\n${p.url}`.trim())
      .on_click((_e, cx) => { cx.stop_propagation(); openUrl(p.url); })
      .child(`${p.number ? `PR #${p.number}` : "PR"}${state ? ` ${state.toLowerCase()}` : ""}`) });
    const c = p.checks ?? {};
    if (c.fail) items.push({ text: `checks ✗ ${c.fail} failing`, color: t.blocked });
    else if (c.pending) items.push({ text: `checks … ${c.pending} running`, color: t.dim });
    else if (c.pass) items.push({ text: "checks ✓", color: PASS(t) });
    // A one-way door is worth seeing before the PR card (and the overview card has no PR rows).
    if (p.danger && oneWay(p.danger)) items.push({ text: "one-way door", color: t.blocked, bold: true });
    const review = reviewText(p);
    if (review) items.push({ text: review[0], color: review[1] === "done" ? PASS(t) : t[review[1]] });
  });
  if (items.length === 0) return null;
  return h_flex().flex_wrap().items_center().text_size(size).font_medium().text_color(t.foreground).children(joined(t, items));
}

// The orchestrator's own progress note: under the facts, smaller and muted, since it is in
// its words and can lag behind. While it is the run's current step, with that step's age.
const progressLine = (t, r, att = null) => div().text_size(11.5).text_color(t.muted)
  .child(att?.step?.text === r.progress && r.phase !== "finished" && !r.away ? stepText(att.step) : r.progress);

// The proof verdict as coloured parts, from plan.md's Proof lines and proof.md:
// "T2 · 20/20 pass · checks green", with failures red and what is missing amber. Null for a run
// planned before proof lines existed. Merge danger is the PR's, not repeated here. Proof still
// being gathered (proof.js isPending) is one dim "N pending", so it doesn't read as a problem.
// `stages` is stagesOf()'s (null: by plan.md's states), for which tasks are done.
function proofSummary(t, r, stages = null) {
  const { tier, md } = r.proof;
  if (!hasProof(r)) return null;
  const rows = proofRows(r, stages);
  const scoped = rows.filter((k) => k.scoped);
  const { pass, fail, partial, pending, unchecked, missing, unscoped, accepted } = proofCounts(rows);
  const finished = isFinished(r);
  const checks = md?.checks?.state;
  const parts = [
    tier && { text: `T${tier.tier}` },
    scoped.length > 0 && { text: `${pass}/${scoped.length} pass`, color: pass + accepted === scoped.length ? PASS(t) : null, bold: true },
    accepted > 0 && { text: `${accepted} accepted`, color: t.muted },
    pending > 0 && { text: `${pending} pending`, color: t.dim },
    fail > 0 && { text: `${fail} fail`, color: t.blocked },
    partial > 0 && { text: `${partial} partial`, color: AMBER(t) },
    missing > 0 && { text: `${plural(missing, "task")} without a screenshot`, color: AMBER(t) },
    unchecked > 0 && (pass + fail + partial + accepted + pending > 0 || md) && { text: `${unchecked} not checked`, color: finished ? AMBER(t) : t.dim },
    unscoped > 0 && { text: `${unscoped} not scoped`, color: AMBER(t) },
    md?.cut && { text: "proof.md cut", color: t.dim },
    checks && { text: `checks ${checks}`, color: checks === "green" ? PASS(t) : checks === "red" ? t.blocked : t.dim },
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const tip = tier ? `${tierTip(tier.tier)}${unscoped ? `\n${plural(unscoped, "task")} not scoped` : ""}` : null;
  return { parts, rows, scoped, finished, tip };
}

// Whether the run has proof to show at all (a tier, proof.md or any task's Proof line).
const hasProof = (r) => Boolean(proofVerdict({ tier: r.proof.tier, md: r.proof.md, tasks: r.tasks, danger: null, shotFiles: r.proof.files }));

// What was clicked on a Proof row (Accept, Unaccept, Ask to prove) and not read back from the run's
// files yet, by "<run key>:<task id>": {kind, line, at}. Shared by the pane and the card, so both
// show it at once; each note goes once the files show it, or after 15 s.
const said = new Map();
const SAID_FOR = 15000;

const isFinished = (r) => r.phase === "finished" || Boolean(r.away);

// The run's proof rows (proof.js proofTasks), with the user's acceptances and asks, and the clicks
// the files don't show yet. A row is pending while its task is under way (planned, implementing,
// in review, fixing: by `stages` when given, else plan.md's states), never while blocked or done;
// a task proof.md has but plan.md doesn't counts as done.
function proofRows(r, stages = null) {
  const gathering = (id) => {
    const i = r.tasks.findIndex((x) => x.id === id);
    return i >= 0 && gatheringStage(stages?.[i]?.stage ?? taskStage(r.tasks[i].state));
  };
  const rows = proofTasks(r.tasks, r.proof.md, r.proof.files, { accepted: r.proof.accepted, asks: r.proof.asks, gathering, finished: isFinished(r) });
  for (const k of rows) {
    const key = `${r.key}:${k.id}`, s = said.get(key);
    if (!s) continue;
    const shown = s.kind === "accept" ? r.proof.accepted?.[k.id]?.result === s.line
      : s.kind === "unaccept" ? !r.proof.accepted?.[k.id] : r.proof.asks?.get(k.id) === s.line;
    if (shown || Date.now() - s.at > SAID_FOR || resultLine(k) !== s.line) { said.delete(key); continue; }
    if (s.kind === "accept") { k.accepted = { at: new Date(s.at).toISOString(), result: s.line }; k.asked = false; }
    else if (s.kind === "unaccept") k.accepted = null;
    else k.asked = true;
  }
  return rows;
}

// ---- one run on its own, as the pane pinned beside its orchestrator ----

const section = (t, title, ...rest) => v_flex().gap(4)
  .child(h_flex().gap(6).px(2).items_center().text_size(11).font_semibold().text_color(t.dim).child(title)
    .children(rest.filter(Boolean).map((x) => div().font_normal().child(x))));

// Every fold in the pane looks the same: under the section's small grey label, a dim chevron
// and a one-line summary in normal text; colour only on status words. Open state per key in
// view.folds, closed by default and not persisted.
const isOpen = (view, key) => Boolean(view.folds?.get(key));
function foldLine(view, t, key, tip, items) {
  const open = isOpen(view, key);
  return h_flex().id(`fold-${key}`).gap(6).px(2).items_center().min_w(0).rounded(4).cursor_pointer().text_size(11.5).text_color(t.foreground)
    .hover((s) => s.bg(t.hover)).tooltip(tip)
    .on_click((_e, cx) => { cx.stop_propagation(); view.folds ??= new Map(); view.folds.set(key, !open); cx.notify(); })
    .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
    .child(h_flex().flex_1().min_w(0).flex_wrap().items_center().children(joined(t, items)));
}

// A PR as a row with room to spare: its whole title, then repo, checks and review.
function prDetail(t, pr, i, related = false) {
  const tone = PR_TONE[pr.state] ?? "dim";
  const c = pr.checks ?? {};
  const checkText = c.fail ? `✗ ${c.fail} failing` : c.pending ? `… ${c.pending} running` : c.pass ? `✓ ${c.pass} checks` : null;
  const checkColor = c.fail ? t.blocked : c.pending ? t.dim : PASS(t);
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

const RESULT_COLOR = { pass: PASS, fail: (t) => t.blocked, partial: AMBER };

// A tier as a small tag, "T2"; `tip` says what it is.
const tierTag = (t, id, tier, tip) => div().id(id).flex_none().text_size(10).font_semibold().px(5).rounded(4)
  .bg(t.raised).text_color(t.muted).tooltip(tip).child(`T${tier}`);

// ---- the run's level tags ----

// A run's tags, as the pane header and its Crew row show them: its type, then its autonomy and,
// with a tier, its proof tier. `r` may be a stand-in for a run without a directory
// ({type, autonomy} from its terminal's labels): its tags then only say what they are.
// `short`, for the narrow Crew block, writes a pending request "T3…" instead of "T3 requested…".
// The type tag on its own, apart from the level tags.
const runTypeTag = (t, r, id) => (r.type ? typeTag(t, r.type, `type-${id}`) : null);
function levelTags(view, t, r, id, short = false) {
  return [
    levelTag(view, t, r, "autonomy", `auto-${id}`, short),
    r.proof?.tier ? levelTag(view, t, r, "tier", `tier-${id}`, short) : null,
  ].filter(Boolean);
}

// An autonomy ("L1") or proof tier ("T2") tag. Resting the pointer on it opens a card that
// lists every level with its definition, the run's own highlighted; clicking another asks the
// orchestrator to change it (data.js requestLevel: a message in the run's inbox). Until
// status.json or plan.md shows the new level, the tag reads "T3 requested…": from the request
// still unread in the inbox (r.pending), so it survives a reload, and from the click itself
// until the next read sees that message (at most 15 s, should the orchestrator be quicker).
function levelTag(view, t, r, kind, id, short = false) {
  const cur = kind === "autonomy" ? r.autonomy : r.proof.tier.tier;
  const label = (l) => (kind === "autonomy" ? l : `T${l}`);
  const key = `${r.key}:${kind}`;
  let asked = view.levelAsked?.get(key)?.level;
  // The click's own note goes once the run's files show the request, or the level itself.
  if (asked !== undefined && (r.pending?.[kind] === asked || cur === asked || Date.now() - view.levelAsked.get(key).at > 15000)) { view.levelAsked.delete(key); asked = undefined; }
  const pending = asked ?? r.pending?.[kind] ?? null;
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
        view.levelAsked ??= new Map();
        view.levelAsked.set(key, { level: c.level, at: Date.now() });
        view.actionError = null;
        cx.notify();
        cx.spawn(async (cx) => {
          try { await requestLevel(r, kind, c.level); } catch (e) {
            // Written but not woken: the request is in the inbox, so it stays requested.
            if (!e?.inInbox) view.levelAsked.delete(key);
            view.actionError = `${r.branch}: ${e?.message ?? e}`;
          }
          view.redraw = true;
          try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
          try { await view.load(cx); } catch { /* the next refresh shows it */ }
        }, { owner: null });
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
        .child(kind === "autonomy" ? "Autonomy: how much the orchestrator decides itself" : "Proof tier: what proves a task done"))
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
      .child(when(d))
      .child(v_flex().flex_1().min_w(0)
        .child(div().when(!more, (el) => el.truncate()).text_color(t.foreground).child(title(d)))
        .when(Boolean(more && d.why), (el) => el.child(div().text_size(11).text_color(t.dim).child(d.why))));
  };
  return v_flex().gap(4)
    .child(h_flex().id(`fold-${key}`).gap(6).px(2).items_center().min_w(0).rounded(4).cursor_pointer().text_size(11)
      .hover((st) => st.bg(t.hover)).tooltip(open ? "Fold the decisions" : "Show every decision")
      .on_click((_e, cx) => { cx.stop_propagation(); view.folds ??= new Map(); view.folds.set(key, !open); cx.notify(); })
      .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().flex_none().font_semibold().text_color(t.foreground).child("Decisions"))
      .child(div().min_w(0).truncate().text_color(t.muted).child(`· ${r.decided.length}${counts ? ` · ${counts}` : ""}`)))
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
  return section(t, "Tokens", updated && `counted ${ago(updated)}`)
    .child(byAgent.length > 0 ? foldLine(view, t, key, `${tokenDetail(r.tokens)}\n${open ? "Hide" : "Show"} each agent's tokens`, items)
      : h_flex().id(key).px(2).flex_wrap().items_center().text_size(11.5).text_color(t.foreground).tooltip(tokenDetail(r.tokens)).children(joined(t, items)))
    .when(Boolean(r.budget), (el) => el.child(div().id(`budget-${r.key}`).px(2).text_size(11).text_color(overBudget(r) ? t.blocked : t.dim)
      .tooltip("A soft budget: crossing it asks you whether to continue, compact or stop; nothing stops by itself")
      .child(`${overBudget(r) ? "Over" : "Under"} its soft budget of ${tokenText(r.budget)} tokens`)))
    .when(open, (el) => el.children(byAgent.map(row)));
}

// The Proof section: the verdict as one fold line (the Tasks bar has each task's result in
// colour, so there is no second bar here), then the rows that need a look
// (failed, partial, missing a screenshot, not scoped, or not checked once the run is done, and
// not accepted) without unfolding. Unfolding lists every task. A row shows its files as a count;
// clicking it opens its result as one line in its status colour, its thumbnails, a "details"
// fold (planned proof, what was checked, the files) and, unless it passed, Accept and Ask to
// prove (or Unaccept). Not persisted.
function proofSection(view, t, r, stages) {
  const { md, files } = r.proof;
  const s = proofSummary(t, r, stages);
  const folder = () => pathLink(t, r, `pf-dir-${r.key}`, "shared/proof", `shared/proof/ · ${files.length >= 40 ? "40+ files" : plural(files.length, "file")}`);
  // A run planned before proof lines existed: one quiet line, not a red row per task.
  if (!s) {
    return section(t, "Proof").child(div().px(2).text_size(11.5).text_color(t.dim).child("No proof planned"))
      .when(files.length > 0, (el) => el.child(h_flex().px(2).pt(2).child(folder())));
  }
  const key = `pf-${r.key}`, open = isOpen(view, key);
  const colorOf = (k) => RESULT_COLOR[k.result]?.(t) ?? t.border;
  const TONE = { pass: PASS(t), fail: t.blocked, partial: AMBER(t), unchecked: AMBER(t), pending: t.muted, dim: t.dim };
  // A task proof.md has but plan.md doesn't counts as done.
  const doneOf = (k) => { const i = r.tasks.findIndex((x) => x.id === k.id); return i < 0 || taskDone(r, stages, i); };
  const row = (k) => {
    const id = `${r.key}-${k.id}`;
    const more = view.proofRows?.has(id);
    const part = (p) => {
      if (p.kind === "result") return div().text_size(12).text_color(TONE[p.tone]).child(p.text);
      if (p.kind === "thumbs") return thumbs(view, t, r, k.id, p.files);
      if (p.kind === "details") {
        const dk = `pfd-${id}`;
        return v_flex().gap(2)
          .child(foldLine(view, t, dk, isOpen(view, dk) ? "Hide the details" : p.items.map((x) => x.label).join(", "), [{ text: "details", color: t.dim }]))
          .when(isOpen(view, dk), (el) => el.children(p.items.map((x) => div().pl(19).text_size(11).text_color(t.dim).child(`${x.label}: ${x.text}`))));
      }
      return h_flex().gap(6).pt(2).items_center().children(p.actions.map((a) => proofAction(view, t, r, k, a)));
    };
    return v_flex().id(`pf-${id}`).gap(4).px(8).py(4).rounded(7).bg(t.raised + "88").cursor_pointer()
      .hover((st) => st.bg(t.hover)).on_click((_e, cx) => {
        cx.stop_propagation();
        view.proofRows ??= new Set();
        if (more) view.proofRows.delete(id); else view.proofRows.add(id);
        cx.notify();
      })
      .child(h_flex().gap(8).items_center()
        .child(k.tier !== null ? tierTag(t, `pft-${id}`, k.tier, `${tierTip(k.tier)}\n${k.planned ? "Planned" : "Recorded in proof.md"}`) : div().flex_none().text_size(10).px(5).text_color(t.blocked).child("—"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(k.name ? `${k.id} ${k.name}` : k.id))
        .when(k.files.length > 0 && !more, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(plural(k.files.length, "file"))))
        .when(Boolean(k.accepted), (e) => e.child(div().id(`pfa-${id}`).flex_none().text_size(10.5).px(6).rounded(9).bg(t.raised).text_color(t.muted)
          .tooltip(`You accepted this proof as it is${k.accepted.at ? ` ${ago(Date.parse(k.accepted.at))}` : ""}`).child("accepted")))
        .when(k.asked && !more, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.muted).child("asked…")))
        .child(k.pending ? pill(t, "pending", "muted").tooltip(pendingLine(k))
          // A "pending" left on a finished run reads as not checked, as the verdict counts it.
          : k.result === "pending" ? pill(t, "not checked", s.finished ? AMBER(t) : "dim").tooltip(resultLine(k))
          : k.result ? pill(t, k.result, colorOf(k)).tooltip(k.why || k.result)
          : k.scoped ? pill(t, "not checked", s.finished ? AMBER(t) : "dim") : pill(t, "not scoped", AMBER(t)).tooltip("No Proof line in plan.md")))
      .when(more, (el) => el.children(proofRowParts(k, s.finished, doneOf(k)).map(part)));
  };
  const shown = open ? s.rows : s.rows.filter((k) => needsLook(k, s.finished));
  return section(t, "Proof")
    .child(foldLine(view, t, key, `${s.tip ? `${s.tip}\n` : ""}${open ? "Show only the tasks that need a look" : `Show every task's proof (${s.rows.length})`}`, s.parts))
    .children(shown.map(row))
    .when(open, (el) => el.child(h_flex().flex_wrap().gap(6).px(2).pt(2).items_center()
      .when(Boolean(md), (e) => e.child(pathLink(t, r, `pf-md-${r.key}`, "proof.md", "proof.md")))
      .when(files.length > 0, (e) => e.child(folder()))
      .when(!md && files.length === 0, (e) => e.child(div().text_size(11).text_color(t.dim).child("No proof captured yet")))));
}

// A Proof row's button: Accept (Harbormaster records it in proof-accepted.json itself, so it works
// with the orchestrator gone), Unaccept, Ask to prove (a "prove <task> to T<n>: …" message in the
// run's inbox), or "asked…" while that waits. The click shows at once (`said`), before the next
// read of the run's files.
const PROOF_ACTION = {
  accept: { label: "Accept", tip: "Accept this proof as it is: it stops needing a look, until its result changes" },
  unaccept: { label: "Unaccept", tip: "Take the acceptance back: it needs a look again" },
  ask: { label: "Ask to prove", tip: "Ask the orchestrator to finish this task's proof (a message in its inbox)" },
};
function proofAction(view, t, r, k, a) {
  if (a === "asked") return div().id(`pfx-${r.key}-${k.id}`).text_size(11).text_color(t.muted).tooltip("Waiting for the orchestrator to prove it").child("asked…");
  const { label, tip } = PROOF_ACTION[a];
  return actionButton(t, `pf${a}-${r.key}-${k.id}`, label, tip, (cx) => {
    const key = `${r.key}:${k.id}`;
    said.set(key, { kind: a, line: resultLine(k), at: Date.now() });
    view.actionError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (a === "accept") await acceptProof(r, k);
        else if (a === "unaccept") await unacceptProof(r, k);
        else await askProof(r, k);
      } catch (e) {
        // Written but not woken: the ask is in the inbox, so it stays asked.
        if (!e?.inInbox) said.delete(key);
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

// One of the run's agents: its name, the task it works on and that task's stage, when
// its name says (impl-<prefix>-<task>); a helper it started (a dev server) indented below it.
function workerRow(t, w, ctx, work, nested) {
  const status = agentStatus(w, ctx);
  const color = work?.stage ? STAGE[work.stage].color(t) : null;
  return h_flex().id(`wk-${w.address}`).gap(8).items_center().h(24).px(8).rounded(6).cursor_pointer()
    .when(nested, (el) => el.pl(28))
    .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); focusAgent(w.address); })
    .tooltip(work?.task.about ? `${w.name ?? w.address}: ${work.task.about}` : "Show this agent")
    .child(div().flex_none().text_size(nested ? 11 : 13).child(CRAB))
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
  const facts = factsLine(t, r, prs, 13, f.att);
  const notes = cardNotes(t, r, f);
  const blocking = blockingAction(view, t, r, f.att, `pane-${r.key}`);
  const comments = commentsAction(view, t, r, f.att, `pane-${r.key}`);
  // Most important first: who and what, whether it needs you, when and its PR, then the PR
  // itself, proof, tasks, decisions and agents; tokens last, since they are about cost.
  return v_flex().id(`run-${r.key}`).relative().overflow_hidden().flex_none().gap(14).p(14).pl(18).rounded(10).bg(t.surface)
    .border(1).border_color(need ? t.blocked + "88" : t.border)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).bg(runEdge(t, f)))
    .child(div().id(`head-${r.key}`).cursor_pointer().on_click(() => orch !== "gone" && focusAgent(r.terminal))
      .child(cardHeader(view, t, r, f, runMeta(r, f))))
    .when(need, (el) => el.child(needBox(view, t, r, f, ctx, "pane")))
    .when(Boolean(facts) || Boolean(r.progress) || notes.length > 0 || Boolean(blocking) || Boolean(comments), (el) => el.child(v_flex().gap(4)
      .when(Boolean(facts), (e) => e.child(facts))
      .when(Boolean(r.progress), (e) => e.child(progressLine(t, r, f.att)))
      .children(notes)
      .when(Boolean(blocking), (e) => e.child(h_flex().pt(2).child(blocking)))
      .when(Boolean(comments), (e) => e.child(div().pt(2).child(comments)))))
    .child(section(t, prs.length ? `Pull requests · ${prs.length}` : "Pull requests", r.away ? null : flowToggle(t, r, `pane-${r.key}`))
      .children(prs.map((p, i) => prDetail(t, p, i)))
      .when(prs.length === 0, (el) => el.child(div().px(2).text_size(11.5).text_color(t.dim).child(r.phase === "finished" ? "None" : "No pull request yet"))))
    .when(r.issues.length + related.length > 0, (el) => el.child(section(t, "Issues and related PRs")
      .children(r.issues.map((url) => issueRow(t, url)))
      .children(related.map((p, i) => prDetail(t, p, i, true)))))
    .when(r.tasks.length > 0 || r.proof.tier || r.proof.md || r.proof.files.length > 0, (el) => el.child(proofSection(view, t, r, stages)))
    .when(counts.planned > 0 || r.tasks.length > 0, (el) => el.child(section(t, "Tasks", tasksText(r, counts, stages))
      .child(div().px(2).pb(2).child(taskStrip(t, r, counts, stages, false)))))
    .when(r.decided.length > 0, (el) => el.child(decisionsSection(view, t, r)))
    .when(workers.length > 0, (el) => el.child(section(t, `Agents · ${workers.length}`)
      .children(workers.map((w) => workerRow(t, w, ctx, workOf.get(w.address), w.parent !== r.terminal)))))
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
const cardBesideOrchestrator = (r, orch) => Boolean(r?.terminal) && orch !== "gone" && !r.away;

// The pin for a run's card beside its orchestrator, while the orchestrator is there.
const runPin = (t, id, r, orch) => (cardBesideOrchestrator(r, orch) ? pinButton(t, id, paneBeside(r.terminal), { run: r }) : div());

// What the captain watches, from stats(): "watching 2 runs · 1 finished" (crewrows.js watchingText).
const watchedText = (s) => watchingText(s.live.length, s.docked.length);

function captainStrip(view, t, ctx, s) {
  const watched = watchedText(s);
  const cap = captainOf(ctx);
  if (!cap.terminal) return h_flex().flex_none().gap(8).p(10).rounded(10).border(1).border_color(t.border).text_size(12).text_color(t.dim)
    .child(CAPTAIN).child("No captain running. Start one with /herdr-app-captain.");
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
// (answerRun), which wakes its orchestrator. Marks the item answered once it is written.
// Returns false when there is nowhere to send it.
function sendAnswer(view, it, text, cx, option = false) {
  const cap = captainOf(facts()).terminal;
  if (it.kind === "decision" && cap) {
    replyToCaptain(cap.address, it.decision, text);
    return true;
  }
  const run = it.run;
  if (!run?.localTerminal || noAnswer(it)) return false;
  view.actionError = null;
  // Marked before the write, so a second click meanwhile is ignored; undone if it fails.
  view.answered[it.id] = it.since ?? 0;
  cx.spawn(async (cx) => {
    try {
      // The budget question's Compact button compacts the orchestrator first (never a typed reply).
      if (option && isCompact(text) && isBudgetQuestion(it)) await compactRun(run, it.title, text);
      else await answerRun(run, it.title, text);
      // The captain isn't there to clear its decision, so it goes with the answer.
      if (it.kind === "decision") await dropDecision(it.decision).catch(() => {});
    } catch (e) {
      // Written but the wake failed: the answer is in the inbox, so it stays answered and
      // a captain decision still goes (else each click would write another message).
      if (e?.inInbox) { if (it.kind === "decision") await dropDecision(it.decision).catch(() => {}); }
      else delete view.answered[it.id];
      view.actionError = `${run.branch}: ${e?.message ?? e}`;
    }
    view.redraw = true;
    try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
    try { await view.load(cx); } catch { /* the next refresh shows it */ }
  }, { owner: null });
  return true;
}

// Sends the inline reply as the answer to the item being replied to.
export function submitReply(view, cx) {
  const text = view.reply.value().trim();
  // A need box's Reply answers the same item (question.js replyId).
  const id = replyItem(view.replying);
  const it = decisionQueue(view.runs, view.decisions, facts()).find((x) => x.id === id);
  if (!text || !it || !sendAnswer(view, it, text, cx)) return;
  view.reply.set_value("");
  view.replying = null;
  cx.notify();
}

// A gone or lost orchestrator: an answer only waits in its inbox, and nothing is typed into its terminal.
const runGone = (run) => orchestratorState(run, facts()) === "gone";

// Why an item can't be answered from here, or null when it can.
function noAnswer(it) {
  if (it.kind === "attention") return "This run needs you without a question: click to open its orchestrator";
  if (it.kind === "decision" && !captainOf(facts()).terminal) {
    if (!it.run?.localTerminal) return "The captain isn't running and this decision names no run: start /herdr-app-captain to answer it";
    // Nobody reads a gone run's inbox, and this decision is about the run itself (resume, park or close).
    if (runGone(it.run)) return "This run is gone and the captain isn't running: start /herdr-app-captain, or use the run's own Resume, Park or Close";
  }
  if (it.kind !== "decision" && !it.run?.localTerminal) return "This run's orchestrator isn't known: open the run to answer";
  return null;
}

// The answering half of a queue item, shared by Waiting on you and a run's need box: a button
// per option (the recommended one starred), Reply with its input, and once answered what
// happens next. `slot` keeps the two apart: the queue's ids as they were, the box's prefixed
// ("box:"), so a card and the queue in one overview never open the same Reply twice.
// {replyBtn, optionButton(i), canPick, note, input}; replyBtn, note and input may be false.
function answerParts(view, t, it, ctx, slot = "") {
  const cap = captainOf(ctx);
  // An answer written for an earlier question of this run (another `since`) no longer counts.
  if (view.answered[it.id] !== undefined && view.answered[it.id] !== (it.since ?? 0)) delete view.answered[it.id];
  const rid = replyId(slot, it.id);
  const open = view.replying === rid;
  // A message waiting in the run's inbox counts too: someone else (the captain, by hand) answered.
  const sent = view.answered[it.id] !== undefined;
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
  for (const id of Object.keys(view.answered)) {
    const it = items.find((x) => x.id === id);
    if (!it || (it.since ?? 0) !== view.answered[id]) delete view.answered[id];
  }
  const row = (it) => {
    const why = noAnswer(it);
    const address = it.kind === "decision" ? cap.terminal?.address : it.run?.terminal;
    const meta = [it.kind === "decision" ? "captain asks" : null, it.run?.branch ?? (it.decision?.run ?? "").split("/").pop(),
      it.run?.machine ?? it.decision?.machine, it.since ? `asked ${ago(it.since)}` : null];
    const line = (label, text, color) => text && div().text_size(11).text_color(t.muted)
      .child(div().flex().gap(4).child(div().flex_none().font_semibold().text_color(color ?? t.dim).child(label)).child(div().flex_1().min_w(0).child(oneLine(text))));
    const rec = it.recommended !== null ? it.options[it.recommended] : null;
    const body = h_flex().id(it.id + "-body").flex_1().min_w(0).gap(8).items_start()
      .when(Boolean(address), (el) => el.cursor_pointer().on_click(() => focusAgent(address)))
      .child(div().flex_none().text_size(14).child(it.kind === "decision" ? CAPTAIN : OCTOPUS))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12.5).text_color(t.foreground).child(oneLine(it.title, 300)))
        .child(div().truncate().text_size(11).text_color(t.dim).child(meta.filter(Boolean).join(" · ")))
        .when(Boolean(rec), (el) => el.child(line("Recommended", `${rec.label}${it.why ? ` — ${it.why}` : ""}`, t.accent)))
        .when(!rec && Boolean(it.why), (el) => el.child(line("Recommended", it.why, t.accent)))
        .when(Boolean(it.evidence), (el) => el.child(line("Evidence", it.evidence)))
        .when(Boolean(it.risk), (el) => el.child(line("Risk", it.risk, t.blocked)))
        .when(Boolean(it.blocks), (el) => el.child(line("Blocks", it.blocks))));
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

// The orchestrators without a run directory, as the Crew judges them ({r: null, a}): one
// blocked on a dialog needs you, though the overview has no run for it.
const runlessOrchs = (view, ctx) => orchestratorsOf(ctx).filter((term) => !view.runs.some((r) => r.terminal === term.address))
  .map((term) => ({ term, r: null, a: attentionOf(null, ctx, Date.now(), term) }));

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
    .when(s.planned > 0, (el) => el.child(stat("t-tasks", `${s.merged}/${s.planned}`, "tasks done", null)))
    .child(stat("t-prs", s.open.length, s.failing ? `open PRs · ${s.failing} failing` : s.open.length === 1 ? "open PR" : "open PRs", s.failing ? "blocked" : s.open.length ? "done" : null));
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
      if (done) view.actionNote = `Deleted ${plural(done, "closed run")}.`;
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
  const need = s.shown.filter((r) => needsYouNow(r, ctx));
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
          .on_click(() => openStats()).child("Stats")))
      .child(totals(t, s, need, decisions, ctx, runlessOrchs(view, ctx))))
    .child(v_flex().id("runs-list").flex_1().min_h(0).px(10).pb(12).gap(8).overflow_y_scrollbar()
      .when(Boolean(waiting), (el) => el.child(waiting))
      .child(captainStrip(view, t, ctx, s))
      .when(s.shown.length === 0, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child("No runs in progress. Ask the captain to start one, e.g. “start issue 185 in my-app”.")))
      .children(live.map((r) => card(view, t, r, ctx, narrow)))
      .children(sorted(docked).map((r) => card(view, t, r, ctx, true)))
      .when(s.parked.length > 0, (el) => el.child(div().pt(6).px(4).text_size(11).font_semibold().text_color(t.dim).child(`Parked · ${s.parked.length}`)))
      .children(sorted(s.parked).map((r) => card(view, t, r, ctx, true)))
      .when(closed.length > 0, (el) => el.child(closedHeader(view, t, closed)))
      .when(Boolean(view.showDone), (el) => el.children(closed.map((r) => card(view, t, r, ctx, true))))
      .when(Boolean(view.actionNote), (el) => el.child(div().px(4).text_size(11).text_color(t.muted).child(view.actionNote)))
      .when(Boolean(view.actionError), (el) => el.child(div().px(4).text_size(11).text_color(t.blocked).child(view.actionError)))
      .when(errors.length > 0, (el) => el.child(div().px(4).text_size(11).text_color(t.blocked).child(errors.join("\n")))));
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
  // One opened with "proof" starts with every Proof row listed and the first pending one (else the
  // first) unfolded, once the run's proof has been read.
  if (p.proof && r && !view.proofShown && hasProof(r)) {
    const rows = proofRows(r, stagesOf(r, ctx));
    const k = rows.find((x) => x.pending) ?? rows[0];
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
      .when(Boolean(view.actionNote), (el) => el.child(div().px(4).text_size(11).text_color(t.muted).child(view.actionNote)))
      .when(Boolean(view.actionError), (el) => el.child(div().px(4).text_size(11).text_color(t.blocked).child(view.actionError))));
}

// The Crew block: the captain and every orchestrator as cards, from their role labels,
// then "Adrift": every other agent that isn't one of their workers.
// Sits above Herdr's own Agents list in the harbormaster-main layout, so that list stays stock.
export function crew(view, t) {
  const ctx = facts();
  const cap = captainOf(ctx);
  const runOf = (term) => view.runs.find((r) => r.terminal === term.address);
  const now = Date.now();
  // Each orchestrator's attention, once per render: which group it is in and why. An
  // orchestrator without a run directory is judged by its terminal alone (can't tell).
  const orchestrators = orchestratorsOf(ctx)
    .map((term) => ({ term, r: runOf(term) }))
    .map((o) => ({ ...o, state: o.r?.phase ?? runPhase(o.term.labels?.["run.status"]), a: o.r ? attOf(o.r, ctx) : attentionOf(null, ctx, now, o.term) }));
  // Its Needs you is the overview's (crewrows.js crewEntries): a run that needs you whose
  // orchestrator is gone gets a row too, and the captain's open decisions count in its heading.
  const needRuns = stats(view.runs, ctx).shown.filter((r) => needsYouNow(r, ctx));
  const entries = crewEntries(orchestrators, needRuns, (r) => attOf(r, ctx));
  const asks = view.decisions?.length ?? 0;
  // The focused agent, or the crew agent beside a focused Harbormaster pane.
  const current = currentAgent(ctx, [cap.terminal?.address, ...orchestrators.map((o) => o.term.address)].filter(Boolean));
  // Only the captain has a mark (a small one): the rest are all orchestrators. The context size
  // and the run's token total are in the row's hover, which leaves the width to the tags. The
  // hover is on its two lines of text, not the whole row, so it never covers a tag's own card.
  const row = ({ id, mark = null, type = null, tags = [], title, tip = null, detail, tone, detailTip = null, status, address, edge, open = () => focusAgent(address), crabs = 0, run = null, usage = null, whose = "", more = null, action = null }) => {
    const hover = [title, tip, contextTip(view, address, run)].filter(Boolean).join("\n");
    const here = address != null && address === current;
    const color = tone === "amber" ? AMBER(t) : t[tone] ?? t.dim;
    return h_flex().id(id).relative().overflow_hidden().flex_none().gap(8).py(6).pl(12).pr(8)
    .rounded(7).bg(here ? edge + "33" : edge + "14").cursor_pointer().hover((st) => st.bg(here ? edge + "40" : edge + "26"))
    .when(here, (el) => el.border(1).border_color(edge + "aa"))
    .on_click(open)
    .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(edge))
    .when(Boolean(mark), (el) => el.child(div().flex_none().text_size(12).child(mark)))
    .child(v_flex().flex_1().min_w(0)
      // The title gets the whole first line; the type tag, the level tags (a pending request
      // short, "T3…") and then the worker count lead the second, so the tags stay put while
      // workers come and go. All are short and fixed, so a narrow sidebar truncates the detail.
      .child(div().id(`${id}-title`).min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).tooltip(hover).child(title))
      .child(h_flex().gap(6).items_center().min_w(0)
        .when(Boolean(type), (el) => el.child(type))
        .children(tags)
        .when(crabs > 0, (el) => el.child(h_flex().flex_none().gap(3).items_center().text_size(11).text_color(t.muted)
          .child(div().text_size(11).child(CRAB)).child(String(crabs))))
        .child(div().id(`${id}-detail`).flex_1().min_w(0).truncate().text_size(11).text_color(color).tooltip(detailTip ? `${detailTip}\n\n${hover}` : hover).child(detail))))
    .map(withUsage(t, id, usage, whose, more))
    .when(Boolean(action), (el) => el.child(action))
    .child(statusDot(t, status));
  };
  const rows = [];
  if (cap.terminal) {
    // The same counts as the overview: runs still working, and finished ones still open.
    const watched = watchedText(stats(view.runs, ctx));
    rows.push(row({
      id: "crew-captain", mark: CAPTAIN, title: "Captain",
      // Clicking the captain also opens the runs overview beside it.
      open: () => focusWithPane(cap.terminal.address),
      detail: [asks ? `asks you: ${plural(asks, "decision")}` : null, cap.watching ? watched : "not watching runs"].filter(Boolean).join(" · "),
      tone: asks || !cap.watching ? "blocked" : "muted", status: agentStatus(cap.terminal, ctx), address: cap.terminal.address, edge: t.accent,
      usage: liveUsage(cap.terminal.address), whose: "The captain and its commands",
    }));
  }
  const orchRow = ({ term, r, state, a }) => {
    const labels = term.labels ?? {};
    const crewOf = workersOf(term.address, ctx);
    const status = runStatus(agentStatus(term, ctx), crewOf, a, ctx);
    const workers = crewOf.length;
    // Why it is in its group (its reasons, the next-step label or the step and its age) leads,
    // then the rest; when it started is in the title's hover. Without a run directory, its
    // progress label.
    const { lead, rest, tone } = rowLead(a, now);
    const detail = [lead, rest ?? (r ? null : labels.progress)].filter(Boolean).join(" · ");
    const name = runName(r?.branch ?? term.name ?? term.address, labels["run.topic"] ?? r?.topic);
    const edge = rowEdge(a);
    return row({
      id: `crew-${term.address}`, detail: detail || "orchestrator", detailTip: rowTip(a, now).join("\n"),
      // The run's tags as its pane's header shows them, then its number and topic; without a
      // topic, its branch. Without a run directory, its terminal's labels stand in.
      ...(() => {
        const run = r ?? { key: term.address, type: labels["run.type"] || null, autonomy: /^L[0-2]$/.test(labels["run.autonomy"]) ? labels["run.autonomy"] : "L0" };
        return { type: runTypeTag(t, run, `crew-${term.address}`), tags: levelTags(view, t, run, `crew-${term.address}`, true) };
      })(),
      title: name.title, tip: [name.tip, startedTip(r?.started)].filter(Boolean).join("\n") || null,
      tone, status, address: term.address, crabs: state === "finished" ? 0 : workers, run: r,
      // Badged on its own, like any agent: a run's agents together pass 2 GB while nothing is busy.
      usage: liveUsage(term.address), whose: "The orchestrator and its commands",
      more: usageLine("The whole run, with its agents", treeUsage([term.address, ...crewOf.map((w) => w.address)])),
      // Clicking a run's orchestrator also opens that run's card beside it, while it's there.
      open: () => (r && cardBesideOrchestrator(r, orchestratorState(r, ctx)) ? focusWithPane(term.address, runProps(r)) : focusAgent(term.address)),
      edge: edgeColor(t, edge),
      // A stalled run: Ask what's blocking, or "asked…" while that waits.
      action: blockingAction(view, t, r, a, `crew-${term.address}`, true),
    });
  };
  // A run that needs you with no orchestrator to focus (gone, or its machine did not answer):
  // its row opens the run's card as a popup, where Resume is.
  const runRow = ({ r, a }) => {
    const { lead, tone } = rowLead(a, now);
    const name = runName(r.branch, r.topic);
    const open = () => openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: runProps(r) });
    return row({
      id: `crew-run-${r.key}`, detail: lead, detailTip: rowTip(a, now).join("\n"),
      type: runTypeTag(t, r, `crew-run-${r.key}`), tags: levelTags(view, t, r, `crew-run-${r.key}`, true),
      title: name.title, tip: [name.tip, startedTip(r.started), "No orchestrator: click for its card"].filter(Boolean).join("\n"),
      tone, status: "gone", address: null, run: r, open, edge: edgeColor(t, rowEdge(a)),
      action: actionButton(t, `crew-run-${r.key}-open`, "Resume", "Open its card: Resume there starts a new orchestrator that picks the run up", () => open()),
    });
  };
  // Needs you, Working, Waiting on others, Can't tell and Done, each longest wait first; Done
  // folded until opened (view.folds, as the pane's folds). Its heading leaves room on the
  // right for an action.
  const groups = groupRows(entries);
  const needs = needCount(needRuns, orchestrators, asks);
  const closing = closeAllControl(view, t, groups.done, ctx);
  const groupHead = (g, n) => {
    const head = h_flex().id(`crew-group-${g.key}`).flex_none().gap(5).px(4).pt(6).items_center()
      .text_size(10.5).font_semibold().text_color(g.key === "needs" ? t.blocked : t.dim);
    if (!g.folded) return head.child(`${g.title} · ${n}`);
    const open = isOpen(view, `crew-${g.key}`);
    return head.child(h_flex().id(`crew-fold-${g.key}`).gap(5).items_center().cursor_pointer().hover((st) => st.text_color(t.foreground))
      .on_click((_e, cx) => { view.folds ??= new Map(); view.folds.set(`crew-${g.key}`, !open); cx.notify(); })
      .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(10).flex_none())
      .child(`${g.title} · ${n}`))
      .child(div().flex_1())
      // Close all merged: Done's own action, shown folded or not.
      .when(g.key === "done" && Boolean(closing.button), (el) => el.child(closing.button));
  };
  for (const g of GROUPS) {
    const list = groups[g.key];
    const count = g.key === "needs" ? needs : list.length;
    const none = emptyNote(g, count, entries.length);
    // Needs you with nothing in it: one calm line in its place, styled as a heading.
    if (none) rows.push(h_flex().id(`crew-group-${g.key}`).flex_none().gap(5).px(4).pt(6).items_center().min_w(0).text_size(10.5)
      .child(div().flex_none().font_semibold().text_color(t.dim).child(g.title))
      .child(div().min_w(0).truncate().text_color(PASS(t)).child(none)));
    if (!count) continue;
    rows.push(groupHead(g, count));
    // The captain's open decisions count in Needs you; its own row, above, is where they are.
    const capNote = g.key === "needs" ? captainNeedNote(asks) : null;
    if (capNote) rows.push(div().id("crew-needs-captain").flex_none().px(4).min_w(0).truncate().text_size(10.5).text_color(t.dim).child(capNote));
    if (g.key === "done" && closing.confirm) rows.push(closing.confirm);
    if (!g.folded || isOpen(view, `crew-${g.key}`)) rows.push(...list.map((x) => (x.term ? orchRow(x) : runRow(x))));
  }
  // Adrift: agents outside the crew, on any machine.
  const drifters = adrift([cap.terminal?.address, ...orchestrators.map((o) => o.term.address)], ctx);
  const names = agentNames(drifters, (a) => a.space_name);
  const stray = (a, i) => h_flex().id(`adrift-${a.address}`).flex_none().gap(8).h(24).px(8).items_center().rounded(6).cursor_pointer()
    .when(a.focused, (el) => el.bg(t.selected)).hover((st) => st.bg(t.hover)).tooltip([names[i], a.title, `${a.space_name} · ${a.tab_name}`].filter((x, i, all) => x && all.indexOf(x) === i).join("\n"))
    .on_click(() => focusAgent(a.address))
    .child(programIcon(a.program, 13, t.muted))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(`${a.space_name} · ${names[i]}`))
    .map(withUsage(t, `adrift-${a.address}`, liveUsage(a.address), "This agent and its commands"))
    .child(statusDot(t, a.status));
  return v_flex().id("crew").size_full().min_h(0).bg(t.chrome).text_size(12.5)
    .child(div().flex_none().px(12).pt(8).pb(4).text_size(11.5).font_semibold().text_color(t.foreground).child("Crew"))
    .child(v_flex().id("crew-list").flex_1().min_h(0).px(8).pb(6).gap(4).overflow_y_scrollbar()
      .when(rows.length === 0, (el) => el.child(div().px(4).text_size(11.5).text_color(t.dim).child("No captain or orchestrators. Start one with /herdr-app-captain.")))
      .children(rows)
      .when(drifters.length > 0, (el) => el.child(div().flex_none().px(4).pt(6).text_size(10.5).font_semibold().text_color(t.dim).child(`Adrift · ${drifters.length}`)))
      .children(drifters.map(stray))
      .when(Boolean(view.actionNote), (el) => el.child(div().flex_none().px(4).pt(4).text_size(11).text_color(t.muted).child(view.actionNote)))
      .when(Boolean(view.actionError), (el) => el.child(div().flex_none().px(4).pt(4).text_size(11).text_color(t.blocked).child(view.actionError))));
}
