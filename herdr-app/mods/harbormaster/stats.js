// The stats view (props().role "stats"): where the time goes across runs, each run's time,
// tokens, CPU and memory with its tasks and agents, and who uses the machine right now.
// Figures come from statsdata.js; nothing here reads a file or runs a command.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { CATEGORIES, cachedTiming, durationText } from "./timing.js";
import { resourcesOf, resourceSnapshot, otherProcesses, memText } from "./resources.js";
import { summaryOf, mergeRuns, acrossRuns, liveGroups, cachedHistory, tokenParts, catTotal } from "./statsdata.js";
import { facts, orchestratorsOf, workersOf, captainOf } from "./live.js";
import { tokenText } from "./context.js";
import { runName, withTip, typeTag, ago, plural } from "./ui.js";

// Each category's colour, from the theme, so light and dark both work; idle is the track's.
const COLOR = {
  model: (t) => t.accent, test: (t) => t.ansi2, lint: (t) => t.ansi3, build: (t) => t.ansi5, install: (t) => t.ansi6,
  ci_wait: (t) => t.ansi4, agent_wait: (t) => t.ansi12 ?? t.ansi4, review: (t) => t.ansi13 ?? t.ansi5, git: (t) => t.ansi11 ?? t.ansi3,
  user_wait: (t) => t.blocked, other: (t) => t.muted, idle: (t) => t.border,
};
const LABEL = { ...Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])), idle: "idle" };
const ORDER = [...CATEGORIES.map((c) => c.key), "idle"];
const colorOf = (t, k) => (COLOR[k]?.(t) ?? t.dim);
// Token bars: fresh tokens (input, output, cache writes) blue, cache reads green.
const FRESH = (t) => t.ansi4, CACHED = (t) => t.ansi2;

const pct = (part, whole) => (whole > 0 ? (100 * part) / whole : 0);
const pctText = (part, whole) => `${Math.round(pct(part, whole))}%`;
const cpuText = (s) => (s == null ? "—" : s >= 3600 ? `${(s / 3600).toFixed(1)} CPU h` : s >= 60 ? `${Math.round(s / 60)} CPU min` : `${Math.round(s)} CPU s`);
const mbText = (mb) => (mb == null ? "—" : memText(mb * 1024));
const sorted = (m) => ORDER.filter((k) => (m[k] ?? 0) > 0).map((k) => [k, m[k]]);

// A stacked bar of a category map, each part's label, time and share on hover.
function catBar(t, id, m, h = 8) {
  const total = catTotal(m);
  return h_flex().flex_1().min_w(0).h(h).rounded(3).overflow_hidden().bg(t.raised)
    .children(sorted(m).map(([k, v]) => div().id(`${id}-${k}`).h_full().w(`${pct(v, total).toFixed(2)}%`).bg(colorOf(t, k))
      .tooltip(`${LABEL[k] ?? k}: ${durationText(v)} · ${pctText(v, total)}`)));
}

// The categories as a legend: a swatch, the label, the share and the time.
function legend(t, id, m) {
  const total = catTotal(m);
  return h_flex().flex_wrap().gap_x(10).gap_y(2).px(2)
    .children(sorted(m).map(([k, v]) => h_flex().id(`${id}-l-${k}`).gap(4).items_center().text_size(11)
      .child(div().size(8).rounded(2).bg(colorOf(t, k)))
      .child(div().text_color(t.muted).child(LABEL[k] ?? k))
      .child(div().text_color(t.foreground).child(pctText(v, total)))
      .child(div().text_color(t.dim).child(durationText(v)))));
}

// A token bar as wide as this run's share of the largest run's tokens: fresh then cache reads.
function tokenBar(t, id, tokens, max) {
  const p = tokenParts(tokens);
  if (!p) return div().flex_1().min_w(0);
  const all = p.fresh + p.cached;
  const exact = (n) => n.toLocaleString("en");
  const tip = `${exact(tokens.total)} tokens\nfresh ${exact(p.fresh)}: input ${exact(tokens.input)}, output ${exact(tokens.output)}, cache write ${exact(tokens.cache_write)}\ncache read ${exact(p.cached)}`;
  return div().id(id).flex_1().min_w(0).h(6).tooltip(tip)
    .child(h_flex().h_full().rounded(3).overflow_hidden().w(`${Math.max(1, pct(all, max)).toFixed(2)}%`)
      .child(div().h_full().w(`${pct(p.fresh, all).toFixed(2)}%`).bg(FRESH(t)))
      .child(div().h_full().flex_1().bg(CACHED(t))));
}

// A collapsible section: its title, what it sums up on the right, and its body unless folded.
function section(view, t, id, title, note, body) {
  const shut = view.statsShut?.has(id);
  return v_flex().id(`sec-${id}`).flex_none().gap(6).p(10).rounded(10).bg(t.surface)
    .child(h_flex().id(`sec-${id}-h`).gap(6).items_center().cursor_pointer().text_size(11.5).font_semibold().text_color(t.foreground)
      .on_click((_e, cx) => { view.statsShut ??= new Set(); if (shut) view.statsShut.delete(id); else view.statsShut.add(id); cx.notify(); })
      .child(svg(`mods/harbormaster/chevron-${shut ? "right" : "down"}.svg`).size(11).text_color(t.dim))
      .child(title)
      .child(div().flex_1())
      .when(Boolean(note), (el) => el.child(div().font_normal().text_size(11).text_color(t.dim).child(note))))
    .when(!shut, (el) => el.child(body()));
}

// A small toggle among choices, the chosen one raised.
function choice(t, id, options, value, set) {
  return h_flex().gap(2).children(options.map(([v, label]) => div().id(`${id}-${v}`).px(6).h(18).rounded(4).flex().items_center()
    .text_size(10.5).cursor_pointer().bg(v === value ? t.raised : t.surface).text_color(v === value ? t.foreground : t.dim)
    .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { cx.stop_propagation(); set(v, cx); }).child(label)));
}

// ---- across runs ----

function across(view, t, runs) {
  const by = view.statsBy ?? "all";
  const groups = acrossRuns(runs, by);
  const all = acrossRuns(runs, "all")[0];
  const counted = all?.runs ?? 0;
  return section(view, t, "across", "Where the time goes", counted ? `${plural(counted, "run")} · ${durationText(all.wall)} wall` : null, () => {
    if (!all) return div().px(2).text_size(11.5).text_color(t.dim).child("No run's time read yet.");
    const max = Math.max(...groups.map((g) => g.total));
    return v_flex().gap(6)
      .child(h_flex().gap(8).items_center().px(2)
        .child(div().flex_1().text_size(11).text_color(t.dim).child("The orchestrators' time by category: what each run's wall time went to"))
        .child(choice(t, "by", [["all", "All"], ["folder", "By repo"], ["type", "By type"]], by, (v, cx) => { view.statsBy = v; cx.notify(); })))
      .when(by === "all", (el) => el.child(catBar(t, "across-all", all.critical_path, 12)))
      .when(by !== "all", (el) => el.children(groups.map((g) => h_flex().id(`grp-${g.group}`).gap(8).items_center().px(2).h(18).text_size(11.5)
        .child(div().flex_none().w(110).truncate().text_color(t.muted).child(`${g.group} · ${g.runs}`))
        .child(div().flex_1().min_w(0).child(div().w(`${pct(g.total, max).toFixed(2)}%`).child(catBar(t, `grp-${g.group}-bar`, g.critical_path))))
        .child(div().flex_none().w(56).text_color(t.dim).child(durationText(g.total))))))
      .child(legend(t, "across", all.critical_path));
  });
}

// ---- runs ----

function runRow(view, t, s, maxTokens) {
  const open = view.statsOpen?.has(s.key);
  const toggle = (cx) => { view.statsOpen ??= new Set(); if (open) view.statsOpen.delete(s.key); else view.statsOpen.add(s.key); cx.notify(); };
  const name = runName(s.branch, s.topic);
  const when = Date.parse(s.started ?? "") || null;
  const meta = [s.live ? "open" : s.source === "history" ? "closed" : "put away", s.machine, when ? `started ${ago(when)}` : null,
    s.tasks_planned ? `${s.tasks_merged ?? 0}/${s.tasks_planned} tasks` : null].filter(Boolean).join(" · ");
  const res = s.resources;
  const head = h_flex().id(`run-${s.key}`).gap(8).items_center().cursor_pointer().on_click((_e, cx) => toggle(cx))
    .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
    .when(Boolean(s.type), (el) => el.child(typeTag(t, s.type)))
    .child(v_flex().flex_1().min_w(0)
      .child(withTip(div().id(`run-${s.key}-t`).truncate().text_size(12.5).font_semibold().text_color(t.foreground), name))
      .child(div().truncate().text_size(11).text_color(t.dim).child(meta)))
    .child(div().flex_none().text_size(12).text_color(t.foreground).child(s.timed ? durationText(s.wall) : "reading…"));
  const figures = h_flex().gap(8).items_center().pl(19).text_size(11)
    .child(div().flex_1().min_w(0).child(catBar(t, `run-${s.key}-cp`, s.critical_path)))
    .child(div().flex_none().w(44).text_color(t.dim).child(s.tokens ? tokenText(s.tokens.total) : "—"))
    .child(div().flex_none().w(72).child(tokenBar(t, `run-${s.key}-tok`, s.tokens, maxTokens)))
    .child(div().id(`run-${s.key}-res`).flex_none().w(150).truncate().text_color(t.dim)
      .tooltip(res ? `CPU ${res.cpu_s ?? 0} s${res.estimated ? " (estimated: macOS)" : ""}; memory peak ${mbText(res.peak_rss_mb)}, average ${mbText(res.avg_rss_mb)} (all its agents together)` : "No CPU or memory recorded for this run")
      .child(res ? `${cpuText(res.cpu_s)} · ${mbText(res.peak_rss_mb)} peak` : "no CPU data"));
  return v_flex().id(`runbox-${s.key}`).gap(4).p(8).rounded(7).bg(open ? t.raised + "66" : t.background + "00")
    .child(head).child(figures)
    .when(open, (el) => el.child(runDetail(view, t, s)));
}

function runDetail(view, t, s) {
  const res = s.resources;
  const progs = Object.entries(res?.programs ?? {}).filter(([, p]) => p.cpu_s >= 0.1).sort((a, b) => b[1].cpu_s - a[1].cpu_s).slice(0, 6);
  const effort = catTotal(s.categories);
  return v_flex().gap(6).pl(19).pt(4)
    .when(catTotal(s.critical_path) > 0, (el) => el.child(legend(t, `run-${s.key}`, s.critical_path)))
    .when(!s.timed, (el) => el.child(div().text_size(11).text_color(t.dim).child("Its time is being read from its session logs…")))
    .when(effort > 0, (el) => el.child(div().text_size(11).text_color(t.dim)
      .child(`Effort: ${durationText(effort)} of agent time (agents work in parallel, so more than the wall time)`)))
    .when(Boolean(s.tokens), (el) => el.child(div().text_size(11).text_color(t.dim)
      .child(`Tokens: ${tokenText(s.tokens.total)} · fresh ${tokenText(tokenParts(s.tokens).fresh)} · cache read ${tokenText(s.tokens.cache_read)}`)))
    .when(Boolean(res), (el) => el.child(div().text_size(11).text_color(t.dim)
      .child(`CPU ${cpuText(res.cpu_s)}${res.estimated ? " (estimated)" : ""} · memory peak ${mbText(res.peak_rss_mb)}, average ${mbText(res.avg_rss_mb)}`
        + (progs.length ? ` · ${progs.map(([k, p]) => `${k} ${cpuText(p.cpu_s).replace(" CPU", "")}`).join(", ")}` : ""))))
    .child(v_flex().gap(2).children(s.tasks.map((k) => taskRow(view, t, s, k))))
    .when(s.tasks.length === 0 && s.agents.length > 0, (el) => el.children(s.agents.map((a, i) => agentRow(t, `${s.key}-a${i}`, a))));
}

function taskRow(view, t, s, k) {
  const key = `${s.key}#${k.id}`;
  const open = view.statsOpen?.has(key);
  const agents = s.agents.filter((a) => a.task === k.id);
  return v_flex().gap(2)
    .child(h_flex().id(`task-${key}`).gap(8).items_center().h(20).text_size(11.5).cursor_pointer()
      .on_click((_e, cx) => { view.statsOpen ??= new Set(); if (open) view.statsOpen.delete(key); else view.statsOpen.add(key); cx.notify(); })
      .child(svg(`mods/harbormaster/chevron-${open ? "down" : "right"}.svg`).size(10).flex_none().text_color(t.dim))
      .child(div().flex_none().w(70).truncate().text_color(t.foreground).child(k.id))
      .child(div().flex_1().min_w(0).child(catBar(t, `task-${key}-bar`, k.categories, 6)))
      .child(div().flex_none().w(52).text_color(t.muted).child(durationText(k.total)))
      .child(div().flex_none().w(130).truncate().text_color(t.dim)
        .child(k.cpu_s == null ? "" : `${cpuText(k.cpu_s)} · ${mbText(k.peak_rss_mb)}`)))
    .when(open, (el) => el.child(v_flex().gap(2).pl(18)
      .child(legend(t, `task-${key}`, k.categories))
      .children(agents.map((a, i) => agentRow(t, `${key}-a${i}`, a)))));
}

function agentRow(t, id, a) {
  const top = sorted(a.categories).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c, v]) => `${LABEL[c] ?? c} ${durationText(v)}`).join(", ");
  return h_flex().id(`ag-${id}`).gap(8).items_center().h(18).text_size(11)
    .tooltip([a.label ?? a.name, a.kind, top].filter(Boolean).join(" · "))
    .child(div().flex_none().w(34).text_color(t.dim).child(a.role ?? ""))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(a.label ?? a.name))
    .child(div().flex_none().w(52).text_color(t.muted).child(a.total ? durationText(a.total) : "—"))
    .child(div().flex_none().w(130).truncate().text_color(t.dim).child(a.cpu_s == null ? "" : `${cpuText(a.cpu_s)} · ${mbText(a.peak_rss_mb)}`));
}

function runsSection(view, t, runs) {
  const maxTokens = Math.max(0, ...runs.map((s) => { const p = tokenParts(s.tokens); return p ? p.fresh + p.cached : 0; }));
  const reading = runs.filter((s) => !s.timed).length;
  return section(view, t, "runs", "Runs", [plural(runs.length, "run"), reading ? `reading ${reading}` : null].filter(Boolean).join(" · "), () =>
    v_flex().gap(2)
      .child(h_flex().gap(8).px(8).text_size(10.5).text_color(t.dim)
        .child(div().flex_1().pl(19).child("where its wall time went"))
        .child(div().flex_none().w(124).child("tokens: fresh, cache read"))
        .child(div().flex_none().w(150).child("CPU · memory peak")))
      .children(runs.map((s) => runRow(view, t, s, maxTokens)))
      .when(runs.length === 0, (el) => el.child(div().px(2).text_size(11.5).text_color(t.dim).child("No runs yet."))));
}

// ---- live CPU and memory ----

function liveSection(view, t) {
  const ctx = facts();
  const snap = resourceSnapshot();
  const nameOf = (address) => ctx.terminals.find((x) => x.address === address)?.name || address;
  const crews = [];
  const cap = captainOf(ctx).terminal;
  if (cap) crews.push({ title: "Captain", root: cap.address, name: "captain", members: workersOf(cap.address, ctx).map((w) => ({ address: w.address, name: w.name })) });
  for (const o of orchestratorsOf(ctx)) {
    crews.push({ title: o.labels?.["run.topic"] || o.name || o.address, root: o.address, name: o.name || "orchestrator",
      members: workersOf(o.address, ctx).map((w) => ({ address: w.address, name: w.name })) });
  }
  const names = Object.fromEntries(Object.keys(snap.terminals ?? {}).map((a) => [a, nameOf(a)]));
  const groups = liveGroups(crews, snap, names);
  const other = otherProcesses();
  const total = groups.reduce((s, g) => s + g.cpu, 0);
  const row = (id, name, cpu, rssKb, detail, tip, indent = 8) => h_flex().id(id).gap(8).items_center().h(18).pl(indent).text_size(11)
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .child(div().flex_none().w(150).truncate().text_color(t.muted).child(name))
    .child(div().flex_none().w(44).text_color(cpu >= 50 ? t.working : t.foreground).child(`${Math.round(cpu)}%`))
    .child(div().flex_none().w(48).text_color(rssKb >= 2 * 1024 * 1024 ? t.working : t.foreground).child(memText(rssKb)))
    .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(detail ?? ""));
  const progText = (r) => r.programs.slice(0, 3).map((g) => `${g.name} ${Math.round(g.cpu)}%`).join(", ");
  const head = (id, title, cpu, rssKb) => h_flex().id(id).gap(8).items_center().pt(4).text_size(11).font_semibold()
    .child(div().flex_none().w(158).truncate().text_color(t.foreground).child(title))
    .child(div().flex_none().w(44).text_color(t.dim).child(`${Math.round(cpu)}%`))
    .child(div().flex_none().w(48).text_color(t.dim).child(memText(rssKb)));
  const rated = Object.values(snap.machines ?? {}).some((m) => m.rated);
  return section(view, t, "live", "CPU and memory now", `${Math.round(total)}% CPU in agents (100% is one core)${snap.at ? ` · ${ago(snap.at)}` : ""}`, () =>
    v_flex().gap(1)
      .when(!rated, (el) => el.child(div().px(2).text_size(11).text_color(t.dim).child("CPU % needs two polls, a few seconds; memory shows at once.")))
      .child(h_flex().gap(8).px(8).text_size(10.5).text_color(t.dim)
        .child(div().flex_none().w(150).child("agent")).child(div().flex_none().w(44).child("CPU"))
        .child(div().flex_none().w(48).child("memory")).child(div().flex_1().child("its busiest commands")))
      .children(groups.flatMap((g, gi) => [head(`lg-${gi}`, g.title, g.cpu, g.rssKb),
        ...g.rows.map((r) => row(`lr-${r.address}`, r.name, r.cpu, r.rssKb, progText(r),
          [`${r.name} (${r.address})`, r.own ? `the agent itself: ${Math.round(r.own.cpu)}% · ${memText(r.own.rssKb)}` : null,
            ...r.programs.map((g) => `${g.name}${g.count > 1 ? ` ×${g.count}` : ""}: ${Math.round(g.cpu)}% · ${memText(g.rssKb)}`)].filter(Boolean).join("\n")))]))
      .when(other.length > 0, (el) => el.child(head("lg-other", "Other processes", other.reduce((s, p) => s + p.cpu, 0), other.reduce((s, p) => s + p.rssKb, 0)))
        .children(other.map((p) => row(`lo-${p.machine ?? ""}-${p.pid}`, p.name, p.cpu, p.rssKb, [p.program !== p.name ? p.program : null, p.machine, `pid ${p.pid}`].filter(Boolean).join(" · "), null))))
      .when(groups.length === 0 && other.length === 0, (el) => el.child(div().px(2).text_size(11.5).text_color(t.dim).child("No sample yet (Linux and macOS only)."))));
}

// ---- the view ----

// Every run's figures: open runs from their timing and resources, past runs from the history.
export function statsRuns(view) {
  const open = view.runs.map((r) => summaryOf(r, cachedTiming(r), resourcesOf(r)));
  return mergeRuns(open, cachedHistory());
}

export function statsView(view, t) {
  const runs = statsRuns(view);
  return v_flex().id("stats").size_full().min_h(0).bg(t.canvas ?? t.chrome).text_size(13)
    .child(h_flex().flex_none().px(14).pt(10).pb(6).gap(8).items_center()
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Stats"))
      .child(div().text_size(11).text_color(t.dim).child("time, tokens, CPU and memory, from logs the runs already leave")))
    .child(v_flex().id("stats-list").flex_1().min_h(0).px(10).pb(12).gap(8).overflow_y_scrollbar()
      .child(across(view, t, runs))
      .child(liveSection(view, t))
      .child(runsSection(view, t, runs)));
}
