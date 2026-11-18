// Wiring: the renderer, camera and controls, the event stream, selection, the toolbar, and the loop.
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { Kit, Water, Sky, Lighthouse, Boat, softTexture, damp } from "./world.js"
import { Reef, Raft, reefAssets } from "./reefs.js"
import { Horn, Fireworks, Gulls } from "./effects.js"
import { Labels, Card, Toolbar, overlays, $ } from "./ui.js"
import { assignSlots, slotPosition, adriftPosition, MAX_SLOTS, MAX_ADRIFT } from "./layout.js"
import { skyLook, captainLook } from "./look.js"

const params = new URLSearchParams(location.search)
const STILL = params.get("still") === "1"
const STATS = params.get("stats") === "1"
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
const OVERVIEW = { pos: new THREE.Vector3(39, 30, 39), target: new THREE.Vector3(0, 2, 0) }

// A random id of 16 hex characters, kept in memory only (never a cookie or storage); the server uses it to rate-limit pokes.
const viewerId = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("")

// ---- renderer, camera, controls ----
const canvas = $("view")
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 600)
camera.position.copy(OVERVIEW.pos)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true; controls.dampingFactor = 0.08
controls.minDistance = 12; controls.maxDistance = 110
controls.maxPolarAngle = Math.PI / 2 - (5 * Math.PI) / 180   // never below 5° above the water
controls.target.copy(OVERVIEW.target)
controls.autoRotateSpeed = 1.6
controls.update()

// The overview camera spot: further out on a tall (phone) screen so the whole harbor fits.
const overviewPos = () => OVERVIEW.pos.clone().sub(OVERVIEW.target).multiplyScalar(Math.min(1.7, Math.max(1, 1 / camera.aspect))).add(OVERVIEW.target)
function resize(initial) {
  const w = window.innerWidth, h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h; camera.updateProjectionMatrix()
  if (initial) { camera.position.copy(overviewPos()); controls.update() }
  cardRect = card.rect()
}

// ---- state ----
const kit = new Kit()
let world = null          // { water, sky, lighthouse, boat, horn, fireworks, gulls, assets }
let data = null           // the latest scene
let firstScene = false
const reefs = new Map()   // run id -> Reef
const rafts = new Map()   // adrift id -> Raft
let slotsPrev = new Map(), raftSlotsPrev = new Map()
let selected = null       // run id
let skyMode = "auto"      // auto | day | night
let beamTargets = []
let time = 0, motion = reducedQuery.matches ? 0 : 1, cardRect = null
reducedQuery.addEventListener("change", () => { motion = reducedQuery.matches ? 0 : 1 })

const labels = new Labels($("labels"))
const card = new Card($("card"), () => overview())
const toolbar = new Toolbar($("toolbar"), {
  overview: () => { stopTour(); overview() },
  tour: () => (touring ? stopTour() : startTour()),
  sky: () => { skyMode = skyMode === "auto" ? "day" : skyMode === "day" ? "night" : "auto"; toolbar.setSky(skyMode[0].toUpperCase() + skyMode.slice(1)); applySky(true) },
  horn: b => poke(b, "horn", "harbor"),
  feed: b => poke(b, "feed", "harbor"),
  sound: () => { const on = !world.horn.sound; world.horn.setSound(on); toolbar.setSound(on) },
  wave: b => { const r = reefs.get(selected); if (r && r.run.orchestrator) poke(b, "wave", r.run.orchestrator.id) },
  fireworks: b => { if (selected) poke(b, "fireworks", selected) },
})

// ---- the sky follows the viewer's clock ----
function hourNow() {
  const h = parseFloat(params.get("hour"))
  if (Number.isFinite(h)) return h
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}
function applySky(snap) {
  if (!world) return
  world.sky.set(skyLook(hourNow(), skyMode, data ? data.stale : false))
  if (snap) world.sky.update(1, world.water)
}

// ---- applying a scene: diff by id, never rebuild ----
function applyScene(s, snap = false) {
  data = s
  overlays.banner(s.stale ? "Harbormaster is not reporting. Showing the last known harbor." : "")
  const ids = s.runs.map(r => r.id)
  slotsPrev = assignSlots(slotsPrev, ids)
  const drawn = s.runs.filter(r => slotsPrev.has(r.id))
  for (const [id, reef] of reefs) if (!slotsPrev.has(id)) { scene.remove(reef.group); reefs.delete(id) }
  for (const r of drawn) {
    let reef = reefs.get(r.id)
    if (!reef) { reef = new Reef(world.assets, r.id, { ...slotPosition(slotsPrev.get(r.id)) }); reefs.set(r.id, reef); scene.add(reef.group) }
    reef.apply(r, snap)
  }
  labels.sync(drawn)
  const hidden = s.runs.length - drawn.length

  const aids = s.adrift.map(a => a.id)
  raftSlotsPrev = assignSlots(raftSlotsPrev, aids, MAX_ADRIFT)
  for (const [id, raft] of rafts) if (!raftSlotsPrev.has(id)) { scene.remove(raft.group); rafts.delete(id) }
  for (const a of s.adrift) {
    const slot = raftSlotsPrev.get(a.id)
    if (slot === undefined) continue
    let raft = rafts.get(a.id)
    if (!raft) { raft = new Raft(kit, a.id, slot); raft.setSlot(slot); raft.home.copy(raft.target); rafts.set(a.id, raft); scene.add(raft.group) }
    else if (raft.slot !== slot) raft.setSlot(slot)
    raft.apply(a, snap)
  }
  const hiddenRafts = s.adrift.length - rafts.size
  const more = []
  if (hidden > 0) more.push(`+${hidden} more run${hidden === 1 ? "" : "s"} not drawn`)
  if (hiddenRafts > 0) more.push(`+${hiddenRafts} more adrift`)
  moreText = more.join(" · "); updateStatus()

  world.boat.setState(s.captain.state)
  if (snap) { world.boat.opacity = captainLook(s.captain.state).opacity }
  world.gulls.setCount(s.viewers)
  beamTargets = drawn.filter(r => reefs.get(r.id)?.look.flare).map(r => Math.atan2(reefs.get(r.id).position.z, reefs.get(r.id).position.x))
  applySky(false)
  if (selected) { if (reefs.has(selected)) card.show(reefs.get(selected).run); else deselect() }
}

// ---- connection ----
let connected = false, moreText = ""
function updateStatus() { overlays.status(connected ? moreText : "reconnecting…") }
function connect() {
  const es = new EventSource("./events")
  es.addEventListener("open", () => { connected = true; updateStatus() })
  es.addEventListener("error", () => { connected = false; updateStatus() })
  es.addEventListener("scene", e => {
    let s; try { s = JSON.parse(e.data) } catch { return }
    if (!world) { pending = s; return }
    if (STILL && firstScene) return
    firstScene = true
    applyScene(s, STILL)
  })
  es.addEventListener("poke", e => { try { onPoke(JSON.parse(e.data)) } catch {} })
}
let pending = null

// ---- pokes: sent on click, played when the event comes back so every viewer sees them ----
async function poke(button, kind, target) {
  try {
    const r = await fetch("./poke", { method: "POST", headers: { "content-type": "application/json", "x-viewer": viewerId }, body: JSON.stringify({ kind, target }) })
    if (r.status === 429) toolbar.dim(button)
  } catch { toolbar.dim(button) }
}
function onPoke(p) {
  if (!world || !p || typeof p.target !== "string") return
  if (p.kind === "horn") { world.boat.horn(time); world.horn.play(time) }
  else if (p.kind === "feed") world.gulls.feed(time)
  else if (p.kind === "wave") { for (const r of reefs.values()) if (r.waveTarget(p.target, time)) return; for (const r of rafts.values()) if (r.waveTarget(p.target, time)) return }
  else if (p.kind === "fireworks") {
    const reef = reefs.get(p.target) || [...reefs.values()].find(r => r.run?.orchestrator?.id === p.target)
    if (reef) world.fireworks.launch(reef.position.x, reef.position.z, time)
  }
}

// ---- camera moves ----
let tween = null, touring = false, tourIndex = 0, tourAt = 0
function flyTo(pos, target, dur = 0.8) {
  tween = { at: time, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone() }
}
const smooth = k => k * k * (3 - 2 * k)
function overview() { deselect(); flyTo(overviewPos(), OVERVIEW.target) }
function select(id, dur = 0.8) {
  const reef = reefs.get(id)
  if (!reef) return
  if (selected && reefs.has(selected)) reefs.get(selected).select(false)
  selected = id; reef.select(true)
  card.show(reef.run); toolbar.setSelected(true)
  const off = camera.position.clone().sub(controls.target); off.y = 0
  if (off.lengthSq() < 1e-4) off.set(1, 0, 1)
  off.normalize().multiplyScalar(14)
  const tgt = new THREE.Vector3(reef.position.x, 2, reef.position.z)
  flyTo(new THREE.Vector3(tgt.x + off.x, 9, tgt.z + off.z), tgt, dur)
}
function deselect() {
  if (selected && reefs.has(selected)) reefs.get(selected).select(false)
  selected = null; card.hide(); toolbar.setSelected(false)
}

// A slow orbit that visits the reefs that need you first, then the rest, 6 s each.
function startTour() {
  const list = tourList()
  if (!list.length) return
  touring = true; tourIndex = 0; tourAt = -Infinity
  controls.autoRotate = true
  toolbar.setTour(true)
}
function stopTour() { if (!touring) return; touring = false; controls.autoRotate = false; toolbar.setTour(false) }
function tourList() {
  const rs = [...reefs.values()].filter(r => r.run)
  return [...rs.filter(r => r.look.flare), ...rs.filter(r => !r.look.flare)].map(r => r.id)
}
function tourStep() {
  if (time - tourAt < 6) return
  const list = tourList()
  if (!list.length) return stopTour()
  select(list[tourIndex++ % list.length], 1.6)
  tourAt = time
}

// ---- input ----
let down = null
canvas.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; tween = null })
canvas.addEventListener("pointerup", e => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || performance.now() - down.t > 500) { down = null; return }
  down = null; click(e.clientX, e.clientY)
})
canvas.addEventListener("wheel", () => { tween = null }, { passive: true })
// Any pointer or key input stops the tour (except on the Tour button itself, which toggles it).
for (const ev of ["pointerdown", "wheel", "keydown"]) window.addEventListener(ev, e => { if (touring && !(e.target instanceof Element && e.target.closest("#toolbar button"))) stopTour() }, { capture: true, passive: true })
window.addEventListener("keydown", e => { if (e.key === "Escape") { stopTour(); overview() } })

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
function click(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  const hit = ray.intersectObjects([...reefs.values()].map(r => r.group), true)[0]
  let o = hit && hit.object
  while (o && !o.userData.reef) o = o.parent
  if (o) { stopTour(); select(o.userData.reef.id) } else { stopTour(); overview() }
}

// ---- labels follow their reefs ----
const proj = new THREE.Vector3()
function placeLabels() {
  const w = window.innerWidth, h = window.innerHeight
  for (const [id, reef] of reefs) {
    proj.set(reef.position.x, 7, reef.position.z).project(camera)
    const d = camera.position.distanceTo(reef.position)
    let a = proj.z > 1 ? 0 : Math.max(0, Math.min(1, (80 - d) / 10))
    const x = (proj.x * 0.5 + 0.5) * w, y = (-proj.y * 0.5 + 0.5) * h
    if (cardRect && x > cardRect.left - 40 && x < cardRect.right + 40 && y > cardRect.top - 20 && y < cardRect.bottom + 40) a = 0
    if (x < -60 || x > w + 60 || y < -40 || y > h + 40) a = 0
    labels.place(id, x, y, a)
  }
}

// ---- the loop ----
const frames = []
let last = 0
function frame(now) {
  if (document.hidden) { last = 0; return }   // no work while hidden; the visibility handler restarts it
  requestAnimationFrame(frame)
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0.016
  last = now
  step(dt)
  renderer.render(scene, camera)
  placeLabels()
  if (STATS) {
    frames.push(dt * 1000); if (frames.length > 120) frames.shift()
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length
    overlays.stats(`${avg.toFixed(1)} ms/frame (${(1000 / avg).toFixed(0)} fps)\n${renderer.info.render.calls} draw calls\n${renderer.info.render.triangles} triangles`)
  }
}
// One tick of the world: time, sky, creatures, effects, camera.
function step(dt) {
  time += dt
  const env = { t: time, dt, camera, motion, night: world.sky.cur.night }
  world.water.setTime(motion ? time : 0)
  world.sky.update(damp(dt, 1.5), world.water)
  world.lighthouse.update(dt, beamTargets, env.night)
  world.boat.update(time, dt, motion)
  world.horn.update(time); world.fireworks.update(time, dt); world.gulls.update(time, motion)
  for (const r of reefs.values()) r.update(env)
  for (const r of rafts.values()) r.update(env)
  for (const l of world.lanterns) l.emissiveIntensity = 1.2 + 1.4 * env.night
  if (touring) tourStep()
  if (tween) {
    const k = Math.min(1, (time - tween.at) / tween.dur), e = smooth(k)
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e)
    if (k >= 1) tween = null
  }
  controls.update()
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && world && !STILL) { last = 0; requestAnimationFrame(frame) } })
window.addEventListener("resize", () => resize())

// ---- start ----
async function main() {
  overlays.status("loading…")
  toolbar.setSky("Auto")
  try { await kit.load() } catch (e) { overlays.status("The models did not load."); return }
  const water = new Water(); scene.add(water.group)
  const sky = new Sky(scene)
  const lighthouse = new Lighthouse(kit); scene.add(lighthouse.root)
  const boat = new Boat(kit); scene.add(boat.group)
  const assets = reefAssets(kit, softTexture())
  world = { water, sky, lighthouse, boat, assets, horn: new Horn(scene), fireworks: new Fireworks(scene), gulls: new Gulls(kit, scene), lanterns: [assets.lanternOn] }
  applySky(true)
  resize(true)
  connect()
  setInterval(() => applySky(false), 20000)
  if (pending) { const s = pending; pending = null; firstScene = true; applyScene(s, STILL) }
  if (STILL) {
    // one settled frame for screenshots, once the first scene is here
    const wait = setInterval(() => {
      if (!firstScene) return
      clearInterval(wait)
      time = 3.1; for (let i = 0; i < 4; i++) step(0.3)
      world.sky.update(1, water)
      renderer.render(scene, camera); placeLabels()
      overlays.status("")
      document.title = "ready"
    }, 50)
    return
  }
  requestAnimationFrame(frame)
}
main()
