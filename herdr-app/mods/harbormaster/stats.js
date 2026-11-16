// The stats view (props().role "stats"): who uses the machine right now, where the time goes
// across runs, and each run's time, tokens, CPU and memory with its tasks and agents.
// Figures come from statsdata.js; nothing here reads a file or runs a command.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { CATEGORIES, cachedTiming, durationText } from "./timing.js";
import { resourcesOf, resourceSnapshot, otherProcesses, memText, HOT } from "./resources.js";
import { summaryOf, mergeRuns, acrossRuns, liveGroups, cachedHistory, catTotal, addCats, isRunProp,
  liveTable, groupProcesses, hottest, hottestText, timeSplit, recentRuns, RECENT, QUIET_CPU } from "./statsdata.js";
import { facts, orchestratorsOf, workersOf, captainOf } from "./live.js";
import { props } from "herdr";
import { tokenText, tokenShort, tokenHeadline, tokenDetail } from "./context.js";
import { runName, typeTag, ago, plural } from "./ui.js";

// Each category's colour, from the theme, so light and dark both work; idle is the track's.
const COLOR = {
  model: (t) => t.accent, test: (t) => t.ansi2, lint: (t) => t.ansi3, build: (t) => t.ansi5, install: (t) => t.ansi6,
  // agent_wait is usually the biggest part, so it gets a colour far from model's accent.
  ci_wait: (t) => t.ansi4, agent_wait: (t) => t.ansi13 ?? t.ansi5, review: (t) => t.ansi1, git: (t) => t.ansi11 ?? t.ansi3,
  user_wait: (t) => t.blocked, other: (t) => t.muted, idle: (t) => t.border,
};
const LABEL = { ...Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])), idle: "idle" };
const ORDER = [...CATEGORIES.map((c) => c.key), "idle"];
const colorOf = (t, k) => (COLOR[k]?.(t) ?? t.dim);

const cpuText = (s) => (s == null ? "—" : s >= 3600 ? `${(s / 3600).toFixed(1)} CPU h` : s >= 60 ? `${Math.round(s / 60)} CPU min` : `${Math.round(s)} CPU s`);
const mbText = (mb) => (mb == null ? "—" : memText(mb * 1024));
const sorted = (m) => ORDER.filter((k) => (m[k] ?? 0) > 0).map((k) => [k, m[k]]);

// The view's type: one step up from Harbormaster's 11 px rows, so figures read at a glance.
// Side notes stay small and dim; numbers are full-strength and right-aligned in fixed columns
// (the font has no tabular digits), so they line up.
const TITLE = 14, BODY = 12.5, NOTE = 11.5, BIG = 20;
const figure = (t, w, text, color) => div().flex_none().w(w).text_right().whitespace_nowrap().text_color(color ?? t.foreground).child(text);
const note = (t, text) => div().text_size(NOTE).text_color(t.dim).child(text);

const cpuShort = (s) => (s == null ? "—" : s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
const CORE_TIP = "CPU %: 100% is one core, so a busy machine can show several hundred";

// A stacked bar of a category map, biggest first, idle left out; each part's label, time and
// share of the working time on hover. With `scale` (0..1) the bar is that wide on its track.
function catBar(t, id, m, h = 8, scale = 1) {
  const split = timeSplit(m);
  return h_flex().flex_1().min_w(0).h(h).rounded(3).overflow_hidden().bg(t.raised)
    .child(h_flex().h_full().w(`${(100 * scale).toFixed(2)}%`)
      .children(split.parts.map((p) => div().id(`${id}-${p.key}`).h_full().w(`${p.pct.toFixed(2)}%`).bg(colorOf(t, p.key))
        .tooltip(`${LABEL[p.key] ?? p.key}: ${durationText(p.secs)} · ${Math.round(p.pct)}% of the working time`))));
}

// The legend: the four biggest categories of 1% or more, biggest first; the rest on hover.
function legend(t, id, m) {
  const split = timeSplit(m);
  const item = (p) => h_flex().id(`${id}-l-${p.key}`).gap(5).items_center().text_size(NOTE + 0.5)
    .child(div().size(9).rounded(2).bg(colorOf(t, p.key)))
    .child(div().text_color(t.muted).child(LABEL[p.key] ?? p.key))
    .child(div().text_color(t.foreground).font_semibold().child(`${Math.round(p.pct)}%`))
    .child(div().text_color(t.muted).child(durationText(p.secs)));
  return h_flex().flex_wrap().gap_x(14).gap_y(3).px(2).items_center()
    .children(split.shown.map(item))
    .when(split.hidden.length > 0, (el) => el.child(div().id(`${id}-l-more`).text_size(NOTE).text_color(t.dim)
      .tooltip(split.hidden.map((p) => `${LABEL[p.key] ?? p.key}: ${durationText(p.secs)} · ${p.pct < 1 ? "under 1%" : `${Math.round(p.pct)}%`}`).join("\n"))
      .child(`+${split.hidden.length} more`)));
}

// A small CPU bar for the live table, 100% (one core) or the busiest row filling it.
function cpuBar(t, cpu, max, sum = false) {
  return div().flex_1().min_w(30).max_w(160).h(6).rounded(3).bg(t.raised).overflow_hidden()
    .child(div().h_full().rounded(3).bg(!sum && cpu >= HOT.cpu ? t.working : t.accent).w(`${Math.min(100, (100 * cpu) / max).toFixed(2)}%`)
      .when(cpu >= QUIET_CPU, (el) => el.min_w(2)));
}

// A collapsible section: its title, what it sums up on the right (a string or an element),
// and its body unless folded.
function section(view, t, id, title, side, body) {
  const shut = view.statsShut?.has(id);
  return v_flex().id(`sec-${id}`).flex_none().gap(8).p(12).rounded(10).bg(t.surface)
    .child(h_flex().id(`sec-${id}-h`).gap(8).items_center().cursor_pointer().text_size(TITLE).font_semibold().text_color(t.foreground)
      .on_click((_e, cx) => { view.statsShut ??= new Set(); if (shut) view.statsShut.delete(id); else view.statsShut.add(id); cx.notify(); })
      .child(svg(`mods/harbormaster/chevron-${shut ? "right" : "down"}.svg`).size(12).text_color(t.dim))
      .child(title)
      .child(div().flex_1())
      .when(side != null && side !== "", (el) => el.child(typeof side === "string" ? div().font_normal().text_size(NOTE).text_color(t.dim).child(side) : side)))
    .when(!shut, (el) => el.child(body()));
}

// A small toggle among choices, the chosen one raised.
function choice(t, id, options, value, set) {
  return h_flex().gap(2).children(options.map(([v, label]) => div().id(`${id}-${v}`).px(7).h(20).rounded(4).flex().items_center()
    .text_size(NOTE).cursor_pointer().bg(v === value ? t.raised : t.surface).text_color(v === value ? t.foreground : t.muted)
    .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { cx.stop_propagation(); set(v, cx); }).child(label)));
}

// A line that folds or unfolds something, in the live table's columns: "› 6 quiet runs: a, b"
// with their CPU and memory together.
function foldLine(view, t, id, open, text, cpu, rssKb, indent = 0) {
  return h_flex().id(id).gap(10).items_center().h(22).pl(indent).text_size(BODY).cursor_pointer()
    .on_click((_e, cx) => { view.statsOpen ??= new Set(); if (open) view.statsOpen.delete(id); else view.statsOpen.add(id); cx.notify(); })
    .child(h_flex().flex_none().w(230 - indent).gap(5).items_center()
      .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().flex_none().text_color(t.foreground).child(text)))
    .child(figure(t, 48, `${Math.round(cpu)}%`, t.muted))
    .child(div().flex_1().min_w(30).max_w(160))
    .child(figure(t, 60, memText(rssKb), t.muted));
}

// ---- the Now line ----

function nowLine(t, live) {
  const h = live.hot;
  const big = (text, unit, tip, id) => h_flex().id(id).gap(5).items_baseline().tooltip(tip)
    .child(div().text_size(BIG).font_semibold().text_color(t.foreground).child(text))
    .child(div().text_size(BODY).text_color(t.muted).child(unit));
  return h_flex().flex_none().gap(22).px(14).py(10).mx(10).rounded(10).bg(t.surface).items_center().flex_wrap()
    // Before the first sample (memory) and the first rated one (CPU), no figure is better than 0.
    .child(big(live.rated ? `${Math.round(live.cpu)}%` : "—", "CPU in agents", CORE_TIP, "now-cpu"))
    .child(big(live.snap.at ? memText(live.rssKb) : "—", "memory in agents", "Memory of every agent terminal and what it started", "now-mem"))
    .child(h_flex().flex_1().min_w(0).gap(6).items_baseline().text_size(TITLE)
      .child(!live.rated ? div().text_color(t.muted).child("sampling…") : h ? h_flex().items_baseline()
        .child(div().text_color(t.muted).child("Hottest:\u00a0"))
        .child(div().font_semibold().text_color(h.cpu >= HOT.cpu ? t.working : t.foreground).child(`${h.name} ${Math.round(h.cpu)}%`))
        .when(Boolean(h.mostly), (el) => el.child(div().text_color(t.muted).child(`,\u00a0mostly ${h.mostly}`)))
        : div().text_color(t.muted).child(hottestText(null)))
      .when(Boolean(live.outside), (el) => el.child(div().text_size(NOTE).text_color(t.dim)
        .child(`· outside the agents: ${live.outside.name} ${Math.round(live.outside.cpu)}%`))));
}

// ---- across runs ----

function across(view, t, data) {
  const by = view.statsBy ?? "all";
  const groups = data.across[by] ??= acrossRuns(data.runs, by);
  const all = (data.across.all ??= acrossRuns(data.runs, "all"))[0];
  const split = all ? timeSplit(all.critical_path) : null;
  const side = all ? h_flex().gap(8).items_baseline().font_normal()
    .child(div().text_size(BODY + 0.5).text_color(t.foreground).child(`${durationText(split.working)} working`))
    .child(div().text_size(BODY).text_color(t.muted).child(`· ${durationText(split.idle)} idle`))
    .child(div().text_size(NOTE).text_color(t.dim).child(`· ${plural(all.runs, "run")}`)) : null;
  return section(view, t, "across", "Where the time goes", side, () => {
    if (!all) return div().px(2).text_size(BODY).text_color(t.dim).child("No run's time read yet.");
    const work = (g) => timeSplit(g.critical_path).working;
    const max = Math.max(...groups.map(work));
    return v_flex().gap(8)
      .child(h_flex().gap(8).items_center().px(2)
        .child(div().id("across-what").flex_1().text_size(NOTE).text_color(t.dim)
          .tooltip("The orchestrators' wall time by what it went to. Idle (waiting for nothing) is left out of the bar.")
          .child("What the runs' wall time went to, idle left out"))
        .child(choice(t, "by", [["all", "All"], ["folder", "By repo"], ["type", "By type"]], by, (v, cx) => { view.statsBy = v; cx.notify(); })))
      .when(by === "all", (el) => el.child(catBar(t, "across-all", all.critical_path, 14)))
      .when(by !== "all", (el) => el.children(groups.map((g) => h_flex().id(`grp-${g.group}`).gap(10).items_center().px(2).h(22).text_size(BODY)
        .child(div().flex_none().w(130).truncate().text_color(t.foreground).child(g.group))
        .child(div().flex_none().w(50).text_color(t.muted).child(plural(g.runs, "run")))
        .child(catBar(t, `grp-${g.group}-bar`, g.critical_path, 10, max > 0 ? work(g) / max : 0))
        .child(figure(t, 64, durationText(work(g)))))))
      .child(legend(t, "across", all.critical_path));
  });
}

// ---- runs ----

// The runs table's columns, shared by its header and rows.
const COL = { tag: 36, wall: 62, tokens: 104, cpu: 62, mem: 88 };

function runHeader(t) {
  const h = (w, text) => div().flex_none().w(w).text_right().whitespace_nowrap().child(text);
  return h_flex().gap(10).px(8).h(18).items_center().text_size(NOTE).text_color(t.dim)
    .child(div().flex_none().w(11)).child(div().flex_none().w(COL.tag))
    .child(div().flex_1().min_w(80).max_w(320).child("run"))
    .child(h(COL.wall, "wall time"))
    .child(div().flex_1().min_w(60).child("where it went"))
    .child(div().id("runs-h-tok").flex_none().w(COL.tokens).text_right().tooltip("Fresh tokens (input, output, cache writes), then + the cache reads, billed at about a tenth").child("tokens"))
    .child(div().id("runs-h-cpu").flex_none().w(COL.cpu).text_right().tooltip("CPU time of all its agents together").child("CPU"))
    .child(h(COL.mem, "memory peak"));
}

function runRow(view, t, s) {
  const open = view.statsOpen?.has(s.key);
  const toggle = (cx) => { view.statsOpen ??= new Set(); if (open) view.statsOpen.delete(s.key); else view.statsOpen.add(s.key); cx.notify(); };
  const name = runName(s.branch, s.topic);
  const when = Date.parse(s.started ?? "") || null;
  const meta = [s.live ? "open" : s.source === "history" ? "closed" : "put away", s.machine, when ? `started ${ago(when)}` : null,
    s.tasks_planned ? `${s.tasks_merged ?? 0}/${s.tasks_planned} tasks` : null].filter(Boolean).join(" · ");
  const res = s.resources;
  const split = timeSplit(s.critical_path);
  // A run whose orchestrator's session was not found has a wall time and nothing to split it by.
  const bar = !s.timed ? note(t, "reading…") : !split.working ? note(t, "no time data yet")
    : h_flex().id(`run-${s.key}-bar`).w_full().items_center().tooltip(`${durationText(split.working)} working · ${durationText(Math.max(0, s.wall - split.working))} idle`)
      .child(catBar(t, `run-${s.key}-cp`, s.critical_path, 8, s.wall > 0 ? Math.min(1, split.working / s.wall) : 1));
  const head = h_flex().id(`run-${s.key}`).gap(10).items_center().h(26).cursor_pointer().text_size(BODY).on_click((_e, cx) => toggle(cx))
    .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
    .child(div().flex_none().w(COL.tag).child(s.type ? typeTag(t, s.type) : div()))
    .child(h_flex().id(`run-${s.key}-n`).flex_1().min_w(80).max_w(320).gap(6).items_baseline().tooltip([name.tip, meta].filter(Boolean).join("\n"))
      .child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child(name.title))
      .child(div().flex_none().text_size(NOTE).text_color(s.live ? t.muted : t.dim).child(s.live ? "open" : when ? ago(when) : "")))
    .child(figure(t, COL.wall, s.timed ? durationText(s.wall) : "—"))
    .child(div().flex_1().min_w(60).child(bar))
    .child(s.tokens ? div().id(`run-${s.key}-tok`).flex_none().w(COL.tokens).text_right().whitespace_nowrap().text_color(t.foreground)
      .tooltip(tokenDetail(s.tokens)).child(tokenShort(s.tokens)) : figure(t, COL.tokens, "—", t.dim))
    .child(div().id(`run-${s.key}-cpu`).flex_none().w(COL.cpu).text_right().text_color(res ? t.foreground : t.dim)
      .tooltip(res ? `CPU ${cpuText(res.cpu_s)}${res.estimated ? " (estimated: macOS)" : ""}, all its agents together` : "No CPU recorded for this run")
      .child(res ? cpuShort(res.cpu_s) : "—"))
    .child(div().id(`run-${s.key}-mem`).flex_none().w(COL.mem).text_right().text_color(res?.peak_rss_mb != null ? t.foreground : t.dim)
      .tooltip(res ? `Memory peak ${mbText(res.peak_rss_mb)}, average ${mbText(res.avg_rss_mb)} (all its agents together)` : "No memory recorded for this run")
      .child(res ? mbText(res.peak_rss_mb) : "—"));
  return v_flex().id(`runbox-${s.key}`).gap(4).px(8).py(2).rounded(7).bg(open ? t.raised + "66" : t.background + "00")
    .hover((st) => (open ? st : st.bg(t.raised + "33")))
    .child(head)
    .when(open, (el) => el.child(runDetail(view, t, s)));
}

function runDetail(view, t, s) {
  const res = s.resources;
  const progs = Object.entries(res?.programs ?? {}).filter(([, p]) => p.cpu_s >= 0.5).sort((a, b) => b[1].cpu_s - a[1].cpu_s).slice(0, 6);
  const effort = catTotal(s.categories);
  const split = timeSplit(s.critical_path);
  const line = (text) => div().text_size(NOTE + 0.5).text_color(t.muted).child(text);
  return v_flex().gap(6).pl(21 + COL.tag).pt(2).pb(8)
    .when(split.working > 0, (el) => el.child(legend(t, `run-${s.key}`, s.critical_path)))
    .when(!s.timed, (el) => el.child(line("Its time is being read from its session logs…")))
    .when(s.timed && split.working > 0, (el) => el.child(line(`Wall time ${durationText(s.wall)}: ${durationText(split.working)} working, ${durationText(Math.max(0, s.wall - split.working))} idle`)))
    .when(effort > 0, (el) => el.child(line(`Effort: ${durationText(effort)} of agent time (agents work in parallel, so more than the wall time)`)))
    .when(Boolean(s.tokens), (el) => el.child(line(`Tokens: ${tokenHeadline(s.tokens)}, ${tokenText(s.tokens.total)} in total`)))
    .when(Boolean(res), (el) => el.child(line(`CPU time ${cpuShort(res.cpu_s)}${res.estimated ? " (estimated)" : ""} · memory peak ${mbText(res.peak_rss_mb)}, average ${mbText(res.avg_rss_mb)}`
      + (progs.length ? ` · ${progs.map(([k, p]) => `${k} ${cpuShort(p.cpu_s)}`).join(", ")}` : ""))))
    .child(v_flex().gap(2).children(s.tasks.map((k) => taskRow(view, t, s, k))))
    .when(s.tasks.length > 0 && s.agents.some((a) => !a.task), (el) => el.child(othersRow(view, t, s)))
    .when(s.tasks.length === 0 && s.agents.length > 0, (el) => el.children(s.agents.map((a, i) => agentRow(t, `${s.key}-a${i}`, a))));
}

// A task's (or the others') line: name, a bar of its time, its time, CPU and memory peak.
function subRow(view, t, key, label, cats, total, cpu, peak, body) {
  const open = view.statsOpen?.has(key);
  return v_flex().gap(2)
    .child(h_flex().id(`task-${key}`).gap(10).items_center().h(22).text_size(BODY).cursor_pointer()
      .on_click((_e, cx) => { view.statsOpen ??= new Set(); if (open) view.statsOpen.delete(key); else view.statsOpen.add(key); cx.notify(); })
      .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(10).flex_none().text_color(t.dim))
      .child(div().flex_none().w(90).truncate().text_color(t.foreground).child(label))
      .child(div().flex_1().min_w(40).child(catBar(t, `task-${key}-bar`, cats, 6)))
      .child(figure(t, 60, durationText(total)))
      .child(figure(t, COL.cpu, cpu == null ? "" : cpuShort(cpu)))
      .child(figure(t, COL.mem, cpu == null ? "" : mbText(peak))))
    .when(open, (el) => el.child(body()));
}

function taskRow(view, t, s, k) {
  const key = `${s.key}#${k.id}`;
  const agents = s.agents.filter((a) => a.task === k.id);
  return subRow(view, t, key, k.id, k.categories, k.total, k.cpu_s, k.peak_rss_mb, () => v_flex().gap(2).pl(20)
    .child(legend(t, `task-${key}`, k.categories))
    .children(agents.map((a, i) => agentRow(t, `${key}-a${i}`, a))));
}

// The agents no task owns: the orchestrator (first), the final reviewer and fixer, and the jobs the
// orchestrator started with hc run. Without this row their time, CPU and memory show only in the run's totals.
function othersRow(view, t, s) {
  const key = `${s.key}#others`;
  const agents = s.agents.filter((a) => !a.task).sort((a, b) => (b.role === "orchestrator") - (a.role === "orchestrator"));
  const sum = (f) => agents.reduce((n, a) => n + (a[f] ?? 0), 0);
  const cpu = agents.some((a) => a.cpu_s != null) ? sum("cpu_s") : null;
  const peak = Math.max(0, ...agents.map((a) => a.peak_rss_mb ?? 0));
  const cats = agents.reduce((m, a) => addCats(m, a.categories), {});
  return subRow(view, t, key, "Others", cats, catTotal(cats), cpu, peak, () => v_flex().gap(2).pl(20)
    .child(note(t, "Orchestrator, final review and fixes, and jobs it started"))
    .children(agents.map((a, i) => agentRow(t, `${key}-a${i}`, a))));
}

function agentRow(t, id, a) {
  const top = sorted(a.categories).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c, v]) => `${LABEL[c] ?? c} ${durationText(v)}`).join(", ");
  return h_flex().id(`ag-${id}`).gap(10).items_center().h(20).text_size(NOTE + 0.5)
    .tooltip([a.label ?? a.name, a.kind, top].filter(Boolean).join(" · "))
    .child(div().flex_none().w(36).text_color(t.dim).child(a.role ?? ""))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(a.label ?? a.name))
    .child(figure(t, 60, a.total ? durationText(a.total) : "—", t.muted))
    .child(figure(t, COL.cpu, a.cpu_s == null ? "" : cpuShort(a.cpu_s), t.muted))
    .child(figure(t, COL.mem, a.cpu_s == null ? "" : mbText(a.peak_rss_mb), t.muted));
}

// The newest RECENT runs are rows; the rest behind "+ N older runs", so the list stays short
// and drawing stays bounded as the history grows.
function runsSection(view, t, runs) {
  const reading = runs.filter((s) => !s.timed).length;
  const { rows, older } = recentRuns(runs, view.statsAll);
  return section(view, t, "runs", "Runs", [plural(runs.length, "run"), reading ? `reading ${reading}` : null].filter(Boolean).join(" · "), () =>
    v_flex().gap(1)
      .when(runs.length > 0, (el) => el.child(runHeader(t)))
      .children(rows.map((s) => runRow(view, t, s)))
      .when(older > 0 || (view.statsAll && runs.length > RECENT), (el) => el.child(div().id("runs-more").px(8).h(26).flex().items_center()
        .text_size(BODY).text_color(t.muted).cursor_pointer().hover((st) => st.text_color(t.foreground))
        .on_click((_e, cx) => { view.statsAll = !view.statsAll; cx.notify(); })
        .child(older > 0 ? `+ ${plural(older, "older run")}` : `Show the newest ${RECENT} only`)))
      .when(runs.length === 0, (el) => el.child(div().px(2).text_size(BODY).text_color(t.dim).child("No runs yet."))));
}

// ---- live CPU and memory ----

// The live figures, worked out once per draw: the groups as liveGroups gives them, the table's
// shape, the processes outside the agents, the totals and the hottest agent.
function liveData() {
  const ctx = facts();
  const snap = resourceSnapshot();
  const nameOf = (address) => ctx.terminals.find((x) => x.address === address)?.name || address;
  const crews = [];
  const cap = captainOf(ctx).terminal;
  if (cap) crews.push({ title: "Captain", root: cap.address, name: "captain", members: workersOf(cap.address, ctx).map((w) => ({ address: w.address, name: w.name })) });
  for (const o of orchestratorsOf(ctx)) {
    crews.push({ title: o.labels?.["run.topic"] || o.name || o.address, root: o.address, name: "orchestrator",
      members: workersOf(o.address, ctx).map((w) => ({ address: w.address, name: w.name })) });
  }
  const names = Object.fromEntries(Object.keys(snap.terminals ?? {}).map((a) => [a, nameOf(a)]));
  const groups = liveGroups(crews, snap, names);
  const procs = groupProcesses(otherProcesses());
  const hot = hottest(groups);
  const topOther = procs.busy[0];
  return {
    snap, groups, table: liveTable(groups), procs, hot,
    rated: Object.values(snap.machines ?? {}).some((m) => m.rated),
    cpu: groups.reduce((n, g) => n + g.cpu, 0), rssKb: groups.reduce((n, g) => n + g.rssKb, 0),
    // Something outside the agents busier than the hottest of them is named too.
    outside: topOther && topOther.cpu >= QUIET_CPU && topOther.cpu > (hot?.cpu ?? 0) ? topOther : null,
  };
}

// What a terminal's CPU goes to, its programs of 1% or more: "lint 128%, browser ×3 12%".
// The agent's own process is in it too, as the Now line's "mostly the agent itself" counts it.
const progText = (r) => [...(r.own ? [{ name: "the agent itself", cpu: r.own.cpu, count: 1 }] : []), ...r.programs]
  .filter((g) => g.cpu >= QUIET_CPU).sort((a, b) => b.cpu - a.cpu).slice(0, 3)
  .map((g) => `${g.name}${g.count > 1 ? ` ×${g.count}` : ""} ${Math.round(g.cpu)}%`).join(", ");

function liveSection(view, t, live) {
  const { snap, table, procs } = live;
  const max = Math.max(100, ...live.groups.flatMap((g) => [g.cpu, ...g.rows.map((r) => r.cpu)]), ...procs.busy.map((p) => p.cpu));
  // One line of the table: name, CPU % and its bar, memory, and what it is busy with.
  const line = (id, name, cpu, rssKb, detail, tip, { head = false, indent = 0, sum = head } = {}) => h_flex().id(id).gap(10).items_center().h(head ? 24 : 21).pl(indent)
    .text_size(head ? BODY + 0.5 : BODY)
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .child(div().flex_none().w(230 - indent).truncate().when(head, (el) => el.font_semibold()).text_color(head ? t.foreground : t.muted).child(name))
    // A group's line sums several terminals, so only single ones are marked hot.
    .child(figure(t, 48, `${Math.round(cpu)}%`, !sum && cpu >= HOT.cpu ? t.working : t.foreground))
    .child(cpuBar(t, cpu, max, sum))
    .child(figure(t, 60, memText(rssKb), !sum && rssKb >= HOT.rssKb ? t.working : t.foreground))
    .child(div().flex_1().min_w(0).truncate().text_size(NOTE + 0.5).text_color(t.muted).child(detail ?? ""));
  const rowTip = (r) => [`${r.name} (${[r.term !== r.name ? r.term : null, r.address].filter(Boolean).join(", ")})`, r.own ? `the agent itself: ${Math.round(r.own.cpu)}% · ${memText(r.own.rssKb)}` : null,
    ...r.programs.map((g) => `${g.name}${g.count > 1 ? ` ×${g.count}` : ""}: ${Math.round(g.cpu)}% · ${memText(g.rssKb)}`)].filter(Boolean).join("\n");
  const group = (g, gi) => [
    line(`lg-${gi}`, g.title, g.cpu, g.rssKb, g.solo ? progText(g.solo) : null, g.solo ? rowTip(g.solo) : null, { head: true, sum: !g.solo }),
    ...g.rows.map((r) => line(`lr-${r.address}`, r.name, r.cpu, r.rssKb, progText(r), rowTip(r), { indent: 14 })),
    ...(g.hidden ? [div().pl(14).h(20).flex().items_center().text_size(NOTE).text_color(t.dim)
      .child(`+${g.hidden.count} idle ${g.hidden.count === 1 ? "terminal" : "terminals"}: ${Math.round(g.hidden.cpu)}% · ${memText(g.hidden.rssKb)} together`)] : []),
  ];
  const quietOpen = view.statsOpen?.has("live-quiet"), otherOpen = view.statsOpen?.has("live-quiet-other");
  const proc = (p) => line(`lo-${p.machine ?? ""}-${p.name}`, p.count > 1 ? `${p.name} ×${p.count}` : p.name, p.cpu, p.rssKb,
    [p.program !== p.name ? p.program : null, p.machine].filter(Boolean).join(" · "),
    `${p.name}: ${plural(p.count, "process", "processes")} (pid ${p.pids.join(", ")})`, { indent: 14 });
  const rated = live.rated;
  const other = [...procs.busy, ...(procs.quiet?.items ?? [])];
  return section(view, t, "live", "CPU and memory now", snap.at ? `sampled ${ago(snap.at)}` : null, () =>
    v_flex().gap(1)
      .when(!rated, (el) => el.child(note(t, "CPU % needs two polls, a few seconds; memory shows at once.")))
      .child(h_flex().id("live-h").gap(10).h(18).items_center().text_size(NOTE).text_color(t.dim).tooltip(CORE_TIP)
        .child(div().flex_none().w(230)).child(div().flex_none().w(48).text_right().child("CPU"))
        .child(div().flex_1().min_w(30).max_w(160)).child(div().flex_none().w(60).text_right().child("memory")))
      .children(table.groups.flatMap(group))
      .when(Boolean(table.quiet), (el) => el
        .child(foldLine(view, t, "live-quiet", quietOpen, plural(table.quiet.count, "quiet run"), table.quiet.cpu, table.quiet.rssKb)
          .child(div().flex_1().min_w(0).truncate().text_size(NOTE + 0.5).text_color(t.muted).child(`under 1% CPU each: ${table.quiet.names.join(", ")}`)))
        .when(quietOpen, (e2) => e2.children(table.quiet.items.flatMap((g, i) => group(g, `q${i}`)))))
      .when(other.length > 0, (el) => el
        .child(line("lg-other", "Other processes", other.reduce((n, p) => n + p.cpu, 0), other.reduce((n, p) => n + p.rssKb, 0), "outside every agent: the browser, Herdr itself, …", null, { head: true }))
        .children(procs.busy.map(proc))
        .when(Boolean(procs.quiet), (e2) => e2
          .child(foldLine(view, t, "live-quiet-other", otherOpen, plural(procs.quiet.count, "quiet one"), procs.quiet.cpu, procs.quiet.rssKb, 14)
            .child(div().flex_1().min_w(0).truncate().text_size(NOTE + 0.5).text_color(t.muted).child(`under 1% CPU each: ${procs.quiet.names.join(", ")}`)))
          .when(otherOpen, (e3) => e3.children(procs.quiet.items.map(proc)))))
      .when(live.groups.length === 0 && other.length === 0, (el) => el.child(div().px(2).text_size(BODY).text_color(t.dim).child("No sample yet (Linux and macOS only)."))));
}

// ---- the view ----

// Every run's figures: open runs from their timing and resources, past runs from the history.
// Worked out again only when what they come from changed: the runs, the history, or a run's
// timing (a new object when it changes) or resources (a new sample), not on every redraw. `across` holds
// the sums across runs, by grouping, filled as they are drawn.
export function statsRuns(view) {
  // .resources.json is parsed again on every poll, so it counts by its sample time, not by object.
  const refs = [view.runs, cachedHistory(), ...view.runs.flatMap((r) => [cachedTiming(r), resourcesOf(r)?.sampled_ms])];
  const memo = view.statsMemo;
  if (memo && memo.refs.length === refs.length && memo.refs.every((x, i) => x === refs[i])) return memo.data;
  const open = view.runs.map((r) => summaryOf(r, cachedTiming(r), resourcesOf(r)));
  const data = { runs: mergeRuns(open, cachedHistory()), across: {} };
  view.statsMemo = { refs, data };
  return data;
}

// props().run, a run directory: that run first and open, with its tasks open, once each (so
// they can still be folded by hand). For opening the view on one run, and for screenshots.
function focusRun(view, runs) {
  const dir = props()?.run;
  if (!dir) return runs;
  const mine = runs.filter((s) => isRunProp(s, dir));
  view.statsOpen ??= new Set();
  view.statsFocused ??= new Set();
  const open = (key) => { if (!view.statsFocused.has(key)) { view.statsFocused.add(key); view.statsOpen.add(key); } };
  for (const s of mine) { open(s.key); for (const k of s.tasks) open(`${s.key}#${k.id}`); }
  return [...mine, ...runs.filter((s) => !mine.includes(s))];
}

// Top to bottom it answers: is anything hot right now (the Now line and the live table), where
// does the time go, and what did each run cost.
export function statsView(view, t) {
  const data = statsRuns(view);
  const runs = focusRun(view, data.runs);
  const live = liveData();
  const focused = Boolean(props()?.run);
  return v_flex().id("stats").size_full().min_h(0).bg(t.canvas ?? t.chrome).text_size(BODY)
    .child(h_flex().flex_none().px(14).pt(12).pb(8).gap(10).items_baseline()
      .child(div().text_size(TITLE + 2).font_semibold().text_color(t.foreground).child("Stats"))
      .child(div().text_size(NOTE).text_color(t.dim).child("time, tokens, CPU and memory, from the logs runs already leave")))
    .child(nowLine(t, live))
    .child(v_flex().id("stats-list").flex_1().min_h(0).px(10).pt(8).pb(12).gap(8).overflow_y_scrollbar()
      // Opened on one run, the runs come before the live table, so that run is in view.
      .when(!focused, (el) => el.child(liveSection(view, t, live)))
      .child(across(view, t, data))
      .child(runsSection(view, t, runs))
      .when(focused, (el) => el.child(liveSection(view, t, live))));
}
