// The user's own open PRs that need something from them, and "Next for you": the combined list
// the sidebar shows (review requests first, then these). One `gh api graphql` call reads every open
// PR the user authored with what decides the action; polled like reviews.js, failing quietly.
// Data only: the Crew renders the list (impl-calm-t7).

import { key, localCheckout, poller, reviewRequests } from "./reviews.js";

// viewer.pullRequests spares a `gh search` plus a call per PR; the last commit's date is when
// they last pushed, the line "new comments" counts from.
export const QUERY = `query {
  viewer { login pullRequests(states: OPEN, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes {
    number title url isDraft updatedAt reviewDecision mergeable repository { nameWithOwner }
    commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state contexts(first: 50) { nodes {
      __typename ... on CheckRun { name conclusion detailsUrl } ... on StatusContext { context state targetUrl } } } } } } }
    latestOpinionatedReviews(first: 20) { nodes { author { login __typename } state submittedAt } }
    reviews(last: 20) { nodes { author { login __typename } state submittedAt body } }
    comments(last: 20) { nodes { author { login __typename } createdAt } }
    reviewThreads(last: 30) { nodes { isResolved comments(last: 5) { nodes { author { login __typename } createdAt } } } }
  } } }
}`;

const t = (s) => Date.parse(s) || 0;
const failed = (c) => ["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ERROR"].includes(c.conclusion ?? c.state);

// What a PR needs, or null when it is quiet: {reason, since, action: {label, url}}; `since` is when
// that began (ms). First match wins: red CI, changes requested, approved and mergeable, new comments.
export function needOf(p, me) {
  const commit = p.commits?.nodes?.[0]?.commit;
  const pushed = t(commit?.committedDate);
  const rollup = commit?.statusCheckRollup;
  if (rollup?.state === "FAILURE" || rollup?.state === "ERROR") {
    const bad = (rollup.contexts?.nodes ?? []).find(failed);
    return { reason: "CI failed", since: pushed || t(p.updatedAt), action: { label: "Open check", url: bad?.detailsUrl ?? bad?.targetUrl ?? `${p.url}/checks` } };
  }
  const reviews = p.reviews?.nodes ?? [];
  const theirs = (c) => c.author?.login && c.author.login !== me && c.author.__typename !== "Bot";
  const last = (state) => Math.max(0, ...reviews.filter((r) => r.state === state).map((r) => t(r.submittedAt)));
  // reviewDecision is null on repositories that don't require reviews, so then each other reviewer's
  // latest standing review decides: any change request, else any approval.
  const standing = (p.latestOpinionatedReviews?.nodes ?? []).filter(theirs).map((r) => r.state);
  const decision = p.reviewDecision ?? (standing.includes("CHANGES_REQUESTED") ? "CHANGES_REQUESTED" : standing.includes("APPROVED") ? "APPROVED" : null);
  if (decision === "CHANGES_REQUESTED") return { reason: "changes requested", since: last("CHANGES_REQUESTED") || t(p.updatedAt), action: { label: "Open PR", url: p.url } };
  // Merge-ready: checks green or none (a pending run blocks the button), and GitHub's lazily
  // computed mergeable may still say UNKNOWN right after a push, which its own page re-checks.
  const green = !rollup || rollup.state === "SUCCESS";
  if (decision === "APPROVED" && green && p.mergeable !== "CONFLICTING" && !p.isDraft) return { reason: "approved — merge", since: last("APPROVED") || t(p.updatedAt), action: { label: "Merge on GitHub", url: p.url } };
  // Others' comments since the last push: conversation, inline replies and reviews that only comment.
  const times = [
    ...(p.comments?.nodes ?? []).filter(theirs).map((c) => t(c.createdAt)),
    ...reviews.filter((r) => r.state === "COMMENTED" && r.body?.trim() && theirs(r)).map((r) => t(r.submittedAt)),
    ...(p.reviewThreads?.nodes ?? []).filter((x) => !x.isResolved).flatMap((x) => x.comments?.nodes ?? []).filter(theirs).map((c) => t(c.createdAt)),
  ].filter((x) => x > pushed);
  if (!times.length) return null;
  return { reason: `${times.length} new comment${times.length === 1 ? "" : "s"}`, since: Math.min(...times), action: { label: "Open PR", url: p.url } };
}

// gh's graphql JSON → [{repo, number, title, url, reason, since, action}], the ones needing something.
// null when there is no PR list in it at all (so a failed poll isn't "nothing needs you").
export function parseMineOrNull(text) {
  let v;
  try { v = JSON.parse(text)?.data?.viewer; } catch { return null; }
  if (!Array.isArray(v?.pullRequests?.nodes)) return null;
  const me = v.login;
  return v.pullRequests.nodes.filter((p) => p?.url && p.number).flatMap((p) => {
    const need = needOf(p, me);
    return need ? [{ repo: p.repository?.nameWithOwner ?? "", number: p.number, title: String(p.title ?? ""), url: p.url, ...need }] : [];
  });
}
export const parseMine = (text) => parseMineOrNull(text) ?? [];

// Drops PRs a live or parked run owns (its status.json prs): the run's own row speaks for them, or
// the Bridge's Parked block does. A closed run has handed its PRs back, so its PRs stay.
export function outsideRuns(list, runs) {
  const owned = new Set(runs.filter((r) => !r.away || r.away.how === "parked").flatMap((r) => (r.prs ?? []).map((p) => key(p.url ?? p))));
  return list.filter((p) => !owned.has(key(p.url)));
}

// ---- the poll ----
// partial: one PR an organisation hides (SSO) makes gh exit 1 while the rest of the list is there.
const mine = poller(["api", "graphql", "-f", `query=${QUERY}`], parseMineOrNull, { partial: true });
export const refreshMine = mine.refresh;
export const mineError = mine.error;

// The user's PRs needing an action, outside live and parked runs: [{kind: "mine", repo, number, title, url,
// reason, age, action, local, run: null}], oldest wait first. `now` is for tests.
// `parked` are the parked runs: their PRs are left out too, but they never count for review requests.
export function minePrs({ runs = [], parked = [] } = {}, now = Date.now()) {
  const cache = mine.get();
  return outsideRuns(cache.list, [...runs, ...parked])
    .map((p) => ({ kind: "mine", repo: p.repo, number: p.number, title: p.title, url: p.url, reason: p.reason,
      age: Math.max(0, now - p.since), action: p.action, local: localCheckout(cache.repos, p.repo), run: null }))
    .sort((a, b) => b.age - a.age);
}

// Review requests as items: the button is a Review run when the repository is open here.
export function reviewItems(ctx, now = Date.now()) {
  return reviewRequests(ctx)
    .map((p) => ({ kind: "review", repo: p.repo, number: p.number, title: p.title, url: p.url, reason: p.author ? `review requested · ${p.author}` : "review requested",
      age: Math.max(0, now - p.updated), action: { label: "Review", url: p.url }, local: p.local, run: p.run }))
    .sort((a, b) => b.age - a.age);
}

// "Next for you", the combined list for the sidebar (impl-calm-t7 renders it): review requests first,
// then the user's own PRs that need something, each oldest wait first. `runs` are the live ones (the
// only ones a review request is matched against); `parked` are the parked ones, whose PRs stay out.
// A request a live run is reviewing is left out (the run shows in Crew); one only being started
// stays, as "starting…", until its run is found.
export const notReviewing = (items) => items.filter((it) => !(it.kind === "review" && it.run));
export function nextItems(ctx = {}, now = Date.now()) {
  return notReviewing([...reviewItems(ctx, now), ...minePrs(ctx, now)]);
}
