// Where a run's time went, by category, per agent and per task: timing.sh's JSON (its
// header is the format), read from the logs the run's orchestrator and agents left.
// timing.sh and categories.tsv ship with the mod; both are read from the installed mod
// and passed as text, so the script runs on the run's own machine (`on: run.machine`),
// where its logs are, without being installed there.

import { exec, appHome, readTextFile } from "herdr";

// The categories in display order, with their labels.
export const CATEGORIES = [
  { key: "model", label: "model" },
  { key: "test", label: "test" },
  { key: "lint", label: "lint/typecheck" },
  { key: "build", label: "build" },
  { key: "install", label: "install" },
  { key: "ci_wait", label: "CI wait" },
  { key: "agent_wait", label: "agent wait" },
  { key: "review", label: "review" },
  { key: "git", label: "git" },
  { key: "user_wait", label: "user wait" },
  { key: "other", label: "other" },
];

const shipped = (name) => readTextFile(`${appHome()}/mods/harbormaster/${name}`);

// key → { at, value, pending }
const cache = new Map();

// The last breakdown read for a run, or null: for drawing without waiting.
export const cachedTiming = (run) => cache.get(run.key)?.value ?? null;

// The run's breakdown, read at most every `maxAge` ms (timing.sh's own cache makes a
// reread of an unchanged run cheap, but it still forks jq for every session file).
// Resolves with null when it cannot be read; never rejects.
export function loadTiming(run, { maxAge = 60000 } = {}) {
  const hit = cache.get(run.key);
  if (hit?.pending) return hit.pending;
  if (hit && Date.now() - hit.at < maxAge) return Promise.resolve(hit.value);
  const pending = (async () => {
    const [script, table] = await Promise.all([shipped("timing.sh"), shipped("categories.tsv")]);
    if (!script || table == null) return null;
    const out = await exec("sh", ["-c", script, "sh", run.dir, table], { on: run.machine, timeout: 120000 });
    if (out.code !== 0) return null;
    return JSON.parse(out.stdout);
  })().catch(() => null).then((value) => {
    // A failed read keeps the last good breakdown.
    cache.set(run.key, { at: Date.now(), value: value ?? hit?.value ?? null, pending: null });
    return value ?? hit?.value ?? null;
  });
  cache.set(run.key, { at: hit?.at ?? 0, value: hit?.value ?? null, pending });
  return pending;
}

// 3725 → "1h 2m", 95 → "1m 35s", 40 → "40s".
export function durationText(s) {
  s = Math.round(s ?? 0);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}
