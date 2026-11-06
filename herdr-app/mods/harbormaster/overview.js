// The serious views: the runs overview (totals, what's waiting on you, captain, run cards) and the Crew block.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { stats, runPhase, taskTone, taskCounts, prsOf, relatedOf, unknownPr, PR_TONE, isClosed, isParked, putAway, resumeRun, deleteRun } from "./data.js";
import { facts, orchestratorsOf, orchestratorState, agentStatus, workersOf, captainOf, captainPane, togglePin, needsYou, needReason, adrift, agentNames, focusAgent, openUrl, replyToCaptain } from "./live.js";
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
function taskStrip(t, r, counts) {
  return v_flex().gap(5)
    .child(h_flex().gap(3).h(6).children(Array.from({ length: counts.planned }, (_, i) => {
      const task = r.tasks[i];
      const tone = task ? taskTone(task.state) : i < counts.merged ? "done" : null;
      return div().flex_1().h_full().rounded(3).bg(tone ? t[tone] : t.border)
        .when(tone === "working", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1400 }));
    })))
    .when(r.tasks.length > 0, (el) => el.child(h_flex().flex_wrap().gap_x(10).text_size(11).text_color(t.dim)
      .children(r.tasks.map((task) => h_flex().gap(4).items_center()
        .child(div().size(6).rounded(3).bg(t[taskTone(task.state)] ?? t.border))
        .child(div().text_color(task.state === "merged" ? t.dim : t.muted).child(`${task.id} ${task.name}`))
        .child(div().text_color(t.dim).child(stateText(task.state)))))));
}

// What a card offers: Park and Close while its orchestrator runs (Close alone once
// finished), Resume and Close once it is gone or parked, Resume and Delete once closed.
function actionsOf(r, orch, closed) {
  if (closed) return ["resume", "delete"];
  if (isParked(r) || orch === "gone") return ["resume", "close"];
  return r.phase === "finished" ? ["close"] : ["park", "close"];
}

const ACTION = {
  park: { label: "Park", tip: "Set this run aside: closes its orchestrator's tab; resume it any time" },
  close: { label: "Close", tip: "Close this run for good: its orchestrator ends its agents, deletes the run's worktrees once their code is pushed, and closes its tab; it can still be resumed" },
  delete: { label: "Delete", tip: "Delete this run for good: its run directory goes, so it leaves Harbormaster and can't be resumed; branches and PRs stay" },
  resume: { label: "Resume", tip: "Start a new orchestrator that picks this run up where it stopped" },
};

// The question a card asks before acting, naming what is left.
function confirmText(r, action, counts) {
  const left = [counts.planned ? `${counts.merged} of ${counts.planned} tasks done` : null,
    r.prs.length ? plural(r.prs.length, "PR") + " stay open" : null].filter(Boolean).join(", ");
  if (action === "park") return `Park ${r.branch}? Its orchestrator and agents end; the run waits here until you resume it.${left ? ` ${left}.` : ""}`;
  const clean = "Its orchestrator pushes what isn't pushed, deletes the worktrees and closes its tab; branches and PRs stay.";
  if (action === "close") return r.phase === "finished" ? `Close ${r.branch}? ${clean}`
    : `Close ${r.branch} for good, unfinished?${left ? ` ${left}.` : ""} ${clean}`;
  if (action === "delete") return `Delete ${r.branch} for good? Its run directory goes: spec, plan, decisions and status, so it can't be resumed. This can't be undone. Branches and PRs stay on git and GitHub.`;
  return `Resume ${r.branch}? A new orchestrator starts in ${r.repo}${r.machine ? ` on ${r.machine}` : ""}, restarting unfinished tasks.`;
}

function actionButton(t, id, label, tip, onClick, primary = false) {
  return div().id(id).flex_none().px(9).h(22).rounded(5).flex().items_center().cursor_pointer().text_size(11.5).font_medium()
    .bg(primary ? t.accent : t.raised).text_color(primary ? t.background : t.muted).tooltip(tip ?? label)
    .hover((s) => s.opacity(0.85).text_color(primary ? t.background : t.foreground))
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(label);
}

// The card's buttons, or, after one is clicked, its question with a confirm and Cancel.
// It asks on the card, not in the app's confirm dialog, which can only run a Herdr
// command, not putAway's marker write.
function actionRow(view, t, r, orch, closed, counts) {
  const asking = view.confirm?.key === r.key ? view.confirm.action : null;
  const set = (cx, value) => { view.confirm = value; view.actionError = null; view.actionNote = null; cx.notify(); };
  if (asking) {
    const yes = (cx) => {
      set(cx, null);
      if (asking === "resume") resumeRun(r);
      else if (asking === "delete") deleteRun(r)
        .then(() => cx.notify())
        .catch((e) => { view.actionError = `${r.branch}: ${e?.message ?? e}`; cx.notify(); });
      else putAway(r, asking === "park" ? "parked" : "closed", orch)
        .then((note) => { if (note) { view.actionNote = `${r.branch}: ${note}`; cx.notify(); } })
        .catch((e) => { view.actionError = `${r.branch}: ${e?.message ?? e}`; cx.notify(); });
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

function card(view, t, r, ctx, compact = false) {
  const orch = orchestratorState(r, ctx);
  const closed = isClosed(r, ctx);
  const parked = isParked(r);
  const need = needsYou(r, orch);
  const reason = needReason(r, orch);
  const badge = (parked ? PHASE.parked : r.away?.how === "closed" ? PHASE.closed : PHASE[r.phase]) ?? PHASE.unknown;
  const counts = taskCounts(r);
  const prs = prsOf(r) ?? r.prs.map((p) => unknownPr(p.url, p.repo));
  const related = relatedOf(r);
  const links = [
    ...r.issues.map((url) => linkChip(t, `is-${r.key}-${url}`, url, div().child("◎"))),
    ...related.map((p) => linkChip(t, `rel-${r.key}-${p.url}`, p.url,
      svg("mods/harbormaster/pr.svg").size(11).flex_none().text_color(t[PR_TONE[p.state]] ?? t.dim),
      [p.number ? p.title : null, prStateText(p), p.url].filter(Boolean).join(" · "))),
  ];
  const workers = workersOf(r.terminal, ctx);
  const edge = need ? t.blocked : t[badge.tone] ?? t.border;
  const focus = () => orch !== "gone" && focusAgent(r.terminal);
  const meta = [r.repo, workers.length ? plural(workers.length, "agent") : null, r.updated ? ago(r.updated) : null].filter(Boolean).join(" · ");
  return v_flex().id(`run-${r.key}`).relative().overflow_hidden().flex_none().gap(8).p(12).pl(16).rounded(10).bg(t.surface)
    .border(1).border_color(need ? t.blocked + "88" : t.border).cursor_pointer()
    .hover((s) => s.bg(t.raised)).on_click(focus)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).bg(edge))
    .child(h_flex().gap(8).items_center()
      .child(div().flex_none().text_size(15).child(OCTOPUS))
      .child(v_flex().flex_1().min_w(0)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().truncate().font_semibold().text_size(13.5).text_color(t.foreground).child(r.branch))
          .when(Boolean(r.machine), (el) => el.child(div().flex_none().text_size(10.5).px(5).rounded(4).bg(t.raised).text_color(t.muted).child(r.machine))))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(meta)))
      .map(withContext(view, t, `run-${r.key}`, r.terminal))
      .child(statusDot(t, orch))
      .child(pill(t, badge.label, need ? "blocked" : badge.tone, need)))
    .when(need, (el) => el.child(h_flex().gap(8).p(8).rounded(7).bg(t.blocked + "1c").items_start()
      .child(div().flex_none().text_color(t.blocked).font_bold().child(r.question ? "?" : "!"))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(11).font_semibold().text_color(t.blocked).child(r.question ? "Waiting for your answer — click to open the orchestrator" : "Needs you — click to open the orchestrator"))
        .child(div().text_size(12).text_color(t.foreground).child((reason ?? "").slice(0, 220))))))
    .when(Boolean(r.progress), (el) => el.child(div().text_size(12.5).text_color(t.foreground).child(r.progress)))
    .when(!compact && counts.planned > 0, (el) => el.child(taskStrip(t, r, counts)))
    .when(Boolean(r.away), (el) => el.child(div().text_size(11.5).text_color(t.muted)
      .child(`${parked ? "Parked" : "Closed"} ${ago(r.away.at)}${r.away.was ? ` · was: ${r.away.was}` : ""}`)))
    .when(!r.away && orch === "gone" && r.phase !== "finished", (el) => el.child(div().text_size(11.5).text_color(t.blocked).child("Orchestrator is gone: resume or close this run.")))
    .when(r.waiting.length > 0, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`Waiting on an answer: ${r.waiting.join(", ")}`)))
    .when(r.unhandled > 0, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`${plural(r.unhandled, "relayed message")} not read yet`)))
    .when(prs.length > 0 || links.length > 0, (el) => el.child(v_flex().gap(1).text_size(12)
      .children(prs.map((p, i) => prRow(t, p, i)))
      .when(links.length > 0, (el) => el.child(h_flex().flex_wrap().gap(6).px(6).pt(2).children(links)))))
    .when(prs.length === 0 && related.length === 0 && r.phase !== "finished" && !compact, (el) => el.child(div().text_size(11).text_color(t.dim).child("No pull request yet")))
    .child(actionRow(view, t, r, orch, closed, counts));
}

// Adds or removes the runs overview as a pane beside the captain. Shown greyed out,
// with the reason, while the captain's terminal is not on screen.
function pinButton(t, ctx, labelled = false) {
  const captain = captainPane(ctx);
  if (!captain) return div();
  const usable = Boolean(captain.pinned || captain.pane);
  const tip = captain.pinned ? "Close the runs pane beside the captain"
    : usable ? "Keep the runs open as a pane beside the captain"
    : "The captain's terminal isn't on screen. Show its tab, then pin.";
  return h_flex().id("pin").flex_none().gap(5).items_center().px(labelled ? 8 : 4).h(22).rounded(5).tooltip(tip)
    .text_size(11).text_color(captain.pinned ? t.accent : t.dim).opacity(usable ? 1 : 0.45)
    .when(usable, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .on_click((_e, cx) => { cx.stop_propagation(); togglePin(captain); })
    .child(svg("mods/harbormaster/pin.svg").size(13))
    .when(labelled, (el) => el.child(captain.pinned ? "Unpin" : "Pin beside captain"));
}

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
    .child(pinButton(t, ctx, true))
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

// The Crew block: the captain and every orchestrator as cards, from their role labels,
// then "Adrift": every other agent that isn't one of their workers.
// Sits above Herdr's own Agents list in the harbormaster-main layout, so that list stays stock.
export function crew(view, t) {
  const ctx = facts();
  const cap = captainOf(ctx);
  const runOf = (term) => view.runs.find((r) => r.terminal === term.address);
  // The focused agent, as Herdr's own Agents list marks it.
  const current = ctx.agents.find((a) => a.focused)?.address;
  // Unfinished orchestrators first, then finished ones still open.
  const orchestrators = orchestratorsOf(ctx)
    .map((term) => ({ term, r: runOf(term) }))
    .map((o) => ({ ...o, state: o.r?.phase ?? runPhase(o.term.labels?.["run.status"]) }))
    .sort((a, b) => (a.state === "finished") - (b.state === "finished"));
  const row = ({ id, emoji, title, detail, tone, status, address, edge, pin = false }) => h_flex().id(id).relative().overflow_hidden().flex_none().gap(8).py(6).pl(12).pr(8)
    .rounded(7).bg(address === current ? edge + "33" : edge + "14").cursor_pointer().hover((st) => st.bg(address === current ? edge + "40" : edge + "26"))
    .when(address === current, (el) => el.border(1).border_color(edge + "aa"))
    .on_click(() => focusAgent(address))
    .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(edge))
    .child(div().flex_none().text_size(15).child(emoji))
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
      .child(div().truncate().text_size(11).text_color(t[tone] ?? t.dim).child(detail)))
    .when(pin, (el) => el.child(pinButton(t, ctx)))
    .map(withContext(view, t, id, address))
    .child(statusDot(t, status));
  const rows = [];
  if (cap.terminal) {
    // The same counts as the overview: runs still working, and finished ones still open.
    const watched = watchedText(stats(view.runs, ctx));
    const asks = view.decisions?.length ?? 0;
    rows.push(row({
      id: "crew-captain", emoji: CAPTAIN, title: "Captain", pin: true,
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
