// The small drawing helpers every card and pane shares: text sizes, pills, the task strip, the action buttons and the status colours.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { taskTone, taskAgents, shownStage, isParked, putAway, resumeRun, deleteRun } from "./data.js";
import { openUrl, orchestratorState } from "./live.js";
import { plural, shortRef, stateText, TYPE } from "./ui.js";
import { tokenText, tokenHeadline } from "./context.js";
import { hotText, memText } from "./resources.js";
import { setNote, noteText } from "./note.js";
import { closableDone } from "./crewrows.js";

// How each runPhase() reads on a card. Running is muted, not the working colour: colour means
// something to look at (see AMBER), and the run's spinning dot already says it works.
export const PHASE = {
  running: { label: "Running", tone: "muted" },
  waiting: { label: "Needs you", tone: "blocked" },
  blocked: { label: "Blocked", tone: "blocked" },
  finished: { label: "Finished", tone: "done" },
  unknown: { label: "Starting", tone: "dim" },
  parked: { label: "Parked", tone: "dim" },
  closed: { label: "Closed", tone: "dim" },
  cant: { label: "Can't tell", tone: "dim" },
};

// Text sizes: the run pane and the Bridge's cards draw with TYPE's four sizes. The helpers they
// share with the Crew sidebar (crew.js) read this flag, set only while a card or the pane is drawn,
// and keep their own sizes otherwise: T(was, role) is `was` in the sidebar and TYPE[role] here.
let inPane = false;

export const T = (was, role) => (inPane ? TYPE[role] : was);

// Draws with the card/pane type scale (TYPE) whatever the caller is: the sea's reefs use it so their button matches their text.
export const drawnInPane = (draw) => { const was = inPane; inPane = true; try { return draw(); } finally { inPane = was; } };

export function pill(t, text, tone, solid = false) {
  const c = String(tone ?? "").startsWith("#") ? tone : t[tone] ?? t.dim;
  return div().flex_none().px(7).h(18).rounded(9).flex().items_center()
    .bg(solid ? c : c + "22").text_size(TYPE.meta).font_semibold().text_color(solid ? t.background : c).child(text);
}

// Adds how full an agent's context is, "144k", with the exact count on hover; nothing
// when unknown. For an orchestrator, `run` adds the run's token total to the tooltip,
// where a narrow row has room for it. For .map() on the row it goes in.
export const withContext = (view, t, id, address, run = null) => (el) => {
  const c = view.contexts?.[address];
  if (!c) return el;
  return el.child(div().id(`${id}-ctx`).flex_none().text_size(T(10.5, "meta")).text_color(t.dim).child(`${inPane ? "ctx " : ""}${tokenText(c.tokens)}`)
    .tooltip(contextTip(view, address, run)));
};

// What withContext's hover says: the context size, and for an orchestrator the run's total; null without either.
const contextTip = (view, address, run = null) => {
  const c = view.contexts?.[address];
  return [c && `Context: ${c.tokens.toLocaleString("en")} tokens${c.model ? ` (${c.model})` : ""}, as of its last turn`,
    run?.tokens && `Run total: ${tokenHeadline(run.tokens)} (${run.tokens.total.toLocaleString("en")} in all), all its agents`].filter(Boolean).join("\n") || null;
};

// A small "85% · 2.1G" badge for an agent and the commands it runs, above resources.js's HOT
// limits, so a busy machine can be explained at a glance; nothing otherwise. The tooltip names
// what uses it: the agent itself and its busiest programs, and `more` (a run's total) after them.
export const withUsage = (t, id, u, whose, more = null) => (el) => {
  const text = hotText(u);
  if (!text) return el;
  const progs = (u.programs ?? []).slice(0, 4).map((g) => `${g.name}: ${Math.round(g.cpu)}% · ${memText(g.rssKb)}`);
  const tip = [`${whose}: ${Math.round(u.cpu)}% CPU (100% is one core), ${memText(u.rssKb)} memory`,
    u.own ? `the agent itself: ${Math.round(u.own.cpu)}% · ${memText(u.own.rssKb)}` : null, ...progs, more].filter(Boolean).join("\n");
  return el.child(div().id(`${id}-use`).flex_none().px(5).rounded(4).text_size(T(10, "meta")).font_semibold()
    .bg(t.working + "22").text_color(t.working).tooltip(tip).child(text));
};

// A working agent's status is a ring spun natively, like Herdr's own Agents list (spin(900)). The Agents
// list already redraws the window while any agent works, so the ring rides on those frames: measured in a
// software-rendered window it cost about 1.2 CPU s/min less than stepped text frames (proof t19-spinner).
// Other motion holds still: loop() pulses redraw the whole window about 30 times a second.
export function statusDot(t, status) {
  if (status === "working") return svg("mods/harbormaster/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().size(8).flex_none().rounded(4).bg(t.blocked).border(1.5).border_color(t.blocked + "66");
  if (status === "gone") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.dim);
  if (status === "idle") return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(8).flex_none().rounded(4).bg(t[status] ?? t.dim);
}

// A link chip: the run's issues, and PRs it is about but did not open, side by side.
// A PR chip's icon takes its state's color; its title and state are in the tooltip.
export function linkChip(t, id, url, icon, tip) {
  return h_flex().id(id).gap(4).px(6).h(20).items_center().rounded(5).bg(t.raised).text_size(TYPE.meta).text_color(t.muted).cursor_pointer()
    .hover((s) => s.text_color(t.foreground)).tooltip(tip ?? url)
    .on_click((_e, cx) => { cx.stop_propagation(); openUrl(url); })
    .child(icon).child(shortRef(url));
}

// A task's life-cycle stages (data.js taskStage) as they read and color, and which
// are marked because an agent is at it. Implementing is a neutral bright tone, not amber: amber
// means look soon (see AMBER), and the light edge on an active segment (and the spinner on rows)
// says it is at work. Review takes the accent, fixing the implementer's second pass a colour of
// its own, so implementing and reviewing tasks tell apart. The agent rows' stage text uses the same.
export const STAGE = {
  planned: { label: "Planned", color: (t) => t.border },
  implement: { label: "Implementing", color: (t) => t.muted, active: true },
  review: { label: "In review", color: (t) => t.accent, active: true },
  fix: { label: "Fixing", color: (t) => t.ansi5 ?? t.muted, active: true },
  done: { label: "Done", color: (t) => t.done },
  blocked: { label: "Blocked", color: (t) => t.blocked },
};

// A task's color: its stage's, else its tone's (a state that names no stage); a task at work
// that names no stage ("validating") is neutral, as Implementing is, never amber.
const taskColor = (t, task, stage) => {
  if (stage) return STAGE[stage].color(t);
  const tone = taskTone(task.state);
  return tone === "working" ? t.muted : t[tone] ?? t.border;
};

const pulse = (stage, task) => (stage ? STAGE[stage].active : taskTone(task.state) === "working");

const stageText = (task, stage) => (stage ? STAGE[stage].label : stateText(task.state));

// Each task's stage and live agents, in plan.md's order. A done task shows none: they
// are leftovers, or another round's ("final review" and "final review 2" share an id).
export const stagesOf = (r, ctx) => r.tasks.map((task) => {
  const agents = taskAgents(task, r, ctx);
  const stage = shownStage(task, agents);
  return { agents: stage === "done" ? [] : agents, stage };
});

// "1 implementing · 4 in review": the tasks under way, by stage.
function stageSummary(stages) {
  return ["implement", "review", "fix"].map((s) => [s, stages.filter((x) => x.stage === s).length])
    .filter(([, n]) => n > 0).map(([s, n]) => `${n} ${STAGE[s].label.toLowerCase()}`).join(" · ");
}

// One segment per planned task, coloured by its stage, hover for its name and stage, and how
// many are done and under way below it; only for runs that plan at least one. Proof is told by
// claims (the Claims section), not per task.
export function taskStrip(t, r, counts, stages, names = true) {
  return v_flex().gap(5)
    .child(h_flex().gap(3).h(6).children(Array.from({ length: counts.planned }, (_, i) => {
      const task = r.tasks[i];
      const color = task ? taskColor(t, task, stages[i].stage) : i < counts.done ? t.done : t.border;
      return div().id(`seg-${r.key}-${i}`).flex_1().h_full().rounded(3).bg(color)
        .when(Boolean(task), (el) => el.tooltip([[task.id, task.name].filter(Boolean).join(" "), stageText(task, stages[i].stage)].filter(Boolean).join(" · ")))
        // An agent is at it: a light edge, still (see statusDot for why not a pulse).
        .when(Boolean(task) && pulse(stages[i].stage, task), (el) => el.border(1).border_color(t.foreground + "88"));
    })))
    .when(names, (el) => el.child(div().text_size(TYPE.meta).text_color(t.dim).child(tasksText(r, counts, stages))));
}

// "21/22 done · 1 in review": the tasks done (data.js taskCounts, as the header counts them),
// then those under way by stage.
export function tasksText(r, counts, stages) {
  return [`${counts.done}/${counts.planned} done`, stageSummary(stages)].filter(Boolean).join(" · ");
}

// What a card offers: Park and Close while its orchestrator runs, finished or not (a
// finished run may still wait on review or QA), Resume, Park and Close once it is gone,
// Resume and Close once parked, Resume and Delete once closed.
function actionsOf(r, orch, closed) {
  if (closed) return ["resume", "delete"];
  if (isParked(r)) return ["resume", "close"];
  if (orch === "gone") return ["resume", "park", "close"];
  return ["park", "close"];
}

export const ACTION = {
  park: { label: "Park", tip: "Set this run aside: closes its orchestrator's tab and its integration worktree's space, keeping the worktree; resume it any time" },
  close: { label: "Close", tip: "Close this run for good: its orchestrator ends its agents, deletes the run's worktrees once their code is pushed, and closes its tab; it can still be resumed" },
  delete: { label: "Delete", tip: "Delete this run for good: its run directory goes, so it leaves Harbormaster and can't be resumed; branches and PRs stay" },
  resume: { label: "Resume", tip: "Start a new orchestrator that picks this run up where it stopped" },
};

// The question a card asks before acting, naming what is left.
function confirmText(r, action, counts) {
  const left = [counts.planned ? `${counts.done} of ${counts.planned} tasks done` : null,
    r.prs.length ? plural(r.prs.length, "PR") + " stay open" : null].filter(Boolean).join(", ");
  if (action === "park") return `Park ${r.branch}? Its orchestrator and agents end and its integration worktree's space closes (the worktree stays); the run waits here until you resume it.${left ? ` ${left}.` : ""}`;
  const clean = "Its orchestrator pushes what isn't pushed, deletes the worktrees and closes its tab; branches and PRs stay.";
  if (action === "close") return r.phase === "finished" ? `Close ${r.branch}? ${clean}`
    : `Close ${r.branch} for good, unfinished?${left ? ` ${left}.` : ""} ${clean}`;
  if (action === "delete") return `Delete ${r.branch} for good? Its run directory goes: spec, plan, decisions and status, so it can't be resumed. This can't be undone. Branches and PRs stay on git and GitHub.`;
  return `Resume ${r.branch}? A new orchestrator starts in ${r.repo}${r.machine ? ` on ${r.machine}` : ""}, restarting unfinished tasks.`;
}

// The action note and error lines, each with a small × that dismisses it now. A note also goes by
// itself (note.js); an error stays until dismissed, since it needs reading.
export function noteRows(view, t, fixed) {
  const line = (id, text, color, clear) => {
    const row = h_flex().id(id).w_full().px(4).gap(6).items_start().text_size(T(11, "meta")).text_color(color);
    if (fixed) row.flex_none().pt(4);
    return row.child(div().flex_1().min_w(0).child(text))
      .child(div().id(`${id}-x`).flex_none().cursor_pointer().px(3).text_size(T(14, "strong")).text_color(t.dim).hover((s) => s.text_color(t.foreground)).tooltip("Dismiss")
        .on_click((_e, cx) => { cx.stop_propagation(); clear(); cx.notify(); }).child("×"));
  };
  const note = noteText(view);
  return [
    note ? line("action-note", note, t.muted, () => { view.actionNote = null; }) : null,
    view.actionError ? line("action-error", view.actionError, t.blocked, () => { view.actionError = null; }) : null,
  ].filter(Boolean);
}

export function actionButton(t, id, label, tip, onClick, primary = false) {
  const b = div().id(id).flex_none().px(9).h(22).rounded(5).flex().items_center().text_size(T(11.5, "body")).font_medium()
    .bg(primary ? t.accent : t.raised).text_color(primary ? t.background : t.muted);
  // No click: an action is already under way on this card.
  // A greyed-out button still takes its click, so a clickable card around it does not.
  if (!onClick) return b.opacity(0.45).on_click((_e, cx) => cx.stop_propagation()).child(label);
  return b.cursor_pointer().tooltip(tip ?? label)
    .hover((s) => s.opacity(0.85).text_color(primary ? t.background : t.foreground))
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(label);
}

const BUSY = { delete: "Deleting…", park: "Parking…", close: "Closing…" };

// The card's buttons, or, after one is clicked, its question with a confirm and Cancel,
// or, while the confirmed action runs, what it is doing with the buttons dimmed.
// It asks on the card, not in the app's confirm dialog, which can only run a Herdr
// command, not putAway's marker write.
export function actionRow(view, t, r, orch, closed, counts) {
  const busy = view.busy?.[r.key];
  const asking = view.confirm?.key === r.key ? view.confirm.action : null;
  const set = (cx, value) => { view.confirm = value; view.actionError = null; view.actionNote = null; cx.notify(); };
  if (busy) {
    return h_flex().gap(6).justify_end().items_center()
      .child(div().flex_1().text_size(TYPE.meta).text_color(t.muted).child(busy.label))
      .children(actionsOf(r, orch, closed).map((a) => actionButton(t, `${a}-${r.key}`, ACTION[a].label, null, null, a === "resume")));
  }
  // A Close or Resume asked from the need box confirms there, in sight; the row keeps its buttons.
  if (asking && !view.confirm.box) return confirmBlock(view, t, r, orch, counts, asking, r.key);
  return h_flex().gap(6).justify_end()
    .children(actionsOf(r, orch, closed).map((a) => actionButton(t, `${a}-${r.key}`, ACTION[a].label, ACTION[a].tip,
      (cx) => set(cx, { key: r.key, action: a }), a === "resume")));
}

// The question a card asks before `asking` (park, close, delete, resume) with its confirm and
// Cancel, and the confirmed action. `id` keeps the action row's and the need box's apart.
export function confirmBlock(view, t, r, orch, counts, asking, id) {
  const set = (cx, value) => { view.confirm = value; view.actionError = null; view.actionNote = null; cx.notify(); };
  const yes = (cx) => {
    set(cx, null);
    // A resume has no end to wait for here: the run is busy ("Resuming…", on the card and the Bridge's row alike) until a
    // load shows it no longer parked (main.js load) or the busy limit passes, so a second click can't start a second orchestrator.
    if (asking === "resume") { view.busy[r.key] = { label: "Resuming…", at: Date.now(), branch: r.branch, resume: true }; return resumeRun(r); }
    const busy = { label: BUSY[asking], at: Date.now(), branch: r.branch };
    view.busy[r.key] = busy;
    // The click's cx dies with the click; the awaited work notifies through cx.spawn's.
    // Owned by no view, so closing or reloading a copy can't cancel it halfway; the
    // label clears once the action ends, and the view's timer gives up on it after
    // BUSY_LIMIT should the task never end at all.
    cx.spawn(async (cx) => {
      const done = () => {
        if (view.busy[r.key] === busy) delete view.busy[r.key];
        view.redraw = true;
        try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
      };
      try {
        if (asking === "delete") await deleteRun(r, { cx });
        else {
          const note = await putAway(r, asking === "park" ? "parked" : "closed", orch);
          if (note) setNote(view, `${r.branch}: ${note}`);
        }
      } catch (e) { view.actionError = `${r.branch}: ${e?.message ?? e}`; }
      done();
      // Show the outcome now rather than at the next 5 s refresh.
      try { await view.load(cx); } catch { /* the next refresh shows it */ }
    }, { owner: null });
  };
  return v_flex().gap(6).p(8).rounded(7).bg(t.raised)
    .child(div().text_size(T(12, "body")).text_color(t.foreground).child(confirmText(r, asking, counts)))
    .child(h_flex().gap(6)
      .child(actionButton(t, `yes-${id}`, ACTION[asking].label, null, yes, true))
      .child(actionButton(t, `no-${id}`, "Cancel", null, (cx) => set(cx, null))));
}

// A Crew row's edge colour from its name (crewrows.js rowEdge): red for Needs you, amber for a
// stall, a review wait cyan (a calm colour apart from Done's blue), grey for can't tell; a run
// at work or briefly idle takes the border's: fine needs no colour.
// Rows add their own alpha to the edge colour ("…14"), so it must be opaque: theme colours
// such as border can carry alpha (#ffffff18), which would make "#ffffff1814", not a colour.
// Such a colour is laid over the sidebar's own (`bg`) as it would show there, so a faint border
// stays faint rather than turning into its full, unfaded colour.
const hex = (c, i) => parseInt(c.slice(i, i + 2), 16);

function opaque(c, bg = null) {
  if (typeof c !== "string" || !/^#[0-9a-f]{8}$/i.test(c)) return c;
  if (typeof bg !== "string" || !/^#[0-9a-f]{6}/i.test(bg)) return c.slice(0, 7);
  const a = hex(c, 7) / 255;
  return `#${[1, 3, 5].map((i) => Math.round(hex(c, i) * a + hex(bg, i) * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
}

// The selected Crew row's fill: the accent faintly over the sidebar, on any edge colour.
export const SELECTED = (t) => opaque(`${opaque(t.accent)}40`, t.chrome);

export const edgeColor = (t, edge) => opaque(edge === "amber" ? AMBER(t) : edge === "pass" ? PASS(t) : edge === "review" ? t.ansi6 ?? t.accent : edge === "neutral" ? t.border : t[edge] ?? t.border, t.chrome);

// Status colours, one meaning each: red = you must act (a failure, Needs you); amber = look soon
// (a stall, CI past its usual time, partial or missing proof); cyan = waiting on a reviewer;
// no colour = fine (work going on, CI within its usual time, a wait on the orchestrator). The
// spinner (runDot) says a run works. Green for a pass and green checks (the theme's green,
// apart from done's blue). Amber is the theme's working colour, so no row's edge, tint, pill,
// status text, task strip segment or agent row's stage text uses it for work going on: the task
// strip's Implementing segments are a neutral bright tone (STAGE), and amber there is only
// proof that wants a look. A passed proof marks a done segment (a green underline) rather than
// recolouring done. Herdr's own Agents list is not Harbormaster's and keeps its colours.
export const PASS = (t) => t.ansi2 ?? "#3fa055";

export const AMBER = (t) => t.working;

// Folds with a header (Claims, Decisions, Tokens) look the same: a dim chevron, the section's
// name in semibold, then a one-line summary in normal text; colour only on status words. Open state per key in
// view.folds, closed by default and not persisted.
export const isOpen = (view, key) => Boolean(view.folds?.get(key));

// The props of a run's own pane. Herdr stores pane props as given and shows them on every
// screen of the run's machine, while a run's key and terminal address carry this screen's
// name for that machine ("local-ssh:" here, none on the machine itself). So the pane names
// the run by what every screen reads the same: its directory and its orchestrator's
// terminal as its own machine names it.
export const runProps = (r) => ({ role: "run", dir: r.dir, terminal: r.localTerminal });

// Close all merged, from the Crew's Done heading: closes each run as its card's Close does
// (data.js putAway), one at a time, after the heading asked, naming how many.
const CLOSE_ALL_KEY = "done:close-all";

function closeAll(view, runs, ctx, cx) {
  if (!runs.length) return;
  const at = Date.now();
  const batch = { label: `Closing ${plural(runs.length, "merged run")}…`, at, branch: "merged runs", limit: 2 * 60000 + runs.length * 30000 };
  view.busy[CLOSE_ALL_KEY] = batch;
  for (const r of runs) view.busy[r.key] = { label: "Closing…", at, branch: r.branch, limit: batch.limit };
  const orchs = new Map(runs.map((r) => [r.key, orchestratorState(r, ctx)]));
  // As a card's action: owned by no view, notifying through cx.spawn's cx.
  cx.spawn(async (cx) => {
    const failed = [], notes = [];
    for (const r of runs) {
      try {
        const note = await putAway(r, "closed", orchs.get(r.key));
        if (note && /blocked/.test(note)) notes.push(`${r.branch}: ${note}`);
      } catch (e) { failed.push(`${r.branch} (${e?.message ?? e})`); }
      if (view.busy[r.key]?.at === at) delete view.busy[r.key];
    }
    if (view.busy[CLOSE_ALL_KEY]?.at === at) delete view.busy[CLOSE_ALL_KEY];
    const done = runs.length - failed.length;
    setNote(view, [done ? `Closing ${plural(done, "merged run")}: their orchestrators clean up and close their tabs.` : null, ...notes].filter(Boolean).join("\n") || null);
    if (failed.length) view.actionError = `${failed.length} not closed: ${failed.join("; ")}`;
    view.redraw = true;
    try { cx.notify(); } catch { /* no view to redraw; the timer will */ }
    try { await view.load(cx); } catch { /* the next refresh shows it */ }
  }, { owner: null });
}

// The Done heading's right side: Close all merged, its question once clicked, or what it is doing.
export function closeAllControl(view, t, rows, ctx) {
  const busy = view.busy?.[CLOSE_ALL_KEY];
  if (busy) return { button: div().flex_none().text_size(T(10.5, "meta")).font_normal().text_color(t.muted).child(busy.label), confirm: null };
  const runs = closableDone(rows, view.busy ?? {});
  if (!runs.length) return { button: null, confirm: null };
  const set = (cx, value) => { view.confirm = value; view.actionError = null; view.actionNote = null; cx.notify(); };
  if (view.confirm?.key !== CLOSE_ALL_KEY) {
    return { button: actionButton(t, "close-all-merged", "Close all merged",
      `Close ${plural(runs.length, "run")} whose pull requests are all merged or closed, as each card's Close does`,
      (cx) => set(cx, { key: CLOSE_ALL_KEY })), confirm: null };
  }
  const names = runs.map((r) => r.branch).join(", ");
  return {
    button: null,
    confirm: v_flex().id("close-all-confirm").flex_none().gap(6).p(8).rounded(7).bg(t.raised)
      .child(div().text_size(T(12, "body")).text_color(t.foreground)
        .child(`Close ${plural(runs.length, "merged run")} (${names})? Each orchestrator pushes what isn't pushed, deletes the worktrees and closes its tab; branches and PRs stay.`))
      .child(h_flex().gap(6)
        .child(actionButton(t, "close-all-yes", `Close ${runs.length}`, null, (cx) => { set(cx, null); closeAll(view, runs, ctx, cx); }, true))
        .child(actionButton(t, "close-all-no", "Cancel", null, (cx) => set(cx, null)))),
  };
}
