// Why this test exists: every string from the scene must reach the DOM as text. A single innerHTML, a
// document.write or an eval in public/ would turn a hostile label into script. So this reads every
// source file in public/ and fails on any HTML-parsing sink, string-to-code call or inline handler.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")
const files = []
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|html|css)$/.test(e.name) && files.push(path.join(d, e.name)) }
walk(pub)

const BAD = [
  /\binnerHTML\b/, /\bouterHTML\b/, /insertAdjacentHTML/, /document\s*\.\s*write/, /\beval\s*\(/, /\bnew\s+Function\b/, /\bFunction\s*\(/,
  /createContextualFragment/, /\bDOMParser\b/, /\bsrcdoc\b/, /setAttribute\(\s*["'`](style|on\w+|href|src)["'`]/, /\.cssText\b/, /\bimportScripts\b/,
  /\bsetTimeout\(\s*["'`]/, /\bsetInterval\(\s*["'`]/, /javascript:/i, /\blocalStorage\b|\bsessionStorage\b|document\.cookie/,
]
test("public/ has files to scan", () => { assert.ok(files.length >= 8, files.join()) })
test("no HTML sink, string-to-code call, inline handler or storage in public/", () => {
  for (const f of files.filter(f => !f.endsWith(".css"))) {
    const src = fs.readFileSync(f, "utf8")
    for (const re of BAD) assert.ok(!re.test(src), `${path.relative(pub, f)}: ${re}`)
    assert.ok(!/<\w+[^>]*\son\w+\s*=/i.test(src) || f.endsWith(".js"), `${f}: inline handler`)
  }
})
test("the scan would catch a planted sink", () => {
  for (const bad of ["el.innerHTML = x", "document.write(x)", "eval(x)", "el.insertAdjacentHTML('a', x)", "new Function(x)", "el.setAttribute('style', x)"]) assert.ok(BAD.some(re => re.test(bad)), bad)
})
