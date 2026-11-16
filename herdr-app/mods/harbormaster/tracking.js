// The times and settings attention.js's rules read, kept as runs are polled:
//   - when each run's step (progress line and plan task states) last changed: shared state
//     harbormaster.steps, {[run key]: {sig, since}}, persisted, so a run's age survives a
//     Harbormaster reload or an app restart. Written only when a step changes (rare). A run
//     seen for the first time is dated by status.json's `updated` (set-status.sh writes it
//     with every progress change, so it is at or after the real change).
//   - when its agents last showed a sign of life: a change in the orchestrator's and its
//     agents' status or turn count (hc ls `turn`), an agent starting or ending, or new
//     terminal output. Module memory only: it changes every few seconds while agents work,
//     and writing shared state that often would redraw every mod. After a reload it starts
//     afresh at the first poll, so a run cannot be called stalled for STALL_MS after a reload:
//     too late rather than wrong. Terminal output is not something the mod API reports (panes
//     refresh only on scroll-state transitions), so the screens of a run quiet by every other
//     sign for STALL_MS minus 5 minutes are read with `hc read` once a minute (every 5 once
//     it is stalled), and a change
//     in their words (digits and symbols left out, so a spinner or a ticking timer is not
//     output) counts as life.
//   - each repository's finished CI runs: shared state harbormaster.ci, {[owner/repo]: [{sha, ms}]},
//     the last CI_KEEP per repository, from the PRs' statusCheckRollup (first check started to
//     last completed, once per head commit). The run history (.history.jsonl) has no usable
//     figure: its ci_wait is a run's total time in `gh run watch` and the like, not one CI
//     run's duration, and it counts only CI an agent watched.
//   - the review flow per repository folder: shared state harbormaster.reviewFlows,
//     {[folder name]: "peer" | "self"}, the user's choices over attention.js DEFAULT_FLOWS.

import { exec, shared, setShared } from "herdr";
import { STALL_MS, stepSig, trackSince, usualCi } from "./attention.js";
import { workersOf, exactStatus } from "./live.js";

const STEPS_KEY = "harbormaster.steps";
const CI_KEY = "harbormaster.ci";
const FLOWS_KEY = "harbormaster.reviewFlows";
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

// Updates the step anchors from a poll's runs: a changed step gets now; a run gone from a
// machine that answered is forgotten. `answered`: the machines (their names, "" for this one) read.
export function nextSteps(store, runs, answered, now) {
  const next = { ...(store ?? {}) };
  let changed = false;
  for (const r of runs) {
    const t = trackSince(next[r.key], stepSig(r), now, r.updated);
    if (t !== next[r.key]) { next[r.key] = t; changed = true; }
  }
  const listed = new Set(runs.map((r) => r.key));
  for (const key of Object.keys(next)) {
    if (!listed.has(key) && answered.has(key.slice(0, key.indexOf(":")))) { delete next[key]; changed = true; }
  }
  return changed ? next : store;
}

// When the run's progress line or plan task states last changed (ms), or null before its first poll.
export const stepSince = (run) => shared(STEPS_KEY)?.[run.key]?.since ?? null;

// ---- agents' activity (module memory) ----

// run key → {sig, since, screen, probedAt, probing}
const activity = new Map();

// The latest sign of life of a run, ms: its step changing, its agents changing, new
// output. Null before its first poll.
export function lastActivity(run) {
  const a = activity.get(run.key)?.since ?? null;
  const s = stepSince(run);
  return a || s ? Math.max(a ?? 0, s ?? 0) : null;
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
// and reads the screens of runs about to stall.
export function observeRuns(runs, ctx, answered) {
  const now = Date.now();
  const steps = shared(STEPS_KEY) ?? {};
  const next = nextSteps(steps, runs, answered, now);
  if (next !== steps) setShared(STEPS_KEY, next);
  const listed = new Set(runs.map((r) => r.key));
  for (const key of activity.keys()) if (!listed.has(key)) activity.delete(key);
  for (const r of runs) {
    // A stale run (its machine did not answer) keeps what is known of it, untouched.
    if (r.stale) continue;
    if (r.away || r.phase === "finished") { activity.delete(r.key); continue; }
    const prev = activity.get(r.key);
    const t = trackSince(prev ? { sig: prev.sig, since: prev.since } : null, agentSig(r, ctx), now);
    const entry = prev ?? { screen: null, probedAt: 0, probing: false };
    entry.sig = t.sig;
    if (!prev || t.since !== prev.since) entry.since = t.since;
    activity.set(r.key, entry);
    const last = lastActivity(r);
    if (r.terminal && r.phase === "running" && last && now - last >= PROBE_AFTER && !entry.probing
      && now - entry.probedAt >= probeEvery(now - last)) {
      probe(r, ctx, entry).catch(() => {});
    }
  }
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

// Sets a folder's review flow ("peer" | "self"), or with null goes back to the default.
export function setReviewFlow(key, flow) {
  if (!key) return;
  const next = { ...reviewFlows() };
  if (flow === "peer" || flow === "self") next[key] = flow;
  else delete next[key];
  setShared(FLOWS_KEY, next);
}
