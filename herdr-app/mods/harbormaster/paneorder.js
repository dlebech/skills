// The run pane's sections in the order and size that fit the run's state. Pure (no herdr or gpui),
// so runpane.js runDetail and the tests share it. The header, path strip, need box, live block and
// action row are fixed and not listed here.

// A finished run is read before a review: what was decided, what is claimed, the PR, then the
// tasks and agents as one line each. A running run shows who works on what first.
// → [{ key, compact }]
export function paneSections({ finished }) {
  const keys = finished
    ? [["decisions"], ["claims"], ["prs"], ["issues"], ["tasks", true], ["agents", true], ["tokens"]]
    : [["agents"], ["tasks"], ["claims"], ["decisions"], ["prs"], ["issues"], ["tokens"]];
  return keys.map(([key, compact = false]) => ({ key, compact }));
}

// The one line of a folded Agents section: "Agents · 2" and the first three names, then "+n" for
// the rest. → { head, names } (names is "" with no agents).
export function agentsSummary(names, shown = 3) {
  const list = names.slice(0, shown).concat(names.length > shown ? [`+${names.length - shown}`] : []);
  return { head: `Agents · ${names.length}`, names: list.join(", ") };
}

// The decisions to show above a finished run's fold: the newest `n` the orchestrator made itself
// (not the user's), since those are the ones to audit before a review. `decided` is newest first.
export const auditDecisions = (decided, n = 3) => decided.filter((d) => d.by !== "user").slice(0, n);
