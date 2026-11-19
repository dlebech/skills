// The captain's decisions as rows in the sidebar's Needs-you box (crew.js through crew(view, t) and
// queueSections), the title that opens the Bridge, and that a parked run never shows there.
// Run: node --import ./loader.mjs --test decision-rows.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetShared } from "herdr";
import { find } from "gpui-kit";
import { crew, queueSections } from "../../herdr-app/mods/harbormaster/crew.js";
import { forgetSentToCaptain } from "../../herdr-app/mods/harbormaster/answers.js";
import { stats } from "../../herdr-app/mods/harbormaster/data.js";
import { needRunsOf } from "../../herdr-app/mods/harbormaster/crewrows.js";

const t = new Proxy({}, { get: () => "#888" });
const text = (e) => (e && typeof e === "object" && "kids" in e ? e.kids.map(text).join("") : typeof e === "string" ? e : "");
const cx = { notify() {}, stop_propagation() {} };
const ago = (m) => Date.now() - m * 60000;
const decision = (id, o = {}) => ({ key: `:${id}`, id, question: `Move ${id}?`, run: null, asked: ago(10), machine: null,
  options: [{ label: "Yes", text: "do it" }, { label: "No", text: "leave it" }], recommended: 0, why: "", evidence: "", risk: "", blocks: "", ...o });
const captain = { address: "cap", name: "captain", labels: { role: "captain" }, state: "live", status: "idle" };
let view;
beforeEach(() => {
  resetShared();
  view = { runs: [], decisions: [], folds: new Map(), replying: null };
  globalThis.__herdrTerminals = [];
  globalThis.__herdrAgents = [];
  globalThis.__herdrOpened = null;
  globalThis.__herdrExec = async () => ({ code: 0, stdout: "[]", stderr: "" });
});
const ids = (d) => ["a", "b", "c"].flatMap((n) => [find(d, `crew-need-dec-:${n}`) && n].filter(Boolean));

test("each decision is a row, the first the open box, and the heading counts them", () => {
  view.decisions = [decision("a", { asked: ago(30) }), decision("b")];
  const d = crew(view, t);
  assert.match(text(find(d, "crew-group-needs")), /Needs you · 2/);
  assert.deepEqual(ids(d), ["b"], "a is the box, b a row under it");
  assert.match(text(find(d, "crew-needs-box")), /Move a\?/);
  assert.match(text(find(d, "crew-needs-box")), /captain · 30m/);
  assert.match(text(find(d, "crew-need-dec-:b")), /Move b\?captain · 10m/);
  assert.equal(find(d, "crew-needs-captain"), null, "the dim note is gone");
});

test("a click on a row opens that decision as the box", () => {
  view.decisions = [decision("a", { asked: ago(30) }), decision("b")];
  find(crew(view, t), "crew-need-dec-:b").click({}, cx);
  const d = crew(view, t);
  assert.match(text(find(d, "crew-needs-box")), /Move b\?/);
  assert.deepEqual(ids(d), ["a"]);
});

test("the box's one button is the recommended option; N more counts the rest", () => {
  globalThis.__herdrTerminals = [captain];
  view.decisions = [decision("a")];
  const box = find(crew(view, t), "crew-needs-box");
  assert.match(text(box), /★ Yes/);
  assert.doesNotMatch(text(box), /No/);
  assert.match(text(find(box, "crew-box-more-dec-:a-toggle")), /2 more/);
});

test("with no captain, a decision that names no run offers Start captain", () => {
  view.decisions = [decision("a")];
  const box = find(crew(view, t), "crew-needs-box");
  const start = find(box, "crew-box-more-dec-:a-start");
  assert.equal(text(start), "Start captain");
  start.click({}, cx);
  assert.equal(globalThis.__herdrOpened.props.kind, "captain");
});

test("with a captain running, a decision with no option opens the captain", () => {
  globalThis.__herdrTerminals = [captain];
  view.decisions = [decision("a", { options: [], recommended: null })];
  const box = find(crew(view, t), "crew-needs-box");
  assert.equal(text(find(box, "crew-box-more-dec-:a-open")), "Open captain");
});

test("the captain link and the pill carry no count", () => {
  view.decisions = [decision("a"), decision("b")];
  assert.equal(text(find(crew(view, t), "crew-start-captain")), "⚓+");
  globalThis.__herdrTerminals = [captain];
  assert.equal(text(find(crew(view, t), "crew-captain-link")), "captain ↗");
});

test("four rows then + n more; queueSections with all shows every one, with no toggle", () => {
  view.decisions = ["a", "b", "c", "d", "e", "f"].map((n, i) => decision(n, { asked: ago(60 - i) }));
  const count = (els) => els.filter((e) => String(e.idv ?? "").startsWith("crew-need-dec-") || e.idv === "crew-needs-box").length;
  const part = (els) => ({ kids: els, idv: null });
  const some = queueSections(view, t);
  assert.equal(count(some), 4);
  assert.match(text(find(part(some), "crew-needs-more-toggle")), /\+ 2 more waiting/);
  const all = queueSections(view, t, { all: true });
  assert.equal(count(all), 6);
  assert.equal(find(part(all), "crew-needs-more-toggle"), null);
});

test("the title opens the Bridge, with or without a captain", () => {
  const title = find(crew(view, t), "crew-title");
  assert.match(text(title), /Harbormaster/);
  title.click({}, cx);
  assert.equal(globalThis.__herdrOpened.mod, "harbormaster");
  assert.deepEqual(globalThis.__herdrOpened.props, {});
  globalThis.__herdrOpened = null;
  globalThis.__herdrTerminals = [captain];
  find(crew(view, t), "crew-title").click({}, cx);
  assert.ok(globalThis.__herdrOpened);
});

test("a parked run, with an open PR or a merged one, gets no row, group or count in the sidebar", () => {
  const parked = (key, state) => ({ key, dir: `/runs/${key}`, away: "parked", phase: "finished", terminal: null, prs: [{ url: `u-${key}`, number: 1, state }], question: null, ask: null });
  view.runs = [parked("p1", "OPEN"), parked("p2", "MERGED")];
  const s = stats(view.runs, {});
  assert.equal(s.shown.length, 0);
  assert.deepEqual(needRunsOf(s.shown, () => ({ group: "needs" })), []);
  const d = crew(view, t);
  const drawn = text(d);
  assert.doesNotMatch(drawn, /p1|p2|Parked|Needs you/);
  assert.equal(find(d, "crew-group-needs"), null);
  assert.equal(find(d, "crew-need-:/runs/p1"), null);
});

// The box's recommended-option button, found among its elements by its label.
const buttonOf = (box, label) => { const hit = []; const walk = (e) => { if (!e || typeof e !== "object" || !("kids" in e)) return; if (e.click && text(e) === label) hit.push(e); e.kids.forEach(walk); }; walk(box); return hit[0] ?? null; };

test("with no captain, a decision that names a live run offers its recommended option, and a click goes to that run's inbox", () => {
  const dir = "/runs/skills/r1";
  const run = { key: `:${dir}`, dir, branch: "r1", terminal: "t99", localTerminal: "t99", phase: "running", statusLine: "running", progress: "", tasks: [], prs: [], question: null, ask: null, away: null, updated: ago(5), started: ago(60) };
  globalThis.__herdrTerminals = [{ address: "t99", state: "live", status: "idle", labels: { role: "orchestrator" } }];
  view.runs = [run];
  view.decisions = [decision("park", { run: dir, options: [{ label: "Not yet", text: "" }, { label: "Park it", text: "" }] })];
  const box = find(crew(view, t), "crew-needs-box");
  assert.equal(find(box, "crew-box-more-dec-:park-start"), null, "not Start captain");
  const yes = buttonOf(box, "★ Not yet");
  assert.ok(yes, "the recommended option is the button");
  const spawned = [];
  yes.click({}, { notify() {}, stop_propagation() {}, spawn: (f) => spawned.push(f) });
  assert.equal(spawned.length, 1, "an answer to the run's inbox was started");
  const after = text(find(crew(view, t), "crew-needs-box"));
  assert.doesNotMatch(after, /Start captain/);
});

test("with no captain, a decision about a parked run offers Start captain, with nothing greyed in the box", () => {
  const dir = "/runs/skills/p1";
  const run = { key: `:${dir}`, dir, branch: "p1", terminal: null, localTerminal: null, phase: "finished", prs: [], question: null, ask: null, away: "parked", updated: ago(5), started: ago(60) };
  view.runs = [run];
  view.decisions = [decision("resume", { run: dir })];
  const box = find(crew(view, t), "crew-needs-box");
  assert.equal(text(find(box, "crew-box-more-dec-:resume-start")), "Start captain");
  assert.equal(buttonOf(box, "★ Yes"), null, "no recommended option to grey out");
  assert.equal(find(box, "crew-box-more-dec-:resume-toggle")?.opacity, undefined);
  assert.doesNotMatch(text(box), /Reply/);
  // A parked run named with a captain running: the answer goes to the captain, as before.
  globalThis.__herdrTerminals = [captain];
  assert.ok(buttonOf(find(crew(view, t), "crew-needs-box"), "★ Yes"));
});

test("with a captain, an option is sent once: a second click sends nothing and the note says it went", () => {
  globalThis.__herdrTerminals = [captain];
  const sent = [];
  globalThis.__herdrExec = async (cmd, args) => { sent.push([cmd, ...args]); return { code: 0, stdout: "[]", stderr: "" }; };
  view.decisions = [decision("a")];
  const click = () => buttonOf(find(crew(view, t), "crew-needs-box"), "★ Yes")?.click({}, cx);
  click();
  assert.equal(sent.filter(([c]) => c === "hc").length, 1);
  const box = find(crew(view, t), "crew-needs-box");
  assert.match(text(box), /Sent to the captain/);
  click();
  assert.equal(sent.filter(([c]) => c === "hc").length, 1, "nothing sent the second time");
});

test("an answer sent to a captain is forgotten once its decision is gone, and a new captain can be answered", () => {
  globalThis.__herdrTerminals = [captain];
  globalThis.__herdrExec = async () => ({ code: 0, stdout: "[]", stderr: "" });
  view.decisions = [decision("a")];
  buttonOf(find(crew(view, t), "crew-needs-box"), "★ Yes").click({}, cx);
  assert.match(text(find(crew(view, t), "crew-needs-box")), /Sent to the captain/);
  // Another captain: the record is by address, so the buttons are live again.
  globalThis.__herdrTerminals = [{ ...captain, address: "cap2" }];
  assert.doesNotMatch(text(find(crew(view, t), "crew-needs-box")), /Sent to the captain/);
  // The decision leaves the file; the next load forgets it, so the same decision coming back is open.
  globalThis.__herdrTerminals = [captain];
  forgetSentToCaptain([]);
  assert.doesNotMatch(text(find(crew(view, t), "crew-needs-box")), /Sent to the captain/);
  // A decision still open is kept.
  buttonOf(find(crew(view, t), "crew-needs-box"), "★ Yes").click({}, cx);
  forgetSentToCaptain(view.decisions);
  assert.match(text(find(crew(view, t), "crew-needs-box")), /Sent to the captain/);
});
