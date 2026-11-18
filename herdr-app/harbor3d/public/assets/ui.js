// The page's DOM: berth labels, the info card and the toolbar. Every string reaches the DOM through
// textContent (or a fixed attribute); nothing here builds markup.
import { labelLine, cardModel } from "./look.js"

const $ = id => document.getElementById(id)
// Make an element: `cls` class name, `text` its textContent, `attrs` fixed attributes.
function el(tag, cls, text, attrs) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined && text !== null) e.textContent = text
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

// Berth labels: the name over a short line, one per berth or parked ship, placed each frame by the page.
export class Labels {
  constructor(root) { this.root = root; this.items = new Map() }
  // Add, update and remove labels to match the runs that are drawn.
  sync(runs) {
    const keep = new Set(runs.map(r => r.id))
    for (const [id, it] of this.items) if (!keep.has(id)) { it.root.remove(); it.tether.remove(); this.items.delete(id) }
    for (const r of runs) {
      let it = this.items.get(r.id)
      if (!it) { it = { root: el("div", "label"), name: el("div", "name"), line: el("div", "line"), tether: el("div", "tether"), last: "", w: 0, h: 0 }; it.root.append(it.name, it.line); this.root.append(it.root, it.tether); this.items.set(r.id, it) }
      const line = labelLine(r), kind = r.needsYou ? "needs" : r.parked ? "parked" : r.phase === "finished" ? "finished" : "run"
      if (it.name.textContent !== r.label) { it.name.textContent = r.label; it.w = 0 }
      if (it.line.textContent !== line) { it.line.textContent = line; it.w = 0 }
      if (it.kind !== kind) { it.kind = kind; it.root.className = `label ${kind}` }
    }
  }
  // A label's size in pixels (measured again only after its text changed).
  size(id) {
    const it = this.items.get(id)
    if (!it) return { w: 0, h: 0 }
    if (!it.w) { it.w = it.root.offsetWidth || 120; it.h = it.root.offsetHeight || 32 }
    return { w: it.w, h: it.h }
  }
  // Put a label at a screen point (or hide it); `alpha` fades it. A raised label (anchorY below y) gets a
  // 1 px line down to its anchor.
  place(id, x, y, alpha, anchorY = y) {
    const it = this.items.get(id)
    if (!it) return
    if (alpha <= 0.01) { if (!it.hidden) { it.hidden = true; it.root.style.opacity = "0"; it.root.style.visibility = "hidden"; it.tether.style.visibility = "hidden" } return }
    if (it.hidden) { it.hidden = false; it.root.style.visibility = "visible" }
    it.root.style.opacity = String(Math.round(alpha * 100) / 100)
    it.root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`
    const raised = anchorY - y > 1
    it.tether.style.visibility = raised ? "visible" : "hidden"
    if (raised) { it.tether.style.opacity = String(Math.round(alpha * 70) / 100); it.tether.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; it.tether.style.height = `${Math.round(anchorY - y)}px` }
  }
}

// The info card for the selected run: a right-hand panel, a bottom sheet on narrow screens.
export class Card {
  constructor(root, onClose) { this.root = root; this.onClose = onClose; this.id = null }
  // Show a run's card. The same card again (same run, same content) leaves the DOM alone, so a scene push that
  // changes nothing in it does not take away keyboard focus or the scroll position.
  show(run) {
    const m = cardModel(run), r = this.root, key = JSON.stringify([run.id, m])
    if (!r.hidden && key === this.key) return
    this.key = key
    this.id = run.id
    r.replaceChildren()
    const head = el("div", "head")
    head.append(el("h2", null, m.title))
    const close = el("button", "close", "×", { type: "button", "aria-label": "Close details" })
    close.addEventListener("click", () => this.onClose())
    head.append(close)
    r.append(head)
    if (m.sub) r.append(el("p", "sub", m.sub))
    r.append(el("p", "kind", `${m.type} · ${m.phase}`))
    const path = el("p", "path", null, { "aria-label": "Path to merge" })
    m.path.forEach((p, i) => {
      if (i) path.append(el("span", "sep", " › "))
      path.append(el("span", `step${p.dim ? " dim" : ""}${p.current ? " current" : ""}`, p.mark ? `${p.label} ${p.mark}` : p.label))
    })
    r.append(path)
    r.append(this.row("Tasks", m.tasks))
    if (m.prs.length) r.append(this.list("Pull requests", m.prs.slice(0, 4)))
    if (m.workers.length) r.append(this.list("Crabs", m.workers.slice(0, 12)))
    r.append(this.row("Age", m.age), this.row("Size", m.size))
    for (const n of m.notes) r.append(el("p", "note", n))
    r.hidden = false
    document.body.classList.add("card-open")
  }
  row(k, v) { const d = el("div", "row"); d.append(el("span", "k", k), el("span", "v", v)); return d }
  list(title, items) { const d = el("div", "list"); d.append(el("h3", null, title)); for (const i of items) d.append(el("div", "item", i)); return d }
  hide() { this.id = null; this.key = null; this.root.hidden = true; this.root.replaceChildren(); document.body.classList.remove("card-open") }
  // The card's box on screen (to keep labels from overlapping it), or null.
  rect() { return this.root.hidden ? null : this.root.getBoundingClientRect() }
}

// The toolbar: small text buttons. `on` holds the handlers by name.
export class Toolbar {
  constructor(root, on) {
    this.root = root; this.b = {}
    const add = (key, text, extra) => {
      const b = el("button", key === "wave" || key === "fireworks" ? "sel" : "", text, { type: "button", ...(extra || {}) })
      b.addEventListener("click", () => on[key] && on[key](b))
      this.b[key] = b; root.append(b)
      return b
    }
    add("overview", "Overview"); add("tour", "Tour", { "aria-pressed": "false" }); add("sky", "Auto"); add("horn", "Horn"); add("feed", "Feed the gulls")
    add("sound", "Sound: off", { "aria-pressed": "false" })
    add("wave", "Wave").hidden = true; add("fireworks", "Fireworks").hidden = true
  }
  setSelected(on) { this.b.wave.hidden = !on; this.b.fireworks.hidden = !on }
  setTour(on) { this.b.tour.setAttribute("aria-pressed", String(on)); this.b.tour.textContent = on ? "Stop tour" : "Tour" }
  setSky(text) { this.b.sky.textContent = text }
  setSound(on) { this.b.sound.setAttribute("aria-pressed", String(on)); this.b.sound.textContent = `Sound: ${on ? "on" : "off"}` }
  // Dim a button for a moment (after a 429).
  dim(b, ms = 1000) { b.disabled = true; b.classList.add("dim"); setTimeout(() => { b.disabled = false; b.classList.remove("dim") }, ms) }
}

// Small overlays: connection status, "+n more", the stale banner, the ?stats=1 box.
export const overlays = {
  status: text => { $("status").textContent = text; $("status").hidden = !text },
  banner: text => { $("banner").textContent = text || ""; $("banner").hidden = !text },
  stats: text => { const s = $("stats"); s.hidden = false; s.textContent = text },
}
export { $, el }
