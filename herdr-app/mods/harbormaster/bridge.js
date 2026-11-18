// The Bridge's run blocks, drawn: the Open runs and Done lines that unfold to a run's card, and the
// Parked rows with their Resume. The words and the fold state are bridgerows.js; the card is runcard.js.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { orchestratorState, workersOf } from "./live.js";
import { runName, typeTag } from "./ui.js";
import { rowEdge } from "./crewrows.js";
import { attOf } from "./needitems.js";
import { runStatus, runFacts } from "./needbox.js";
import { statusDot, closeAllControl, edgeColor, actionButton, confirmBlock, ACTION } from "./cardparts.js";
import { card } from "./runcard.js";
import { runLineText, parkedRowText, toggleOpen, unfoldAll, foldAll, allUnfolded, foldKey } from "./bridgerows.js";

const chevron = (t, open) => svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim);

// A block's small heading, as the sidebar's group headings: "Open runs · 5", with a quiet action at its right.
function blockHead(t, id, title, { note = null, action = null, toggle = null } = {}) {
  const label = h_flex().id(`${id}-fold`).flex_none().gap(5).items_center()
    .when(Boolean(toggle), (el) => el.cursor_pointer().hover((st) => st.text_color(t.foreground)).on_click(toggle.onClick).child(chevron(t, toggle.open)))
    .child(title);
  return h_flex().id(id).flex_none().h(22).px(4).gap(6).items_center().text_size(10.5).font_semibold().text_color(t.dim)
    .child(label)
    .when(Boolean(note), (el) => el.child(div().min_w(0).truncate().font_normal().text_color(t.muted).child(note)))
    .child(div().flex_1())
    .when(Boolean(action), (el) => el.child(action));
}

const setOpen = (view, set) => { view.bridgeOpen = set; };

// One run as one line (state dot, name, type, what it does now, a chevron); unfolded, its card under it.
// A folded run builds no card.
function runLine(view, t, r, ctx, block, narrow, compact) {
  const key = foldKey(block, r);
  const open = Boolean(view.bridgeOpen?.has(key));
  const att = attOf(r, ctx);
  const { text, red } = runLineText(r, att);
  const name = runName(r.branch, r.topic);
  const dot = statusDot(t, runStatus(orchestratorState(r, ctx), workersOf(r.terminal, ctx), att, ctx));
  const toggle = (_e, cx) => { setOpen(view, toggleOpen(view.bridgeOpen, key)); cx.notify(); };
  const line = h_flex().id(`bridge-run-${r.key}`).relative().overflow_hidden().flex_none().h(28).pl(12).pr(8).gap(8).items_center().rounded(6)
    .bg(t.surface).cursor_pointer().hover((st) => st.bg(t.raised)).on_click(toggle)
    .when(red, (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(3).bg(edgeColor(t, rowEdge(att)))))
    .child(h_flex().w(12).flex_none().justify_center().child(dot))
    .child(div().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(name.title))
    .when(Boolean(r.type), (el) => el.child(typeTag(t, r.type)))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(red ? t.blocked : t.dim).child(text))
    .child(chevron(t, open));
  return v_flex().id(`bridge-item-${r.key}`).flex_none().gap(6).child(line).when(open, (el) => el.child(card(view, t, r, ctx, compact ?? narrow)));
}

// Open runs: the heading with Unfold all / Fold all, then a line per run (none: one muted line).
export function openBlock(view, t, runs, ctx, narrow) {
  const all = allUnfolded(view.bridgeOpen, runs);
  const link = runs.length > 0 && div().id("bridge-unfold-all").flex_none().font_normal().text_size(10.5).text_color(t.dim).cursor_pointer()
    .hover((st) => st.text_color(t.foreground)).tooltip(all ? "Fold every run to one line" : "Show every run's full card")
    .on_click((_e, cx) => { setOpen(view, (all ? foldAll : unfoldAll)(view.bridgeOpen, runs)); cx.notify(); })
    .child(all ? "Fold all" : "Unfold all");
  return v_flex().id("bridge-open").flex_none().gap(4)
    .child(blockHead(t, "bridge-open-head", `Open runs · ${runs.length}`, { action: link || null }))
    .children(runs.map((r) => runLine(view, t, r, ctx, "open", narrow)))
    .when(runs.length === 0, (el) => el.child(div().px(4).text_size(11.5).text_color(t.muted).child("No runs in progress. Start one with + New run in the sidebar, or ask the captain.")));
}

// Done: folded by default, with Close all merged; unfolded, the same lines.
export function doneBlock(view, t, runs, ctx, narrow) {
  if (!runs.length) return null;
  const open = Boolean(view.bridgeDoneOpen);
  const closing = closeAllControl(view, t, runs.map((r) => ({ r, a: attOf(r, ctx) })), ctx);
  return v_flex().id("bridge-done").flex_none().gap(4)
    .child(blockHead(t, "bridge-done-head", `Done · ${runs.length}`, { action: closing.button, toggle: { open, onClick: (_e, cx) => { view.bridgeDoneOpen = !open; cx.notify(); } } }))
    .when(Boolean(closing.confirm), (el) => el.child(closing.confirm))
    .when(open, (el) => el.children(runs.map((r) => runLine(view, t, r, ctx, "done", narrow, true))));
}

// Parked: a row per run (name, type, how long, what it waits on, Resume, a chevron to its card).
export function parkedBlock(view, t, runs, ctx) {
  const row = (r) => {
    const key = foldKey("parked", r);
    const open = Boolean(view.bridgeOpen?.has(key));
    const { age, waits } = parkedRowText(r, attOf(r, ctx));
    const name = runName(r.branch, r.topic);
    const asking = view.confirm?.key === r.key && view.confirm.action === "resume" && !view.confirm.box;
    const busy = Boolean(view.busy?.[r.key]);
    const resume = actionButton(t, `bridge-resume-${r.key}`, ACTION.resume.label, ACTION.resume.tip,
      busy ? null : (cx) => { view.confirm = { key: r.key, action: "resume" }; view.actionError = null; view.actionNote = null; cx.notify(); }, true);
    const line = h_flex().id(`bridge-parked-${r.key}`).flex_none().gap(8).px(10).py(7).items_center().rounded(6).bg(t.surface).cursor_pointer()
      .hover((st) => st.bg(t.raised)).on_click((_e, cx) => { setOpen(view, toggleOpen(view.bridgeOpen, key)); cx.notify(); })
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(name.title))
          .when(Boolean(r.type), (el) => el.child(typeTag(t, r.type)))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(age)))
        .child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(waits)))
      .child(resume)
      .child(chevron(t, open));
    return v_flex().id(`bridge-parked-item-${r.key}`).flex_none().gap(6).child(line)
      .when(asking && !open, (el) => el.child(confirmBlock(view, t, r, runFacts(r, ctx).orch, { done: 0, planned: 0 }, "resume", `bridge-${r.key}`)))
      .when(open, (el) => el.child(card(view, t, r, ctx, true)));
  };
  return v_flex().id("bridge-parked").flex_none().gap(4)
    .child(blockHead(t, "bridge-parked-head", `Parked · ${runs.length}`, { note: "set aside, not in the queue" }))
    .children(runs.map(row))
    .when(runs.length === 0, (el) => el.child(div().px(4).text_size(11.5).text_color(t.muted).child("Nothing parked.")));
}
