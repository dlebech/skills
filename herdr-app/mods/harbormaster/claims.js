// A run's proof as claims: what you can now do, in the spec's words, one per acceptance
// criterion. plan.md's `## Claims` names them at plan time; proof.md's `## C<n>` sections fill
// them in as tasks merge. A claim's evidence is what you look at instead of running the change:
// screenshots, tests by name, clips. A run without claims (an old run) is judged by its checks
// line alone. No herdr imports, so it can be run under plain node. The formats are in
// skills/herdr-app-orchestrator/references/run-files.md.

import { isImage, isVideo } from "./media.js";
import { gatheringStage, emptyClaim } from "./proof.js";
import { taskStage } from "./tasks.js";
import { asked } from "./inbox.js";

// ---- plan.md ----

// plan.md's `## Claims` → [{id, text, ac, tasks, bar}], [] for a plan without it (an old run).
// One claim per line, its parts apart by " — ": "C1 Drag a card to reorder — AC 3 — tasks t1, t3 — bar T3".
// AC, tasks and bar may come in any order or not at all (bar null: the run's tier); any other
// part is the claim's own words, so "Save — then reload — AC 2" keeps "Save — then reload".
export function parsePlanClaims(plan) {
  const out = [];
  let inside = false;
  for (const line of (plan ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (/^#{1,2}\s/.test(line)) { inside = /^##\s+Claims\b/i.test(line); continue; }
    if (!inside) continue;
    const m = /^\s*(?:[-*]|\d+\.)?\s*[*_`]*(C\d+)[*_`]*[.:)]?\s+(.+)$/.exec(line);
    if (!m) continue;
    const claim = { id: m[1], text: "", ac: null, tasks: [], bar: null };
    const words = [];
    for (const part of m[2].split(/\s+[—–]\s+/)) {
      const p = part.trim();
      let x;
      if ((x = /^AC\s*(\d[\w.,\s]*)$/i.exec(p))) claim.ac = x[1].trim();
      else if ((x = /^tasks?:?\s+(.+)$/i.exec(p))) claim.tasks = x[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      else if ((x = /^bar:?\s*T([0-3])$/i.exec(p))) claim.bar = Number(x[1]);
      else words.push(p);
    }
    claim.text = words.join(" — ");
    out.push(claim);
  }
  return out;
}

// ---- the claims as rows ----

// What a claim's bar asks for: T0 and T1 tests, T2 a screenshot (a clip will do), T3 a clip.
export const BAR_NEEDS = ["tests", "tests", "a screenshot", "a clip"];

// A claim's bar: the run's tier, or more when the claim asks for more; never less.
export function barOf(claimBar, runTier) {
  if (claimBar === null && (runTier === null || runTier === undefined)) return null;
  return Math.max(claimBar ?? 0, runTier ?? 0);
}

// The run's claims as rows, every view's one reading. `proof` is run.proof ({claims from
// parsePlanClaims, md, files, accepted, asks, tier}); `run` gives its tasks. `stages`: each of
// run.tasks' stage name in plan.md's order, when the caller knows better (live agents); else
// each task's own state words (tasks.js taskStage). `finished`: the run is finished or put away. A row:
//   id, name (the claim's words), ac, tasks, tier (its bar, barOf)
//   result, why, shots, tests, clips, files (shots and clips that exist, for the thumbnails)
//   missing   below its bar: a pass without the screenshot (T2) or clip (T3) it asks for
//   accepted  the user's acceptance (proof-accepted.json, by claim id) while its result line holds
//   asked     an Ask to prove waits for this result line
//   pending   still being proved: proof.md says pending, or its tasks are under way and nothing failed
//   state     stateOf()
//   claim     true, so the shared Accept / Ask code (data.js) words it for a claim
export function claimRows(proof, run = {}, stages = null, finished = false) {
  const plan = proof?.claims ?? [];
  const md = proof?.md?.claims ?? {};
  const files = proof?.files ?? null;
  const there = (f) => {
    const m = /^(?:shared\/proof\/)?([^/]+)$/.exec(f);
    return !files || files.length >= 40 || !m || files.includes(m[1]);
  };
  const tasks = run.tasks ?? [];
  const stageAt = (i) => stages?.[i] ?? taskStage(tasks[i]?.state);
  const gatheringOf = (c) => {
    if (finished) return false;
    const idx = c.tasks.map((id) => tasks.findIndex((x) => x.id === id)).filter((i) => i >= 0);
    // A claim that names no task we know waits on the run's tasks as a whole.
    const which = idx.length ? idx : tasks.map((_, i) => i);
    return which.length === 0 || which.some((i) => gatheringStage(stageAt(i)));
  };
  return plan.map((c) => {
    const e = md[c.id] ?? emptyClaim();
    const tier = barOf(c.bar, proof?.tier?.tier ?? null);
    const shots = e.shots.filter(there), clips = e.clips.filter(there);
    const media = [...shots, ...clips].filter((f) => isImage(f) || isVideo(f));
    const missing = e.result === "pass" && (tier === 3 ? !clips.some(isVideo) : tier === 2 ? media.length === 0 : false);
    const k = {
      id: c.id, name: c.text, ac: c.ac, tasks: c.tasks, tier, claim: true,
      result: e.result, why: e.why, shots, tests: e.tests, clips, files: media, missing,
    };
    const line = claimResultLine(k);
    const a = proof?.accepted?.[k.id];
    const pass = isProven(k);
    k.accepted = !pass && a && a.result === line ? a : null;
    k.asked = !pass && !k.accepted && proof?.asks?.get?.(k.id) === line;
    k.pending = !pass && !k.accepted && !finished && (k.result === "pending" || (gatheringOf(c) && k.result !== "fail"));
    k.state = stateOf(k);
    return k;
  });
}

// A row's one state: "proven" | "accepted" | "pending" | "fail" | "below" (a pass under its bar) |
// "partial" | "unproven" (nothing proves it, and nobody is proving it).
export function stateOf(k) {
  if (isProven(k)) return "proven";
  if (k.accepted) return "accepted";
  if (k.pending) return "pending";
  if (k.result === "fail") return "fail";
  if (k.missing) return "below";
  return k.result === "partial" ? "partial" : "unproven";
}

// A pass at or above its bar.
export const isProven = (k) => k.result === "pass" && !k.missing;

// The result as one line, the way an acceptance or an ask records it: "pass — 4 tests
// (needs a screenshot)", "partial — the drop is not shown", "not proven yet".
export function claimResultLine(k) {
  if (!k.result) return "not proven yet";
  return `${k.result}${k.why ? ` — ${k.why}` : ""}${k.missing ? ` (needs ${BAR_NEEDS[k.tier]})` : ""}`;
}

// A row's status word and tone, for its pill: tone "pass" | "fail" | "amber" | "muted" | "dim".
// Below its bar reads "needs a screenshot" / "needs a clip"; still under way "not proven yet".
export function claimPill(k, finished = false) {
  switch (k.state) {
    case "proven": return { text: "proven", tone: "pass" };
    case "accepted": return { text: "accepted", tone: "muted" };
    case "pending": return { text: "not proven yet", tone: "dim" };
    case "fail": return { text: "fail", tone: "fail" };
    case "below": return { text: `needs ${BAR_NEEDS[k.tier]}`, tone: "amber" };
    case "partial": return { text: "partial", tone: "amber" };
    default: return { text: finished ? "not proven" : "not proven yet", tone: "amber" };
  }
}

// Whether a claim wants a look before a merge: not proven and not being proved (failed, partial,
// below its bar, or nothing proves it once its tasks are done). An accepted one doesn't.
export const worthALook = (k) => ["fail", "partial", "below", "unproven"].includes(k.state);

// The user's say on a row: Accept or Ask to prove, unless it is proven or still being proved;
// Unaccept once accepted. "asked" while an ask waits.
export function claimActions(k) {
  if (k.state === "proven" || k.state === "pending") return [];
  if (k.state === "accepted") return ["unaccept"];
  return ["accept", k.asked ? "asked" : "ask"];
}

// The Ask to prove message lives in inbox.js; re-exported so imports keep working.
export { claimProveRequest } from "./inbox.js";

// ---- clicks the files don't show yet ----

// The user's Accept or Unaccept shows at once, before the next read of the run's files: `said`
// maps "<run key>:<claim id>" → {kind: "accept" | "unaccept", line, at}. (An Ask to prove is an
// inbox message: inbox.js keeps its asked state, and withAsked puts it on the rows.)
// Each entry goes once the files show it, once the claim's result line changed, or after
// `keepMs`. Changes `rows` in place (and drops spent entries from `said`); returns them.
export function withSaid(rows, said, runKey, proof, now = Date.now(), keepMs = 15000) {
  for (const k of rows) {
    const key = `${runKey}:${k.id}`, s = said?.get(key);
    if (!s) continue;
    const shown = s.kind === "accept" ? proof?.accepted?.[k.id]?.result === s.line : !proof?.accepted?.[k.id];
    if (shown || now - s.at > keepMs || claimResultLine(k) !== s.line) { said.delete(key); continue; }
    if (s.kind === "accept") { k.accepted = { at: new Date(s.at).toISOString(), result: s.line }; k.asked = false; }
    else k.accepted = null;
    k.state = stateOf(k);
  }
  return rows;
}

// Marks the rows whose Ask to prove reads "asked…" (inbox.js asked: unread in the run's inbox, or
// clicked under 15 s ago with the result line unchanged). Changes `rows` in place; returns them.
export function withAsked(rows, run, now = Date.now()) {
  for (const k of rows) {
    if (k.asked || k.accepted || isProven(k) || !asked(run, "proof", k.id, k, { now })) continue;
    k.asked = true;
    k.state = stateOf(k);
  }
  return rows;
}

// ---- counting ----

// {total, proven, accepted, pending, fail, look, first}: `look` the claims worth a look, `first`
// the one the verdict names: the first failed claim, else the first worth a look, else the first
// still being proved, in plan order.
export function claimCounts(rows) {
  const n = (s) => rows.filter((k) => k.state === s).length;
  return {
    total: rows.length, proven: n("proven"), accepted: n("accepted"), pending: n("pending"), fail: n("fail"),
    look: rows.filter(worthALook).length,
    first: rows.find((k) => k.state === "fail") ?? rows.find(worthALook) ?? rows.find((k) => k.state === "pending") ?? null,
  };
}

// Every claim proven or accepted, and no check red.
export const claimsClean = (c, checks = null) => c.total > 0 && c.proven + c.accepted === c.total && checks?.state !== "red";

// The whole-branch checks (suite, lint, build, CI) as one line under the claims, from proof.md's
// header `Checks: green — 1497 tests, build, lint, CI`: {text: "Checks ✓ 1497 tests, build, lint, CI",
// tone ("pass" | "fail" | "dim"), tip}; null when proof.md says nothing about them. Any other state
// than green or red (`Checks: pending — CI`) is dim: still running.
export function checksLine(md) {
  const c = md?.checks;
  if (!c) return null;
  const mark = c.state === "green" ? "✓" : c.state === "red" ? "✗" : c.state;
  return { text: `Checks ${mark}${c.text ? ` ${c.text}` : ""}`, tone: c.state === "green" ? "pass" : c.state === "red" ? "fail" : "dim",
    tip: `Whole-branch checks: ${c.state}${c.text ? ` — ${c.text}` : ""}` };
}

// Only whole-branch reviews measure the gap: a task review's sha sits on the task branch, which a squash never makes an ancestor.
export const finalReviews = (md) => (md?.reviewed ?? []).filter((x) => /final/i.test(x.what));

// Which final review is "the" review, for a proof.md whose lines may be in any order. data.js
// refreshReviewed measures every final sha in one git call and picks with pickFinal; the gap it
// stores names the pick, so this finds the line by that sha. Without a gap (not read yet, or
// git could not tell) the last in file order, as before.
export function finalReview(md, gap = null) {
  const finals = finalReviews(md);
  const sha = gap?.sha;
  return (sha && finals.find((x) => x.sha.startsWith(sha) || sha.startsWith(x.sha))) || finals[finals.length - 1];
}

// The newest final review on the branch, from `measured` ({sha → {count, anc, same} | null}, what git
// said about each): the ancestor of the branch with the fewest commits since. A sha that is no
// ancestor (a task or squashed commit) or unknown to git measures only when nothing else does, then
// by fewest commits; a tie goes to the later line, and nothing measured gives the last line.
export function pickFinal(finals, measured) {
  const rank = (x) => { const m = measured[x.sha]; return m ? [m.anc ? 0 : 1, m.count] : [2, 0]; };
  let best = null, bestRank = null;
  for (const x of finals) {
    const r = rank(x);
    if (!best || r[0] < bestRank[0] || (r[0] === bestRank[0] && r[1] <= bestRank[1])) { best = x; bestRank = r; }
  }
  return best;
}

// The branch's last review as one quiet line under the checks line, from proof.md's `Reviewed:`
// lines (the latest final, whole-branch review, else the latest one) and `gap`, how far the
// branch has moved since ({sha, count, same}, from data.js refreshReviewed; null when not read yet):
//   {text, tone ("dim" | "amber"), tip, since}
// "Reviewed · final review at 4ad8528" while the branch is still that commit (or its tree), amber
// "Reviewed at 4ad8528 · 5 commits since, not reviewed" after. A gap read for another sha is no gap.
// No Reviewed line: null, except for a finished run with claims, whose dim "not reviewed" says so;
// an old run shows nothing.
export function reviewedLine(md, gap = null, { finished = false, claims = false } = {}) {
  const all = md?.reviewed ?? [];
  const last = finalReview(md, gap);
  const tasks = all.length;
  if (!last && tasks) return { text: "not reviewed (branch)", tone: "dim", tip: `No final review recorded; ${tasks} task ${tasks === 1 ? "review" : "reviews"}`, since: 0 };
  if (!last) return finished && claims ? { text: "not reviewed", tone: "dim", tip: "proof.md has no Reviewed line", since: 0 } : null;
  const g = gap && last.sha.startsWith(gap.sha) || gap && gap.sha?.startsWith(last.sha) ? gap : null;
  const at = last.sha.slice(0, 7), tip = `Reviewed: ${at} ${last.what}${last.result ? ` — ${last.result}` : ""}`;
  if (g && g.same === null) return { text: `Reviewed at ${at}`, tone: "dim", tip: `${tip}\nCould not compare with the branch`, since: 0 };
  if (!g || g.same || !(g.count > 0)) return { text: `Reviewed · ${last.what || "review"} at ${at}`, tone: "dim", tip, since: 0 };
  return { text: `Reviewed at ${at} · ${g.count} ${g.count === 1 ? "commit" : "commits"} since, not reviewed`, tone: "amber", tip, since: g.count };
}

// The same Reviewed data as reviewedLine, as plain facts for the path-to-merge strip (mergepath.js):
// {kind: "none" | "task-only" | "current" | "behind", behind (commits since, when kind is behind), sha,
// compared (false when the branch was not compared yet or could not be)}. Behind only when the gap
// is read for that sha, says not the same and counts commits, as reviewedLine's amber.
export function reviewedState(md, gap = null) {
  const all = md?.reviewed ?? [];
  const last = finalReview(md, gap);
  if (!all.length) return { kind: "none", behind: null, sha: null, compared: false };
  if (!last) return { kind: "task-only", behind: null, sha: null, compared: false };
  const g = gap && (last.sha.startsWith(gap.sha) || gap.sha?.startsWith(last.sha)) ? gap : null;
  const compared = Boolean(g) && g.same !== null;
  if (g && g.same === false && g.count > 0) return { kind: "behind", behind: g.count, sha: last.sha, compared: true };
  return { kind: "current", behind: null, sha: last.sha, compared };
}

// The verdict on top of the Claims section, and on a run's card: "3 of 4 proven · not yet: Drag to
// reorder". {parts: [{text, tone, bold?}], text, tone ("done" | "blocked" | "dim"), tip (the tier,
// the checks, how many are still being proved)}; null without claims. A part's tone is a status
// tone ("pass" | "fail" | "amber" | "muted" | "dim", or null for plain): the count green once every
// claim is proven, the named claim red when it failed, amber when it wants a look, dim while it
// is still being proved; red checks are added, green ones live in the hover and the checks line.
export function claimsVerdict(rows, { tier = null, md = null, reviewed = null } = {}) {
  if (!rows.length) return null;
  const c = claimCounts(rows);
  const rest = c.total - c.proven - c.accepted;
  const checks = checksLine(md);
  const parts = [
    { text: `${c.proven} of ${c.total} proven`, tone: rest === 0 ? "pass" : null, bold: true },
    c.accepted > 0 && { text: `${c.accepted} accepted`, tone: "muted" },
    c.first && { text: `not yet: ${c.first.name}${rest > 1 ? ` +${rest - 1}` : ""}`, tone: c.first.state === "fail" ? "fail" : worthALook(c.first) ? "amber" : "dim" },
    checks?.tone === "fail" && { text: checks.text, tone: "fail" },
    reviewed?.tone === "amber" && { text: `${reviewed.since} ${reviewed.since === 1 ? "commit" : "commits"} not reviewed`, tone: "amber" },
  ].filter(Boolean);
  const red = c.fail > 0 || md?.checks?.state === "red";
  const tip = [tier !== null && tier !== undefined ? `Proof tier T${tier}: each claim's bar unless it asks for more` : null,
    checks?.tip, reviewed?.tip, c.pending ? `${c.pending} still being proved` : null].filter(Boolean).join("\n");
  return { parts, text: parts.map((p) => p.text).join(" · "), tone: red ? "blocked" : claimsClean(c, md?.checks) ? "done" : "dim", tip };
}

// What stands between the claims and a merge, in words, or null when they are clean:
// "3 of 4 proven, not yet: Drag to reorder", "checks red".
export function claimsGaps(rows, md = null) {
  const c = claimCounts(rows);
  if (claimsClean(c, md?.checks)) return null;
  return [c.total && c.proven + c.accepted < c.total ? `${c.proven} of ${c.total} proven${c.first ? `, not yet: ${c.first.name}` : ""}` : null,
    md?.checks?.state === "red" ? "checks red" : null].filter(Boolean).join(", ") || null;
}

// The read signature (proofseen.js): any change to a claim's result or evidence reads as unread again.
export function claimsSig(rows) {
  return rows.map((k) => `${k.id}|${claimResultLine(k)}|${k.files.join(",")}|${k.tests.map((x) => x.name).join(",")}`).join("\n");
}

// Whether the run's proof is claims (plan.md has `## Claims`): an old run has none.
export const hasClaims = (run) => (run?.proof?.claims?.length ?? 0) > 0;

// A run's proof as the ready check and the Needs-you box judge it: {failed, clean, sig}. A run
// with claims by its claims (failed: a claim failed; clean: claimsClean; sig: claimsSig). An old
// run by its checks line alone, as its pane shows nothing else: failed when red, clean when
// green, its signature the line itself; a run with neither has nothing to read ({sig: ""}).
// `stages` and `finished` as claimRows()'s.
export function proofState(run, stages = null, finished = Boolean(run?.phase === "finished" || run?.away)) {
  if (hasClaims(run)) {
    const rows = claimRows(run.proof, run, stages, finished);
    const c = claimCounts(rows);
    return { failed: c.fail > 0, clean: claimsClean(c, run.proof.md?.checks), sig: claimsSig(rows) };
  }
  const checks = run?.proof?.md?.checks ?? null;
  return { failed: checks?.state === "red", clean: checks?.state === "green", sig: checks ? `checks|${checks.state}|${checks.text}` : "" };
}

// ---- the merge ask ----

// What the Needs-you box's merge item ("review proof → merge") shows of a run's claims (crew.js
// boxClaims keeps the worth-a-look rows of it):
//   { worthALook: [≤ 3 rows], more: n, checks: "Checks ✓ …" | null, reviewed: reviewedLine() | null, verdict: claimsVerdict() }
// (an amber `reviewed` is listed first among the worth-a-look items, by the box)
// The rows are the claims worth a look first (failed, partial, below their bar, unproven), then
// proven ones that have a thumbnail to show, in plan order within each; `more` is how many claims
// the ≤ 3 leave out ("+n more" → the run pane). Each row is claimRows()'s, with `look` true for a
// worth-a-look one. A run without claims (an old run) gets {worthALook: [], more: 0, checks, verdict: null}.
// `stages` (optional: each task's own state words otherwise) and `finished` are claimRows()'s.
export function claimsAsk(run, stages = null, finished = Boolean(run?.phase === "finished" || run?.away)) {
  const rows = claimRows(run?.proof, run, stages, finished);
  const look = rows.filter(worthALook).map((k) => ({ ...k, look: true }));
  const shown = rows.filter((k) => k.state === "proven" && k.files.some(isImage)).map((k) => ({ ...k, look: false }));
  const top = [...look, ...shown].slice(0, 3);
  const reviewed = reviewedLine(run?.proof?.md, run?.reviewedGap, { finished, claims: rows.length > 0 });
  return { worthALook: top, more: rows.length - top.length, checks: checksLine(run?.proof?.md)?.text ?? null, reviewed,
    verdict: claimsVerdict(rows, { tier: run?.proof?.tier?.tier, md: run?.proof?.md, reviewed }) };
}
