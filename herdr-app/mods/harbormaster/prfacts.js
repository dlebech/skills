// A run card's PR facts: each PR's state, checks, one-way door and review as the facts line
// shows them, said once when several PRs agree. Pure, so the tests drive them; overview.js draws them.

// A PR's state as a word ("Open", "Draft", "Merged"), or null when it could not be read.
export const prStateText = (pr) => (pr.state === "UNKNOWN" ? null : pr.state === "DRAFT" ? "Draft" : pr.state[0] + pr.state.slice(1).toLowerCase());

// A PR's review as [text, tone]: who approved or asked for changes, when we know.
export function reviewText(pr) {
  const who = (list) => (list?.length ? ` by ${list.join(", ")}` : "");
  if (pr.review === "CHANGES_REQUESTED") return [`Changes requested${who(pr.changesBy)}`, "blocked"];
  if (pr.review === "APPROVED") return [`Approved${who(pr.approvedBy)}`, "done"];
  if (pr.review === "REVIEW_REQUIRED") return ["Review needed", "dim"];
  return null;
}

// A PR's checks as {text, tone}, or null without any. Failing checks are red ("act") on a live
// run, dim on a parked or closed one (`away`): it never needs you, so red would ask for nothing.
function checksFact(pr, away) {
  const c = pr.checks ?? {};
  if (c.fail) return { text: `checks ✗ ${c.fail} failing`, tone: away ? "dim" : "blocked" };
  if (c.pending) return { text: `checks … ${c.pending} running`, tone: "dim" };
  if (c.pass) return { text: "checks ✓", tone: "pass" };
  return null;
}

// The facts line's PR part: [{kind: "pr", pr, i, text} | {kind: "prs", prs, text} | {kind: "text",
// text, tone, bold?}], tone a theme colour name or "pass" (green). Each PR is "PR #42 open", then
// its checks, "one-way door" (`oneWay(danger)` says which dangers are) and its review. Several
// PRs that all say the same (state, checks and review, and no one-way door) are said once:
// "2 PRs open · checks ✓ · Approved by anna", rather than the same three facts per PR.
export function prFacts(prs, { away = false, oneWay = () => false } = {}) {
  const per = (prs ?? []).map((pr, i) => {
    const state = prStateText(pr);
    const review = reviewText(pr);
    return {
      pr, i, state,
      head: `${pr.number ? `PR #${pr.number}` : "PR"}${state ? ` ${state.toLowerCase()}` : ""}`,
      rest: [checksFact(pr, away), pr.danger && oneWay(pr.danger) ? { text: "one-way door", tone: "blocked", bold: true } : null,
        review ? { text: review[0], tone: review[1] === "done" ? "pass" : review[1] } : null].filter(Boolean),
    };
  });
  const sig = (x) => [x.state, ...x.rest.map((f) => f.text)].join("\n");
  const alike = per.length > 1 && per.every((x) => x.state && sig(x) === sig(per[0])) && !per[0].rest.some((f) => f.text === "one-way door");
  if (alike) {
    return [{ kind: "prs", prs: per.map((x) => x.pr), text: `${per.length} PRs ${per[0].state.toLowerCase()}` }, ...per[0].rest.map((f) => ({ kind: "text", ...f }))];
  }
  return per.flatMap((x) => [{ kind: "pr", pr: x.pr, i: x.i, text: x.head }, ...x.rest.map((f) => ({ kind: "text", ...f }))]);
}
