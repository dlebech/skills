// What a Needs-you box asks the user to do: one short line per reason a run needs them, saying
// what to do and why (with names and ages where known), and the buttons that do it. Pure, so
// the tests drive every reason; overview.js draws the lines on the card, in the pane and in the
// Crew row's hover, and wires each action kind to its click.
//
// "Open the orchestrator" is never the headline: the box offers it as a small link of its own,
// since most reasons are done elsewhere (on GitHub, in the proof, with Close).

import { ageText, ciState } from "./attention.js";
import { andList, plural } from "./words.js";
import { taskCounts } from "./tasks.js";
import { hasComments, commentsText, defaultMode, askAllLabel, offersAll } from "./comments.js";

const numOf = (p) => (p?.number ? `#${p.number}` : null);
// "#1799 and #1372", or "the PR" / "its 2 PRs" when GitHub gave no numbers.
function prsText(prs) {
  const nums = prs.map(numOf).filter(Boolean);
  if (nums.length === prs.length && nums.length) return andList(nums);
  return prs.length > 1 ? `its ${prs.length} PRs` : "the PR";
}
const ago = (at, now) => (at ? ` ${ageText(now - at)} ago` : "");

// The most PRs a reason offers an Open button for; past it, the PR list in the pane has them.
export const MAX_OPEN = 3;

// An Open button per PR with a URL: "Open #1799", "Open the PR" without a number.
const openPrs = (prs) => prs.filter((p) => p?.url).slice(0, MAX_OPEN)
  .map((p) => ({ kind: "open", label: `Open ${numOf(p) ?? "the PR"}`, url: p.url }));

// A Merge button per PR with a URL, the main button of a proof that was read: it opens the PR on
// GitHub, where the user merges (Harbormaster never merges). `primary` stands it out.
const mergePrs = (prs) => prs.filter((p) => p?.url).slice(0, MAX_OPEN)
  .map((p) => ({ kind: "open", label: `Merge ${numOf(p) ?? "the PR"} on GitHub`, url: p.url, primary: true }));

// The first failing check of a PR's statusCheckRollup as data.js keeps it ({name, url}), and
// where its Open button goes: the check's own page, else the PR's checks tab.
const checksUrl = (pr) => pr?.failed?.url || (pr?.url ? `${pr.url.replace(/\/+$/, "")}/checks` : null);

// The order the lines come in: what blocks a run outright first (a question or dialog, a gone
// orchestrator), then a broken build, then the PR steps, most urgent first, then a stall, then
// the cleanup of a finished run.
const ORDER = ["question", "gone", "red-ci", "changes requested", "approved — merge", "review proof → merge", "request review", "stalled", "finished"];

// "T2 · 5/10 pass · 1 fail" from {tier, pass, total, fail}, or null with no proof to read.
export function proofText(proof) {
  if (!proof) return null;
  const parts = [proof.tier != null ? `T${proof.tier}` : null, proof.total ? `${proof.pass ?? 0}/${proof.total} pass` : null,
    proof.fail ? `${proof.fail} fail` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// Address comments in the box (comments.js): for each of `prs` with open review comments, Ask me
// and Handle them, the run's autonomy's default first-class (`primary`), then its Open; the
// other PRs' Open after. With several PRs each action carries `row`, the PR it is about
// ("#1799 · 15 comments"), so the box draws a row per PR. `asked`: PRs whose comments are being
// handled (attention.js nextStepAsking): each keeps its row, "asked…" in place of the buttons.
// With two or more PRs still to ask, a last row asks about all of them (Ask me about all /
// Handle all). Only for a run whose orchestrator is here to ask, not put away, with no open
// question (an Ask me's question would queue behind it): as the card's own Address row was.
function addressPrs(prs, run, asked = []) {
  const can = Boolean(run?.dir && run.localTerminal && !run.away && !run.question);
  const first = defaultMode(run?.autonomy);
  const asks = can ? prs.filter((p) => p?.url && hasComments(p.comments)) : [];
  // An asked PR: "#1799 · asked…" with its Open. Built first: it shows even when nothing else can be asked.
  const done = asked.filter((p) => p?.url).flatMap((p) => [{ kind: "asked", label: "asked…", pr: p, row: numOf(p) ?? "the PR" }, ...openPrs([p]).map((x) => ({ ...x, row: numOf(p) ?? "the PR" }))]);
  if (!asks.length) return [...done, ...openPrs(prs)];
  const several = prs.length + asked.length > 1;
  const row = (p) => (several ? { row: [numOf(p) ?? "the PR", commentsText(p.comments)].filter(Boolean).join(" · ") } : {});
  const open = (p) => openPrs([p]).map((x) => ({ ...x, ...row(p) }));
  const rest = prs.filter((p) => p?.url && !asks.includes(p)).slice(0, Math.max(0, MAX_OPEN - asks.length));
  const all = offersAll(asks) ? ["ask", "handle"].map((mode) => ({ kind: "address-all", label: askAllLabel(mode), mode, prs: asks, primary: mode === first, row: `All ${asks.length}` })) : [];
  return [
    ...done,
    ...asks.flatMap((p) => [
      ...["ask", "handle"].map((mode) => ({ kind: "address", label: mode === "ask" ? "Ask me" : "Handle them", mode, pr: p, primary: mode === first && !all.length, ...row(p) })),
      ...open(p),
    ]),
    ...rest.flatMap(open),
    ...all,
  ];
}

// The reports about a whole run among shared/'s file names (or paths), the final one first:
// report.md, final-report.md, review*.md (a review run's) and the like. A task's own report
// (t3-report.md, t11-review-1.md) is never one: a run leaves one per task, and the orchestrator
// gives its final report in its terminal.
const TASK_FILE = /^t\d+[-_.]/i;
export function runReports(paths) {
  const base = (p) => p.split("/").pop();
  return (paths ?? []).filter((p) => { const b = base(p); return /\.md$/i.test(b) && !TASK_FILE.test(b) && (/report/i.test(b) || /^review/i.test(b)); })
    .sort((x, y) => Number(/final/i.test(base(y))) - Number(/final/i.test(base(x))));
}

// The box of a run that is ready to merge: {key, ready, headline, detail, line, actions}. The
// headline and detail read as done and good ("Ready to merge" / "All 6 tasks done · proof 6/6
// pass · checks green"); `line` is the same in one line, for the Crew hover. Then one Merge
// button per PR (primary), Proof (plain) and Ask for changes (plain).
function readyItem(a, ctx, prs) {
  const { run, proof } = ctx;
  const tasks = taskCounts(run ?? {});
  const checks = ciState(ctx.prs ?? []).state === "green" ? "checks green" : "no checks";
  const detail = [tasks.planned > 0 ? `All ${plural(tasks.done, "task")} done` : null,
    proof ? `proof ${(proof.pass ?? 0) + (proof.accepted ?? 0)}/${proof.total} pass` : null, checks].filter(Boolean).join(" · ");
  return { key: "review proof → merge", ready: true, headline: "Ready to merge", detail,
    line: `Ready to merge ${prsText(prs)}: ${detail}`,
    actions: [...mergePrs(prs), { kind: "proof", label: "Proof", primary: false }, { kind: "changes", label: "Ask for changes", primary: false }] };
}

// One reason's {key, line, tip, actions}. Action kinds (overview.js clicks them):
//   open {url}          opens a PR or check on GitHub
//   address {pr, mode}  Address comments on a PR: Ask me ("ask") or Handle them ("handle")
//   address-all {prs, mode}  the same for every PR in `prs` at once (Ask me about all, Handle all)
//   asked {pr}          a PR whose comments were asked about: "asked…", no buttons
//   proof               unfolds the run's proof (and marks it read, proofseen.js)
//   changes             Ask for changes on a ready run: opens a field, its text goes to the inbox (changes.js)
//   ask-ci {pr, check}  asks the orchestrator to see to the red CI (an inbox message)
//   ask-blocking        a stalled run's Ask what's blocking
//   report {path}       opens the run's report
//   close               the run's Close, with its confirm
//   resume              the run's Resume, with its confirm
//   focus {address}     shows an agent's terminal (a dialog waits in it)
// An action may carry `primary` (it stands out, else only the box's first does) and `row` (the
// PR it is about, when the box draws a row of buttons per PR).
function reasonItem(r, a, ctx) {
  const { run, now, proof, reports = [], blocked = null } = ctx;
  const next = a.next;
  const same = next?.prs ?? [];
  switch (r.key) {
    case "question": {
      // A question.md has its own box (overview.js needBox); this is a dialog or a plan that waits.
      if (r.text === "blocked on a dialog") {
        const who = blocked?.name ?? "The orchestrator";
        return { line: `${who} is waiting on a prompt`, tip: "A dialog or permission prompt waits in its terminal; answer it there",
          actions: blocked?.address || run?.terminal ? [{ kind: "focus", label: `Open ${blocked?.name ?? "the orchestrator"}`, address: blocked?.address ?? run.terminal }] : [] };
      }
      return { line: `Waiting for you: ${r.text}`, tip: "Its plan's status waits on you without a question.md; its orchestrator says what it needs",
        actions: run?.terminal ? [{ kind: "focus", label: "Open the orchestrator", address: run.terminal }] : [] };
    }
    case "gone":
      return { line: "Its orchestrator is gone: resume it to carry on, or park or close the run", actions: [{ kind: "resume", label: "Resume" }] };
    case "red-ci": {
      const red = ciState(ctx.prs ?? []);
      const pr = red.state === "red" ? red.pr : null;
      const check = pr?.failed?.name ?? null;
      const n = pr?.checks?.fail ?? 0;
      const on = numOf(pr) ? ` on ${numOf(pr)}` : "";
      const line = `CI failed${on}${check ? `: ${check}` : ""}${n > 1 ? ` (+${n - 1} more)` : ""}`;
      const url = checksUrl(pr);
      return { line, actions: [
        ...(url ? [{ kind: "open", label: "Open the failing check", url }] : []),
        { kind: "ask-ci", label: "Ask the orchestrator", pr, check },
      ] };
    }
    case "changes requested": {
      const who = [...new Set(same.flatMap((p) => p.changesBy ?? []))];
      const said = commentsText(next?.comments);
      const at = Math.max(0, ...same.map((p) => p.reviewedAt ?? 0)) || null;
      return { line: `${andList(who) || "A reviewer"} asked for changes on ${prsText(same)}${said ? ` · ${said}` : ""}${at ? ` ·${ago(at, now)}` : ""}`, actions: addressPrs(same, run, next?.asked) };
    }
    case "approved — merge": {
      const who = [...new Set(same.flatMap((p) => p.approvedBy ?? []))];
      const at = Math.max(0, ...same.map((p) => p.reviewedAt ?? 0)) || null;
      const by = who.length ? ` by ${andList(who)}` : "";
      // The comments come before the merge: address them, then merge. While the run's own plan is
      // open (a.planOpen) the reviewer's approval stands but there is nothing to merge yet.
      const plan = a.planOpen;
      const tasks = plan ? taskCounts(run ?? {}) : null;
      const line = hasComments(next?.comments)
        ? `Approved${by}${ago(at, now)} with ${commentsText(next.comments)} on ${prsText(same)}: address them${plan ? "" : ", then merge"}`
        : plan ? `${prsText(same)} approved${by}${ago(at, now)} · merge once the plan is done (${tasks.done}/${tasks.planned} tasks)`
        : `Merge ${prsText(same)} · approved${by}${ago(at, now)}`;
      return { line, actions: addressPrs(same, run, next?.asked) };
    }
    case "review proof → merge": {
      const p = proofText(proof);
      // No "then merge" while CI is red (its own line above says so), and a draft is marked ready first.
      const red = a.reasons.some((x) => x.key === "red-ci");
      const draft = same.some((x) => x.state === "DRAFT");
      const it = same.length > 1 ? "them" : "it";
      const merge = (what) => (red ? "" : draft ? `, then mark ${what} ready and merge` : `, then merge ${what}`);
      // A failed proof task is never merged past: name it and say to read it first.
      if (proof?.fail > 0) {
        const name = proof.failed ? `${proof.failed}${proof.fail > 1 ? ` and ${proof.fail - 1} more` : ""}` : `${proof.fail} ${proof.fail === 1 ? "task" : "tasks"}`;
        return { line: `Proof: ${name} failed — read it${red ? "" : ` before ${draft ? "marking" : "merging"} ${prsText(same)}${draft ? " ready" : ""}`}`,
          actions: [{ kind: "proof", label: "Proof" }, ...openPrs(same)] };
      }
      // Ready to merge: the proof was read and passes, the checks are green, nothing else waits on
      // you. A headline in the pass colour, the merge link as the main button (see readyItem).
      if (a.ready) return readyItem(a, ctx, same);
      // The proof was read but is not clean: say what stands in the way; the merge link stays the
      // main button, Proof a plain one, the user decides (accept the row, ask to prove it, or merge).
      if (a.proofRead && proof?.gaps && !red && !draft) {
        return { line: `Proof read · ${proof.gaps} — accept it or ask to prove it before merging ${prsText(same)}`,
          actions: [...mergePrs(same), { kind: "proof", label: "Proof", primary: false }] };
      }
      return { line: p ? `Read the proof (${p})${merge(prsText(same))}` : `Review ${prsText(same)}${merge(it)}`,
        actions: [...(p ? [{ kind: "proof", label: "Proof" }] : []), ...openPrs(same)] };
    }
    case "request review": {
      const drafts = same.filter((p) => p.state === "DRAFT").length;
      const why = drafts === same.length ? (same.length > 1 ? "drafts" : "a draft") : drafts ? "drafts, or nobody requested" : "nobody requested";
      return { line: `Ask for a review on ${prsText(same)} (${why})`, actions: openPrs(same) };
    }
    case "stalled":
      return { line: `${r.text[0].toUpperCase()}${r.text.slice(1)}${a.step?.text ? ` at ${a.step.text}` : ""}: ask what's blocking it`, actions: [{ kind: "ask-blocking", label: "Ask what's blocking" }] };
    case "finished": {
      // Only a report about the whole run; without one the orchestrator gave its final report
      // in its terminal.
      const path = runReports(reports)[0] ?? null;
      if (path) return { line: "Finished: read its report, then close the run", actions: [{ kind: "report", label: "Report", path }, { kind: "close", label: "Close" }] };
      return { line: "Finished: read its final report in the orchestrator, then close the run",
        actions: [...(run?.terminal ? [{ kind: "focus", label: "Open the orchestrator", address: run.terminal }] : []), { kind: "close", label: "Close" }] };
    }
    default:
      return { line: r.text, actions: [] };
  }
}

// What a Needs-you run asks of the user: [{key, line, tip?, actions}], most urgent first, one per
// reason (attention.js assess's `reasons`); [] for a run not in Needs you. `a` is its assess
// result. `ctx`:
//   run      the run (data.js), for its orchestrator's terminal
//   prs      its PR summaries as read (data.js prSummary), for which PR's CI is red
//   now
//   proof    {tier, pass, total, fail, failed} of its proof, or null; `failed` names its first
//            failing task ("t2 polish"); `accepted` (rows the user accepted) and `gaps` (what stands
//            between a clean proof and a merge, proof.js proofGaps) for a proof that was read
//   reports  its report files in shared/, paths to open (runReports picks the run's own)
//   blocked  {name, address} of the agent a dialog waits in, when known
export function needActions(a, ctx = {}) {
  if (a?.group !== "needs") return [];
  const now = ctx.now ?? Date.now();
  const rank = (k) => { const i = ORDER.indexOf(k); return i < 0 ? ORDER.length : i; };
  return [...a.reasons].sort((x, y) => rank(x.key) - rank(y.key))
    .map((r) => ({ key: r.key, tip: null, ...reasonItem(r, a, { ...ctx, now }) }));
}

// Whether a run's card and pane draw their own Address comments rows (overview.js
// commentsAction): only while the run is in Needs you (`need`) and its box's items do not carry
// them. Outside Needs you its orchestrator is working, often on the comments it was just asked
// about, and Ask me / Handle them again would invite a second, duplicate ask.
export const ownAddressRows = (need, items) => !!need && !(items ?? []).some((it) => it.actions.some((x) => x.kind === "address"));

// The line a Crew row's hover ends with: "Do: Merge #42 · approved by anna 1h ago", or null.
export const doLine = (items) => (items?.length ? `Do: ${items[0].line}` : null);

// Whether a need item's button stands out. Without a question the first item's first button does,
// unless the action says which (`primary`). While a question is open its options are the primary
// action and every other reason's buttons are plain, so none reads as an answer to it.
export const isPrimary = (x, i, j, underQuestion = false) => !underQuestion && (x.primary ?? (i === 0 && j === 0));

// What the Details fold holds, as the words it is labelled with, or [] when nothing is behind it:
// each section the question has ("question" for the untitled text and the Question section) and,
// when an option says more than its button's label, "what each option does". `options`: the
// question's options ({label, text}).
export function detailsParts(sections, options = []) {
  const named = (sections ?? []).map((x) => (x.label || "question").toLowerCase());
  const more = (options ?? []).some((o) => o.text && o.text !== o.label);
  return [...new Set([...named, ...(more ? ["what each option does"] : [])])];
}

// The fold's label, "Details: question, evidence, risk", or null when there is nothing to fold.
export function detailsLabel(sections, options = []) {
  const parts = detailsParts(sections, options);
  return parts.length ? `Details: ${parts.join(", ")}` : null;
}
