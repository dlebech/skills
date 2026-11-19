// Snoozing a row of "Next for you" (crew.js nextSection): hide it for a while, so a PR the user
// has seen and will act on later (three approved PRs of a parked run, merged tomorrow) leaves the
// list. The pure rules are first; the file and the shared store are at the end.
//
// A snooze is {until, reason}, keyed by the PR's URL. It ends when its time is up, or earlier
// when the item's reason is another one than when it was snoozed: the need changed kind
// (approved → changes requested, CI failed, new comments), and that is worth seeing. The same
// reason again (a second approval, the age moving on) stays snoozed.
//
// Every machine keeps its own file, and they are merged (mergeSnoozed): an entry carries `at`, when
// it was set, and a wake leaves a tombstone ({off: true}) until the woken entry's own time is up,
// so a wake on one machine is not undone by the other's older entry. The newest `at` per URL wins.

import { exec, shared, setShared, readTextFile, writeTextFile, machines } from "herdr";

export const SNOOZE_KEY = "harbormaster.snoozed";
const HOUR = 3600000;

// The choices in the Later menu: label, and when it ends from `now` (a ms time). "Tomorrow 9:00" is
// 9:00 local time on the next calendar day, also when it is asked just before or after midnight.
export const SNOOZE_CHOICES = [
  { key: "tomorrow", label: "Tomorrow 9:00", until: (now) => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); } },
  { key: "1h", label: "1 h", until: (now) => now + HOUR },
  { key: "4h", label: "4 h", until: (now) => now + 4 * HOUR },
];

// The file's text → {url: {until, reason, at?, off?}}; anything unreadable is "nothing snoozed".
export function parseSnoozed(text) {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    const out = {};
    for (const [url, e] of Object.entries(j)) {
      if (!e || !Number.isFinite(e.until) || typeof e.reason !== "string") continue;
      out[url] = { until: e.until, reason: e.reason };
      if (Number.isFinite(e.at)) out[url].at = e.at;
      if (e.off === true) out[url].off = true;
    }
    return out;
  } catch { return {}; }
}

// Two machines' maps as one: per URL the entry set last (`at`; an entry without one is oldest);
// on a tie a wake wins, else `a`'s; what is up is dropped.
export function mergeSnoozed(a, b, now) {
  const out = { ...(a ?? {}) };
  for (const [url, e] of Object.entries(b ?? {})) {
    const o = out[url], d = (e.at ?? 0) - (o?.at ?? 0);
    if (!o || d > 0 || (d === 0 && e.off && !o.off)) out[url] = e;
  }
  return pruneSnoozed(out, now);
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
    if (!e || e.off || e.until <= now) shown.push(it);
    else if (e.reason === kindOf(it.reason)) snoozed.push(it);
    else { shown.push(it); woke.push(it.url); }
  }
  return { shown, snoozed, woke };
}

// A woken entry: a tombstone until the entry's own time is up, so another machine's copy of it
// (older) loses the merge; none is needed for an entry that was never there or is already off.
const tombstone = (e, now) => (e && !e.off ? { until: e.until, reason: "", at: now, off: true } : e);

// The map with `it` snoozed until `until`, or woken (until null).
export function withSnooze(map, it, until, now) {
  const next = pruneSnoozed(map, now);
  if (until == null) { if (next[it.url]) next[it.url] = tombstone(next[it.url], now); }
  else next[it.url] = { until, reason: kindOf(it.reason), at: now };
  return next;
}

// The map with these urls woken.
export function withoutUrls(map, urls, now) {
  const next = pruneSnoozed(map, now);
  for (const u of urls) if (next[u]) next[u] = tombstone(next[u], now);
  return next;
}

// Whether two maps hold the same entries (the order of keys aside).
const sameMap = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

// ---- the files: <runs root>/.snoozed.json on every machine, beside .newrun.json (newrun.js) ----

const ROOT = 'printf %s "${HERDR_ORCHESTRATION_ROOT:-$HOME/.herdr/hc-orchestration}"';
const sh = (script, args = [], opts) => exec("sh", ["-c", script, "_", ...args], opts);
const snoozeFile = async (on = null) => {
  const r = await sh(ROOT, [], on ? { on, timeout: 8000 } : undefined);
  if (r.code !== 0 || !r.stdout.trim()) throw new Error(r.stderr || "no runs root");
  return `${r.stdout.trim()}/.snoozed.json`;
};
// Another machine's file is written through sh (Herdr's writeTextFile is for this one), whole, by a rename.
const WRITE = 'mkdir -p "$(dirname "$1")" && printf %s "$2" > "$1.$$" && mv -f "$1.$$" "$1"';
const asText = (map) => JSON.stringify(map, null, 2) + "\n";

// The other machines that answer (Herdr's machine list, `null` being this one).
const others = () => { try { return machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name); } catch { return []; } };

// Another machine's file, or null when absent: through sh with a timeout (Herdr's readTextFile has
// none, and one read hanging on a half-dead link must not hold the sync for the rest of the session).
async function readOn(on, file) {
  const r = await sh('[ -e "$1" ] || exit 3; cat "$1"', [file], { on, timeout: 8000 });
  if (r.code === 3) return null;
  if (r.code !== 0) throw new Error(r.stderr || `exit ${r.code}`);
  return r.stdout;
}

// Merges `map` into a machine's file and writes it when that changes it; never throws.
async function pushTo(on, map) {
  try {
    const file = await snoozeFile(on);
    const have = parseSnoozed(await readOn(on, file) ?? "");
    const next = mergeSnoozed(have, map, Date.now());
    if (!sameMap(have, next)) await sh(WRITE, [file, asText(next)], { on, timeout: 8000 });
  } catch (e) { console.log(`harbormaster: could not share snoozes with ${on}: ${e?.message ?? e}`); }
}

// What every answering machine's file holds, merged: [map, the machines read].
async function readOthers(now) {
  let all = {};
  const read = [];
  await Promise.all(others().map(async (on) => {
    try {
      const file = await snoozeFile(on);
      const text = await readOn(on, file);
      all = mergeSnoozed(all, parseSnoozed(text ?? ""), now);
      read.push(on);
    } catch { /* offline: its snoozes come with the next sync */ }
  }));
  return [all, read];
}

export const snoozed = () => shared(SNOOZE_KEY);

// Reads this machine's file and the other machines' into the shared store, merged: at once when
// the store is empty (a restart, a reload), else at most every SYNC_MS, so a snooze made on another
// machine shows here within a minute. The merge is written back where it adds something, so each
// machine's file catches up. Called while Next for you is drawn (crew.js). Never throws. A sync
// still going after STUCK_MS (a call that never returns) no longer holds the next one back.
export const SYNC_MS = 60000;
const STUCK_MS = 2 * 60000;
let loading = 0, lastSync = 0;
export async function loadSnoozed() {
  if ((loading && Date.now() - loading < STUCK_MS) || (snoozed() != null && Date.now() - lastSync < SYNC_MS)) return;
  const started = loading = Date.now();
  lastSync = Date.now();
  try {
    const now = Date.now();
    const mine = parseSnoozed(await readTextFile(await snoozeFile()).catch(() => null) ?? "");
    // This machine first: the others may be slow, and the store must not stay empty meanwhile.
    if (snoozed() == null) setShared(SNOOZE_KEY, mine);
    const [theirs, read] = await readOthers(now);
    const all = mergeSnoozed(mergeSnoozed(mine, snoozed() ?? {}, now), theirs, now);
    if (!sameMap(all, snoozed())) setShared(SNOOZE_KEY, all);
    if (!sameMap(all, pruneSnoozed(mine, now))) await update((m) => m, { push: false });
    await Promise.all(read.map((on) => pushTo(on, all)));
  } catch { if (snoozed() == null) setShared(SNOOZE_KEY, {}); }
  finally { if (loading === started) loading = 0; }
}

// Applies `change` (map → map) to the store, then to this machine's file and (`push`) the other
// machines'. This machine's file is read again first and merged with the store, so a snooze made in
// another copy or read from another machine is kept; Herdr's write is atomic and rejects a stale
// snapshot, so it reads again, once. The shared store is set first, so every copy shows it at once
// even if a write fails.
async function update(change, { push = true } = {}) {
  setShared(SNOOZE_KEY, change(snoozed() ?? {}));
  try {
    const file = await snoozeFile();
    await sh('mkdir -p "$(dirname "$1")"', [file]);
    for (let tries = 0; ; tries++) {
      const text = await readTextFile(file).catch(() => null);
      const next = change(mergeSnoozed(parseSnoozed(text ?? ""), snoozed() ?? {}, Date.now()));
      try { await writeTextFile(file, asText(next), text); setShared(SNOOZE_KEY, next); break; }
      catch (e) { if (tries) throw e; }
    }
  } catch (e) { console.log(`harbormaster: could not save snoozes: ${e?.message ?? e}`); }
  if (push) await Promise.all(others().map((on) => pushTo(on, snoozed() ?? {})));
}

// Snoozes `it` until `until` (null: wakes it).
export const setSnooze = (it, until, now = Date.now()) => update((map) => withSnooze(map, it, until, now));
// Wakes the entries of items that woke on a new kind of need: one write for all.
export const wakeSnoozes = (urls, now = Date.now()) => update((map) => withoutUrls(map, urls, now));
