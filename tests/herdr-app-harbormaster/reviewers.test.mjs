// Who a PR could ask for a review (reviewers.js): the earlier reviewers of the repository, most
// frequent first, without the viewer, the author and bots, at most six; and the gh call's guard.
// Run: node --import ./loader.mjs --test reviewers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { canRequest, reviewerCandidates, requestArgs, reviewersArgs, pickerLabel, LOGIN, MAX_REVIEWERS } from "../../herdr-app/mods/harbormaster/reviewers.js";

const rv = (login, state = "APPROVED", extra = {}) => ({ author: { login, ...extra }, state });
const pr = (author, reviews = [], requests = []) => ({ author: { login: author }, reviews, reviewRequests: requests.map((login) => (login ? { login } : { name: "core", slug: "core" })) });

test("most frequent first; a tie goes to the newer PR; each PR counts a person once", () => {
  const prs = [
    pr("kim", [rv("anna"), rv("anna", "COMMENTED")], ["bo"]),
    pr("kim", [rv("cy")], []),
    pr("cy", [rv("bo")], ["anna"]),
  ];
  // anna: 2 PRs, bo: 2 PRs (newest on 0, so before anna? both newest on 0 and 2: anna 0, bo 0), cy: 1.
  assert.deepEqual(reviewerCandidates(prs, {}), ["anna", "bo", "cy"]);
  const tie = [pr("x", [rv("late")]), pr("x", [rv("early")])];
  assert.deepEqual(reviewerCandidates(tie, {}), ["late", "early"]);
});

test("leaves out the viewer, the PR's author, each PR's own author, bots and teams", () => {
  const prs = [pr("kim", [rv("me"), rv("anna"), rv("kim", "COMMENTED"), rv("ci[bot]"), rv("sweep", "COMMENTED", { is_bot: true }), rv("rabbit", "COMMENTED", { __typename: "Bot" })], [null, "bo", "writer"]),
    pr("writer", [rv("writer", "COMMENTED")], [])];
  assert.deepEqual(reviewerCandidates(prs, { viewer: "me", author: "writer" }), ["anna", "bo"]);
  assert.deepEqual(reviewerCandidates(prs, { viewer: "me", author: "writer", bots: false }), ["anna", "ci[bot]", "sweep", "rabbit", "bo"]);
});

test("a pending review is no review; at most six; nothing at all gives none", () => {
  assert.deepEqual(reviewerCandidates([pr("a", [rv("p", "PENDING")])], {}), []);
  const many = [pr("a", "bcdefghij".split("").map((l) => rv(l)))];
  assert.equal(reviewerCandidates(many, {}).length, MAX_REVIEWERS);
  assert.deepEqual(reviewerCandidates(null, {}), []);
  assert.deepEqual(reviewerCandidates([{}], {}), []);
});

test("the gh calls are argv arrays, and a login or URL gh should not get yields none", () => {
  assert.deepEqual(reviewersArgs("o/r"), ["pr", "list", "--repo", "o/r", "--state", "all", "--limit", "40", "--json", "author,reviews,reviewRequests"]);
  assert.deepEqual(requestArgs("https://github.com/o/r/pull/7", "anna-b"), ["pr", "edit", "https://github.com/o/r/pull/7", "--add-reviewer", "anna-b"]);
  for (const bad of ["", "a b", "x;rm", "a".repeat(40), "-n", "--help", "bot[bot]", null]) assert.equal(requestArgs("https://github.com/o/r/pull/7", bad), null, String(bad));
  assert.ok(LOGIN.test("a-b-1") && LOGIN.test("a".repeat(39)));
  assert.equal(requestArgs("not a url", "anna"), null);
  assert.equal(pickerLabel(true), "Mark ready and request review from:");
  assert.equal(pickerLabel(false), "Request review from:");
});

test("canRequest: only a listed, valid login, for the open picker, with nothing under way", () => {
  const ok = { requesting: { key: "k", pr: "u", busy: null }, key: "k", url: "u", login: "anna", candidates: ["anna", "bo"] };
  assert.equal(canRequest(ok), true);
  assert.equal(canRequest({ ...ok, login: "carl" }), false, "not among the candidates");
  assert.equal(canRequest({ ...ok, login: "-n", candidates: ["-n"] }), false, "not a login");
  assert.equal(canRequest({ ...ok, requesting: { ...ok.requesting, busy: "bo" } }), false, "a request is under way");
  assert.equal(canRequest({ ...ok, requesting: null }), false, "no picker open");
  assert.equal(canRequest({ ...ok, key: "other" }), false, "another run");
  assert.equal(canRequest({ ...ok, url: "u2" }), false, "another PR");
});
