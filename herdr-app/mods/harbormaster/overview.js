// The serious views: the runs overview (totals, what's waiting on you, captain, run cards) and the Crew block.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { stats, runPhase, taskTone, taskCounts, prsOf, relatedOf, unknownPr, PR_TONE, isClosed, isParked, putAway, resumeRun, deleteRun } from "./data.js";
import { facts, orchestratorsOf, orchestratorState, agentStatus, workersOf, captainOf, captainPane, paneBeside, togglePin, needsYou, needReason, adrift, agentNames, focusAgent, currentAgent, openUrl, replyToCaptain } from "./live.js";
import { CAPTAIN, OCTOPUS, CRAB, programIcon, zoom, plural, ago, shortRef, stateText } from "./ui.js";
import { tokenText } from "./context.js";

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
// when unknown. For .map() on the row it goes in.
const withContext = (view, t, id, address) => (el) => {
  const c = view.contexts?.[address];
  if (!c) return el;
  return el.child(div().id(`${id}-ctx`).flex_none().text_size(10.5).text_color(t.dim).child(tokenText(c.tokens))
    .tooltip(`Context: ${c.tokens.toLocaleString("en")} tokens${c.model ? ` (${c.model})` : ""}, as of its last turn`));
};

function statusDot(t, status) {
  if (status === "working") return svg("mods/harbormaster/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().size(8).flex_none().rounded(4).bg(t.blocked).loop("opacity", { from: 0.35, to: 1, period: 1100 });
  if (status === "gone") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.dim);
  if (status === "idle") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(8).flex_none().rounded(4).bg(t[status] ?? t.dim);
}

function prRow(t, pr, i) {
  const tone = PR_TONE[pr.state] ?? "dim";
  const c = pr.checks;
  const checkText = c.fail ? `✗ ${c.fail} failing` : c.pending ? `… ${c.pending} running` : c.pass ? `✓ ${c.pass}` : "";
  const checkTone = c.fail ? "blocked" : c.pending ? "working" : "done";
  const review = { APPROVED: ["Approved", "done"], CHANGES_REQUESTED: ["Changes requested", "blocked"], REVIEW_REQUIRED: ["Review needed", "dim"] }[pr.review];
  return h_flex().id(`pr-${i}-${pr.url}`).gap(7).items_center().h(24).px(6).rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(pr.url).on_click((_e, cx) => { cx.stop_propagation(); openUrl(pr.url); })
    .child(svg("mods/harbormaster/pr.svg").size(13).flex_none().text_color(t[tone] ?? t.dim))
    .child(div().flex_none().text_color(t.muted).child(pr.number ? `#${pr.number}` : "PR"))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(pr.title ?? pr.url))
    .when(Boolean(checkText), (el) => el.child(div().flex_none().text_size(11).text_color(t[checkTone]).child(checkText)))
    .when(Boolean(review), (el) => el.child(div().flex_none().text_size(11).text_color(t[review[1]]).child(review[0])))
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

// One segment per planned task; only for runs that plan at least one.
function taskStrip(t, r, counts, names = true) {
  return v_flex().gap(5)
    .child(h_flex().gap(3).h(6).children(Array.from({ length: counts.planned }, (_, i) => {
      const task = r.tasks[i];
      const tone = task ? taskTone(task.state) : i < counts.merged ? "done" : null;
      return div().flex_1().h_full().rounded(3).bg(tone ? t[tone] : t.border)
        .when(tone === "working", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1400 }));
    })))
    .when(names && r.tasks.length > 0, (el) => el.child(h_flex().flex_wrap().gap_x(10).text_size(11).text_color(t.dim)
      .children(r.tasks.map((task) => h_flex().gap(4).items_center()
        .child(div().size(6).rounded(3).bg(t[taskTone(task.state)] ?? t.border))
        .child(div().text_color(task.state === "merged" ? t.dim : t.muted).child([task.id, task.name].filter(Boolean).join(" ")))
        .child(div().text_color(t.dim).child(stateText(task.state)))))));
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
  };
}

function cardHeader(view, t, r, f, meta) {
  return h_flex().gap(8).items_center()
    .child(div().flex_none().text_size(15).child(OCTOPUS))
    .child(v_flex().flex_1().min_w(0)
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().truncate().font_semibold().text_size(13.5).text_color(t.foreground).child(r.branch))
        .when(Boolean(r.machine), (el) => el.child(div().flex_none().text_size(10.5).px(5).rounded(4).bg(t.raised).text_color(t.muted).child(r.machine))))
      .child(div().truncate().text_size(11.5).text_color(t.dim).child(meta)))
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

const runMeta = (r, f) => [r.repo, f.workers.length ? plural(f.workers.length, "agent") : null, r.updated ? ago(r.updated) : null].filter(Boolean).join(" · ");
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
    .when(!compact && counts.planned > 0, (el) => el.child(taskStrip(t, r, counts)))
    .children(cardNotes(t, r, f))
    .when(prs.length > 0 || links.length > 0, (el) => el.child(v_flex().gap(1).text_size(12)
      .children(prs.map((p, i) => prRow(t, p, i)))
      .when(links.length > 0, (el) => el.child(h_flex().flex_wrap().gap(6).px(6).pt(2).children(links)))))
    .when(prs.length === 0 && related.length === 0 && r.phase !== "finished" && !compact, (el) => el.child(div().text_size(11).text_color(t.dim).child("No pull request yet")))
    .child(actionRow(view, t, r, orch, closed, counts));
}

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
  const review = { APPROVED: ["Approved", "done"], CHANGES_REQUESTED: ["Changes requested", "blocked"], REVIEW_REQUIRED: ["Review needed", "dim"] }[pr.review];
  const state = prStateText(pr);
  return h_flex().id(`prd-${related ? "rel" : "own"}-${i}-${pr.url}`).gap(8).items_start().p(8).rounded(7).bg(t.raised + "88").cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(pr.url).on_click((_e, cx) => { cx.stop_propagation(); openUrl(pr.url); })
    .child(svg("mods/harbormaster/pr.svg").size(14).flex_none().mt(1).text_color(t[tone] ?? t.dim))
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(12.5).text_color(t.foreground).child(pr.title ?? pr.url))
      .child(h_flex().flex_wrap().gap_x(10).text_size(11).text_color(t.dim)
        .child(div().child(`${pr.repo ?? shortRef(pr.url)}${pr.number ? ` #${pr.number}` : ""}`))
        .when(Boolean(checkText), (el) => el.child(div().text_color(t[checkTone]).child(checkText)))
        .when(Boolean(review), (el) => el.child(div().text_color(t[review[1]]).child(review[0])))))
    .when(Boolean(state), (el) => el.child(pill(t, state, tone)));
}

function issueRow(t, url) {
  return h_flex().id(`isd-${url}`).gap(8).items_center().h(28).px(8).rounded(7).bg(t.raised + "88").cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(url).on_click((_e, cx) => { cx.stop_propagation(); openUrl(url); })
    .child(div().flex_none().w(14).text_color(t.muted).child("◎"))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(shortRef(url)));
}

function taskRow(t, task, i) {
  const tone = taskTone(task.state);
  const done = tone === "done";
  const title = [task.id, task.name].filter(Boolean).join(" ");
  return h_flex().id(`task-${i}-${task.id}`).gap(8).items_center().h(24).px(8).rounded(6)
    .when(Boolean(task.about), (el) => el.tooltip(task.about))
    .child(div().size(7).flex_none().rounded(4).bg(t[tone] ?? t.border)
      .when(tone === "working", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1400 })))
    .child(div().flex_none().text_size(12).font_medium().text_color(done ? t.muted : t.foreground).child(title))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(task.about ?? ""))
    .child(div().flex_none().text_size(11).text_color(tone ? t[tone] : t.dim).child(stateText(task.state)));
}

function workerRow(t, w, ctx) {
  const status = agentStatus(w, ctx);
  return h_flex().id(`wk-${w.address}`).gap(8).items_center().h(24).px(8).rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); focusAgent(w.address); })
    .child(div().flex_none().text_size(13).child(CRAB))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(w.name ?? w.address))
    .child(statusDot(t, status));
}

// The run's card laid out for a pane of its own: the same header, need, progress and
// buttons, then its PRs with their whole titles, issues and related PRs one per row,
// every task with its state and what it is about, and the agents working on it.
function runDetail(view, t, r, ctx) {
  const f = runFacts(r, ctx);
  const { orch, closed, need, counts, prs, related, workers } = f;
  const done = r.tasks.filter((task) => taskTone(task.state) === "done").length;
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
    .when(counts.planned > 0 || r.tasks.length > 0, (el) => el.child(section(t, "Tasks", `${r.tasks.length ? done : counts.merged}/${counts.planned} done`)
      .child(div().px(2).pb(2).child(taskStrip(t, r, counts, false)))
      .children(r.tasks.map((task, i) => taskRow(t, task, i)))))
    .when(workers.length > 0, (el) => el.child(section(t, `Agents · ${workers.length}`).children(workers.map((w) => workerRow(t, w, ctx)))))
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
    .on_click((_e, cx) => { cx.stop_propagation(); togglePin(spot, run ? { role: "run", run: run.key } : undefined); })
    .child(svg("mods/harbormaster/pin.svg").size(13))
    .when(labelled, (el) => el.child(spot.pinned ? "Unpin" : `Pin beside ${who}`));
}

// The pin for a run's card beside its orchestrator, while the orchestrator is there.
const runPin = (t, id, r, orch) => (r.terminal && orch !== "gone" && !r.away ? pinButton(t, id, paneBeside(r.terminal), { run: r }) : div());

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

// Sends the inline reply to the captain as an answer to the decision being replied to.
export function submitReply(view, cx) {
  const text = view.reply.value().trim();
  const d = view.decisions.find((x) => x.key === view.replying);
  const cap = captainOf(facts()).terminal;
  if (!text || !d || !cap) return;
  replyToCaptain(cap.address, d, text);
  view.reply.set_value("");
  view.replying = null;
  cx.notify();
}

// Everything waiting on the person, in one list at the top of the overview: the captain's
// open decisions (decisions.sh), oldest first, then each run that needs them, with what
// for. A decision clicks through to the captain, a run to its orchestrator.
function waitingOnYou(view, t, s, decisions, runs, ctx) {
  const cap = captainOf(ctx);
  const runName = (d) => {
    if (!d.run) return null;
    const r = runs.find((x) => x.dir === d.run && x.machine === d.machine);
    return r?.branch ?? d.run.split("/").pop();
  };
  const items = [
    ...decisions.map((d) => ({
      id: `dec-${d.key}`, emoji: CAPTAIN, decision: d, text: d.question, address: cap.terminal?.address,
      meta: ["captain asks", runName(d), d.machine, d.asked ? ago(d.asked) : null],
      tip: cap.terminal ? "Click to open the captain, or Reply to answer this decision from here" : "The captain isn't running; start /herdr-app-captain to answer",
    })),
    ...s.need.map((r) => {
      const orch = orchestratorState(r, ctx);
      return {
        id: `need-${r.key}`, emoji: OCTOPUS, text: needReason(r, orch) ?? "needs you", address: r.terminal,
        meta: [r.branch, r.machine, r.question ? "question" : orch === "blocked" ? "dialog" : r.phase, r.updated ? ago(r.updated) : null],
        tip: "Click to open the orchestrator",
      };
    }),
  ];
  if (!items.length) return null;
  const row = (it) => {
    const d = it.decision;
    const open = d && view.replying === d.key;
    const body = h_flex().id(it.id + "-body").flex_1().min_w(0).gap(8).items_start()
      .when(Boolean(it.address), (el) => el.cursor_pointer().on_click(() => focusAgent(it.address)))
      .child(div().flex_none().text_size(14).child(it.emoji))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12.5).text_color(t.foreground).child(it.text.slice(0, 300)))
        .child(div().truncate().text_size(11).text_color(t.dim).child(it.meta.filter(Boolean).join(" · "))));
    const replyBtn = d && cap.terminal && h_flex().id(it.id + "-reply").flex_none().items_center().px(8).h(22).rounded(5)
      .text_size(11).text_color(open ? t.accent : t.dim).cursor_pointer().tooltip("Answer this decision without leaving the overview")
      .hover((st) => st.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        view.replying = open ? null : d.key;
        view.reply.set_value("");
        if (!open) view.reply.focus();
        cx.notify();
      })
      .child(open ? "Cancel" : "Reply");
    return v_flex().id(it.id).gap(6).p(8).rounded(7).bg(t.surface).tooltip(it.tip)
      .hover((st) => st.bg(t.raised))
      .child(h_flex().gap(8).items_start().child(body).when(Boolean(replyBtn), (el) => el.child(replyBtn)))
      .when(open, (el) => el.child(v_flex().gap(4)
        .child(Input.new(view.reply))
        .child(div().text_size(10.5).text_color(t.dim).child("Enter sends it to the captain, with this decision attached"))));
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

// The cards list: what's waiting on you, captain, runs that need you, the others, finished
// runs still open, then closed runs folded.
export function cards(view, t, runs, errors, decisions = []) {
  const ctx = facts();
  const s = stats(runs, ctx);
  const needing = new Set(s.need);
  const live = [...s.need, ...s.live.filter((r) => !needing.has(r))];
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
      .children(s.docked.map((r) => card(view, t, r, ctx, true)))
      .when(s.parked.length > 0, (el) => el.child(div().pt(6).px(4).text_size(11).font_semibold().text_color(t.dim).child(`Parked · ${s.parked.length}`)))
      .children(s.parked.map((r) => card(view, t, r, ctx, true)))
      .when(s.closed.length > 0, (el) => el.child(h_flex().id("finished-toggle").pt(6).px(4).gap(6).items_center().text_size(11).text_color(t.dim).cursor_pointer()
        .hover((st) => st.text_color(t.foreground))
        .on_click((_e, cx) => { view.showDone = !view.showDone; cx.notify(); })
        .child(svg(`mods/harbormaster/chevron-${view.showDone ? "down" : "right"}.svg`).size(11))
        .child(`${s.closed.length} closed`)))
      .when(Boolean(view.showDone), (el) => el.children(s.closed.map((r) => card(view, t, r, ctx, true))))
      .when(Boolean(view.actionNote), (el) => el.child(div().px(4).text_size(11).text_color(t.muted).child(view.actionNote)))
      .when(Boolean(view.actionError), (el) => el.child(div().px(4).text_size(11).text_color(t.blocked).child(view.actionError)))
      .when(errors.length > 0, (el) => el.child(div().px(4).text_size(11).text_color(t.blocked).child(errors.join("\n")))));
}

// One run's card, as a pane pinned beside its orchestrator (props().run is the run's key).
export function runPane(view, t, key) {
  const ctx = facts();
  const r = view.runs.find((x) => x.key === key);
  return v_flex().id("run-pane").size_full().min_h(0).bg(t.canvas ?? t.chrome).text_size(13)
    .child(v_flex().id("run-pane-list").flex_1().min_h(0).p(10).gap(8).overflow_y_scrollbar()
      .child(r ? runDetail(view, t, r, ctx) : div().p(12).text_size(12).text_color(t.dim)
        .child(view.runs.length ? "This run is no longer in the harbor. Close this pane." : "Reading the run…"))
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
  const row = ({ id, emoji, title, detail, tone, status, address, edge, pin = null }) => h_flex().id(id).relative().overflow_hidden().flex_none().gap(8).py(6).pl(12).pr(8)
    .rounded(7).bg(address === current ? edge + "33" : edge + "14").cursor_pointer().hover((st) => st.bg(address === current ? edge + "40" : edge + "26"))
    .when(address === current, (el) => el.border(1).border_color(edge + "aa"))
    .on_click(() => focusAgent(address))
    .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(edge))
    .child(div().flex_none().text_size(15).child(emoji))
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
      .child(div().truncate().text_size(11).text_color(t[tone] ?? t.dim).child(detail)))
    .when(Boolean(pin), (el) => el.child(pin))
    .map(withContext(view, t, id, address))
    .child(statusDot(t, status));
  const rows = [];
  if (cap.terminal) {
    // The same counts as the overview: runs still working, and finished ones still open.
    const watched = watchedText(stats(view.runs, ctx));
    const asks = view.decisions?.length ?? 0;
    rows.push(row({
      id: "crew-captain", emoji: CAPTAIN, title: "Captain", pin: pinButton(t, "crew-pin-captain", captainPane(ctx)),
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
      : [state !== "running" ? (PHASE[state] ?? PHASE.unknown).label.toLowerCase() : null, labels.progress ?? r?.progress, workers ? `${CRAB} ${workers}` : null, prText]
    ).filter(Boolean).join(" · ");
    rows.push(row({
      id: `crew-${term.address}`, emoji: OCTOPUS, title: r?.branch ?? term.name ?? term.address, detail: detail || "orchestrator",
      tone: need ? "blocked" : "muted", status, address: term.address,
      pin: r ? runPin(t, `crew-pin-${term.address}`, r, orchestratorState(r, ctx)) : null,
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
