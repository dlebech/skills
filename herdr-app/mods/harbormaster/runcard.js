// One run's card in the Bridge's lists.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { PR_TONE, markOpened } from "./data.js";
import { focusAgent } from "./live.js";
import { TYPE } from "./ui.js";
import { prStateText } from "./prfacts.js";
import { showsFlow } from "./needaction.js";
import { drawnInPane, linkChip, taskStrip, actionRow } from "./cardparts.js";
import { needItemsOf } from "./needitems.js";
import { blockingAction, addressRows, flowToggle, runFacts, waitNote, needBox, cardNotes } from "./needbox.js";
import { cardHeader, runMeta, runEdge, joined, factsLine, progressLine, claimsSummary } from "./runpane.js";

const relatedTip = (p) => [p.number ? p.title : null, prStateText(p), p.url].filter(Boolean).join(" · ");

export const card = (view, t, r, ctx, compact = false) => drawnInPane(() => drawCard(view, t, r, ctx, compact));

function drawCard(view, t, r, ctx, compact) {
  const f = runFacts(r, ctx);
  const { orch, closed, need, counts, prs, related } = f;
  const links = [
    ...r.issues.map((url) => linkChip(t, `is-${r.key}-${url}`, url, div().child("◎"))),
    ...related.map((p) => linkChip(t, `rel-${r.key}-${p.url}`, p.url,
      svg("mods/harbormaster/pr.svg").size(11).flex_none().text_color(t[PR_TONE[p.state]] ?? t.dim), relatedTip(p))),
  ];
  // Opening the run from its card reads its PRs when they are over a minute old (markOpened).
  const focus = () => { if (orch !== "gone") { markOpened(r); focusAgent(r.terminal); } };
  const facts = factsLine(t, r, prs, TYPE.body, f.att);
  // Not on a finished or put-away run's smaller card; a live card shows it even when narrow.
  const proof = r.phase !== "finished" && !r.away ? claimsSummary(t, r) : null;
  // A stalled run's Ask what's blocking is in its need box.
  const blocking = need ? null : blockingAction(view, t, r, f.att, `card-${r.key}`);
  const comments = addressRows(view, t, r, ctx, f, `card-${r.key}`);
  return v_flex().id(`run-${r.key}`).relative().overflow_hidden().flex_none().gap(8).p(12).pl(16).rounded(10).bg(t.surface)
    .border(1).border_color(t.border).cursor_pointer()
    .hover((s) => s.bg(t.raised)).on_click(focus)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).bg(runEdge(t, f)))
    .child(cardHeader(view, t, r, f, runMeta(r, f)))
    .when(need, (el) => el.child(needBox(view, t, r, f, ctx, "card")))
    .children([waitNote(t, r, f, `wait-card-${r.key}`)].filter(Boolean))
    .when(Boolean(facts), (el) => el.child(facts))
    .when(Boolean(r.progress), (el) => el.child(progressLine(t, r, f.att)))
    .children(cardNotes(t, r, f))
    .when(Boolean(blocking), (el) => el.child(h_flex().child(blocking)))
    .when(Boolean(comments), (el) => el.child(comments))
    .when(Boolean(proof), (el) => el.child(h_flex().id(`proof-${r.key}`).flex_wrap().items_center().gap(6).px(2).text_size(TYPE.meta).when(Boolean(proof.tip), (e) => e.tooltip(proof.tip))
      .child(div().flex_none().text_size(TYPE.meta).font_semibold().text_color(t.dim).child("Claims"))
      .child(h_flex().flex_wrap().items_center().children(joined(t, proof.parts)))))
    .when(!compact && counts.planned > 0, (el) => el.child(taskStrip(t, r, counts, f.stages)))
    .when(links.length > 0, (el) => el.child(h_flex().flex_wrap().gap(6).children(links)))
    .when(prs.length > 0 && !r.away && !(need && showsFlow(needItemsOf(r, ctx, f.att))), (el) => el.child(flowToggle(t, r, `card-${r.key}`)))
    .when(prs.length === 0 && related.length === 0 && r.phase !== "finished" && !compact, (el) => el.child(div().text_size(TYPE.meta).text_color(t.dim).child("No pull request yet")))
    .child(actionRow(view, t, r, orch, closed, counts));
}
