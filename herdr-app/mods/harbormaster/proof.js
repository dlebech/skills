// A run's proof: each task's `Proof:` line and the run's `Proof tier:` from plan.md, and
// proof.md's per-task results. No herdr imports, so it can be run under plain node. The
// format is in skills/herdr-app-orchestrator/references/run-files.md.

import { isImage, isVideo } from "./media.js";

// The tier texts live in levels.js, with the other header tags' texts; re-exported here.
export { TIER_TEXT, tierTip } from "./levels.js";

// "T1 — the evidence", "T1: the evidence", "T2" → {tier: 1, text}; null when no T0..T3 leads it.
export function proofOf(s) {
  const m = /^[*_`\s]*T([0-3])\b[*_`]*\s*(?:[—–:-]\s*)?(.*)$/is.exec(s ?? "");
  return m ? { tier: Number(m[1]), text: m[2].replace(/[*_`]+$/, "").trim() } : null;
}

// plan.md's `Proof tier: T2` or `Proof tier: T2 (set by user)` → {tier, byUser}, else null.
export function declaredTier(plan) {
  const m = /^[*_\s]*Proof tier:?[*_\s]*T([0-3])\b(.*)$/im.exec(plan ?? "");
  return m ? { tier: Number(m[1]), byUser: /set by user/i.test(m[2]) } : null;
}

// The run's tier: the declared line, else the highest of its tasks' tiers, else null (nothing named).
export function runTier(plan, tasks) {
  const declared = declaredTier(plan);
  if (declared) return declared;
  const tiers = tasks.filter((t) => t.proof).map((t) => t.proof.tier);
  return tiers.length ? { tier: Math.max(...tiers), byUser: false } : null;
}

// proof.md → { tier, checks ({state: "green"|"red", text} or null), tasks: { <task id>: {tier, checked, result, why, files} } }. A task's section is
// "## <task id> <task name>"; its Result is "pass | fail | partial | pending — one line"
// (pending: the proof is still being gathered, as when a later task takes its screenshots).
// `Files:` is comma-separated paths; a note in parentheses after a path (it may hold commas) is dropped.
const MEDIA_FILE = /^[^\s,()]+\.\w{1,6}$/;
export function parseFiles(val) {
  const out = [];
  let depth = 0, cur = "";
  for (const c of val) {
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  // Only the path-looking first word of each entry counts: "a.png (the run pane)" is "a.png".
  return out.map((e) => e.replace(/\([^)]*\)?/g, " ").trim().split(/\s+/)[0]).filter((f) => f && MEDIA_FILE.test(f));
}

export function parseProofMd(text) {
  const out = { tier: null, checks: null, tasks: {}, cut: false };
  if (!text) return out;
  let cur = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const h = /^##\s+(\S+)/.exec(line);
    if (h) { cur = out.tasks[h[1]] = { tier: null, checked: "", result: null, why: "", files: [] }; continue; }
    const kv = /^(Tier|Checks|Checked|Result|Files):\s*(.*)$/i.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase(), val = kv[2].trim();
    if (!cur) {
      if (key === "tier") out.tier = proofOf(val)?.tier ?? null;
      // "Checks: green — <what>" / "Checks: red — <what>", in the header above the first task.
      else if (key === "checks") { const c = /^(green|red)\b[\s—–:-]*(.*)$/i.exec(val); if (c) out.checks = { state: c[1].toLowerCase(), text: c[2].trim() }; }
      continue;
    }
    if (key === "tier") cur.tier = proofOf(val)?.tier ?? null;
    else if (key === "checked") cur.checked = val;
    else if (key === "files") cur.files = parseFiles(val);
    else {
      const r = /^(pass|fail|partial|pending)\b[\s—–:-]*(.*)$/i.exec(val);
      if (r) { cur.result = r[1].toLowerCase(); cur.why = r[2].trim(); }
    }
  }
  return out;
}


// One task's proof, from plan.md's Proof line and proof.md's entry:
// {id, name, tier (its own, else the planned one), planned, result ("pass" | "partial" | "fail" | null), why, checked, files, missing}.
// `missing` is a T2+ task with a proof.md result but no image or video in its Files list that exists. The tasks are plan.md's, then proof.md's others.
// `shotFiles` is the shared/proof/ listing (null: unknown); an image under shared/proof/ that the
// listing lacks does not exist, so it does not count as a screenshot.
// `extra` adds the user's say on each row: `accepted` (proof-accepted.json, by task id) and `asks`
// (pendingProofs(), by task id); each row then has `accepted` (the entry, while it still holds)
// and `asked` (true while an Ask to prove waits for this result).
// `extra.gathering` (task id → whether its task is still under way: planned, implementing, in
// review or fixing; default: none is) and `extra.finished` (the run is finished or put away)
// decide `pending`: see isPending().
export function proofTasks(tasks, md, shotFiles = null, extra = {}) {
  const seen = new Set();
  const row = (id, name, planned) => {
    const e = md?.tasks?.[id] ?? null;
    const tier = e?.tier ?? planned?.tier ?? null;
    const files = e?.files ?? [];
    seen.add(id);
    const there = (f) => {
      const m = /^(?:shared\/proof\/)?([^/]+)$/.exec(f);
      return !shotFiles || shotFiles.length >= 40 || !m || shotFiles.includes(m[1]);
    };
    return {
      id, name, planned, tier, result: e?.result ?? null, why: e?.why ?? "", checked: e?.checked ?? "", files,
      scoped: Boolean(planned || e),
      missing: Boolean(e?.result) && tier !== null && tier >= 2 && !files.some((f) => (isImage(f) || isVideo(f)) && there(f)),
    };
  };
  const rows = tasks.map((k) => row(k.id, k.name, k.proof));
  // A "## Summary" or "## Notes" section is not a task: only one with a Result or Tier is.
  for (const [id, e] of Object.entries(md?.tasks ?? {})) if (!seen.has(id) && (e.result || e.tier !== null)) rows.push(row(id, "", null));
  for (const k of rows) {
    const line = resultLine(k);
    const a = extra.accepted?.[k.id];
    k.accepted = !isPass(k) && a && a.result === line ? a : null;
    k.asked = !isPass(k) && !k.accepted && extra.asks?.get?.(proveId(k.id)) === line;
    // An accepted row is accepted, whatever its task's stage.
    k.pending = !k.accepted && isPending(k, Boolean(extra.gathering?.(k.id)), Boolean(extra.finished));
  }
  return rows;
}

// ---- the user's say on a row: Accept, or Ask to prove ----
// A row that is not a pass (partial, fail, a T2+ pass without a screenshot, not checked, not
// scoped) can be accepted as it is, in proof-accepted.json, which Harbormaster writes, or asked
// for, with an inbox message the orchestrator acts on. Both are for this result line only: once
// proof.md says something else, the row asks again. Formats in run-files.md.

export const isPass = (k) => k.result === "pass" && !k.missing;

// A row whose proof is still being gathered, so nothing in it is the user's yet: proof.md says
// "Result: pending — <why>", or its task is still under way (`gathering`: planned, implementing,
// in review, fixing) and nothing failed. A done or blocked task's partial or missing proof still
// needs a look (nobody is gathering a blocked task's), and so does anything pending once the
// run is finished: nobody is gathering it any more.
// Whether a task's stage (data.js taskStage / shownStage) is one whose proof is still being
// gathered: planned, implementing, in review or fixing; not done, blocked or a stage named by none.
const GATHERING = new Set(["planned", "implement", "review", "fix"]);
export const gatheringStage = (stage) => GATHERING.has(stage);
export const isPending = (k, gathering, finished) => !finished && !isPass(k)
  && (k.result === "pending" || (gathering && k.result !== "fail"));

// The result as one line, the way the row shows it and an acceptance or ask records it:
// "partial — the hover card needs a real hover", "pass — … (no screenshot)", "not checked", "not scoped".
export function resultLine(k) {
  if (!k.result) return k.scoped ? "not checked" : "not scoped";
  return `${k.result}${k.why ? ` — ${k.why}` : ""}${k.missing ? " (no screenshot)" : ""}`;
}

// Whether a row shows without unfolding the list: a failure, a partial, a missing screenshot,
// unscoped, or not checked once the run is done; never once the user accepted it.
// A pending row (isPending) never does; a "pending" result left on a finished run does.
export const needsLook = (k, finished) => !k.accepted && !k.pending
  && (!k.scoped || k.result === "fail" || k.result === "partial" || k.missing || ((!k.result || k.result === "pending") && finished));

// What an unfolded row shows, in order: the result line in its status colour, the thumbnails
// (they are the proof), the folded details, then what the user can do. `tone` is
// "pass" | "fail" | "partial" | "unchecked" | "pending" | "dim"; actions are "accept", "ask", "asked",
// "unaccept". A pending row offers none: there is nothing to accept or ask for while it is gathered.
// `done` says the task is done: a not-checked or not-scoped one can be accepted only once it
// is, or the run is finished, since there is nothing to accept before.
export function proofRowParts(k, finished, done = true) {
  const tone = k.pending ? "pending" : k.result === "fail" ? "fail" : k.result === "partial" || k.missing ? "partial"
    : k.result === "pass" ? "pass" : !k.scoped || finished ? "unchecked" : "dim";
  const details = [
    k.planned && { label: "Planned", text: k.planned.text || "(no evidence named)" },
    k.checked && { label: "Checked", text: k.checked },
    k.files.length > 0 && { label: "Files", text: k.files.join(", ") },
  ].filter(Boolean);
  const ask = k.asked ? "asked" : "ask";
  const actions = isPass(k) ? [] : k.accepted ? ["unaccept"] : k.pending ? [] : k.result || done || finished ? ["accept", ask] : [ask];
  return [
    { kind: "result", text: tone === "pending" ? pendingLine(k) : k.scoped ? resultLine(k) : "not scoped — no Proof line in plan.md", tone },
    k.files.length > 0 && { kind: "thumbs", files: k.files },
    details.length > 0 && { kind: "details", items: details },
    actions.length > 0 && { kind: "actions", actions },
  ].filter(Boolean);
}

// A pending row's result line: proof.md's own "pending — waiting for t4", else why it waits, with
// what proof.md says so far.
export function pendingLine(k) {
  if (k.result === "pending") return resultLine(k);
  return `pending — the task isn't done yet${k.result ? ` (so far: ${resultLine(k)})` : ""}`;
}

// proof-accepted.json → { <task id>: {at, result} }, the entries that hold one; anything else
// (missing, broken) is {}. For showing: a broken file accepts nothing.
export function parseAccepted(text) {
  let v;
  try { v = acceptedFile(text); } catch { return {}; }
  return Object.fromEntries(Object.entries(v).filter(([, e]) => e && typeof e.result === "string"));
}

// proof-accepted.json as written, for changing it: {} when empty or missing; throws when it
// holds something that is not a JSON object, so a hand-edited file is never overwritten.
export function acceptedFile(text) {
  if (!(text ?? "").trim()) return {};
  const v = JSON.parse(text);
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not a JSON object");
  return v;
}

// The file after accepting (entry) or unaccepting (null) one task, as the text to write. Other
// entries, and other fields of this one, are kept as they are.
export function withAcceptance(file, id, entry) {
  const out = { ...file };
  if (entry) out[id] = { ...(out[id] && typeof out[id] === "object" ? out[id] : {}), ...entry }; else delete out[id];
  return `${JSON.stringify(out, null, 2)}\n`;
}

// The Ask to prove message: its first line is what the orchestrator acts on and pendingProofs()
// finds; then what it is asked to do. `tier` is the task's, else the run's (null: none named).
// A task id with whitespace in it (a plan table's cell, "T1 api") is written with "_" for each
// run of it, so the first line keeps one word for the id, and read back the same way.
export const PROVE = /^prove (\S+?)(?: to T([0-3]))?: (.*)$/;
export const proveId = (id) => String(id).replace(/\s+/g, "_");
export function proveRequest(k, tier) {
  const t = k.tier ?? tier;
  return `prove ${proveId(k.id)}${t !== null && t !== undefined ? ` to T${t}` : ""}: ${resultLine(k)}\n`
    + `Asked from Harbormaster: finish this task's proof${t !== null && t !== undefined ? ` to T${t}` : ""} and update its proof.md section.`;
}

// The asks still waiting: the first lines of the run's unhandled inbox messages (data.js), oldest
// first → Map(task id, as proveId() writes it → the result line asked about). A row reads "asked…" only while its result
// line is still that one (proofTasks), and not once the message is renamed .handled.
export function pendingProofs(lines) {
  const out = new Map();
  for (const line of (lines ?? "").split("\n")) {
    const m = PROVE.exec(line.trim());
    if (m) out.set(m[1], m[3]);
  }
  return out;
}

// A row's result pill: {text, tone, tip}. The same word as the row's own line and tone say, so a
// T2+ pass without a screenshot reads "no screenshot" in the partial colour, not "pass".
// `tone`: "pass" | "fail" | "partial" | "amber" | "dim" | "muted" | "other". `finished`: the run is.
export function resultPill(k, finished) {
  if (k.pending) return { text: "pending", tone: "muted", tip: pendingLine(k) };
  // A "pending" left on a finished run reads as not checked, as the verdict counts it.
  if (k.result === "pending") return { text: "not checked", tone: finished ? "amber" : "dim", tip: resultLine(k) };
  if (k.missing && k.result === "pass") {
    const next = k.accepted ? "You accepted it without a screenshot."
      : k.asked ? "Asked its orchestrator to prove it."
      : "Accept it as it is, or ask the orchestrator to prove it.";
    return { text: "no screenshot", tone: "partial", tip: `${resultLine(k)}\nA pass at T${k.tier} needs a screenshot or a recording. ${next}` };
  }
  if (k.result) return { text: k.result, tone: ["pass", "fail", "partial"].includes(k.result) ? k.result : "other", tip: k.why || k.result };
  return k.scoped ? { text: "not checked", tone: finished ? "amber" : "dim", tip: null } : { text: "not scoped", tone: "amber", tip: "No Proof line in plan.md" };
}

// The verdict's counts over proofTasks() rows: accepted rows count only as accepted, pending
// rows (isPending) only as pending, so a partial still being gathered is not a partial yet.
// `unchecked` is the rest: scoped, no result (or a "pending" one on a finished run). `pending`
// counts an unscoped pending row too, as its row says pending; `total` (the pass denominator) doesn't.
export function proofCounts(rows) {
  const scoped = rows.filter((k) => k.scoped);
  const open = scoped.filter((k) => !k.accepted && !k.pending);
  const n = (res) => open.filter((k) => k.result === res).length;
  // A pass at T2+ without a screenshot is not a pass (isPass): it counts as partial, as its row
  // and its segment read it, and says so in the verdict's "without a screenshot".
  const pass = open.filter(isPass).length, fail = n("fail");
  const partial = n("partial") + open.filter((k) => k.result === "pass" && k.missing).length;
  return {
    total: scoped.length, pass, fail, partial,
    // Over scoped rows only, like pass: an accepted unscoped task is in neither count.
    accepted: scoped.filter((k) => k.accepted).length,
    pending: rows.filter((k) => k.pending).length,
    unchecked: open.length - pass - fail - partial,
    missing: open.filter((k) => k.missing).length,
    unscoped: rows.filter((k) => !k.scoped && !k.accepted && !k.pending).length,
  };
}

// ---- the proof was read ----
// "Read" is remembered per run (harbormaster.proofSeen, proofseen.js) as a signature of the proof
// as shown: each scoped task's id, result line and files. Any change to what proof.md says, or to
// the shots, is a new signature, so a proof that moved since it was read reads as unread again.
// Accepting a row changes none of it: the user had looked when they accepted.
export function proofSig(rows) {
  return (rows ?? []).filter((k) => k.scoped).map((k) => `${k.id}|${resultLine(k)}|${(k.files ?? []).join(",")}`).join("\n");
}

// Whether the proof with signature `sig` was read: `seen` is what was stored when the user last
// opened it. No proof (an empty signature) is never read.
export const proofRead = (seen, sig) => Boolean(sig) && seen === sig;

// Every task of a proof passes (or was accepted by the user): proofCounts() over the rows, with
// something to pass and nothing failing, partial, pending, not checked or not scoped.
export const proofClean = (c) => c.total > 0 && c.fail === 0 && c.partial === 0 && c.pending === 0 && c.unchecked === 0 && c.unscoped === 0
  && c.pass + c.accepted === c.total;

// What stands between a read proof and a merge, in words: "5/6 pass, 1 partial", or null when the
// proof is clean. `c` is proofCounts().
export function proofGaps(c) {
  if (proofClean(c)) return null;
  const parts = [`${c.pass + c.accepted}/${c.total} pass`, c.partial && `${c.partial} partial`, c.unchecked && `${c.unchecked} not checked`,
    c.pending && `${c.pending} pending`, c.unscoped && `${c.unscoped} not scoped`].filter(Boolean);
  return parts.join(", ");
}

// The verdict line on top of the Proof section:
// "Proof T2 · 6/8 pass · 2 pending · 1 partial (1 task without a screenshot) · checks green · two-way door".
// {text, tone ("done" | "blocked" | "dim")}, or null when the run has no proof at all. `gathering` and
// `finished` are proofTasks()'s, for which rows are pending; pending rows never make it blocked.
export function proofVerdict({ tier, md, tasks, danger, shotFiles = null, accepted = null, asks = null, gathering = null, finished = false }) {
  const all = proofTasks(tasks, md, shotFiles, { accepted, asks, gathering, finished });
  const rows = all.filter((x) => x.scoped);
  if (!tier && !md && rows.length === 0) return null;
  const { pass, fail, partial, pending, unchecked, missing, accepted: acc } = proofCounts(all);
  const shots = missing > 0 ? `${missing} task${missing > 1 ? "s" : ""} without a screenshot` : "";
  const parts = [`Proof${tier ? ` T${tier.tier}` : ""}`];
  if (rows.length > 0) parts.push(`${pass}/${rows.length} pass`);
  if (acc > 0) parts.push(`${acc} accepted`);
  if (pending > 0) parts.push(`${pending} pending`);
  if (fail > 0) parts.push(`${fail} fail`);
  if (partial > 0) parts.push(`${partial} partial${shots ? ` (${shots})` : ""}`);
  else if (shots) parts.push(shots);
  if (unchecked > 0 && (pass + partial + fail + acc + pending > 0 || md)) parts.push(`${unchecked} not checked`);
  if (md?.cut) parts.push("(proof.md cut)");
  if (md?.checks) parts.push(`checks ${md.checks.state}`);
  const door = /^\W*(one|two)[- ]way/i.exec(danger ?? "");
  if (door) parts.push(`${door[1].toLowerCase()}-way door`);
  const bad = fail > 0 || md?.checks?.state === "red" || door?.[1].toLowerCase() === "one";
  const good = rows.length > 0 && pass + acc === rows.length && !shots && md?.checks?.state !== "red";
  return { text: parts.join(" · "), tone: bad ? "blocked" : good ? "done" : "dim" };
}

// A task's segment on the tasks bar, from its proofTasks() row, once proof has something to say:
// "pass" (green), "accepted" (green: the user took it as it is), "fail" (red), "partial" (amber:
// a partial result, or a pass at T2+ without a screenshot), "unchecked" (amber: a done task without a result once the run is finished). Null
// leaves the segment its stage's colour, so a blocked or never-started task on a finished, parked or
// closed run still reads as blocked or planned, and a pending row (isPending) reads as its stage.
// `row` is null for a run without proof.
export function proofTone(row, finished, done = true) {
  if (!row) return null;
  // An accepted task that isn't done keeps its stage colour: blocked still reads blocked.
  if (row.accepted) return row.result || done ? "accepted" : null;
  if (row.pending) return null;
  if (row.result === "fail") return "fail";
  if (row.result === "partial" || row.missing) return "partial";
  if (row.result === "pass") return "pass";
  return finished && done ? "unchecked" : null;
}

// How a task's segment looks once proofTone() has spoken: {color, mark}. `color` is "stage" (its
// stage's colour: done stays done's, whether or not its proof passed), "blocked" for a failed
// proof or "amber" for proof that wants a look (partial, no screenshot, not checked): amber means
// look soon, never "at work". `mark` is "pass" for a passed or accepted proof, drawn as a green
// underline on the done segment rather than a second colour for done.
export function segmentLook(tone) {
  if (tone === "pass" || tone === "accepted") return { color: "stage", mark: "pass" };
  if (tone === "fail") return { color: "blocked", mark: null };
  if (tone === "partial" || tone === "unchecked") return { color: "amber", mark: null };
  return { color: "stage", mark: null };
}

// How a proofTone() reads in the segment's hover: "proof pass", "proof partial — no screenshot".
export function proofToneText(tone, row) {
  if (!tone) return null;
  if (tone === "accepted") return `proof ${resultLine(row)}, accepted by you`;
  if (tone === "partial" && row?.result === "pass") return "proof pass, but no screenshot";
  if (tone === "unchecked") return row?.scoped ? "proof not checked" : "proof not scoped";
  return `proof ${tone}`;
}
