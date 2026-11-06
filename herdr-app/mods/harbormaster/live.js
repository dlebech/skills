// Live facts from herdr-core (terminals, agents, panes) and the few actions the views take.

import { exec, terminals, agents, panes, spaces, run, window } from "herdr";

// The terminal and agent lists every helper below reads, taken once per render.
export const facts = () => ({ terminals: terminals(), agents: agents() });

// One status rule for any agent: its agent status, else its terminal's ("error" means
// blocked), else idle. Values: working, blocked, done, idle.
export function agentStatus(term, ctx) {
  const s = ctx.agents.find((a) => a.address === term.address)?.status ?? term.status;
  return s === "error" ? "blocked" : s ?? "idle";
}

// Whether the orchestrator is lost: its terminal is live but only a shell runs in it
// (its program now, not the command it started with), with no agent status.
// herdr-core keeps terminals across a restart but replaces their lost programs with a
// shell (hc keep), so after a reboot the orchestrator's terminal and tab come back
// without it; so does a terminal whose agent exited.
export function orchestratorLost(run, ctx) {
  const term = run.terminal && ctx.terminals.find((t) => t.address === run.terminal);
  if (!term || term.state !== "live" || term.status) return false;
  const a = ctx.agents.find((x) => x.address === run.terminal);
  if (a?.status && a.status !== "idle") return false;
  const pane = panes().find((p) => p.terminal === run.terminal);
  return (term.program ?? pane?.program)?.shell === true;
}

// The orchestrator's status, or "gone" when its terminal has ended or is lost.
export function orchestratorState(run, ctx) {
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
  const tab = spaces().flatMap((s) => s.tabs ?? []).find((t) => t.id === a.tab);
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

// The addresses whose context size the crew and the overview show: the captain and the orchestrators.
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
  const question = run.question?.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean);
  if (question) return question;
  if (orchState === "blocked") return "blocked on a dialog";
  const why = (run.statusLine ?? "").replace(/^(waiting for user|blocked)\s*:?\s*/i, "").trim();
  return why || (run.phase === "blocked" ? "blocked" : "waiting for you");
}

// Where the runs pane can go: null without a captain; { pane: null } when the captain's
// terminal is not on screen (parked); else its pane and the Harbormaster pane pinned
// beside it in the same tab, if any.
export function captainPane(ctx) {
  const cap = captainOf(ctx).terminal;
  if (!cap) return null;
  const all = panes();
  const own = all.find((p) => p.terminal === cap.address);
  if (!own) return { pane: null, pinned: null };
  return { pane: own.pane, pinned: all.find((p) => p.tab === own.tab && p.mod === "harbormaster")?.pane ?? null };
}

// Shows the runs overview as a pane right of the captain, or closes it again.
export function togglePin(captain) {
  if (captain.pinned) run("pane.close", { pane: captain.pinned });
  else if (captain.pane) run("pane.split", { pane: captain.pane, direction: "right", mod: "harbormaster" });
}

// The orchestrator's tab: the tab holding its terminal now, else orchestrator.json's.
export function tabOf(run) {
  return (run.terminal && panes().find((p) => p.terminal === run.terminal)?.tab) || run.tab || null;
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

export function focusAgent(address) {
  if (address) run("agent.focus", { terminal: address });
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
  const platform = window()?.platform;
  const cmd = platform === "macos" ? "open" : platform === "windows" ? "explorer" : "xdg-open";
  exec(cmd, [url]).catch(() => {});
}
