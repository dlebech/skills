// The serious views: run cards, the Crew block, the summary bar, and the rail above the focused agent.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { focused, run, settings } from "herdr";
import {
  facts, stats, taskTone, prsOf, unknownPr, PR_TONE, orchestratorState, agentStatus, workersOf,
  captainOf, captainPane, togglePin, needsYou, plural, openUrl, ago, shortRef,
} from "./data.js";

const CAPTAIN = "\u{1F9D1}‍✈️", OCTOPUS = "\u{1F419}", CRAB = "\u{1F980}";

const PHASE = {
  running: { label: "Running", tone: "working" },
  waiting: { label: "Needs you", tone: "blocked" },
  blocked: { label: "Blocked", tone: "blocked" },
  finished: { label: "Finished", tone: "done" },
  unknown: { label: "Starting", tone: "dim" },
};

function pill(t, text, tone, solid = false) {
  const c = t[tone] ?? t.dim;
  return div().flex_none().px(7).h(18).rounded(9).flex().items_center()
    .bg(solid ? c : c + "22").text_size(10.5).font_semibold().text_color(solid ? t.background : c).child(text);
}

function statusDot(t, status) {
  if (status === "working") return svg("mods/harbormaster/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().size(8).flex_none().rounded(4).bg(t.blocked).loop("opacity", { from: 0.35, to: 1, period: 1100 });
  if (status === "gone") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.dim);
  if (status === "idle") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(8).flex_none().rounded(4).bg(t[status] ?? t.dim);
}

function prRow(t, pr, i) {
  const tone = PR_TONE[pr.state] ?? "dim";
  const c = pr.checks;
  const checkText = c.fail ? `✗ ${c.fail} failing` : c.pending ? `… ${c.pending} running` : c.pass ? `✓ ${c.pass}` : "";
  const checkTone = c.fail ? "blocked" : c.pending ? "working" : "done";
  const review = { APPROVED: ["Approved", "done"], CHANGES_REQUESTED: ["Changes requested", "blocked"], REVIEW_REQUIRED: ["Review needed", "dim"] }[pr.review];
  return h_flex().id(`pr-${i}-${pr.url}`).gap(7).items_center().h(24).px(6).rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(pr.url).on_click((_e, cx) => { cx.stop_propagation(); openUrl(pr.url); })
    .child(svg("mods/harbormaster/pr.svg").size(13).flex_none().text_color(t[tone] ?? t.dim))
    .child(div().flex_none().text_color(t.muted).child(pr.number ? `#${pr.number}` : "PR"))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(pr.title ?? pr.url))
    .when(Boolean(checkText), (el) => el.child(div().flex_none().text_size(11).text_color(t[checkTone]).child(checkText)))
    .when(Boolean(review), (el) => el.child(div().flex_none().text_size(11).text_color(t[review[1]]).child(review[0])))
    .child(pill(t, pr.state === "DRAFT" ? "Draft" : pr.state[0] + pr.state.slice(1).toLowerCase(), tone));
}

const hasTasks = (r) => r.tasks.length > 0 || r.planned != null;

function taskStrip(t, r) {
  const merged = r.merged ?? r.tasks.filter((task) => task.state === "merged").length;
  const planned = Math.max(r.planned ?? 0, r.tasks.length, 1);
  return v_flex().gap(5)
    .child(h_flex().gap(3).h(6).children(Array.from({ length: planned }, (_, i) => {
      const task = r.tasks[i];
      const tone = task ? taskTone(task.state) : i < merged ? "done" : null;
      return div().flex_1().h_full().rounded(3).bg(tone ? t[tone] : t.border)
        .when(tone === "working", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1400 }));
    })))
    .when(r.tasks.length > 0, (el) => el.child(h_flex().flex_wrap().gap_x(10).text_size(11).text_color(t.dim)
      .children(r.tasks.map((task) => h_flex().gap(4).items_center()
        .child(div().size(6).rounded(3).bg(t[taskTone(task.state)] ?? t.border))
        .child(div().text_color(task.state === "merged" ? t.dim : t.muted).child(`${task.id} ${task.name}`))
        .child(div().text_color(t.dim).child(task.state))))));
}

function card(t, r, ctx, compact = false) {
  const orch = orchestratorState(r, ctx);
  const need = needsYou(r, orch);
  const phase = PHASE[r.phase] ?? PHASE.unknown;
  const prs = prsOf(r) ?? r.prs.map((p) => unknownPr(p.url, p.repo));
  const workers = workersOf(r.terminal, ctx);
  const edge = need ? t.blocked : t[phase.tone] ?? t.border;
  const focus = () => r.terminal && orch !== "gone" && run("agent.focus", { terminal: r.terminal });
  const question = r.question?.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean);
  const meta = [r.repo, workers.length ? plural(workers.length, "agent") : null, r.updated ? ago(r.updated) : null].filter(Boolean).join(" · ");
  return v_flex().id(`run-${r.key}`).relative().overflow_hidden().flex_none().gap(8).p(12).pl(16).rounded(10).bg(t.surface)
    .border(1).border_color(need ? t.blocked + "88" : t.border).cursor_pointer()
    .hover((s) => s.bg(t.raised)).on_click(focus)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).bg(edge))
    .child(h_flex().gap(8).items_center()
      .child(div().flex_none().text_size(15).child(OCTOPUS))
      .child(v_flex().flex_1().min_w(0)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().truncate().font_semibold().text_size(13.5).text_color(t.foreground).child(r.branch))
          .when(Boolean(r.machine), (el) => el.child(div().flex_none().text_size(10.5).px(5).rounded(4).bg(t.raised).text_color(t.muted).child(r.machine))))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(meta)))
      .child(statusDot(t, orch))
      .child(pill(t, phase.label, need ? "blocked" : phase.tone, need)))
    .when(need && Boolean(question), (el) => el.child(h_flex().gap(8).p(8).rounded(7).bg(t.blocked + "1c").items_start()
      .child(div().flex_none().text_color(t.blocked).font_bold().child("?"))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(11).font_semibold().text_color(t.blocked).child("Waiting for your answer — click to open the orchestrator"))
        .child(div().text_size(12).text_color(t.foreground).child(question.slice(0, 220))))))
    .when(Boolean(r.progress), (el) => el.child(div().text_size(12.5).text_color(t.foreground).child(r.progress)))
    .when(!compact && hasTasks(r), (el) => el.child(taskStrip(t, r)))
    .when(need && !question && Boolean(r.statusLine) && r.phase !== "running", (el) => el.child(div().text_size(12).text_color(t.blocked).child(r.statusLine)))
    .when(orch === "gone" && r.phase !== "finished", (el) => el.child(div().text_size(11.5).text_color(t.blocked).child("Orchestrator terminal is gone — ask the captain to resume this run.")))
    .when(r.waiting.length > 0, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`Waiting on an answer: ${r.waiting.join(", ")}`)))
    .when(r.unhandled > 0, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`${plural(r.unhandled, "relayed message")} not read yet`)))
    .when(prs.length > 0 || r.issues.length > 0, (el) => el.child(v_flex().gap(1).text_size(12)
      .children(prs.map((p, i) => prRow(t, p, i)))
      .when(r.issues.length > 0, (el) => el.child(h_flex().flex_wrap().gap(6).px(6).pt(2)
        .children(r.issues.map((url) => div().id(`is-${r.key}-${url}`).px(6).h(20).flex().items_center().rounded(5).bg(t.raised).text_size(11).text_color(t.muted).cursor_pointer()
          .hover((s) => s.text_color(t.foreground)).tooltip(url)
          .on_click((_e, cx) => { cx.stop_propagation(); openUrl(url); }).child(`◎ ${shortRef(url)}`)))))))
    .when(prs.length === 0 && r.phase !== "finished" && !compact, (el) => el.child(div().text_size(11).text_color(t.dim).child("No pull request yet")));
}

// Adds or removes the runs overview as a pane beside the captain.
function pinButton(t, ctx, labelled = false) {
  const captain = captainPane(ctx);
  if (!captain) return div();
  const tip = captain.pinned ? "Close the runs pane beside the captain" : "Keep the runs open as a pane beside the captain";
  return h_flex().id("pin").flex_none().gap(5).items_center().px(labelled ? 8 : 4).h(22).rounded(5).cursor_pointer()
    .text_size(11).text_color(captain.pinned ? t.accent : t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
    .on_click((_e, cx) => { cx.stop_propagation(); togglePin(captain); })
    .child(svg("mods/harbormaster/pin.svg").size(13))
    .when(labelled, (el) => el.child(captain.pinned ? "Unpin" : "Pin beside captain"));
}

function captainStrip(t, ctx, liveRuns) {
  const cap = captainOf(ctx);
  if (!cap.terminal) return h_flex().flex_none().gap(8).p(10).rounded(10).border(1).border_color(t.border).text_size(12).text_color(t.dim)
    .child(CAPTAIN).child("No captain running. Start one with /herdr-app-captain.");
  return h_flex().id("captain").flex_none().gap(10).p(10).px(12).rounded(10).bg(t.accent + "18").border(1).border_color(t.accent + "55")
    .items_center().cursor_pointer().hover((s) => s.bg(t.accent + "26"))
    .on_click(() => run("agent.focus", { terminal: cap.terminal.address }))
    .child(div().text_size(18).child(CAPTAIN))
    .child(v_flex().flex_1().min_w(0)
      .child(div().font_semibold().text_size(13).text_color(t.foreground).child("Captain"))
      .child(div().text_size(11.5).text_color(cap.watching ? t.muted : t.blocked)
        .child(cap.watching ? `Watching ${plural(liveRuns, "run")}` : "Watcher is not running — ask the captain to watch")))
    .child(pinButton(t, ctx, true))
    .child(statusDot(t, agentStatus(cap.terminal, ctx)));
}

function summaryText(s) {
  return [`${s.live.length} running`, s.need.length ? `${s.need.length} need you` : null, plural(s.open.length, "open PR")].filter(Boolean).join(" · ");
}

// The cards list: captain, runs that need you, the others, then finished runs folded.
export function cards(view, t, runs, errors) {
  const ctx = facts();
  const s = stats(runs, ctx);
  const needing = new Set(s.need);
  const live = [...s.need, ...s.live.filter((r) => !needing.has(r))];
  const narrow = (view.size?.width ?? 600) / (Number(settings()?.zoom) || 1) < 360;
  return v_flex().id("root").size_full().min_h(0).bg(t.canvas ?? t.chrome).text_size(13)
    .on_size_change((size, cx) => { view.size = size; cx.notify(); })
    .child(h_flex().flex_none().px(14).pt(12).pb(8).items_center().justify_between()
      .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Runs"))
      .child(div().text_size(11).text_color(t.dim).child(summaryText(s))))
    .child(v_flex().id("runs-list").flex_1().min_h(0).px(10).pb(12).gap(8).overflow_y_scrollbar()
      .child(captainStrip(t, ctx, live.length))
      .when(live.length === 0, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child("No runs in progress. Ask the captain to start one, e.g. “start issue 185 in snelogin”.")))
      .children(live.map((r) => card(t, r, ctx, narrow)))
      .when(s.finished.length > 0, (el) => el.child(h_flex().id("finished-toggle").pt(6).px(4).gap(6).items_center().text_size(11).text_color(t.dim).cursor_pointer()
        .hover((st) => st.text_color(t.foreground))
        .on_click((_e, cx) => { view.showDone = !view.showDone; cx.notify(); })
        .child(svg(`mods/harbormaster/chevron-${view.showDone ? "down" : "right"}.svg`).size(11))
        .child(`${s.finished.length} finished`)))
      .when(Boolean(view.showDone), (el) => el.children(s.finished.map((r) => card(t, r, ctx, true))))
      .when(errors.length > 0, (el) => el.child(div().px(4).text_size(11).text_color(t.blocked).child(errors.join("\n")))));
}

// The top bar of the harbormaster-board layout.
export function summary(t, runs) {
  const ctx = facts();
  const s = stats(runs, ctx);
  const cap = captainOf(ctx);
  const stat = (value, label, tone, id, onClick) => v_flex().id(id).px(14).py(4).rounded(8).gap(0).cursor_pointer().hover((st) => st.bg(t.hover))
    .when(Boolean(onClick), (el) => el.on_click(onClick))
    .child(div().text_size(22).font_semibold().text_color(tone ? t[tone] : t.foreground).child(String(value)))
    .child(div().text_size(10.5).text_color(t.dim).child(label));
  const firstNeed = s.need[0]?.terminal;
  return h_flex().size_full().px(18).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
    .child(v_flex().gap(1).mr(16)
      .child(h_flex().gap(8).items_center().child(div().text_size(17).font_semibold().text_color(t.foreground).child("Run board")))
      .child(div().text_size(11).text_color(cap.terminal ? (cap.watching ? t.muted : t.blocked) : t.dim)
        .child(`${CAPTAIN} ${cap.terminal ? (cap.watching ? "Captain on watch" : "Captain not watching") : "No captain"}`)))
    .child(stat(s.live.length, "runs", null, "s-runs"))
    .child(stat(s.need.length, "need you", s.need.length ? "blocked" : null, "s-need", firstNeed ? () => run("agent.focus", { terminal: firstNeed }) : null))
    .child(stat(s.workers, "agents", s.workers ? "working" : null, "s-workers"))
    .child(stat(`${s.merged}/${s.planned}`, "tasks merged", null, "s-tasks"))
    .child(stat(s.open.length, s.failing ? `open PRs · ${s.failing} failing` : "open PRs", s.failing ? "blocked" : s.open.length ? "done" : null, "s-prs"))
    .child(div().flex_1())
    .child(div().id("to-main").px(10).h(26).rounded(6).flex().items_center().text_size(11.5).text_color(t.muted).border(1).border_color(t.border)
      .cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
      .on_click(() => run("layout.switch", { name: "harbormaster-main" })).child("Back to main"));
}

// One line above the focused agent's terminal in the harbormaster-board layout.
export function focusRail(t, runs) {
  const ctx = facts();
  const address = focused()?.agent;
  const agent = ctx.agents.find((a) => a.address === address) ?? ctx.agents[0];
  const term = ctx.terminals.find((x) => x.address === (agent?.address ?? address));
  const role = term?.labels?.role;
  const branch = runs.find((r) => r.terminal === term?.address)?.branch;
  const name = role === "captain" ? `${CAPTAIN} Captain`
    : role === "orchestrator" ? `${OCTOPUS} ${branch ?? term.name ?? agent?.tab_name ?? "orchestrator"}`
    : agent ? `${agent.space_name} · ${agent.tab_name}` : "No agent";
  return h_flex().size_full().px(14).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12)
    .when(Boolean(agent?.program?.icon), (el) => el.child(agent.program.tint ? svg(agent.program.icon).size(14).text_color(t.foreground) : image(agent.program.icon).size(14)))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).font_medium().child(name))
    .when(Boolean(term?.labels?.progress), (el) => el.child(div().max_w(320).truncate().text_color(t.dim).child(term.labels.progress)))
    .when(Boolean(agent), (el) => el.child(statusDot(t, agent.status)))
    .child(div().id("peek-hint").text_size(11).text_color(t.dim).child("click a run or agent to show it here"));
}

// The Crew block: the captain and every orchestrator as cards, from their role labels.
// Sits above Herdr's own Agents list in the harbormaster-main layout, so that list stays stock.
export function crew(view, t) {
  const ctx = facts();
  const cap = captainOf(ctx);
  const orchestrators = ctx.terminals.filter((term) => term.state === "live" && term.labels?.role === "orchestrator");
  const runOf = (term) => view.runs.find((r) => r.terminal === term.address);
  const runStatus = (term) => term.labels?.["run.status"] ?? runOf(term)?.phase ?? "running";
  const row = ({ id, emoji, title, detail, tone, status, address, edge, pin = false }) => h_flex().id(id).relative().overflow_hidden().flex_none().gap(8).py(6).pl(12).pr(8)
    .rounded(7).bg(edge + "14").cursor_pointer().hover((st) => st.bg(edge + "26"))
    .on_click(() => run("agent.focus", { terminal: address }))
    .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(edge))
    .child(div().flex_none().text_size(15).child(emoji))
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
      .child(div().truncate().text_size(11).text_color(t[tone] ?? t.dim).child(detail)))
    .when(pin, (el) => el.child(pinButton(t, ctx)))
    .child(statusDot(t, status));
  const rows = [];
  if (cap.terminal) {
    const watched = orchestrators.filter((term) => runStatus(term) !== "finished").length;
    rows.push(row({
      id: "crew-captain", emoji: CAPTAIN, title: "Captain", pin: true,
      detail: cap.watching ? `on watch · ${plural(watched, "run")}` : "not watching runs",
      tone: cap.watching ? "muted" : "blocked", status: agentStatus(cap.terminal, ctx), address: cap.terminal.address, edge: t.accent,
    }));
  }
  for (const term of orchestrators) {
    const r = runOf(term), labels = term.labels ?? {};
    const status = agentStatus(term, ctx);
    const need = r ? needsYou(r, status) : status === "blocked";
    const phase = runStatus(term);
    const prCount = (r && prsOf(r)?.length) || (labels["run.prs"] ? String(labels["run.prs"]).split(/[\s,]+/).filter(Boolean).length : 0);
    const workers = workersOf(term.address, ctx).length;
    const detail = [
      need ? "needs you" : phase !== "running" ? phase : null,
      labels.progress ?? r?.progress,
      workers ? `${CRAB} ${workers}` : null,
      prCount ? plural(prCount, "PR") : null,
    ].filter(Boolean).join(" · ");
    rows.push(row({
      id: `crew-${term.address}`, emoji: OCTOPUS, title: r?.branch ?? term.name ?? term.address, detail: detail || "orchestrator",
      tone: need ? "blocked" : "muted", status, address: term.address,
      edge: (need ? t.blocked : phase === "finished" ? t.done : t.working) ?? t.border,
    }));
  }
  return v_flex().id("crew").size_full().min_h(0).bg(t.chrome).text_size(12.5)
    .child(div().flex_none().px(12).pt(8).pb(4).text_size(11.5).font_semibold().text_color(t.foreground).child("Crew"))
    .child(v_flex().id("crew-list").flex_1().min_h(0).px(8).pb(6).gap(4).overflow_y_scrollbar()
      .when(rows.length === 0, (el) => el.child(div().px(4).text_size(11.5).text_color(t.dim).child("No captain or orchestrators. Start one with /herdr-app-captain.")))
      .children(rows));
}
