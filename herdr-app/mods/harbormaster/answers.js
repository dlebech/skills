// Sending an answer to a run's question or a captain decision, and the answer controls.

import { div } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { decisionQueue, compactRun, isCompact, isBudgetQuestion, dropDecision } from "./data.js";
import { facts, exactStatus, orchestratorState, captainOf, replyToCaptain } from "./live.js";
import { replyId, replyItem } from "./question.js";
import { asked as inboxAsked, unmarkAsked } from "./inbox.js";
import { askClick } from "./askclick.js";
import { actionButton } from "./cardparts.js";
import { needItemsOf, markWaiting } from "./needitems.js";

// Sends an answer to an item of the queue. A captain decision goes to the captain, typed
// into its input, when it is there; otherwise, and for a run's question, to the run's inbox
// (inbox.js, the answer kind), which wakes its orchestrator. Marks the item answered (inbox.js
// asked) before the write, so a second click meanwhile is ignored.
// Returns false when there is nowhere to send it.
export function sendAnswer(view, it, text, cx, option = false) {
  const cap = captainOf(facts()).terminal;
  if (it.kind === "decision" && cap) {
    replyToCaptain(cap.address, it.decision, text);
    return true;
  }
  const run = it.run;
  if (!run?.localTerminal || noAnswer(it)) return false;
  const key = it.id;
  // The captain isn't there to clear its decision, so it goes with the answer.
  const drop = async () => { if (it.kind === "decision") await dropDecision(it.decision).catch(() => {}); };
  // The budget question's Compact button compacts the orchestrator first (never a typed reply).
  const compact = option && isCompact(text) && isBudgetQuestion(it);
  askClick(view, cx, run, "answer", { title: it.title, answer: text }, {
    asks: [{ key, item: it }],
    via: compact ? async () => { await compactRun(run, it.title, text); return { outcome: "sent" }; } : null,
    after: drop,
    // Written but the wake failed: the answer is in the inbox, so it stays answered and
    // a captain decision still goes (else each click would write another message).
    onError: async (e) => {
      if (e?.inInbox) await drop();
      else unmarkAsked(run, "answer", key);
    },
  });
  return true;
}

// Sends the inline reply as the answer to the item being replied to.
export function submitReply(view, cx) {
  const text = view.reply.value().trim();
  // Ask for changes on a ready run (changesButton): its own message, not an answer.
  if (view.replying?.startsWith("changes:")) return sendChanges(view, view.replying.slice(8), text, cx);
  // Waiting on someone… (waitOnButton): a mark in Harbormaster, not a message.
  if (view.replying?.startsWith("wait:")) return markWaiting(view, view.replying.slice(5), text, cx);
  // A need box's Reply answers the same item (question.js replyId).
  const id = replyItem(view.replying);
  const it = decisionQueue(view.runs, view.decisions, facts()).find((x) => x.id === id);
  if (!text || !it || !sendAnswer(view, it, text, cx)) return;
  view.reply.set_value("");
  view.replying = null;
  cx.notify();
}

// Writes the user's changes to the run's inbox (inbox.js); the field closes once it is written.
function sendChanges(view, key, text, cx) {
  const run = view.runs.find((x) => x.key === key);
  if (!text || !run) return;
  askClick(view, cx, run, "changes", { text }, {
    before: () => { view.reply.set_value(""); view.replying = null; },
    notes: {
      waits: "the changes wait in its inbox until the run is resumed",
      blocked: "its orchestrator is blocked on a dialog; it reads the changes once that is answered",
      sent: "changes sent to its orchestrator",
    },
  });
}

// A gone or lost orchestrator: an answer only waits in its inbox, and nothing is typed into its terminal.
const runGone = (run) => orchestratorState(run, facts()) === "gone";

// Why an item can't be answered from here, or null when it can.
export function noAnswer(it) {
  if (it.kind === "attention") {
    const line = it.run ? needItemsOf(it.run, facts())[0]?.line : null;
    return `${line ?? "This run needs you without a question"}. Nothing to answer here: click it to open its orchestrator`;
  }
  if (it.kind === "decision" && !captainOf(facts()).terminal) {
    if (!it.run?.localTerminal) return "The captain isn't running and this decision names no run: start the captain (⚓+ in the sidebar, or Start captain in the overview) to answer it";
    // Nobody reads a gone run's inbox, and this decision is about the run itself (resume, park or close).
    if (runGone(it.run)) return "This run is gone and the captain isn't running: start the captain (⚓+ in the sidebar, or Start captain in the overview), or use the run's own Resume, Park or Close";
  }
  if (it.kind !== "decision" && !it.run?.localTerminal) return "This run's orchestrator isn't known: open the run to answer";
  return null;
}

// The answering half of a queue item, shared by Waiting on you and a run's need box: a button
// per option (the recommended one starred), Reply with its input, and once answered what
// happens next. `slot` keeps the two apart: the queue's ids as they were, the box's prefixed
// ("box:"), so a card and the queue in one overview never open the same Reply twice.
// {replyBtn, optionButton(i), canPick, note, input}; replyBtn, note and input may be false.
export function answerParts(view, t, it, ctx, slot = "") {
  const cap = captainOf(ctx);
  const rid = replyId(slot, it.id);
  const open = view.replying === rid;
  // A message waiting in the run's inbox counts too: someone else (the captain, by hand) answered.
  const sent = it.run ? inboxAsked(it.run, "answer", it.id, it) : false;
  const answered = sent || Boolean(it.answered);
  const why = noAnswer(it);
  const replyBtn = it.kind !== "attention" && h_flex().id(rid + "-reply").flex_none().items_center().px(8).h(22).rounded(5)
    .text_size(11).text_color(open ? t.accent : t.dim)
    .when(Boolean(why), (el) => el.opacity(0.45).tooltip(why))
    .when(!why, (el) => el.cursor_pointer().tooltip(slot ? "Answer in your own words" : "Answer in your own words, without leaving the overview")
      .hover((st) => st.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        view.replying = open ? null : rid;
        view.reply.set_value("");
        if (!open) view.reply.focus();
        cx.notify();
      }))
    .child(open ? "Cancel" : "Reply");
  // /compact is typed into the orchestrator, so only while it sits idle or done.
  const orchNow = it.run ? (orchestratorState(it.run, ctx) === "gone" ? "gone" : exactStatus(it.run.terminal, ctx) ?? "unknown") : null;
  const compactWhy = (o) => (isCompact(o.label) && isBudgetQuestion(it) && !["idle", "done"].includes(orchNow)
    ? `Compact needs the orchestrator idle or done (it is ${orchNow})` : null);
  const canPick = !answered && !why;
  // Greyed out once answered or when it can't be answered from here; a click picks that option.
  const optionButton = (i) => {
    const o = it.options[i];
    // Disabled always says why: from here it can't be answered, it was, or Compact must wait.
    const off = why || (answered && "Already answered") || compactWhy(o);
    const b = actionButton(t, `${rid}-opt-${i}`, i === it.recommended ? `★ ${o.label}` : o.label,
      `${o.text || o.label}${i === it.recommended ? " (recommended)" : ""}`,
      off ? null : (cx) => { sendAnswer(view, it, o.label, cx, true); }, i === it.recommended);
    return off ? b.tooltip(off) : b;
  };
  const note = answered && div().text_size(11).text_color(t.muted).child(it.run && runGone(it.run) ? "Waits in its inbox until the run is resumed" : sent ? "Answered, waiting for the orchestrator" : "Message waiting for the orchestrator");
  const input = open && v_flex().gap(4)
    .child(Input.new(view.reply))
    .child(div().text_size(10.5).text_color(t.dim).child(it.kind === "decision" && cap.terminal ? "Enter sends it to the captain, with this decision attached" : it.run && runGone(it.run) ? "Enter writes it to the run's inbox, where it waits until the run is resumed" : "Enter writes it to the run's inbox and tells its orchestrator"));
  return { replyBtn, optionButton, canPick, note, input };
}
