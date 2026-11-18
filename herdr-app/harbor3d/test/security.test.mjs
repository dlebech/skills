// Why this test exists: the server must never be able to write files (except the one want file),
// run programs (except cloudflared) or send anything to an agent. A viewer can only reach the pokes,
// but a stray `exec` or `writeFile` added later would turn a bug into a channel. So this test reads
// every source file under server/ and bin/ and fails on any such call outside an exact allow-list.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const files = ["server", "bin"].flatMap(d => fs.readdirSync(path.join(root, d)).filter(f => f.endsWith(".js")).map(f => `${d}/${f}`))
const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(root, f), "utf8")]))
const count = (text, re) => (text.match(re) || []).length

// pattern → { file: allowed number of occurrences }; anything not listed is allowed zero times
const ALLOWED = [
  // utimes once: touching the want file
  [/\b(writeFile|appendFile|createWriteStream|rename|rm|rmdir|unlink|mkdir|mkdtemp|l?utimes|futimes|copyFile|symlink|link|truncate|chmod|chown|cp)(Sync)?\s*\(/g, { "server/facts.js": 1 }],
  // open once: creating the want file when missing (O_NOFOLLOW, no truncate)
  [/\bopen(Sync)?\s*\(/g, { "server/facts.js": 1 }],
  [/\bspawn(Sync)?\s*\(/g, { "server/share.js": 1 }],
  [/\b(exec|execSync|execFile|execFileSync|fork)\s*\(/g, {}],
  [/\beval\s*\(|\bFunction\s*\(|new\s+Function\b/g, {}],
  [/["'`](node:)?child_process["'`]/g, { "server/share.js": 1 }],
  // renamed imports or destructured aliases of a dangerous function, and string-keyed access to fs
  [/\b(writeFile|appendFile|createWriteStream|rename|rm|rmdir|unlink|mkdir|l?utimes|copyFile|symlink|truncate|open|exec|execFile|spawn|fork)\w*\s*(:|\bas\b)\s*\w/g, {}],
  [/\bfs\s*\[|\bimport\s*\(|["'`](writeFile|appendFile|exec|execSync|spawn|fork)\w*["'`]/g, {}],
  [/node:(worker_threads|cluster|vm|net|dgram|dns|tls)/g, {}],
  [/"hc"|'hc'|`hc`|\bhc /g, {}],
  [/process\.(binding|dlopen)|require\s*\(/g, {}],
]

test("no write or exec call outside the allow-list", () => {
  for (const [re, allowed] of ALLOWED) for (const f of files) {
    assert.equal(count(src[f], re), allowed[f] || 0, `${f}: ${re}`)
  }
})

test("the one write is the want file at a fixed path, and spawn is cloudflared with an argv array", () => {
  assert.match(src["server/facts.js"], /lutimesSync\(want, t, t\)/)
  assert.match(src["server/facts.js"], /openSync\(want, fs\.constants\.O_CREAT \| fs\.constants\.O_WRONLY \| fs\.constants\.O_NOFOLLOW\)/)
  assert.match(src["server/facts.js"], /const want = path\.join\(root, "\.harbor3d\.want"\)/)
  assert.match(src["server/share.js"], /spawn\("cloudflared", \[/)
  assert.ok(!/shell\s*:/.test(src["server/share.js"]))
})

test("the allow-list scan sees real source (it would catch a planted call)", () => {
  assert.ok(files.length >= 7)
  assert.equal(count("fs.writeFileSync(x)", ALLOWED[0][0]), 1)
  assert.equal(count("cp.execSync('x')", ALLOWED[3][0]), 1)
  // renamed or prefix-less imports get through no pattern-free gap
  const hit = text => ALLOWED.some(([re, ok]) => count(text, re) > 0 && Object.keys(ok).length === 0 || (re.source.includes("child_process") && count(text, re) > 0))
  assert.ok(hit('import { exec as run } from "child_process"'))
  assert.ok(hit("const { writeFileSync: w } = fs; w(p, x)"))
  assert.ok(hit('fs["writeFileSync"](p, x)'))
  assert.ok(hit('import { spawn as s } from "node:child_process"'))
})
