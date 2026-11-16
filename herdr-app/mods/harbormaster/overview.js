// The serious views: the runs overview (totals, what's waiting on you, captain, run cards) and the Crew block.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { stats, decisionQueue, answerRun, compactRun, isCompact, isBudgetQuestion, overBudget, dropDecision, runPhase, taskTone, taskCounts, taskAgents, shownStage, prsOf, relatedOf, unknownPr, oneWay, PR_TONE, isClosed, isParked, putAway, resumeRun, deleteRun, deleteRuns, newestFirst, runTime } from "./data.js";
import { facts, exactStatus, orchestratorsOf, orchestratorState, agentStatus, workersOf, captainOf, captainPane, paneBeside, togglePin, needsYou, needReason, adrift, agentNames, focusAgent, focusWithPane, currentAgent, openUrl, replyToCaptain, closeOwnPane } from "./live.js";
import { CAPTAIN, OCTOPUS, CRAB, programIcon, zoom, plural, ago, shortRef, stateText, runName, withTip, typeTag, autonomyTag } from "./ui.js";
import { tokenText } from "./context.js";
import { decidedText, decidedSummary } from "./decided.js";
import { proofVerdict, proofTasks } from "./proof.js";
import { oneLine } from "./question.js";
import { thumbs } from "./viewer.js";

// How each runPhase() reads on a card.
const PHASE = {
  running: { label: "Running", tone: "working" },
  waiting: { label: "Needs you", tone: "blocked" },
  blocked: { label: "Blocked", tone: "blocked" },
  finished: { label: "Finished", tone: "done" },
  unknown: { label: "Starting", tone: "dim" },
  parked: { label: "Parked", tone: "dim" },
  closed: { label: "Closed", tone: "dim" },
};

function pill(t, text, tone, solid = false) {
  const c = t[tone] ?? t.dim;
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
    .tooltip(`Context: ${c.tokens.toLocaleString("en")} tokens${c.model ? ` (${c.model})` : ""}, as of its last turn`
      + (run?.tokens ? `\nRun total: ${run.tokens.total.toLocaleString("en")} tokens, all its agents` : "")));
};

function statusDot(t, status) {
  if (status === "working") return svg("mods/harbormaster/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().size(8).flex_none().rounded(4).bg(t.blocked).loop("opacity", { from: 0.35, to: 1, period: 1100 });
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

// A PR's Merge danger on its row: red for a one-way door, dim otherwise, and a line that is neither shown as written; the tooltip has the whole line.
const dangerTag = (t, pr) => {
  const one = oneWay(pr.danger);
  const two = /^\W*two[- ]way/i.test(pr.danger);
  const text = one ? "One-way door" : two ? "Two-way door" : pr.danger.length > 28 ? pr.danger.slice(0, 27) + "…" : pr.danger;
  return div().flex_none().text_size(11).text_color(one ? t.blocked : t.dim).tooltip(pr.danger).child(text);
};

function prRow(t, pr, i) {
  const tone = PR_TONE[pr.state] ?? "dim";
  const c = pr.checks;
  const checkText = c.fail ? `✗ ${c.fail} failing` : c.pending ? `… ${c.pending} running` : c.pass ? `✓ ${c.pass}` : "";
  const checkTone = c.fail ? "blocked" : c.pending ? "working" : "done";
  const review = reviewText(pr);
  return h_flex().id(`pr-${i}-${pr.url}`).gap(7).items_center().h(24).px(6).rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(pr.url).on_click((_e, cx) => { cx.stop_propagation(); openUrl(pr.url); })
    .child(svg("mods/harbormaster/pr.svg").size(13).flex_none().text_color(t[tone] ?? t.dim))
    .child(div().flex_none().text_color(t.muted).child(pr.number ? `#${pr.number}` : "PR"))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(pr.title ?? pr.url))
    .when(Boolean(checkText), (el) => el.child(div().flex_none().text_size(11).text_color(t[checkTone]).child(checkText)))
    .when(Boolean(review), (el) => el.child(div().flex_none().text_size(11).text_color(t[review[1]]).child(review[0])))
    .when(Boolean(pr.danger), (el) => el.child(dangerTag(t, pr)))
    .child(pill(t, pr.state === "DRAFT" ? "Draft" : pr.state[0] + pr.state.slice(1).toLowerCase(), tone));
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
// pulse because an agent is at it. Review takes the accent, fixing the implementer's
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

// One segment per planned task, hover for its name and stage, and how many are done
// and under way below it; only for runs that plan at least one.
function taskStrip(t, r, counts, stages, names = true) {
  return v_flex().gap(5)
    .child(h_flex().gap(3).h(6).children(Array.from({ length: counts.planned }, (_, i) => {
      const task = r.tasks[i];
      const color = task ? taskColor(t, task, stages[i].stage) : i < counts.merged ? t.done : t.border;
      return div().id(`seg-${r.key}-${i}`).flex_1().h_full().rounded(3).bg(color)
        .when(Boolean(task), (el) => el.tooltip([[task.id, task.name].filter(Boolean).join(" "), stageText(task, stages[i].stage)].filter(Boolean).join(" · ")))
        .when(Boolean(task) && pulse(stages[i].stage, task), (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1400 }));
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

// What card() and runDetail() both show: the run's state, its links and the header row.
function runFacts(r, ctx) {
  const orch = orchestratorState(r, ctx);
  const parked = isParked(r);
  const need = needsYou(r, orch);
  const badge = (parked ? PHASE.parked : r.away?.how === "closed" ? PHASE.closed : PHASE[r.phase]) ?? PHASE.unknown;
  return {
    orch, parked, need, badge,
    closed: isClosed(r, ctx),
    reason: needReason(r, orch),
    counts: taskCounts(r),
    prs: prsOf(r) ?? r.prs.map((p) => unknownPr(p.url, p.repo)),
    related: relatedOf(r),
    workers: workersOf(r.terminal, ctx),
    stages: stagesOf(r, ctx),
  };
}

function cardHeader(view, t, r, f, meta) {
  return h_flex().gap(8).items_center()
    .child(div().flex_none().text_size(15).child(OCTOPUS))
    .child(v_flex().flex_1().min_w(0)
      .child(h_flex().gap(6).items_center().min_w(0)
        .when(Boolean(r.type), (el) => el.child(typeTag(t, r.type)))
        .child(autonomyTag(t, `auto-${r.key}`, r.autonomy))
        .when(Boolean(r.proof.tier), (el) => el.child(tierTag(t, `tier-${r.key}`, r.proof.tier.tier, `Proof tier${r.proof.tier.byUser ? " (set by user)" : ""}${r.tasks.some((k) => !k.proof) ? `; ${plural(r.tasks.filter((k) => !k.proof).length, "task")} not scoped` : ""}`)))
        .child(withTip(div().id(`title-${r.key}`).truncate().font_semibold().text_size(13.5).text_color(t.foreground), runName(r.branch, r.topic)))
        .when(Boolean(r.machine), (el) => el.child(div().flex_none().text_size(10.5).px(5).rounded(4).bg(t.raised).text_color(t.muted).child(r.machine))))
      .child(metaLine(t, r, meta)))
    .map(withContext(view, t, `run-${r.key}`, r.terminal))
    .child(runPin(t, `pin-${r.key}`, r, f.orch))
    .child(statusDot(t, f.orch))
    .child(pill(t, f.badge.label, f.need ? "blocked" : f.badge.tone, f.need));
}

function needBox(t, r, f) {
  return h_flex().gap(8).p(8).rounded(7).bg(t.blocked + "1c").items_start()
    .child(div().flex_none().text_color(t.blocked).font_bold().child(r.question ? "?" : "!"))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(11).font_semibold().text_color(t.blocked).child(r.question ? "Waiting for your answer — click to open the orchestrator" : "Needs you — click to open the orchestrator"))
      .child(div().text_size(12).text_color(t.foreground).child((f.reason ?? "").slice(0, 220))));
}

// The one-line notes under the progress: parked or closed, gone, waiting agents, unread messages.
function cardNotes(t, r, f) {
  const note = (text, tone = "muted") => div().text_size(11.5).text_color(t[tone]).child(text);
  return [
    r.away && note(`${f.parked ? "Parked" : "Closed"} ${ago(r.away.at)}${r.away.was ? ` · was: ${r.away.was}` : ""}`),
    !r.away && f.orch === "gone" && r.phase !== "finished" && note("Orchestrator is gone: resume, park or close this run.", "blocked"),
    !r.away && f.orch === "gone" && r.phase === "finished" && note("Orchestrator is gone, only a shell is left in its tab: resume it if the PR needs more work, or park or close the run."),
    r.waiting.length > 0 && note(`Waiting on an answer: ${r.waiting.join(", ")}`),
    r.unhandled > 0 && note(`${plural(r.unhandled, "relayed message")} not read yet`),
  ].filter(Boolean);
}

const unscopedOf = (r) => (r.proof.tier ? r.tasks.filter((k) => !k.proof).length : 0);
// The tokens segment: "26M tok", or "31M / 30M tok" in the blocked colour once over the soft budget.
const tokenMeta = (r) => (!r.tokens ? null : r.budget ? `${tokenText(r.tokens.total)} / ${tokenText(r.budget)} tok` : `${tokenText(r.tokens.total)} tok`);
const runMeta = (r, f) => [r.repo, f.workers.length ? plural(f.workers.length, "agent") : null, tokenMeta(r), unscopedOf(r) ? `${unscopedOf(r)} unscoped` : null, r.updated ? ago(r.updated) : null].filter(Boolean).join(" · ");
// The meta line as one text, or three when the tokens segment is over budget, to colour it.
const metaLine = (t, r, meta) => {
  const tok = tokenMeta(r), at = tok ? meta.indexOf(tok) : -1;
  const line = h_flex().min_w(0).text_size(11.5).text_color(t.dim);
  if (!overBudget(r) || at < 0) return div().truncate().text_size(11.5).text_color(t.dim).child(meta);
  return line.child(div().flex_none().child(meta.slice(0, at)))
    .child(div().id(`over-${r.key}`).flex_none().text_color(t.blocked).font_semibold().tooltip(`Over its soft budget of ${r.budget.toLocaleString("en")} tokens`).child(tok))
    .child(div().truncate().child(meta.slice(at + tok.length)));
};
const runEdge = (t, f) => (f.need ? t.blocked : t[f.badge.tone] ?? t.border);
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
  return v_flex().id(`run-${r.key}`).relative().overflow_hidden().flex_none().gap(8).p(12).pl(16).rounded(10).bg(t.surface)
    .border(1).border_color(need ? t.blocked + "88" : t.border).cursor_pointer()
    .hover((s) => s.bg(t.raised)).on_click(focus)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).bg(runEdge(t, f)))
    .child(cardHeader(view, t, r, f, runMeta(r, f)))
    .when(need, (el) => el.child(needBox(t, r, f)))
    .when(Boolean(r.progress), (el) => el.child(div().text_size(12.5).text_color(t.foreground).child(r.progress)))
    .when(!compact && counts.planned > 0, (el) => el.child(taskStrip(t, r, counts, f.stages)))
    .children(cardNotes(t, r, f))
    .when(r.decided.length > 0, (el) => el.child(decidedLine(t, r)))
    .when(prs.length > 0 || links.length > 0, (el) => el.child(v_flex().gap(1).text_size(12)
      .children(prs.map((p, i) => prRow(t, p, i)))
      .when(links.length > 0, (el) => el.child(h_flex().flex_wrap().gap(6).px(6).pt(2).children(links)))))
    .when(prs.length === 0 && related.length === 0 && r.phase !== "finished" && !compact, (el) => el.child(div().text_size(11).text_color(t.dim).child("No pull request yet")))
    .child(actionRow(view, t, r, orch, closed, counts));
}

// What the orchestrator decided for you: on the overview card the one summary line (counts and
// the latest decision); the pane has the same line, which expands to the list (decidedSection).
const decidedLine = (t, r) => div().truncate().text_size(11.5).text_color(t.dim).tooltip(r.decided.map(decidedText).join("\n"))
  .child(decidedSummary(r.decided));

// ---- one run on its own, as the pane pinned beside its orchestrator ----

const section = (t, title, ...rest) => v_flex().gap(4)
  .child(h_flex().gap(6).px(2).items_center().text_size(11).font_semibold().text_color(t.dim).child(title)
    .children(rest.filter(Boolean).map((x) => div().font_normal().child(x))));

// A PR as a row with room to spare: its whole title, then repo, checks and review.
function prDetail(t, pr, i, related = false) {
  const tone = PR_TONE[pr.state] ?? "dim";
  const c = pr.checks ?? {};
  const checkText = c.fail ? `✗ ${c.fail} failing` : c.pending ? `… ${c.pending} running` : c.pass ? `✓ ${c.pass} checks` : null;
  const checkTone = c.fail ? "blocked" : c.pending ? "working" : "done";
  const review = reviewText(pr);
  const state = prStateText(pr);
  return h_flex().id(`prd-${related ? "rel" : "own"}-${i}-${pr.url}`).gap(8).items_start().p(8).rounded(7).bg(t.raised + "88").cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(pr.url).on_click((_e, cx) => { cx.stop_propagation(); openUrl(pr.url); })
    .child(svg("mods/harbormaster/pr.svg").size(14).flex_none().mt(1).text_color(t[tone] ?? t.dim))
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(12.5).text_color(t.foreground).child(pr.title ?? pr.url))
      .child(h_flex().flex_wrap().gap_x(10).text_size(11).text_color(t.dim)
        .child(div().child(`${pr.repo ?? shortRef(pr.url)}${pr.number ? ` #${pr.number}` : ""}`))
        .when(Boolean(checkText), (el) => el.child(div().text_color(t[checkTone]).child(checkText)))
        .when(Boolean(review), (el) => el.child(div().text_color(t[review[1]]).child(review[0]))))
      .when(Boolean(pr.danger), (el) => el.child(div().text_size(11).text_color(oneWay(pr.danger) ? t.blocked : t.dim).child(`Merge danger: ${pr.danger}`))))
    .when(Boolean(state), (el) => el.child(pill(t, state, tone)));
}

// ---- proof ----

const RESULT_TONE = { pass: "done", fail: "blocked", partial: "working" };

// A tier as a small tag, "T2"; `tip` says what it is.
const tierTag = (t, id, tier, tip) => div().id(id).flex_none().text_size(10).font_semibold().px(5).rounded(4)
  .bg(t.raised).text_color(t.muted).tooltip(tip).child(`T${tier}`);

// A path under the run as a link that opens on this machine; for a run on another machine
// it is plain text, since nothing here can open a file there.
function pathLink(t, r, id, rel, label) {
  if (r.machine) return div().text_size(11).text_color(t.dim).tooltip(`On ${r.machine}`).child(`${label} (${r.dir}/${rel})`);
  return h_flex().id(id).gap(4).px(6).h(20).items_center().rounded(5).bg(t.raised).text_size(11).text_color(t.muted).cursor_pointer()
    .hover((s) => s.text_color(t.foreground)).tooltip(`Open ${r.dir}/${rel}`)
    .on_click((_e, cx) => { cx.stop_propagation(); openUrl(`${r.dir}/${rel}`); })
    .child(div().child("▤")).child(label);
}

// "Decided for you": one summary line, collapsed; a click lists every decision, newest first,
// and another collapses it. A line that did not parse shows as its raw text. Not persisted.
function decidedSection(view, t, r) {
  const open = view.decidedOpen?.has(r.key);
  const row = (d, i) => h_flex().id(`dec-${r.key}-${i}`).gap(8).items_start().px(2).text_size(11.5)
    .child(div().flex_none().w(46).text_color(t.dim).child(d.at ? ago(d.at) : "—"))
    .child(v_flex().flex_1().min_w(0)
      .child(div().text_color(t.foreground).child(`${d.by === "user" ? "You · " : ""}${d.topic ? `${d.topic}: ${d.decision}` : d.decision}`))
      .when(Boolean(d.why), (el) => el.child(div().text_size(11).text_color(t.dim).child(d.why))));
  return v_flex().gap(4)
    .child(h_flex().id(`dec-more-${r.key}`).gap(6).px(2).items_center().cursor_pointer().text_size(11.5).text_color(t.dim)
      .hover((s) => s.text_color(t.foreground)).tooltip(open ? "Hide the decisions" : "Show every decision")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        view.decidedOpen ??= new Set();
        if (open) view.decidedOpen.delete(r.key); else view.decidedOpen.add(r.key);
        cx.notify();
      })
      .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .child(div().flex_1().min_w(0).truncate().child(decidedSummary(r.decided))))
    .when(open, (el) => el.children(r.decided.map(row)));
}

// "Tokens": what the run has used, across its orchestrator and every agent it ran. Each
// agent's bar is stacked: fresh tokens (input, output, cache writes) in blue, cache reads in
// green; the exact numbers are on hover. The bars' scale is the run's total.
function tokensSection(t, r) {
  const { total, input, output, cacheRead, cacheWrite, byAgent, updated } = r.tokens;
  const n = (v) => v.toLocaleString("en");
  const fresh = (x) => x.input + x.output + x.cacheWrite;
  const tip = (x) => `fresh ${n(fresh(x))} (in ${n(x.input)}, out ${n(x.output)}, cache write ${n(x.cacheWrite)}) · cache read ${n(x.cacheRead)}`;
  const pct = (v) => `${((100 * v) / total).toFixed(2)}%`;
  const row = (a) => {
    // A count from before the split has only a total: all of it blue.
    const f = a.split ? fresh(a) : a.total;
    return h_flex().id(`tok-${r.key}-${a.name}`).gap(8).items_center().px(2).h(18).text_size(11.5)
      .tooltip(a.split ? `${a.name}: ${tip(a)}` : `${a.name}: ${n(a.total)} tokens`)
      .child(div().flex_none().w(96).truncate().text_color(a.name === "orchestrator" ? t.foreground : t.muted).child(a.name))
      .child(div().flex_1().min_w(0).h(5).rounded(3).bg(t.raised).overflow_hidden().flex()
        .child(div().h_full().flex_none().bg(t.accent ?? t.muted).w(pct(f)))
        .child(div().h_full().flex_none().bg(t.done).w(pct(a.split ? a.cacheRead : 0))))
      .child(div().flex_none().w(44).text_color(t.dim).child(tokenText(a.total)));
  };
  const all = { input, output, cacheRead, cacheWrite };
  return section(t, `Tokens · ${tokenText(total)}`, updated && `counted ${ago(updated)}`)
    .child(h_flex().id(`tok-${r.key}`).gap(10).px(2).text_size(11).tooltip(`${n(total)} tokens: ${tip(all)}`)
      .child(div().text_color(t.accent ?? t.muted).child(`fresh ${tokenText(fresh(all))}`))
      .child(div().text_color(t.done).child(`cache read ${tokenText(cacheRead)}`))
      .child(div().text_color(t.dim).child(`out ${tokenText(output)}`)))
    .when(Boolean(r.budget), (el) => el.child(div().id(`budget-${r.key}`).px(2).text_size(11).text_color(overBudget(r) ? t.blocked : t.dim)
      .tooltip("A soft budget: crossing it asks you whether to continue, compact or stop; nothing stops by itself")
      .child(`${overBudget(r) ? "Over" : "Under"} its soft budget of ${tokenText(r.budget)} tokens`)))
    .children(byAgent.map(row));
}

// The Proof section: one verdict line on top (tier, passes, what is missing, checks, merge
// danger), then one compact row per task: tier, name and result. A row's "Checked:", "Result:"
// and files show only when it is expanded. A finished run starts with the section collapsed to
// the verdict; a running one open. A click on the verdict or a row toggles it (not persisted).
function proofSection(view, t, r, prs) {
  const { tier, md, files } = r.proof;
  const danger = prs.find((p) => p.danger)?.danger;
  const verdict = proofVerdict({ tier, md, tasks: r.tasks, danger });
  // A run planned before proof lines existed: one quiet line, not a red row per task.
  if (!verdict) {
    // Files in shared/proof/ without a plan or proof.md still get their folder link.
    return section(t, "Proof").child(div().px(2).text_size(11.5).text_color(t.dim).child("No proof planned"))
      .when(files.length > 0, (el) => el.child(h_flex().px(2).pt(2)
        .child(pathLink(t, r, `pf-dir-${r.key}`, "shared/proof", `shared/proof/ · ${files.length >= 40 ? "40+ files" : plural(files.length, "file")}`))));
  }
  const over = view.proofOpen?.get(r.key);
  const finished = r.phase === "finished" || Boolean(r.away);
  const open = over ?? !finished;
  const toggle = (map, key, now) => (_e, cx) => {
    cx.stop_propagation();
    view[map] ??= map === "proofOpen" ? new Map() : new Set();
    if (map === "proofOpen") view[map].set(key, !now); else if (now) view[map].delete(key); else view[map].add(key);
    cx.notify();
  };
  const row = (k) => {
    const id = `${r.key}-${k.id}`;
    const more = view.proofRows?.has(id);
    const hasRes = Boolean(k.result);
    return v_flex().id(`pf-${id}`).gap(3).px(8).py(4).rounded(7).bg(t.raised + "88").cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(toggle("proofRows", id, more))
      .child(h_flex().gap(8).items_center()
        .child(k.tier !== null ? tierTag(t, `pft-${id}`, k.tier, k.planned ? "The proof tier this task is planned for" : "The proof tier recorded in proof.md") : div().flex_none().text_size(10).px(5).text_color(t.blocked).child("—"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).child(k.name ? `${k.id} ${k.name}` : k.id))
        .when(k.files.length > 0, (e) => e.child(thumbs(view, t, r, k.id, k.files)))
        .child(hasRes ? pill(t, k.result, RESULT_TONE[k.result]).tooltip(k.why || k.result)
          : k.scoped ? pill(t, "not checked", "dim") : pill(t, "not scoped", "blocked").tooltip("No Proof line in plan.md")))
      .when(more, (el) => el
        .child(div().text_size(11.5).text_color(k.planned ? t.muted : t.blocked).child(k.planned ? k.planned.text || "(no evidence named)" : "Not scoped: no Proof line in plan.md"))
        .when(Boolean(k.checked), (e) => e.child(div().text_size(11).text_color(t.dim).child(`Checked: ${k.checked}`)))
        .when(hasRes, (e) => e.child(div().text_size(11).text_color(t.dim).child(`Result: ${k.result}${k.why ? ` — ${k.why}` : ""}`)))
        .when(k.files.length > 0, (e) => e.child(div().text_size(11).text_color(t.dim).child(`Files: ${k.files.join(", ")}`))));
  };
  const rows = proofTasks(r.tasks, md);
  const unscoped = rows.filter((k) => !k.scoped).length;
  return v_flex().gap(4)
    .child(h_flex().id(`pf-head-${r.key}`).gap(6).px(2).items_center().cursor_pointer().text_size(11.5)
      .text_color(t[verdict.tone] ?? t.dim).hover((s) => s.opacity(0.8))
      .tooltip(open ? "Hide the tasks' proof" : "Show the tasks' proof")
      .on_click(toggle("proofOpen", r.key, open))
      .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(verdict.text))
      .when(unscoped > 0, (el) => el.child(div().flex_none().font_normal().text_color(t.dim).child(`${unscoped} not scoped`))))
    .when(open, (el) => el
      .children(rows.map(row))
      .when(rows.length === 0, (e) => e.child(div().px(2).text_size(11.5).text_color(t.dim).child("No tasks planned yet")))
      .child(h_flex().flex_wrap().gap(6).px(2).pt(2).items_center()
        .when(Boolean(md), (e) => e.child(pathLink(t, r, `pf-md-${r.key}`, "proof.md", "proof.md")))
        .when(files.length > 0, (e) => e.child(pathLink(t, r, `pf-dir-${r.key}`, "shared/proof", `shared/proof/ · ${files.length >= 40 ? "40+ files" : plural(files.length, "file")}`)))
        .when(!md && files.length === 0, (e) => e.child(div().text_size(11).text_color(t.dim).child("No proof captured yet")))));
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
  return v_flex().id(`run-${r.key}`).relative().overflow_hidden().flex_none().gap(14).p(14).pl(18).rounded(10).bg(t.surface)
    .border(1).border_color(need ? t.blocked + "88" : t.border)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).bg(runEdge(t, f)))
    .child(div().id(`head-${r.key}`).cursor_pointer().on_click(() => orch !== "gone" && focusAgent(r.terminal))
      .child(cardHeader(view, t, r, f, runMeta(r, f))))
    .when(need, (el) => el.child(div().id(`need-${r.key}`).cursor_pointer().on_click(() => focusAgent(r.terminal)).child(needBox(t, r, f))))
    .when(Boolean(r.progress) || cardNotes(t, r, f).length > 0, (el) => el.child(v_flex().gap(4)
      .when(Boolean(r.progress), (el) => el.child(div().text_size(13).text_color(t.foreground).child(r.progress)))
      .children(cardNotes(t, r, f))))
    .child(section(t, prs.length ? `Pull requests · ${prs.length}` : "Pull requests")
      .children(prs.map((p, i) => prDetail(t, p, i)))
      .when(prs.length === 0, (el) => el.child(div().px(2).text_size(11.5).text_color(t.dim).child(r.phase === "finished" ? "None" : "No pull request yet"))))
    .when(r.issues.length + related.length > 0, (el) => el.child(section(t, "Issues and related PRs")
      .children(r.issues.map((url) => issueRow(t, url)))
      .children(related.map((p, i) => prDetail(t, p, i, true)))))
    .when(counts.planned > 0 || r.tasks.length > 0, (el) => el.child(section(t, "Tasks", tasksText(r, counts, stages))
      .child(div().px(2).pb(2).child(taskStrip(t, r, counts, stages, false)))))
    .when(r.decided.length > 0, (el) => el.child(decidedSection(view, t, r)))
    .when(r.tasks.length > 0 || r.proof.tier || r.proof.md || r.proof.files.length > 0, (el) => el.child(proofSection(view, t, r, prs)))
    .when(Boolean(r.tokens), (el) => el.child(tokensSection(t, r)))
    .when(workers.length > 0, (el) => el.child(section(t, `Agents · ${workers.length}`)
      .children(workers.map((w) => workerRow(t, w, ctx, workOf.get(w.address), w.parent !== r.terminal)))))
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

// What the captain watches, from stats(): "2 runs, 1 finished".
const watchedText = (s) => [plural(s.live.length, "run"), s.docked.length ? `${s.docked.length} finished` : null].filter(Boolean).join(", ");

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
        .child(cap.watching ? `Watching ${watched}` : "Watcher is not running — ask the captain to watch")))
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
  const it = decisionQueue(view.runs, view.decisions, facts()).find((x) => x.id === view.replying);
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
    const open = view.replying === it.id;
    // A message waiting in the run's inbox counts too: someone else (the captain, by hand) answered.
    const sent = view.answered[it.id] !== undefined;
    const answered = sent || Boolean(it.answered);
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
    const replyBtn = it.kind !== "attention" && h_flex().id(it.id + "-reply").flex_none().items_center().px(8).h(22).rounded(5)
      .text_size(11).text_color(open ? t.accent : t.dim)
      .when(Boolean(why), (el) => el.opacity(0.45).tooltip(why))
      .when(!why, (el) => el.cursor_pointer().tooltip("Answer in your own words, without leaving the overview")
        .hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          view.replying = open ? null : it.id;
          view.reply.set_value("");
          if (!open) view.reply.focus();
          cx.notify();
        }))
      .child(open ? "Cancel" : "Reply");
    // /compact is typed into the orchestrator, so only while it sits idle or done.
    const orchNow = it.run ? exactStatus(it.run.terminal, ctx) ?? (orchestratorState(it.run, ctx) === "gone" ? "gone" : "unknown") : null;
    const compactWhy = (o) => (isCompact(o.label) && isBudgetQuestion(it) && !["idle", "done"].includes(orchNow)
      ? `Compact needs the orchestrator idle or done (it is ${orchNow})` : null);
    const buttons = !answered && !why && it.options.length > 0 && h_flex().flex_wrap().gap(6).pl(22)
      .children(it.options.map((o, i) => {
        const off = compactWhy(o);
        const b = actionButton(t, `${it.id}-opt-${i}`, i === it.recommended ? `★ ${o.label}` : o.label,
          `${o.text || o.label}${i === it.recommended ? " (recommended)" : ""}`,
          off ? null : (cx) => { sendAnswer(view, it, o.label, cx, true); }, i === it.recommended);
        return off ? b.tooltip(off) : b;
      }));
    return v_flex().id(it.id).gap(6).p(8).rounded(7).bg(t.surface)
      .child(h_flex().gap(8).items_start().child(body).when(Boolean(replyBtn), (el) => el.child(replyBtn)))
      .when(Boolean(buttons), (el) => el.child(buttons))
      .when(answered, (el) => el.child(div().pl(22).text_size(11).text_color(t.muted).child(it.run && runGone(it.run) ? "Waits in its inbox until the run is resumed" : sent ? "Answered, waiting for the orchestrator" : "Message waiting for the orchestrator")))
      .when(open, (el) => el.child(v_flex().gap(4)
        .child(Input.new(view.reply))
        .child(div().text_size(10.5).text_color(t.dim).child(it.kind === "decision" && cap.terminal ? "Enter sends it to the captain, with this decision attached" : it.run && runGone(it.run) ? "Enter writes it to the run's inbox, where it waits until the run is resumed" : "Enter writes it to the run's inbox and tells its orchestrator"))));
  };
  return v_flex().id("waiting").flex_none().gap(6).p(10).rounded(10).bg(t.blocked + "14").border(1).border_color(t.blocked + "66")
    .child(div().text_size(11.5).font_semibold().text_color(t.blocked).child(`Waiting on you · ${items.length}`))
    .children(items.map(row));
}

// The totals across runs, as small stats under the overview's title. "need you" counts
// the captain's open decisions and the runs that need you, and focuses the first of them.
function totals(t, s, decisions, ctx) {
  const stat = (id, value, label, tone, onClick) => h_flex().id(id).flex_none().gap(4).items_baseline().px(6).h(22).rounded(5)
    .when(Boolean(onClick), (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click(onClick))
    .child(div().text_size(13).font_semibold().text_color(tone ? t[tone] : t.foreground).child(String(value)))
    .child(div().text_size(11).text_color(t.dim).child(label));
  const firstNeed = (decisions.length ? captainOf(ctx).terminal?.address : null) ?? s.need[0]?.terminal;
  const needCount = s.need.length + decisions.length;
  return h_flex().flex_wrap().gap(2).items_center()
    .child(stat("t-runs", s.live.length, "running", null))
    .child(stat("t-need", needCount, "need you", needCount ? "blocked" : null, firstNeed ? () => focusAgent(firstNeed) : null))
    .when(s.docked.length > 0, (el) => el.child(stat("t-done", s.docked.length, "finished", "done")))
    .child(stat("t-agents", s.workers, s.workers === 1 ? "agent" : "agents", s.workers ? "working" : null))
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
  const needing = new Set(s.need);
  const sorted = (list) => [...list].sort(newestFirst);
  const live = [...sorted(s.need), ...sorted(s.live.filter((r) => !needing.has(r)))];
  const closed = sorted(s.closed);
  const narrow = (view.size?.width ?? 600) / zoom() < 360;
  const waiting = waitingOnYou(view, t, s, decisions, runs, ctx);
  return v_flex().id("root").size_full().min_h(0).bg(t.canvas ?? t.chrome).text_size(13)
    .on_size_change((size, cx) => { view.size = size; cx.notify(); })
    .child(v_flex().flex_none().px(10).pt(10).pb(6).gap(2)
      .child(div().px(4).text_size(11.5).font_medium().text_color(t.dim).child("Runs"))
      .child(totals(t, s, decisions, ctx)))
    .child(v_flex().id("runs-list").flex_1().min_h(0).px(10).pb(12).gap(8).overflow_y_scrollbar()
      .when(Boolean(waiting), (el) => el.child(waiting))
      .child(captainStrip(view, t, ctx, s))
      .when(s.shown.length === 0, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child("No runs in progress. Ask the captain to start one, e.g. “start issue 185 in my-app”.")))
      .children(live.map((r) => card(view, t, r, ctx, narrow)))
      .children(sorted(s.docked).map((r) => card(view, t, r, ctx, true)))
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
  // Unfinished orchestrators first, then finished ones still open.
  const orchestrators = orchestratorsOf(ctx)
    .map((term) => ({ term, r: runOf(term) }))
    .map((o) => ({ ...o, state: o.r?.phase ?? runPhase(o.term.labels?.["run.status"]) }))
    .sort((a, b) => (a.state === "finished") - (b.state === "finished"));
  // The focused agent, or the crew agent beside a focused Harbormaster pane.
  const current = currentAgent(ctx, [cap.terminal?.address, ...orchestrators.map((o) => o.term.address)].filter(Boolean));
  const row = ({ id, emoji, type = null, title, tip = null, detail, tone, status, address, edge, open = () => focusAgent(address), crabs = 0, run = null }) => h_flex().id(id).relative().overflow_hidden().flex_none().gap(8).py(6).pl(12).pr(8)
    .rounded(7).bg(address === current ? edge + "33" : edge + "14").cursor_pointer().hover((st) => st.bg(address === current ? edge + "40" : edge + "26"))
    .when(address === current, (el) => el.border(1).border_color(edge + "aa"))
    .on_click(open)
    .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(edge))
    .child(div().flex_none().text_size(15).child(emoji))
    .child(v_flex().flex_1().min_w(0)
      // The title gets the whole first line; the type tag and worker count lead the second,
      // so a narrow sidebar truncates the detail before them.
      .child(withTip(div().id(`${id}-title`).min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground), { title, tip }))
      .child(h_flex().gap(6).items_center().min_w(0)
        .when(Boolean(type), (el) => el.child(typeTag(t, type)))
        .when(crabs > 0, (el) => el.child(h_flex().flex_none().gap(3).items_center().text_size(11).text_color(t.muted)
          .child(div().text_size(11).child(CRAB)).child(String(crabs))))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t[tone] ?? t.dim).child(detail))))
    .map(withContext(view, t, id, address, run))
    .child(statusDot(t, status));
  const rows = [];
  if (cap.terminal) {
    // The same counts as the overview: runs still working, and finished ones still open.
    const watched = watchedText(stats(view.runs, ctx));
    const asks = view.decisions?.length ?? 0;
    rows.push(row({
      id: "crew-captain", emoji: CAPTAIN, title: "Captain",
      // Clicking the captain also opens the runs overview beside it.
      open: () => focusWithPane(cap.terminal.address),
      detail: [asks ? `asks you: ${plural(asks, "decision")}` : null, cap.watching ? `on watch · ${watched}` : "not watching runs"].filter(Boolean).join(" · "),
      tone: asks || !cap.watching ? "blocked" : "muted", status: agentStatus(cap.terminal, ctx), address: cap.terminal.address, edge: t.accent,
    }));
  }
  for (const { term, r, state } of orchestrators) {
    const labels = term.labels ?? {};
    const status = agentStatus(term, ctx);
    // Without a run directory, the run.status label stands in for the run.
    const run = r ?? { phase: state };
    const need = needsYou(run, status);
    const reason = needReason(run, status);
    const prs = r ? prsOf(r) : null;
    const prText = prs?.length ? prs.map((p) => (p.number ? `PR #${p.number}` : "PR")).join(", ")
      : labels["run.prs"] ? plural(String(labels["run.prs"]).split(/[\s,]+/).filter(Boolean).length, "PR") : null;
    const workers = workersOf(term.address, ctx).length;
    const detail = (need ? [`needs you: ${reason}`]
      : state === "finished" ? ["finished", prText]
      : [state !== "running" ? (PHASE[state] ?? PHASE.unknown).label.toLowerCase() : null, labels.progress ?? r?.progress, prText]
    ).filter(Boolean).join(" · ");
    rows.push(row({
      id: `crew-${term.address}`, emoji: OCTOPUS, detail: detail || "orchestrator",
      // The run's type, then its number and topic; without a topic, its branch.
      type: labels["run.type"] || r?.type || null,
      ...runName(r?.branch ?? term.name ?? term.address, labels["run.topic"] ?? r?.topic),
      tone: need ? "blocked" : "muted", status, address: term.address, crabs: state === "finished" ? 0 : workers, run: r,
      // Clicking a run's orchestrator also opens that run's card beside it, while it's there.
      open: () => (r && cardBesideOrchestrator(r, orchestratorState(r, ctx)) ? focusWithPane(term.address, runProps(r)) : focusAgent(term.address)),
      edge: (need ? t.blocked : state === "finished" ? t.done : t.working) ?? t.border,
    }));
  }
  // Adrift: agents outside the crew, on any machine.
  const drifters = adrift([cap.terminal?.address, ...orchestrators.map((o) => o.term.address)], ctx);
  const names = agentNames(drifters, (a) => a.space_name);
  const stray = (a, i) => h_flex().id(`adrift-${a.address}`).flex_none().gap(8).h(24).px(8).items_center().rounded(6).cursor_pointer()
    .when(a.focused, (el) => el.bg(t.selected)).hover((st) => st.bg(t.hover)).tooltip([names[i], a.title, `${a.space_name} · ${a.tab_name}`].filter((x, i, all) => x && all.indexOf(x) === i).join("\n"))
    .on_click(() => focusAgent(a.address))
    .child(programIcon(a.program, 13, t.muted))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(`${a.space_name} · ${names[i]}`))
    .child(statusDot(t, a.status));
  return v_flex().id("crew").size_full().min_h(0).bg(t.chrome).text_size(12.5)
    .child(div().flex_none().px(12).pt(8).pb(4).text_size(11.5).font_semibold().text_color(t.foreground).child("Crew"))
    .child(v_flex().id("crew-list").flex_1().min_h(0).px(8).pb(6).gap(4).overflow_y_scrollbar()
      .when(rows.length === 0, (el) => el.child(div().px(4).text_size(11.5).text_color(t.dim).child("No captain or orchestrators. Start one with /herdr-app-captain.")))
      .children(rows)
      .when(drifters.length > 0, (el) => el.child(div().flex_none().px(4).pt(6).text_size(10.5).font_semibold().text_color(t.dim).child(`Adrift · ${drifters.length}`)))
      .children(drifters.map(stray)));
}
