// The Bridge's "This week" block: runs, agent time, tokens and time waited on you for the last 7 days, one
// bar of where the time went, and a link to Stats. The figures are statsdata.js's weekOf over the runs list
// the stats view builds (stats.js statsRuns); nothing is measured here.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { durationText } from "./timing.js";
import { loadHistory, refreshTimings, weekOf } from "./statsdata.js";
import { statsRuns, colorOf, LABEL } from "./stats.js";
import { tokenText } from "./context.js";
import { openStats } from "./live.js";
import { plural } from "./ui.js";
import { startOnce } from "./inflight.js";

const STATS_TIP = "Where the time goes, tokens, CPU and memory: per run, task and agent, and past runs";
const WEEK_TIP = "Runs active in the last 7 days, open and closed, each counted whole.";
// The stats view reads at most this often (main.js: its 30 s timer).
const READ_EVERY = 30000;

// The week's figures, worked out again only when the runs list changed or a minute went by.
function weekFigures(view) {
  const data = statsRuns(view);
  const at = Math.floor(Date.now() / 60000);
  if (view.weekMemo?.runs !== data.runs || view.weekMemo.at !== at) view.weekMemo = { runs: data.runs, at, week: weekOf(data.runs) };
  return view.weekMemo.week;
}

// The block, a fixed height in every state so nothing jumps when figures arrive.
export function weekBlock(view, t) {
  view.weekDrawn = true; // weekReads (below) reads only while the block is drawn
  const w = weekFigures(view);
  const figure = (id, text, label, color) => v_flex().id(`week-${id}`).flex_1().min_w(0).gap(1)
    .child(div().text_size(15).font_semibold().whitespace_nowrap().text_color(color ?? t.foreground).child(text))
    .child(div().text_size(10.5).text_color(t.dim).whitespace_nowrap().child(label));
  const { split } = w;
  const total = split.working + split.idle;
  // The line names the bar's biggest parts, each as its share of the whole bar (working time and idle).
  const share = (secs) => Math.round((100 * secs) / total);
  const parts = [...split.shown.map((p) => ({ key: p.key, secs: p.secs })), ...(split.idle > 0 && share(split.idle) >= 1 ? [{ key: "idle", secs: split.idle }] : [])];
  const line = w.runs === 0 ? "No runs in the last 7 days."
    : parts.length ? parts.map((p) => `${LABEL[p.key] ?? p.key} ${share(p.secs)}%`).join(" · ") : "no time data yet";
  const note = w.untimed > 0 && w.runs > 0 ? `${plural(w.untimed, "run")} not timed` : null;
  return v_flex().id("week").flex_none().h(112).gap(6).p(10).rounded(8).bg(t.surface)
    .child(h_flex().id("week-h").h(16).gap(6).items_baseline().tooltip(WEEK_TIP)
      .child(div().text_size(11).font_semibold().text_color(t.dim).child("This week"))
      .child(div().text_size(10.5).text_color(t.dim).child("runs active in the last 7 days")))
    .child(h_flex().h(34).gap(8)
      .when(w.runs > 0, (el) => el
        .child(figure("runs", String(w.runs), "runs"))
        .child(figure("time", durationText(w.agentSecs), "agent time"))
        .child(figure("tokens", tokenText(w.tokens), "tokens"))
        .child(figure("waited", durationText(w.waitedSecs), "waited on you", w.waitedSecs > 0 ? t.blocked : null))))
    .child(h_flex().id("week-bar").h(8).rounded(4).overflow_hidden().when(w.runs > 0, (el) => el.bg(t.raised))
      .when(total > 0, (el) => el.children([...split.parts, { key: "idle", secs: split.idle }].filter((p) => p.secs > 0)
        .map((p) => div().id(`week-bar-${p.key}`).h_full().w(`${((100 * p.secs) / total).toFixed(2)}%`).bg(colorOf(t, p.key))
          .tooltip(`${LABEL[p.key] ?? p.key}: ${durationText(p.secs)}`)))))
    .child(h_flex().h(16).gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.muted).child(note ? `${line} · ${note}` : line))
      .child(div().id("week-stats").flex_none().text_size(10.5).text_color(t.dim).cursor_pointer().hover((st) => st.text_color(t.foreground))
        .tooltip(STATS_TIP).on_click(() => openStats()).child("Stats ↗")));
}

// Called after a render with the view's cx: if the block was drawn, reads the history and the open runs'
// timings, at most every READ_EVERY, as the stats view does (main.js), and redraws as each read lands.
// No timer: a draw is what asks, and a finished read draws again.
export function weekReads(view, cx) {
  if (!view.weekDrawn) return;
  view.weekDrawn = false;
  if (Date.now() - (view.weekReadAt ?? 0) < READ_EVERY) return;
  view.weekReadAt = Date.now();
  // The render's cx is dead once it returns: the redraws go through the one cx.spawn hands the task.
  // At most one read at a time: one that never answers must not let another start every READ_EVERY.
  startOnce(view, "week", (b) => cx.spawn(b), async (cx) => {
    const again = () => { try { cx.notify(); } catch { /* closed */ } };
    await loadHistory();
    again();
    await refreshTimings(view.runs, again);
  });
}
