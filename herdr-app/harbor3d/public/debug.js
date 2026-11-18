// Placeholder page: connects to events and prints the scene as text (textContent only, never HTML).
const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("")
const viewer = hex(8)
const $ = id => document.getElementById(id)
let scene = null

const es = new EventSource("events")
es.addEventListener("open", () => { $("status").textContent = "connected" })
es.addEventListener("error", () => { $("status").textContent = "reconnecting…" })
es.addEventListener("scene", e => { scene = JSON.parse(e.data); $("scene").textContent = JSON.stringify(scene, null, 2) })
es.addEventListener("poke", e => { $("pokes").textContent = `${e.data}\n${$("pokes").textContent}`.slice(0, 2000) })

for (const b of document.querySelectorAll("button[data-kind]")) {
  b.addEventListener("click", async () => {
    const target = scene?.runs[0]?.id ?? "harbor"
    const r = await fetch("poke", { method: "POST", headers: { "content-type": "application/json", "x-viewer": viewer }, body: JSON.stringify({ kind: b.dataset.kind, target }) })
    $("status").textContent = `poke ${b.dataset.kind}: ${r.status}`
  })
}
