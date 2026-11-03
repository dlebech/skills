// Live facts from herdr-core (terminals, agents, panes) and the few actions the views take.

import { exec, terminals, agents, panes, run, window } from "herdr";

// The terminal and agent lists every helper below reads, taken once per render.
export const facts = () => ({ terminals: terminals(), agents: agents() });

// One status rule for any agent: its agent status, else its terminal's ("error" means
// blocked), else idle. Values: working, blocked, done, idle.
export function agentStatus(term, ctx) {
  const s = ctx.agents.find((a) => a.address === term.address)?.status ?? term.status;
  return s === "error" ? "blocked" : s ?? "idle";
}

// The orchestrator's status, or "gone" when its terminal has ended.
export function orchestratorState(run, ctx) {
  const term = run.terminal && ctx.terminals.find((t) => t.address === run.terminal);
  if (!ctx.agents.some((a) => a.address === run.terminal) && (!term || term.state !== "live")) return "gone";
  return agentStatus(term ?? { address: run.terminal }, ctx);
}

// Live sub-agents of an address, depth first.
export function workersOf(address, ctx) {
  if (!address) return [];
  const kids = ctx.terminals.filter((t) => t.parent === address && t.state === "live");
  return kids.flatMap((t) => [t, ...workersOf(t.address, ctx)]);
}

export function captainOf(ctx) {
  const live = ctx.terminals.filter((t) => t.state === "live");
  const terminal = live.find((t) => t.labels?.role === "captain") ?? null;
  const watching = live.some((t) => t.name === "captain-watch" || t.address?.endsWith("/captain-watch"));
  return { terminal, watching };
}

// Does this run need the person? An open question, a blocked plan, or a blocked orchestrator.
export function needsYou(run, orchState) {
  return Boolean(run.question) || run.phase === "waiting" || run.phase === "blocked" || orchState === "blocked";
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

export function focusAgent(address) {
  if (address) run("agent.focus", { terminal: address });
}

export function openUrl(url) {
  const platform = window()?.platform;
  const cmd = platform === "macos" ? "open" : platform === "windows" ? "explorer" : "xdg-open";
  exec(cmd, [url]).catch(() => {});
}
