// Harbormaster: an overview of herdr-app-orchestrator runs and the captain watching them.
// props().role picks the view:
//   (none) / "cards"  run cards: captain, progress, tasks, PRs with checks and review, open questions
//   "crew"            the captain and orchestrators as cards, above Herdr's own Agents list
//   "summary"         the harbormaster-board layout's top bar
//   "focus-rail"      the line above the harbormaster-board layout's focused agent
//   "harbor"          the harbormaster-sea view; "harbor-rail" and "harbor-pane" its rail and pane headers
// Reads run directories on every machine (data.js) every 5 s and PRs from gh every minute.

import { View } from "gpui-kit";
import { props, theme } from "herdr";
import { loadRuns, cachedRuns, refreshPrs } from "./data.js";
import { cards, crew, summary, focusRail } from "./board.js";
import { harbor, rail, paneHeader } from "./harbor.js";

const DATA_ROLES = new Set([undefined, "cards", "crew", "summary", "harbor"]);

export default class Harbormaster extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.runs = cachedRuns().runs;
    this.errors = [];
    this.step = 0;
    this.showDone = false;
    if (!DATA_ROLES.has(role)) return;
    this.refresh(cx);
    cx.timer.every(5000, (cx) => this.refresh(cx));
    // The harbor's scuttle target: data, not frames; .transition does the moving.
    if (role === "harbor") cx.timer.every(2000, (cx) => { this.step++; cx.notify(); });
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
      case "crew": return crew(this, t);
      case "summary": return summary(t, this.runs);
      case "focus-rail": return focusRail(t, this.runs);
      case "harbor": return harbor(this);
      case "harbor-rail": return rail(this);
      case "harbor-pane": return paneHeader(p);
      default: return cards(this, t, this.runs, this.errors);
    }
  }
}
