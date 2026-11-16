// A run's proof: each task's `Proof:` line and the run's `Proof tier:` from plan.md, and
// proof.md's per-task results. No herdr imports, so it can be run under plain node. The
// format is in skills/herdr-app-orchestrator/references/run-files.md.

// "T1 — the evidence", "T1: the evidence", "T2" → {tier: 1, text}; null when no T0..T3 leads it.
export function proofOf(s) {
  const m = /^[*_`\s]*T([0-3])\b[*_`]*\s*(?:[—–:-]\s*)?(.*)$/s.exec(s ?? "");
  return m ? { tier: Number(m[1]), text: m[2].replace(/[*_`]+$/, "").trim() } : null;
}

// plan.md's `Proof tier: T2` or `Proof tier: T2 (set by user)` → {tier, byUser}, else null.
export function declaredTier(plan) {
  const m = /^Proof tier:\s*T([0-3])\b(.*)$/im.exec(plan ?? "");
  return m ? { tier: Number(m[1]), byUser: /set by user/i.test(m[2]) } : null;
}

// The run's tier: the declared line, else the highest of its tasks' tiers, else null (nothing named).
export function runTier(plan, tasks) {
  const declared = declaredTier(plan);
  if (declared) return declared;
  const tiers = tasks.filter((t) => t.proof).map((t) => t.proof.tier);
  return tiers.length ? { tier: Math.max(...tiers), byUser: false } : null;
}

// proof.md → { tier, tasks: { <task id>: {tier, checked, result, why, files} } }. A task's section is
// "## <task id> <task name>"; its Result is "pass | fail | partial — one line".
export function parseProofMd(text) {
  const out = { tier: null, tasks: {} };
  if (!text) return out;
  let cur = null;
  for (const line of text.split("\n")) {
    const h = /^##\s+(\S+)/.exec(line);
    if (h) { cur = out.tasks[h[1]] = { tier: null, checked: "", result: null, why: "", files: [] }; continue; }
    const kv = /^(Tier|Checked|Result|Files):\s*(.*)$/i.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase(), val = kv[2].trim();
    if (!cur) { if (key === "tier") out.tier = proofOf(val)?.tier ?? null; continue; }
    if (key === "tier") cur.tier = proofOf(val)?.tier ?? null;
    else if (key === "checked") cur.checked = val;
    else if (key === "files") cur.files = val.split(",").map((f) => f.trim()).filter(Boolean);
    else {
      const r = /^(pass|fail|partial)\b[\s—–:-]*(.*)$/i.exec(val);
      if (r) { cur.result = r[1].toLowerCase(); cur.why = r[2].trim(); }
    }
  }
  return out;
}
