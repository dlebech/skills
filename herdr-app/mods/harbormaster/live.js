// Live facts from herdr-core (terminals, agents, panes) and the few actions the views take.

import { isWake } from "./wake.js";
import { openable } from "./media.js";
import { exec, terminals, agents, panes, spaces, run, window, focused } from "herdr";

// The terminal and agent lists every helper below reads, taken once per render.
// A detached wake-up send (wake.js) is neither a terminal nor an agent of the crew.
export const facts = () => {
  const ts = terminals().filter((t) => !isWake(t));
  const gone = new Set(terminals().filter(isWake).map((t) => t.address));
  return { terminals: ts, agents: agents().filter((a) => !gone.has(a.address)) };
};

// One status rule for any agent: its agent status, else its terminal's ("error" means
// blocked), else idle. Values: working, blocked, done, idle.
export function agentStatus(term, ctx) {
  const s = ctx.agents.find((a) => a.address === term.address)?.status ?? term.status;
  return s === "error" ? "blocked" : s ?? "idle";
}

// An agent's status exactly as reported, or null when it reports none: unlike agentStatus
// it does not call an unknown status idle, for what must only happen to an idle agent.
export function exactStatus(address, ctx) {
  const s = reportedStatus(address, ctx);
  return s === "error" ? "blocked" : s;
}

// The status as reported, `error` included: hc delivers a send to a terminal in error, and
// only refuses one that is blocked on a dialog.
export function reportedStatus(address, ctx) {
  if (!address) return null;
  return ctx.agents.find((a) => a.address === address)?.status ?? ctx.terminals.find((t) => t.address === address)?.status ?? null;
}

// Whether the orchestrator is lost: its terminal is live but only a shell runs in it
// (its program now, not the command it started with), with no agent status.
// herdr-core keeps terminals across a restart but replaces their lost programs with a
// shell (hc keep), so after a reboot the orchestrator's terminal and tab come back
// without it; so does a terminal whose agent exited.
export function orchestratorLost(run, ctx) {
  if (run.superseded) return false;
  const term = run.terminal && ctx.terminals.find((t) => t.address === run.terminal);
  if (!term || term.state !== "live" || term.status) return false;
  const a = ctx.agents.find((x) => x.address === run.terminal);
  if (a?.status && a.status !== "idle") return false;
  const pane = panes().find((p) => p.terminal === run.terminal);
  return (term.program ?? pane?.program)?.shell === true;
}

// The orchestrator's status, or "gone" when its terminal has ended or is lost. Worked out once per run per
// facts() snapshot: a render asks for it many times (the Crew, the Bridge's queue, its lines, each card).
const states = new WeakMap();

export function orchestratorState(run, ctx) {
  let m = states.get(ctx);
  if (!m) states.set(ctx, (m = new Map()));
  if (!m.has(run)) m.set(run, orchestratorStateOf(run, ctx));
  return m.get(run);
}

// A run directory as its orchestrator's run.dir label names it (set-status.sh): "<folder>/<branch>",
// the same on every machine and however the runs root was spelled.
export const runDirLabel = (dir) => String(dir ?? "").split("/").filter(Boolean).slice(-2).join("/");

// The runs whose orchestrator's terminal now serves another run. An agent that finishes one run
// and starts the next in the same terminal leaves both orchestrator.json files naming it, so the
// Crew had one row for the two and the other run had none, while the Bridge still listed it.
// The terminal's run.dir label names the run it serves; a terminal without one (labelled before
// set-status.sh set it) serves the run started last. A label naming none of them (a run since
// deleted) supersedes them all. With no way to tell, none is superseded.
// A superseded run's orchestrator is gone: finished, it counts as closed; else it needs a Resume.
export function supersededRuns(runs, ctx) {
  const byTerminal = new Map();
  for (const r of runs) if (r.terminal) byTerminal.set(r.terminal, [...(byTerminal.get(r.terminal) ?? []), r]);
  const out = new Set();
  for (const [address, list] of byTerminal) {
    if (list.length < 2) continue;
    const label = ctx.terminals.find((t) => t.address === address)?.labels?.["run.dir"];
    let owner = label ? list.find((r) => runDirLabel(r.dir) === label) : null;
    if (label && !owner) { for (const r of list) out.add(r); continue; }
    if (!owner) {
      const latest = Math.max(...list.map((r) => r.started ?? 0));
      const newest = list.filter((r) => (r.started ?? 0) === latest);
      if (latest > 0 && newest.length === 1) owner = newest[0];
    }
    if (owner) for (const r of list) if (r !== owner) out.add(r);
  }
  return out;
}

function orchestratorStateOf(run, ctx) {
  if (run.superseded) return "gone";
  const term = run.terminal && ctx.terminals.find((t) => t.address === run.terminal);
  if (!ctx.agents.some((a) => a.address === run.terminal) && (!term || term.state !== "live")) return "gone";
  if (orchestratorLost(run, ctx)) return "gone";
  return agentStatus(term ?? { address: run.terminal }, ctx);
}

// Live sub-agents of an address, depth first.
export function workersOf(address, ctx) {
  if (!address) return [];
  const kids = ctx.terminals.filter((t) => t.parent === address && t.state === "live");
  return kids.flatMap((t) => [t, ...workersOf(t.address, ctx)]);
}

// What runs in a terminal, for its icon: the agent's program, else the terminal's or its pane's.
export const programOf = (term, ctx) =>
  ctx.agents.find((a) => a.address === term.address)?.program ?? term.program ?? panes().find((p) => p.terminal === term.address)?.program;

// Agents adrift: every agent that is none of `roots` (addresses) or their workers.
export function adrift(roots, ctx) {
  const crew = new Set(roots.filter(Boolean).flatMap((a) => [a, ...workersOf(a, ctx).map((w) => w.address)]));
  return ctx.agents.filter((a) => !crew.has(a.address));
}

// An agent's name as Herdr's own Agents list gives it: the tab's name when someone
// named it (other than after the program), else the agent's own title (Claude Code
// sets one from its session) with leading symbols stripped, unless that title is just
// the program, a path, or user@host. Never a bare tab number when anything else will do.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
export function agentName(a) {
  const tab = tabInfo(a.tab);
  const prog = a.program?.name;
  const live = clean(a.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== a.program?.key;
  const tabName = tab?.name ?? a.tab_name ?? "";
  if (tab?.named && tabName !== prog) return tabName;
  if (telling) return live;
  return /^\d+$/.test(tabName) ? prog || tabName : tabName || prog || a.address;
}

// agentName() for each of a list, with the tab's own name (its number when unnamed)
// added where two rows in the same `scope` would otherwise read the same.
export function agentNames(list, scope = () => "") {
  const names = list.map(agentName);
  const key = (a, i) => `${scope(a)}\u001f${names[i]}`;
  const count = new Map();
  list.forEach((a, i) => count.set(key(a, i), (count.get(key(a, i)) ?? 0) + 1));
  return list.map((a, i) => (count.get(key(a, i)) > 1 && a.tab_name && a.tab_name !== names[i] ? `${names[i]} · ${a.tab_name}` : names[i]));
}

// The live orchestrators' terminals, as the Crew block lists them.
export const orchestratorsOf = (ctx) => ctx.terminals.filter((t) => t.state === "live" && t.labels?.role === "orchestrator");

// The addresses whose context size the crew and the Bridge show: the captain and the orchestrators.
export const crewAddresses = (ctx) => [captainOf(ctx).terminal?.address, ...orchestratorsOf(ctx).map((t) => t.address)].filter(Boolean);

export function captainOf(ctx) {
  const live = ctx.terminals.filter((t) => t.state === "live");
  const terminal = live.find((t) => t.labels?.role === "captain") ?? null;
  const watching = live.some((t) => t.name === "captain-watch" || t.address?.endsWith("/captain-watch"));
  return { terminal, watching };
}

// Does this run need the person? An open question, a waiting or blocked plan, or an
// orchestrator blocked on a dialog. A finished, parked or closed run never does.
export function needsYou(run, orchState) {
  if (run.phase === "finished" || run.away) return false;
  return Boolean(run.question) || run.phase === "waiting" || run.phase === "blocked" || orchState === "blocked";
}

// What a run needs the person for, in a few words: the question's first line, the
// dialog, or the reason in the plan's Status line. null when it doesn't need them.
// The question comes first, so it matches a view's "Waiting for your answer".
export function needReason(run, orchState) {
  if (!needsYou(run, orchState)) return null;
  if (run.ask) return run.ask.title;
  if (orchState === "blocked") return "blocked on a dialog";
  const why = (run.statusLine ?? "").replace(/^(waiting for user|blocked)\s*:?\s*/i, "").trim();
  return why || (run.phase === "blocked" ? "blocked" : "waiting for you");
}

// The focused agent, as Herdr's own Agents list marks it. While a mod pane has focus, such
// as the Harbormaster pane pinned beside the captain or an orchestrator, no agent does:
// then the one of `crew` (addresses) whose terminal is in that pane's tab.
export function currentAgent(ctx, crew) {
  const a = ctx.agents.find((x) => x.focused)?.address;
  if (a) return a;
  const f = focused();
  if (!f?.pane || f.terminal) return null;
  const tab = panes().find((p) => p.pane === f.pane)?.tab ?? f.tab;
  return crew.find((addr) => tabOfTerminal(addr) === tab) ?? null;
}

// Where a Harbormaster pane can go beside an agent's terminal: { pane: null } when that
// terminal is not on screen (parked); else its pane and the Harbormaster pane pinned
// beside it in the same tab, if any.
export function paneBeside(address) {
  const all = panes();
  const own = all.find((p) => p.terminal === address);
  if (!own) return { pane: null, pinned: null };
  return { pane: own.pane, pinned: all.find((p) => p.tab === own.tab && p.mod === "harbormaster")?.pane ?? null };
}

// Where the runs pane can go: null without a captain, else paneBeside() the captain.
export function captainPane(ctx) {
  const cap = captainOf(ctx).terminal;
  return cap ? paneBeside(cap.address) : null;
}

// Shows a Harbormaster pane right of an agent (the Bridge, or with `props` another
// view, such as one run's card), or closes it again.
export function togglePin(spot, props = undefined) {
  if (spot.pinned) run("pane.close", { pane: spot.pinned });
  else if (spot.pane) run("pane.split", { pane: spot.pane, direction: "right", mod: "harbormaster", ...(props ? { props } : {}) });
}

// Focuses an agent and makes sure a Harbormaster pane is open beside it (the runs
// Bridge, or with `props` another view, such as one run's card). Never closes one, so
// clicking again only focuses; close the pane with Herdr's own pane close.
export function focusWithPane(address, props = undefined) {
  focusAgent(address);
  const spot = paneBeside(address);
  if (spot.pinned || !spot.pane) return;
  run("pane.split", { pane: spot.pane, direction: "right", mod: "harbormaster", ...(props ? { props } : {}) });
  // By pane id: pane.focus {terminal} would prefer a layout block showing the same terminal.
  run("pane.focus", { pane: spot.pane });
}

// The orchestrator's tab: the tab holding its terminal now, else orchestrator.json's.
export function tabOf(run) {
  if (run.superseded) return null;
  return liveTabOf(run) ?? run.tab ?? null;
}

// Where the run's repository is open: the space on the run's machine whose first tab's
// first pane is in its folder, the repository's own checkout (never the integration
// worktree's space). The space's creation folder counts only when no pane reports one.
export function homeSpace(run) {
  const ps = panes();
  return spaces().find((s) => {
    if ((s.machine ?? null) !== (run.machine ?? null)) return false;
    const first = s.tabs?.[0]?.id;
    const cwd = first ? ps.find((p) => p.tab === first)?.cwd : null;
    return (cwd || s.folder) === run.folder;
  }) ?? null;
}

// The spaces on the run's machine that show one of `paths`, its integration worktrees:
// the first pane of the space's first tab is in one, or with no pane reporting a
// folder, the space was made on one, as herdr-app-orchestrator's
// integration-worktree.sh matches them. Only a space made on a worktree (or with no
// folder of its own) counts, so a repository's own space whose first terminal was cd'd
// into a worktree is left alone.
export function worktreeSpaces(run, paths) {
  const ps = panes();
  const inside = (dir) => !!dir && paths.some((p) => dir === p || dir.startsWith(`${p}/`));
  return spaces().filter((s) => {
    if ((s.machine ?? null) !== (run.machine ?? null)) return false;
    if (s.folder && !inside(s.folder)) return false;
    const first = s.tabs?.[0]?.id;
    return inside((first ? ps.find((p) => p.tab === first)?.cwd : null) || s.folder);
  });
}

// The spaces on the run's machine that were on its integration worktree by its
// default path, ~/.herdr/worktrees/<repo>/<run-directory name> (integration-worktree.sh
// names both after the branch the same way), as {id, path}: the space's folder or its
// first pane's. For spaces left behind once the worktree is gone, when git no longer
// lists it; the caller checks the path is gone before closing one. The repository
// segment is any, as a run over a folder of several repositories has worktrees under
// each. As in worktreeSpaces, only a space made on such a folder (or with no folder of
// its own) counts, so a repository's own space whose first terminal was cd'd into the
// worktree is left alone.
export function leftoverSpaces(run) {
  const slug = run.dir.split("/").at(-1);
  const re = new RegExp(`^(.*/\\.herdr/worktrees/[^/]+/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?:/|$)`);
  const ps = panes();
  return spaces().flatMap((s) => {
    if ((s.machine ?? null) !== (run.machine ?? null)) return [];
    if (s.folder) {
      const path = re.exec(s.folder)?.[1];
      return path ? [{ id: s.id, path }] : [];
    }
    const first = s.tabs?.[0]?.id;
    const path = re.exec((first ? ps.find((p) => p.tab === first)?.cwd : null) || "")?.[1];
    return path ? [{ id: s.id, path }] : [];
  });
}

// A tab in the window by its id ({id, name, named, ...}), or null.
export const tabInfo = (id) => (id && spaces().flatMap((s) => s.tabs ?? []).find((t) => t.id === id)) || null;

// The tab holding the orchestrator's terminal now, or null when no pane shows it.
// Unlike tabOf, never orchestrator.json's tab, which may be a tab long gone.
// None for a superseded run (supersededRuns): the tab is the run's that took its terminal, so
// Park, Close and the closed and parked tidies must not close it, nor a rename name it.
export const liveTabOf = (run) => (run.superseded ? null : tabOfTerminal(run.terminal));

// The tab holding a terminal now, or null when no pane shows it.
export const tabOfTerminal = (address) => (address && panes().find((p) => p.terminal === address)?.tab) || null;

// Shows an agent: focuses its pane, or, for a sub-agent no pane shows (a run's hidden
// implementers and reviewers), peeks at it over the tab, since agent.focus leaves the
// window as it was for those.
export function focusAgent(address) {
  if (!address) return;
  const term = terminals().find((t) => t.address === address);
  const shown = panes().some((p) => p.terminal === address);
  if (term?.parent && !shown) run("terminal.peek", { terminal: address });
  else run("agent.focus", { terminal: address });
}

// Types an answer into the captain's input as a reply to one decision, naming the decision
// (id and question) so the captain knows which it is for, and shows the captain.
export function replyToCaptain(address, decision, text) {
  const q = decision.question.replace(/\s+/g, " ").slice(0, 200);
  const msg = `Re decision "${decision.id}" (${q}): ${text}`;
  exec("hc", ["send", address, msg]).catch(() => {});
  focusAgent(address);
}

export function openUrl(url) {
  // A second line of defence: hand the system opener only a web page or a local path, never file:, smb: or a custom scheme.
  if (!openable(url)) { console.log(`harbormaster: not opening ${String(url).slice(0, 80)}`); return; }
  const platform = window()?.platform;
  const cmd = platform === "macos" ? "open" : platform === "windows" ? "explorer" : "xdg-open";
  exec(cmd, [url]).catch(() => {});
}

// Closes this pane. A mod doesn't know its own pane, but clicking it gives it focus, so
// the button closes the focused pane, and only when that is a Harbormaster pane.
export function closeOwnPane() {
  const f = focused();
  if (f?.pane && panes().find((x) => x.pane === f.pane)?.mod === "harbormaster") run("pane.close", { pane: f.pane });
}

// Opens the stats view (props.role "stats") in a tab of its own, or shows the one already open:
// a tab named "Stats" whose only pane is Harbormaster.
export function openStats() {
  for (const s of spaces()) {
    const tab = (s.tabs ?? []).find((t) => t.name === "Stats" && t.panes === 1 && panes().some((p) => p.tab === t.id && p.mod === "harbormaster"));
    if (!tab) continue;
    run("space.select", { id: s.id });
    run("tab.select", { id: tab.id });
    return;
  }
  run("tab.new", { name: "Stats", mod: "harbormaster", props: { role: "stats" } });
}
