// An orchestrator's question.md as the run pane's and card's need box show it (question.js
// needHead, questionSections), beside parseQuestion, which the queue and the box share.
// Run: node --import ./loader.mjs --test question.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuestion, needHead, questionSections, paragraphs, plain } from "../../herdr-app/mods/harbormaster/question.js";

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

test("the box's main line is what is asked, with the recommendation in short", () => {
  const q = parseQuestion(STRUCTURED);
  assert.deepEqual(needHead(q), { title: "Asks you: Merge #42 now or wait for t5?", rec: "Recommends Merge now — t5's change is small" });
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
  assert.deepEqual(s.map((x) => x.label), ["Question", "Recommended", "Evidence", "Risk", "Blocks"]);
  assert.equal(s[0].text, "t5 touches the same file.\nMerging first means t5 rebases.");
  assert.equal(s[1].text, "Merge now — t5's change is small");
  assert.equal(s[3].text, "A rebase conflict; reversible.");
});

test("empty sections are left out", () => {
  const text = "# Go?\n\n## Options\n1. **Yes**: go\n2. **No**: stop\n\n## Recommended\n1\n";
  const s = questionSections(parseQuestion(text), text);
  assert.deepEqual(s, [{ label: "Recommended", text: "Yes" }]);
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

test("bold markers are dropped from shown text, other marks kept", () => {
  assert.equal(plain("then **Working** (agents) and __Done__, `a*b`"), "then Working (agents) and Done, `a*b`");
});
