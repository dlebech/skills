// One run on its own, as the pane pinned beside its orchestrator, and the parts the card and the pane share.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, HoverCard } from "gpui-base";
import { acceptProof, unacceptProof, overBudget, taskTone, oneWay, PR_TONE, markOpened } from "./data.js";
import { facts, agentStatus, programOf, paneBeside, togglePin, focusAgent, openUrl, closeOwnPane } from "./live.js";
import { OCTOPUS, programIcon, plural, ago, shortRef, runName, withTip, typeTag, TYPE } from "./ui.js";
import { tokenText, tokenDetail, startedTip, runAgeText } from "./context.js";
import { liveUsage } from "./resources.js";
import { claimCounts, claimsVerdict, claimResultLine, claimPill, claimActions, checksLine, reviewedLine, worthALook, hasClaims } from "./claims.js";
import { thumbs } from "./viewer.js";
import { levelChoices, autonomyTip, tierTip } from "./levels.js";
import { stepText, quietText, flowState, ciState } from "./attention.js";
import { mergePath } from "./mergepath.js";
import { paneSections, agentsSummary, auditDecisions } from "./paneorder.js";
import { newDecisions, newSinceText } from "./tell.js";
import { reviewText, prStateText, prFacts } from "./prfacts.js";
import { decisionsSeen, markDecisionsSeen } from "./telling.js";
import { workerTree } from "./crewrows.js";
import { askedLevel } from "./inbox.js";
import { askClick } from "./askclick.js";
import { reviewFlows } from "./tracking.js";
import { showsFlow } from "./needaction.js";
import { T, drawnInPane, pill, withContext, withUsage, statusDot, STAGE, stagesOf, taskStrip, tasksText, noteRows, actionButton, actionRow, PASS, AMBER, isOpen, runProps } from "./cardparts.js";
import { needItemsOf, markProofRead, firstToOpen, reviewedOf, said, isFinished, claimRowsOf, pathLink } from "./needitems.js";
import { blockingAction, addressRows, flowToggle, runFacts, waitNote, needBox, cardNotes } from "./needbox.js";

export function cardHeader(view, t, r, f, meta, lead = null) {
  return h_flex().gap(8).items_center()
    .child(div().flex_none().text_size(TYPE.title).child(OCTOPUS))
    .child(v_flex().flex_1().min_w(0)
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(withTip(div().id(`title-${r.key}`).truncate().font_semibold().text_size(TYPE.title).text_color(t.foreground), runName(r.branch, r.topic)))
        .when(Boolean(r.type), (el) => el.child(runTypeTag(t, r, r.key)))
        .children(levelTags(view, t, r, r.key, false, f.closed))
        .when(Boolean(r.machine), (el) => el.child(div().flex_none().text_size(TYPE.meta).px(5).rounded(4).bg(t.raised).text_color(t.muted).child(r.machine))))
      .child(metaLine(t, r, meta, lead)))
    .map(withContext(view, t, `run-${r.key}`, r.terminal))
    .child(runPin(t, `pin-${r.key}`, r, f.orch))
    .child(statusDot(t, f.dot))
    .when(Boolean(f.parkedNext), (el) => el.child(div().id(`parked-next-${r.key}`).min_w(0).truncate().text_size(TYPE.meta).text_color(t.dim)
      .tooltip("What its pull requests wait on, and how long it has been parked. Parked runs stay out of Needs you.").child(f.parkedNext)))
    .child(f.badge.tip ? div().id(`badge-${r.key}`).flex_none().tooltip(f.badge.tip).child(pill(t, f.badge.label, badgeColor(t, f), f.need))
      : pill(t, f.badge.label, badgeColor(t, f), f.need));
}

// A card's pill colour: red in Needs you, except a run that is ready to merge (green).
const badgeColor = (t, f) => (f.badge.ready ? PASS(t) : f.need ? "blocked" : f.badge.tone);

const unscopedOf = (r) => (r.proof.tier ? r.tasks.filter((k) => !k.proof).length : 0);

// The tokens segment, only once over the soft budget ("over budget 92M/100M", in the blocked
// colour); otherwise the tokens are in the Tokens section, not the header.
const tokenMeta = (r) => (r.tokens && r.budget && overBudget(r) ? `over budget ${tokenText(r.tokens.total)}/${tokenText(r.budget)}` : null);

export const runMeta = (r, f) => [r.repo, f.workers.length ? plural(f.workers.length, "agent") : null, tokenMeta(r), unscopedOf(r) ? `${unscopedOf(r)} unscoped` : null, r.updated ? `updated ${ago(r.updated)}` : null].filter(Boolean).join(" · ");

// The meta line as three texts, around the tokens segment: it has the breakdown on hover, and
// the blocked colour once over budget.
const metaLine = (t, r, meta, lead = null) => {
  // The pane's first segment, when the run started and how long it has gone, with its date in the hover.
  if (lead) {
    const rest = meta;
    return h_flex().min_w(0).text_size(TYPE.meta).text_color(t.dim)
      .child(div().id(`age-${r.key}`).flex_none().tooltip(startedTip(r.started)).child(lead))
      .when(Boolean(rest), (el) => el.child(div().flex_none().px(5).child("·")).child(div().min_w(0).flex_1().child(metaLine(t, r, rest))));
  }
  const tok = tokenMeta(r), at = tok ? meta.indexOf(tok) : -1;
  const line = h_flex().min_w(0).text_size(TYPE.meta).text_color(t.dim);
  if (at < 0) return div().truncate().text_size(TYPE.meta).text_color(t.dim).child(meta);
  const over = overBudget(r);
  const tip = !r.budget ? tokenDetail(r.tokens) : `${tokenDetail(r.tokens)}\n${over ? "Over its" : "Under its"} soft budget of ${r.budget.toLocaleString("en")} tokens`;
  return line.child(div().flex_none().child(meta.slice(0, at)))
    .child((over ? div().id(`over-${r.key}`).text_color(t.blocked).font_semibold() : div().id(`tokmeta-${r.key}`)).min_w(0).truncate().tooltip(tip).child(tok))
    .child(div().truncate().child(meta.slice(at + tok.length)));
};

// A card's edge: red when it needs you, else its pill's colour; a muted pill (running) has none.
export const runEdge = (t, f) => (f.badge.ready ? PASS(t) : f.need ? t.blocked : f.badge.tone === "muted" ? t.border : t[f.badge.tone] ?? t.border);

// ---- shared by the card and the pane ----

// Texts joined by dim dots, each in its own colour: [{ text, color?, bold?, el? }]; `el`
// is a ready element (a link) used as is.
export function joined(t, items) {
  return items.filter(Boolean).flatMap((x, i) => [
    i > 0 ? div().flex_none().px(5).text_color(t.dim).child("·") : null,
    x.el ?? div().flex_none().when(Boolean(x.color), (e) => e.text_color(x.color)).when(Boolean(x.bold), (e) => e.font_semibold()).child(x.text),
  ]).filter(Boolean);
}

// The facts line, the one prominent line under the header: when the run started and how
// long it has gone, then each of its PRs (a link) with its checks, a one-way door, and its review.
// "Started today 09:28 · finished after 8h 7m · PR #42 open · checks ✓". Null when it has none of them.
// `parts: "live"` (the pane) leaves out the start time and the PRs, which its header and the strip say.
export function factsLine(t, r, prs, size = 13, att = null, { parts = "all" } = {}) {
  const items = [];
  if (r.started && parts !== "live") items.push({ el: div().id(`age-${r.key}`).flex_none().tooltip(startedTip(r.started)).child(runAgeText(r)) });
  // The current step and its age, as the Crew shows it, while the run is not finished; the
  // progress line carries its own age (progressLine). A stalled run says so, in amber.
  const live = att && r.phase !== "finished" && !r.away;
  if (live && att.stall) items.push({ text: quietText(att.stall), color: AMBER(t), bold: true });
  if (live && att.step?.text && att.step.text !== r.progress) items.push({ text: stepText(att.step), color: t.muted });
  // Each PR (a link) with its checks, a one-way door and its review; PRs that all say the same
  // as one ("2 PRs open · checks ✓ · Approved by anna"), each one's title and link in its hover.
  for (const x of parts === "live" ? [] : prFacts(prs, { away: Boolean(r.away), oneWay })) {
    if (x.kind === "pr") {
      const p = x.pr;
      items.push({ el: div().id(`fact-pr-${r.key}-${x.i}`).flex_none().cursor_pointer().hover((s) => s.text_color(t.accent)).tooltip(`${p.title ?? ""}\n${p.url}`.trim())
        .on_click((_e, cx) => { cx.stop_propagation(); openUrl(p.url); }).child(x.text) });
    } else if (x.kind === "prs") {
      items.push({ el: div().id(`fact-prs-${r.key}`).flex_none().tooltip(x.prs.map((p) => `${p.number ? `#${p.number} ` : ""}${p.title ?? ""}\n${p.url}`).join("\n")).child(x.text) });
    } else items.push({ text: x.text, color: x.tone === "pass" ? PASS(t) : t[x.tone], bold: x.bold });
  }
  if (items.length === 0) return null;
  return h_flex().flex_wrap().items_center().text_size(size).font_medium().text_color(t.foreground).children(joined(t, items));
}

// The strip's input from what runFacts has: plain data for mergepath.js.
export function pathInput(r, f, stages) {
  const rows = hasClaims(r) ? claimRowsOf(r, stages) : null;
  const c = rows ? claimCounts(rows) : null;
  const md = r.proof?.md;
  const reviewed = reviewedOf(r);
  const state = md?.checks?.state;
  return {
    phase: r.phase, away: r.away, counts: f.counts, blockedTasks: r.tasks.filter((k) => taskTone(k.state) === "blocked").length,
    claims: c ? { total: c.total, proven: c.proven, accepted: c.accepted, failed: c.fail, look: c.look } : null,
    checks: state === "green" || state === "red" ? state : state ? "pending" : null,
    reviewed, flow: flowState(r, reviewFlows()).flow, prs: f.prs.length,
    allMerged: f.prs.length > 0 && f.prs.every((p) => p.state === "MERGED"),
    next: f.att?.next ? { label: f.att.next.label, who: f.att.next.who ?? [] } : null,
    held: Boolean(f.att?.held), ready: Boolean(f.att?.ready), ci: ciState(f.prs).state,
    waitingOn: f.att?.waitingOn?.text ?? null,
    proofRead: Boolean(f.att?.proofRead), markReady: Boolean(f.att?.markReady),
  };
}

// The path-to-merge strip under the pane's header: each stage with its value and mark, a click on
// one that has a section unfolds it ("Built 3/3 ✓ › Proven 6/6 ✓ › AI review ⚠ 2 behind › Peer review ● you › Merge").
function pathStrip(view, t, r, f, stages) {
  // A stage opens the Claims section, which an old run without claims does not have, or the Tasks
  // section, which only has something to open while it is a single line.
  const tasksFold = paneSections({ finished: isFinished(r) }).some((x) => x.key === "tasks" && x.compact) && (f.counts.planned > 0 || r.tasks.length > 0);
  const stops = mergePath(pathInput(r, f, stages)).map((s) => (s.fold === "claims" && !hasClaims(r) || s.fold === "tasks" && !tasksFold ? { ...s, fold: null } : s));
  const open = (fold) => { view.folds ??= new Map(); if (fold === "claims") view.folds.set(`pf-${r.key}`, true); if (fold === "tasks") view.folds.set(`tk-${r.key}`, true); };
  const part = (s) => {
    const ask = s.value === "ask" || s.value === "read the proof";
    const label = div().flex_none().child(s.label);
    const value = (c) => (s.value ? div().flex_none().text_color(c).child(s.value) : null);
    const tone = {
      done: [t.muted, t.muted], current: [t.foreground, t.muted], you: [t.foreground, t.muted], look: [t.foreground, AMBER(t)],
      fail: [t.foreground, t.blocked], todo: [t.dim, t.dim],
    }[s.state];
    // Each piece sets its own colour, so a clickable stage's hover goes on every piece (a hover on the
    // stage alone would be overridden by them).
    const hov = (el, n) => (s.fold ? el.id(`path-${s.key}-${r.key}-${n}`).hover((x) => x.text_color(t.accent)) : el);
    const mark = (c, text, bold = false) => div().flex_none().text_color(c).when(bold, (e) => e.font_semibold()).child(text);
    const kids = [label.text_color(tone[0]).when(s.state === "current", (e) => e.font_medium()).when(s.state === "you", (e) => e.font_semibold())];
    if (s.state === "done") kids.push(s.value ? value(t.muted) : null, mark(PASS(t), "✓"));
    else if (s.state === "you") kids.push(ask ? null : value(t.muted), mark(t.blocked, ask ? `● you · ${s.value}` : "● you", true));
    else if (s.state === "look") kids.push(mark(AMBER(t), s.value ? `⚠ ${s.value}` : "⚠"));
    else if (s.state === "fail") kids.push(mark(t.blocked, s.value ? `✗ ${s.value}` : "✗"));
    else if (s.value) kids.push(value(tone[1]));
    return h_flex().id(`path-${s.key}-${r.key}`).flex_none().gap(4).items_center().tooltip(s.tip)
      .when(Boolean(s.fold), (e) => e.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); open(s.fold); cx.notify(); }))
      .children(kids.map((k, n) => (k ? hov(k, n) : null)).filter(Boolean));
  };
  return h_flex().flex_wrap().items_center().gap_y(2).text_size(TYPE.body)
    .children(stops.flatMap((s, i) => [part(s), i < stops.length - 1 ? div().flex_none().px(6).text_color(t.dim).child("›") : null]).filter(Boolean));
}

// A red line under the strip while any PR is a one-way door: the warning the facts line used to carry.
function oneWayLine(t, r, prs) {
  if (!prs.some((p) => p.danger && oneWay(p.danger))) return null;
  return div().id(`oneway-${r.key}`).text_size(TYPE.body).font_semibold().text_color(t.blocked).child("one-way door");
}

// The orchestrator's own progress note: under the facts, smaller and muted, since it is in
// its words and can lag behind. While it is the run's current step, with that step's age.
export const progressLine = (t, r, att = null) => div().text_size(TYPE.meta).text_color(t.muted)
  .child(att?.step?.text === r.progress && r.phase !== "finished" && !r.away ? stepText(att.step) : r.progress);

// The claims verdict (claims.js claimsVerdict) as coloured parts, for the card and the Claims
// section's fold line; an old run (no claims) has only its red checks, if any. Null when there is
// nothing to say. `stages` is stagesOf()'s (null: by plan.md's states).
export function claimsSummary(t, r, stages = null) {
  const color = { pass: PASS(t), fail: t.blocked, amber: AMBER(t), muted: t.muted, dim: t.dim };
  const paint = (p) => ({ text: p.text, bold: p.bold, color: p.tone ? color[p.tone] : null });
  if (!hasClaims(r)) {
    const red = r.proof.md?.checks?.state === "red" ? checksLine(r.proof.md) : null;
    return red ? { parts: [paint(red)], tip: red.tip } : null;
  }
  const rows = claimRowsOf(r, stages);
  const v = claimsVerdict(rows, { tier: r.proof.tier?.tier, md: r.proof.md, reviewed: reviewedLine(r.proof.md, r.reviewedGap) });
  return { parts: v.parts.map(paint), rows, tip: v.tip || null };
}

// ---- one run on its own, as the pane pinned beside its orchestrator ----

// A section of the pane is its title line and its rows, with no box of its own: the pane's gap
// separates it from the next. The title line starts at the card's content edge (A); the rows under
// it are indented one step (B, 18 px further), so the pane has two left edges and two surface levels
// (the card, and its rows in t.raised).
const ROW_INDENT = 18;

const rowsAt = (rows) => v_flex().gap(4).pl(ROW_INDENT).children(rows.filter(Boolean));

const stack = (head, rows = []) => v_flex().gap(4).child(head).when(rows.some(Boolean), (el) => el.child(rowsAt(rows)));

// The one title style: the section's name in meta size, semibold, muted; what follows ` · `
// (a count, a summary) in dim, regular weight. `parts` are texts or ready elements; a part with
// a colour (a verdict) keeps it.
const titleLine = (t, title, parts = [], tail = null) => h_flex().items_center().min_w(0).text_size(TYPE.meta).text_color(t.dim)
  .child(h_flex().flex_1().min_w(0).flex_wrap().items_center()
    .children(joined(t, [{ el: div().flex_none().font_semibold().text_color(t.muted).child(title) }, ...parts.filter(Boolean)])))
  .when(Boolean(tail), (el) => el.child(tail));

// A static section: "Pull requests · 1" splits at its first " · " so the count is dim; `rest` follows (a toggle).
const section = (t, title, rows = [], ...rest) => {
  const [name, ...count] = String(title).split(" · ");
  return stack(titleLine(t, name, [count.length ? { text: count.join(" · ") } : null, ...rest.filter(Boolean).map((x) => (typeof x === "string" ? { text: x } : { el: x }))]), rows);
};

// `title`: a header like Decisions', the section's name in semibold text ahead of the summary,
// with no small grey label above.
function foldLine(view, t, key, tip, items, onOpen = null, title = null) {
  const open = isOpen(view, key);
  // Colour only on status words: a neutral part is dim and regular, as the title style says.
  const parts = items.map((x) => (x && !x.el && !x.color ? { ...x, bold: false } : x));
  // "Agents · 3": the count after the name is a summary like the rest.
  const [name, ...count] = String(title ?? "").split(" · ");
  if (count.length) parts.unshift({ text: count.join(" · ") });
  return h_flex().id(`fold-${key}`).items_center().min_w(0).rounded(4).cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(tip)
    .on_click((_e, cx) => { cx.stop_propagation(); view.folds ??= new Map(); view.folds.set(key, !open); if (!open) onOpen?.(); cx.notify(); })
    .child(titleLine(t, name, parts).flex_1())
    .child(chevron(t, open));
}

// The fold's chevron, at the right end of its title line, so every title starts at the same x.
const chevron = (t, open) => svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().ml(6).text_color(t.dim);

// A PR as a row with room to spare: its whole title, then repo, checks and review.
// `away`: the run is parked or closed, so failing checks are dim, not red (prfacts.js prFacts).
function prDetail(t, pr, i, related = false, away = false) {
  const tone = PR_TONE[pr.state] ?? "dim";
  const c = pr.checks ?? {};
  const checkText = c.fail ? `✗ ${c.fail} failing` : c.pending ? `… ${c.pending} running` : c.pass ? `✓ ${c.pass} checks` : null;
  const checkColor = c.fail ? (away ? t.dim : t.blocked) : c.pending ? t.dim : PASS(t);
  const review = reviewText(pr);
  const state = prStateText(pr);
  return h_flex().id(`prd-${related ? "rel" : "own"}-${i}-${pr.url}`).gap(8).items_start().p(8).rounded(7).bg(t.raised + "88").cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(pr.url).on_click((_e, cx) => { cx.stop_propagation(); openUrl(pr.url); })
    .child(svg("mods/harbormaster/pr.svg").size(14).flex_none().mt(1).text_color(t[tone] ?? t.dim))
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(TYPE.body).text_color(t.foreground).child(pr.title ?? pr.url))
      .child(h_flex().flex_wrap().gap_x(10).text_size(TYPE.meta).text_color(t.dim)
        .child(div().child(`${pr.repo ?? shortRef(pr.url)}${pr.number ? ` #${pr.number}` : ""}`))
        .when(Boolean(checkText), (el) => el.child(div().text_color(checkColor).child(checkText)))
        .when(Boolean(review), (el) => el.child(div().text_color(review[1] === "done" ? PASS(t) : t[review[1]]).child(review[0]))))
      // Merge danger lives here only, in full: red for a one-way door.
      .when(Boolean(pr.danger), (el) => el.child(div().id(`danger-${pr.url}`).text_size(TYPE.meta).text_color(oneWay(pr.danger) ? t.blocked : t.muted)
        .child(`Merge danger: ${pr.danger}`))))
    .when(Boolean(state), (el) => el.child(pill(t, state, tone)));
}

// ---- proof ----

// The colour of a claim's pill (claims.js claimPill's tone).
const PILL_COLOR = { pass: PASS, fail: (t) => t.blocked, amber: AMBER, dim: () => "dim", muted: () => "muted" };

// ---- the run's level tags ----

// A run's tags, as the pane header and its Crew row show them: its type, then its autonomy and,
// with a tier, its proof tier. `r` may be a stand-in for a run without a directory
// ({type, autonomy} from its terminal's labels): its tags then only say what they are.
// `short`, for the narrow Crew block, writes a pending request "T3…" instead of "T3 requested…".
// The type tag on its own, apart from the level tags.
export const runTypeTag = (t, r, id) => (r.type ? typeTag(t, r.type, `type-${id}`, T(10, "meta")) : null);

// `closed`: a closed run's levels can't change, so its tags only say what they are, with the
// definition on hover, and skip the level list: it is a whole card per tag, and the closed list
// draws one or two per run (proof t1-timing).
export function levelTags(view, t, r, id, short = false, closed = false) {
  const tag = closed ? fixedLevelTag : levelTag;
  return [
    tag(view, t, r, "autonomy", `auto-${id}`, short),
    r.proof?.tier ? tag(view, t, r, "tier", `tier-${id}`, short) : null,
  ].filter(Boolean);
}

// What a tier tag adds under its levels, the same on a closed run's tag: who set it, and the tasks
// without a proof tier.
const tierNotes = (r) => [r.proof.tier.byUser && "Set by user", r.tasks.some((k) => !k.proof) && `${plural(r.tasks.filter((k) => !k.proof).length, "task")} not scoped`].filter(Boolean);

function fixedLevelTag(_view, t, r, kind, id) {
  const cur = kind === "autonomy" ? r.autonomy : r.proof.tier.tier;
  return div().id(id).flex_none().text_size(T(10, "meta")).font_semibold().px(5).rounded(4).bg(t.raised)
    .text_color(kind === "autonomy" && cur === "L0" ? t.dim : t.muted)
    .tooltip(kind === "autonomy" ? autonomyTip(cur) : [tierTip(cur), ...tierNotes(r)].join("\n"))
    .child(kind === "autonomy" ? cur : `T${cur}`);
}

// An autonomy ("L1") or proof tier ("T2") tag. Resting the pointer on it opens a card that
// lists every level with its definition, the run's own highlighted; clicking another asks the
// orchestrator to change it (inbox.js: a message in the run's inbox). Until
// status.json or plan.md shows the new level, the tag reads "T3 requested…": from the request
// still unread in the inbox (r.pending), so it survives a reload, and from the click itself
// until the next read sees that message (at most 15 s, should the orchestrator be quicker).
function levelTag(view, t, r, kind, id, short = false) {
  const cur = kind === "autonomy" ? r.autonomy : r.proof.tier.tier;
  const label = (l) => (kind === "autonomy" ? l : `T${l}`);
  // The click's own mark goes once the run's files show the request, or the level itself, or
  // after 15 s (inbox.js askedLevel).
  const pending = askedLevel(r, kind, cur);
  // A request waits on the orchestrator, not on you: no colour, its "requested…" says it.
  const tag = div().flex_none().text_size(T(10, "meta")).font_semibold().px(5).rounded(4).bg(t.raised)
    .text_color(pending !== null ? t.foreground : kind === "autonomy" && cur === "L0" ? t.dim : t.muted)
    .child(pending !== null ? `${label(pending)}${short ? "…" : " requested…"}` : label(cur));
  const canAsk = Boolean(r.dir && r.localTerminal);
  const notes = kind === "tier" ? tierNotes(r) : [];
  const choice = (c) => {
    const ask = canAsk && !c.current && !c.pending;
    return h_flex().id(`${id}-${c.label}`).gap(8).items_start().px(6).py(4).rounded(5)
      .when(c.current, (el) => el.bg(t.selected))
      .when(ask, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => {
        cx.stop_propagation();
        // Written but not woken: the request is in the inbox, so it stays requested.
        askClick(view, cx, r, "level", { kind, level: c.level }, { asks: [{ key: kind, item: { level: c.level, current: cur } }] });
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
        .child(kind === "autonomy" ? "Autonomy: how much the orchestrator decides itself" : "Proof tier: what proves a claim (its bar, unless it names its own)"))
      .children(levelChoices(kind, cur, pending).map(choice))
      .children(notes.map((n) => div().px(6).text_size(10.5).text_color(t.dim).child(n)))
      .child(div().px(6).pt(4).text_size(10.5).text_color(t.dim)
        .child(canAsk ? "Click a level to ask the orchestrator to change it" : "Its orchestrator isn't known here, so it can't be changed from here")));
}

// "Decisions": the heading row is the fold, at the top, with its chevron and the counts
// ("Decisions · 57 · 45 by the orchestrator, 12 from you"), in normal text with only the
// chevron and the counts muted. Folded, that row is all of it. Unfolded, every decision as its
// one-line title (yours marked "You"); clicking one shows all of it and its reason. A line that
// did not parse shows its raw text.
function decisionsSection(view, t, r) {
  const key = `dec-${r.key}`, open = isOpen(view, key);
  // Unfolding marks every line seen (telling.js); the lines new then stay marked while it is
  // open, by the seen time from before (view.decWas).
  const seen = decisionsSeen(r);
  const fresh = new Set(newDecisions(r.decided, open ? view.decWas?.get(key) ?? seen : seen));
  const since = !open ? newSinceText(fresh.size) : null;
  const you = r.decided.filter((d) => d.by === "user").length, orch = r.decided.length - you;
  const counts = [orch > 0 && `${orch} by the orchestrator`, you > 0 && `${you} from you`].filter(Boolean).join(", ");
  const title = (d) => `${d.by === "user" ? "You · " : ""}${d.topic ? `${d.topic}: ${d.decision}` : d.decision}`;
  // A narrow age column starting at edge B ("12h" plus 10 px); the new-since-last-look dot hangs in the gap before it.
  const when = (d, isNew) => div().relative().flex_none().w(36).pr(10).text_color(t.dim).child(d.at ? ago(d.at).replace(" ago", "") : "—")
    .when(isNew, (el) => el.child(div().absolute().left(-9).top(5).w(6).h(6).rounded(3).bg(t.accent).tooltip("New since you last looked")));
  // One line each, cut to fit; a click shows its whole title and its reason under it.
  // Every row clicks, since any title can be cut, reason or not. Keyed on the line itself, not
  // its place: a new decision moves every row down one.
  const line = (d, i) => {
    const id = `${r.key}-${d.raw}`, more = view.decRows?.has(id);
    return h_flex().id(`decl-${r.key}-${i}`).items_start().rounded(4).text_size(TYPE.body)
      .cursor_pointer().hover((st) => st.bg(t.hover)).tooltip(more ? "Show one line" : d.why ? "Show all of it and the reason" : "Show all of it")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        view.decRows ??= new Set();
        if (more) view.decRows.delete(id); else view.decRows.add(id);
        cx.notify();
      })
      .child(when(d, fresh.has(d)))
      .child(v_flex().flex_1().min_w(0)
        .child(div().when(!more, (el) => el.truncate()).text_color(t.foreground).when(fresh.has(d), (el) => el.font_semibold()).child(title(d)))
        .when(Boolean(more && d.why), (el) => el.child(div().text_size(TYPE.meta).text_color(t.dim).child(d.why))));
  };
  const head = h_flex().id(`fold-${key}`).items_center().min_w(0).rounded(4).cursor_pointer()
    .hover((st) => st.bg(t.hover)).tooltip(open ? "Fold the decisions" : "Show every decision")
    .on_click((_e, cx) => {
      cx.stop_propagation();
      view.folds ??= new Map();
      view.folds.set(key, !open);
      view.decWas ??= new Map();
      if (open) view.decWas.delete(key);
      else { view.decWas.set(key, seen); markDecisionsSeen(r); }
      cx.notify();
    })
    .child(titleLine(t, "Decisions", [{ text: String(r.decided.length) }, since && { text: since, color: t.accent, bold: true }, counts && { text: counts }]).flex_1())
    .child(chevron(t, open));
  // A finished run shows the newest decisions the orchestrator made itself above the fold: the ones to audit.
  return stack(head, open ? r.decided.map(line) : isFinished(r) ? auditDecisions(r.decided).map((d) => line(d, r.decided.indexOf(d))) : []);
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
  const row = (a) => h_flex().id(`tok-${r.key}-${a.name}`).gap(8).items_center().h(18).text_size(TYPE.meta)
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
    { text: `output ${tokenText(output)}`, color: OUT },
    { text: `cache read ${tokenText(cacheRead)}`, color: t.muted },
    { text: `total ${tokenText(total)}`, bold: true },
  ];
  // The fold line is one dim line, total then fresh; the coloured breakdown (and when it was counted) is in the section.
  const line = [{ text: tokenText(total) }, split && { text: `${tokenText(input + output + cacheWrite)} fresh` }];
  const breakdown = h_flex().flex_wrap().items_center().text_size(TYPE.meta).text_color(t.dim)
    .children(joined(t, [...items, updated && { el: div().flex_none().text_color(t.dim).child(`counted ${ago(updated)}`) }]));
  const budget = r.budget && div().id(`budget-${r.key}`).text_size(TYPE.meta).text_color(overBudget(r) ? t.blocked : t.dim)
    .tooltip("A soft budget: crossing it asks you whether to continue, compact or stop; nothing stops by itself")
    .child(`${overBudget(r) ? "Over" : "Under"} its soft budget of ${tokenText(r.budget)} tokens`);
  const head = byAgent.length > 0 ? foldLine(view, t, key, `${tokenDetail(r.tokens)}\n${open ? "Hide" : "Show"} each agent's tokens`, line, null, "Tokens")
    : div().id(key).tooltip(tokenDetail(r.tokens)).child(titleLine(t, "Tokens", line));
  // Without per-agent bars there is nothing to unfold: the breakdown is shown.
  return stack(head, [byAgent.length === 0 || open ? breakdown : null, budget, ...(open ? byAgent.map(row) : [])]);
}

// The Claims section: what the run lets you do, each claim with the evidence that shows it.
// The verdict is the fold line ("3 of 4 proven · not yet: Drag to reorder"); folded, only the
// claims worth a look (failed, partial, below their bar, unproven) show under it; unfolded, every
// claim in plan order. A row is its id, its words, its evidence (thumbnails that open the viewer,
// a ▶ clip for the system player, "4 tests ✓" with their names on hover) and its pill; clicking
// it adds what the pill doesn't say: the result's why, where the claim comes from (AC, tasks, bar)
// and, unless it is proven or still being proved, Accept and Ask to prove (or Unaccept). Each fact
// once: the status is the pill's alone. The whole-branch checks are one line under the claims
// (dim while still running). An old run (no `## Claims` in plan.md) shows just that checks line.
// Not persisted.
function claimsSection(view, t, r, stages) {
  const { md } = r.proof;
  const checks = checksLine(md);
  const checksRow = checks && div().id(`pf-checks-${r.key}`).truncate().text_size(TYPE.meta)
    .text_color(checks.tone === "pass" ? PASS(t) : checks.tone === "fail" ? t.blocked : t.dim).tooltip(checks.tip).child(checks.text);
  // Quiet like the checks line; amber once commits came after the last review.
  const rev = reviewedLine(md, r.reviewedGap, { finished: isFinished(r), claims: hasClaims(r) });
  const reviewRow = rev && div().id(`pf-reviewed-${r.key}`).truncate().text_size(TYPE.meta)
    .text_color(rev.tone === "amber" ? AMBER(t) : t.dim).tooltip(rev.tip).child(rev.text);
  if (!hasClaims(r)) {
    // No fold, but the same header line as with claims: "Claims · <checks>".
    return titleLine(t, "Claims", [{ el: checksRow ?? div().text_color(t.dim).child("No claims: planned before claims") }]);
  }
  const s = claimsSummary(t, r, stages);
  const finished = isFinished(r);
  const key = `pf-${r.key}`, open = isOpen(view, key);
  const row = (k) => {
    const id = `${r.key}-${k.id}`;
    const more = view.proofRows?.has(id);
    const p = claimPill(k, finished);
    const failing = k.tests.filter((x) => !x.ok).length;
    const tests = k.tests.length > 0 && div().id(`pf-tests-${id}`).flex_none().text_size(TYPE.meta)
      // Red only when the pill doesn't already say fail.
      .text_color(failing && k.state !== "fail" ? t.blocked : t.dim).tooltip(k.tests.map((x) => `${x.ok ? "✓" : "✗"} ${x.name}`).join("\n"))
      .child(failing ? `${failing} of ${plural(k.tests.length, "test")} ✗` : `${plural(k.tests.length, "test")} ✓`);
    const where = [k.ac && `AC ${k.ac}`, k.tasks.length > 0 && `tasks ${k.tasks.join(", ")}`, k.tier !== null && `bar T${k.tier}`].filter(Boolean).join(" · ");
    const actions = claimActions(k);
    return v_flex().id(`pf-${id}`).gap(4).px(8).py(5).rounded(7).bg(t.raised + "88").cursor_pointer()
      .hover((st) => st.bg(t.hover)).on_click((_e, cx) => {
        cx.stop_propagation();
        view.proofRows ??= new Set();
        if (more) view.proofRows.delete(id); else view.proofRows.add(id);
        cx.notify();
      })
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().w(22).text_size(TYPE.meta).font_semibold().text_color(t.dim).child(k.id))
        .child(div().flex_1().min_w(0).when(!more, (e) => e.truncate()).text_size(TYPE.body).text_color(t.foreground).child(k.name))
        .when(k.files.length > 0, (e) => e.child(thumbs(view, t, r, k.id, k.files)))
        .when(Boolean(tests), (e) => e.child(tests))
        .when(k.asked && !more, (e) => e.child(div().flex_none().text_size(TYPE.meta).text_color(t.muted).child("asked…")))
        .child(pill(t, p.text, PILL_COLOR[p.tone](t))))
      .when(more, (el) => el
        .when(Boolean(k.why), (e) => e.child(div().pl(30).text_size(TYPE.meta).text_color(t.muted).child(k.why)))
        .when(Boolean(where), (e) => e.child(div().pl(30).text_size(TYPE.meta).text_color(t.dim).child(where)))
        .when(Boolean(k.accepted), (e) => e.child(div().pl(30).text_size(TYPE.meta).text_color(t.dim)
          .child(`You accepted it as it is${k.accepted.at ? ` ${ago(Date.parse(k.accepted.at))}` : ""}`)))
        .when(actions.length > 0, (e) => e.child(h_flex().gap(6).pl(30).pt(2).items_center().children(actions.map((a) => proofAction(view, t, r, k, a))))));
  };
  const shown = open ? s.rows : s.rows.filter(worthALook);
  return stack(foldLine(view, t, key, `${s.tip ? `${s.tip}\n` : ""}${open ? "Show only the claims worth a look" : `Show every claim (${s.rows.length})`}`, s.parts,
    // Unfolding the Claims section is reading it.
    () => markProofRead(r), "Claims"),
  [...shown.map(row), checksRow, reviewRow, open && md ? h_flex().pt(2).child(pathLink(t, r, `pf-md-${r.key}`, "proof.md", "proof.md")) : null]);
}

// A claim row's button: Accept (Harbormaster records it in proof-accepted.json itself, so it works
// with the orchestrator gone), Unaccept, Ask to prove (a "prove C<n> to T<n>: …" message in the
// run's inbox), or "asked…" while that waits. An Accept or Unaccept shows at once (`said`), before
// the next read of the run's files; an ask is marked asked in inbox.js.
const PROOF_ACTION = {
  accept: { label: "Accept", tip: "Accept this claim as it is: it stops needing a look, until its result changes" },
  unaccept: { label: "Unaccept", tip: "Take the acceptance back: it needs a look again" },
  ask: { label: "Ask to prove", tip: "Ask the orchestrator to prove this claim to its bar (a message in its inbox)" },
};

// `button` draws it (actionButton's arguments): the sidebar's box passes a quieter one.
export function proofAction(view, t, r, k, a, button = actionButton) {
  if (a === "asked") return div().id(`pfx-${r.key}-${k.id}`).text_size(T(11, "meta")).text_color(t.muted).tooltip("Waiting for the orchestrator to prove it").child("asked…");
  const line = claimResultLine(k);
  const { label, tip } = PROOF_ACTION[a];
  return button(t, `pf${a}-${r.key}-${k.id}`, label, tip, (cx) => {
    if (a === "ask") return askClick(view, cx, r, "proof", { row: k }, { asks: [{ key: k.id, item: k }] });
    const key = `${r.key}:${k.id}`;
    said.set(key, { kind: a, line, at: Date.now() });
    view.actionError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (a === "accept") await acceptProof(r, k);
        else await unacceptProof(r, k);
      } catch (e) {
        said.delete(key);
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
    .child(div().flex_1().min_w(0).truncate().text_size(TYPE.body).text_color(t.foreground).child(shortRef(url)));
}

// The connectors before a nested worker, drawn as lines (as Herdr's Agents list does) so they join
// across the 4px gap between rows: a cell per level, 20px wide, its vertical under the parent's
// icon centre (7px in), bending at mid-height into an arm that reaches the child's icon.
const TREE_CELL = 20, ROW_H = 24, ROW_GAP = 4;

function treeLines(t, { depth, last, guides }) {
  if (depth === 0) return [];
  const cell = () => div().relative().flex_none().w(TREE_CELL).h(ROW_H);
  const vertical = (h) => div().absolute().left(7).top(-ROW_GAP).h(h).w(1).bg(t.dim);
  const through = guides.map((more) => (more ? cell().child(vertical(ROW_H + ROW_GAP)) : cell()));
  const elbow = cell().child(vertical(last ? ROW_H / 2 + ROW_GAP : ROW_H + ROW_GAP))
    .child(div().absolute().left(7).top(ROW_H / 2).w(TREE_CELL - 8).h(1).bg(t.dim));
  return [...through, elbow];
}

// One of the run's agents: its name, the task it works on and that task's stage, when
// its name says (impl-<prefix>-<task>); a helper it started (a dev server) indented below it.
function workerRow(t, w, ctx, work, line) {
  const nested = line.depth > 0;
  const status = agentStatus(w, ctx);
  const color = work?.stage ? STAGE[work.stage].color(t) : null;
  return h_flex().id(`wk-${w.address}`).gap(8).items_center().h(24).px(8).rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); focusAgent(w.address); })
    .tooltip(work?.task.about ? `${w.name ?? w.address}: ${work.task.about}` : "Show this agent")
    .children(treeLines(t, line))
    .child(programIcon(programOf(w, ctx), 14, nested ? t.muted : t.foreground))
    .child(div().flex_none().text_size(TYPE.body).text_color(nested ? t.muted : t.foreground).child(w.name ?? w.address))
    .child(div().flex_1().min_w(0).truncate().text_size(TYPE.meta).text_color(t.dim)
      .child(work ? [work.task.id, work.task.name].filter(Boolean).join(" ") : ""))
    .when(Boolean(color), (el) => el.child(div().flex_none().text_size(11).text_color(color).child(STAGE[work.stage].label)))
    .map(withUsage(t, `wk-${w.address}`, liveUsage(w.address), "This agent and its commands"))
    .child(statusDot(t, status));
}

// The run's card laid out for a pane of its own: the same header, need, progress and
// buttons, then its PRs with their whole titles, issues and related PRs one per row,
// the tasks as a bar, counted by stage, and the agents working on it.
const runDetail = (view, t, r, ctx) => drawnInPane(() => drawRunDetail(view, t, r, ctx));

function drawRunDetail(view, t, r, ctx) {
  const f = runFacts(r, ctx);
  const { orch, closed, need, counts, prs, related, workers, stages } = f;
  // Each agent's task and that task's stage, by address.
  const workOf = new Map(stages.flatMap(({ agents, stage }, i) => agents.map((a) => [a.agent.address, { task: r.tasks[i], stage }])));
  const facts = factsLine(t, r, prs, TYPE.body, f.att, { parts: "live" });
  const strip = pathStrip(view, t, r, f, stages);
  const door = oneWayLine(t, r, prs);
  const notes = cardNotes(t, r, f, false);
  const blocking = need ? null : blockingAction(view, t, r, f.att, `pane-${r.key}`);
  const comments = addressRows(view, t, r, ctx, f, `pane-${r.key}`);
  // The need box carries the self/peer choice where it applies, so the section header does not.
  const flowInBox = need && showsFlow(needItemsOf(r, ctx, f.att));
  // Each section by key, built only when it has something to show; paneorder.js says in which order
  // and whether as one line (a finished run's Tasks and Agents).
  const sections = new Map();
  // Who reviews means nothing before there is a PR to review: the toggle comes with the first. With
  // no PR it is one dim line, not a box.
  sections.set("prs", () => (prs.length === 0
    ? div().text_size(TYPE.meta).text_color(t.dim).child(r.phase === "finished" ? "None" : "No pull request yet")
    : section(t, `Pull requests · ${prs.length}`, prs.map((p, i) => prDetail(t, p, i, false, Boolean(r.away))), r.away || flowInBox ? null : flowToggle(t, r, `pane-${r.key}`))));
  if (r.issues.length + related.length > 0) sections.set("issues", () => section(t, "Issues and related PRs", [
    ...r.issues.map((url) => issueRow(t, url)), ...related.map((p, i) => prDetail(t, p, i, true, Boolean(r.away)))]));
  if (hasClaims(r) || r.proof.md?.checks || r.proof.md?.reviewed?.length) sections.set("claims", () => claimsSection(view, t, r, stages));
  if (counts.planned > 0 || r.tasks.length > 0) sections.set("tasks", (compact) => {
    const key = `tk-${r.key}`;
    const strip = div().pb(2).child(taskStrip(t, r, counts, stages, false));
    if (!compact) return section(t, "Tasks", [strip], tasksText(r, counts, stages));
    return stack(foldLine(view, t, key, `${isOpen(view, key) ? "Hide" : "Show"} the tasks`, [{ text: tasksText(r, counts, stages) }], null, "Tasks"),
      isOpen(view, key) ? [strip] : []);
  });
  if (r.decided.length > 0) sections.set("decisions", () => decisionsSection(view, t, r));
  if (workers.length > 0) sections.set("agents", (compact) => {
    const key = `ag-${r.key}`, sum = agentsSummary(workers.map((w) => w.name ?? w.address));
    const tree = () => workerTree(workers, r.terminal).map((line) => workerRow(t, line.w, ctx, workOf.get(line.w.address), line));
    if (!compact) return section(t, sum.head, tree());
    return stack(foldLine(view, t, key, `${isOpen(view, key) ? "Hide" : "Show"} the agents`, [{ text: sum.names }], null, sum.head),
      isOpen(view, key) ? tree() : []);
  });
  if (r.tokens) sections.set("tokens", () => tokensSection(view, t, r));
  return v_flex().id(`run-${r.key}`).relative().overflow_hidden().flex_none().gap(14).p(14).pl(18).rounded(10).bg(t.surface)
    .border(1).border_color(t.border)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).bg(runEdge(t, f)))
    .child(div().id(`head-${r.key}`).cursor_pointer().on_click(() => { if (orch !== "gone") { markOpened(r); focusAgent(r.terminal); } })
      .child(cardHeader(view, t, r, f, runMeta(r, f), r.started ? runAgeText(r) : null)))
    .child(v_flex().gap(4).child(strip).when(Boolean(door), (e) => e.child(door)))
    .when(need, (el) => el.child(needBox(view, t, r, f, ctx, "pane")))
    .children([waitNote(t, r, f, `wait-pane-${r.key}`)].filter(Boolean))
    .when(Boolean(facts) || Boolean(r.progress) || notes.length > 0 || Boolean(blocking) || Boolean(comments), (el) => el.child(v_flex().gap(4)
      .when(Boolean(facts), (e) => e.child(facts))
      .when(Boolean(r.progress), (e) => e.child(progressLine(t, r, f.att)))
      .children(notes)
      .when(Boolean(blocking), (e) => e.child(h_flex().pt(2).child(blocking)))
      .when(Boolean(comments), (e) => e.child(div().pt(2).child(comments)))))
    .children(paneSections({ finished: isFinished(r) }).map(({ key, compact }) => sections.get(key)?.(compact)).filter(Boolean))
    .child(actionRow(view, t, r, orch, closed, counts));
}

// Adds or removes a Harbormaster pane beside an agent: the Bridge (overview.js) beside the
// captain, or one run's card beside its orchestrator (`run`). Shown greyed out, with the
// reason, while the agent's terminal is not on screen.
export function pinButton(t, id, spot, { run = null, labelled = false } = {}) {
  if (!spot) return div();
  const who = run ? "orchestrator" : "captain";
  const what = run ? "this run's card" : "the Bridge";
  const usable = Boolean(spot.pinned || spot.pane);
  const tip = spot.pinned ? `Close the Harbormaster pane beside the ${who}`
    : usable ? `Keep ${what}${run ? " (PRs, related PRs, issues, tasks)" : ""} open as a pane beside the ${who}`
    : `The ${who}'s terminal isn't on screen. Show its tab, then pin.`;
  return h_flex().id(id).flex_none().gap(5).items_center().px(labelled ? 8 : 4).h(22).rounded(5).tooltip(tip)
    .text_size(TYPE.meta).text_color(spot.pinned ? t.accent : t.dim).opacity(usable ? 1 : 0.45)
    .when(usable, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .on_click((_e, cx) => { cx.stop_propagation(); togglePin(spot, run ? runProps(run) : undefined); })
    .child(svg("mods/harbormaster/pin.svg").size(13))
    .when(labelled, (el) => el.child(spot.pinned ? "Unpin" : `Pin beside ${who}`));
}

// Whether a run's card can open beside its orchestrator: the orchestrator is there.
export const cardBesideOrchestrator = (r, orch) => Boolean(r?.terminal) && orch !== "gone" && !r.away;

// The pin for a run's card beside its orchestrator, while the orchestrator is there.
const runPin = (t, id, r, orch) => (cardBesideOrchestrator(r, orch) ? pinButton(t, id, paneBeside(r.terminal), { run: r }) : div());

// The run a run pane's props name. Panes saved before runProps() carry `run`, a run key
// ("<machine>:<dir>"), whose machine may be another screen's name: only its dir counts.
// The orchestrator's terminal comes first: an orchestrator can move its run to another
// directory (a new integration branch), and its pane should follow it there.
export function runOfProps(runs, p) {
  const byTerminal = p.terminal ? runs.filter((x) => x.localTerminal === p.terminal) : [];
  if (byTerminal.length) return byTerminal.find((x) => x.dir === p.dir) ?? byTerminal.find((x) => !x.away && !x.superseded) ?? byTerminal.find((x) => !x.away) ?? byTerminal[0];
  const dir = p.dir ?? (typeof p.run === "string" ? p.run.slice(p.run.indexOf(":") + 1) : null);
  return runs.find((x) => x.dir === dir) ?? null;
}

// One run's card, as a pane pinned beside its orchestrator (props() as runProps() gives them).
export function runPane(view, t, p) {
  const ctx = facts();
  const r = runOfProps(view.runs, p);
  // A popup opened with "details" (show-run) starts with the question's Details unfolded, once.
  if (p.details && r && !view.detailsShown) { view.folds ??= new Map(); view.folds.set(`q-${r.key}`, true); view.detailsShown = true; }
  // One opened with "proof" starts with every claim listed and the first worth a look (else the
  // first still being proved) unfolded, once the run's claims have been read.
  if (p.proof && r && !view.proofShown && hasClaims(r)) {
    const k = firstToOpen(r, stagesOf(r, ctx));
    view.folds ??= new Map(); view.folds.set(`pf-${r.key}`, true);
    if (k) { view.proofRows ??= new Set(); view.proofRows.add(`${r.key}-${k.id}`); }
    view.proofShown = true;
  }
  return v_flex().id("run-pane").size_full().min_h(0).bg(t.canvas ?? t.chrome).text_size(TYPE.body)
    .child(v_flex().id("run-pane-list").flex_1().min_h(0).p(10).gap(8).overflow_y_scrollbar()
      .child(r ? runDetail(view, t, r, ctx) : view.runs.length
        ? v_flex().p(12).gap(8).items_start().text_size(12).text_color(t.dim)
          .child("This run is no longer in the harbor. Pin its card again from the Bridge or the Crew block.")
          .child(actionButton(t, "close-pane", "Close this pane", null, () => closeOwnPane()))
        : div().p(12).text_size(12).text_color(t.dim).child("Reading the run…"))
      .children(noteRows(view, t, false)));
}
