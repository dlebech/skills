import { test } from "node:test";
import assert from "node:assert/strict";
import { urlFromOutput, serverPath, hasServer } from "../../herdr-app/mods/harbormaster/harbor3d.js";

test("urlFromOutput takes only the private URL line", () => {
  assert.equal(urlFromOutput("starting\nHarbor 3D: http://127.0.0.1:4173/\n"), "http://127.0.0.1:4173/");
  assert.equal(urlFromOutput("Harbor 3D: http://127.0.0.1:4173/"), "http://127.0.0.1:4173/");
});
test("urlFromOutput rejects anything else", () => {
  for (const bad of [
    "Harbor 3D: http://evil.example/", "Harbor 3D: http://127.0.0.1:80@evil/", "Harbor 3D: http://127.0.0.1/",
    "Harbor 3D: http://127.0.0.1:abc/", "Harbor 3D: https://127.0.0.1:4173/", "Harbor 3D: http://127.0.0.1:4173/x",
    "Harbor 3D: http://127.0.0.1:4173/ evil", "Harbor 3D: http://127.0.0.1:99999/", "Harbor 3D: http://127.0.0.1:0/",
    "Shared: http://127.0.0.1:4173/", "", null, undefined,
  ]) assert.equal(urlFromOutput(bad), null, String(bad));
});
test("serverPath", () => {
  assert.equal(serverPath("/h/.config/herdr-app"), "/h/.config/herdr-app/harbor3d/bin/harbor3d.js");
  assert.equal(serverPath("/h/x/"), "/h/x/harbor3d/bin/harbor3d.js");
});
test("hasServer finds a live terminal named harbor3d", () => {
  const j = (t) => JSON.stringify({ terminals: t });
  assert.equal(hasServer(j([{ name: "harbor3d", state: "live" }])), true);
  assert.equal(hasServer(j([{ name: "harbor3d", state: "done" }, { name: "other", state: "live" }])), false);
  assert.equal(hasServer("not json"), false);
  assert.equal(hasServer(undefined), false);
});
import { lastLine, startArgs } from "../../herdr-app/mods/harbormaster/harbor3d.js";
test("lastLine is the last non-empty line, cut", () => {
  assert.equal(lastLine("a\nharbor3d: three.js is missing\n\n  \n"), "harbor3d: three.js is missing");
  assert.equal(lastLine(""), ""); assert.equal(lastLine(null), "");
  assert.equal(lastLine("x".repeat(300)).length, 120);
});
test("startArgs runs the server without a parent or notes, after --", () => {
  assert.deepEqual(startArgs("/h"), ["run", "--bg", "--no-notify", "--no-parent", "--name", "harbor3d", "--", "node", "/h/harbor3d/bin/harbor3d.js", "serve"]);
});
