// What Harbor 3D (the browser view in herdr-app/harbor3d) is told about the runs: one JSON
// facts file in the runs root, written from what the Crew already knows, so the 3D scene always
// agrees with it and the server never reads run folders or calls gh. The contract is
// shared/harbor3d-contract.md section 1 (v: 1). Every value that is not a name leaves through a
// table or function below with a default, so an unknown word never goes out as free text.
//
// The first half is pure (sceneFacts, shouldWrite); exportFacts at the end is the one part
// that touches the disk, through exec, as resources.js does.

import { exec, checking } from "herdr";
import { taskStage, isDropped } from "./tasks.js";
import { runName } from "./ui.js";
import { chunks } from "./resources.js";

// At most this many drifting agents go out, as many as the Crew draws.
const ADRIFT_MAX = 12;
// The want file must be this young, and a changed file is written at most this often unchanged.
export const WANT_MAX_MS = 60000, REWRITE_MS = 15000;

// Looks `key` up in `table`, else `fallback`: an unknown word never leaves as itself.
const pick = (table, key, fallback) => (Object.hasOwn(table, key) ? table[key] : fallback);

const TYPES = { feat: "feat", fix: "fix", rev: "rev", expl: "expl" };
const NEEDS = {
  question: "question", gone: "gone", stalled: "stalled", "red-ci": "red-ci", "request review": "request-review",
  "changes requested": "changes-requested", "approved — merge": "merge", "review proof → merge": "review-proof",
  finished: "finished", "review-pending": "other",
};
const PR_STATES = { OPEN: "open", DRAFT: "draft", MERGED: "merged", CLOSED: "closed" };
const TASK_STAGES = new Set(["planned", "implement", "review", "fix", "done", "blocked"]);
const AGENT_STATES = new Set(["working", "idle", "blocked", "done"]);
const PATH_KEYS = new Set(["spec", "build", "proven", "review", "human", "merge"]);
const PATH_STATES = new Set(["done", "current", "you", "look", "fail", "todo"]);
const CAPTAIN_STATES = new Set(["watching", "idle", "working"]);

// The run's phase: planning until it has planned tasks, finished, else running.
export const phaseOf = (r, planned) => (r.phase === "finished" ? "finished" : planned === 0 ? "planning" : "running");

// What the run needs you for: the first reason's key, mapped; null when it does not need you.
export const needOf = (needs, att) => (needs ? pick(NEEDS, att?.reasons?.[0]?.key, "other") : null);

export const prState = (state) => pick(PR_STATES, state, "unknown");

// A PR's checks as one word (data.js prSummary's `checks` counts).
export function checksOf(p) {
  const c = p?.checks;
  return c?.fail > 0 ? "red" : c?.pending > 0 ? "running" : c?.pass > 0 ? "green" : "none";
}

// The program in a terminal, by the names Herdr gives (`key`, else `name`).
export function kindOf(program) {
  const s = `${program?.key ?? ""} ${program?.name ?? ""}`.toLowerCase();
  return /claude/.test(s) ? "claude" : /\bpi\b/.test(s) ? "pi" : /opencode/.test(s) ? "opencode" : "other";
}

const agentState = (s) => (AGENT_STATES.has(s) ? s : "idle");
const orchState = (s, finished) => (s === "gone" ? "gone" : finished && (s === "idle" || s === "done") ? "done" : agentState(s));
const num = (v) => (Number.isFinite(v) ? v : null);

// One run's entry. `row` = { r, f, path }: the run, its runFacts and its mergePath stages.
function runEntry({ r, f, path }, agentStatus, programOf) {
  const kept = [];
  r.tasks.forEach((t, i) => { if (!isDropped(t.state)) kept.push(i); });
  const planned = f.counts?.planned ?? 0;
  // Each worker's task: its place in the list with dropped tasks left out.
  const taskOf = new Map();
  (f.stages ?? []).forEach((s, i) => { const k = kept.indexOf(i); if (k >= 0) for (const a of s.agents ?? []) taskOf.set(a.agent.address, k); });
  const finished = r.phase === "finished";
  return {
    key: String(r.key), name: String(runName(r.branch, r.topic).title || r.key), repo: String(r.repo ?? ""),
    type: pick(TYPES, r.type, null), phase: phaseOf(r, planned), parked: Boolean(f.parked), needsYou: Boolean(f.need),
    need: needOf(f.need, f.att),
    path: (path ?? []).filter((s) => PATH_KEYS.has(s.key)).map((s) => ({ key: s.key, state: PATH_STATES.has(s.state) ? s.state : "todo" })),
    tasks: kept.map((i) => { const s = taskStage(r.tasks[i].state) ?? "implement"; return TASK_STAGES.has(s) ? s : "implement"; }),
    prs: f.prs.map((p) => ({ number: num(p.number), state: prState(p.state), checks: checksOf(p) })),
    ciRunning: f.att?.reasons?.[0]?.key === "ci-running",
    orchestrator: { state: orchState(f.orch, finished), kind: kindOf(programOf({ address: r.terminal })) },
    workers: f.workers.map((w) => ({ id: String(w.address), name: String(w.name || w.program?.name || w.address), kind: kindOf(programOf(w)), state: agentState(agentStatus(w)), task: taskOf.get(w.address) ?? null })),
    tokens: num(r.tokens?.total) ?? 0, startedMs: num(r.started), updatedMs: num(r.updated),
  };
}

// The facts object (contract section 1). `rows`: one { r, f, path } per run on this computer
// that is open or parked; `extras`: { now, captain: { terminal, watching }, adrift: [{ address,
// name, program, status }], agentState(term), programOf(term) }. Remote and closed runs are left out.
export function sceneFacts(rows, { now, captain, adrift, agentState: agentStatus = (t) => t?.status, programOf = (t) => t?.program }) {
  const cap = captain?.terminal ? (captain.watching ? "watching" : agentStatus(captain.terminal) === "working" ? "working" : "idle") : "none";
  return {
    v: 1, at: now,
    captain: { state: CAPTAIN_STATES.has(cap) ? cap : "none" },
    runs: rows.filter(({ r, f }) => !r.machine && !f.closed).map((row) => runEntry(row, agentStatus, programOf)),
    adrift: (adrift ?? []).slice(0, ADRIFT_MAX).map((a) => ({ id: String(a.address), name: String(a.name ?? a.address), kind: kindOf(a.program), state: agentState(a.status) })),
  };
}

// Whether to write now: the want file must be young, then only a changed file (`json`, the text
// without `at`, against the last write's) or one older than REWRITE_MS goes out.
export function shouldWrite({ wantAgeMs, lastJson, json, sinceLastMs }) {
  if (wantAgeMs == null || !(wantAgeMs < WANT_MAX_MS)) return false;
  return lastJson == null || json !== lastJson || !(sinceLastMs < REWRITE_MS);
}

// ---- the disk part ----

// Prints the runs root, then 1 when `.harbor3d.want` is under a minute old: one find per refresh.
const WANT = 'r="${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}"; printf "%s\\n" "$r"; [ -n "$(find "$r/.harbor3d.want" -maxdepth 0 -mmin -1 2>/dev/null)" ] && echo 1; exit 0';
// Writes the arguments joined to <root>/.harbor3d.json through a temporary file in the same folder and mv.
const PUT = 'r=$1; shift; printf "%s" "$@" >"$r/.harbor3d.json.tmp$$" && mv "$r/.harbor3d.json.tmp$$" "$r/.harbor3d.json" || { rm -f "$r/.harbor3d.json.tmp$$"; exit 1; }';

let last = { json: null, at: 0 };

// Called on each data refresh of the Crew: when Harbor 3D's server asked (the want file), writes the
// facts file when they changed or 15 s passed. `build()` makes the facts; it only runs when asked.
export async function exportFacts(build) {
  if (checking()) return;
  const w = await exec("sh", ["-c", WANT]).catch(() => null);
  const lines = (w?.stdout ?? "").split("\n").filter(Boolean);
  if (!lines.length || lines[1] !== "1") return;
  const facts = build();
  const { at, ...rest } = facts;
  const json = JSON.stringify(rest);
  const now = Date.now();
  if (!shouldWrite({ wantAgeMs: 0, lastJson: last.json, json, sinceLastMs: now - last.at })) return;
  const r = await exec("sh", ["-c", PUT, "sh", lines[0], ...chunks(JSON.stringify({ v: facts.v, at, ...rest }))]).catch(() => null);
  if (r?.code === 0) last = { json, at: now };
}
