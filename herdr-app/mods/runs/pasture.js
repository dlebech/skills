// The fun view: runs as fenced pens in a meadow. The captain is a sheepdog on the
// hill, each orchestrator is the bellwether of its pen, its workers are the flock.
// Fence posts are the run's tasks, flags on the gate are its pull requests.

import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, spaces, panes, run, setAgentOrder, settings } from "herdr";
import { taskTone, prsOf, orchestratorState, workersOf, workerStatus, captainOf, needsYou, openUrl } from "./data.js";

const ink = "#414b34", wood = "#ab7748", darkWood = "#8b5e37", plank = "#d2a673", cream = "#fff9e9", tag = "#f4cc68";
const icon = (p, size = 15) => p?.icon ? (p.tint ? svg(p.icon).text_color(p.color ?? ink) : image(p.icon)).size(size) : div().size(size);
const pose = (s) => (s === "done" ? "sleep" : s === "working" || s === "blocked" ? "sheep" : "graze");

function sheep(view, { id, status, label, program, x, y, w, onClick, bubble, badge, i }) {
  const h = Math.round(w * 0.77);
  const working = status === "working", blocked = status === "blocked", done = status === "done";
  const drift = working ? Math.sin(view.step * 0.8 + i) * Math.max(6, w * 0.12) : 0;
  const body = div().relative().w(w).h(h)
    .child(image(`mods/runs/${pose(status)}.svg`).w(w).h(h))
    .child(div().absolute().left(Math.round(w * (done ? 0.6 : 0.66))).top(Math.round(h * (done ? 0.74 : 0.66))).size(Math.round(w * 0.19)).rounded(5)
      .bg(tag).border(2).border_color("#b68535").flex().items_center().justify_center()
      .child(badge ? div().text_size(Math.round(w * 0.11)).child(badge) : icon(program, Math.round(w * 0.13))));
  if (blocked) body.id(`jump-${id}`).loop("top", { from: 0, to: -Math.round(h * 0.15), period: 850 });
  else if (!working && !done) body.id(`graze-${id}`).loop("top", { from: 0, to: 3, period: 2700 });
  return v_flex().id(`sheep-${id}`).absolute().left(x + drift).top(y).w(w + 30).items_center().cursor_pointer()
    .transition("left", { duration: 4200, easing: "ease-in-out" })
    .on_click((_e, cx) => { cx.stop_propagation(); onClick?.(); })
    .when(blocked || Boolean(bubble), (el) => el.child(div().absolute().top(-26).left(0).px(9).py(3).rounded(10).bg("#fff8e1").border(2).border_color("#d47b3e")
      .text_size(11.5).font_weight(700).text_color("#a44d25").whitespace_nowrap().child(bubble ?? "! needs you")))
    .when(done, (el) => el.child(div().absolute().top(0).right(4).text_size(14).font_weight(700).text_color("#436b5c").child("zzz")))
    .child(body)
    .child(div().max_w(w + 30).truncate().text_size(11).font_weight(600).text_color(ink).child(label));
}

function pen(view, r, ctx, x, y, w, h, n) {
  const o = orchestratorState(r, ctx.all, ctx.listed);
  const need = needsYou(r, o);
  const workers = r.terminal ? workersOf(r.terminal, ctx.all) : [];
  const prs = prsOf(r) ?? [];
  const planned = Math.max(r.planned ?? 0, r.tasks.length);
  const merged = r.merged ?? r.tasks.filter((t) => t.state === "merged").length;
  const big = Math.min(104, Math.max(70, w * 0.26));
  const small = Math.min(78, Math.max(52, w * 0.18));
  const cols = Math.max(1, Math.floor((w - big - 40) / (small + 22)));
  const focusO = () => r.terminal && o !== "gone" && run("agent.focus", { terminal: r.terminal });
  const flock = workers.map((k, i) => sheep(view, {
    id: k.address, i: i + n * 7, status: workerStatus(k, ctx.listed), w: small,
    label: k.name || k.program?.name || k.address, program: k.program,
    x: big + 34 + (i % cols) * (small + 22), y: 100 + Math.floor(i / cols) * (small * 0.77 + 30),
    onClick: () => run("agent.focus", { terminal: k.address }),
  }));
  const sign = v_flex().absolute().left(12).top(10).max_w(w - 24 - Math.min(prs.length, 4) * 46).px(10).py(4).rounded(5)
    .bg(need ? "#f1b67a" : plank).border(3).border_color(need ? "#c1662c" : "#9b6b40").text_color("#573c27")
    .child(div().truncate().text_size(13).font_weight(800).child(`\u{1F419} ${r.branch}`))
    .child(div().truncate().text_size(10.5).font_weight(600).child(`${r.repo}${r.machine ? ` · ${r.machine}` : ""} · ${need ? "NEEDS YOU" : r.phase.toUpperCase()}`));
  const posts = h_flex().absolute().left(14).bottom(8).gap(7).items_end()
    .children(Array.from({ length: planned }, (_, i) => {
      const task = r.tasks[i];
      const st = task?.state ?? (i < merged ? "merged" : "planned");
      const tone = taskTone(st);
      const top = tone === "done" ? "#5d9a3c" : tone === "blocked" ? "#d47b3e" : tone ? tag : "#c9b48f";
      return v_flex().id(`post-${r.key}-${i}`).items_center().gap(1).tooltip(task ? `${task.id} ${task.name}: ${task.state}` : `task ${i + 1}: ${st}`)
        .child(div().size(10).rounded(5).bg(top).border(1.5).border_color(darkWood)
          .when(tone === "working" || tone === "blocked", (el) => el.loop("opacity", { from: 0.4, to: 1, period: 1300 })))
        .child(div().w(8).h(18).bg(wood).border(1.5).border_color(darkWood).rounded_t(2));
    }))
    .when(planned > 0, (el) => el.child(div().pl(4).pb(1).text_size(10.5).font_weight(700).text_color(ink).child(`${merged}/${planned} merged`)));
  const flags = h_flex().absolute().right(12).top(8).gap(6)
    .children(prs.map((p, i) => {
      const c = { OPEN: "#3f8fd2", DRAFT: "#9aa1a8", MERGED: "#8256d0", CLOSED: "#c24a3a" }[p.state] ?? "#9aa1a8";
      const fail = p.checks?.fail > 0;
      return v_flex().id(`flag-${r.key}-${i}`).cursor_pointer().tooltip(`${p.title ?? p.url} (${p.state.toLowerCase()}${fail ? ", checks failing" : ""})`)
        .on_click((_e, cx) => { cx.stop_propagation(); openUrl(p.url); })
        .child(h_flex().child(div().w(3).h(40).bg("#6b4a2b"))
          .child(div().self_start().px(5).h(18).flex().items_center().bg(c).rounded_r(3).text_size(10.5).font_weight(700).text_color("#fff")
            .when(fail, (el) => el.border(2).border_color("#ffd24a"))
            .child(p.number ? `#${p.number}${fail ? " ✗" : p.state === "MERGED" ? " ✓" : ""}` : "PR")));
    }));
  return div().id(`pen-${r.key}`).absolute().left(x).top(y).w(w).h(h).rounded(8)
    .bg(need ? "#f6d9a855" : "#b8dd8a55").border(4).border_color(need ? "#c1662c" : darkWood).cursor_pointer()
    .hover((s) => s.bg(need ? "#f6d9a888" : "#c8e8a088"))
    .on_click(focusO)
    .child(sign)
    .child(flags)
    .when(Boolean(r.progress), (el) => el.child(div().absolute().left(16).right(16).top(58).truncate().text_size(11.5).italic().text_color(ink).child(`“${r.progress}”`)))
    .child(sheep(view, {
      id: r.terminal ?? r.key, i: n * 7, status: o === "gone" ? "done" : need ? "blocked" : o, w: big, badge: "\u{1F419}",
      label: o === "gone" ? "orchestrator (gone)" : "orchestrator", x: 10, y: 92, onClick: focusO,
      bubble: need ? (r.question ? "? a question for you" : "! needs you") : null,
    }))
    .children(flock)
    .child(posts);
}

export function field(view) {
  // on_size_change reports unzoomed px; everything here is drawn in zoomed px.
  const z = Number(settings()?.zoom) || 1;
  const W = (view.size?.width ?? 1400 * z) / z, H = (view.size?.height ?? 380 * z) / z;
  // The meadow covers the field, anchored at the bottom so the hills stay in view.
  const mw = Math.max(W, H * (1600 / 420)), mh = mw * (420 / 1600);
  const ctx = { all: terminals(), listed: agents() };
  const runs = view.runs.filter((r) => r.phase !== "finished");
  const cap = captainOf(ctx.all);
  const inRuns = new Set(runs.flatMap((r) => (r.terminal ? [r.terminal, ...workersOf(r.terminal, ctx.all).map((k) => k.address)] : [])));
  const strays = ctx.listed.filter((a) => !inRuns.has(a.address) && a.address !== cap.terminal?.address);
  const need = runs.filter((r) => needsYou(r, orchestratorState(r, ctx.all, ctx.listed)));
  const capStatus = ctx.listed.find((a) => a.address === cap.terminal?.address)?.status;
  setAgentOrder([cap.terminal?.address, ...runs.flatMap((r) => (r.terminal ? [r.terminal, ...workersOf(r.terminal, ctx.all).map((k) => k.address)] : [])), ...strays.map((a) => a.address)].filter(Boolean));

  const x0 = 200, x1 = W - (strays.length ? 170 : 24), top = 92, bottom = H - 14;
  const n = Math.max(runs.length, 1), gap = 18;
  const pw = Math.max(240, Math.min(520, (x1 - x0 - gap * (n - 1)) / n));
  const total = pw * runs.length + gap * (runs.length - 1);
  const start = x0 + Math.max(0, (x1 - x0 - total) / 2);
  const flockCount = runs.reduce((s, r) => s + (r.terminal ? workersOf(r.terminal, ctx.all).length + 1 : 0), 0);

  const dog = div().id("dog").absolute().left(36).top(H - 140).cursor_pointer()
    .when(Boolean(cap.terminal), (el) => el.on_click(() => run("agent.focus", { terminal: cap.terminal.address })))
    .child(div().relative().w(120).h(110)
      .when(cap.watching, (el) => el.id("dog-bob").loop("top", { from: 0, to: -4, period: 1600 }))
      .child(image("mods/runs/dog.svg").w(120).h(110).opacity(cap.terminal ? 1 : 0.45)))
    .when(need.length > 0 && Boolean(cap.terminal), (el) => el.child(div().absolute().top(-30).left(36).px(9).py(3).rounded(10).bg("#fff8e1").border(2).border_color("#d47b3e")
      .text_size(11.5).font_weight(800).text_color("#a44d25").whitespace_nowrap().child(`Woof! ${need[0].branch}${need.length > 1 ? ` +${need.length - 1}` : ""}`)))
    .when(Boolean(cap.terminal) && !cap.watching, (el) => el.child(div().absolute().top(4).right(-6).text_size(15).font_weight(700).text_color("#436b5c").child("zzz")));
  const capSign = v_flex().absolute().left(22).top(H - 196).px(10).py(4).rounded(5).bg(plank).border(3).border_color("#9b6b40").text_color("#573c27")
    .child(div().text_size(12).font_weight(800).child("⚓ THE CAPTAIN"))
    .child(div().text_size(10.5).font_weight(600).child(!cap.terminal ? "off duty" : cap.watching ? (capStatus === "working" ? "thinking…" : "on watch") : "not watching"));

  return div().id("root").relative().size_full().overflow_hidden()
    .on_size_change((size, cx) => { view.size = size; cx.notify(); })
    .child(image("mods/runs/meadow.svg").absolute().left((W - mw) / 2).top(H - mh).w(mw).h(mh))
    .child(v_flex().absolute().left(24).top(16).gap(2).text_color(ink)
      .child(div().text_size(28).font_weight(800).child("The run pasture"))
      .child(div().text_size(12.5).child(`${runs.length} pen${runs.length === 1 ? "" : "s"}, ${flockCount} sheep, ${cap.terminal ? "one good dog" : "no dog yet"}.`)))
    .child(h_flex().absolute().right(24).top(20).gap(16).text_size(12).font_weight(600).text_color(ink)
      .child(div().child(`${runs.length} run${runs.length === 1 ? "" : "s"}`))
      .child(div().text_color(need.length ? "#a44d25" : ink).child(`${need.length} need you`))
      .child(div().child(`${runs.reduce((s, r) => s + (prsOf(r) ?? []).filter((p) => p.state === "OPEN" || p.state === "DRAFT").length, 0)} flags up`)))
    .child(capSign)
    .child(dog)
    .when(runs.length === 0, (el) => el.child(div().absolute().left(x0 + 40).top(top + 60).px(14).py(8).rounded(8).bg("#fff8e1cc").text_size(13).text_color(ink)
      .child("An empty pasture. Ask the captain to start a run and a pen goes up here.")))
    .children(runs.map((r, i) => pen(view, r, ctx, start + i * (pw + gap), top, pw, bottom - top, i)))
    .children(strays.slice(0, 6).map((a, i) => sheep(view, {
      id: a.address, i: 50 + i, status: a.status, w: 56, label: a.tab_name || a.program?.name, program: a.program,
      x: W - 150 + (i % 2) * 70, y: top + 10 + Math.floor(i / 2) * 82, onClick: () => run("agent.focus", { terminal: a.address }),
    })))
    .when(strays.length > 0, (el) => el.child(div().absolute().right(24).top(top - 22).text_size(10.5).font_weight(700).text_color(ink).child("STRAYS")));
}

export function rail(view) {
  const s = spaces().find((s) => s.active), tab = s?.tabs.find((t) => t.active);
  return h_flex().size_full().bg(wood).px(20).items_center().justify_between().text_color("#fff4d9").text_size(13).font_weight(600)
    .child(div().child(`${s?.name ?? ""}  /  ${tab?.name ?? ""}`))
    .child(h_flex().gap(14).items_center()
      .child(div().id("to-board").text_size(11).px(8).h(20).flex().items_center().rounded(4).bg("#8b5e37").cursor_pointer().hover((st) => st.bg("#7a5030"))
        .on_click(() => run("layout.switch", { name: "runs-board" })).child("Run board"))
      .child(div().text_size(11).child("THE WORKSHED")));
}

export function paneHeader(p) {
  const pane = panes().find((x) => x.pane === p.pane);
  const role = terminals().find((t) => t.address === pane?.terminal)?.labels?.role;
  const who = role === "captain" ? "⚓ captain" : role === "orchestrator" ? "\u{1F419} orchestrator" : null;
  return h_flex().size_full().px(12).gap(9).items_center().bg("#ceab78").text_color("#493724").text_size(12).font_weight(600)
    .child(icon(pane?.program)).child(div().child(pane?.program?.name ?? pane?.title ?? "Terminal"))
    .when(Boolean(who), (el) => el.child(div().px(6).h(17).flex().items_center().rounded(4).bg(cream).text_size(10.5).child(who)))
    .child(div().flex_1()).child(div().child(pane?.status === "blocked" ? "needs you" : pane?.status ?? ""));
}
