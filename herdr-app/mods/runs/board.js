// The serious views: run cards, the summary bar, and the rail above the focused agent.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, focused, run, theme, settings } from "herdr";
import { taskTone, prsOf, orchestratorState, workersOf, workerStatus, captainOf, needsYou, openUrl, ago, short } from "./data.js";

const PHASE = {
  running: { label: "Running", tone: "working" },
  waiting: { label: "Needs you", tone: "blocked" },
  blocked: { label: "Blocked", tone: "blocked" },
  finished: { label: "Finished", tone: "done" },
  unknown: { label: "Starting", tone: "dim" },
};


export function pill(t, text, tone, solid = false) {
  const c = t[tone] ?? t.dim;
  return div().flex_none().px(7).h(18).rounded(9).flex().items_center()
    .bg(solid ? c : c + "22").text_size(10.5).font_semibold().text_color(solid ? t.background : c).child(text);
}

function statusDot(t, s) {
  if (s === "working") return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
  if (s === "blocked") return div().size(8).flex_none().rounded(4).bg(t.blocked).loop("opacity", { from: 0.35, to: 1, period: 1100 });
  if (s === "gone") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.dim);
  if (s === "idle") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(8).flex_none().rounded(4).bg(t[s] ?? t.dim);
}

function prRow(t, pr, i) {
  const tone = { OPEN: "working", DRAFT: "dim", MERGED: "done", CLOSED: "blocked" }[pr.state] ?? "dim";
  const c = pr.checks;
  const checkText = c.fail ? `✗ ${c.fail} failing` : c.pending ? `… ${c.pending} running` : c.pass ? `✓ ${c.pass}` : "";
  const checkTone = c.fail ? "blocked" : c.pending ? "working" : "done";
  const review = { APPROVED: ["Approved", "done"], CHANGES_REQUESTED: ["Changes requested", "blocked"], REVIEW_REQUIRED: ["Review needed", "dim"] }[pr.review];
  return h_flex().id(`pr-${i}-${pr.url}`).gap(7).items_center().h(24).px(6).rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(pr.url).on_click((_e, cx) => { cx.stop_propagation(); openUrl(pr.url); })
    .child(svg("mods/runs/pr.svg").size(13).flex_none().text_color(t[tone] ?? t.dim))
    .child(div().flex_none().text_color(t.muted).child(pr.number ? `#${pr.number}` : "PR"))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(pr.title ?? pr.url))
    .when(Boolean(checkText), (el) => el.child(div().flex_none().text_size(11).text_color(t[checkTone]).child(checkText)))
    .when(Boolean(review), (el) => el.child(div().flex_none().text_size(11).text_color(t[review[1]]).child(review[0])))
    .child(pill(t, pr.state === "DRAFT" ? "Draft" : pr.state[0] + pr.state.slice(1).toLowerCase(), tone));
}

function taskStrip(t, r) {
  if (!r.tasks.length && r.planned == null) return null;
  const merged = r.merged ?? r.tasks.filter((x) => x.state === "merged").length;
  const planned = Math.max(r.planned ?? 0, r.tasks.length, 1);
  return v_flex().gap(5)
    .child(h_flex().gap(3).h(6).children(Array.from({ length: planned }, (_, i) => {
      const task = r.tasks[i];
      const tone = task ? taskTone(task.state) : i < merged ? "done" : null;
      return div().flex_1().h_full().rounded(3).bg(tone ? t[tone] : t.border)
        .when(tone === "working", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1400 }));
    })))
    .when(r.tasks.length > 0, (el) => el.child(h_flex().flex_wrap().gap_x(10).text_size(11).text_color(t.dim)
      .children(r.tasks.map((x) => h_flex().gap(4).items_center()
        .child(div().size(6).rounded(3).bg(t[taskTone(x.state)] ?? t.border))
        .child(div().text_color(x.state === "merged" ? t.dim : t.muted).child(`${x.id} ${x.name}`))
        .child(div().text_color(t.dim).child(x.state))))));
}

export function card(t, r, ctx, compact = false) {
  const all = ctx.all, listed = ctx.listed;
  const o = orchestratorState(r, all, listed);
  const need = needsYou(r, o);
  const ph = PHASE[r.phase] ?? PHASE.unknown;
  const prs = prsOf(r) ?? r.prs.map((p) => ({ url: p.url, title: p.url, state: "UNKNOWN", checks: { pass: 0, fail: 0, pending: 0 } }));
  const workers = r.terminal ? workersOf(r.terminal, all) : [];
  const edge = need ? t.blocked : t[ph.tone] ?? t.border;
  const focus = () => r.terminal && o !== "gone" && run("agent.focus", { terminal: r.terminal });
  const question = r.question?.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean);
  return v_flex().id(`run-${r.key}`).relative().overflow_hidden().flex_none().gap(8).p(12).pl(16).rounded(10).bg(t.surface)
    .border(1).border_color(need ? t.blocked + "88" : t.border).cursor_pointer()
    .hover((s) => s.bg(t.raised)).on_click(focus)
    .child(div().absolute().left(0).top(0).bottom(0).w(4).bg(edge))
    .child(h_flex().gap(8).items_center()
      .child(div().flex_none().text_size(15).child("\u{1F419}"))
      .child(v_flex().flex_1().min_w(0)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().truncate().font_semibold().text_size(13.5).text_color(t.foreground).child(r.branch))
          .when(Boolean(r.machine), (el) => el.child(div().flex_none().text_size(10.5).px(5).rounded(4).bg(t.raised).text_color(t.muted).child(r.machine))))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(`${r.repo}${workers.length ? ` · ${workers.length} agent${workers.length > 1 ? "s" : ""}` : ""}${r.updated ? ` · ${ago(r.updated)}` : ""}`)))
      .child(statusDot(t, o))
      .child(pill(t, ph.label, need ? "blocked" : ph.tone, need)))
    .when(Boolean(r.progress), (el) => el.child(div().text_size(12.5).text_color(t.foreground).child(r.progress)))
    .when(!compact, (el) => el.child(taskStrip(t, r)))
    .when(need && Boolean(question), (el) => el.child(h_flex().gap(8).p(8).rounded(7).bg(t.blocked + "1c").items_start()
      .child(div().flex_none().text_color(t.blocked).font_bold().child("?"))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(11).font_semibold().text_color(t.blocked).child("Waiting for your answer — click to open the orchestrator"))
        .child(div().text_size(12).text_color(t.foreground).child(question.slice(0, 220))))))
    .when(need && !question && Boolean(r.statusLine) && r.phase !== "running", (el) => el.child(div().text_size(12).text_color(t.blocked).child(r.statusLine)))
    .when(o === "gone" && r.phase !== "finished", (el) => el.child(div().text_size(11.5).text_color(t.blocked).child("Orchestrator terminal is gone — ask the captain to resume this run.")))
    .when(r.waiting.length > 0, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`Waiting on an answer: ${r.waiting.join(", ")}`)))
    .when(r.unhandled > 0, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`${r.unhandled} relayed message${r.unhandled > 1 ? "s" : ""} not read yet`)))
    .when(prs.length > 0 || r.issues.length > 0, (el) => el.child(v_flex().gap(1).text_size(12)
      .children(prs.map((p, i) => prRow(t, p, i)))
      .when(r.issues.length > 0, (el) => el.child(h_flex().flex_wrap().gap(6).px(6).pt(2)
        .children(r.issues.map((u) => div().id(`is-${r.key}-${u}`).px(6).h(20).flex().items_center().rounded(5).bg(t.raised).text_size(11).text_color(t.muted).cursor_pointer()
          .hover((s) => s.text_color(t.foreground)).tooltip(u)
          .on_click((_e, cx) => { cx.stop_propagation(); openUrl(u); }).child(`◎ ${short(u)}`)))))))
    .when(prs.length === 0 && r.phase !== "finished" && !compact, (el) => el.child(div().text_size(11).text_color(t.dim).child("No pull request yet")));
}

export function captainStrip(t, ctx, runs) {
  const cap = captainOf(ctx.all);
  if (!cap.terminal) return h_flex().flex_none().gap(8).p(10).rounded(10).border(1).border_color(t.border).text_size(12).text_color(t.dim)
    .child("⚓").child("No captain running. Start one with /herdr-app-captain.");
  const status = ctx.listed.find((a) => a.address === cap.terminal.address)?.status ?? "idle";
  return h_flex().id("captain").flex_none().gap(10).p(10).px(12).rounded(10).bg(t.accent + "18").border(1).border_color(t.accent + "55")
    .items_center().cursor_pointer().hover((s) => s.bg(t.accent + "26"))
    .on_click(() => run("agent.focus", { terminal: cap.terminal.address }))
    .child(div().text_size(18).child("⚓"))
    .child(v_flex().flex_1().min_w(0)
      .child(div().font_semibold().text_size(13).text_color(t.foreground).child("Captain"))
      .child(div().text_size(11.5).text_color(cap.watching ? t.muted : t.blocked)
        .child(cap.watching ? `Watching ${runs.length} run${runs.length === 1 ? "" : "s"}` : "Watcher is not running — ask the captain to watch")))
    .child(statusDot(t, status));
}

// The cards list: captain, runs that need you, the others, then finished runs folded.
export function cards(view, t, runs, errors) {
  const ctx = { all: terminals(), listed: agents() };
  const live = runs.filter((r) => r.phase !== "finished");
  const done = runs.filter((r) => r.phase === "finished");
  const order = (r) => (needsYou(r, orchestratorState(r, ctx.all, ctx.listed)) ? 0 : 1);
  live.sort((a, b) => order(a) - order(b));
  const narrow = (view.size?.width ?? 600) / (Number(settings()?.zoom) || 1) < 360;
  return v_flex().id("root").size_full().min_h(0).bg(t.canvas ?? t.chrome).text_size(13)
    .on_size_change((size, cx) => { view.size = size; cx.notify(); })
    .child(h_flex().flex_none().px(14).pt(12).pb(8).items_center().justify_between()
      .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Runs"))
      .child(div().text_size(11).text_color(t.dim).child(summaryText(runs, ctx))))
    .child(v_flex().id("runs-list").flex_1().min_h(0).px(10).pb(12).gap(8).overflow_y_scrollbar()
      .child(captainStrip(t, ctx, live))
      .when(live.length === 0, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child("No runs in progress. Ask the captain to start one, e.g. “start issue 185 in snelogin”.")))
      .children(live.map((r) => card(t, r, ctx, narrow)))
      .when(done.length > 0, (el) => el.child(h_flex().id("finished-toggle").pt(6).px(4).gap(6).items_center().text_size(11).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { view.showDone = !view.showDone; cx.notify(); })
        .child(svg(`mods/workspace-chrome/chevron-${view.showDone ? "down" : "right"}.svg`).size(11))
        .child(`${done.length} finished`)))
      .when(Boolean(view.showDone), (el) => el.children(done.map((r) => card(t, r, ctx, true))))
      .when(errors.length > 0, (el) => el.child(div().px(4).text_size(11).text_color(t.blocked).child(errors.join("\n")))));
}

export function summaryText(runs, ctx) {
  const live = runs.filter((r) => r.phase !== "finished");
  const need = live.filter((r) => needsYou(r, orchestratorState(r, ctx.all, ctx.listed))).length;
  const open = runs.flatMap((r) => prsOf(r) ?? []).filter((p) => p.state === "OPEN" || p.state === "DRAFT").length;
  return [`${live.length} running`, need ? `${need} need you` : null, `${open} open PR${open === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
}

// The top bar of the runs-board layout.
export function summary(t, runs) {
  const ctx = { all: terminals(), listed: agents() };
  const live = runs.filter((r) => r.phase !== "finished");
  const need = live.filter((r) => needsYou(r, orchestratorState(r, ctx.all, ctx.listed)));
  const prs = runs.flatMap((r) => prsOf(r) ?? []);
  const open = prs.filter((p) => p.state === "OPEN" || p.state === "DRAFT");
  const failing = open.filter((p) => p.checks?.fail).length;
  const merged = live.reduce((n, r) => n + (r.merged ?? 0), 0), planned = live.reduce((n, r) => n + (r.planned ?? 0), 0);
  const workers = live.reduce((n, r) => n + (r.terminal ? workersOf(r.terminal, ctx.all).length : 0), 0);
  const cap = captainOf(ctx.all);
  const stat = (n, label, tone, id, onClick) => v_flex().id(id).px(14).py(4).rounded(8).gap(0).cursor_pointer().hover((s) => s.bg(t.hover))
    .when(Boolean(onClick), (el) => el.on_click(onClick))
    .child(div().text_size(22).font_semibold().text_color(tone ? t[tone] : t.foreground).child(String(n)))
    .child(div().text_size(10.5).text_color(t.dim).child(label));
  return h_flex().size_full().px(18).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
    .child(v_flex().gap(1).mr(16)
      .child(h_flex().gap(8).items_center().child(div().text_size(17).font_semibold().text_color(t.foreground).child("Run board")))
      .child(div().text_size(11).text_color(cap.terminal ? (cap.watching ? t.muted : t.blocked) : t.dim)
        .child(cap.terminal ? (cap.watching ? "⚓ Captain on watch" : "⚓ Captain not watching") : "⚓ No captain")))
    .child(stat(live.length, "runs", null, "s-runs"))
    .child(stat(need.length, "need you", need.length ? "blocked" : null, "s-need", need[0]?.terminal ? () => run("agent.focus", { terminal: need[0].terminal }) : null))
    .child(stat(workers, "agents", workers ? "working" : null, "s-workers"))
    .child(stat(`${merged}/${planned}`, "tasks merged", null, "s-tasks"))
    .child(stat(open.length, failing ? `open PRs · ${failing} failing` : "open PRs", failing ? "blocked" : open.length ? "done" : null, "s-prs"))
    .child(div().flex_1())
    .child(div().id("to-main").px(10).h(26).rounded(6).flex().items_center().text_size(11.5).text_color(t.muted).border(1).border_color(t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => run("layout.switch", { name: "main-runs" })).child("Back to main"));
}

// One line above the focused agent's terminal in the runs-board layout.
export function focusRail(t) {
  const listed = agents();
  const addr = focused()?.agent;
  const a = listed.find((x) => x.address === addr) ?? listed[0];
  const k = terminals().find((x) => x.address === (a?.address ?? addr));
  const role = k?.labels?.role;
  const name = role === "captain" ? "⚓ Captain" : role === "orchestrator" ? `\u{1F419} ${k.labels?.["herdr.tab"] ? a?.tab_name ?? "" : ""}` : a ? `${a.space_name} · ${a.tab_name}` : "No agent";
  return h_flex().size_full().px(14).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12)
    .when(Boolean(a?.program?.icon), (el) => el.child(a.program.tint ? svg(a.program.icon).size(14).text_color(t.foreground) : image(a.program.icon).size(14)))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).font_medium().child(name))
    .when(Boolean(k?.labels?.progress), (el) => el.child(div().max_w(320).truncate().text_color(t.dim).child(k.labels.progress)))
    .when(Boolean(a), (el) => el.child(statusDot(t, a.status)))
    .child(div().id("peek-hint").text_size(11).text_color(t.dim).child("click a run or agent to show it here"));
}
