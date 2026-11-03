// The fun view: runs as reefs in a harbor. The captain watches from a boat on the
// surface, each orchestrator is the octopus of its reef, its workers are crabs.
// Buoys are the run's tasks, signal flags on the mast are its pull requests.

import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, spaces, panes, run, setAgentOrder, settings } from "herdr";
import { taskTone, prsOf, orchestratorState, workersOf, workerStatus, captainOf, needsYou, openUrl } from "./data.js";

const ink = "#173450", navy = "#264a6b", deepNavy = "#1a3550", sand = "#e9d19c", sail = "#fbf7ee", rope = "#e6cf98", brass = "#f2c94c";
const SKY = 86;
const icon = (p, size = 15) => p?.icon ? (p.tint ? svg(p.icon).text_color(p.color ?? ink) : image(p.icon)).size(size) : div().size(size);

function bubble(text) {
  return div().absolute().top(-26).left(0).px(9).py(3).rounded(10).bg(sail).border(2).border_color("#d4553e")
    .text_size(11.5).font_weight(700).text_color("#a3301f").whitespace_nowrap().child(text);
}

// One creature: the octopus (an orchestrator) or a crab (a worker, or a drifter outside any run).
function critter(view, { kind, id, status, label, program, x, y, w, onClick, say, i }) {
  const octo = kind === "octopus";
  const h = Math.round(w * (octo ? 0.92 : 0.75));
  const working = status === "working", blocked = status === "blocked", done = status === "done";
  // Crabs scuttle sideways while they work; the octopus drifts up and down instead.
  const scuttle = working && !octo ? Math.sin(view.step * 0.9 + i) * Math.max(8, w * 0.18) : 0;
  const art = octo ? "octopus" : done ? "crab-sleep" : "crab";
  const body = div().relative().w(w).h(h)
    .child(image(`mods/harbormaster/${art}.svg`).w(w).h(h).opacity(status === "gone" ? 0.4 : 1))
    .when(!octo && Boolean(program?.icon), (el) => el.child(div().absolute().left(Math.round(w * 0.4)).top(Math.round(h * 0.56)).size(Math.round(w * 0.2))
      .rounded(Math.round(w * 0.1)).bg(sail).border(1.5).border_color("#a8431f").flex().items_center().justify_center()
      .child(icon(program, Math.round(w * 0.13)))));
  if (blocked) body.id(`jump-${id}`).loop("top", { from: 0, to: -Math.round(h * 0.18), period: 800 });
  else if (octo && !done) body.id(`float-${id}`).loop("top", { from: 0, to: -6, period: working ? 1500 : 3200 });
  else if (!done) body.id(`bob-${id}`).loop("top", { from: 0, to: 2, period: 2600 });
  return v_flex().id(`critter-${id}`).absolute().left(x + scuttle).top(y).w(w + 30).items_center().cursor_pointer()
    .transition("left", { duration: 1800, easing: "ease-in-out" })
    .on_click((_e, cx) => { cx.stop_propagation(); onClick?.(); })
    .when(blocked || Boolean(say), (el) => el.child(bubble(say ?? "! needs you")))
    .when(done, (el) => el.child(div().absolute().top(0).right(4).text_size(14).font_weight(700).text_color(sail).child("zzz")))
    .child(body)
    .child(div().max_w(w + 30).truncate().px(5).rounded(4).bg("#173450aa").text_size(11).font_weight(600).text_color(sail).child(label));
}

function reef(view, r, ctx, x, y, w, h, n) {
  const o = orchestratorState(r, ctx.all, ctx.listed);
  const need = needsYou(r, o);
  const workers = r.terminal ? workersOf(r.terminal, ctx.all) : [];
  const prs = prsOf(r) ?? [];
  const planned = Math.max(r.planned ?? 0, r.tasks.length);
  const merged = r.merged ?? r.tasks.filter((t) => t.state === "merged").length;
  const big = Math.min(104, Math.max(70, w * 0.26));
  const small = Math.min(74, Math.max(50, w * 0.17));
  const cols = Math.max(1, Math.floor((w - big - 40) / (small + 24)));
  const focusO = () => r.terminal && o !== "gone" && run("agent.focus", { terminal: r.terminal });
  const crew = workers.map((k, i) => critter(view, {
    kind: "crab", id: k.address, i: i + n * 7, status: workerStatus(k, ctx.listed), w: small,
    label: k.name || k.program?.name || k.address, program: k.program,
    x: big + 36 + (i % cols) * (small + 24), y: 122 + Math.floor(i / cols) * (small * 0.75 + 32),
    onClick: () => run("agent.focus", { terminal: k.address }),
  }));
  const sign = v_flex().absolute().left(12).top(10).max_w(w - 24 - Math.min(prs.length, 4) * 46).px(10).py(4).rounded(5)
    .bg(need ? "#f6c28b" : rope).border(3).border_color(need ? "#c1562c" : "#a07a3f").text_color("#4a3418")
    .child(div().truncate().text_size(13).font_weight(800).child(`\u{1F419} ${r.branch}`))
    .child(div().truncate().text_size(10.5).font_weight(600).child(`${r.repo}${r.machine ? ` · ${r.machine}` : ""} · ${need ? "NEEDS YOU" : r.phase.toUpperCase()}`));
  // Buoys on a line along the bottom of the reef: one per task, lit as it merges.
  const buoys = h_flex().absolute().left(14).bottom(8).gap(8).items_end()
    .children(Array.from({ length: planned }, (_, i) => {
      const task = r.tasks[i];
      const st = task?.state ?? (i < merged ? "merged" : "planned");
      const tone = taskTone(st);
      const c = tone === "done" ? "#3fa66b" : tone === "blocked" ? "#e2553f" : tone ? brass : "#c9cfd4";
      return v_flex().id(`buoy-${r.key}-${i}`).items_center().tooltip(task ? `${task.id} ${task.name}: ${task.state}` : `task ${i + 1}: ${st}`)
        .child(div().w(14).h(16).rounded_t(7).rounded_b(3).bg(c).border(1.5).border_color(deepNavy)
          .child(div().mt(5).h(3).bg(sail))
          .when(tone === "working" || tone === "blocked", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1300 })))
        .child(div().w(2).h(14).bg(deepNavy));
    }))
    .when(planned > 0, (el) => el.child(div().pl(4).pb(1).px(5).rounded(4).bg("#173450aa").text_size(10.5).font_weight(700).text_color(sail).child(`${merged}/${planned} merged`)));
  const flags = h_flex().absolute().right(12).top(8).gap(6)
    .children(prs.map((p, i) => {
      const c = { OPEN: "#3f8fd2", DRAFT: "#9aa1a8", MERGED: "#8256d0", CLOSED: "#c24a3a" }[p.state] ?? "#9aa1a8";
      const fail = p.checks?.fail > 0;
      return v_flex().id(`flag-${r.key}-${i}`).cursor_pointer().tooltip(`${p.title ?? p.url} (${p.state.toLowerCase()}${fail ? ", checks failing" : ""})`)
        .on_click((_e, cx) => { cx.stop_propagation(); openUrl(p.url); })
        .child(h_flex().child(div().w(3).h(40).bg("#dfe6ea"))
          .child(div().self_start().px(5).h(18).flex().items_center().bg(c).rounded_r(3).text_size(10.5).font_weight(700).text_color("#fff")
            .when(fail, (el) => el.border(2).border_color(brass))
            .child(p.number ? `#${p.number}${fail ? " ✗" : p.state === "MERGED" ? " ✓" : ""}` : "PR")));
    }));
  return div().id(`reef-${r.key}`).absolute().left(x).top(y).w(w).h(h).rounded(14)
    .bg(need ? "#f6c28b33" : "#ffffff1a").border(3).border_color(need ? "#f08a5d" : rope).cursor_pointer()
    .hover((s) => s.bg(need ? "#f6c28b55" : "#ffffff2e"))
    .on_click(focusO)
    .child(sign)
    .child(flags)
    .when(Boolean(r.progress), (el) => el.child(div().absolute().left(16).right(16).top(64).truncate().text_size(11.5).italic().text_color(sail).child(`“${r.progress}”`)))
    .child(critter(view, {
      kind: "octopus", id: r.terminal ?? r.key, i: n * 7, status: o === "gone" ? "gone" : need ? "blocked" : o, w: big,
      label: o === "gone" ? "orchestrator (gone)" : "orchestrator", x: 10, y: 114, onClick: focusO,
      say: need ? (r.question ? "? a question for you" : "! needs you") : null,
    }))
    .children(crew)
    .child(buoys);
}

export function harbor(view) {
  // on_size_change reports unzoomed px; everything here is drawn in zoomed px.
  const z = Number(settings()?.zoom) || 1;
  const W = (view.size?.width ?? 1400 * z) / z, H = (view.size?.height ?? 380 * z) / z;
  // The seabed covers the water, anchored at the bottom so the sand stays in view.
  const sea = H - SKY;
  const bw = Math.max(W, sea * (1600 / 420)), bh = bw * (420 / 1600);
  const ctx = { all: terminals(), listed: agents() };
  const runs = view.runs.filter((r) => r.phase !== "finished");
  const cap = captainOf(ctx.all);
  const inRuns = new Set(runs.flatMap((r) => (r.terminal ? [r.terminal, ...workersOf(r.terminal, ctx.all).map((k) => k.address)] : [])));
  const drifters = ctx.listed.filter((a) => !inRuns.has(a.address) && a.address !== cap.terminal?.address);
  const need = runs.filter((r) => needsYou(r, orchestratorState(r, ctx.all, ctx.listed)));
  const capStatus = ctx.listed.find((a) => a.address === cap.terminal?.address)?.status;
  setAgentOrder([cap.terminal?.address, ...inRuns, ...drifters.map((a) => a.address)].filter(Boolean));

  const x0 = 190, x1 = W - (drifters.length ? 170 : 24), top = SKY + 26, bottom = H - 14;
  const n = Math.max(runs.length, 1), gap = 18;
  const rw = Math.max(240, Math.min(520, (x1 - x0 - gap * (n - 1)) / n));
  const total = rw * runs.length + gap * (runs.length - 1);
  const start = x0 + Math.max(0, (x1 - x0 - total) / 2);
  const crabs = runs.reduce((s, r) => s + (r.terminal ? workersOf(r.terminal, ctx.all).length : 0), 0);

  // The captain's boat rides the surface; the anchor is down while the watcher runs.
  const boat = div().id("boat").absolute().left(18).top(SKY - 82).cursor_pointer()
    .when(Boolean(cap.terminal), (el) => el.on_click(() => run("agent.focus", { terminal: cap.terminal.address })))
    .child(div().relative().w(150).h(122).id("boat-rock").loop("top", { from: 0, to: 4, period: 2400 })
      .child(image("mods/harbormaster/captain.svg").w(150).h(122).opacity(cap.terminal ? 1 : 0.45)))
    .when(need.length > 0 && Boolean(cap.terminal), (el) => el.child(div().absolute().top(132).left(4).px(9).py(3).rounded(10).bg(sail).border(2).border_color("#d4553e")
      .text_size(11.5).font_weight(800).text_color("#a3301f").whitespace_nowrap().child(`Ahoy! ${need[0].branch}${need.length > 1 ? ` +${need.length - 1}` : ""}`)))
    .when(Boolean(cap.terminal) && !cap.watching, (el) => el.child(div().absolute().top(10).left(40).text_size(15).font_weight(700).text_color(navy).child("zzz")));
  const chainLen = cap.watching ? Math.max(40, H - SKY - 120) : 26;
  const anchor = v_flex().absolute().left(80).top(SKY + 30).items_center()
    .child(div().w(2).h(chainLen).bg("#1a3550aa"))
    .child(svg("mods/harbormaster/anchor.svg").w(26).h(28).text_color(deepNavy));
  const capSign = v_flex().absolute().left(16).top(SKY + 82).px(10).py(4).rounded(5).bg(rope).border(3).border_color("#a07a3f").text_color("#4a3418")
    .child(div().text_size(12).font_weight(800).child("\u{1F9D1}‍✈️ THE CAPTAIN"))
    .child(div().text_size(10.5).font_weight(600).child(!cap.terminal ? "ashore" : cap.watching ? (capStatus === "working" ? "plotting a course…" : "on watch") : "anchor up, not watching"));

  return div().id("root").relative().size_full().overflow_hidden().bg("#4a9cc2")
    .on_size_change((size, cx) => { view.size = size; cx.notify(); })
    .child(div().absolute().left(0).top(0).w(W).h(SKY).bg("#cfe9f3"))
    .child(image("mods/harbormaster/seabed.svg").absolute().left((W - bw) / 2).top(H - bh).w(bw).h(bh))
    .child(h_flex().absolute().left(0).top(SKY - 12).children(Array.from({ length: Math.ceil(W / 200) + 1 }, () => image("mods/harbormaster/waves.svg").w(200).h(24))))
    .child(div().absolute().right(90).top(14).size(26).rounded(13).bg("#fff3b0"))
    .child(v_flex().absolute().left(186).top(12).gap(2).text_color(ink)
      .child(div().text_size(26).font_weight(800).child("The run harbor"))
      .child(div().text_size(12.5).child(`${runs.length} reef${runs.length === 1 ? "" : "s"}, ${runs.length} octop${runs.length === 1 ? "us" : "i"}, ${crabs} crab${crabs === 1 ? "" : "s"}, ${cap.terminal ? "one captain" : "no captain aboard"}.`)))
    .child(h_flex().absolute().right(130).top(20).gap(16).text_size(12).font_weight(600).text_color(ink)
      .child(div().child(`${runs.length} run${runs.length === 1 ? "" : "s"}`))
      .child(div().text_color(need.length ? "#a3301f" : ink).child(`${need.length} need you`))
      .child(div().child(`${runs.reduce((s, r) => s + (prsOf(r) ?? []).filter((p) => p.state === "OPEN" || p.state === "DRAFT").length, 0)} flags up`)))
    .child(anchor)
    .child(capSign)
    .child(boat)
    .when(runs.length === 0, (el) => el.child(div().absolute().left(x0 + 40).top(top + 60).px(14).py(8).rounded(8).bg("#fbf7eecc").text_size(13).text_color(ink)
      .child("Calm waters. Ask the captain to start a run and a reef shows up here.")))
    .children(runs.map((r, i) => reef(view, r, ctx, start + i * (rw + gap), top, rw, bottom - top, i)))
    .children(drifters.slice(0, 6).map((a, i) => critter(view, {
      kind: "crab", id: a.address, i: 50 + i, status: a.status, w: 54, label: a.tab_name || a.program?.name, program: a.program,
      x: W - 150 + (i % 2) * 70, y: top + 10 + Math.floor(i / 2) * 82, onClick: () => run("agent.focus", { terminal: a.address }),
    })))
    .when(drifters.length > 0, (el) => el.child(div().absolute().right(24).top(top - 20).text_size(10.5).font_weight(700).text_color(sail).child("ADRIFT")));
}

export function rail(view) {
  const s = spaces().find((s) => s.active), tab = s?.tabs.find((t) => t.active);
  return h_flex().size_full().bg(navy).px(20).items_center().justify_between().text_color(sail).text_size(13).font_weight(600)
    .child(div().child(`${s?.name ?? ""}  /  ${tab?.name ?? ""}`))
    .child(h_flex().gap(14).items_center()
      .child(div().id("to-board").text_size(11).px(8).h(20).flex().items_center().rounded(4).bg(deepNavy).cursor_pointer().hover((st) => st.bg("#10253a"))
        .on_click(() => run("layout.switch", { name: "harbormaster-board" })).child("Run board"))
      .child(div().text_size(11).child("BELOW DECK")));
}

export function paneHeader(p) {
  const pane = panes().find((x) => x.pane === p.pane);
  const role = terminals().find((t) => t.address === pane?.terminal)?.labels?.role;
  const who = role === "captain" ? "\u{1F9D1}‍✈️ captain" : role === "orchestrator" ? "\u{1F419} orchestrator" : null;
  return h_flex().size_full().px(12).gap(9).items_center().bg("#d9c39a").text_color("#3b2c17").text_size(12).font_weight(600)
    .child(icon(pane?.program)).child(div().child(pane?.program?.name ?? pane?.title ?? "Terminal"))
    .when(Boolean(who), (el) => el.child(div().px(6).h(17).flex().items_center().rounded(4).bg(sail).text_size(10.5).child(who)))
    .child(div().flex_1()).child(div().child(pane?.status === "blocked" ? "needs you" : pane?.status ?? ""));
}
