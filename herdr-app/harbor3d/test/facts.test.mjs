import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createFactsReader, MAX_BYTES } from "../server/facts.js"
import { fixture, tmp } from "./helpers.mjs"

const put = (dir, text) => { fs.writeFileSync(path.join(dir, ".harbor3d.json"), text); const t = Date.now() / 1000 + Math.random() * 10; fs.utimesSync(path.join(dir, ".harbor3d.json"), t, t) }

test("a missing file is stale and has no facts", () => {
  const r = createFactsReader({ root: tmp() })
  assert.equal(r.poll(), false)
  assert.deepEqual(r.snapshot(), { facts: null, stale: true })
})

test("reads good facts; fresh until 45 s after `at`, then stale", () => {
  const dir = tmp(), f = fixture("facts-basic.json")
  let t = f.at + 1000
  const r = createFactsReader({ root: dir, now: () => t })
  put(dir, JSON.stringify(f))
  assert.equal(r.poll(), true)
  assert.equal(r.snapshot().stale, false)
  assert.equal(r.snapshot().facts.runs.length, 6)
  t = f.at + 45001
  assert.equal(r.snapshot().stale, true)
  assert.equal(r.snapshot().facts.runs.length, 6, "last known facts are kept")
})

test("parses only when mtime or size changed", () => {
  const dir = tmp()
  const r = createFactsReader({ root: dir })
  put(dir, JSON.stringify(fixture("facts-basic.json")))
  assert.equal(r.poll(), true)
  assert.equal(r.poll(), false)
})

test("a file over 1 MB is refused and the last good facts stay", () => {
  const dir = tmp(), f = fixture("facts-basic.json")
  const r = createFactsReader({ root: dir, now: () => f.at })
  put(dir, JSON.stringify(f)); r.poll()
  put(dir, JSON.stringify({ ...f, runs: [], pad: "x".repeat(5 * 1024 * 1024) }))
  assert.ok(fs.statSync(path.join(dir, ".harbor3d.json")).size > MAX_BYTES)
  assert.equal(r.poll(), false)
  assert.equal(r.snapshot().facts.runs.length, 6)
})

test("invalid JSON or the wrong shape keeps the last good facts, which go stale after 45 s", () => {
  const dir = tmp(), f = fixture("facts-basic.json")
  let t = f.at
  const r = createFactsReader({ root: dir, now: () => t })
  put(dir, JSON.stringify(f)); r.poll()
  for (const bad of ["{not json", "[]", "null", JSON.stringify({ v: 2, at: 1 }), JSON.stringify({ v: 1, at: "x" }), ""]) {
    put(dir, bad)
    assert.equal(r.poll(), false, bad)
    assert.equal(r.snapshot().facts.runs.length, 6)
  }
  assert.equal(r.snapshot().stale, false)
  t = f.at + 46000
  assert.equal(r.snapshot().stale, true)
})

test("touchWant creates and refreshes .harbor3d.want, and never throws without a root", () => {
  const dir = tmp()
  const r = createFactsReader({ root: dir })
  r.touchWant()
  const p = path.join(dir, ".harbor3d.want")
  assert.ok(fs.existsSync(p))
  fs.utimesSync(p, 1000, 1000)
  r.touchWant()
  assert.ok(fs.statSync(p).mtimeMs > 1e6)
  assert.doesNotThrow(() => createFactsReader({ root: path.join(dir, "nope", "nope") }).touchWant())
  assert.deepEqual(fs.readdirSync(dir), [".harbor3d.want"])
})

test("touchWant does not follow a symlink: the target is neither emptied nor replaced", () => {
  const dir = tmp(), target = path.join(dir, "precious.txt")
  fs.writeFileSync(target, "keep me")
  fs.symlinkSync(target, path.join(dir, ".harbor3d.want"))
  createFactsReader({ root: dir }).touchWant()
  assert.equal(fs.readFileSync(target, "utf8"), "keep me")
  assert.ok(fs.lstatSync(path.join(dir, ".harbor3d.want")).isSymbolicLink())
  // a dangling link: nothing is created through it
  const dir2 = tmp(), gone = path.join(dir2, "gone.txt")
  fs.symlinkSync(gone, path.join(dir2, ".harbor3d.want"))
  createFactsReader({ root: dir2 }).touchWant()
  assert.ok(!fs.existsSync(gone))
})
