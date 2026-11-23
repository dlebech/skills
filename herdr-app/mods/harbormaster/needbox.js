// What a run needs from you and the box that shows it: the blocking ask, the review flow, the wait-on field and the need lines.

import { div, svg } from "gpui-kit";
import { openOverlay, props } from "herdr";
import { v_flex, h_flex, Input } from "gpui-base";
import { decisionQueue, taskCounts, prsOf, relatedOf, unknownPr, isClosed, isParked, refreshPrs, markOpened, cachedReviewers, loadReviewers, requestReview } from "./data.js";
import { facts, orchestratorState, agentStatus, workersOf, needReason, focusAgent, openUrl } from "./live.js";
import { plural, ago } from "./ui.js";
import { oneLine, needHead, questionSections, paragraphs, plain } from "./question.js";
import { stepText, quietText, flowState, flowSetting, runDot, ageText } from "./attention.js";
import { parkedLabel, newDecisions } from "./tell.js";
import { decisionsSeen } from "./telling.js";
import { badgeOf, needLine } from "./crewrows.js";
import { asked as inboxAsked } from "./inbox.js";
import { askClick } from "./askclick.js";
import { defaultMode, commentLines, commentsText, hasComments, botCount } from "./comments.js";
import { reviewFlows, setReviewFlow, setWaitingOn } from "./tracking.js";
import { ownAddressRows, primaryOf, detailsLabel, showsFlow, requestingFor } from "./needaction.js";
import { canRequest, pickerLabel } from "./reviewers.js";
import { PHASE, T, stagesOf, ACTION, actionButton, confirmBlock, PASS, AMBER, isOpen, runProps } from "./cardparts.js";
import { attOf, needsYouNow, needItemsOf, markProofRead, firstToOpen, pathLink } from "./needitems.js";
import { answerParts } from "./answers.js";

// ---- ask what's blocking, the review flow, close all merged ----

// The notes after "<branch>: " when an ask to what is blocking, or a red CI, waits or is blocked.
const ASK_NOTES = {
  waits: "the ask waits in its inbox until the run is resumed",
  blocked: "its orchestrator is blocked on a dialog; it reads the ask once that is answered",
};

// A stalled run's "Ask what's blocking" (`short`: "Ask", for the narrow Crew row), or "asked…"
// while the ask waits: its message is unread, or nothing moved since it was asked here. Null for
// a run that is not stalled, is put away, or whose orchestrator is not known here.
export function blockingAction(view, t, r, att, id, short = false) {
  if (!r?.dir || !r.localTerminal || r.away || !att?.stall) return null;
  if (inboxAsked(r, "blocking", "", r)) {
    return div().id(`blk-${id}`).flex_none().text_size(T(11, "body")).text_color(AMBER(t))
      .tooltip("Asked its orchestrator what is blocking; waiting for its progress or status to change").child("asked…");
  }
  const quiet = quietText(att.stall).replace(/^quiet /, "");
  const step = stepText(att.step) || null;
  return actionButton(t, `blk-${id}`, short ? "Ask" : "Ask what's blocking",
    `Ask what's blocking: a message in the run's inbox that wakes its orchestrator ("what is blocking? … quiet for ${quiet}…"); it asks you with a question if it needs you, else carries on`,
    // Written but not woken: the ask is in the inbox, so it stays asked (inbox.js send).
    (cx) => askClick(view, cx, r, "blocking", { quiet, step }, { asks: [{ key: "", item: r }], notes: ASK_NOTES }));
}

// A red CI's "Ask the orchestrator" in a Needs-you box, or "asked…" while the ask waits: the same
// "what is blocking?" message (inbox.js ciRequest), so it reads asked as Ask what's blocking does.
function ciAction(view, t, r, action, id) {
  if (!r?.dir || !r.localTerminal || r.away) return null;
  if (inboxAsked(r, "ci", "", r)) {
    return div().id(`ci-${id}`).flex_none().text_size(T(11, "body")).text_color(t.muted)
      .tooltip("Asked its orchestrator to see to the red CI; waiting for its progress or status to change").child("asked…");
  }
  const pr = action.pr;
  const url = pr?.failed?.url ?? pr?.url ?? null;
  return actionButton(t, `ci-${id}`, action.label,
    `A message in the run's inbox that wakes its orchestrator ("what is blocking? … CI red on #${pr?.number ?? "?"}…"): it fixes what is the run's to fix, or asks you`,
    (cx) => askClick(view, cx, r, "ci", { pr: pr?.number ?? null, check: action.check, url }, { asks: [{ key: "", item: r }], notes: ASK_NOTES }));
}

// PRs asked to address their comments are kept in the shared asked store (inbox.js), so every
// copy and a reload know; the unread message (run.commentsAsked) says it too until it is read.

const MODE_TIP = {
  ask: "Ask me: its orchestrator writes you one question listing each comment with what it proposes (fix, reply or leave, and why); it acts on your answer",
  handle: "Handle them: its orchestrator fixes what it agrees with, pushes, replies on each thread it acted on (\"🤖 AI: …\"), never resolving one, and reports; it never merges",
};

// Address comments, on a run's card and pane: for each of its approved or changes-requested PRs
// with open review comments, "Address 9 threads on #42" and two buttons, Ask me and Handle them,
// the run's autonomy's default (comments.js defaultMode) highlighted; a click writes an inbox
// message for that PR (inbox.js) and the row reads "asked…" while the message is
// unread and, once read, until the PR's open comments change (while the run works, until a new
// one appears). Null when there are none, the run
// is put away, or its orchestrator is not known here; and while the run has an open question
// (an Ask me's question is answered in its box, and a second ask would only queue a duplicate).
function commentsAction(view, t, r, att, id) {
  if (!r?.dir || !r.localTerminal || r.away || r.question) return null;
  const prs = (att?.next?.comments?.prs ?? []).filter((p) => hasComments(p.comments) && p.url);
  if (!prs.length) return null;
  const first = defaultMode(r.autonomy);
  const rows = prs.map((p, i) => {
    const b = botCount(p.comments.bots);
    const what = `Address ${commentsText(p.comments)}${p.comments.count > 0 && b ? ` (+${b} from bots)` : ""}${prs.length > 1 || p.number ? ` on #${p.number}` : ""}`;
    const label = div().id(`cmt-${id}-${i}-label`).flex_none().text_size(T(11.5, "meta")).text_color(t.muted)
      .tooltip(commentLines([p], 20).join("\n")).child(what);
    if (addressAsked(r, p, att)) return h_flex().gap(8).items_center().child(label).child(askedNote(t, `cmt-${id}-${i}`));
    return h_flex().gap(6).items_center().child(label)
      .child(actionButton(t, `cmt-${id}-${i}-ask`, "Ask me", modeTip(r, "ask"), addressSend(view, r, p, "ask"), first === "ask"))
      .child(actionButton(t, `cmt-${id}-${i}-handle`, "Handle them", modeTip(r, "handle"), addressSend(view, r, p, "handle"), first === "handle"));
  });
  return v_flex().gap(4).children(rows);
}

// Whether a PR's Address comments was asked and is still being handled (inbox.js asked).
// The run's assessment (`att`) has the PRs asked about, judged with whether the run is working
// (a moving comment list under a working orchestrator is its own doing); without one, the store.
function addressAsked(r, p, att = null) {
  return att?.askedPrs ? att.askedPrs.has(p.url) : inboxAsked(r, "comments", p.url, p);
}

const askedNote = (t, id) => div().id(id).flex_none().text_size(T(11, "meta")).text_color(t.muted)
  .tooltip("Asked its orchestrator to address these comments; while its orchestrator works on them, or until its open comments change (a comment the reviewer adds later ends it)").child("asked…");

const modeTip = (r, mode) => `${MODE_TIP[mode]}.${mode === defaultMode(r.autonomy) ? ` The default at ${r.autonomy ?? "L0"}.` : ""}`;

// The click of an Ask me or Handle them: writes the run's inbox message for the PR (inbox.js);
// the button reads "asked…" until the PR's open comments change.
const addressSend = (view, r, p, mode) => addressSendAll(view, r, [p], mode);

// The click of Ask me about all / Handle all: one message for all the PRs (inbox.js), so the
// orchestrator is woken once. Each PR reads "asked…" at once; all are unmarked if the message
// did not reach the inbox.
const addressSendAll = (view, r, prs, mode) => (cx) => askClick(view, cx, r, "comments-all", { prs, mode },
  { asks: prs.map((p) => ({ key: p.url, item: p })), notes: ASK_NOTES });

// The card's and pane's own Address rows, only while the run is in Needs you and its box does
// not carry them (needaction.js ownAddressRows).
export const addressRows = (view, t, r, ctx, f, id) => (ownAddressRows(f.need, f.need ? needItemsOf(r, ctx, f.att) : [])
  ? commentsAction(view, t, r, f.att, id) : null);

// Who reviews the run's pull requests, peer (a colleague on GitHub) or self (you, from the
// proof), as a two-way toggle with the folder's default marked. A click sets it for the whole
// repository folder (tracking.js setReviewFlow), so every run of it changes at once; picking
// the default removes the setting.
const flowTip = (st, f) => `${f === "peer" ? "Peer: a colleague reviews on GitHub (request review, review from, approved — merge)" : "Self: you review the proof and merge (review proof → merge)"}.
`
  + `For every run in ${st.key}${f === st.fallback ? "; the default for it" : ""}.`;

// The need box's quiet "review: peer · change": who reviews, and a link that switches the folder to
// the other flow, as flowToggle's segments do.
function flowChange(t, r, id) {
  const st = flowState(r, reviewFlows());
  const other = st.flow === "peer" ? "self" : "peer";
  return h_flex().id(id).flex_none().gap(3).items_center().text_size(T(11, "meta")).text_color(t.dim).child(`review: ${st.flow} ·`)
    .child(div().id(`${id}-change`).cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(`Switch to ${other}.\n${flowTip(st, other)}`)
      .on_click((_e, cx) => { cx.stop_propagation(); setReviewFlow(st.key, flowSetting(other, st.fallback)); cx.notify(); }).child("change"));
}

export function flowToggle(t, r, id) {
  const st = flowState(r, reviewFlows());
  const tip = (f) => flowTip(st, f);
  const seg = (f) => {
    const on = st.flow === f;
    return div().id(`flow-${id}-${f}`).flex_none().px(7).h(18).flex().items_center().rounded(4).text_size(T(10.5, "meta"))
      .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.dim).when(on, (e) => e.font_semibold())
      .tooltip(tip(f))
      .when(!on, (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); setReviewFlow(st.key, flowSetting(f, st.fallback)); cx.notify(); }))
      .child(f === st.fallback ? `${f} (default)` : f);
  };
  return h_flex().id(`flow-${id}`).flex_none().gap(3).items_center().text_size(T(10.5, "meta")).text_color(t.dim)
    .child(div().flex_none().pr(2).child("Review")).child(seg("self")).child(seg("peer"));
}

// A run's dot (Crew row, card, pane): working while its orchestrator or any of its agents
// works, or its CI runs; blocked while any is blocked on a dialog (attention.js runDot). The
// orchestrator's own status alone sits idle between its turns while five agents implement.
export const runStatus = (own, workers, att, ctx) =>
  runDot(own, workers.map((w) => agentStatus(w, ctx)), { ciRunning: att?.reasons?.[0]?.key === "ci-running" });

export function runFacts(r, ctx) {
  const orch = orchestratorState(r, ctx);
  const parked = isParked(r);
  const att = attOf(r, ctx);
  const need = needsYouNow(r, ctx);
  let badge = (parked ? PHASE.parked : r.away?.how === "closed" ? PHASE.closed : PHASE[r.phase]) ?? PHASE.unknown;
  // A run in Needs you or Done, or a finished one, says what comes next instead, as its Crew
  // card does ("approved — merge", "review from anna"); a parked or closed one keeps saying so.
  const next = !r.away && badgeOf(att, r.phase === "finished");
  if (next) badge = next;
  // A question or blocker read from a stale run read: under Can't tell, as in the Crew, never
  // a red Needs you the header and the Crew don't count.
  else if (!r.away && att.group === "cant" && (badge === PHASE.waiting || badge === PHASE.blocked)) badge = PHASE.cant;
  const workers = workersOf(r.terminal, ctx);
  return {
    orch, parked, need, badge, att,
    // A parked run keeps its pill, with what its PRs wait on muted beside it.
    parkedNext: parked ? parkedLabel(att, r.away) : null,
    dot: runStatus(orch, workers, att, ctx),
    closed: isClosed(r, ctx),
    reason: needReason(r, orch) ?? needLine(att),
    counts: taskCounts(r),
    prs: prsOf(r) ?? r.prs.map((p) => unknownPr(p.url, p.repo)),
    related: relatedOf(r),
    workers,
    stages: stagesOf(r, ctx),
  };
}

// One of a need item's buttons (needaction.js action kinds). `where` is "card" or "pane": the
// pane unfolds its own Proof section, the card opens the run's pane as a popup with it unfolded.
export function needButton(view, t, r, f, x, id, where, primary) {
  const confirm = (action) => (cx) => { view.confirm = { key: r.key, action, box: where }; view.actionError = null; view.actionNote = null; cx.notify(); };
  switch (x.kind) {
    case "open": return x.quiet ? textLink(t, id, `${x.label} ↗`, x.url, () => openUrl(x.url)) : actionButton(t, id, x.label, x.url, () => openUrl(x.url), primary);
    case "request-review": return actionButton(t, id, x.label, "Ask a colleague to review this PR, from the people who reviewed this repository before; GitHub tells them", (cx) => startRequesting(view, r, x.pr, cx), primary);
    case "rereview": return rereviewAction(view, t, r, x, id);
    // Ask me and Handle them share one "asked…" once either was clicked.
    case "address": return addressAsked(r, x.pr, f.att) ? (x.mode === "ask" ? askedNote(t, id) : null)
      : actionButton(t, id, x.label, modeTip(r, x.mode), addressSend(view, r, x.pr, x.mode), primary);
    // Asked and being handled: its row says so, with Open beside.
    case "asked": return askedNote(t, id);
    case "address-all": return x.prs.every((p) => addressAsked(r, p, f.att)) ? null
      : actionButton(t, id, x.label, `${modeTip(r, x.mode)} For each of the ${x.prs.length} PRs.`, addressSendAll(view, r, x.prs.filter((p) => !addressAsked(r, p, f.att)), x.mode), primary);
    // Focusing the run's own orchestrator opens the run (the next poll reads its PRs); focusing a worker does not.
    case "focus": return actionButton(t, id, x.label, "Show its terminal", () => { if (x.address === r.terminal) markOpened(r); focusAgent(x.address); }, primary);
    case "ask-ci": return ciAction(view, t, r, x, id);
    case "ask-blocking": return blockingAction(view, t, r, f.att, id);
    case "report": return pathLink(t, r, id, x.path, x.label);
    case "close": return actionButton(t, id, x.label, ACTION.close.tip, confirm("close"), primary);
    case "resume": return actionButton(t, id, x.label, ACTION.resume.tip, confirm("resume"), primary);
    case "proof": return actionButton(t, id, x.label, where === "pane" ? "Show every claim, the first worth a look unfolded" : "Open this run's pane with its claims unfolded", (cx) => {
      // Opening it is reading it: the box then says what to do next (needaction.js).
      markProofRead(r);
      if (where !== "pane") {
        openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: { ...runProps(r), proof: true } });
        return;
      }
      view.folds ??= new Map(); view.folds.set(`pf-${r.key}`, true);
      const k = firstToOpen(r, stagesOf(r, facts()));
      if (k) { view.proofRows ??= new Set(); view.proofRows.add(`${r.key}-${k.id}`); }
      cx.notify();
    }, primary);
    case "changes": return changesButton(view, t, r, id);
    case "wait-on": return waitOnButton(view, t, r, id);
    default: return null;
  }
}

// A small text link: the quiet way to a PR on GitHub, and the picker's Cancel.
const textLink = (t, id, label, tip, onClick) => div().id(id).flex_none().text_size(T(11.5, "body")).text_color(t.muted).cursor_pointer()
  .hover((s) => s.text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);

// "Re-review first" beside Request review: asks the orchestrator to run the final review again
// (inbox.js rereview); "asked…" while its message is unread or the run's status and Reviewed lines
// have not moved.
function rereviewAction(view, t, r, x, id) {
  if (!r?.dir || !r.localTerminal || r.away) return null;
  if (inboxAsked(r, "rereview", "", r)) return askedNote(t, id);
  const behind = x.reviewed?.kind === "behind" ? x.reviewed.behind : null;
  return actionButton(t, id, x.label, "Before asking a colleague: a message in the run's inbox that wakes its orchestrator to run the final review again on the branch as it is now, fix what it finds and finish again",
    (cx) => askClick(view, cx, r, "rereview", { behind, sha: x.pr?.sha ?? null }, { asks: [{ key: "", item: r }], notes: ASK_NOTES }));
}

// Request review was clicked: the box shows the earlier reviewers of the PR's repository to pick
// from (data.js reads them once per 30 minutes).
function startRequesting(view, r, pr, cx) {
  view.requesting = { key: r.key, pr: pr.url, busy: null, error: null };
  view.actionError = null;
  if (cachedReviewers(r, pr.repo) === null) {
    cx.spawn(async (cx) => {
      await loadReviewers(r, pr.repo).catch(() => {});
      view.redraw = true;
      try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
    }, { owner: null });
  }
  cx.notify();
}

// A chip was clicked: ask `login` (one of the candidates, checked here) to review `pr`, marking a
// draft ready first. Success clears the picker and reads the run's PRs at once, so the run moves to
// "review from <login>"; failure keeps the picker with gh's first line.
function pickReviewer(view, r, pr, login, list, cx) {
  const req = view.requesting;
  if (!canRequest({ requesting: req, key: r.key, url: pr.url, login, candidates: list })) return;
  req.busy = login; req.error = null;
  cx.notify();
  cx.spawn(async (cx) => {
    const out = await requestReview(r, pr.url, login, { draft: pr.state === "DRAFT" }).catch((e) => ({ error: e?.message ?? String(e) }));
    if (out.error) {
      req.busy = null; req.error = out.error;
      // Marked ready already: read the PR again, so the box shows it is no draft.
      if (out.readied) await refreshPrs(r, false, true).catch(() => {});
    }
    else {
      if (view.requesting === req) view.requesting = null;
      await refreshPrs(r, false, true).catch(() => {});
    }
    view.redraw = true;
    try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
    try { await view.load(cx); } catch { /* the next refresh shows it */ }
  }, { owner: null });
}

// The picker that takes the place of an item's buttons after Request review: the label, a chip per
// earlier reviewer and Cancel; "finding reviewers…" while they are read; "requesting…" while gh runs.
function reviewPicker(view, t, r, x, id) {
  const req = view.requesting, pr = x.pr;
  const label = pickerLabel(pr.state === "DRAFT");
  const dim = (text) => div().flex_none().text_size(T(11.5, "meta")).text_color(t.dim).child(text);
  const cancel = textLink(t, `${id}-cancel`, "Cancel", "Back to the buttons", (cx) => { view.requesting = null; cx.notify(); });
  if (req.busy) return [dim("requesting…")];
  const list = cachedReviewers(r, pr.repo, pr.author ?? null);
  if (list === null) return [dim("finding reviewers…"), cancel];
  if (!list.length) return [div().flex_none().text_size(T(11.5, "meta")).text_color(t.muted).child("No earlier reviewers found."),
    ...(pr.url ? [textLink(t, `${id}-open`, `Open ${pr.number ? `#${pr.number}` : "the PR"} ↗`, pr.url, () => openUrl(pr.url))] : []), cancel];
  return [div().flex_none().text_size(T(11.5, "meta")).text_color(t.muted).child(label),
    ...list.map((login) => actionButton(t, `${id}-${login}`, login, `Ask ${login} to review${pr.state === "DRAFT" ? " (the draft is marked ready first)" : ""}: gh pr edit --add-reviewer`, (cx) => pickReviewer(view, r, pr, login, list, cx))),
    cancel];
}

// Ask for changes on a ready run: opens the Reply field under the box; Enter writes the text to the
// run's inbox as "changes asked from Harbormaster: …" and wakes the orchestrator (submitReply).
const changesId = (r) => `changes:${r.key}`;

function changesButton(view, t, r, id) {
  const open = view.replying === changesId(r);
  const can = Boolean(r.dir && r.localTerminal && !r.away);
  return actionButton(t, id, open ? "Cancel" : "Ask for changes",
    can ? "Say what to change: a message in the run's inbox that wakes its orchestrator, which plans it as tasks and finishes again" : "Its orchestrator is not known here: open the run to ask",
    can ? (cx) => {
      view.replying = open ? null : changesId(r);
      view.reply.set_value("");
      if (!open) view.reply.focus();
      cx.notify();
    } : null);
}

// Waiting on someone… (a person outside GitHub, say, checking a preview): opens the Reply field
// under the box; Enter with text marks the run as waiting on them (tracking.js harbormaster.waitingOn,
// with its step's label and signature, attention.js waitSig) and it moves to Waiting on others.
// Nothing goes to the run's inbox: the orchestrator has nothing to do about it.
export const waitOnId = (r) => `wait:${r.key}`;

const WAIT_HINT = "Who is it waiting on? (e.g. Kari — preview check) · Enter moves the run to Waiting on others until something needs you";

function waitOnButton(view, t, r, id) {
  const open = view.replying === waitOnId(r);
  return actionButton(t, id, open ? "Cancel" : "Waiting on someone…",
    "Someone outside GitHub has it (a preview check, say): the run waits in Waiting on others until a reviewer, a review, a push, red CI or a question needs you again", (cx) => {
      view.replying = open ? null : waitOnId(r);
      view.reply.set_value("");
      if (!open) view.reply.focus();
      cx.notify();
    });
}

// The waiting-on field (Waiting on someone…), with what to type under it, while it is open for `r`; else null.
export const waitOnField = (view, t, r, id) => (view.replying === waitOnId(r)
  ? v_flex().id(id).gap(4).on_click((_e, cx) => cx.stop_propagation()).child(Input.new(view.reply))
    .child(div().text_size(T(10.5, "meta")).text_color(t.dim).child(WAIT_HINT))
  : null);

// A marked run's line on its card and pane: "Waiting on Kari — preview check · 2h" and Not waiting
// any more, which clears the mark (back to Needs you). Null for a run the mark does not hold.
export function waitNote(t, r, f, id) {
  const w = f.att?.waitingOn;
  if (!w) return null;
  return h_flex().id(id).gap(8).items_center().flex_wrap()
    .child(div().min_w(0).text_size(T(11.5, "body")).text_color(t.ansi6 ?? t.accent).child(`Waiting on ${w.text}${w.at ? ` · ${ageText(Date.now() - w.at)}` : ""}`))
    .child(actionButton(t, `${id}-clear`, "Not waiting any more", "Clear the mark: the run is back in Needs you", (cx) => {
      // Started here, so the mark is gone in the render below; a failed clear puts it back.
      const failed = setWaitingOn(r, null).then(() => null, (e) => e);
      cx.spawn(async (cx) => {
        const e = await failed;
        if (!e) return;
        console.log(`harbormaster: could not clear the waiting-on mark of ${r.branch}: ${e?.message ?? e}`);
        try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
      });
      cx.notify();
    }));
}

// The need items as lines, each with its buttons; the first item's first button stands out, unless
// the actions say which does (`primary`). Actions about one PR each (`row`: "#1799 · 15 comments")
// go in a row per PR, led by it.
export function needLines(view, t, r, f, items, where, underQuestion = false, tail = null) {
  const open = requestingFor(view, r, items);
  // One rule for which button stands out (needaction.js primaryOf), the same the sea's reefs use.
  const main = underQuestion ? null : primaryOf(items);
  const picking = (x) => x === open;
  return items.map((it, i) => {
    const buttons = it.actions.map((x, j) => ({ row: x.row ?? null, pick: picking(x) ? x : null,
      el: needButton(view, t, r, f, x, `need-${where}-${r.key}-${i}-${j}`, where, main?.i === i && main?.j === j) })).filter((b) => b.el);
    const rows = [];
    for (const b of buttons) {
      if (!rows.length || rows[rows.length - 1].row !== b.row) rows.push({ row: b.row, els: [], pick: null });
      const row = rows[rows.length - 1];
      if (b.pick) row.pick = b.pick;
      row.els.push(b.el);
    }
    // A ready run: a headline and what is done, in the pass colour (needaction.js readyItem).
    const head = it.ready
      ? v_flex().id(`needt-${where}-${r.key}-${i}`).gap(1)
        .child(div().text_size(T(14, "strong")).font_semibold().text_color(PASS(t)).child(it.headline))
        .child(div().text_size(T(12, "body")).text_color(PASS(t)).child(oneLine(it.detail, 220)))
      : div().id(`needt-${where}-${r.key}-${i}`).text_size(T(12, "body")).text_color(t.foreground).when(Boolean(it.tip), (el) => el.tooltip(it.tip)).child(oneLine(it.line, 220));
    // The quiet control sits at the right end of the box's last row.
    const last = tail && i === items.length - 1;
    if (last && !rows.length) rows.push({ row: null, els: [], pick: null });
    return v_flex().id(`needl-${where}-${r.key}-${i}`).gap(4)
      .child(head)
      .when(Boolean(it.caveat), (el) => el.child(div().id(`needc-${where}-${r.key}-${i}`).text_size(T(11.5, "body")).text_color(AMBER(t)).child(it.caveat)))
      .children(rows.map((x, k) => {
        const row = h_flex().flex_wrap().gap(6).items_center()
          .when(Boolean(x.row), (el) => el.child(div().flex_none().min_w(0).pr(2).text_size(T(11, "meta")).text_color(t.muted).child(x.row)))
          .children(x.pick ? reviewPicker(view, t, r, x.pick, `need-${where}-${r.key}-${i}-pick`) : x.els);
        if (!last || k !== rows.length - 1) return row;
        // The picker's chips fill the row: the control goes on its own line, at the right.
        return x.pick ? v_flex().gap(4).child(row).child(h_flex().justify_end().child(tail)) : row.child(div().flex_1()).child(tail);
      }))
      .when(it.actions.some(picking) && view.requesting.error, (el) => el.child(div().id(`needr-${where}-${r.key}-${i}`).text_size(T(11.5, "body")).text_color(t.blocked).child(oneLine(view.requesting.error, 200))));
  });
}

// A Close or Resume clicked in this need box, confirmed here rather than in the action row at
// the bottom, which a long pane may have scrolled away; null otherwise.
export const boxConfirm = (view, t, r, f, where) => (view.confirm?.key === r.key && view.confirm.box === where && !view.busy?.[r.key]
  ? confirmBlock(view, t, r, f.orch, f.counts, view.confirm.action, `need-${where}-${r.key}`) : null);

// "Open the orchestrator", small: never the headline, since most reasons are done elsewhere.
const orchLink = (t, r, f, id) => (f.orch === "gone" || !r.terminal ? null
  : div().id(id).flex_none().text_size(T(11, "meta")).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
    .tooltip("Show its orchestrator's terminal").on_click((_e, cx) => { cx.stop_propagation(); markOpened(r); focusAgent(r.terminal); }).child("Open the orchestrator"));

// What a run needs you for, on its card and in its pane. Without a question: a line per reason
// saying what to do and why, with the buttons that do it (needaction.js), and a small link to
// the orchestrator. With one: what it asks, the recommendation in short and what it blocks, then
// a Details fold with the question's sections, a button per option and Reply, answered the way
// The queue answers (answerParts, sendAnswer: the run's inbox, then a wake); any other
// reason under it. `where` tells the card's and the pane's ids apart.
export function needBox(view, t, r, f, ctx, where) {
  const focus = (_e, cx) => { cx.stop_propagation(); if (f.orch !== "gone") { markOpened(r); focusAgent(r.terminal); } };
  const it = r.ask ? decisionQueue([r], [], ctx).find((x) => x.kind === "run") : null;
  const all = needItemsOf(r, ctx, f.att);
  // A run that is ready to merge is the one thing here that is good news: green, "Ready", "✓".
  const ready = !it && all.length === 1 && all[0].ready;
  const tint = ready ? PASS(t) : t.blocked;
  const box = h_flex().id(`need-${where}-${r.key}`).gap(8).p(8).rounded(7).bg(tint + "1c").items_start()
    // Clicks on its buttons and links stay in the box, never the card's open-the-orchestrator.
    .on_click((_e, cx) => cx.stop_propagation())
    .child(div().flex_none().text_color(tint).font_bold().child(r.question ? "?" : ready ? "✓" : "!"));
  if (!it) {
    // A question.md that did not parse into a title, or a reason the map has no line for: say it as is.
    const items = all.length ? all : [{ key: "other", line: (f.reason ?? "needs you").slice(0, 220), actions: [] }];
    // No small link when the first line's own button already opens the orchestrator.
    const first = items[0].actions[0];
    const link = first?.kind === "focus" && first.address === r.terminal ? null : orchLink(t, r, f, `need-orch-${where}-${r.key}`);
    return box.child(v_flex().flex_1().min_w(0).gap(6)
      // The sidebar's box sits under the red "Needs you · N" heading already; a second label is a line spent on nothing.
      .when(!ready && where !== "sidebar", (el) => el.child(div().text_size(T(11, "meta")).font_semibold().text_color(tint).child("Needs you")))
      .children(needLines(view, t, r, f, items, where, false, where !== "sidebar" && showsFlow(items) ? flowChange(t, r, `need-flow-${where}-${r.key}`) : null))
      .when(ready && view.replying === changesId(r), (el) => el.child(v_flex().gap(4)
        .child(Input.new(view.reply))
        .child(div().text_size(T(10.5, "meta")).text_color(t.dim).child("What should change? Enter writes it to the run's inbox and tells its orchestrator"))))
      .children([waitOnField(view, t, r, `need-wait-${where}-${r.key}`), boxConfirm(view, t, r, f, where)].filter(Boolean))
      .when(Boolean(link), (el) => el.child(h_flex().child(link))));
  }
  const head = needHead(r.ask);
  const key = `q-${r.key}`;
  const open = isOpen(view, key);
  const a = answerParts(view, t, it, ctx, "box");
  const sections = questionSections(r.ask, r.question);
  // The details, folded: what is long. The options are already above as buttons, so here they are
  // their whole text, a line each, for choosing between them.
  const fold = h_flex().id(`qfold-${where}-${r.key}`).gap(6).items_center().min_w(0).rounded(4).cursor_pointer()
    .text_size(T(11.5, "body")).text_color(t.foreground).hover((st) => st.bg(t.hover))
    .tooltip(open ? "Hide the question's details" : "The whole question, what each option does, the evidence and the risk")
    .on_click((_e, cx) => { cx.stop_propagation(); view.folds ??= new Map(); view.folds.set(key, !open); cx.notify(); })
    .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.muted))
    .child(div().truncate().child(detailsLabel(sections, it.options)))
    .child(div().flex_none().text_color(t.dim).child(it.since ? `asked ${ago(it.since)}` : ""));
  // A section's text whole, as paragraphs (question.js), under its small label.
  const part = (label, text, color) => v_flex().gap(2)
    .when(Boolean(label), (el) => el.child(div().text_size(T(10.5, "meta")).font_semibold().text_color(color ?? t.dim).child(label)))
    .children(paragraphs(text).map((l) => div().text_size(T(11.5, "body")).text_color(t.foreground).child(l)));
  const options = it.options.length > 0 && v_flex().gap(4)
    .child(div().text_size(T(10.5, "meta")).font_semibold().text_color(t.dim).child("What each option does"))
    .children(it.options.map((o, i) => div().text_size(T(11.5, "meta")).text_color(t.muted)
      .child(`${i === it.recommended ? "★ " : ""}${o.label}${o.text && o.text !== o.label ? `: ${plain(o.text)}` : ""}`)));
  const tone = { Recommended: t.accent, Risk: t.blocked };
  const details = open && detailsLabel(sections, it.options) && v_flex().id(`qdetail-${where}-${r.key}`).gap(8).pt(4)
    // Clicks in here never fall through to the card's open-the-orchestrator.
    .on_click((_e, cx) => cx.stop_propagation())
    .children(sections.filter((x) => !x.label || x.label === "Question").map((x) => part(x.label, x.text)))
    .when(Boolean(options), (el) => el.child(options))
    .children(sections.filter((x) => x.label && x.label !== "Question").map((x) => part(x.label, x.text, tone[x.label])));
  // The answers: a button per option (the recommended one highlighted, its text on hover) and Reply,
  // right under what is asked, so they read as its answers and nothing else does.
  const answers = (it.options.length > 0 || a.replyBtn) && h_flex().id(`qans-${where}-${r.key}`).flex_wrap().gap(6).items_center()
    .children(it.options.map((_o, i) => a.optionButton(i)))
    .when(Boolean(a.replyBtn), (el) => el.child(a.replyBtn));
  // Anything else it needs you for (a red CI, a PR to merge), as without a question, set apart.
  const others = all.filter((x) => x.key !== "question");
  return box.child(v_flex().flex_1().min_w(0).gap(4)
    .child(div().id(`qtitle-${where}-${r.key}`).cursor_pointer().text_size(12.5).font_medium().text_color(t.foreground)
      .tooltip(f.orch !== "gone" ? "Open the orchestrator" : "The orchestrator is gone: answer here, it waits in the run's inbox")
      .on_click(focus).child(oneLine(head.title, 300)))
    // What waits on the answer, the urgency cue, right under what is asked.
    .when(Boolean(head.blocks), (el) => el.child(div().text_size(T(11.5, "body")).text_color(t.blocked).child(oneLine(head.blocks, 160))))
    .when(Boolean(head.rec), (el) => el.child(div().text_size(T(11.5, "meta")).text_color(t.muted).child(oneLine(head.rec, 200))))
    .when(Boolean(answers), (el) => el.child(div().pt(2).child(answers)))
    .when(Boolean(a.input), (el) => el.child(a.input))
    .when(Boolean(a.note), (el) => el.child(a.note))
    .when(Boolean(detailsLabel(sections, it.options)), (el) => el.child(fold))
    .when(Boolean(details), (el) => el.child(details))
    .when(others.length > 0, (el) => el.child(v_flex().id(`qalso-${where}-${r.key}`).gap(6).mt(4).pt(8).border_t(1).border_color(t.border)
      .child(div().text_size(T(11, "meta")).font_semibold().text_color(t.muted).child("Also needs you"))
      .children(needLines(view, t, r, f, others, where, true))))
    .children([boxConfirm(view, t, r, f, where)].filter(Boolean)));
}

// The one-line notes under the progress: parked or closed, gone, waiting agents, unread messages.
// `decisions`: false in the pane, whose Decisions heading says what is new itself.
export function cardNotes(t, r, f, decisions = true) {
  const note = (text, tone = "muted") => div().text_size(T(11.5, "meta")).text_color(t[tone]).child(text);
  return [
    r.away && note(`${f.parked ? "Parked" : "Closed"} ${ago(r.away.at)}${r.away.was ? ` · was: ${r.away.was}` : ""}`),
    // The Needs you box says so already when it shows.
    !r.away && !f.need && f.orch === "gone" && r.phase !== "finished" && note("Orchestrator is gone: resume, park or close this run.", "blocked"),
    !r.away && f.orch === "gone" && r.phase === "finished" && note("Orchestrator is gone, only a shell is left in its tab: resume it if the PR needs more work, or park or close the run."),
    r.waiting.length > 0 && note(`Waiting on an answer: ${r.waiting.join(", ")}`),
    r.unhandled > 0 && note(`${plural(r.unhandled, "relayed message")} not read yet`),
    decisions && newDecisionsNote(r) && note(newDecisionsNote(r), "accent"),
  ].filter(Boolean);
}

// "7 decisions new since you looked", or null: the run's decision lines newer than when its
// Decisions were last unfolded (telling.js).
export function newDecisionsNote(r) {
  const n = newDecisions(r.decided, decisionsSeen(r)).length;
  return n ? `${plural(n, "decision")} new since you looked` : null;
}
