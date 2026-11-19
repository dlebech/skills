// Who a run's PR could ask for a review: the people who reviewed, or were asked to review, the
// repository's recent pull requests. Pure (no herdr or gpui), so the tests drive it; data.js
// fetches the list (`gh pr list`) and needbox.js draws the picker.

// The most names the picker offers.
export const MAX_REVIEWERS = 6;

// What GitHub accepts as a user's login: letters, digits and hyphens, not starting with a hyphen
// (so gh never reads it as a flag), 39 long at most. Checked before a name reaches
// `gh pr edit --add-reviewer`.
export const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

// Whether a chip's click may go to gh: nothing is under way, the picker is open for this run (`key`)
// and PR (`url`), and the login is a valid one of the `candidates` drawn. `requesting` is the view's
// {key, pr, busy}.
export const canRequest = ({ requesting, key, url, login, candidates, busy = false }) =>
  Boolean(requesting) && !busy && !requesting.busy && requesting.key === key && requesting.pr === url
  && LOGIN.test(login ?? "") && (candidates ?? []).includes(login);

// Whether a gh user object is a bot: a login ending "[bot]", `is_bot`, or a "Bot" type.
const isBot = (u) => Boolean(u) && (u.is_bot === true || u.__typename === "Bot" || u.type === "Bot" || /\[bot\]$/i.test(u.login ?? ""));

// The logins that reviewed or were asked to review among `prs` (the JSON of `gh pr list --json
// author,reviews,reviewRequests`, newest first), most often first; equal counts: the one on the
// newer PR first. Left out: `viewer`, `author` (the PR the review is for), each PR's own author
// (their replies are no review) and, unless `bots` is false, bot accounts. A team request has no
// login and is skipped. At most MAX_REVIEWERS.
export function reviewerCandidates(prs, { viewer = null, author = null, bots = true } = {}) {
  const seen = new Map(); // login → {n: PRs it is on, at: newest PR's index}
  const skip = (u) => !u?.login || u.login === viewer || u.login === author || (bots && isBot(u));
  (prs ?? []).forEach((p, i) => {
    const on = new Set();
    for (const r of p?.reviews ?? []) {
      if (r?.state === "PENDING" || r?.author?.login === p.author?.login || skip(r?.author)) continue;
      on.add(r.author.login);
    }
    for (const r of p?.reviewRequests ?? []) {
      if (r?.login && !skip(r) && r.login !== p.author?.login) on.add(r.login);
    }
    for (const login of on) {
      const e = seen.get(login);
      if (e) e.n++; else seen.set(login, { n: 1, at: i });
    }
  });
  return [...seen].sort((a, b) => b[1].n - a[1].n || a[1].at - b[1].at).map(([login]) => login).slice(0, MAX_REVIEWERS);
}

// The gh arguments that list a repository's recent PRs for reviewerCandidates.
export const reviewersArgs = (repo) => ["pr", "list", "--repo", repo, "--state", "all", "--limit", "40", "--json", "author,reviews,reviewRequests"];

// The gh arguments that ask `login` to review the PR at `url`, or null when the login or URL is
// not one gh should be given. Always an argv array, never a shell string.
export const requestArgs = (url, login) => (LOGIN.test(login ?? "") && /^https:\/\/[^\s]+$/.test(url ?? "") ? ["pr", "edit", url, "--add-reviewer", login] : null);

// What the picker's label says: a draft is marked ready first.
export const pickerLabel = (draft) => (draft ? "Mark ready and request review from:" : "Request review from:");
