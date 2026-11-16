// The "- [decided] <UTC time> <topic>: <decision> — <why>" lines of a run's decisions.md,
// the decisions an orchestrator made itself. No herdr imports, so it can be run under plain
// node. The format is in skills/herdr-app-orchestrator/references/run-files.md.

// One line → {at (ms or null), topic, decision, why, raw}. A line that does not read as
// `<time> <topic>: <decision> — <why>` keeps its text in `raw` and puts it in `decision`.
export function parseDecided(line) {
  const raw = String(line ?? "").replace(/^\s*[-*]\s*\[decided\]\s*/i, "").trim();
  const m = /^(\d{4}-\d\d-\d\d[T ][\d:.]+Z?)\s+(.*)$/.exec(raw);
  // A time without a Z is UTC too, as the format says.
  const at = m ? Date.parse(/Z$/.test(m[1]) ? m[1] : `${m[1].replace(" ", "T")}Z`) || null : null;
  const body = m && at ? m[2] : raw;
  const t = /^([^:]{1,60}):\s+(.+)$/s.exec(body);
  if (!at && !t) return { at: null, topic: null, decision: raw, why: null, raw };
  const rest = t ? t[2] : body;
  const w = /^(.*?)\s+[—–]\s+(.+)$/s.exec(rest);
  return { at, topic: t?.[1].trim() ?? null, decision: (w ? w[1] : rest).trim(), why: w?.[2].trim() ?? null, raw };
}

// The script's output (the last lines, oldest first) → at most 20 decisions, newest first.
export const parseDecidedLines = (text) => String(text ?? "").split("\n").filter((l) => /^\s*[-*]\s*\[decided\]/i.test(l))
  .map(parseDecided).filter((d) => d.raw).slice(-20).reverse();

// A decision as one line of text: "Topic: decision — why", or the raw line.
export const decidedText = (d) => (d.topic ? `${d.topic}: ` : "") + d.decision + (d.why ? ` — ${d.why}` : "");
