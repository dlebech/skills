// Which agent and task each terminal's CPU and memory belong to: timing.sh's agents (named by
// worktree, labelled by their brief) joined with .resources.json's terminals (named as herdr-core
// terminals, with their parent). One rule for the stats view's open runs (statsdata.js) and the
// history line (history.js), so a run's figures do not change when it moves into the history.
// Pure, and no "herdr" import, so tests and both modules use it as is.

const num = (v) => Number(v) || 0;
const r1 = (x) => Math.round(x * 10) / 10;

// The task in a terminal's name, "impl-rss-t3" → "t3" for prefix "rss"; null when it names none.
// "final" (the final review) is no task; a round suffix ("rev-rss-t2-2") is dropped when what is
// left is a task in `known`, as data.js's taskAgents does.
export function taskOfName(name, prefix, known = null) {
  if (!prefix) return null;
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const task = new RegExp(`^[a-z]+-${esc}-(.+)$`, "i").exec(name ?? "")?.[1] ?? null;
  if (task === null || task === "final") return null;
  const base = /^(.+)-\d+$/.exec(task)?.[1];
  return base && known?.has(base) ? base : task;
}

// `agents` timing's agents (copied, not changed); `terms` .resources.json's `agents` (by terminal
// name: {parent, cpu_s, peak_rss_mb, avg_rss_mb, last_ms}). Returns timing's agents, in order, each
// with cpu_s, peak_rss_mb and avg_rss_mb (null when no terminal is theirs), then one row per
// terminal tree no timing agent claims ({name, label, role, task, kind: null, total: 0, categories: {}}).
// A terminal goes to:
//   - the timing agent whose label, else name, it is (the first such agent: a restarted agent can have two);
//   - for the parentless terminal seen last, the orchestrator; an older parentless one (a resumed
//     run's earlier orchestrator) is a row of its own;
//   - else the agent its parent chain reaches (the commands an agent started with hc run);
//   - else, a terminal right under the orchestrator that timing does not know (a grunt, an agent
//     whose session was not read): a row of its own, its task from its name, its children with it.
// An agent's CPU adds its terminals'; its memory peak and average are its largest terminal's, as
// its terminals were not sampled as one.
export function attributeResources(agents, terms, prefix = null) {
  terms = terms && typeof terms === "object" ? terms : {};
  const rows = (agents ?? []).map((a) => ({ ...a, cpu_s: a.cpu_s ?? null, peak_rss_mb: a.peak_rss_mb ?? null, avg_rss_mb: a.avg_rss_mb ?? null }));
  const known = new Set(rows.map((a) => a.task).filter(Boolean));
  const byName = new Map();
  for (const a of rows) for (const k of [a.label, a.name]) if (k && !byName.has(k)) byName.set(k, a);
  const orch = rows.find((a) => a.role === "orchestrator") ?? null;
  const isRoot = (n) => !terms[n]?.parent || !terms[terms[n].parent];
  const roots = Object.keys(terms).filter(isRoot).sort((p, q) => num(terms[q].last_ms) - num(terms[p].last_ms));
  const orchTerm = roots.find((n) => !byName.has(n)) ?? null;
  const extra = new Map();
  const own = (top) => {
    let a = extra.get(top);
    if (!a) {
      a = { name: top, label: top, role: /^([a-z]+)-/i.exec(top)?.[1]?.toLowerCase() ?? "agent", task: taskOfName(top, prefix, known), kind: null, total: 0, categories: {}, cpu_s: null, peak_rss_mb: null, avg_rss_mb: null };
      extra.set(top, a);
    }
    return a;
  };
  const ownerOf = (name, depth = 0) => {
    if (byName.has(name)) return byName.get(name);
    if (depth > 20) return own(name);
    if (isRoot(name)) return name === orchTerm && orch ? orch : own(name);
    // Right under a root (the orchestrator's terminal): an agent timing does not know.
    if (isRoot(terms[name].parent) && !byName.has(terms[name].parent)) return own(name);
    return ownerOf(terms[name].parent, depth + 1);
  };
  for (const [name, t] of Object.entries(terms)) {
    const a = ownerOf(name);
    a.cpu_s = r1((a.cpu_s ?? 0) + num(t.cpu_s));
    a.peak_rss_mb = Math.max(a.peak_rss_mb ?? 0, num(t.peak_rss_mb));
    a.avg_rss_mb = Math.max(a.avg_rss_mb ?? 0, num(t.avg_rss_mb));
  }
  return [...rows, ...extra.values()];
}

// timing.sh's tasks with each one's CPU (the sum of its agents') and memory peak (its largest
// agent's; they need not have run together), null when none of its agents has any; and a task
// only an agent row names (no session read yet) added with total null.
export function taskResources(tasks, agents) {
  const out = (tasks ?? []).map((t) => ({ id: t.id, total: t.total ?? null, categories: t.categories ?? {}, cpu_s: null, peak_rss_mb: null }));
  for (const a of agents) {
    if (!a.task) continue;
    let k = out.find((x) => x.id === a.task);
    if (!k) { k = { id: a.task, total: null, categories: {}, cpu_s: null, peak_rss_mb: null }; out.push(k); }
    if (a.cpu_s != null) k.cpu_s = r1((k.cpu_s ?? 0) + a.cpu_s);
    if (a.peak_rss_mb != null) k.peak_rss_mb = Math.max(k.peak_rss_mb ?? 0, a.peak_rss_mb);
  }
  return out;
}
