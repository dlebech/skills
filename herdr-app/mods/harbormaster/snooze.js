// Snoozing a row of "Next for you" (crew.js nextSection): hide it for a while, so a PR the user
// has seen and will act on later (three approved PRs of a parked run, merged tomorrow) leaves the
// list. The pure rules are first; the file and the shared store are at the end.
//
// A snooze is {until, reason}, keyed by the PR's URL. It ends when its time is up, or earlier
// when the item's reason is another one than when it was snoozed: the need changed kind
// (approved → changes requested, CI failed, new comments), and that is worth seeing. The same
// reason again (a second approval, the age moving on) stays snoozed.

import { exec, shared, setShared, readTextFile, writeTextFile } from "herdr";

export const SNOOZE_KEY = "harbormaster.snoozed";
const HOUR = 3600000;

// The choices in the Later menu: label, and when it ends from `now` (a ms time). "Tomorrow 9:00" is
// 9:00 local time on the next calendar day, also when it is asked just before or after midnight.
export const SNOOZE_CHOICES = [
  { key: "tomorrow", label: "Tomorrow 9:00", until: (now) => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); } },
  { key: "1h", label: "1 h", until: (now) => now + HOUR },
  { key: "4h", label: "4 h", until: (now) => now + 4 * HOUR },
];

// The file's text → {url: {until, reason}}; anything unreadable is "nothing snoozed".
export function parseSnoozed(text) {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    const out = {};
    for (const [url, e] of Object.entries(j)) {
      if (e && Number.isFinite(e.until) && typeof e.reason === "string") out[url] = { until: e.until, reason: e.reason };
    }
    return out;
  } catch { return {}; }
}

// Without the entries whose time is up (what is written).
export function pruneSnoozed(map, now) {
  return Object.fromEntries(Object.entries(map ?? {}).filter(([, e]) => e.until > now));
}

// The kind of need: the reason without a leading count, so "1 new comment" and "2 new comments"
// are one kind and a snooze survives one more comment; "approved — merge" and "CI failed" differ.
export const kindOf = (reason) => String(reason ?? "").replace(/^\d+ /, "").replace(/ comments$/, " comment");

// Items → {shown, snoozed, woke}, each in the items' order. `woke` is the urls whose entry is
// still running but names another kind of need: they show, and the caller drops the entries
// (wakeSnoozes), so the old reason coming back before `until` does not hide them again.
export function splitSnoozed(items, map, now) {
  const shown = [], snoozed = [], woke = [];
  for (const it of items) {
    const e = map?.[it.url];
    if (!e || e.until <= now) shown.push(it);
    else if (e.reason === kindOf(it.reason)) snoozed.push(it);
    else { shown.push(it); woke.push(it.url); }
  }
  return { shown, snoozed, woke };
}

// The map with `it` snoozed until `until`, or without it (until null).
export function withSnooze(map, it, until, now) {
  const next = pruneSnoozed(map, now);
  if (until == null) delete next[it.url];
  else next[it.url] = { until, reason: kindOf(it.reason) };
  return next;
}

// The map without these urls.
export function withoutUrls(map, urls, now) {
  const next = pruneSnoozed(map, now);
  for (const u of urls) delete next[u];
  return next;
}

// ---- the file: <runs root>/.snoozed.json, beside .newrun.json (newrun.js) ----

const sh = (script, args = []) => exec("sh", ["-c", script, "_", ...args]);
const snoozeFile = async () => `${(await sh('printf %s "${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}"')).stdout.trim()}/.snoozed.json`;

export const snoozed = () => shared(SNOOZE_KEY);

// Reads the file into the shared store, once per copy that finds it empty (a restart, a reload);
// a missing or unreadable file is nothing snoozed. Never throws.
let loading = false;
export async function loadSnoozed() {
  if (loading || snoozed() != null) return;
  loading = true;
  try { setShared(SNOOZE_KEY, parseSnoozed(await readTextFile(await snoozeFile()).catch(() => null) ?? "")); }
  catch { setShared(SNOOZE_KEY, {}); }
  finally { loading = false; }
}

// Applies `change` (map → map) to the store and then to the file. Reads the file again first, so a
// snooze made in another copy is kept; Herdr's write is atomic and rejects a stale snapshot, so it
// reads again, once. The shared store is set first, so every copy shows it at once even if the
// write fails.
async function update(change) {
  setShared(SNOOZE_KEY, change(snoozed()));
  try {
    const file = await snoozeFile();
    await sh('mkdir -p "$(dirname "$1")"', [file]);
    for (let tries = 0; ; tries++) {
      const text = await readTextFile(file).catch(() => null);
      const next = change(parseSnoozed(text ?? ""));
      try { await writeTextFile(file, JSON.stringify(next, null, 2) + "\n", text); setShared(SNOOZE_KEY, next); return; }
      catch (e) { if (tries) throw e; }
    }
  } catch (e) { console.log(`harbormaster: could not save snoozes: ${e?.message ?? e}`); }
}

// Snoozes `it` until `until` (null: wakes it).
export const setSnooze = (it, until, now = Date.now()) => update((map) => withSnooze(map, it, until, now));
// Drops the entries of items that woke on a new kind of need: one write for all.
export const wakeSnoozes = (urls, now = Date.now()) => update((map) => withoutUrls(map, urls, now));
