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

// A leading number's comma read as the separator it is: "1, it is what production runs." is
// option 1 and its why, as "1: it is…" is. Only after a number: a label may hold a comma.
const numComma = (line) => line.replace(/^(\s*[*_]*(?:option\s+)?#?\d+\.?[*_]*)\s*,/i, "$1:");

// Which option ## Recommended names, by its first line: a number ("2", "Option 2", "1, …"), else
// a label, case-insensitive, either side containing the other. -1 when none fits.
function recommendedIndex(body, options) {
  const first = unbold(numComma(body.split("\n").find((l) => l.trim()) ?? ""));
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
  // What the known sections don't hold, kept for Details: the text between the title and the
  // first "## ", and any other section (## Context), by its heading as written.
  const before = [];
  const extra = [];
  let key = null, other = null, seen = false;
  for (const line of lines.slice(lines.indexOf(head) + 1)) {
    const h = /^##\s+(.*?)\s*$/.exec(line);
    if (h) {
      seen = true;
      key = SECTIONS.find((s) => s === h[1].toLowerCase()) ?? null;
      if (key) { parts[key] = []; other = null; } else extra.push((other = { label: h[1], lines: [] }));
      continue;
    }
    if (key) parts[key].push(line);
    else if (other) other.lines.push(line);
    else if (!seen) before.push(line);
  }
  const body = (k) => (parts[k] ?? []).join("\n").trim();
  const structured = SECTIONS.some((k) => parts[k]);
  const options = structured ? optionsOf(body("options")) : [];
  const rec = recommendedIndex(body("recommended"), options);
  // Only what follows a separator is why: a bare "2" or label has none.
  const first = numComma(body("recommended").split("\n").find((l) => l.trim()) ?? "");
  const why = /[:—–]/.test(first) ? first.replace(/^[^:—–]*[:—–]\s*/, "").trim() : "";
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
    // ## Recommended below its first line: the longer why some orchestrators add.
    recMore: body("recommended").split("\n").slice(body("recommended").split("\n").findIndex((l) => l.trim()) + 1).join("\n").trim(),
    before: before.join("\n").trim(),
    extra: extra.map((x) => ({ label: x.label, text: x.lines.join("\n").trim() })).filter((x) => x.text),
  };
}

// The most a need box's Blocks line holds; past it, Details has the whole section.
export const BLOCKS_MAX = 120;

// ## Blocks in one short line ("t4, t5"): its lines joined, list markers and bold dropped, capped
// at BLOCKS_MAX; `cut` when that left something out. null without a Blocks section.
export function blocksLine(q) {
  const text = (q?.blocks ?? "").split("\n").map((l) => plain(l.trim().replace(/^(?:\d+[.)]|[-*])\s+/, ""))).filter(Boolean).join("; ");
  if (!text) return null;
  const cut = text.length > BLOCKS_MAX || /\n\s*\n/.test(q.blocks.trim());
  return { text: text.length > BLOCKS_MAX ? `${text.slice(0, BLOCKS_MAX - 1)}…` : text, cut };
}

// The need box's lines for a question, read from its summary alone: what is asked, the
// recommendation in short ("Recommends Merge now — t5's change is small"), or null without one,
// and what waits on the answer ("Blocks t4, t5"), the urgency cue, or null.
export function needHead(q) {
  if (!q) return null;
  const rec = q.recommended !== null ? q.options[q.recommended] : null;
  const text = rec ? `${rec.label}${q.why ? ` — ${q.why}` : ""}` : q.why;
  const blocks = blocksLine(q);
  return { title: `Asks you: ${q.title}`, rec: text ? `Recommends ${text}` : null, blocks: blocks ? `Blocks ${blocks.text}` : null };
}

// Two texts that say the same, give or take case, spaces and end punctuation.
export const sameText = (a, b) => {
  const n = (s) => plain(s ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
  return Boolean(n(a)) && n(a) === n(b);
};

// A Waiting-on-you row's lines under its title, as the need box orders them: Blocks first (the
// urgency cue, one short line), then the recommendation's why only when the starred option's
// button and hover don't say it already, then Evidence and Risk. [{key, label, text}], for a
// run's question and a captain decision alike (data.js decisionQueue items).
export function queueLines(it) {
  const rec = it?.recommended != null ? it.options?.[it.recommended] : null;
  const why = it?.why && !(rec && sameText(it.why, rec.text)) ? it.why : "";
  const blocks = blocksLine(it);
  return [
    { key: "blocks", label: "Blocks", text: blocks?.text ?? "" },
    { key: "rec", label: rec ? "Why" : "Recommended", text: why },
    { key: "evidence", label: "Evidence", text: it?.evidence ?? "" },
    { key: "risk", label: "Risk", text: it?.risk ?? "" },
  ].filter((x) => x.text);
}

// The question's sections as the need box's Details list them, [{label, text}], each whole
// (line breaks kept), unknown sections last under their own heading and only when it has text; the options are buttons, so not here. A
// free-form question (`raw` is question.md's text) is its text below the title line.
export function questionSections(q, raw) {
  if (!q) return [];
  if (!q.structured) {
    const lines = (raw ?? "").replace(/\r\n?/g, "\n").split("\n");
    const rest = lines.slice(lines.findIndex((l) => l.trim()) + 1).join("\n").trim();
    return rest ? [{ label: "Question", text: rest }] : [];
  }
  const rec = q.recommended !== null ? q.options[q.recommended] : null;
  // The options list stars the recommended one with its text, and the head says it in short:
  // Recommended keeps only the why they don't say already, and any longer reason below it.
  const recLine = rec ? (sameText(q.why, rec.text) ? "" : q.why) : q.why;
  const blocks = blocksLine(q);
  return [
    // Text between the title and the first section has no label of its own.
    { label: "", text: q.before },
    { label: "Question", text: q.question },
    { label: "Recommended", text: [recLine, q.recMore].filter(Boolean).join("\n\n") },
    { label: "Evidence", text: q.evidence },
    { label: "Risk", text: q.risk },
    // The head's Blocks line says it whole unless it had to cut it.
    { label: "Blocks", text: blocks?.cut ? q.blocks : "" },
    ...q.extra,
  ].filter((s) => s.text);
}

// The id view.replying holds for a queue item's Reply: the queue's as is, a need box's under
// "box:" so a card and the queue in one overview never open the same Reply; and back to the
// queue item's id, which is what submitReply answers.
export const replyId = (slot, id) => `${slot ? `${slot}:` : ""}${id}`;
export const replyItem = (rid) => rid?.replace(/^box:/, "") ?? null;

// A section's text as the lines to show: the file's hard-wrapped lines joined into
// paragraphs (a blank line ends one), a list item on a line of its own, and Markdown's bold
// markers dropped, since the box shows plain text.
export function paragraphs(text) {
  const out = [];
  let joining = false;
  for (const raw of (text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = plain(raw.trim());
    if (!line) { joining = false; continue; }
    const item = /^(?:\d+[.)]|[-*])\s/.test(raw.trim());
    if (joining && !item) out[out.length - 1] += ` ${line}`;
    else out.push(line);
    joining = true;
  }
  return out;
}

// Markdown's bold pairs (**x**) dropped from text shown as is. Not __x__: underscores are
// part of file names and identifiers (__init__.py, foo__bar__baz).
export const plain = (s) => (s ?? "").replace(/\*\*(.+?)\*\*/g, "$1");

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
