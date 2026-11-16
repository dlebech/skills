// An orchestrator's question.md as the run pane's and card's need box show it (question.js
// needHead, questionSections), beside parseQuestion, which the queue and the box share.
// Run: node --import ./loader.mjs --test question.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuestion, needHead, blocksLine, BLOCKS_MAX, questionSections, paragraphs, plain, replyId, replyItem } from "../../herdr-app/mods/harbormaster/question.js";

const STRUCTURED = `# Merge #42 now or wait for t5?

## Question
t5 touches the same file.
Merging first means t5 rebases.

## Options
1. **Merge now**: t5 rebases
2. **Wait**: merge after t5

## Recommended
Merge now: t5's change is small

## Evidence
proof/t2-tests.txt: 36 pass

## Risk
A rebase conflict; reversible.

## Blocks
t4 shots
`;

test("a structured question reads into its sections, the recommended option by label", () => {
  const q = parseQuestion(STRUCTURED);
  assert.equal(q.title, "Merge #42 now or wait for t5?");
  assert.equal(q.structured, true);
  assert.deepEqual(q.options.map((o) => o.label), ["Merge now", "Wait"]);
  assert.equal(q.recommended, 0);
  assert.equal(q.why, "t5's change is small");
});

test("the box's main line is what is asked, with the recommendation in short and what it blocks", () => {
  const q = parseQuestion(STRUCTURED);
  assert.deepEqual(needHead(q), { title: "Asks you: Merge #42 now or wait for t5?", rec: "Recommends Merge now — t5's change is small", blocks: "Blocks t4 shots" });
});

test("Blocks is one short line: list items joined, bold dropped; a long one is cut and kept in Details", () => {
  const list = parseQuestion("# Go?\n\n## Blocks\n- **t4**\n- t5\n");
  assert.equal(needHead(list).blocks, "Blocks t4; t5");
  assert.deepEqual(blocksLine(list), { text: "t4; t5", cut: false });
  assert.equal(needHead(parseQuestion("# Go?\n\n## Risk\nlow\n")).blocks, null);
  const long = `# Go?\n\n## Blocks\n${"x".repeat(BLOCKS_MAX + 10)}\n`;
  const q = parseQuestion(long);
  assert.equal(needHead(q).blocks.length, "Blocks ".length + BLOCKS_MAX);
  assert.ok(needHead(q).blocks.endsWith("…"));
  assert.deepEqual(questionSections(q, long).map((x) => x.label), ["Blocks"]);
});

test("a recommendation that names no option is still shown, a missing one is not", () => {
  const named = parseQuestion("# Which?\n\n## Options\n1. **Ship**: go\n\n## Recommended\nneither, ask Anna\n");
  assert.equal(needHead(named).rec, "Recommends neither, ask Anna");
  const none = parseQuestion("# Which?\n\n## Options\n1. **Ship**: go\n");
  assert.equal(needHead(none).rec, null);
});

test("the details list each section with text, in the file's order, whole and multi-line", () => {
  const q = parseQuestion(STRUCTURED);
  const s = questionSections(q, STRUCTURED);
  // Blocks is the head's own line, whole there, so not again here.
  assert.deepEqual(s.map((x) => x.label), ["Question", "Recommended", "Evidence", "Risk"]);
  assert.equal(s[0].text, "t5 touches the same file.\nMerging first means t5 rebases.");
  // The starred option names the recommendation: Recommended keeps only its why.
  assert.equal(s[1].text, "t5's change is small");
  assert.equal(s[3].text, "A rebase conflict; reversible.");
});

test("empty sections are left out, and a Recommended that only names the starred option", () => {
  const text = "# Go?\n\n## Options\n1. **Yes**: go\n2. **No**: stop\n\n## Recommended\n1\n";
  const s = questionSections(parseQuestion(text), text);
  assert.deepEqual(s, []);
});

test("a Recommended why that repeats the starred option's own text is dropped", () => {
  const text = "# Go?\n\n## Options\n1. **Yes**: ship it today.\n2. **No**: stop\n\n## Recommended\nYes — Ship it today\n";
  assert.deepEqual(questionSections(parseQuestion(text), text), []);
});

test("a free-form question shows its whole text under the title as the Question", () => {
  const text = "Should I rebase onto main?\n\nThe branch is 40 commits behind.\nCI is green either way.\n";
  const q = parseQuestion(text);
  assert.equal(q.structured, false);
  assert.equal(needHead(q).title, "Asks you: Should I rebase onto main?");
  assert.deepEqual(questionSections(q, text), [{ label: "Question", text: "The branch is 40 commits behind.\nCI is green either way." }]);
});

test("a free-form question of one line has no details beyond its title", () => {
  const text = "# Ship it?\n";
  assert.deepEqual(questionSections(parseQuestion(text), text), []);
});

test("no question, no head or details", () => {
  assert.equal(needHead(null), null);
  assert.deepEqual(questionSections(null, ""), []);
});

test("hard-wrapped lines read as paragraphs; list items and blank lines break them", () => {
  const text = "Everything else says nothing. What sits there:\nruns whose agents\nare working.\n\nSecond **para**.\n- one\n- two\n  continued\n1. three";
  assert.deepEqual(paragraphs(text), [
    "Everything else says nothing. What sits there: runs whose agents are working.",
    "Second para.",
    "- one",
    "- two continued",
    "1. three",
  ]);
  assert.deepEqual(paragraphs(""), []);
});

test("bold markers are dropped from shown text, underscores and other marks kept", () => {
  assert.equal(plain("then **Working** (agents), `a*b`"), "then Working (agents), `a*b`");
  assert.equal(plain("edit pkg/__init__.py and foo__bar__baz"), "edit pkg/__init__.py and foo__bar__baz");
  assert.deepEqual(paragraphs("see __init__.py"), ["see __init__.py"]);
});

test("Recommended shows its why, then the rest of its body", () => {
  const text = "# Which?\n\n## Options\n1. **A one**: a\n2. **B two**: b\n\n## Recommended\nB two: short\nLonger reasoning\non two lines.\n";
  const s = questionSections(parseQuestion(text), text);
  assert.deepEqual(s, [{ label: "Recommended", text: "short\n\nLonger reasoning\non two lines." }]);
  assert.deepEqual(paragraphs(s[0].text), ["short", "Longer reasoning on two lines."]);
});

test("text before the first section and unknown sections are kept, unknown ones last", () => {
  const text = "# Which?\nSome lead-in.\n\n## Context\nWhy now.\n\n## Question\nThe ask.\n\n## Notes\n\n## Risk\nLow.\n";
  const s = questionSections(parseQuestion(text), text);
  assert.deepEqual(s, [
    { label: "", text: "Some lead-in." },
    { label: "Question", text: "The ask." },
    { label: "Risk", text: "Low." },
    { label: "Context", text: "Why now." },
  ]);
});

test("a need box's Reply id maps back to the queue item's id; the queue's is its own", () => {
  assert.equal(replyId("", "need-local:/r"), "need-local:/r");
  assert.equal(replyId("box", "need-local:/r"), "box:need-local:/r");
  assert.equal(replyItem(replyId("box", "need-local:/r")), "need-local:/r");
  assert.equal(replyItem(replyId("", "dec-x")), "dec-x");
  assert.equal(replyItem(null), null);
});
