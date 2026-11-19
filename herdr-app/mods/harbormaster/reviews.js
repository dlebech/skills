// Review requests: the open PRs where the user's review is asked, from
// `gh search prs --review-requested=@me`, polled every 5 minutes and cached. Each says
// whether the repository is here (an open space, or a clone found beside one: a review can start in it) and whether a live
// run is already reviewing it. Failing quietly: no GitHub shows as "can't reach GitHub".

import { exec } from "herdr";
import { knownRepos } from "./repospaces.js";

export const FIELDS = "number,title,url,author,updatedAt,repository";
// Every 5 minutes, like an open run's PRs at the latest (attention.js prTtl), to stay clear of GitHub's API rate limits.
export const POLL_MS = 5 * 60000;

// gh's JSON → [{repo: "owner/name", number, title, url, author, updated}], newest first.
export function parseReviewRequests(text) {
  let list;
  try { list = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((p) => p?.url && p.number).map((p) => ({
    repo: p.repository?.nameWithOwner ?? /github\.com\/([^/]+\/[^/]+)\/pull/.exec(p.url)?.[1] ?? "",
    number: p.number,
    title: String(p.title ?? ""),
    url: p.url,
    author: p.author?.login ?? "",
    updated: Date.parse(p.updatedAt) || 0,
  })).sort((a, b) => b.updated - a.updated);
}

export const key = (url) => String(url).replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\/(files|commits)$/, "").toLowerCase();

// The live run whose issues or related PRs name the PR, or null. `runs` are the open ones. A
// bare "52" or "#52" in its issues counts when the run's folder is the PR's repository.
export function runReviewing(runs, url) {
  const k = key(url);
  const [, repoName, num] = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(url) ?? [];
  const names = (x, u) => key(u) === k || (num && String(u).replace(/^#/, "") === num && String(x.folder ?? "").split("/").pop() === repoName);
  const r = runs.find((x) => [...(x.issues ?? []), ...(x.related ?? []).map((p) => p.url ?? p)].some((u) => names(x, u)));
  return r?.dir ?? null;
}

// Where owner/repo can be reviewed: an open space whose repository's origin it is (before a
// clone found beside them, which has no space yet: `space` is null and a review opens one). On
// any machine; this machine's first, as knownRepos lists them. `machine` is null for this one.
export const localCheckout = (repos, repo) => {
  const want = String(repo).toLowerCase();
  const r = repos.find((x) => x.origin === want && x.space) ?? repos.find((x) => x.origin === want);
  return r ? { space: r.space ?? null, root: r.root, name: r.name, machine: r.machine ?? null } : null;
};

// The requests with where they can be reviewed: pure over what the poll found.
export function withContext(list, repos, runs) {
  return list.map((p) => ({ ...p, local: localCheckout(repos, p.repo), run: runReviewing(runs, p.url) }));
}

// ---- the poll: one cache for every copy of the mod ----
// A cached poll of one gh command: `parse` turns its stdout into a list, or null when there is
// nothing usable. With `partial`, a failing exit still counts when its stdout parses (gh api graphql
// exits 1 for any error in a response that also carries data). Failing quietly keeps the last list.
export function poller(args, parse, { partial = false } = {}) {
  let cache = { at: 0, list: [], repos: [], error: null, loading: false };
  const fail = (extra = {}) => ({ ...cache, at: Date.now(), error: "can't reach GitHub", loading: false, ...extra });
  async function refresh(force = false) {
    if (cache.loading || (!force && Date.now() - cache.at < POLL_MS)) return;
    cache.loading = true;
    try {
      const res = await exec("gh", args, { timeout: 20000 });
      const repos = await knownRepos().catch(() => cache.repos);
      const list = res.code === 0 || partial ? parse(res.stdout) : null;
      cache = list ? { at: Date.now(), list, repos, error: null, loading: false } : fail({ repos });
    } catch {
      cache = fail();
    }
  }
  // The cache; starts a poll when it is old, never waits for it.
  return { refresh, get: () => { refresh().catch(() => {}); return cache; }, error: () => cache.error };
}

const requests = poller(["search", "prs", "--review-requested=@me", "--state=open", "--limit", "30", "--json", FIELDS], parseReviewRequests);
export const refreshReviews = requests.refresh;

// [{repo, number, title, url, author, updated, local, run}] and the quiet error, from the cache;
// ctx: {runs} the live runs.
export function reviewRequests(ctx = {}) {
  const c = requests.get();
  return withContext(c.list, c.repos, ctx.runs ?? []);
}
export const reviewError = requests.error;
