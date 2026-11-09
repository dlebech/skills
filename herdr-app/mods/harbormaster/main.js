// Harbormaster: an overview of herdr-app-orchestrator runs and the captain watching them.
// props().role picks the view:
//   (none) / "cards"  the runs overview: totals, what's waiting on you, the captain, run cards with progress, tasks, PRs
//   "run"             one run's card (props().run: its key), pinned beside its orchestrator
//   "crew"            the captain, orchestrators and agents adrift, above Herdr's own Agents list
//   "harbor"          the harbormaster-sea view; "harbor-rail" and "harbor-pane" its rail and pane headers
// Reads run directories on every machine (data.js) every 5 s and PRs from gh every minute;
// the crew and the overview also read each crew agent's context size (context.js).

import { View } from "gpui-kit";
import { InputState } from "gpui-base";
import { props, theme } from "herdr";
import { loadRuns, cachedRuns, refreshPrs, isClosed } from "./data.js";
import { facts, crewAddresses } from "./live.js";
import { loadContexts } from "./context.js";
import { cards, crew, runPane, submitReply } from "./overview.js";
import { harbor, rail, paneHeader } from "./harbor.js";

const BUSY_LIMIT = 2 * 60000; // a Close can run several 30 s commands in a row
const DATA_ROLES = new Set([undefined, "cards", "run", "crew", "harbor"]);

export default class Harbormaster extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.runs = cachedRuns().runs;
    this.decisions = cachedRuns().decisions;
    this.errors = [];
    this.step = 0;
    this.showDone = false;
    this.contexts = {}; // { [address]: { tokens, model } } for the crew
    this.replying = null; // the key of the decision being answered inline
    this.busy = {}; // { [run key]: { label: "Deleting…", at, branch } } while a card's action is under way
    this.redraw = false; // an action ended in a task that could not redraw this view
    this.reply = InputState.new({ placeholder: "Your answer…" });
    this.reply.on("submit", (_e, cx) => submitReply(this, cx));
    if (!DATA_ROLES.has(role)) return;
    this.refresh(cx);
    cx.timer.every(5000, (cx) => this.refresh(cx));
    // The harbor's scuttle target: data, not frames; .transition does the moving.
    if (role === "harbor") cx.timer.every(2000, (cx) => { this.step++; cx.notify(); });
  }

  // Reads the runs and the captain's decisions again; redraws when they changed.
  async load(cx) {
    const { runs, decisions, errors } = await loadRuns();
    const changed = JSON.stringify(runs) !== JSON.stringify(this.runs) || JSON.stringify(decisions) !== JSON.stringify(this.decisions)
      || errors.join() !== this.errors.join();
    this.runs = runs;
    this.decisions = decisions;
    this.errors = errors;
    if (changed) cx.notify();
    return runs;
  }

  // A card's action that has not ended after BUSY_LIMIT never will (its task was
  // cancelled): stop showing it as under way, so the card can be used again.
  expireBusy() {
    let changed = this.redraw;
    this.redraw = false;
    for (const [key, b] of Object.entries(this.busy)) {
      if (Date.now() - b.at < BUSY_LIMIT) continue;
      delete this.busy[key];
      this.actionError = `${b.branch}: ${b.label.replace("…", "").toLowerCase()} didn't finish; the list shows what happened, try again if it is still there`;
      changed = true;
    }
    return changed;
  }

  refresh(cx) {
    if (this.expireBusy()) cx.notify();
    cx.spawn(async (cx) => {
      const runs = await this.load(cx);
      // The crew and the overview show each crew agent's context size; the harbor does not.
      if (props()?.role !== "harbor") {
        const contexts = await loadContexts(crewAddresses(facts()));
        if (JSON.stringify(contexts) !== JSON.stringify(this.contexts)) { this.contexts = contexts; cx.notify(); }
      }
      // PRs land in shared state, which re-renders every copy by itself.
      const ctx = facts();
      for (const r of runs) await refreshPrs(r, isClosed(r, ctx)).catch(() => {});
    });
  }

  render(_cx) {
    const p = props() ?? {};
    const t = theme();
    switch (p.role) {
      case "crew": return crew(this, t);
      case "run": return runPane(this, t, p.run);
      case "harbor": return harbor(this);
      case "harbor-rail": return rail(this);
      case "harbor-pane": return paneHeader(p);
      default: return cards(this, t, this.runs, this.errors, this.decisions);
    }
  }
}
