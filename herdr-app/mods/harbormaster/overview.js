// The runs overview itself: the captain strip, the totals, what is waiting on you, the closed runs' header and bulk delete, and the list of run cards.

import { div, svg } from "gpui-kit";
import { openStartCaptain } from "./newrun.js";
import { v_flex, h_flex } from "gpui-base";
import { stats, decisionQueue, deleteRuns, newestFirst, runTime } from "./data.js";
import { facts, agentStatus, captainOf, captainPane, focusAgent, openStats } from "./live.js";
import { CAPTAIN, OCTOPUS, zoom, plural, ago } from "./ui.js";
import { oneLine, queueLines } from "./question.js";
import { setNote } from "./note.js";
import { runlessOrchs } from "./attend.js";
import { parkedHeading, openPrsLabel } from "./tell.js";
import { toastsOn, setToastsOn } from "./telling.js";
import { needCount, needRunsOf, runlessNeeds, watchingText } from "./crewrows.js";
import { withContext, statusDot, noteRows, actionButton } from "./cardparts.js";
import { attOf } from "./needitems.js";
import { noAnswer, answerParts } from "./answers.js";
import { pinButton } from "./runpane.js";
import { card } from "./runcard.js";

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
