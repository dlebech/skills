// Harbormaster: an overview of herdr-app-orchestrator runs and the captain watching them.
// props().role picks the view:
//   (none) / "cards"  the runs overview: totals, what's waiting on you, the captain, run cards with progress, tasks, PRs
//   "run"             one run's card (props().dir and .terminal name it), pinned beside its orchestrator
//   "crew"            the sidebar: header, Needs-you box, Next for you, runs as one-line rows, agents adrift
//   "viewer"          a proof screenshot, opened as an overlay by a click on a thumbnail (viewer.js)
//   "harbor"          the harbormaster-sea view; "harbor-rail" and "harbor-pane" its rail and pane headers
//   "newrun"          the + New run dialog (newrun.js), an overlay
//   "stats"           where the time goes, tokens, CPU and memory: per run, task and agent, live, and past runs
// Reads run directories on every machine (data.js) every 5 s and PRs from gh every minute;
// the crew and the overview also read each crew agent's context size (context.js).

import { View } from "gpui-kit";
import { InputState } from "gpui-base";
import { props, theme, nextCommand, checking, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { expireNote } from "./note.js";
import { loadRuns, cachedRuns, refreshPrs, refreshReviewed, isClosed, isParked, newestFirst } from "./data.js";
import { facts, crewAddresses } from "./live.js";
import { loadContexts } from "./context.js";
import { hotSignature, sampleVersion } from "./resources.js";
import { cards, runPane, submitReply, runProps } from "./overview.js";
import { crew } from "./crew.js";
import { viewer, startCopies } from "./viewer.js";
import { harbor, rail, paneHeader } from "./harbor.js";
import { statsView } from "./stats.js";
import { loadHistory, refreshTimings } from "./statsdata.js";
import { observeTelling } from "./telling.js";
import { parseCommand, runNamed, newRunArgs } from "./commands.js";
import { openNewRun, initNewRun, newRunView } from "./newrun.js";

const BUSY_LIMIT = 2 * 60000; // a Close can run several 30 s commands in a row
const DATA_ROLES = new Set([undefined, "cards", "run", "crew", "harbor", "stats"]);

// A brief popup of one run's pane, for taking a screenshot of it with `herdr-app shot` without
// switching the user's space or tab. Commands sent with `herdr-app do 'harbormaster.<command>'`:
//   show-run:<branch | run dir | orchestrator terminal>   open it (no name: the newest unclosed run); one at a time;
//                                                         "… details" / "… proof" unfold its question / its Proof list
//   show-stats[:<branch | run dir>]                         open the Stats view (a run: focused on it)
//   show-overview, show-crew                               open the runs overview, or the Crew block
//   new-run[:repo=<name or folder> kind=<issue|review|describe> input=<text>]   the + New run dialog (a key binding's command)
//   close-popup                                            close it
//   open-run:key=<run key>                                 a toast's click (telling.js) for a run whose
//                                                         orchestrator is gone: its card, kept open until closed
// Every shown Harbormaster copy hears a command, so the popup's id and time are in shared state and
// a copy that sees the same command opened a moment ago leaves it alone (and one that lost a race closes its own).
// The popup's own copy doesn't listen, so a Harbormaster copy that isn't the popup (the Crew block or the overview) must be shown. A popup nobody closed goes
// after POPUP_LIMIT.
const POPUP = "harbormaster.popup";
const POPUP_LIMIT = 60000;

function closePopup() {
  const cur = shared(POPUP);
  if (!cur) return;
  setShared(POPUP, null);
  try { closeOverlay(cur.id); } catch { /* already closed (Esc) */ }
}

function expirePopup() {
  const cur = shared(POPUP);
  if (cur && !cur.keep && Date.now() - cur.at > POPUP_LIMIT) closePopup();
}

function showPopup(view, arg, keep = false) {
  const cur = shared(POPUP);
  if (cur && cur.arg === arg && Date.now() - cur.at < 2000) return; // another copy just did
  const pick = view.runs.filter((r) => !r.away);
  // "<run> details" opens it with its question's Details unfolded, "<run> proof" with its Proof
  // list open and its first pending row unfolded, for a shot without a click.
  const [, name, details] = /^(.*?)(?:(?:^|\s+)(details|proof))?$/.exec(arg) ?? [null, arg, null];
  const r = name ? runNamed(view.runs, name)
    : [...pick].sort(newestFirst)[0];
  if (!r) { console.log(`harbormaster.show-run: no run matches "${arg}"`); return; }
  closePopup();
  const id = openOverlay({ mod: "harbormaster", kind: "dialog", width: 560, height: 700, props: details ? { ...runProps(r), [details]: true } : runProps(r) });
  // Another copy opened one for this same command first: keep theirs, so none is left untracked.
  const won = shared(POPUP);
  if (won && won.arg === arg && Date.now() - won.at < 2000) { try { closeOverlay(id); } catch { /* gone */ } return; }
  setShared(POPUP, { id, at: Date.now(), arg, ...(keep ? { keep } : {}) });
}

// The Stats view as the same brief popup, wide enough for its columns.
function showStats(view, arg) {
  const cur = shared(POPUP), key = `stats:${arg}`;
  if (cur && cur.arg === key && Date.now() - cur.at < 2000) return;
  const r = arg ? view.runs.find((x) => [x.branch, x.dir, x.key].includes(arg)) : null;
  closePopup();
  const id = openOverlay({ mod: "harbormaster", kind: "dialog", width: 1100, height: 1000, props: r ? { role: "stats", run: r.dir } : { role: "stats" } });
  const won = shared(POPUP);
  if (won && won.arg === key && Date.now() - won.at < 2000) { try { closeOverlay(id); } catch { /* gone */ } return; }
  setShared(POPUP, { id, at: Date.now(), arg: key });
}

// The runs overview (role "cards") or the Crew block (role "crew", sidebar-narrow) as the
// same brief popup, for screenshots of their cards.
function showView(key, role, width, height, extra = {}) {
  const cur = shared(POPUP);
  if (cur && cur.arg === key && Date.now() - cur.at < 2000) return;
  closePopup();
  const id = openOverlay({ mod: "harbormaster", kind: "dialog", width, height, props: { role, ...extra } });
  const won = shared(POPUP);
  if (won && won.arg === key && Date.now() - won.at < 2000) { try { closeOverlay(id); } catch { /* gone */ } return; }
  setShared(POPUP, { id, at: Date.now(), arg: key });
}

const sameItems = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function listen(view, cx) {
  for (;;) {
    const c = String(await nextCommand());
    // A throw here would end the loop and this copy would never hear a command again.
    try {
      const { name, arg } = parseCommand(c);
      if (name === "show-run") showPopup(view, arg);
      else if (name === "show-stats") showStats(view, arg);
      else if (name === "show-overview") showView("overview", "cards", 560, 900);
      else if (name === "show-crew") showView("crew", "crew", 360, 640);
      else if (name === "new-run") openNewRun(newRunArgs(arg));
      else if (name === "close-popup") closePopup();
      else if (name === "open-run") showPopup(view, arg, true);
      cx.notify();
    } catch (e) { console.log(`harbormaster: command "${c}" failed: ${e?.message ?? e}`); }
  }
}

export default class Harbormaster extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.runs = cachedRuns().runs;
    this.decisions = cachedRuns().decisions;
    this.errors = [];
    this.step = 0;
    this.showDone = false;
    this.contexts = {}; // { [address]: { tokens, model } } for the crew
    this.replying = null; // the id of the queue item being answered inline
    this.busy = {}; // { [run key]: { label: "Deleting…", at, branch, limit? } } while a card's action is under way
    this.redraw = false; // an action ended in a task that could not redraw this view
    this.reply = InputState.new({ placeholder: "Your answer…" });
    this.reply.on("submit", (_e, cx) => submitReply(this, cx));
    if (role === "newrun") { initNewRun(this, cx); return; }
    if (!DATA_ROLES.has(role)) return;
    // The popup's own copy doesn't listen: a command that closed or replaced the popup would end it.
    if (!checking() && role !== "harbor" && !((role === "run" || role === "stats" || role === "cards" || role === "crew") && props()?.overlay)) cx.spawn((cx) => listen(this, cx));
    this.refresh(cx);
    cx.timer.every(5000, (cx) => this.refresh(cx));
    // The harbor's scuttle target: data, not frames; .transition does the moving.
    if (role === "harbor") cx.timer.every(2000, (cx) => { this.step++; cx.notify(); });
    // Run timing is read in the background, one run at a time, each at most every 90 s while
    // open (statsdata.js); the history when a run may have closed. Never blocks drawing.
    if (role === "stats") {
      const slow = (cx) => cx.spawn(async (cx) => {
        await Promise.all([loadHistory(), this.load(cx)]);
        cx.notify();
        await refreshTimings(this.runs, () => { try { cx.notify(); } catch { /* closed */ } });
      });
      slow(cx);
      cx.timer.every(30000, slow);
    }
  }

  // Reads the runs and the captain's decisions again; redraws when they changed.
  async load(cx) {
    const { runs, decisions, errors } = await loadRuns();
    // The CPU and memory badges change with every sample, so only what they show counts.
    const hot = props()?.role === "stats" ? sampleVersion() : hotSignature(facts());
    // data.js hands back the same object for a run whose files did not change, so most polls
    // compare a few references instead of serialising every run twice per copy.
    const changed = !sameItems(runs, this.runs) || JSON.stringify(decisions) !== JSON.stringify(this.decisions)
      || errors.join() !== this.errors.join() || hot !== this.hot;
    this.hot = hot;
    this.runs = runs;
    this.decisions = decisions;
    this.errors = errors;
    if (changed) cx.notify();
    return runs;
  }

  // A card's action that has not ended after BUSY_LIMIT (or its own limit) never will (its task was
  // cancelled): stop showing it as under way, so the card can be used again.
  expireBusy() {
    let changed = this.redraw;
    this.redraw = false;
    for (const [key, b] of Object.entries(this.busy)) {
      if (Date.now() - b.at < (b.limit ?? BUSY_LIMIT)) continue;
      delete this.busy[key];
      this.actionError = `${b.branch}: ${b.label.replace("…", "").toLowerCase()} didn't finish; the list shows what happened, try again if it is still there`;
      changed = true;
    }
    return changed;
  }

  refresh(cx) {
    // A note past its time goes with the same refresh, so no timer is needed for it.
    if (this.expireBusy() | expireNote(this)) cx.notify();
    expirePopup();
    cx.spawn(async (cx) => {
      const runs = await this.load(cx);
      // The crew and the overview show each crew agent's context size; the harbor and stats do not.
      if (props()?.role !== "harbor" && props()?.role !== "stats") {
        const contexts = await loadContexts(crewAddresses(facts()));
        if (JSON.stringify(contexts) !== JSON.stringify(this.contexts)) { this.contexts = contexts; cx.notify(); }
      }
      const ctx = facts();
      // Toasts and the decisions seen: from the copies that poll for the whole window only (the
      // Crew block, the overview, the sea layout's harbor; the store's claim keeps it to one toast).
      const role = props()?.role;
      if ((role === "crew" || role === undefined || role === "cards" || role === "harbor") && !props()?.overlay && !checking()) {
        try { observeTelling(runs, ctx); } catch (e) { console.log(`harbormaster: telling failed: ${e?.message ?? e}`); }
      }
      // PRs land in shared state, which re-renders every copy by itself. A parked run's PRs are
      // read as rarely as a closed run's: nobody works on them, they only show what they wait on.
      for (const r of runs) await refreshPrs(r, isClosed(r, ctx) || isParked(r)).catch(() => {});
      // The commits since each run's last review (not for closed runs: their line is never shown): module memory, so a change re-renders by hand.
      let moved = false;
      for (const r of runs) if (!isClosed(r, ctx)) moved = (await refreshReviewed(r, isClosed(r, ctx) || isParked(r)).catch(() => false)) || moved;
      if (moved) cx.notify();
    });
  }

  render(cx) {
    const p = props() ?? {};
    const t = theme();
    const el = this.view(p, t);
    startCopies(this, cx); // the proof images this render asked for
    return el;
  }

  view(p, t) {
    switch (p.role) {
      case "crew": return crew(this, t);
      case "run": return runPane(this, t, p);
      case "viewer": return viewer(this, t, p);
      case "harbor": return harbor(this);
      case "harbor-rail": return rail(this);
      case "harbor-pane": return paneHeader(p);
      case "stats": return statsView(this, t);
      case "newrun": return newRunView(this, t);
      default: return cards(this, t, this.runs, this.errors, this.decisions);
    }
  }
}
