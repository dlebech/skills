// The Bridge itself (the popup and the pane beside the captain): its header, the two columns (the queue, Open runs, Done and the
// closed runs on the left; Parked, This week and the captain strip on the right), the closed runs' header and bulk delete.

import { div, svg } from "gpui-kit";
import { props } from "herdr";
import { openStartCaptain } from "./newrun.js";
import { v_flex, h_flex } from "gpui-base";
import { stats, deleteRuns, newestFirst, runTime } from "./data.js";
import { facts, agentStatus, captainOf, captainPane, focusAgent, openStats } from "./live.js";
import { CAPTAIN, zoom, plural } from "./ui.js";
import { setNote } from "./note.js";
import { toastsOn, setToastsOn } from "./telling.js";
import { T, withContext, statusDot, noteRows, actionButton } from "./cardparts.js";
import { attOf } from "./needitems.js";
import { pinButton } from "./runpane.js";
import { card } from "./runcard.js";
import { queueSections, BRIDGE_SIZE } from "./crew.js";
import { weekBlock } from "./bridgeweek.js";
import { bridgeColumns, bridgeGroups, totalsText, pruneFolds } from "./bridgerows.js";
import { watchedText } from "./crewrows.js";
import { openBlock, doneBlock, parkedBlock } from "./bridge.js";

// The captain's one fixed-height row: with a captain running, what it watches, Open chat and the pin; with none,
// a line saying the Bridge works without one and Start captain.
export function captainStrip(view, t, ctx, s) {
  const watched = watchedText(s);
  const cap = captainOf(ctx);
  const box = (el) => el.flex_none().h(88).px(12).rounded(8);
  if (!cap.terminal) return box(v_flex().id("captain")).bg(t.surface).justify_center().gap(2)
    .child(h_flex().gap(10).items_center()
      .child(div().text_size(18).child(CAPTAIN))
      .child(div().flex_1().min_w(0).font_semibold().text_size(13).text_color(t.foreground).child("No captain running"))
      .child(actionButton(t, "start-captain", "Start captain", "Start a captain: a chat across all your runs", () => openStartCaptain(), true)))
    .child(div().h(40).overflow_hidden().text_size(11.5).text_color(t.muted)
      .child("The Bridge works without one. Start a captain when you want someone to talk to across runs."));
  const stopped = "Watcher not running · ask the captain to watch";
  return box(h_flex().id("captain")).gap(10).items_center().bg(t.accent + "18").border(1).border_color(t.accent + "55")
    .child(div().text_size(18).child(CAPTAIN))
    .child(v_flex().flex_1().min_w(0)
      .child(div().font_semibold().text_size(13).text_color(t.foreground).child("Captain"))
      .child(div().truncate().text_size(11.5).text_color(cap.watching ? t.muted : t.blocked)
        .when(!cap.watching, (el) => el.id("captain-watch").tooltip(stopped))
        .child(cap.watching ? `${watched[0].toUpperCase()}${watched.slice(1)}` : stopped)))
    .child(actionButton(t, "open-chat", "Open chat", "Show the captain's terminal", () => focusAgent(cap.terminal.address), true))
    .child(pinButton(t, "pin-captain", captainPane(ctx)))
    .map(withContext(view, t, "captain", cap.terminal.address))
    .child(statusDot(t, agentStatus(cap.terminal, ctx)));
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

// "3 not deleted: its worktrees are still there… (feat-a, feat-b on box, +1 more)": the runs a
// bulk delete could not take, grouped by why, so 40 alike read as one reason, not 40 lines.
function failedText(failed) {
  const why = new Map();
  for (const f of failed) why.set(f.error, [...(why.get(f.error) ?? []), `${f.run.branch}${f.run.machine ? ` on ${f.run.machine}` : ""}`]);
  const runs = (names) => (names.length > 3 ? [...names.slice(0, 3), `+${names.length - 3} more`] : names).join(", ");
  return `${failed.length} not deleted: ${[...why].map(([error, names]) => `${error} (${runs(names)})`).join("; ")}`;
}

// The closed runs' header: the fold toggle and, while unfolded, Delete older than a preset;
// after a preset is clicked, its question with a confirm and Cancel; while deleting, how many.
// The runs a delete could not take are listed under it, where the click was, not at the list's
// bottom 40 cards away.
function closedHeader(view, t, closed) {
  const row = closedHeaderRow(view, t, closed);
  if (!view.bulkError) return row;
  return v_flex().gap(4).child(row)
    .child(h_flex().id("bulk-error").px(4).gap(6).items_start().text_size(T(11, "meta")).text_color(t.blocked)
      .child(div().flex_1().min_w(0).child(view.bulkError))
      .child(div().id("bulk-error-x").flex_none().cursor_pointer().px(3).text_size(T(14, "strong")).text_color(t.dim).hover((s) => s.text_color(t.foreground)).tooltip("Dismiss")
        .on_click((_e, cx) => { cx.stop_propagation(); view.bulkError = null; cx.notify(); }).child("×")));
}

function closedHeaderRow(view, t, closed) {
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
  const set = (cx, value) => { view.confirm = value; view.actionError = null; view.bulkError = null; view.actionNote = null; cx.notify(); };
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
      try { failed = await deleteRuns(runs, { cx }); } catch (e) { failed = runs.map((run) => ({ run, error: e?.message ?? String(e) })); }
      for (const key of [BULK_KEY, ...runs.map((r) => r.key)]) if (view.busy[key]?.at === at) delete view.busy[key];
      const done = runs.length - failed.length;
      if (done) setNote(view, `Deleted ${plural(done, "closed run")}.`);
      if (failed.length) view.bulkError = failedText(failed);
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

// The totals as one short line under the title: "5 open runs · 3 parked · 2 open PRs", the PR part red when a check fails.
function totalsLine(t, parts) {
  const row = h_flex().id("bridge-totals").flex_wrap().gap(5).px(4).items_center().text_size(11).text_color(t.dim);
  parts.forEach((p, i) => { if (i) row.child(div().flex_none().child("·")); row.child(div().flex_none().text_color(p.tone ? t[p.tone] : t.dim).child(p.text)); });
  return row;
}

// The Bridge: a fixed header (title, totals, Stats, toasts), then one scrolling body of two columns (one when narrow).
// Left: the queue, Open runs (a line each, unfolding to the card), Done, the closed runs. Right: Parked, This week, the captain.
export function cards(view, t, runs, errors) {
  const ctx = facts();
  const s = stats(runs, ctx);
  const g = bridgeGroups(s, (r) => attOf(r, ctx), newestFirst);
  view.bridgeOpen = pruneFolds(view.bridgeOpen, g);
  // Before the first size event, the width the view opens at: the popup's (so it draws two columns at once), else the pane's.
  const width = (view.size?.width ?? (props()?.overlay ? BRIDGE_SIZE.width : 600)) / zoom();
  const narrow = width < 360;
  const queue = queueSections(view, t, { all: true, ctx, s });
  const left = v_flex().id("bridge-left").gap(10).min_w(0)
    .child(v_flex().id("bridge-queue").flex_none().gap(4).children(queue.length ? queue : [div().px(4).text_size(11.5).text_color(t.muted).child("Nothing waits on you.")]))
    .child(openBlock(view, t, g.open, ctx, narrow))
    .children([doneBlock(view, t, g.done, ctx, narrow)].filter(Boolean))
    .when(g.closed.length > 0, (el) => el.child(closedHeader(view, t, g.closed)))
    .when(Boolean(view.showDone), (el) => el.children(g.closed.map((r) => card(view, t, r, ctx, true))))
    .children(noteRows(view, t, false))
    .when(errors.length > 0, (el) => el.child(div().px(4).text_size(11).text_color(t.blocked).child(errors.join("\n"))));
  const right = v_flex().id("bridge-right").gap(10).min_w(0)
    .child(parkedBlock(view, t, g.parked, ctx))
    .child(weekBlock(view, t))
    .child(captainStrip(view, t, ctx, s));
  const two = bridgeColumns(width) === 2;
  return v_flex().id("root").size_full().min_h(0).bg(t.canvas ?? t.chrome).text_size(13)
    .on_size_change((size, cx) => { view.size = size; cx.notify(); })
    .child(v_flex().flex_none().px(10).pt(10).pb(6).gap(2)
      .child(h_flex().px(4).items_center()
        .child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).child("⚓ Bridge"))
        .child(div().id("open-stats").flex_none().px(6).h(18).rounded(4).flex().items_center().text_size(11).text_color(t.dim)
          .cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
          .tooltip("Where the time goes, tokens, CPU and memory: per run, task and agent, and past runs")
          .on_click(() => openStats()).child("Stats"))
        .child(toastsToggle(t)))
      .child(totalsLine(t, totalsText(s, g.open.length))))
    .child(v_flex().id("runs-list").flex_1().min_h(0).px(10).pb(12).overflow_y_scrollbar()
      .when(two, (el) => el.child(h_flex().id("bridge-cols").gap(16).items_start().child(left.w("55%")).child(right.flex_1())))
      .when(!two, (el) => el.child(v_flex().id("bridge-stack").gap(10).child(left).child(right))));
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
