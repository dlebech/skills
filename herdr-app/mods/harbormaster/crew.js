// The Crew block (role "crew", the sidebar): the captain and every orchestrator as rows, from their
// role labels, grouped by attention, then "Adrift": every other agent that isn't one of their workers.
// Sits above Herdr's own Agents list in the harbormaster-main layout, so that list stays stock.
// Built from separate pieces (header, Needs-you box, group heads, rows) so each can be restyled alone;
// the pure logic is crewrows.js.
import { div, svg } from "gpui-kit";
import { openOverlay, props } from "herdr";
import { v_flex, h_flex, Input } from "gpui-base";
import { stats, runPhase, decisionQueue } from "./data.js";
import { taskCounts } from "./tasks.js";
import { openUrl, facts, orchestratorsOf, orchestratorState, agentStatus, workersOf, captainOf, focusAgent, focusWithPane, currentAgent, adrift, agentNames } from "./live.js";
import { CAPTAIN, CRAB, programIcon, plural, runName } from "./ui.js";
import { startedTip } from "./context.js";
import { liveUsage, treeUsage } from "./resources.js";
import { attentionOf } from "./attend.js";
import { GROUPS, groupRows, rowLead, rowEdge, rowTip, emptyNote, crewEntries, expandedNeed, canExpand, needKey, needCount, needRunsOf, captainNeedNote, captainMark, needsRest, progressOf, prRef } from "./crewrows.js";
import { reviewError } from "./reviews.js";
import { nextItems, mineError } from "./mypr.js";
import { ageText } from "./attention.js";
import { openNewRun, startReview, reviewStarting } from "./newrun.js";
import { doLine, primaryOf, isMergeAsk } from "./needaction.js";
import { claimsAsk, checksLine, withSaid, claimActions } from "./claims.js";
import {
  attOf, runStatus, levelTags, runTypeTag, blockingAction, statusDot, actionButton, closeAllControl, isOpen, needBox, runFacts, needItemsOf,
  newDecisionsNote, noteRows, watchedText, edgeColor, cardBesideOrchestrator, AMBER, PASS, SELECTED, withUsage, contextTip, usageLine, runProps,
  needButton, needLines, answerParts, boxConfirm, proofAction, said,
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
  if (props()?.needs === "box") return calmCrew(m);
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

// ---- the calm sidebar (props needs: "box", the needs layout) ----
// One header row (name, + New run, the captain link), the Needs-you box with one button per
// item, then every other run as a one-line row in small, foldable groups. Sizes are fixed: rows
// and headings share one left edge (PAD), so the eye runs straight down the sidebar.

const PAD = 8;

// A fold's state: what the user last chose, else the group's default.
const unfolded = (view, key, dflt) => (view.folds?.has(key) ? view.folds.get(key) : dflt);
const toggleFold = (view, key, now) => (_e, cx) => { view.folds ??= new Map(); view.folds.set(key, !now); cx.notify(); };

// The captain's status message ("1 shell still running"): Herdr gives the agent's report in
// `report`; hc's own JSON in `status`.
const statusMsg = (term) => term?.report?.msg ?? (typeof term?.status === "object" ? term.status?.msg : null) ?? null;

// "captain ↗" at the header's right: red with a count while it has decisions for you, an eye
// while it only watches, the spinner only while it really replies (crewrows.js captainMark).
// Clicking does what the captain card did: focus it, with the overview beside it. No captain:
// nothing, unless decisions still wait for one.
function captainLink(m) {
  const { view, t, ctx, cap, asks } = m;
  const term = cap.terminal;
  if (!term && !asks) return null;
  const mark = term ? captainMark({ status: agentStatus(term, ctx), msg: statusMsg(term), watching: cap.watching }) : "idle";
  const tone = asks ? t.blocked : t.muted;
  const icon = mark === "watching" ? svg("mods/harbormaster/eye.svg").size(12).flex_none().text_color(tone)
    : mark === "working" || mark === "blocked" ? statusDot(t, mark) : null;
  const state = { watching: `Watching: ${watchedText(stats(view.runs, ctx))}, idle until something needs it`, working: "Working", blocked: "Waiting on a prompt in its terminal",
    idle: cap.watching ? "Idle" : "Idle, not watching runs" }[mark];
  const tip = term
    ? [`The captain · ${state}`, asks ? `${plural(asks, "decision")} for you` : null, "Click to open it, with the overview beside it"].filter(Boolean).join("\n")
    : `${plural(asks, "decision")} for you, and no captain running: start /herdr-app-captain to answer`;
  return h_flex().id("crew-captain-link").flex_none().gap(5).items_center().px(6).h(22).rounded(5)
    .text_size(11.5).text_color(tone).tooltip(tip)
    .when(Boolean(term), (el) => el.cursor_pointer().hover((st) => st.bg(t.hover).text_color(asks ? t.blocked : t.foreground))
      .on_click(() => focusWithPane(term.address)))
    .when(Boolean(icon), (el) => el.child(icon))
    .child(asks ? `captain · ${asks} ↗` : "captain ↗");
}

// The sidebar's one header row.
function harborHeader(m) {
  const { t } = m;
  return h_flex().id("crew-header").flex_none().h(36).pl(PAD * 2).pr(PAD).gap(8).items_center()
    .child(div().flex_none().text_size(13).font_semibold().text_color(t.foreground).child("⚓ Harbormaster"))
    .child(h_flex().id("crew-new-run").flex_none().px(7).h(22).items_center().rounded(5).bg(t.raised)
      .text_size(11.5).font_medium().text_color(t.muted).cursor_pointer().hover((st) => st.text_color(t.foreground).bg(t.hover))
      .tooltip("Start a run in a repository's own space: issues, a PR to review, or a task in your words. No captain needed")
      .on_click((_e, cx) => { cx.stop_propagation(); openNewRun(); })
      .child("+ New run"))
    .child(div().flex_1())
    .children([captainLink(m)].filter(Boolean));
}

// A small heading over a group, a toggle when the group folds: "▾ Working · 2", with an
// optional action at its right. Generic, so every group of compact rows looks the same.
function sectionHead(m, { key, title, count, tone = null, foldable = true, open = true, action = null }) {
  const { view, t } = m;
  const head = h_flex().id(`crew-group-${key}`).flex_none().h(22).px(PAD).gap(5).items_center()
    .text_size(10.5).font_semibold().text_color(tone ?? t.dim);
  const label = h_flex().id(`crew-fold-${key}`).flex_none().gap(5).items_center()
    .when(foldable, (el) => el.cursor_pointer().hover((st) => st.text_color(t.foreground)).on_click(toggleFold(view, `crew-${key}`, open))
      .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(10).flex_none()))
    .child(`${title} · ${count}`);
  return head.child(label).child(div().flex_1()).when(Boolean(action), (el) => el.child(action));
}

// A group: its heading, then its rows while open. `rows` is called only then. A group is a
// heading and compact rows with an optional action, so other lists (review requests, …) reuse it.
function section(m, g) {
  if (!g.count) return [];
  const open = g.foldable === false ? true : unfolded(m.view, `crew-${g.key}`, !g.folded);
  return [sectionHead(m, { ...g, open }), ...(g.extra ?? []), ...(open ? g.rows() : [])];
}

// A run that is not in the box, in one line: its state as a dot, its name, its type (muted)
// and its tasks done of planned, with a thin bar of them under it. Why it is in its group and
// what it does now are in the hover; a click focuses its orchestrator (or opens its card).
function compactRow(m, x, g) {
  const { view, t, ctx, now, current } = m;
  const { term, r, a } = x;
  const labels = term?.labels ?? {};
  const address = term?.address ?? null;
  const id = address ? `crew-${address}` : `crew-run-${r.key}`;
  const name = runName(r?.branch ?? term?.name ?? address, labels["run.topic"] ?? r?.topic);
  const type = r?.type ?? labels["run.type"] ?? null;
  const prog = r ? progressOf(taskCounts(r)) : null;
  const { lead, rest } = rowLead(a, now);
  const tip = [name.tip ?? name.title, [lead, rest ?? (r ? null : labels.progress)].filter(Boolean).join(" · "), ...rowTip(a, now).slice(1), startedTip(r?.started)]
    .filter((l, i, all) => l && all.indexOf(l) === i).join("\n");
  // Working shows the agent's own dot (the spinner while it works); the other groups their colour.
  const dot = g.key === "working" && term ? statusDot(t, runStatus(agentStatus(term, ctx), workersOf(address, ctx), a, ctx))
    : g.key === "cant" ? statusDot(t, "gone")
    : div().size(8).flex_none().rounded(4).bg(edgeColor(t, rowEdge(a)));
  const here = address != null && address === current;
  const card = () => openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: runProps(r) });
  const open = term ? () => (r && cardBesideOrchestrator(r, orchestratorState(r, ctx)) ? focusWithPane(address, runProps(r)) : focusAgent(address)) : card;
  return v_flex().id(id).flex_none().gap(3).px(PAD).pt(4).pb(5).rounded(6).cursor_pointer()
    .when(here, (el) => el.bg(SELECTED(t))).hover((st) => st.bg(here ? SELECTED(t) : t.hover))
    .tooltip(tip).on_click(open)
    .child(h_flex().gap(8).items_center().min_w(0)
      .child(h_flex().w(12).flex_none().justify_center().child(dot))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(name.title))
      .when(Boolean(type), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(type))))
      .when(Boolean(prog), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(prog.text))))
    // The bar sits under the name, from the name's left edge to the row's right.
    .when(Boolean(prog), (el) => el.child(h_flex().ml(20).h(3).rounded(2).overflow_hidden().bg(t.border)
      .child(div().h_full().flex_grow(prog.frac).bg(t.muted))
      .child(div().h_full().flex_grow(1 - prog.frac))));
}

// A Needs-you entry under the box: two short lines, its name and why (with its age), in its
// colour; no tags, no buttons. A click opens it in the box (or, without a run directory, focuses
// its orchestrator, where its dialog waits).
function needRow(m, x, onOpen) {
  const { t, now, narrow } = m;
  const { term, r, a } = x;
  const name = runName(r?.branch ?? term?.name ?? term?.address, term?.labels?.["run.topic"] ?? r?.topic);
  const { lead, tone } = rowLead(a, now, { narrow });
  const edge = edgeColor(t, rowEdge(a));
  const color = tone === "amber" ? AMBER(t) : tone === "pass" ? PASS(t) : t[tone] ?? t.dim;
  const open = onOpen ?? (() => (term ? focusAgent(term.address) : null));
  const id = `crew-need-${needKey(x)}`;
  return v_flex().id(id).relative().overflow_hidden().flex_none().gap(1).pl(PAD + 3).pr(PAD).py(5).rounded(6)
    .bg(edge + "14").cursor_pointer().hover((st) => st.bg(edge + "26"))
    .tooltip([name.tip ?? name.title, ...rowTip(a, now), onOpen ? OPEN_HERE : null].filter(Boolean).join("\n")).on_click(open)
    .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(edge))
    .child(div().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(name.title))
    .child(div().min_w(0).truncate().text_size(11).text_color(color).child(lead));
}

// A quiet text link, for what is not the box's one button.
const quietLink = (t, id, label, tip, onClick) => div().id(id).flex_none().text_size(11).text_color(t.dim).cursor_pointer()
  .hover((st) => st.text_color(t.foreground)).tooltip(tip).on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); }).child(label);

// actionButton's shape as a quiet link: a claim's Accept / Ask to prove in the box.
const quietButton = (t, id, label, tip, onClick) => quietLink(t, id, label, tip, (_e, cx) => onClick(cx));

// The box's buttons. Folded (the default): the one button that does the obvious thing
// (needaction.js primaryOf, or a question's recommended option) and "more". Unfolded: every
// line with its buttons, as the run's card has them. A Close or Resume asks here first.
function boxActions(m, x, f, items) {
  const { view, t, ctx } = m;
  const r = x.r;
  const key = `crew-box-more-${r.key}`;
  const more = unfolded(view, key, false);
  const it = r.ask ? decisionQueue([r], [], ctx).find((q) => q.kind === "run") : null;
  const moreLink = (n) => quietLink(t, `${key}-toggle`, more ? "less" : `${n} more`, more ? "Show only the main button" : "Every option, and what else it needs you for", toggleFold(view, key, more));
  const confirm = boxConfirm(view, t, r, f, "sidebar");
  const changes = view.replying === `changes:${r.key}` ? v_flex().gap(4).child(Input.new(view.reply))
    .child(div().text_size(10.5).text_color(t.dim).child("What should change? Enter writes it to the run's inbox and tells its orchestrator")) : null;
  if (it) {
    // A question: its recommended option is the button (else Reply); the other options, Reply
    // and anything else it needs you for under "more".
    const a = answerParts(view, t, it, ctx, "box");
    const rec = it.recommended ?? null;
    const main = rec != null ? a.optionButton(rec) : a.replyBtn || null;
    const others = items.filter((y) => y.key !== "question");
    const extra = it.options.length - (rec != null ? 1 : 0) + (rec != null && a.replyBtn ? 1 : 0) + others.length;
    const folded = h_flex().gap(10).items_center().flex_wrap().when(Boolean(main), (el) => el.child(main)).when(extra > 0, (el) => el.child(moreLink(extra)));
    const all = more && v_flex().gap(6)
      .child(h_flex().flex_wrap().gap(6).items_center().children(it.options.map((_o, i) => a.optionButton(i))).when(Boolean(a.replyBtn), (el) => el.child(a.replyBtn)))
      .children(needLines(view, t, r, f, others, "sidebar", true))
      .child(h_flex().gap(10).child(quietLink(t, `${key}-details`, "Details", "The whole question, what each option does, the evidence and the risk, in the run's pane",
        () => openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: runProps(r) }))).child(moreLink(0)));
    return [more ? all : folded, a.input || null, a.note || null, confirm].filter(Boolean);
  }
  const p = primaryOf(items);
  const main = p ? needButton(view, t, r, f, items[p.i].actions[p.j], `need-sidebar-${r.key}-${p.i}-${p.j}`, "sidebar", true) : null;
  // "N more" counts the buttons the unfolded box draws: not an "asked…" note, nor one that draws nothing.
  const drawn = items.flatMap((y, i) => y.actions.map((x, j) => (x.kind === "asked" ? null : needButton(view, t, r, f, x, `need-count-${r.key}-${i}-${j}`, "sidebar", false)))).filter(Boolean).length;
  // A merge ask's claims and checks line are unfolded with the rest, so they count too.
  const claimLines = isMergeAsk(items) ? claimsAsk(r).worthALook.length + (checksLine(r.proof?.md) ? 1 : 0) : 0;
  const extra = drawn - (main ? 1 : 0) + claimLines;
  if (more) return [...needLines(view, t, r, f, items, "sidebar"), claimLines ? mergeClaims(m, r) : null, h_flex().child(moreLink(0)), changes, confirm].filter(Boolean);
  // The button's own line when it is not the first item's (the first was asked about), so it never
  // stands without its reason; with no button at all, the first line says what is under way.
  const lineOf = main && p.i > 0 ? items[p.i] : !main ? items[0] : null;
  const line = lineOf ? div().text_size(11.5).text_color(main ? t.foreground : t.muted).child(lineOf.line) : null;
  return [line, (main || extra > 0) && h_flex().gap(10).items_center().flex_wrap().when(Boolean(main), (el) => el.child(main)).when(extra > 0, (el) => el.child(moreLink(extra))),
    changes, confirm].filter(Boolean);
}

// A merge ask's claims, under its lines when the box is unfolded: the claims worth a look first
// (claims.js claimsAsk, at most three), each one quiet line (id, words, why) with Accept / Ask
// to prove as in the run's pane, then "+ n more" (the run's pane, its Claims unfolded), then the
// whole-branch checks line. A run without claims: the checks line alone. Null with neither.
function mergeClaims(m, r) {
  const { view, t } = m;
  const ask = claimsAsk(r);
  // A click shows at once, before the next read of the run's files (overview.js said).
  const rows = withSaid(ask.worthALook.map((k) => ({ ...k })), said, r.key, r.proof);
  const checks = checksLine(r.proof?.md);
  if (!rows.length && !checks) return null;
  const tone = (k) => (k.state === "fail" ? t.blocked : k.look ? AMBER(t) : PASS(t));
  const row = (k) => h_flex().id(`crew-claim-${r.key}-${k.id}`).gap(8).items_center().min_w(0)
    .tooltip([`${k.id} ${k.name}`, k.why, k.ac ? `AC ${k.ac}` : null].filter(Boolean).join("\n"))
    .child(div().flex_none().w(18).text_size(10.5).font_semibold().text_color(tone(k)).child(k.id))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.foreground)
      .child(k.why ? `${k.name} · ${k.why}` : k.name))
    .children(k.look ? claimActions(k).map((a) => proofAction(view, t, r, k, a, quietButton)) : []);
  const pane = () => openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: { ...runProps(r), proof: true } });
  return v_flex().id(`crew-claims-${r.key}`).gap(4).pt(6).border_t(1).border_color(t.border)
    .children(rows.map(row))
    .when(ask.more > 0, (el) => el.child(h_flex().child(quietLink(t, `crew-claims-more-${r.key}`, `+ ${ask.more} more`, "Every claim, in the run's pane", pane))))
    .when(Boolean(checks), (el) => el.child(div().id(`crew-checks-${r.key}`).truncate().text_size(11)
      .text_color(checks.tone === "pass" ? PASS(t) : checks.tone === "fail" ? t.blocked : t.dim).tooltip(checks.tip).child(checks.text)));
}

// The open item of the Needs-you box: its name and level tags, why it waits (in its colour, with
// its age), then its buttons. A click on its name shows its orchestrator.
function needCard(m, x) {
  const { view, t, ctx, now, narrow } = m;
  const r = x.r;
  const f = runFacts(r, ctx);
  const items = needItemsOf(r, ctx, x.a);
  const name = runName(r.branch, x.term?.labels?.["run.topic"] ?? r.topic);
  const { lead, tone } = rowLead(x.a, now, { narrow });
  const edge = edgeColor(t, rowEdge(x.a));
  const color = tone === "amber" ? AMBER(t) : tone === "pass" ? PASS(t) : t[tone] ?? t.dim;
  const id = `crew-box-${r.key}`;
  const focus = (_e, cx) => { cx.stop_propagation(); if (x.term) focusAgent(x.term.address); };
  return v_flex().id("crew-needs-box").relative().overflow_hidden().flex_none().min_w(0).gap(6).pl(PAD + 3).pr(PAD).pt(7).pb(8).rounded(6)
    .bg(edge + "1a").on_click((_e, cx) => cx.stop_propagation())
    .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(edge))
    .child(v_flex().gap(1).min_w(0)
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().id(`${id}-title`).flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground)
          .when(Boolean(x.term), (el) => el.cursor_pointer().on_click(focus))
          .tooltip([name.tip ?? name.title, startedTip(r.started), newDecisionsNote(r), x.term ? "Click to open its orchestrator" : null].filter(Boolean).join("\n"))
          .child(name.title))
        .children([runTypeTag(t, r, id), ...levelTags(view, t, r, id, true)].filter(Boolean)))
      .child(div().id(`${id}-why`).min_w(0).truncate().text_size(11).text_color(color).tooltip(rowTip(x.a, now).join("\n")).child(lead)))
    .children(boxActions(m, x, f, items));
}

// Needs you: the box (the oldest item open, or the one clicked), then the others as compact rows,
// at most three before "+ n more". Nothing waiting: one calm line.
function needsSection(m) {
  const { view, t, groups, needs, entries, asks } = m;
  const g = GROUPS[0];
  const none = emptyNote(g, needs, entries.length);
  if (none) return [h_flex().id("crew-group-needs").flex_none().h(22).px(PAD).gap(6).items_center().text_size(10.5)
    .child(div().flex_none().font_semibold().text_color(t.dim).child(g.title)).child(div().min_w(0).truncate().text_color(t.muted).child(none))];
  if (!needs) return [];
  const list = groups.needs;
  const expanded = expandedNeed(list, view.needsOpen);
  const pick = (x) => (_e, cx) => { view.needsOpen = needKey(x); cx.notify(); };
  const moreKey = "crew-needs-more";
  const open = unfolded(view, moreKey, false);
  const { shown, extra } = needsRest(list, expanded, { open });
  const capNote = captainNeedNote(asks);
  return [
    h_flex().id("crew-group-needs").flex_none().h(22).px(PAD).items_center().text_size(10.5).font_semibold().text_color(t.blocked).child(`${g.title} · ${needs}`),
    ...(capNote ? [div().id("crew-needs-captain").flex_none().px(PAD).min_w(0).truncate().text_size(10.5).text_color(t.dim).child(capNote.replace(", above", ": captain ↗ above"))] : []),
    ...(expanded ? [needCard(m, expanded)] : []),
    ...shown.map((x) => needRow(m, x, canExpand(x) ? pick(x) : null)),
    ...(extra > 0 ? [h_flex().id("crew-needs-more").flex_none().px(PAD).h(20).items_center()
      .child(quietLink(t, "crew-needs-more-toggle", open ? "show fewer" : `+ ${extra} more waiting`, open ? "Fold them back" : "Every other thing waiting on you", toggleFold(view, moreKey, open)))] : []),
  ];
}

// Next for you: what waits on you outside live runs (mypr.js nextItems: review requests first,
// then your own open PRs that need something), amber, foldable, at most five rows (three while
// more than one thing needs you) before "+ n more". Each row: "skills#52 · title", then why and how long, muted, and one small button:
// Review on a request with a checkout here ("reviewing" while a run does), else the PR's own
// action (Merge on GitHub, Open check, Open PR). A click on the row opens the PR.
const NEXT_MAX = 5;
const smallButton = (t, id, label, tip, onClick, off = false) => h_flex().id(id).flex_none().px(7).h(20).items_center().rounded(5).bg(t.raised)
  .text_size(11).font_medium().text_color(off ? t.dim : t.muted).tooltip(tip)
  .when(!off, (el) => el.cursor_pointer().hover((st) => st.text_color(t.foreground).bg(t.hover)))
  .on_click((_e, cx) => { cx.stop_propagation(); if (!off) onClick(cx); })
  .child(label);

function nextAction(m, it, id) {
  const { t } = m;
  if (it.kind === "review") {
    if (it.run) return div().flex_none().text_size(11).text_color(t.dim).child("reviewing");
    // Started from here and its run not seen yet (newrun.js reviewStarting): never a second Review.
    if (reviewStarting(it.url)) return div().flex_none().text_size(11).text_color(t.dim).tooltip("Its review run is starting; it shows as reviewing once its run files name the PR").child("starting…");
    if (!it.local) return null;
    return smallButton(t, `${id}-act`, "Review", "Start a review run in its repository's space, with your remembered review settings", (cx) => {
      startReview({ repo: it.local, pr: it.number, url: it.url }).finally(() => cx.notify());
      cx.notify();
    });
  }
  return it.action?.url ? smallButton(t, `${id}-act`, it.action.label, it.action.url, () => openUrl(it.action.url)) : null;
}

function nextRow(m, it, i) {
  const { t } = m;
  const id = `crew-next-${i}`;
  const action = nextAction(m, it, id);
  const far = it.kind === "review" && !it.local && !it.run ? "No checkout of this repository here: open a space for it to review with one click" : null;
  return h_flex().id(id).flex_none().gap(8).px(PAD).py(3).rounded(6).items_center().cursor_pointer().hover((st) => st.bg(t.hover))
    .tooltip([`${it.repo}#${it.number}: ${it.title}`, it.url, far].filter(Boolean).join("\n"))
    .on_click(() => openUrl(it.url))
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(div().min_w(0).truncate().text_size(12).text_color(t.foreground).child(`${prRef(it.repo, it.number)} · ${it.title}`))
      .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child([it.reason, it.age != null ? ageText(it.age) : null].filter(Boolean).join(" · "))))
    .when(Boolean(action), (el) => el.child(action));
}

function nextSection(m) {
  const { view, t } = m;
  const items = nextItems({ runs: view.runs.filter((r) => !r.away) });
  const moreKey = "crew-next-more";
  const open = unfolded(view, moreKey, false);
  // While more than one thing needs you, three rows, so the runs below stay in sight.
  const max = m.needs > 1 ? 3 : NEXT_MAX;
  const extra = Math.max(0, items.length - max);
  const err = reviewError() ?? mineError();
  return section(m, {
    key: "next", title: "Next for you", count: items.length, tone: AMBER(t),
    rows: () => [
      ...(open ? items : items.slice(0, max)).map((it, i) => nextRow(m, it, i)),
      ...(extra > 0 ? [h_flex().id("crew-next-more").flex_none().px(PAD).h(20).items_center()
        .child(quietLink(t, "crew-next-more-toggle", open ? "show fewer" : `+ ${extra} more`, open ? "Fold them back" : "The rest of the list", toggleFold(view, moreKey, open)))] : []),
      ...(err ? [div().id("crew-next-error").flex_none().px(PAD).text_size(10.5).text_color(t.dim).child(`${err}: the list may be old`)] : []),
    ],
  });
}

// Adrift, compact: agents outside the crew.
function driftSection(m) {
  const drift = adriftRows(m);
  return section(m, { key: "adrift", title: "Adrift", count: drift.rows.length, rows: () => drift.rows });
}

function calmCrew(m) {
  const { view, t, entries, needRuns, orchestrators, asks, ctx } = m;
  m.groups = groupRows(entries);
  m.needs = needCount(needRuns, orchestrators, asks);
  const closing = closeAllControl(view, t, m.groups.done, ctx);
  const rest = GROUPS.slice(1).flatMap((g) => section(m, {
    key: g.key, title: g.title, count: m.groups[g.key].length, folded: Boolean(g.folded),
    action: g.key === "done" ? closing.button : null, extra: g.key === "done" && closing.confirm ? [closing.confirm] : [],
    rows: () => m.groups[g.key].map((x) => compactRow(m, x, g)),
  }));
  const needs = [...needsSection(m), ...nextSection(m)];
  const drift = driftSection(m);
  const empty = !entries.length && !drift.length;
  return v_flex().id("crew").size_full().min_h(0).bg(t.chrome).text_size(12.5)
    .child(harborHeader(m))
    .child(v_flex().id("crew-list").flex_1().min_h(0).px(PAD).pb(8).gap(4).overflow_y_scrollbar()
      .when(empty, (el) => el.child(div().px(PAD).text_size(11.5).text_color(t.dim).child("No runs yet. Start one with + New run.")))
      .children(needs)
      // A little more room between the box and the rest of the work than between rows.
      .when(needs.length > 0 && rest.length > 0, (el) => el.child(div().flex_none().h(6)))
      .children(rest)
      .children(drift)
      .children(noteRows(view, t, true)));
}
