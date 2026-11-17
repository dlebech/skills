// The Crew block (role "crew", the sidebar of harbormaster-main): a header (+ New run, captain ↗),
// the Needs-you box, Next for you, then every other run as a one-line row in small groups, and
// "Adrift". Built from separate pieces so each can be restyled alone; the pure logic is crewrows.js.
import { div, svg } from "gpui-kit";
import { openOverlay, props } from "herdr";
import { v_flex, h_flex, Input } from "gpui-base";
import { stats, runPhase, decisionQueue } from "./data.js";
import { openUrl, facts, orchestratorsOf, orchestratorState, agentStatus, workersOf, captainOf, focusAgent, focusWithPane, currentAgent, adrift, agentNames } from "./live.js";
import { programIcon, plural, runName } from "./ui.js";
import { startedTip } from "./context.js";
import { liveUsage } from "./resources.js";
import { attentionOf } from "./attend.js";
import { GROUPS, groupRows, rowLead, rowEdge, rowTip, emptyNote, crewEntries, expandedNeed, canExpand, needKey, needCount, needRunsOf, captainNeedNote, captainMark, needsRest, subtitleOf, prRef, reviewTitle, repoPrefixes } from "./crewrows.js";
import { reviewError } from "./reviews.js";
import { nextItems, mineError } from "./mypr.js";
import { ageText } from "./attention.js";
import { openNewRun, startReview, reviewStarting } from "./newrun.js";
import { primaryOf, isMergeAsk } from "./needaction.js";
import { claimsAsk, checksLine, reviewedLine, withSaid, claimActions } from "./claims.js";
import {
  attOf, runStatus, levelTags, runTypeTag, statusDot, actionButton, closeAllControl, runFacts, needItemsOf,
  newDecisionsNote, noteRows, watchedText, edgeColor, cardBesideOrchestrator, AMBER, PASS, SELECTED, withUsage, runProps,
  needButton, needLines, answerParts, boxConfirm, proofAction, said, stagesOf,
} from "./overview.js";

// A run's title as the sidebar shows it: a review's "<repo>#<n> · <topic>", else runName's; with
// the repository's name, muted, before it when another live row would read the same
// (crewrows.js repoPrefixes). `prefixes` is the Map of rows that need one, by needKey.
function titleOf(x, prefixes = new Map()) {
  const { term, r } = x;
  const topic = term?.labels?.["run.topic"] ?? r?.topic;
  const name = runName(r?.branch ?? term?.name ?? term?.address, topic);
  const rev = reviewTitle(r?.type ?? term?.labels?.["run.type"], r?.related, topic);
  return { ...name, title: rev ?? name.title, prefix: prefixes.get(needKey(x)) ?? null };
}

// The title's text with its muted repository prefix, when it has one.
const titleText = (t, name, size = 12.5, weight = null) => h_flex().flex_1().min_w(0).gap(4).items_baseline()
  .when(Boolean(name.prefix), (el) => el.child(div().flex_none().text_size(size).text_color(t.dim).child(`${name.prefix} ·`)))
  .child(div().flex_1().min_w(0).truncate().text_size(size).text_color(t.foreground).when(Boolean(weight), (el) => el.font_semibold()).child(name.title));

// What a click on a run opens: its orchestrator, with its card beside it when that fits. The same
// for a Crew row and for a Needs-you item, so the box stays in the sidebar and the run shows.
function openRun(m, x) {
  const { ctx } = m;
  const { term, r } = x;
  const address = term?.address ?? null;
  const card = () => openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: runProps(r) });
  return address ? () => (r && cardBesideOrchestrator(r, orchestratorState(r, ctx)) ? focusWithPane(address, runProps(r)) : focusAgent(address)) : card;
}

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
  return calmCrew(crewModel(view, t));
}

// ---- the sidebar ----
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
  // The label gives way first (it ellipsizes), then the spacer: the captain link never clips.
  return h_flex().id("crew-header").flex_none().h(36).pl(PAD * 2).pr(PAD).gap(8).items_center().min_w(0).overflow_hidden()
    .child(div().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child("⚓ Harbormaster"))
    .child(h_flex().id("crew-new-run").flex_none().px(7).h(22).items_center().rounded(5).bg(t.raised)
      .text_size(11.5).font_medium().text_color(t.muted).cursor_pointer().hover((st) => st.text_color(t.foreground).bg(t.hover))
      .tooltip("Start a run in a repository's own space: issues, a PR to review, or a task in your words. No captain needed")
      .on_click((_e, cx) => { cx.stop_propagation(); openNewRun(); })
      .child("+ New run"))
    .child(div().flex_1().min_w(0))
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
// and, under it, what it does now. Why it is in its group and
// what it does now are in the hover; a click focuses its orchestrator (or opens its card).
function compactRow(m, x, g) {
  const { view, t, ctx, now, current } = m;
  const { term, r, a } = x;
  const labels = term?.labels ?? {};
  const address = term?.address ?? null;
  const id = address ? `crew-${address}` : `crew-run-${r.key}`;
  const name = titleOf(x, m.prefixes);
  const type = r?.type ?? labels["run.type"] ?? null;
  const sub = subtitleOf(r?.progress ?? labels.progress, r?.statusLine);
  const { lead, rest } = rowLead(a, now);
  const tip = [name.tip ?? name.title, [lead, rest ?? (r ? null : labels.progress)].filter(Boolean).join(" · "), ...rowTip(a, now).slice(1), startedTip(r?.started)]
    .filter((l, i, all) => l && all.indexOf(l) === i).join("\n");
  // Working shows the agent's own dot (the spinner while it works); the other groups their colour.
  const dot = g.key === "working" && term ? statusDot(t, runStatus(agentStatus(term, ctx), workersOf(address, ctx), a, ctx))
    : g.key === "cant" ? statusDot(t, "gone")
    : div().size(8).flex_none().rounded(4).bg(edgeColor(t, rowEdge(a)));
  const here = address != null && address === current;
  const open = openRun(m, x);
  return v_flex().id(id).flex_none().gap(1).px(PAD).py(4).rounded(6).cursor_pointer()
    .when(here, (el) => el.bg(SELECTED(t))).hover((st) => st.bg(here ? SELECTED(t) : t.hover))
    .tooltip(tip).on_click(open)
    .child(h_flex().gap(8).items_center().min_w(0)
      .child(h_flex().w(12).flex_none().justify_center().child(dot))
      .child(titleText(t, name))
      .when(Boolean(type), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(type)))))
    // What it does now, under the name (from the name's left edge), muted and cut to one line.
    .when(Boolean(sub), (el) => el.child(div().ml(20).min_w(0).truncate().text_size(11).text_color(t.dim).child(sub)));
}

// A Needs-you entry under the box: two short lines, its name and why (with its age), in its
// colour; no tags, no buttons. A click opens it in the box (or, without a run directory, focuses
// its orchestrator, where its dialog waits).
function needRow(m, x, onOpen) {
  const { t, now, narrow } = m;
  const { term, r, a } = x;
  const name = titleOf(x, m.prefixes);
  const { lead, tone } = rowLead(a, now, { narrow });
  const edge = edgeColor(t, rowEdge(a));
  const color = tone === "amber" ? AMBER(t) : tone === "pass" ? PASS(t) : t[tone] ?? t.dim;
  const open = onOpen ?? openRun(m, x);
  const id = `crew-need-${needKey(x)}`;
  return v_flex().id(id).relative().overflow_hidden().flex_none().gap(1).pl(PAD + 3).pr(PAD).py(5).rounded(6)
    .bg(edge + "14").cursor_pointer().hover((st) => st.bg(edge + "26"))
    .tooltip([name.tip ?? name.title, ...rowTip(a, now), onOpen ? OPEN_HERE : null].filter(Boolean).join("\n")).on_click(open)
    .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(edge))
    .child(titleText(t, name, 12.5, true))
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
  const claimLines = isMergeAsk(items) ? boxClaims(r, stagesOf(r, m.ctx)).rows.length + (checksLine(r.proof?.md) ? 1 : 0) + (boxReviewed(r) ? 1 : 0) : 0;
  const extra = drawn - (main ? 1 : 0) + claimLines;
  if (more) return [...needLines(view, t, r, f, items, "sidebar"), claimLines ? mergeClaims(m, r) : null, h_flex().child(moreLink(0)), changes, confirm].filter(Boolean);
  // The button's own line when it is not the first item's (the first was asked about), so it never
  // stands without its reason; with no button at all, the first line says what is under way.
  const lineOf = main && p.i > 0 ? items[p.i] : !main ? items[0] : null;
  const line = lineOf ? div().text_size(11.5).text_color(main ? t.foreground : t.muted).child(lineOf.line) : null;
  return [line, (main || extra > 0) && h_flex().gap(10).items_center().flex_wrap().when(Boolean(main), (el) => el.child(main)).when(extra > 0, (el) => el.child(moreLink(extra))),
    changes, confirm].filter(Boolean);
}

// The claims the box shows: those worth a look. The proven ones stay in the run's pane (the box
// is for what needs you), so "+ n more" counts them with the rest. `stages` as the pane judges
// "still being proved" (overview.js stagesOf).
function boxClaims(r, stages) {
  const ask = claimsAsk(r, stages);
  const rows = ask.worthALook.filter((k) => k.look);
  return { rows, more: ask.more + ask.worthALook.length - rows.length };
}

// The branch's Reviewed line for a merge ask (claims.js reviewedLine), the run's own words for it.
const boxReviewed = (r) => reviewedLine(r.proof?.md, r.reviewedGap, { finished: r.phase === "finished" || Boolean(r.away), claims: (r.proof?.claims?.length ?? 0) > 0 });

// A merge ask's claims, under its lines when the box is unfolded: the claims worth a look first
// (claims.js claimsAsk, at most three), each one quiet line (id, words, why) with Accept / Ask
// to prove as in the run's pane, then "+ n more" (the run's pane, its Claims unfolded), then the
// whole-branch checks line. A run without claims: the checks line alone. Null with neither.
function mergeClaims(m, r) {
  const { view, t } = m;
  const ask = boxClaims(r, stagesOf(r, m.ctx));
  // A click shows at once, before the next read of the run's files (overview.js said).
  const rows = withSaid(ask.rows.map((k) => ({ ...k })), said, r.key, r.proof);
  const checks = checksLine(r.proof?.md);
  const reviewed = boxReviewed(r);
  if (!rows.length && !checks && !reviewed) return null;
  const tone = (k) => (k.state === "fail" ? t.blocked : k.look ? AMBER(t) : PASS(t));
  const row = (k) => h_flex().id(`crew-claim-${r.key}-${k.id}`).gap(8).items_center().min_w(0)
    .tooltip([`${k.id} ${k.name}`, k.why, k.ac ? `AC ${k.ac}` : null].filter(Boolean).join("\n"))
    .child(div().flex_none().w(18).text_size(10.5).font_semibold().text_color(tone(k)).child(k.id))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.foreground)
      .child(k.why ? `${k.name} · ${k.why}` : k.name))
    .children(k.look ? claimActions(k).map((a) => proofAction(view, t, r, k, a, quietButton)) : []);
  const pane = () => openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: { ...runProps(r), proof: true } });
  // Commits after the last review are the first thing worth a look; a quiet Reviewed line goes after the checks.
  const reviewedRow = reviewed && div().id(`crew-reviewed-${r.key}`).truncate().text_size(11)
    .text_color(reviewed.tone === "amber" ? AMBER(t) : t.dim).tooltip(reviewed.tip).child(reviewed.text);
  return v_flex().id(`crew-claims-${r.key}`).gap(4).pt(6).border_t(1).border_color(t.border)
    .when(reviewed?.tone === "amber", (el) => el.child(reviewedRow))
    .children(rows.map(row))
    .when(ask.more > 0, (el) => el.child(h_flex().child(quietLink(t, `crew-claims-more-${r.key}`, `+ ${ask.more} more`, "Every claim, in the run's pane", pane))))
    .when(Boolean(checks), (el) => el.child(div().id(`crew-checks-${r.key}`).truncate().text_size(11)
      .text_color(checks.tone === "pass" ? PASS(t) : checks.tone === "fail" ? t.blocked : t.dim).tooltip(checks.tip).child(checks.text)))
    .when(reviewed && reviewed.tone !== "amber", (el) => el.child(reviewedRow));
}

// The open item of the Needs-you box: its name and level tags, why it waits (in its colour, with
// its age), then its buttons. A click on its name shows its orchestrator.
function needCard(m, x) {
  const { view, t, ctx, now, narrow } = m;
  const r = x.r;
  const f = runFacts(r, ctx);
  const items = needItemsOf(r, ctx, x.a);
  const name = titleOf(x, m.prefixes);
  const { lead, tone } = rowLead(x.a, now, { narrow });
  const edge = edgeColor(t, rowEdge(x.a));
  const color = tone === "amber" ? AMBER(t) : tone === "pass" ? PASS(t) : t[tone] ?? t.dim;
  const id = `crew-box-${r.key}`;
  const go = openRun(m, x);
  const focus = (_e, cx) => { cx.stop_propagation(); if (x.term) go(); };
  return v_flex().id("crew-needs-box").relative().overflow_hidden().flex_none().min_w(0).gap(6).pl(PAD + 3).pr(PAD).pt(7).pb(8).rounded(6)
    .bg(edge + "1a").on_click((_e, cx) => cx.stop_propagation())
    .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(edge))
    .child(v_flex().gap(1).min_w(0)
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().id(`${id}-title`).flex_1().min_w(0).flex().cursor_default()
          .when(Boolean(x.term), (el) => el.cursor_pointer().on_click(focus))
          .tooltip([name.tip ?? name.title, startedTip(r.started), newDecisionsNote(r), x.term ? "Click to open its orchestrator" : null].filter(Boolean).join("\n"))
          .child(titleText(t, name, 12.5, true)))
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
  // A click expands it here and also shows its orchestrator; the sidebar stays, so the box is not lost.
  const pick = (x) => (_e, cx) => { view.needsOpen = needKey(x); cx.notify(); if (x.term) openRun(m, x)(); };
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
    // Started from here and its run not seen yet (newrun.js reviewStarting): never a second Review.
    if (reviewStarting(it.url)) return div().flex_none().text_size(11).text_color(t.dim).tooltip("Its review run is starting; it shows as reviewing once its run files name the PR").child("starting…");
    if (!it.local) return null;
    return smallButton(t, `${id}-act`, "Review", "Start a review run in its repository's space, with your remembered review settings", (cx) => {
      startReview({ repo: it.local, pr: it.number, url: it.url }).catch(() => {}).finally(() => cx.notify());
      cx.notify();
    });
  }
  return it.action?.url ? smallButton(t, `${id}-act`, it.action.label, it.action.url, () => openUrl(it.action.url)) : null;
}

function nextRow(m, it, i) {
  const { t } = m;
  const id = `crew-next-${i}`;
  const action = nextAction(m, it, id);
  const far = it.kind === "review" && !it.local ? "No clone of this repository found next to your open spaces: open a space for it to review with one click" : null;
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
  // Nothing to list and no way to look: say so, rather than look like "nothing waits on you".
  if (!items.length && err) return [h_flex().id("crew-group-next").flex_none().h(22).px(PAD).gap(6).items_center().text_size(10.5)
    .child(div().flex_none().font_semibold().text_color(t.dim).child("Next for you · ?"))
    .child(div().min_w(0).truncate().text_color(t.dim).child(err))];
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
  // Rows that would read the same get their repository's name (every live row, the box's too).
  m.prefixes = repoPrefixes(entries.map((x) => ({ key: needKey(x), title: titleOf(x).title, repo: x.r?.folder ? String(x.r.folder).split("/").pop() : null })));
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
