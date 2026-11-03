// Runs: an overview of herdr-app-orchestrator runs and the captain watching them.
// props().role picks the view:
//   (none) / "cards"  run cards: captain, progress, tasks, PRs with checks and review, open questions
//   "summary"         the runs-board layout's top bar
//   "focus-rail"      the line above the runs-board layout's focused agent
//   "pasture"         the runs-pasture meadow; "pasture-rail" and "pasture-pane" its rail and pane headers
// Reads run directories on every machine (data.js) every 5 s and PRs from gh every minute.

import { View } from "gpui-kit";
import { props, theme } from "herdr";
import { loadRuns, cachedRuns, refreshPrs } from "./data.js";
import { cards, summary, focusRail } from "./board.js";
import { field, rail, paneHeader } from "./pasture.js";

const DATA_ROLES = new Set([undefined, "cards", "summary", "pasture"]);

export default class Runs extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.runs = cachedRuns().runs;
    this.errors = [];
    this.step = 0;
    this.showDone = false;
    if (!DATA_ROLES.has(role)) return;
    this.refresh(cx);
    cx.timer.every(5000, (cx) => this.refresh(cx));
    // The pasture's drift target: data, not frames; .transition does the moving.
    if (role === "pasture") cx.timer.every(4200, (cx) => { this.step++; cx.notify(); });
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      const { runs, errors } = await loadRuns();
      const changed = JSON.stringify(runs) !== JSON.stringify(this.runs) || errors.join() !== this.errors.join();
      this.runs = runs;
      this.errors = errors;
      if (changed) cx.notify();
      // PRs land in shared state, which re-renders every copy by itself.
      for (const r of runs) await refreshPrs(r).catch(() => {});
    });
  }

  render(_cx) {
    const p = props() ?? {};
    const t = theme();
    switch (p.role) {
      case "summary": return summary(t, this.runs);
      case "focus-rail": return focusRail(t);
      case "pasture": return field(this);
      case "pasture-rail": return rail(this);
      case "pasture-pane": return paneHeader(p);
      default: return cards(this, t, this.runs, this.errors);
    }
  }
}
