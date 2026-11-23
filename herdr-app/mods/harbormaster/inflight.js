// Herdr refuses cx.spawn once a runtime holds 1024 outstanding host tasks, so a repeating spawn whose
// body can hang (an exec to a machine that never answers) must never start another beside it.
// startOnce runs at most one body per owner and kind (and key) at a time; a body over its limit is
// given up (logged once) and the next call starts a new one. A late finish of the given-up body
// never clears the newer body's mark (its token differs). Every start and end is counted.
// A given-up body is still an outstanding host task, so at most MAX_HUNG of them are left per owner,
// kind and key: after that a tick starts nothing until one ends (at most MAX_HUNG + 1 outstanding).

import { props } from "herdr";

export const MAX_HUNG = 3;
let copies = 0;
// A short name for one view's tasks: its role and a number for this copy ("crew#2").
export const tagOf = (view) => (view.copyTag ??= `${props()?.role ?? "cards"}#${++copies}`);

export const LIMITS = { refresh: 120000, slow: 120000, week: 120000, copy: 120000 };
export const tune = { now: () => Date.now(), warnAt: 50 }; // tests replace the clock

const counts = new Map(); // "tag/kind" -> { started, ended }
let warned = 0; // the in-flight total last warned about

const inflightTotal = () => { let n = 0; for (const c of counts.values()) n += c.started - c.ended; return n; };

// { "crew/refresh": { started, ended, inflight }, … } — cheap enough to call from a log or a test.
export function inflightCounts() {
  const out = {};
  for (const [k, c] of counts) out[k] = { started: c.started, ended: c.ended, inflight: c.started - c.ended };
  return out;
}
export function resetInflight() { counts.clear(); warned = 0; }

function count(label, field) {
  const c = counts.get(label) ?? { started: 0, ended: 0 };
  c[field]++;
  counts.set(label, c);
  const total = inflightTotal();
  if (total < tune.warnAt / 2) warned = 0;
  else if (!warned || total >= warned * 2) {
    warned = warned ? warned * 2 : tune.warnAt;
    console.log(`harbormaster: ${total} tasks in flight (${Object.entries(inflightCounts()).filter(([, v]) => v.inflight).map(([k, v]) => `${k} ${v.inflight}`).join(", ")})`);
  }
}

// Marks a body started and counted. Returns the end function (call once, when the body ends).
export function begin(label) {
  count(label, "started");
  let done = false;
  return () => { if (!done) { done = true; count(label, "ended"); } };
}

// Calls spawn(body) unless this owner's body of this kind (and key) is still running within its
// limit. spawn is `(body) => cx.spawn(body)`. Returns true when a body was started.
export function startOnce(owner, kind, spawn, body, { key = "", tag = tagOf(owner), limit = LIMITS[kind] } = {}) {
  const slots = (owner.inflightSlots ??= new Map());
  const id = `${kind}|${key}`;
  const cur = slots.get(id);
  const hungs = (owner.inflightHung ??= new Map());
  if (cur) {
    if (tune.now() - cur.at < limit) return false;
    if ((hungs.get(id) ?? 0) >= MAX_HUNG) {
      if (!cur.capped) { cur.capped = true; console.log(`harbormaster: ${kind} still hung with ${MAX_HUNG} given up${key ? ` (${key})` : ""}, starting no more until one ends`); }
      return false;
    }
    hungs.set(id, (hungs.get(id) ?? 0) + 1);
    console.log(`harbormaster: ${kind} hung for ${Math.round((tune.now() - cur.at) / 1000)}s${key ? ` (${key})` : ""}, starting another`);
  }
  const slot = { at: tune.now() };
  slots.set(id, slot);
  const end = begin(`${tag}/${kind}`);
  spawn(async (cx) => {
    try { return await body(cx); }
    finally {
      end();
      if (slots.get(id) === slot) slots.delete(id);
      else hungs.set(id, Math.max(0, (hungs.get(id) ?? 0) - 1)); // a given-up body ended
    }
  });
  return true;
}
