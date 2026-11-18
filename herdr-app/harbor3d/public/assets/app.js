// Wiring: the renderer, camera and controls, the event stream, selection, the toolbar, and the loop.
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { Kit, Water, Sky, Port, Tug, softTexture, damp } from "./world.js"
import { Berth, Anchored, Raft, berthAssets } from "./berths.js"
import { Gulls, Bubbles, Fish } from "./effects.js"
import { Labels, Card, Toolbar, overlays, $ } from "./ui.js"
import { createLoop } from "./loop.js"
import { declutterLabels, labelUnderCard, berthPosition, roadsteadPosition, breakwaterWidth, berthFitPoints, anchoredFitPoints, fitView, freeRect, OFFICE } from "./layout.js"
import { skyLook, captainLook } from "./look.js"
import { createFeed } from "./feed.js"

const params = new URLSearchParams(location.search)
const STILL = params.get("still") === "1"
const STATS = params.get("stats") === "1"
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
const OVERVIEW = { pos: new THREE.Vector3(30, 26, 74), target: new THREE.Vector3(0, 3, 4) }

// A random id of 16 hex characters, kept in memory only (never a cookie or storage); the server uses it to rate-limit pokes.
const viewerId = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("")

// ---- renderer, camera, controls ----
const canvas = $("view")
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1400)
camera.position.copy(OVERVIEW.pos)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true; controls.dampingFactor = 0.08
controls.minDistance = 14; controls.maxDistance = 200
controls.maxPolarAngle = Math.PI / 2 - (4 * Math.PI) / 180   // never below 4° above the water
controls.target.copy(OVERVIEW.target)
controls.autoRotateSpeed = 1.6
// ?cam=x,y,z,tx,ty,tz places the camera (for screenshots); ?focus=n selects the nth drawn berth.
const camParam = (params.get("cam") || "").split(",").map(Number)
if (camParam.length === 6 && camParam.every(Number.isFinite)) { camera.position.set(...camParam.slice(0, 3)); controls.target.set(...camParam.slice(3)) }
controls.update()

// The overview camera spot: further out for a wide harbor (many berths) and on a tall (phone) screen, so it all fits.
let harborWidth = 58
const overviewPos = () => {
  const f = Math.max(0.8, Math.min(3, harborWidth / 58)) * Math.min(2.4, Math.max(1, 1 / camera.aspect))
  const off = OVERVIEW.pos.clone().sub(OVERVIEW.target).multiplyScalar(f)
  if (off.length() > 200) off.setLength(200)
  return off.add(OVERVIEW.target)
}
function resize(initial) {
  const w = window.innerWidth, h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h; camera.updateProjectionMatrix()
  if (initial && !params.get("cam")) { camera.position.copy(overviewPos()); controls.update() }
  refreshCardRect()
  // a selected berth is refitted to the new window shape, unless the user has moved the camera since the fly-in
  if (!initial && selected && !camTouched && world) fitSelected(0.3)
}

// ---- state ----
const kit = new Kit()
let world = null          // { water, sky, port, tug, bubbles, fish, gulls, assets }
let data = null           // the latest scene
let firstScene = false
const berths = new Map()  // run id -> Berth (at the quay) or Anchored (parked)
const rafts = new Map()   // adrift id -> Raft
let selected = null       // run id
let skyMode = "auto"      // auto | day | night
let moved = false, focused = false, camTouched = false   // camTouched: the user has dragged or zoomed since the last fly-in
// The card's box on screen, read where it can change (select, deselect, a new card, resize) and used to keep
// labels from lying under it.
const refreshCardRect = () => { cardRect = card.rect() }
let time = 0, motion = reducedQuery.matches ? 0 : 1, cardRect = null
reducedQuery.addEventListener("change", () => { motion = reducedQuery.matches ? 0 : 1 })

const labels = new Labels($("labels"))
const card = new Card($("card"), () => overview())
const toolbar = new Toolbar($("toolbar"), {
  overview: () => { stopTour(); overview() },
  tour: () => (touring ? stopTour() : startTour()),
  sky: () => { skyMode = skyMode === "auto" ? "day" : skyMode === "day" ? "night" : "auto"; toolbar.setSky(skyMode[0].toUpperCase() + skyMode.slice(1)); applySky(true) },
  feed: b => poke(b, "feed", "harbor"),
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
  // The server gives every run its place (`slot`; -1 when there is no room), so every viewer sees the same order.
  const drawn = s.runs.filter(r => !r.parked && r.slot >= 0), anchored = s.runs.filter(r => r.parked && r.slot >= 0)
  const keep = new Set([...drawn, ...anchored].map(r => r.id)), parkedIds = new Set(s.runs.filter(r => r.parked).map(r => r.id))
  for (const [id, e] of berths) if (!keep.has(id) || e instanceof Anchored !== parkedIds.has(id)) { e.dispose(); berths.delete(id); if (selected === id) deselect() }
  const slots = drawn.map(r => r.slot)
  harborWidth = breakwaterWidth(slots)
  world.port.setBerths(slots); world.tug.setWidth(harborWidth)
  for (const r of drawn) {
    let e = berths.get(r.id)
    if (!e) { e = new Berth(world.assets, r.id, berthPosition(r.slot)); berths.set(r.id, e); scene.add(e.group) }
    e.apply(r, snap)
  }
  const roadsteadN = anchored.reduce((n, r) => Math.max(n, r.slot + 1), 0)
  for (const r of anchored) {
    const pos = roadsteadPosition(r.slot, roadsteadN)
    let e = berths.get(r.id)
    if (!e) { e = new Anchored(world.assets, r.id, pos); berths.set(r.id, e); scene.add(e.group) }
    e.place(pos); e.apply(r, snap)
  }
  const shown = [...drawn, ...anchored]
  labels.sync(shown)
  const hidden = s.runs.length - shown.length

  const raftSlots = new Map(s.adrift.filter(a => a.slot >= 0).map(a => [a.id, a.slot]))
  for (const [id, raft] of rafts) if (!raftSlots.has(id)) { raft.dispose(); rafts.delete(id) }
  for (const a of s.adrift) {
    const slot = raftSlots.get(a.id)
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

  world.tug.setState(s.captain.state)
  if (snap) world.tug.opacity = captainLook(s.captain.state).opacity
  world.gulls.setCount(s.viewers)
  world.gulls.setPerches(perchPoints())
  world.fish.setWidth(harborWidth)
  applySky(false)
  if (!moved && !selected && !params.get("cam")) { camera.position.copy(overviewPos()); controls.update() }
  if (!focused && params.get("focus") !== null && shown[+params.get("focus")]) { focused = true; select(shown[+params.get("focus")].id, 0.01) }
  if (selected) { if (berths.has(selected)) { card.show(berths.get(selected).run); refreshCardRect() } else deselect() }
}

// ---- connection ----
let connected = false, moreText = ""
function updateStatus() { overlays.status(connected ? moreText : "reconnecting…") }
let transport = "sse"
// The feed tries the event stream first and long-polls where a proxy buffers it (see feed.js).
const feed = createFeed({
  openEvents: h => {
    const es = new EventSource("./events")
    es.addEventListener("open", () => h.open())
    es.addEventListener("error", () => h.error(es.readyState === EventSource.CLOSED))
    es.addEventListener("scene", e => { try { h.scene(JSON.parse(e.data)) } catch {} })
    es.addEventListener("poke", e => { try { h.poke(JSON.parse(e.data)) } catch {} })
    return es
  },
  poll: async after => {
    const r = await fetch(`./poll?after=${after}`, { headers: { "x-viewer": viewerId }, cache: "no-store" })
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  },
  now: Date.now,
  setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) },
  onScene: s => {
    if (!world) { pending = s; return }
    if (STILL && firstScene) return
    firstScene = true
    applyScene(s, STILL)
  },
  onPoke: p => onPoke(p),
  onState: (t, ok) => { transport = t; connected = ok; updateStatus() },
})
const connect = () => feed.start()
let pending = null

// ---- pokes: sent on click, played when the event comes back so every viewer sees them ----
async function poke(button, kind, target) {
  try {
    const r = await fetch("./poke", { method: "POST", headers: { "content-type": "application/json", "x-viewer": viewerId }, body: JSON.stringify({ kind, target }) })
    if (r.status === 429 && button) toolbar.dim(button)
    return r.status
  } catch { if (button) toolbar.dim(button); return 0 }
}
function onPoke(p) {
  if (!world || !p || typeof p.target !== "string") return
  if (p.kind === "feed") world.gulls.feed(time)
  else if (p.kind === "wave" && p.target === "captain") world.tug.wave(time)
  else if (p.kind === "wave") {
    const e = [...berths.values(), ...rafts.values()].find(r => r.waveTarget(p.target, time))
    // on the page that petted it, three bubbles rise from the creature
    if (e && petted.get(p.target) > performance.now() - 4000 && e.creaturePoint(p.target, proj)) { petted.delete(p.target); world.bubbles.emit(proj.x, proj.y, proj.z, time) }
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
  const e = berths.get(id)
  if (!e) return
  if (selected && berths.has(selected)) berths.get(selected).select(false)
  selected = id; e.select(true)
  card.show(e.run); refreshCardRect()
  fitSelected(dur)
}
// The view that shows the whole selected berth (or the anchored ship) in the part of the window the card and toolbar leave free.
const FOV = 50
function fitCamera(e) {
  const o = e.group.position, scale = e.ship.goalScale
  const pts = e instanceof Anchored ? anchoredFitPoints(o, scale) : berthFitPoints(o, scale)
  const w = window.innerWidth, h = window.innerHeight
  const free = freeRect(w, h, card.rect(), $("toolbar").getBoundingClientRect())
  const v = fitView(pts, { fov: (FOV * Math.PI) / 180, aspect: w / h, free })
  return { pos: new THREE.Vector3(...v.position), target: new THREE.Vector3(...v.target), distance: v.distance }
}
function fitSelected(dur) {
  const e = berths.get(selected)
  if (!e) return
  const v = fitCamera(e)
  controls.maxDistance = Math.max(200, v.distance * 1.5)
  camTouched = false
  flyTo(v.pos, v.target, dur)
}
function deselect() {
  if (selected && berths.has(selected)) berths.get(selected).select(false)
  selected = null; card.hide(); refreshCardRect()
}

// A slow orbit that visits the berths that need you first, then the rest, 6 s each.
function startTour() {
  const list = tourList()
  if (!list.length) return
  touring = true; tourIndex = 0; tourAt = -Infinity
  controls.autoRotate = true
  toolbar.setTour(true)
}
function stopTour() { if (!touring) return; touring = false; controls.autoRotate = false; toolbar.setTour(false) }
function tourList() {
  const rs = [...berths.values()].filter(r => r.run), red = r => r.look.signal.lamp === "red" || (r.run.needsYou && r.look.parked)
  return [...rs.filter(red), ...rs.filter(r => !red(r))].map(r => r.id)
}
function tourStep() {
  if (time - tourAt < 6) return
  const list = tourList()
  if (!list.length) return stopTour()
  select(list[tourIndex++ % list.length], 1.6)
  tourAt = time
}

// ---- input ----
const petted = new Map()   // scene id -> when this page petted it (bubbles rise when the poke comes back)
let down = null
canvas.addEventListener("pointerdown", e => { moved = true; if (!e.isPrimary) camTouched = true   // a second finger is a pinch
  down = { x: e.clientX, y: e.clientY, t: performance.now() }; if (tween) camTouched = true; tween = null })
canvas.addEventListener("pointerup", e => {
  if (!down) return
  const far = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5
  if (far) camTouched = true   // a drag moved the camera
  if (far || performance.now() - down.t > 500) { down = null; return }
  down = null; click(e.clientX, e.clientY)
})
canvas.addEventListener("wheel", () => { camTouched = true; tween = null }, { passive: true })
// Any pointer or key input stops the tour (except on the Tour button itself, which toggles it).
for (const ev of ["pointerdown", "wheel", "keydown"]) window.addEventListener(ev, e => { if (touring && !(e.target instanceof Element && e.target.closest("#toolbar button"))) stopTour() }, { capture: true, passive: true })
window.addEventListener("keydown", e => { if (e.key === "Escape") { stopTour(); overview() } })

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
// The nearest thing under a screen point: { berth, pet } (a berth, and the scene id of the octopus or crab hit, if it was one), or
// { raft, pet } for a crab on a raft, { tug } for the captain's tug, or null. The creature is told apart first, so the octopus and crabs are petted rather than just selected.
function pick(x, y) {
  if (!world) return null
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  const hit = ray.intersectObjects([...[...berths.values()].map(r => r.group), ...[...rafts.values()].map(r => r.group), world.tug.group], true)[0]
  let o = hit && hit.object, pet = null
  while (o) {
    if (pet === null && typeof o.userData.petId === "string") pet = o.userData.petId
    if (o.userData.berth) return { berth: o.userData.berth, pet }
    if (o.userData.raft) return { raft: o.userData.raft, pet }
    if (o.userData.tug) return { tug: o.userData.tug, pet }
    o = o.parent
  }
  return null
}
function click(x, y) {
  const h = pick(x, y)
  stopTour()
  // the tug: wave at the captain (only when he is aboard); it neither selects nor moves the camera
  if (h && h.tug) { if (h.tug.aboard) poke(null, "wave", "captain"); return }
  if (h && h.pet) { petted.set(h.pet, performance.now()); poke(null, "wave", h.pet).then(st => { if (st !== 204) petted.delete(h.pet) }) }
  // a berth that is already selected keeps the view the user chose; only another berth is flown to
  if (h && h.berth) { if (h.berth.id !== selected) select(h.berth.id) } else if (!h || !h.pet) overview()
}
// A pointer cursor over anything that can be petted (and the tug, while the captain is aboard) (mouse only; checked at most once a frame).
let hoverAt = null, hoverBusy = false
canvas.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse" || e.buttons) return
  hoverAt = { x: e.clientX, y: e.clientY }
  if (hoverBusy) return
  hoverBusy = true
  requestAnimationFrame(() => { hoverBusy = false; const h = hoverAt && pick(hoverAt.x, hoverAt.y); canvas.style.cursor = h && (h.pet || (h.tug && h.tug.aboard)) ? "pointer" : "" })
})
canvas.addEventListener("pointerleave", () => { hoverAt = null; canvas.style.cursor = "" })
// The tops of the cranes and the office roof, where gulls land between flights.
const OFFICE_ROOF = { x: OFFICE.x - 2.8, y: OFFICE.y + 10.5, z: OFFICE.z }
const perchPoints = () => [...[...berths.values()].filter(e => e.perchPoint && !e.look.parked), OFFICE_ROOF]

// ---- labels float above each ship's mast ----
const proj = new THREE.Vector3()
function placeLabels() {
  const w = window.innerWidth, h = window.innerHeight, items = []
  for (const [id, e] of berths) {
    e.labelPoint(proj)
    const d = camera.position.distanceTo(proj)
    proj.project(camera)
    let a = proj.z > 1 ? 0 : Math.max(0, Math.min(1, (330 - d) / 30))
    const x = (proj.x * 0.5 + 0.5) * w, y = (-proj.y * 0.5 + 0.5) * h
    if (x < -60 || x > w + 60 || y < -40 || y > h + 40) a = 0
    items.push({ id, x, y, a, ...labels.size(id) })
  }
  const byId = new Map(items.map(i => [i.id, i]))
  for (const l of declutterLabels(items)) {
    const box = byId.get(l.id)
    labels.place(l.id, l.x, l.y, labelUnderCard({ x: l.x, y: l.y, w: box.w, h: box.h }, cardRect) ? 0 : l.a, l.anchorY)
  }
}

// ---- the loop ----
const frames = []
let last = 0
function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0.016
  last = now
  step(dt)
  renderer.render(scene, camera)
  placeLabels()
  if (STATS) {
    frames.push(dt * 1000); if (frames.length > 120) frames.shift()
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length
    overlays.stats(`${avg.toFixed(1)} ms/frame (${(1000 / avg).toFixed(0)} fps)\n${renderer.info.render.calls} draw calls\n${renderer.info.render.triangles} triangles\n${transport}`)
  }
}
// One tick of the world: time, sky, creatures, effects, camera.
function step(dt) {
  time += dt
  const env = { t: time, dt, camera, motion, night: world.sky.cur.night }
  world.water.setTime(motion ? time : 0)
  world.sky.update(damp(dt, 1.5), world.water)
  world.port.update(time, env.night, motion)
  world.tug.update(time, dt, motion, env.night, camera.position)
  const glow = 1.4 + 1.6 * env.night
  for (const l of Object.values(world.assets.signal)) l.on.emissiveIntensity = glow
  world.assets.shipOn.emissiveIntensity = 1 + 1.4 * env.night
  world.bubbles.update(time); world.fish.update(time, motion); world.gulls.update(time, motion, dt)
  for (const r of berths.values()) r.update(env)
  for (const r of rafts.values()) r.update(env)
  if (touring) tourStep()
  if (tween) {
    const k = Math.min(1, (time - tween.at) / tween.dur), e = smooth(k)
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e)
    if (k >= 1) tween = null
  }
  controls.update()
}
// One loop handle: hiding the page cancels the queued frame, showing it starts a new one only if none is queued.
const loop = createLoop(cb => requestAnimationFrame(cb), h => cancelAnimationFrame(h), frame)
document.addEventListener("visibilitychange", () => { feed.setHidden(document.hidden); if (document.hidden) loop.stop(); else if (world && !STILL) { last = 0; loop.start() } })
window.addEventListener("resize", () => resize())

// ---- start ----
async function main() {
  overlays.status("loading…")
  toolbar.setSky("Auto")
  try { await kit.load() } catch (e) { overlays.status("The models did not load."); return }
  const water = new Water(); scene.add(water.group)
  const sky = new Sky(scene)
  const port = new Port(kit, scene), tug = new Tug(kit, scene)
  const assets = berthAssets(kit, softTexture())
  world = { water, sky, port, tug, assets, bubbles: new Bubbles(scene, assets.softTex), fish: new Fish(scene), gulls: new Gulls(kit, scene) }
  port.setBerths([])
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
  loop.start()
}
main()
