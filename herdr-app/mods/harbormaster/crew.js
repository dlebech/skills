// The Crew block (role "crew", the sidebar): the captain and every orchestrator as rows, from their
// role labels, grouped by attention, then "Adrift": every other agent that isn't one of their workers.
// Sits above Herdr's own Agents list in the harbormaster-main layout, so that list stays stock.
// Built from separate pieces (header, Needs-you box, group heads, rows) so each can be restyled alone;
// the pure logic is crewrows.js.
import { div, svg } from "gpui-kit";
import { openOverlay, props } from "herdr";
import { v_flex, h_flex } from "gpui-base";
import { stats, runPhase } from "./data.js";
import { facts, orchestratorsOf, orchestratorState, agentStatus, workersOf, captainOf, focusAgent, focusWithPane, currentAgent, adrift, agentNames } from "./live.js";
import { CAPTAIN, CRAB, programIcon, plural, runName } from "./ui.js";
import { startedTip } from "./context.js";
import { liveUsage, treeUsage } from "./resources.js";
import { attentionOf } from "./attend.js";
import { GROUPS, groupRows, rowLead, rowEdge, rowTip, emptyNote, crewEntries, expandedNeed, canExpand, needKey, needCount, needRunsOf, captainNeedNote } from "./crewrows.js";
import { doLine } from "./needaction.js";
import {
  attOf, runStatus, levelTags, runTypeTag, blockingAction, statusDot, actionButton, closeAllControl, isOpen, needBox, runFacts, needItemsOf,
  newDecisionsNote, noteRows, watchedText, edgeColor, cardBesideOrchestrator, AMBER, PASS, SELECTED, withUsage, contextTip, usageLine, runProps,
} from "./overview.js";

// A Needs-you row's hover in the needs box, where a click opens the run there instead of its orchestrator.
const OPEN_HERE = "Click to open it here";

// What every piece of the block reads, worked out once per render.
function crewModel(view, t) {
  const ctx = facts();
  const cap = captainOf(ctx);
  // A live run before a parked or closed one that recorded the same address (as runOfProps), or
  // the live run would get a second, "orchestrator gone" row with a Resume.
  const runOf = (term) => view.runs.find((r) => !r.away && r.terminal === term.address) ?? view.runs.find((r) => r.terminal === term.address);
  const now = Date.now();
  // The sidebar, not the Crew popup (an overlay): its rows' leads leave out comment counts
  // (rowLead), so the age survives its narrow width.
  const narrow = !props()?.overlay;
  // Each orchestrator's attention, once per render: which group it is in and why. An
  // orchestrator without a run directory is judged by its terminal alone (can't tell).
  const orchestrators = orchestratorsOf(ctx)
    .map((term) => ({ term, r: runOf(term) }))
    .map((o) => ({ ...o, state: o.r?.phase ?? runPhase(o.term.labels?.["run.status"]), a: o.r ? attOf(o.r, ctx) : attentionOf(null, ctx, now, o.term) }));
  // Its Needs you is the overview's (crewrows.js crewEntries): a run that needs you whose
  // orchestrator is gone gets a row too, and the captain's open decisions count in its heading.
  const needRuns = needRunsOf(stats(view.runs, ctx).shown, (r) => attOf(r, ctx));
  const entries = crewEntries(orchestrators, needRuns, (r) => attOf(r, ctx));
  const asks = view.decisions?.length ?? 0;
  const addresses = [cap.terminal?.address, ...orchestrators.map((o) => o.term.address)].filter(Boolean);
  // The focused agent, or the crew agent beside a focused Harbormaster pane.
  const current = currentAgent(ctx, addresses);
  return { view, t, ctx, cap, now, narrow, orchestrators, needRuns, entries, asks, addresses, current };
}

// The block's heading.
function crewHeader(t) {
  return div().flex_none().px(12).pt(8).pb(4).text_size(11.5).font_semibold().text_color(t.foreground).child("Crew");
}

// One crew row. Only the captain has a mark (a small one): the rest are all orchestrators. The context size
// and the run's token total are in the row's hover, which leaves the width to the tags. The
// hover is on its two lines of text, not the whole row, so it never covers a tag's own card.
function crewRow(m, { id, mark = null, type = null, tags = [], title, tip = null, detail, tone, detailTip = null, status, address, edge, open = () => focusAgent(address), crabs = 0, run = null, usage = null, whose = "", more = null, action = null }) {
  const { view, t, current } = m;
  const hover = [title, tip, contextTip(view, address, run)].filter(Boolean).join("\n");
  const here = address != null && address === current;
  const color = tone === "amber" ? AMBER(t) : tone === "pass" ? PASS(t) : t[tone] ?? t.dim;
  return h_flex().id(id).relative().overflow_hidden().flex_none().gap(8).py(6).pl(12).pr(8)
    // The selected row has a ring in the theme's accent, whatever its edge: the edge's own tint is
    // grey in Working, so a ring of it would not show. The ring is always there, clear when not
    // selected, so selecting never moves the row. The left bar keeps the group's colour.
    .rounded(7).bg(here ? SELECTED(t) : edge + "14").cursor_pointer().hover((st) => st.bg(here ? SELECTED(t) : edge + "26"))
    .border(2).border_color(here ? t.accent : "#00000000")
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
}

function captainRow(m) {
  const { view, t, ctx, cap, asks } = m;
  // The same counts as the overview: runs still working, and finished ones still open.
  const watched = watchedText(stats(view.runs, ctx));
  return crewRow(m, {
    id: "crew-captain", mark: CAPTAIN, title: "Captain",
    // Clicking the captain also opens the runs overview beside it.
    open: () => focusWithPane(cap.terminal.address),
    detail: [asks ? `asks you: ${plural(asks, "decision")}` : null, cap.watching ? watched : "not watching runs"].filter(Boolean).join(" · "),
    tone: asks || !cap.watching ? "blocked" : "muted", status: agentStatus(cap.terminal, ctx), address: cap.terminal.address, edge: t.accent,
    usage: liveUsage(cap.terminal.address), whose: "The captain and its commands",
  });
}

function orchRow(m, { term, r, state, a }, onOpen = null) {
  const { view, t, ctx, now, narrow } = m;
  const labels = term.labels ?? {};
  const crewOf = workersOf(term.address, ctx);
  const status = runStatus(agentStatus(term, ctx), crewOf, a, ctx);
  const workers = crewOf.length;
  // Why it is in its group (its reasons, the next-step label or the step and its age) leads,
  // then the rest; when it started is in the title's hover. Without a run directory, its
  // progress label.
  const { lead, rest, tone } = rowLead(a, now, { narrow });
  const detail = [lead, rest ?? (r ? null : labels.progress)].filter(Boolean).join(" · ");
  const name = runName(r?.branch ?? term.name ?? term.address, labels["run.topic"] ?? r?.topic);
  const edge = rowEdge(a);
  return crewRow(m, {
    id: `crew-${term.address}`, detail: detail || "orchestrator",
    // Its last line says what to do (needaction.js), as the need box does.
    detailTip: [...rowTip(a, now), r ? doLine(needItemsOf(r, ctx, a)) : null].filter(Boolean).join("\n"),
    // The run's tags as its pane's header shows them, then its number and topic; without a
    // topic, its branch. Without a run directory, its terminal's labels stand in.
    ...(() => {
      const run = r ?? { key: term.address, type: labels["run.type"] || null, autonomy: /^L[0-2]$/.test(labels["run.autonomy"]) ? labels["run.autonomy"] : "L0" };
      return { type: runTypeTag(t, run, `crew-${term.address}`), tags: levelTags(view, t, run, `crew-${term.address}`, true) };
    })(),
    title: name.title, tip: [name.tip, startedTip(r?.started), r ? newDecisionsNote(r) : null, onOpen ? OPEN_HERE : null].filter(Boolean).join("\n") || null,
    tone, status, address: term.address, crabs: state === "finished" ? 0 : workers, run: r,
    // Badged on its own, like any agent: a run's agents together pass 2 GB while nothing is busy.
    usage: liveUsage(term.address), whose: "The orchestrator and its commands",
    more: usageLine("The whole run, with its agents", treeUsage([term.address, ...crewOf.map((w) => w.address)])),
    // Clicking a run's orchestrator also opens that run's card beside it, while it's there.
    open: onOpen ?? (() => (r && cardBesideOrchestrator(r, orchestratorState(r, ctx)) ? focusWithPane(term.address, runProps(r)) : focusAgent(term.address))),
    edge: edgeColor(t, edge),
    // A stalled run: Ask what's blocking, or "asked…" while that waits.
    action: blockingAction(view, t, r, a, `crew-${term.address}`, true),
  });
}

// A run that needs you with no orchestrator to focus (gone, or its machine did not answer):
// its row opens the run's card as a popup, where Resume is.
function runRow(m, { r, a }, onOpen = null) {
  const { t, now, narrow } = m;
  const { lead, tone } = rowLead(a, now, { narrow });
  const name = runName(r.branch, r.topic);
  const card = () => openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: runProps(r) });
  const open = onOpen ?? card;
  return crewRow(m, {
    id: `crew-run-${r.key}`, detail: lead, detailTip: rowTip(a, now).join("\n"),
    // No level tags: with no orchestrator, nobody would act on a level request, and the narrow
    // sidebar keeps "orchestrator gone" beside Resume.
    type: runTypeTag(t, r, `crew-run-${r.key}`),
    title: name.title, tip: [name.tip, startedTip(r.started), onOpen ? OPEN_HERE : "No orchestrator: click for its card"].filter(Boolean).join("\n"),
    tone, status: "gone", address: null, run: r, open, edge: edgeColor(t, rowEdge(a)),
    action: actionButton(t, `crew-run-${r.key}-open`, "Resume", "Open its card: Resume there starts a new orchestrator that picks the run up", () => card()),
  });
}

const entryRow = (m, x, onOpen = null) => (x.term ? orchRow(m, x, onOpen) : runRow(m, x, onOpen));

// A group's heading; its right side is room for an action. A folded group (Done) is a toggle,
// with Close all merged beside it.
function groupHead(m, g, n, closing) {
  const { view, t } = m;
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
}

// Needs you with nothing in it: one calm line in its place, styled as a heading.
function emptyHead(t, g, none) {
  return h_flex().id(`crew-group-${g.key}`).flex_none().gap(5).px(4).pt(6).items_center().min_w(0).text_size(10.5)
    .child(div().flex_none().font_semibold().text_color(t.dim).child(g.title))
    .child(div().min_w(0).truncate().text_color(PASS(t)).child(none));
}

// The Needs-you box (needs: "box", the needs-you layout): each entry in its own place (longest wait
// first); the open one keeps its compact row as the box's head, so the box says whose it is, with the
// need box attached under it. Only entries the box can draw open on click; an orchestrator without a
// run directory keeps its focus click, where its dialog is answered.
function needsBoxRows(m, list) {
  const { view, t, ctx, groups } = m;
  const expanded = expandedNeed(groups.needs, view.needsOpen);
  const pick = (x) => (_e, cx) => { view.needsOpen = needKey(x); cx.notify(); };
  return list.map((x) => {
    if (x !== expanded) return entryRow(m, x, canExpand(x) ? pick(x) : null);
    return v_flex().id("crew-needs-box").flex_none().min_w(0).gap(2).child(entryRow(m, x))
      .child(needBox(view, t, x.r, runFacts(x.r, ctx), ctx, "sidebar"));
  });
}

// Every group in turn: Needs you, Working, Waiting on others, Can't tell and Done, each longest
// wait first; Done folded until opened (view.folds, as the pane's folds).
function groupRowsOf(m) {
  const { view, t, entries, asks, needRuns, orchestrators, ctx } = m;
  const groups = groupRows(entries);
  m.groups = groups;
  const needs = needCount(needRuns, orchestrators, asks);
  const closing = closeAllControl(view, t, groups.done, ctx);
  // needs: "box": the first Needs-you run is drawn open as its need box, the others stay compact
  // rows whose click opens them instead of focusing.
  const boxed = props()?.needs === "box";
  const rows = [];
  for (const g of GROUPS) {
    const list = groups[g.key];
    const count = g.key === "needs" ? needs : list.length;
    const none = emptyNote(g, count, entries.length);
    if (none) rows.push(emptyHead(t, g, none));
    if (!count) continue;
    rows.push(groupHead(m, g, count, closing));
    // The captain's open decisions count in Needs you; its own row, above, is where they are.
    const capNote = g.key === "needs" ? captainNeedNote(asks) : null;
    if (capNote) rows.push(div().id("crew-needs-captain").flex_none().px(4).min_w(0).truncate().text_size(10.5).text_color(t.dim).child(capNote));
    if (g.key === "done" && closing.confirm) rows.push(closing.confirm);
    if (g.key === "needs" && boxed) rows.push(...needsBoxRows(m, list));
    else if (!g.folded || isOpen(view, `crew-${g.key}`)) rows.push(...list.map((x) => entryRow(m, x)));
  }
  return rows;
}

// Adrift: agents outside the crew, on any machine.
function adriftRows(m) {
  const { t, ctx, addresses } = m;
  const drifters = adrift(addresses, ctx);
  const names = agentNames(drifters, (a) => a.space_name);
  const stray = (a, i) => h_flex().id(`adrift-${a.address}`).flex_none().gap(8).h(24).px(8).items_center().rounded(6).cursor_pointer()
    .when(a.focused, (el) => el.bg(t.selected)).hover((st) => st.bg(t.hover)).tooltip([names[i], a.title, `${a.space_name} · ${a.tab_name}`].filter((x, i, all) => x && all.indexOf(x) === i).join("\n"))
    .on_click(() => focusAgent(a.address))
    .child(programIcon(a.program, 13, t.muted))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(`${a.space_name} · ${names[i]}`))
    .map(withUsage(t, `adrift-${a.address}`, liveUsage(a.address), "This agent and its commands"))
    .child(statusDot(t, a.status));
  return {
    head: drifters.length > 0 ? div().flex_none().px(4).pt(6).text_size(10.5).font_semibold().text_color(t.dim).child(`Adrift · ${drifters.length}`) : null,
    rows: drifters.map(stray),
  };
}

export function crew(view, t) {
  const m = crewModel(view, t);
  const rows = [];
  if (m.cap.terminal) rows.push(captainRow(m));
  rows.push(...groupRowsOf(m));
  const drift = adriftRows(m);
  return v_flex().id("crew").size_full().min_h(0).bg(t.chrome).text_size(12.5)
    .child(crewHeader(t))
    .child(v_flex().id("crew-list").flex_1().min_h(0).px(8).pb(6).gap(4).overflow_y_scrollbar()
      .when(rows.length === 0, (el) => el.child(div().px(4).text_size(11.5).text_color(t.dim).child("No captain or orchestrators. Start one with /herdr-app-captain.")))
      .children(rows)
      .when(Boolean(drift.head), (el) => el.child(drift.head))
      .children(drift.rows)
      .children(noteRows(view, t, true)));
}
