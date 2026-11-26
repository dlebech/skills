// What the PR does to each issue, as the run pane's issue rows show it (issuelinks.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { issueLinkPill } from "../../herdr-app/mods/harbormaster/issuelinks.js";

test("no link said: no pill", () => {
  assert.equal(issueLinkPill(undefined), null);
  assert.equal(issueLinkPill({}), null);
});

test("closes warns in amber, with the reason in the tip", () => {
  const p = issueLinkPill({ link: "closes", why: "assigned to you" });
  assert.equal(p.label, "⚠ Closes on merge");
  assert.equal(p.tone, "amber");
  assert.match(p.tip, /closes this issue \(assigned to you\)/);
});

test("refs and part stay open, dim", () => {
  assert.equal(issueLinkPill({ link: "refs", why: "assigned to anna too" }).label, "Stays open");
  assert.match(issueLinkPill({ link: "refs", why: "assigned to anna too" }).tip, /anna too/);
  assert.equal(issueLinkPill({ link: "part", why: null }).label, "Part of");
  assert.equal(issueLinkPill({ link: "part", why: null }).tone, "dim");
});

test("a link it does not know: no pill, rather than a wrong 'stays open'", () => {
  assert.equal(issueLinkPill({ link: "close", why: null }), null);
});
