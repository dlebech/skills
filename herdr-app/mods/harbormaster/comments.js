// Review comments on an approved (or changes-requested) pull request, and "Address comments":
// what Harbormaster reads of them, how it says so, and the inbox message that asks the run's
// orchestrator to deal with them. No herdr imports, so the tests drive it under plain node.
//
// A reviewer often approves with comments, to spare a review round. Those comments still want
// an answer: a fix, a reply or a reason to leave them. The orchestrator does that on an
// "address comments on <PR url>: ask|handle" message (skills/herdr-app-orchestrator/SKILL.md),
// which, like an ask what is blocking, answers no question (data.js NOT_ANSWERS).

// One gh call per PR (data.js refreshPrs): its unresolved review threads with their first and
// last comment, its reviews with their bodies, and its last conversation comments (to see
// which review bodies were already answered).
export const COMMENTS_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){
author{login}
reviewThreads(first:100){nodes{id isResolved path line originalLine first:comments(first:1){nodes{author{login} body url}} last:comments(last:1){nodes{author{login} body}}}}
reviews(last:50){nodes{state body url submittedAt author{login}}}
comments(last:50){nodes{body createdAt author{login}}}}}}`;

// The gh arguments for a PR's comments, or null for a URL that is not a GitHub PR.
export function commentsArgs(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url ?? "");
  if (!m) return null;
  return ["api", "graphql", "-f", `query=${COMMENTS_QUERY}`, "-F", `owner=${m[1]}`, "-F", `name=${m[2]}`, "-F", `number=${m[3]}`];
}

// Whose review bodies are not feedback: bots (CodeRabbit's summaries) and the PR's author.
// Their review threads still count: an unresolved thread is unresolved, whoever opened it.
const isBot = (login) => !login || login.endsWith("[bot]") || login === "coderabbitai";

// A reply from an agent starts with this, so the reviewer can tell it from the user's own.
export const AI_PREFIX = "🤖 AI:";
const fromAi = (body) => (body ?? "").trimStart().startsWith(AI_PREFIX);

// A comment's first line worth reading: HTML comments and tags, Markdown emphasis, headings and
// list markers dropped, capped. A wholly bold line among the first three is the comment's title
// and wins: CodeRabbit opens with a severity badge ("Minor · Functional Correctness"), then it.
export function commentText(body, max = 120) {
  const text = (body ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/<details>[\s\S]*?<\/details>/g, "").replace(/<[^>]+>/g, "");
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*(#+|[-*>]|\d+\.)\s+/, "").trim()).filter(Boolean);
  const title = lines.slice(0, 3).find((l) => /^\*\*[^*]+\*\*$/.test(l));
  const line = (title ?? lines[0] ?? "").replace(/\*\*|__|`/g, "").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// The most comments kept per PR (shared state stays small; the orchestrator reads them all).
export const COMMENTS_KEEP = 40;

// What a PR's comments read gives: {count, answered, items: [{kind, who, text, where, thread, url}]}.
// Counted: unresolved review threads whose last comment is not an agent's "🤖 AI:" reply (those
// are `answered`, waiting on the reviewer), and the text of reviews by people (not the author,
// not a bot) that approved, asked for changes or commented, unless an "🤖 AI:" comment came
// after it. Threads the PR's author opened are notes, not feedback.
export function commentSummary(data) {
  const pr = data?.data?.repository?.pullRequest;
  if (!pr) return null;
  const author = pr.author?.login ?? null;
  const items = [];
  let answered = 0;
  for (const t of pr.reviewThreads?.nodes ?? []) {
    if (t.isResolved) continue;
    const first = t.first?.nodes?.[0];
    const who = first?.author?.login ?? null;
    if (!first || who === author) continue;
    if (fromAi(t.last?.nodes?.[0]?.body)) { answered++; continue; }
    const line = t.line ?? t.originalLine;
    items.push({ kind: "thread", who: who ?? "someone", text: commentText(first.body), where: t.path ? `${t.path}${line ? `:${line}` : ""}` : null, thread: t.id ?? null, url: first.url ?? null });
  }
  const aiTimes = [...(pr.comments?.nodes ?? []), ...(pr.reviews?.nodes ?? []).map((r) => ({ ...r, createdAt: r.submittedAt }))]
    .filter((c) => fromAi(c.body)).map((c) => Date.parse(c.createdAt ?? "")).filter(Boolean);
  const lastAi = aiTimes.length ? Math.max(...aiTimes) : 0;
  for (const r of pr.reviews?.nodes ?? []) {
    const who = r.author?.login;
    if (!["APPROVED", "CHANGES_REQUESTED", "COMMENTED"].includes(r.state) || who === author || isBot(who) || fromAi(r.body)) continue;
    const text = commentText(r.body);
    if (!text) continue;
    if (Date.parse(r.submittedAt ?? "") < lastAi) { answered++; continue; }
    items.push({ kind: "review", who, text, where: null, thread: null, url: r.url ?? null });
  }
  return { count: items.length, answered, items: items.slice(0, COMMENTS_KEEP) };
}

// The PR's comments as data.js stores them: the summary, or {error} when they could not be
// read (then they are unknown, never zero).
export const commentsUnknown = (c) => Boolean(c?.error);

// The comments of a next step's PRs (attention.js nextStep's `prs`), summed:
// {count, unknown, prs: [{pr, comments}]}. Unknown when any PR's could not be read.
export function stepComments(prs) {
  const list = (prs ?? []).filter((p) => p.comments);
  return {
    count: list.reduce((n, p) => n + (p.comments.count ?? 0), 0),
    unknown: list.some((p) => commentsUnknown(p.comments)),
    prs: list,
  };
}

// "3 comments", "1 comment", "comments ?" (unknown), or null for none.
export function commentsText(c) {
  if (!c) return null;
  if (c.unknown) return "comments ?";
  return c.count > 0 ? `${c.count} comment${c.count === 1 ? "" : "s"}` : null;
}

// One line per comment, for a hover: "mfalkenbrink on src/x.ts:42: Routes API errors never
// reach Sentry", "#1799 " before it with several PRs, at most `max` lines, then "+N more".
export function commentLines(prs, max = 12) {
  const many = (prs ?? []).length > 1;
  const lines = [];
  let total = 0, shown = 0;
  for (const p of prs ?? []) {
    const tag = many && p.number ? `#${p.number} ` : "";
    if (commentsUnknown(p.comments)) { lines.push(`${tag}comments could not be read: ${p.comments.error}`); continue; }
    total += p.comments?.count ?? 0;
    for (const c of p.comments?.items ?? []) {
      if (shown >= max) break;
      lines.push(`${tag}${c.who}${c.where ? ` on ${c.where}` : " in a review"}: ${c.text}`);
      shown++;
    }
  }
  if (total > shown) lines.push(`+${total - shown} more`);
  return lines;
}

// ---- Address comments ----

export const COMMENTS = /^address comments on (\S+): (ask|handle)\b/;

// The mode a run's Address comments offers first: its autonomy decides. At L2 the orchestrator
// runs to a merge-ready PR on its own, so it handles them; below, it asks first.
export const defaultMode = (autonomy) => (autonomy === "L2" ? "handle" : "ask");

const MODE_TEXT = {
  ask: "read the threads, then write one question.md listing each comment with your proposal (fix, reply or leave, and why), "
    + "options \"Do as proposed\", \"Let me pick\" (free text) and \"Leave them\"; act on the answer as for handle.",
  handle: `read the threads, fix what you agree with (as tasks, reviewed as usual), push, reply on every thread you acted on starting "${AI_PREFIX}" `
    + "(what you did, or why not), resolve the threads you addressed and report in your progress line. Never merge, never dismiss a review.",
};

// The message, in the user's voice: the PR and mode on the first line, then what Harbormaster
// sees (each comment with its thread id), then what to do.
export function commentsRequest(pr, mode) {
  const c = pr.comments ?? { count: 0, items: [] };
  const state = pr.review === "CHANGES_REQUESTED" ? "changes requested" : "approved";
  const lines = (c.items ?? []).map((x) => `- ${x.who}${x.where ? ` on ${x.where}` : " in a review"}: ${x.text}${x.thread ? ` (thread ${x.thread})` : x.url ? ` (${x.url})` : ""}`);
  const more = c.count > (c.items ?? []).length ? [`- … and ${c.count - c.items.length} more`] : [];
  return [`address comments on ${pr.url}: ${mode}`,
    `Harbormaster sees ${c.count} open review comment${c.count === 1 ? "" : "s"} on PR #${pr.number} (${state}):`,
    ...lines, ...more,
    `Asked from Harbormaster: ${MODE_TEXT[mode]}`].join("\n");
}

// The PR URLs an "address comments" message is still unread for, from the first lines of the
// run's unhandled inbox messages (data.js reads them with the level requests).
export const pendingComments = (lines) => (lines ?? "").split("\n").map((l) => COMMENTS.exec(l.trim())?.[1]).filter(Boolean);

// What the PR's comments and the run looked like when it was asked: which comments are open
// and the run's status. The ask reads "asked…" until this changes (or while its message is unread).
export const commentsSig = (run, pr) => `${(pr?.comments?.items ?? []).map((x) => x.thread ?? x.url ?? x.text).join("\n")}\n${pr?.comments?.count ?? ""}\n${run?.statusLine ?? ""}`;

// Whether a PR's Address comments shows "asked…": its message is unread (run.commentsAsked has
// its URL), or it was asked from here (`asked`: {sig} at the click) and nothing has moved since.
export const commentsAsked = (run, pr, asked = null) => (run?.commentsAsked ?? []).includes(pr?.url) || (asked != null && asked.sig === commentsSig(run, pr));
