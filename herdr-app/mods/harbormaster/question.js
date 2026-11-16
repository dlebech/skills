// An orchestrator's question.md, read into the shape the decision queue shows. No
// herdr imports, so it can be run under plain node. The format is in
// skills/herdr-app-orchestrator/references/run-files.md.

// The sections a structured question.md has, lower-cased, as the keys they are read under.
const SECTIONS = ["question", "options", "recommended", "evidence", "risk", "blocks"];

// Only a bold pair around the start is dropped: `_`, `*` and backticks inside a title or
// label are part of it (branch names, file names, code), and answers quote it back.
const unbold = (s) => s.replace(/^(\*\*|__)(.+?)\1/, "$2").trim();

// "**Label**: what happens", "Label: what happens", "Label — what happens" → {label, text}.
function optionOf(item) {
  const bold = /^\*\*(.+?)\*\*[\s:—–-]*(.*)$/s.exec(item) ?? /^__(.+?)__[\s:—–-]*(.*)$/s.exec(item);
  if (bold) return { label: bold[1].replace(/[:\s]+$/, ""), text: bold[2].trim() };
  const split = /^(.+?)(?::\s+|\s[—–]\s+)(.*)$/s.exec(item);
  if (split) return { label: unbold(split[1]), text: split[2].trim() };
  return { label: unbold(item), text: "" };
}

// The numbered or bulleted items under ## Options; a line that is not an item continues the one above.
function optionsOf(body) {
  const items = [];
  for (const line of body.split("\n")) {
    const m = /^\s*(?:\d+[.)]|[-*])\s+(.*)$/.exec(line);
    if (m) items.push(m[1].trim());
    else if (items.length && line.trim()) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items.map(optionOf).filter((o) => o.label);
}

// Which option ## Recommended names, by its first line: a number ("2", "Option 2"), else a
// label, case-insensitive, either side containing the other. -1 when none fits.
function recommendedIndex(body, options) {
  const first = unbold(body.split("\n").find((l) => l.trim()) ?? "");
  const lead = first.replace(/[:—–].*$/s, "").trim().toLowerCase();
  if (!lead) return -1;
  const n = /^(?:option\s+)?#?(\d+)\.?$/.exec(lead);
  if (n) return Number(n[1]) <= options.length ? Number(n[1]) - 1 : -1;
  const labels = options.map((o) => o.label.toLowerCase());
  const exact = labels.indexOf(lead);
  if (exact >= 0) return exact;
  const whole = first.toLowerCase();
  return labels.findIndex((l) => lead.includes(l) || l.includes(lead) || whole.startsWith(l));
}

// question.md's text → {title, structured, question, options, recommended, why, evidence, risk, blocks}.
// `title` is the "# " line, else the first non-empty line (what free-form files have
// always shown). `recommended` is an index into `options`, or null; `why` is what follows
// the label in ## Recommended. A file without any "## " section is free-form: only a title.
// Returns null for no question.
export function parseQuestion(text) {
  if (!text?.trim()) return null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const head = lines.find((l) => l.trim());
  const title = head.replace(/^#+\s*/, "").trim() || head.trim();
  const parts = {};
  let key = null;
  for (const line of lines) {
    const h = /^##\s+(.*?)\s*$/.exec(line);
    if (h) { key = SECTIONS.find((s) => s === h[1].toLowerCase()) ?? null; if (key) parts[key] = []; continue; }
    if (key) parts[key].push(line);
  }
  const body = (k) => (parts[k] ?? []).join("\n").trim();
  const structured = SECTIONS.some((k) => parts[k]);
  const options = structured ? optionsOf(body("options")) : [];
  const rec = recommendedIndex(body("recommended"), options);
  const why = body("recommended").split("\n").find((l) => l.trim())?.replace(/^[^:—–]*[:—–]\s*/, "").trim() ?? "";
  return {
    title,
    structured,
    question: body("question"),
    options,
    recommended: rec >= 0 ? rec : null,
    why: rec >= 0 ? why : body("recommended").split("\n").find((l) => l.trim()) ?? "",
    evidence: body("evidence"),
    risk: body("risk"),
    blocks: body("blocks"),
  };
}

// The message an answer writes to a run's inbox (run-files.md): the answer to the question
// by its title, then any free text. `answer` is an option's label or the person's own words.
export function answerMessage(title, answer, free = "") {
  return `Answer to "${title}": ${answer}${free ? `\n${free}` : ""}`;
}

// A decision (the captain's, or a question.md read as one) squeezed to a line for the queue.
export const oneLine = (s, max = 160) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
