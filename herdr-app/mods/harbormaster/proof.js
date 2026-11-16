// A run's proof: each task's `Proof:` line and the run's `Proof tier:` from plan.md, and
// proof.md's per-task results. No herdr imports, so it can be run under plain node. The
// format is in skills/herdr-app-orchestrator/references/run-files.md.

import { isImage, isVideo } from "./media.js";

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
// "## <task id> <task name>"; its Result is "pass | fail | partial — one line".
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
  for (const line of text.split("\n")) {
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
      const r = /^(pass|fail|partial)\b[\s—–:-]*(.*)$/i.exec(val);
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
export function proofTasks(tasks, md, shotFiles = null) {
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
  return rows;
}

// The verdict line on top of the Proof section:
// "Proof T2 · 6/8 pass · 2 partial (2 tasks without a screenshot) · checks green · two-way door".
// {text, tone ("done" | "blocked" | "dim")}, or null when the run has no proof at all.
export function proofVerdict({ tier, md, tasks, danger, shotFiles = null }) {
  const rows = proofTasks(tasks, md, shotFiles).filter((x) => x.scoped);
  if (!tier && !md && rows.length === 0) return null;
  const n = (res) => rows.filter((x) => x.result === res).length;
  const pass = n("pass"), partial = n("partial"), fail = n("fail");
  const pending = rows.length - pass - partial - fail;
  const missing = rows.filter((x) => x.missing).length;
  const shots = missing > 0 ? `${missing} task${missing > 1 ? "s" : ""} without a screenshot` : "";
  const parts = [`Proof${tier ? ` T${tier.tier}` : ""}`];
  if (rows.length > 0) parts.push(`${pass}/${rows.length} pass`);
  if (fail > 0) parts.push(`${fail} fail`);
  if (partial > 0) parts.push(`${partial} partial${shots ? ` (${shots})` : ""}`);
  else if (shots) parts.push(shots);
  if (pending > 0 && (pass + partial + fail > 0 || md)) parts.push(`${pending} not checked`);
  if (md?.cut) parts.push("(proof.md cut)");
  if (md?.checks) parts.push(`checks ${md.checks.state}`);
  const door = /^\W*(one|two)[- ]way/i.exec(danger ?? "");
  if (door) parts.push(`${door[1].toLowerCase()}-way door`);
  const bad = fail > 0 || md?.checks?.state === "red" || door?.[1].toLowerCase() === "one";
  const good = rows.length > 0 && pass === rows.length && !shots && md?.checks?.state !== "red";
  return { text: parts.join(" · "), tone: bad ? "blocked" : good ? "done" : "dim" };
}
