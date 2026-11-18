// The sea: a calm status strip above the terminals. The captain's boat rides the surface, each run is a
// reef card (its name, what it does now, its path to merge, its PR flags, its octopus and crabs, and the
// one button it needs from you), agents outside any run drift on the right. Colours come from the theme;
// the only motion is native and off unless the layout block sets props.motion (see sealook.js idle), so nothing here asks for a redraw of its own.

import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, run, setAgentOrder, openOverlay, props } from "herdr";
import { stats, prsOf, PR_TONE, isParked, resumeRun } from "./data.js";
import { facts, orchestratorState, agentStatus, workersOf, captainOf, adrift, agentNames, focusAgent, openUrl } from "./live.js";
import { needsYouNow, runlessOrchs } from "./attend.js";
import { needCount, rowLead } from "./crewrows.js";
import { zoom, programIcon, runName, withTip } from "./ui.js";
import { runFacts, attOf, pathInput, needItemsOf, needButton, actionButton, runProps, PASS, AMBER } from "./overview.js";
import { primaryOf } from "./needaction.js";
import { mergePath } from "./mergepath.js";
import { buoyLook, stillLook, idle, captainText, boatBadge, railCounts, opensPopup, motionOf, BADGE_TEXT } from "./sealook.js";

const SURFACE = 30; // the water's surface line, from the top of the strip

// One creature: the octopus (an orchestrator) or a crab (a worker, or a drifter outside any run).
// Motion is native: working floats or sidles, blocked hops, the rest stay still.
function critter(t, motion, { kind, id, status, name, program, w, onClick }) {
  const octo = kind === "octopus";
  const h = Math.round(w * (octo ? 0.92 : 0.75));
  const art = octo ? "octopus" : status === "done" ? "crab-sleep" : "crab";
  const still = motion ? { raise: 0, badge: false } : stillLook(status);
  const dot = Math.round(w * 0.3);
  const body = div().id(`body-${id}`).relative().top(-still.raise).w(w).h(h)
    .child(image(`mods/harbormaster/${art}.svg`).w(w).h(h).opacity(status === "gone" ? 0.4 : 1))
    .when(!octo && Boolean(program?.icon), (el) => el.child(div().absolute().left(Math.round(w * 0.35)).top(Math.round(h * 0.5)).size(dot)
      .rounded(Math.round(dot / 2)).bg(t.surface).flex().items_center().justify_center().child(programIcon(program, Math.max(3, dot - 2), t.foreground))));
  if (still.badge) body.child(div().absolute().right(-2).top(-2).size(9).rounded(5).bg(t.blocked).flex().items_center().justify_center().text_size(7).font_semibold().text_color(BADGE_TEXT).child("!"));
  idle(body, `idle-${id}`, motionOf(kind, status), motion);
  return div().id(`critter-${id}`).flex_none().cursor_pointer().tooltip(`${name}: ${status === "blocked" ? "needs you" : status}`)
    .on_click((_e, cx) => { cx.stop_propagation(); onClick?.(); }).child(body);
}

// Asks before resuming a parked or gone run from its reef: a new orchestrator starts.
function resumeAsk(view, t, r) {
  const button = (id, label, primary, onClick) => actionButton(t, id, label, null, () => { onClick(); view.confirm = null; }, primary);
  return v_flex().id(`ask-${r.key}`).absolute().left(0).right(0).top(0).bottom(0).p(10).gap(8).justify_center().rounded(10).bg(t.surface)
    .on_click((_e, cx) => cx.stop_propagation())
    .child(div().text_size(12).text_color(t.foreground).child(`Resume ${r.branch}? A new orchestrator picks it up in ${r.repo}.`))
    .child(h_flex().gap(6)
      .child(button(`resume-yes-${r.key}`, "Resume", true, () => resumeRun(r)))
      .child(button(`resume-no-${r.key}`, "Cancel", false, () => {})));
}

// A PR as a small flag: a pole and a flag in the PR's tone (red when its checks fail), then its number.
function prFlag(t, r, p, i) {
  const fail = p.checks?.fail > 0;
  const c = fail ? t.blocked : t[PR_TONE[p.state] ?? "dim"] ?? t.muted;
  return h_flex().id(`flag-${r.key}-${i}`).flex_none().gap(3).items_center().cursor_pointer()
    .tooltip(`${p.title ?? p.url} (${p.state.toLowerCase()}${fail ? ", checks failing" : ""})`)
    .on_click((_e, cx) => { cx.stop_propagation(); openUrl(p.url); })
    .child(h_flex().items_start().h(14).child(div().w(2).h(14).bg(c)).child(div().w(14).h(9).rounded_r(2).bg(c)))
    .child(div().text_size(11).text_color(t.muted).child(p.number ? `#${p.number}` : "PR"));
}

// The path to merge as a row of buoys joined by a line, one per stage (mergepath.js).
function buoys(t, motion, r, path) {
  const color = { pass: PASS(t), amber: AMBER(t), blocked: t.blocked };
  return h_flex().items_center().children(path.flatMap((s, i) => {
    const look = buoyLook(s.state, motion);
    const b = div().id(`buoy-${r.key}-${i}`).size(10).flex_none().rounded(5).tooltip(`${s.label}: ${s.tip}`)
      .when(Boolean(look.fill), (el) => el.bg(color[look.fill]))
      .when(Boolean(look.ring), (el) => el.border(1.5).border_color(t[look.ring]))
      .when(look.halo, (el) => el.border(2).border_color(t.blocked + "88"));
    idle(b, `pulse-${r.key}-${i}`, look.pulse ? { prop: "opacity", from: 0.5, to: 1, period: 1300 } : null, motion);
    return i === 0 ? [b] : [div().w(10).h(1).flex_none().bg(t.border), b];
  }));
}

// One reef card for a run. `att`: its attentionOf, read once per draw by harbor().
function reef(view, t, motion, r, ctx, att, now) {
  const orch = orchestratorState(r, ctx);
  const f = runFacts(r, ctx);
  const need = needsYouNow(r, ctx, att);
  const parked = isParked(r);
  const resumable = parked || (orch === "gone" && r.phase !== "finished");
  const asking = view.confirm?.key === r.key && view.confirm.action === "resume";
  const workers = workersOf(r.terminal, ctx);
  const prs = prsOf(r) ?? [];
  const path = mergePath(pathInput(r, f, f.stages));
  const focusOrch = (_e, cx) => {
    if (resumable) { view.confirm = { key: r.key, action: "resume" }; cx?.notify(); }
    else if (orch !== "gone") focusAgent(r.terminal);
  };
  // The same line the Crew's row says, so the two agree.
  const { lead, tone } = rowLead(att, now);
  const leadText = parked ? "Parked · click to resume" : resumable ? "Orchestrator gone · click to resume" : lead;
  const leadColor = resumable ? t.muted : tone === "amber" ? AMBER(t) : tone === "pass" ? PASS(t) : tone === "blocked" ? t.blocked : t.muted;
  // The run's primary action; a picker or confirm needs more room than a reef has, so those open the run's pane.
  const items = need && !parked ? needItemsOf(r, ctx, att) : [];
  const p = primaryOf(items);
  const act = p ? items[p.i].actions[p.j] : null;
  const btnId = `need-reef-${r.key}`;
  const button = !act ? null : opensPopup(act.kind)
    ? actionButton(t, btnId, act.label, "Open this run's pane", () => openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: runProps(r) }), true)
    : needButton(view, t, r, f, act, btnId, "card", true);
  const name = runName(r.branch, r.topic);
  const show = workers.slice(0, 5);
  const creatures = h_flex().gap(6).items_end().min_w(0)
    .when(!parked, (el) => el.child(critter(t, motion, { kind: "octopus", id: r.terminal ?? r.key, status: orch !== "gone" && need ? "blocked" : orch, name: orch === "gone" ? "Orchestrator (gone)" : "Orchestrator", w: 30, onClick: focusOrch })))
    .children(show.map((term) => critter(t, motion, { kind: "crab", id: term.address, status: agentStatus(term, ctx), name: term.name || term.program?.name || term.address, program: term.program, w: 20, onClick: () => focusAgent(term.address) })))
    .when(workers.length > show.length, (el) => el.child(div().text_size(11).text_color(t.dim).child(`+${workers.length - show.length}`)));
  return v_flex().id(`reef-${r.key}`).relative().overflow_hidden().flex_1().min_w(240).max_w(380).h_full().gap(4).p(10).rounded(10)
    .bg(t.surface + "d9").border(1).border_color(t.border).opacity(parked && !asking ? 0.55 : 1).cursor_pointer()
    .hover((s) => s.bg(t.raised)).on_click(focusOrch)
    .when(need && !parked, (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(3).bg(t.blocked)))
    .child(h_flex().gap(8).items_center().min_w(0)
      .child(withTip(div().id(`name-${r.key}`).flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground), name))
      .when(prs.length > 0, (el) => el.child(h_flex().gap(8).items_center().flex_none()
        .children(prs.slice(0, 3).map((x, i) => prFlag(t, r, x, i)))
        .when(prs.length > 3, (e) => e.child(div().text_size(11).text_color(t.muted).child(`+${prs.length - 3}`))))))
    .child(div().min_w(0).truncate().text_size(11).text_color(leadColor).child(leadText))
    .child(div().pt(2).child(buoys(t, motion, r, path)))
    .child(div().flex_1())
    .child(h_flex().gap(8).items_end().justify_between().min_w(0)
      .child(creatures)
      .when(Boolean(button), (el) => el.child(button)))
    .when(asking, (el) => el.child(resumeAsk(view, t, r)));
}

// The captain's boat on the surface with its anchor, a badge for what needs you, a plain-words tooltip.
function boat(view, t, motion, cap, capStatus, badge) {
  const present = Boolean(cap.terminal);
  const state = captainText({ present, watching: cap.watching, working: capStatus === "working" });
  return v_flex().id("boat-col").flex_none().w(150).h_full().items_center().pb(14)
    .child(div().id("boat").relative().flex_none().w(84).h(68).mt(2).tooltip(state).when(present, (el) => el.cursor_pointer().on_click(() => focusAgent(cap.terminal.address)))
      .child(idle(div().w(84).h(68), "boat-rock", { prop: "top", to: 3, period: 2400 }, motion)
        .child(image("mods/harbormaster/captain.svg").w(84).h(68).opacity(present ? 1 : 0.45)))
      .when(badge.count > 0, (el) => el.child(div().id("boat-badge").absolute().right(-6).top(0).min_w(16).h(16).px(4).rounded(8).bg(t.blocked)
        .flex().items_center().justify_center().text_size(11).text_color(BADGE_TEXT).tooltip(badge.tip).child(String(badge.count)))))
    .when(cap.watching, (el) => el.child(div().w(2).flex_1().bg(t.border)))
    .child(svg("mods/harbormaster/anchor.svg").flex_none().w(20).h(22).text_color(t.dim).mt(cap.watching ? 0 : 4));
}

// The sea. Everything is flex; only the seabed picture needs the strip's size (in zoomed px).
export function harbor(view, t) {
  const z = zoom();
  const W = (view.size?.width ?? 1400 * z) / z, H = (view.size?.height ?? 220 * z) / z;
  const bw = Math.max(W, (H - SURFACE) * (1600 / 420)), bh = bw * (420 / 1600);
  const motion = props()?.motion === true;
  const ctx = facts();
  const now = Date.now();
  const s = stats(view.runs, ctx);
  const runs = [...s.shown, ...s.parked];
  const atts = new Map(runs.map((r) => [r, attOf(r, ctx)]));
  const need = runs.filter((r) => needsYouNow(r, ctx, atts.get(r)));
  const cap = captainOf(ctx);
  const badge = boatBadge({ decisions: view.decisions?.length ?? 0, runNames: need.map((r) => r.branch) });
  const inRuns = new Set(runs.flatMap((r) => (r.terminal ? [r.terminal, ...workersOf(r.terminal, ctx).map((term) => term.address)] : [])));
  const drifters = adrift([cap.terminal?.address, ...runs.map((r) => r.terminal)], ctx);
  const shownDrift = drifters.slice(0, 6);
  const driftNames = agentNames(shownDrift);
  const capStatus = cap.terminal && agentStatus(cap.terminal, ctx);
  // Herdr asks a mod that shows agents to pass on their order while it draws them, so that
  // alt-up / alt-down step through the harbor in the order it shows (in memory only).
  setAgentOrder([cap.terminal?.address, ...inRuns, ...drifters.map((a) => a.address)].filter(Boolean));

  return div().id("root").relative().size_full().overflow_hidden().bg(t.canvas ?? t.chrome)
    .on_size_change((size, cx) => { view.size = size; cx.notify(); })
    .child(div().absolute().left(0).top(0).right(0).bottom(0).bg(t.accent + "12"))
    .child(image("mods/harbormaster/seabed.svg").absolute().left((W - bw) / 2).top(H - bh).w(bw).h(bh).opacity(0.35))
    .child(h_flex().absolute().left(0).top(SURFACE - 12).overflow_hidden().w(W)
      .children(Array.from({ length: Math.ceil(W / 200) + 1 }, () => svg("mods/harbormaster/waves.svg").flex_none().w(200).h(24).text_color(t.border))))
    .child(h_flex().absolute().left(0).top(0).right(0).bottom(0)
      .child(boat(view, t, motion, cap, capStatus, badge))
      .child(h_flex().id("reefs").flex_1().min_w(0).h_full().gap(12).pt(44).pb(10).items_stretch().overflow_x_scrollbar()
        .children(runs.map((r) => reef(view, t, motion, r, ctx, atts.get(r), now)))
        .when(runs.length === 0, (el) => el.child(div().flex_1().flex().items_center().justify_center().text_size(12.5).text_color(t.muted)
          .child("No runs. Start one with + New run in the Crew, or from a terminal."))))
      .when(drifters.length > 0, (el) => el.child(v_flex().id("adrift").flex_none().w(120).h_full().pt(44).pb(10).pl(12).pr(12).gap(6)
        .child(div().text_size(11).text_color(t.dim).child("Adrift"))
        .child(h_flex().flex_wrap().gap(8)
          .children(shownDrift.map((a, i) => critter(t, motion, { kind: "crab", id: a.address, status: a.status, name: driftNames[i], program: a.program, w: 22, onClick: () => focusAgent(a.address) })))
          .when(drifters.length > 6, (e) => e.child(div().text_size(11).text_color(t.dim).child(`+${drifters.length - 6}`)))))));
}

// The rail: one status line. Space and tab on the left; counts and the way back on the right.
export function rail(view, t) {
  const s = spaces().find((x) => x.active), tab = s?.tabs.find((x) => x.active);
  const ctx = facts();
  const st = stats(view.runs, ctx);
  const runs = [...st.shown, ...st.parked];
  const need = runs.filter((r) => needsYouNow(r, ctx, attOf(r, ctx)));
  const needs = needCount(need, runlessOrchs(view.runs, ctx), view.decisions?.length ?? 0);
  const counts = railCounts({ runs: runs.length, needs, prs: st.open.length });
  return h_flex().id("rail").size_full().bg(t.chrome).border_t(1).border_b(1).border_color(t.border).px(14).items_center().justify_between().text_size(11).text_color(t.muted)
    .child(h_flex().gap(4).child(div().text_color(t.foreground).child(`${s?.name ?? ""} / ${tab?.name ?? ""}`)))
    .child(h_flex().gap(14).items_center()
      .child(h_flex().gap(4).children(counts.flatMap((c, i) => [
        ...(i ? [div().child("·")] : []),
        div().text_color(c.tone ? t[c.tone] : t.muted).child(c.text)])))
      .child(div().id("to-main").cursor_pointer().hover((x) => x.text_color(t.foreground)).on_click(() => run("layout.switch", { name: "harbormaster-main" })).child("Back to main")));
}
