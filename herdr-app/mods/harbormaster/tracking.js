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
//   - the user's "waiting on someone…" marks: shared state harbormaster.waitingOn, {[run key]:
//     {text, at, label, sig}}: who the run waits on in the user's words, when it was marked, and the
//     next step's label and signature then (attention.js waitSig), so a change on the PR lets it go.

import { exec, shared, setShared } from "herdr";
import { STALL_MS, stepSig, trackSince, trackParts, stepParts, usualCi } from "./attention.js";
import { clockNow, sleptThrough, awakeSince, machineWoke } from "./sleep.js";
import { workersOf, exactStatus, orchestratorState } from "./live.js";

const STEPS_KEY = "harbormaster.steps";
const CI_KEY = "harbormaster.ci";
const FLOWS_KEY = "harbormaster.reviewFlows";
const WAITS_KEY = "harbormaster.waitingOn";
const AGENTS_KEY = "harbormaster.agents";
export const CI_KEEP = 20;
const PROBE_EVERY = 60000;
// Once a run is stalled, its screens are read only this often, until its agents change.
const PROBE_STALLED_EVERY = 5 * 60000;
const PROBE_AFTER = STALL_MS - 5 * 60000;

// ---- pure helpers (tests drive them) ----

// What the run's agents look like now: each of the orchestrator and its live agents, by
// address, with its status and turn count. A change in any, or an agent coming or going, changes it.
export function agentSig(run, ctx) {
  if (!run?.terminal) return "";
  const all = [run.terminal, ...workersOf(run.terminal, ctx).map((w) => w.address)];
  return all.map((a) => `${a}:${exactStatus(a, ctx) ?? "-"}:${ctx.terminals.find((t) => t.address === a)?.turn ?? "-"}`).sort().join("\n");
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
    if (!listed.has(key) && answered.has(key.slice(0, key.indexOf(":")))) { delete next[key]; changed = true; }
  }
  return changed ? next : store;
}

// When the run's progress line or plan task states last changed (ms), or null before its first poll.
export const stepSince = (run) => shared(STEPS_KEY)?.[run.key]?.since ?? null;

// When each part of the run's step began ({[part key]: ms}, attention.js stepParts), or null
// before its first poll.
export const stepAges = (run) => shared(STEPS_KEY)?.[run.key]?.parts ?? null;

// ---- agents' activity (module memory) ----

// run key → {sig, since, agentsAt, screen, probedAt, probing}; agentsAt: when agentSig last
// changed (screen output left out), for agentsSince. agentsAt is also kept in shared state
// harbormaster.agents, {[run key]: {sig, since}}, so a Harbormaster reload keeps an idle
// orchestrator's idle time (a run asking in its tab does not leave Needs you for IDLE_ASK_MS and
// toast again). Written only when the agents settle into a new signature with none of them
// working, the only anchor idle-ask reads, so a working run never writes it.
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

// The idle anchors store after one run's poll: its {sig, since} when none of its agents works
// (a sig line is "<address>:<status>:<turn>"), else as it was. The same store when unchanged.
export function withAgents(store, key, sig, since) {
  const working = sig.split("\n").some((l) => l.split(":").at(-2) === "working");
  const have = store?.[key];
  if (working || (have?.sig === sig && have.since === since)) return store;
  return { ...(store ?? {}), [key]: { sig, since } };
}

// When a run's agents took on `sig`, for its first poll in this module: the stored anchor when
// its signature is the same (a reload), else now.
export const seededAgentsAt = (stored, sig, now) => (stored?.sig === sig && stored.since <= now ? stored.since : now);

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
    const all = [run.terminal, ...workersOf(run.terminal, ctx).map((w) => w.address)];
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
  // As the step anchors: a run gone from a machine that answered is forgotten.
  for (const key of Object.keys(anchors)) if (!listed.has(key) && answered.has(key.slice(0, key.indexOf(":")))) dropAnchor(key);
  for (const r of runs) {
    // A stale run (its machine did not answer) keeps what is known of it, untouched.
    if (r.stale) continue;
    if (r.away || r.phase === "finished") { activity.delete(r.key); dropAnchor(r.key); continue; }
    const prev = activity.get(r.key);
    const sig = agentSig(r, ctx);
    const t = trackSince(prev ? { sig: prev.sig, since: prev.since } : null, sig, now);
    const entry = prev ?? { screen: null, probedAt: 0, probing: false };
    if (!prev) entry.agentsAt = seededAgentsAt(anchors[r.key], sig, now);
    else if (t.sig !== prev.sig) entry.agentsAt = t.since;
    nextAnchors = withAgents(nextAnchors, r.key, sig, entry.agentsAt);
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

// The user's waiting-on marks: {[run key]: {text, at, label, sig}}.
export const waitingOn = () => shared(WAITS_KEY) ?? {};

// A run's mark, or null.
export const waitingOnOf = (run) => (run?.key ? waitingOn()[run.key] ?? null : null);

// The marks store with a run's mark set (`mark`: {text, at, label, sig}, the text not blank), or
// with null removed. The same store when nothing changes.
export function withWait(store, key, mark) {
  if (!key) return store;
  const text = String(mark?.text ?? "").trim();
  if (mark && text) return { ...(store ?? {}), [key]: { text, at: mark.at ?? null, label: mark.label ?? null, sig: mark.sig ?? "" } };
  if (!store?.[key]) return store;
  const next = { ...store };
  delete next[key];
  return next;
}

// The marks store without the keys in `drop`, nor marks of runs no longer listed (`keys`: the run
// keys a poll listed), but for those `unread(key)` says were not read (their machine did not
// answer: the run may well still be there). The same store when nothing goes.
export function prunedWaits(store, keys, drop = [], unread = () => false) {
  const gone = Object.keys(store ?? {}).filter((k) => drop.includes(k) || (!keys.has(k) && !unread(k)));
  if (!gone.length) return store;
  const next = { ...store };
  for (const k of gone) delete next[k];
  return next;
}

// Sets a run's mark, or with null clears it. Every view reads it at its next render.
export function setWaitingOn(key, mark) {
  const store = waitingOn();
  const next = withWait(store, key, mark);
  if (next !== store) setShared(WAITS_KEY, next);
}

// Deletes the marks of `drop` (run keys) and of runs not among `keys` but for unread ones, in one write.
export function pruneWaitingOn(keys, drop = [], unread = () => false) {
  const store = shared(WAITS_KEY);
  if (!store) return;
  const next = prunedWaits(store, keys, drop, unread);
  if (next !== store) setShared(WAITS_KEY, next);
}
