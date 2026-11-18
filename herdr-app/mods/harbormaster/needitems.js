// What a run needs from you, worked out as a list of items, with the claim rows and attention they read from and the wait-on write.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { prsOf } from "./data.js";
import { facts, openUrl } from "./live.js";
import { TYPE } from "./ui.js";
import { claimRows, claimCounts, claimsGaps, reviewedState, worthALook, hasClaims, proofState, withSaid, withAsked } from "./claims.js";
import { setNote } from "./note.js";
import { attentionOf, needsYouNow as needsYouOf } from "./attend.js";
import { waitSig, WAIT_LABELS } from "./attention.js";
import { markProofSeen } from "./proofseen.js";
import { setWaitingOn } from "./tracking.js";
import { needActions } from "./needaction.js";
import { stagesOf } from "./cardparts.js";

// What card() and runDetail() both show: the run's state, its links and the header row.
// Each run's attention (attend.js), once per facts() snapshot: the overview's header, its
// order and every card read it, and a render takes one snapshot.
const attention = new WeakMap();

export function attOf(r, ctx) {
  let m = attention.get(ctx);
  if (!m) attention.set(ctx, (m = new Map()));
  if (!m.has(r)) m.set(r, attentionOf(r, ctx));
  return m.get(r);
}

// Whether a run needs you (attend.js needsYouNow), with this render's attention.
export const needsYouNow = (r, ctx) => needsYouOf(r, ctx, attOf(r, ctx));

// What a run needs you for (needaction.js needActions), with this render's attention: its
// proof and its reports, for the lines that point at them.
export function needItemsOf(r, ctx, att = attOf(r, ctx)) {
  if (att?.group !== "needs") return [];
  return needActions(att, { run: r, prs: prsOf(r) ?? [], reviewed: reviewedOf(r), claims: hasClaims(r), now: Date.now(), proof: needProof(r, stagesOf(r, ctx)), reports: (r.reports ?? []).map((n) => `shared/${n}`) });
}

// A run's proof in the shape needActions takes ({tier, pass, total, fail, failed, accepted,
// gaps}): a claim proven is a pass, and the failed one is named by its words. An old run has only
// its checks line: red is its one failure, else there is nothing to read (null).
function needProof(r, stages) {
  const tier = r.proof.tier?.tier ?? null;
  if (!hasClaims(r)) return r.proof.md?.checks?.state === "red" ? { tier, pass: 0, total: 0, fail: 1, failed: "the checks", gaps: "checks red" } : null;
  const rows = claimRowsOf(r, stages);
  const c = claimCounts(rows);
  const failed = rows.find((k) => k.state === "fail");
  return { tier, pass: c.proven, fail: c.fail, accepted: c.accepted, total: c.total,
    gaps: claimsGaps(rows, r.proof.md), failed: failed ? `${failed.id} ${failed.name}` : null };
}

// Marks the run's proof, as it shows now, as read (proofseen.js).
export const markProofRead = (r) => markProofSeen(r, proofState(r, stageNames(r, stagesOf(r, facts()))).sig);

// The claim the Proof button unfolds: the first worth a look, else the first still being proved.
export const firstToOpen = (r, stages) => {
  const rows = claimRowsOf(r, stages);
  return rows.find(worthALook) ?? rows.find((k) => k.state === "pending") ?? null;
};

// Marks the run as waiting on `text` (not blank), with its step as it is now; the field closes.
// Only while that step is still all the run needs the user for (as needaction.js offers the
// button): a reviewer requested or red CI since the field opened would let the mark go at the
// next poll, so nothing is set and a note says why.
export function markWaiting(view, key, text, cx) {
  if (!text) return;
  const run = view.runs.find((x) => x.key === key);
  const a = run ? attOf(run, facts()) : null;
  const next = a?.next;
  const can = a?.group === "needs" && a.reasons.length === 1 && WAIT_LABELS.has(a.reasons[0].key) && next?.label === a.reasons[0].key;
  if (can) setWaitingOn(key, { text, at: Date.now(), label: next.label, sig: waitSig(next) });
  else setNote(view, `Not marked waiting on ${text}: ${!a ? "the run is gone" : a.group === "needs" ? `it now needs you for ${a.reasons.map((x) => x.text).join(" · ")}` : "it no longer waits on you for that step"}`);
  view.reply.set_value("");
  view.replying = null;
  cx.notify();
}

// The run's final AI review against its branch, as plain facts: the one read the path strip and the
// need box's caveat share (claims.js reviewedState).
export const reviewedOf = (r) => reviewedState(r.proof?.md, r.reviewedGap);

// What was clicked on a claim row (Accept, Unaccept) and not read back from the run's files yet
// (claims.js withSaid). Shared by the pane and the card, so both show it at once. An Ask to prove
// is an inbox message: its "asked…" comes from inbox.js (claims.js withAsked).
export const said = new Map();

export const isFinished = (r) => r.phase === "finished" || Boolean(r.away);

// Each task's stage name from stagesOf()'s, or null for none (claims.js falls back to plan.md's states).
const stageNames = (r, stages) => (stages ? r.tasks.map((_, i) => stages[i]?.stage ?? null) : null);

// The run's claims (claims.js claimRows) with the clicks its files don't show yet.
export const claimRowsOf = (r, stages = null) => withAsked(withSaid(claimRows(r.proof, r, stageNames(r, stages), isFinished(r)), said, r.key, r.proof), r);

// A path under the run as a link that opens on this machine; for a run on another machine
// it is plain text, since nothing here can open a file there.
export function pathLink(t, r, id, rel, label) {
  if (r.machine) return div().text_size(TYPE.meta).text_color(t.dim).tooltip(`On ${r.machine}`).child(`${label} (${r.dir}/${rel})`);
  return h_flex().id(id).gap(4).px(6).h(20).items_center().rounded(5).bg(t.raised).text_size(TYPE.meta).text_color(t.muted).cursor_pointer()
    .hover((s) => s.text_color(t.foreground)).tooltip(`Open ${r.dir}/${rel}`)
    .on_click((_e, cx) => { cx.stop_propagation(); openUrl(`${r.dir}/${rel}`); })
    .child(div().child("▤")).child(label);
}
