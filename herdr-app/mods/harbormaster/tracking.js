// The times and settings attention.js's rules read, kept as runs are polled:
//   - when each run's step (progress line and plan task states) last changed: shared state
//     harbormaster.steps, {[run key]: {sig, since}}, persisted, so a run's age survives a
//     Harbormaster reload or an app restart. Written only when a step changes (rare). A run
//     seen for the first time is dated by status.json's `updated` (set-status.sh writes it
//     with every progress change, so it is at or after the real change). Beside it, `parts`:
//     when each part of the step began, the progress line and each task at work by its state
//     and stage (attention.js stepParts), so a step names its own age, not the time since
//     anything in the run moved; only the current parts are kept.
//   - when its agents last showed a sign of life: a change in the orchestrator's and its
//     agents' status or turn count (hc ls `turn`), an agent starting or ending, or new
//     terminal output. Module memory only: it changes every few seconds while agents work,
//     and writing shared state that often would redraw every mod. After a reload it starts
//     afresh at the first poll, so a run cannot be called stalled for STALL_MS after a reload:
//     too late rather than wrong. Terminal output is not something the mod API reports (panes
//     refresh only on scroll-state transitions), so the screens of a run quiet by every other
//     sign for STALL_MS minus 5 minutes are read with `hc read` once a minute (every 5 once
//     it is stalled; never while its orchestrator is gone or lost), and a change
//     in their words (digits and symbols left out, so a spinner or a ticking timer is not
//     output) counts as life. The one exception, the idle anchor attention.js idleAsking reads,
//     is also kept in shared state harbormaster.agents (see `activity` below).
//   - each repository's finished CI runs: shared state harbormaster.ci, {[owner/repo]: [{sha, ms}]},
//     the last CI_KEEP per repository, from the PRs' statusCheckRollup (first check started to
//     last completed, once per head commit). The run history (.history.jsonl) has no usable
//     figure: its ci_wait is a run's total time in `gh run watch` and the like, not one CI
//     run's duration, and it counts only CI an agent watched.
//   - the review flow per repository folder: shared state harbormaster.reviewFlows,
//     {[folder name]: "peer" | "self"}, the user's choices over attention.js DEFAULT_FLOWS.
//   - the user's "waiting on someone…" marks: waiting-on.json in each run's directory, {text, at,
//     label, sig}: who the run waits on in the user's words, when it was marked, and the next
//     step's label and signature then (attention.js waitSig), so a change on the PR lets it go.
//     Kept with the run, so Harbormaster on every machine sees it (see "waiting on someone" below).

import { exec } from "herdr";
import { shared, setShared } from "./store.js";
import { STALL_MS, stepSig, trackSince, trackParts, stepParts, usualCi } from "./attention.js";
import { clockNow, sleptThrough, awakeSince, machineWoke } from "./sleep.js";
import { workersOf, exactStatus, orchestratorState } from "./live.js";

const STEPS_KEY = "harbormaster.steps";
const CI_KEY = "harbormaster.ci";
const FLOWS_KEY = "harbormaster.reviewFlows";
const AGENTS_KEY = "harbormaster.agents";
export const CI_KEEP = 20;
const PROBE_EVERY = 60000;
// Once a run is stalled, its screens are read only this often, until its agents change.
const PROBE_STALLED_EVERY = 5 * 60000;
const PROBE_AFTER = STALL_MS - 5 * 60000;

// ---- pure helpers (tests drive them) ----

// The addresses of the run's orchestrator and its live agents.
const agentsOf = (run, ctx) => [run.terminal, ...workersOf(run.terminal, ctx).map((w) => w.address)];

// What the run's agents look like now: each of the orchestrator and its live agents, by
// address, with its status and turn count. A change in any, or an agent coming or going, changes it.
export function agentSig(run, ctx) {
  if (!run?.terminal) return "";
  return agentsOf(run, ctx).map((a) => `${a}:${exactStatus(a, ctx) ?? "-"}:${ctx.terminals.find((t) => t.address === a)?.turn ?? "-"}`).sort().join("\n");
}

// A screen's words only: a spinner, a counter or a clock ticking ("34s", "1m 2s", "12:04") is
// not new output. Numbers go with a unit of up to two letters glued to them.
export const screenSig = (text) => String(text ?? "").replace(/\d[\d.,:]*[a-z]{0,2}\b/gi, " ").replace(/[^\p{L}]+/gu, " ").trim();

// The store with a PR's finished CI run added: {[repo]: [{sha, ms}]}, once per head commit,
// the last CI_KEEP kept. The same store when there is nothing to add.
export function addCiSample(store, pr) {
  const repo = pr?.repo, sha = pr?.sha, s = pr?.ci?.startedAt, f = pr?.ci?.finishedAt;
  if (!repo || !sha || !s || !f || f <= s) return store;
  const have = store?.[repo] ?? [];
  if (have.some((x) => x.sha === sha)) return store;
  return { ...(store ?? {}), [repo]: [...have, { sha, ms: f - s }].slice(-CI_KEEP) };
}

// A stored entry of a run gone from a machine that answered (`listed`: the run keys a poll listed;
// `answered`: the machines read, "" for this one): the step and idle anchors forget it.
export const forgotten = (key, listed, answered) => !listed.has(key) && answered.has(key.slice(0, key.indexOf(":")));

// The idle anchors store after one run's poll: its {sig, since} when `idle` (none of its agents
// working or blocked: the only anchor attention.js idleAsking reads), else as it was. The same
// store when unchanged.
export function withAgents(store, key, sig, since, idle) {
  const have = store?.[key];
  if (!idle || (have?.sig === sig && have.since === since)) return store;
  return { ...(store ?? {}), [key]: { sig, since } };
}

// When a run's agents took on `sig`, from this module's own time for it (`own`, now on its first
// poll) and the stored anchor: the stored since when its signature is the same, it is no later,
// and it is after `after` (this module's last poll that saw another signature; none on a first
// poll, a reload), else `own`. So a reload keeps the idle time, and two Harbormaster copies that
// saw the same change a poll apart agree on the earlier time and stop rewriting the store.
export const seededAgentsAt = (stored, sig, own, after = -Infinity) =>
  (stored?.sig === sig && stored.since <= own && stored.since > after ? stored.since : own);

// ---- step anchors ----

// Updates the step anchors from a poll's runs: a changed step gets now, and each new part of
// it (stepParts, with the tasks' shown stages from `stagesOf(run)`) its own now; a run gone
// from a machine that answered is forgotten. `answered`: the machines (their names, "" for
// this one) read. An entry from before parts were kept dates its parts by its own since.
export function nextSteps(store, runs, answered, now, stagesOf = () => []) {
  const next = { ...(store ?? {}) };
  let changed = false;
  for (const r of runs) {
    // A stale run (its machine did not answer) keeps its anchors as they are: its agents are not
    // in this read, so its tasks' stages would read as planned and their ages restart.
    if (r.stale) continue;
    const prev = next[r.key];
    const t = trackSince(prev ? { sig: prev.sig, since: prev.since } : null, stepSig(r), now, r.updated);
    const parts = trackParts(prev?.parts ?? null, stepParts(r, stagesOf(r)), now, prev && !prev.parts ? prev.since : r.updated);
    if (!prev || t.since !== prev.since || t.sig !== prev.sig || parts !== prev.parts) { next[r.key] = { sig: t.sig, since: t.since, parts }; changed = true; }
  }
  const listed = new Set(runs.map((r) => r.key));
  for (const key of Object.keys(next)) {
    if (forgotten(key, listed, answered)) { delete next[key]; changed = true; }
  }
  return changed ? next : store;
}

// When the run's progress line or plan task states last changed (ms), or null before its first poll.
export const stepSince = (run) => shared(STEPS_KEY)?.[run.key]?.since ?? null;

// When each part of the run's step began ({[part key]: ms}, attention.js stepParts), or null
// before its first poll.
export const stepAges = (run) => shared(STEPS_KEY)?.[run.key]?.parts ?? null;

// ---- agents' activity (module memory) ----

// run key → {sig, since, agentsAt, otherAt, polledAt, screen, probedAt, probing}; agentsAt: when
// agentSig last changed (screen output left out), for agentsSince; otherAt: the last poll that saw
// another signature. agentsAt is also kept in shared state harbormaster.agents, {[run key]: {sig,
// since}}, so a Harbormaster reload keeps an idle orchestrator's idle time (a run asking in its tab
// does not leave Needs you for IDLE_ASK_MS and toast again), and another copy of the module that
// saw the change earlier gives its time (seededAgentsAt). Written only when the agents settle into
// a new signature with none of them working or blocked, the only anchor idle-ask reads, so a
// working run never writes it.
const activity = new Map();

// The latest sign of life of a run, ms: its step changing, its agents changing, new
// output. Null before its first poll.
export function lastActivity(run) {
  const a = activity.get(run.key)?.since ?? null;
  const s = stepSince(run);
  if (!a && !s) return null;
  // Looked at on every call, so a wake shows at once, before the next poll has finished.
  noteSleep();
  return awakeSince(Math.max(a ?? 0, s ?? 0), wokeOf(run));
}

// When the run's orchestrator and agents last changed status or turn, or one came or went
// (agentSig), ms; terminal output and step changes left out. Null before its first poll.
// attention.js idleAsking reads it. Unlike lastActivity, a sleep does not move it: an
// orchestrator idle before the machine slept is idle still, and asking all the same.
export const agentsSince = (run) => activity.get(run.key)?.agentsAt ?? null;

// The latest wake that moves the run's quiet time: this machine's for a local run, its own
// machine's for a remote one. Null when none.
const wokeOf = (run) => Math.max(run.machine ? 0 : wokeAt ?? 0, machineWokeAt.get(run.machine ?? "") ?? 0) || null;

// (This machine's wake only moves runs on this machine; a remote run follows its own machine.)
// When this machine last woke from sleep, the clocks as last looked at, and for each other
// machine when it woke (machineWokeAt) and when a poll first missed it (unseenSince).
let wokeAt = null;
let looked = null;
const machineWokeAt = new Map();
const unseenSince = new Map();

// Looks at the clocks and records a sleep since the last look.
function noteSleep() {
  const cur = clockNow();
  wokeAt = sleptThrough(looked, cur) ?? wokeAt;
  looked = cur;
  return cur.wall;
}

// How often to read a quiet run's screens: every minute as it nears a stall, every 5 minutes
// once it is stalled (it already shows, and may stay so for hours), until a change resets it.
export const probeEvery = (quietMs) => (quietMs >= STALL_MS ? PROBE_STALLED_EVERY : PROBE_EVERY);

// Reads the screens of the run's agents, and counts it as life when their words changed.
async function probe(run, ctx, entry) {
  entry.probing = true;
  try {
    const all = agentsOf(run, ctx);
    const texts = await Promise.all(all.map((a) => exec("hc", ["read", a]).then((o) => (o.code === 0 ? o.stdout : null)).catch(() => null)));
    if (texts.some((t) => t === null)) return;
    const sig = all.map((a, i) => `${a}\n${screenSig(texts[i])}`).join("\n\n");
    if (entry.screen != null && entry.screen !== sig) entry.since = Date.now();
    entry.screen = sig;
  } finally {
    entry.probedAt = Date.now();
    entry.probing = false;
  }
}

// After each run read (data.js loadRuns): updates the step anchors and the agents' activity,
// and reads the screens of runs about to stall. `stagesOf(run)`: its tasks' shown stages.
export function observeRuns(runs, ctx, answered, stagesOf = () => []) {
  const now = noteSleep();
  // A machine that did not answer is unseen from the first poll that missed it; when it
  // answers again after long enough, it has woken.
  for (const r of runs) {
    const m = r.machine ?? "";
    if (r.stale && !answered.has(m)) { if (!unseenSince.has(m)) unseenSince.set(m, now); }
  }
  for (const m of [...unseenSince.keys()]) {
    if (!answered.has(m)) continue;
    const w = machineWoke(unseenSince.get(m), now);
    if (w) machineWokeAt.set(m, w);
    unseenSince.delete(m);
  }
  const steps = shared(STEPS_KEY) ?? {};
  const next = nextSteps(steps, runs, answered, now, stagesOf);
  if (next !== steps) setShared(STEPS_KEY, next);
  const listed = new Set(runs.map((r) => r.key));
  for (const key of activity.keys()) if (!listed.has(key)) activity.delete(key);
  const anchors = shared(AGENTS_KEY) ?? {};
  let nextAnchors = anchors;
  const dropAnchor = (key) => { if (nextAnchors[key]) { nextAnchors = { ...nextAnchors }; delete nextAnchors[key]; } };
  for (const key of Object.keys(anchors)) if (forgotten(key, listed, answered)) dropAnchor(key);
  for (const r of runs) {
    // A stale run (its machine did not answer) keeps what is known of it, untouched.
    if (r.stale) continue;
    if (r.away || r.phase === "finished") { activity.delete(r.key); dropAnchor(r.key); continue; }
    const prev = activity.get(r.key);
    const sig = agentSig(r, ctx);
    const t = trackSince(prev ? { sig: prev.sig, since: prev.since } : null, sig, now);
    const entry = prev ?? { screen: null, probedAt: 0, probing: false, otherAt: -Infinity };
    if (prev && t.sig !== prev.sig) { entry.otherAt = prev.polledAt; entry.agentsAt = t.since; }
    entry.agentsAt = seededAgentsAt(anchors[r.key], sig, entry.agentsAt ?? now, entry.otherAt);
    entry.polledAt = now;
    const idle = !!r.terminal && !agentsOf(r, ctx).some((a) => ["working", "blocked"].includes(exactStatus(a, ctx)));
    nextAnchors = withAgents(nextAnchors, r.key, sig, entry.agentsAt, idle);
    entry.sig = t.sig;
    if (!prev || t.since !== prev.since) entry.since = t.since;
    activity.set(r.key, entry);
    const last = lastActivity(r);
    // A gone or lost orchestrator has no screen worth reading: it needs a resume, not a stall check.
    if (r.terminal && r.phase === "running" && orchestratorState(r, ctx) !== "gone" && last && now - last >= PROBE_AFTER && !entry.probing
      && now - entry.probedAt >= probeEvery(now - last)) {
      probe(r, ctx, entry).catch(() => {});
    }
  }
  if (nextAnchors !== anchors) setShared(AGENTS_KEY, nextAnchors);
}

// ---- CI baseline ----

// Records the finished CI runs of a run's PRs (data.js refreshPrs).
export function recordCi(prs) {
  const store = shared(CI_KEY) ?? {};
  const next = (prs ?? []).reduce(addCiSample, store);
  if (next !== store) setShared(CI_KEY, next);
}

// The repository's usual CI time in ms (attention.js usualCi), or null without a baseline.
export const ciUsualOf = (repo) => usualCi((shared(CI_KEY)?.[repo] ?? []).map((x) => x.ms));

// ---- review flow ----

// The user's review flow per repository folder: {[folder name]: "peer" | "self"}.
export const reviewFlows = () => shared(FLOWS_KEY) ?? {};

// The flows store with a folder's flow set ("peer" | "self"), or with anything else removed
// (back to the default). The same store for no key.
export function withFlow(store, key, flow) {
  if (!key) return store;
  const next = { ...(store ?? {}) };
  if (flow === "peer" || flow === "self") next[key] = flow;
  else delete next[key];
  return next;
}

// Sets a folder's review flow ("peer" | "self"), or with null goes back to the default. Every
// run of that folder reads it at its next render.
export function setReviewFlow(key, flow) {
  if (key) setShared(FLOWS_KEY, withFlow(reviewFlows(), key, flow));
}

// ---- waiting on someone ----

// A run's "waiting on someone…" mark lives in its run directory, waiting-on.json, on the run's
// machine: data.js reads it with the run's other files (run.waitOn), so every Harbormaster that
// shows the run, on any machine, sees the same mark. Between a click and the read that sees it,
// the change is kept in shared state harbormaster.waitingOnSaid, {[run key]: {mark (null: cleared),
// at}}, so every view shows it at once; a read that agrees, or SAID_MS, lets it go.
const SAID_KEY = "harbormaster.waitingOnSaid";
// Before waiting-on.json: the marks themselves, in this machine's shared state only. Moved into
// the runs' files as their runs are read (observeWaits).
const OLD_WAITS_KEY = "harbormaster.waitingOn";
export const SAID_MS = 2 * 60000;
const WRITE_WAIT = 'printf "%s\\n" "$2" >"$1/.waiting-on.json.$$" && mv "$1/.waiting-on.json.$$" "$1/waiting-on.json"';
const CLEAR_WAIT = 'rm -f "$1/waiting-on.json"';

// A mark as kept, {text, at (ms), label, sig}, or null when it has no text.
export function waitMark(m) {
  const text = String(m?.text ?? "").trim();
  if (!m || !text) return null;
  const at = typeof m.at === "number" ? m.at : Date.parse(m.at ?? "") || null;
  return { text, at, label: m.label ?? null, sig: m.sig ?? "" };
}

// waiting-on.json's text → the mark, or null (missing, blank or not a mark).
export function parseWait(text) {
  if (!text?.trim()) return null;
  try { return waitMark(JSON.parse(text)); } catch { return null; }
}

// The mark as waiting-on.json holds it: its time as an ISO date, for a person reading the file.
export const waitText = (m) => JSON.stringify({ text: m.text, at: m.at ? new Date(m.at).toISOString() : null, label: m.label, sig: m.sig });

// Whether two marks are the same one (both none, or the same text set at the same time).
const sameWait = (a, b) => (!a && !b) || (Boolean(a && b) && a.text === b.text && a.at === b.at);

const saidStore = () => shared(SAID_KEY) ?? {};
function say(key, entry) {
  const store = saidStore();
  const next = { ...store };
  if (entry) next[key] = entry;
  else delete next[key];
  setShared(SAID_KEY, next);
}

// A run's mark, or null: what was just set or cleared here, until a read of its files shows it, else its file's.
export function waitingOnOf(run) {
  if (!run?.key) return null;
  const said = saidStore()[run.key];
  return said ? said.mark : run.waitOn ?? null;
}

// Sets a run's mark (`mark`: {text, at, label, sig}, the text not blank) or with null clears it,
// in waiting-on.json on the run's machine. Every view shows it at its next render; throws when
// the write fails, and the run then shows as its files say.
export async function setWaitingOn(run, mark) {
  const next = waitMark(mark);
  say(run.key, { mark: next, at: Date.now() });
  try {
    const out = await exec("sh", ["-c", next ? WRITE_WAIT : CLEAR_WAIT, "sh", run.dir, ...(next ? [waitText(next)] : [])],
      { on: run.machine, timeout: run.machine ? 20000 : 8000 });
    if (out?.code) throw new Error((out.stderr || "").trim() || `exit ${out.code}`);
  } catch (e) {
    say(run.key, null);
    throw e;
  }
}

// After a poll's read: lets go of what was said once the run's files agree (or after SAID_MS), and
// moves this machine's old shared-state marks into the files of the runs read (`runs`, not stale).
export async function settleWaits(runs, now = Date.now()) {
  const byKey = new Map(runs.filter((r) => !r.stale).map((r) => [r.key, r]));
  const said = saidStore();
  const done = Object.keys(said).filter((k) => (byKey.has(k) && sameWait(byKey.get(k).waitOn ?? null, said[k].mark)) || now - said[k].at > SAID_MS);
  if (done.length) {
    const next = { ...saidStore() };
    for (const k of done) delete next[k];
    setShared(SAID_KEY, next);
  }
  const old = shared(OLD_WAITS_KEY);
  const moving = Object.keys(old ?? {}).filter((k) => byKey.has(k));
  if (!moving.length) return;
  const rest = { ...old };
  for (const k of moving) {
    const run = byKey.get(k);
    const mark = waitMark(old[k]);
    if (mark && !run.waitOn && !saidStore()[k]) {
      try { await setWaitingOn(run, mark); } catch { continue; }
    }
    delete rest[k];
  }
  setShared(OLD_WAITS_KEY, Object.keys(rest).length ? rest : null);
}
