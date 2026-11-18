// The harbor itself, apart from the runs: the model kit (load once, clone, recolour through a cache),
// water, sky and light, the land with the quay, office, warehouses, floodlights and breakwater, and the tug.
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { TUG_MOORED, OFFICE, WAREHOUSES, SILO, QUAY_Z, QUAY_TOP, SLOT_W, quaySegments, floodlightPositions, breakwaterWidth, rockPositions, markerPositions, buoyPositions, clutterStacks, tugPosition, offsetRange } from "./layout.js"
import { captainLook } from "./look.js"

export const MODEL_NAMES = ["octopus", "crab", "gull", "buoy", "flag", "driftwood", "ship", "container", "crane", "pier", "quay", "signal", "tug", "office", "warehouse", "silo", "floodlight", "marker", "rock"]
const TAU = Math.PI * 2
const MOON = new THREE.Color("#6f86c0")
const DEEP = { day: new THREE.Color("#1d5f8f"), night: new THREE.Color("#081a33"), grey: new THREE.Color("#4f6a7c") }
const SHALLOW = { day: new THREE.Color("#3f9acb"), night: new THREE.Color("#12335c"), grey: new THREE.Color("#7f98a8") }
const C = { deep: new THREE.Color(), shallow: new THREE.Color() }

// The same two summed sines as the water's vertex shader, so floating things ride the waves (never read from the GPU).
export const waveHeight = (x, z, t) => 0.18 * Math.sin(x * 0.22 + t * 0.9) + 0.12 * Math.sin(z * 0.31 - t * 0.7 + x * 0.08)
export const damp = (dt, rate) => 1 - Math.exp(-dt * rate)

// glTF node names lose their dots on load ("Tentacle.0" is "Tentacle0"); look a part up by its model name.
export const part = (root, name) => root.getObjectByName(name.replace(/[.\[\]:/]/g, ""))

// Models: loaded once, cloned per use (geometry and materials shared). Recoloured and see-through
// variants of a material come from caches keyed by colour and opacity, never one per object or frame.
export class Kit {
  constructor() { this.models = new Map(); this.colorMats = new Map(); this.opacityMats = new Map() }
  async load(base = "./assets/models/") {
    const loader = new GLTFLoader()
    await Promise.all(MODEL_NAMES.map(async n => { this.models.set(n, (await loader.loadAsync(`${base}${n}.glb`)).scene) }))
  }
  // A clone of a model. Each mesh remembers its source material and the one it should show at full opacity.
  make(name) {
    const o = this.models.get(name).clone(true)
    o.traverse(m => { if (m.isMesh) { m.userData.src = m.material; m.userData.mat = m.material; m.userData.op = 1 } })
    return o
  }
  // The source material in another colour (cached by colour).
  colored(mat, hex) {
    const key = `${mat.uuid}${hex}`
    let m = this.colorMats.get(key)
    if (!m) { m = mat.clone(); m.color.set(hex); this.colorMats.set(key, m) }
    return m
  }
  // The material at an opacity (cached by opacity, rounded to 2 places).
  faded(mat, op) {
    const key = `${mat.uuid}${op.toFixed(2)}`
    let m = this.opacityMats.get(key)
    if (!m) { m = mat.clone(); m.transparent = true; m.opacity = op; this.opacityMats.set(key, m) }
    return m
  }
  show(mesh) { mesh.material = mesh.userData.op >= 1 ? mesh.userData.mat : this.faded(mesh.userData.mat, mesh.userData.op) }
  // Give a mesh a material (keeps its opacity).
  setMat(mesh, mat) { mesh.userData.mat = mat; this.show(mesh) }
  paint(mesh, hex) { this.setMat(mesh, this.colored(mesh.userData.src, hex)) }
  // Opacity for every mesh under `root` (1 = opaque).
  fade(root, op) { root.traverse(m => { if (m.isMesh && m.userData.op !== undefined && m.userData.op !== op) { m.userData.op = op; this.show(m) } }) }
  meshes(root, name) { const out = []; root.traverse(m => { if (m.isMesh && m.userData.src && m.userData.src.name === name) out.push(m) }); return out }
}

// A soft round sprite texture (white centre fading out), drawn once on a canvas.
export function softTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64
  const g = c.getContext("2d"), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.35, "rgba(255,255,255,0.55)"); grad.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

const VERT = `
uniform float uTime; varying vec3 vPos; varying float vH; varying float vD;
void main() {
  vec3 p = position;
  float h = 0.18 * sin(p.x * 0.22 + uTime * 0.9) + 0.12 * sin(p.z * 0.31 - uTime * 0.7 + p.x * 0.08);
  p.y = h; vPos = p; vH = h; vD = length(p.xz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`
const FRAG = `
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uSun; uniform float uLight;
varying vec3 vPos; varying float vH; varying float vD;
void main() {
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (n.y < 0.0) n = -n;
  vec3 col = mix(uDeep, uShallow, smoothstep(-0.25, 0.3, vH));
  col *= (0.78 + 0.22 * max(dot(n, uSun), 0.0)) * uLight;
  col = mix(col, uSky, smoothstep(190.0, 320.0, vD));
  gl_FragColor = vec4(col, mix(0.86, 1.0, smoothstep(190.0, 320.0, vD)));
  #include <colorspace_fragment>
}`

// The sea (one plane, waves in the vertex shader, flat-shaded in the fragment shader) over a dark seabed
// so that things below the surface (the lowered anchor) show through.
export class Water {
  constructor() {
    const geo = new THREE.PlaneGeometry(760, 760, 150, 150); geo.rotateX(-Math.PI / 2)
    this.uniforms = { uTime: { value: 0 }, uDeep: { value: new THREE.Color("#1d5f8f") }, uShallow: { value: new THREE.Color("#3f9acb") }, uSky: { value: new THREE.Color("#9fd2f0") }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uLight: { value: 1 } }
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false }))
    this.mesh.renderOrder = -1
    this.bed = new THREE.Mesh(new THREE.PlaneGeometry(760, 760).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#1d5f8f" }))
    this.bed.position.y = -4
    this.group = new THREE.Group(); this.group.add(this.bed, this.mesh)
  }
  setTime(t) { this.uniforms.uTime.value = t }
}

// Sky colour, stars, the sun and the hemisphere light. `set(look)` gives the target, `update` eases to it.
export class Sky {
  constructor(scene) {
    this.scene = scene
    this.sun = new THREE.DirectionalLight("#ffffff", 2); this.sun.position.set(0, 80, 0); this.sun.castShadow = false
    this.hemi = new THREE.HemisphereLight("#9fd2f0", "#6f8fa8", 1)
    scene.add(this.sun, this.sun.target, this.hemi)
    scene.background = new THREE.Color("#9fd2f0")
    scene.fog = new THREE.Fog("#9fd2f0", 200, 620)
    const n = 220, pos = new Float32Array(n * 3)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < n; i++) { const a = rnd() * TAU, e = 0.12 + rnd() * 1.2, r = 500; pos[i * 3] = Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: "#ffffff", size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }))
    this.stars.frustumCulled = false
    scene.add(this.stars)
    this.target = null
    this.cur = { sky: new THREE.Color("#9fd2f0"), ground: new THREE.Color("#6f8fa8"), sun: new THREE.Color("#fff4dc"), sunI: 2.2, hemiI: 1.1, night: 0, grey: 0, dir: new THREE.Vector3(0, 1, 0) }
    this.tmp = { sky: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Color(), dir: new THREE.Vector3() }
  }
  set(look) {
    this.target = look
    this.tmp.sky.set(look.sky); this.tmp.ground.set(look.ground); this.tmp.sun.set(look.sun); this.tmp.dir.set(...look.sunDir)
  }
  // Ease towards the target (k = 1 snaps).
  update(k, water) {
    const c = this.cur, t = this.target, tmp = this.tmp
    if (!t) return
    c.sky.lerp(tmp.sky, k); c.ground.lerp(tmp.ground, k); c.sun.lerp(tmp.sun, k); c.dir.lerp(tmp.dir, k)
    c.sunI += (t.sunIntensity - c.sunI) * k; c.hemiI += (t.hemiIntensity - c.hemiI) * k; c.night += (t.night - c.night) * k; c.grey += (t.grey - c.grey) * k
    this.scene.background.copy(c.sky); this.scene.fog.color.copy(c.sky)
    this.hemi.color.copy(c.sky).lerp(MOON, c.night * 0.7); this.hemi.groundColor.copy(c.ground).lerp(MOON, c.night * 0.4); this.hemi.intensity = c.hemiI
    this.sun.color.copy(c.sun); this.sun.intensity = c.sunI
    this.sun.position.copy(c.dir).normalize().multiplyScalar(100)
    this.stars.material.opacity = Math.max(0, (c.night - 0.5) * 2)
    const u = water.uniforms, nt = c.night, g = c.grey
    const deep = C.deep.copy(DEEP.day).lerp(DEEP.night, nt).lerp(DEEP.grey, g * 0.8)
    const shallow = C.shallow.copy(SHALLOW.day).lerp(SHALLOW.night, nt).lerp(SHALLOW.grey, g * 0.8)
    // stale: fog closes in over the whole harbour
    const stale = Math.min(1, g / 0.45)
    this.scene.fog.near = 200 - 160 * stale; this.scene.fog.far = 620 - 400 * stale
    u.uDeep.value.copy(deep); u.uShallow.value.copy(shallow); u.uSky.value.copy(c.sky); u.uSun.value.copy(c.dir).normalize()
    u.uLight.value = 1 - 0.1 * g
    water.bed.material.color.copy(deep).multiplyScalar(0.7)
  }
}

// Instanced copies of one named part of a model (one InstancedMesh per material), in a group.
// `items`: [{ x, y, z, rot, scale }]. Colours per instance, when given, multiply the material colour.
export function instanced(kit, model, partName, items, colors) {
  const group = new THREE.Group()
  const d = new THREE.Object3D(), c = new THREE.Color()
  part(kit.make(model), partName).traverse(mesh => {
    if (!mesh.isMesh) return
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.userData.mat, Math.max(items.length, 1))
    items.forEach((it, i) => {
      d.position.set(it.x, it.y, it.z); d.rotation.set(0, it.rot || 0, 0); d.scale.setScalar(it.scale || 1); d.updateMatrix()
      im.setMatrixAt(i, d.matrix)
      if (colors) im.setColorAt(i, c.set(colors[i % colors.length]))
    })
    im.count = items.length; im.instanceMatrix.needsUpdate = true; im.raycast = () => {}
    group.add(im)
  })
  return group
}

const WING = 60
const LANE_GEO = new THREE.BoxGeometry(1, 0.03, 1)

// Rock revetment: two stepped rows (a high inner one, a low outer one) down the land's front wall beyond the quay
// and down each end of the land. Deterministic.
function revetment(x0, x1, lx0, lx1) {
  const out = []
  let seed = 5
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const rock = (x, y, z, sc) => out.push({ x: x + (rnd() - 0.5) * 0.8, y, z: z + (rnd() - 0.5) * 0.8, rot: rnd() * TAU, scale: sc * (0.9 + rnd() * 0.3) })
  for (const [a, b] of [[lx0, x0], [x1, lx1]]) for (let x = a; x <= b; x += 3.4) { rock(x, 0.45, QUAY_Z - 0.9, 1.5); rock(x, -0.55, QUAY_Z + 1.4, 1.15) }
  for (const [x, dir] of [[lx0, -1], [lx1, 1]]) for (let z = QUAY_Z; z > QUAY_Z - 150; z -= 3.6) { rock(x + dir * 0.6, 0.5, z, 1.6); rock(x + dir * 3, -0.5, z, 1.2) }
  return out
}

// A low skyline: 12 simple grey boxes far behind the quay, 3 to 11 m tall (deterministic).
function skyline() {
  const g = new THREE.Group(), geo = new THREE.BoxGeometry(1, 1, 1)
  const greys = ["#7d868c", "#98a1a6", "#6f787e", "#a6adb1"]
  const spec = [[-84, -96, 14, 20, 12], [-66, -78, 10, 8, 9], [-52, -110, 18, 22, 14], [-30, -88, 12, 12, 10], [-12, -104, 16, 16, 12], [8, -72, 12, 6, 10], [24, -100, 20, 20, 14], [44, -80, 10, 10, 8], [58, -108, 16, 18, 12], [74, -74, 12, 7, 10], [86, -92, 14, 14, 12], [-2, -112, 10, 9, 8]]
  spec.forEach(([x, z, w, h, d], i) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: greys[i % greys.length], roughness: 1, flatShading: true }))
    m.scale.set(w, h * 0.5, d); m.position.set(x, QUAY_TOP - 0.05 + h / 4, z); m.raycast = () => {}; g.add(m)
  })
  return g
}

const GREY_STACKS = ["#ffffff", "#e6e9ec", "#cfd5da", "#f2f4f5"]

// The land and everything on it that is not a run: land box, quay segments, the harbour office with its
// radar, warehouses, silos, floodlights, yard clutter, the breakwater, entrance markers and fairway buoys.
// `setBerths(slots)` rebuilds what depends on how wide the harbour is, only when that changes.
export class Port {
  constructor(kit, scene) {
    this.kit = kit; this.scene = scene
    this.key = null
    this.landMat = new THREE.MeshStandardMaterial({ color: "#8b9398", roughness: 1, flatShading: true })
    this.fixed = new THREE.Group()
    const place = (name, p, rot = 0) => { const o = kit.make(name); o.position.set(p.x, p.y, p.z); o.rotation.y = rot; this.fixed.add(o); return o }
    this.office = place("office", OFFICE)
    this.radar = part(this.office, "Radar")
    this.officeLights = kit.meshes(this.office, "OfficeLights").map(m => m.userData.src)[0]
    for (const w of WAREHOUSES) place("warehouse", w)
    place("silo", SILO)
    // clutter: a few grey container stacks behind the quay, in fixed spots
    const stacks = []
    for (const s of clutterStacks()) for (let c = 0; c < s.cols; c++) for (let t = 0; t < s.tiers; t++) stacks.push({ x: s.x + c * 2.6, y: QUAY_TOP + t * 1.1, z: s.z, rot: 0 })
    const clutter = instanced(kit, "container", "Body", stacks, GREY_STACKS)
    this.fixed.add(clutter)
    // a low skyline far behind the quay and two more silos and warehouses, so the horizon is not empty
    this.fixed.add(skyline())
    for (const [m, x, z, r] of [["silo", 30, -80, 0], ["silo", -72, -95, 0.4], ["warehouse", 62, -90, 0.2], ["warehouse", -46, -105, 0]]) place(m, { x, y: QUAY_TOP - 0.05, z }, r)
    this.lineMat = new THREE.MeshStandardMaterial({ color: "#e8c547", roughness: 1 })
    this.dyn = new THREE.Group()   // quay, floodlights, rocks, markers: rebuilt with the width
    scene.add(this.fixed, this.dyn)
    this.lampMats = []; this.markers = []; this.buoys = []; this.glows = []
    this.glowMat = new THREE.SpriteMaterial({ map: softTexture(), color: "#ffd9a0", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    // fairway buoys: decor
    for (const b of buoyPositions()) {
      const o = kit.make("buoy"); o.position.set(b.x, 0, b.z)
      kit.meshes(o, "BuoyColor").forEach(m => kit.paint(m, b.color === "red" ? "#d4553e" : "#3fa66b"))
      this.fixed.add(o); this.buoys.push({ o, x: b.x, z: b.z })
    }
  }
  // Rebuild the width-dependent parts for the slots in use (a no-op when the width and offsets are the same).
  setBerths(slots) {
    const { lo, hi } = offsetRange(slots), key = `${lo},${hi}`
    if (key === this.key) return
    this.key = key
    for (const c of [...this.dyn.children]) { this.dyn.remove(c); c.traverse(o => { if (o.isInstancedMesh) o.dispose() }) }
    for (const m of this.markers) m.mat.dispose()
    const k = this.kit
    const segs = quaySegments(slots), x0 = segs[0] - SLOT_W / 2, x1 = segs[segs.length - 1] + SLOT_W / 2
    for (const x of segs) { const q = k.make("quay"); q.position.set(x, 0, QUAY_Z); this.dyn.add(q) }
    // the land: concrete grey, ending 60 m beyond the quay on each side in a stepped rock revetment
    const lx0 = x0 - WING, lx1 = x1 + WING
    const land = new THREE.Mesh(new THREE.BoxGeometry(lx1 - lx0, 4.15, 400), this.landMat)
    land.position.set((lx0 + lx1) / 2, 1.15 - 4.15 / 2, QUAY_Z - 0.3 - 200); land.raycast = () => {}
    this.dyn.add(land)
    this.dyn.add(instanced(k, "rock", "Body", revetment(x0, x1, lx0, lx1)))
    // painted yard lanes on the quay between the container yards, and one across behind them
    const lane = (x, z, w, d) => { const m = new THREE.Mesh(LANE_GEO, this.lineMat); m.position.set(x, QUAY_TOP + 0.015, z); m.scale.set(w, 1, d); m.raycast = () => {}; this.dyn.add(m) }
    for (let x = x0; x <= x1; x += SLOT_W) lane(x, QUAY_Z - 7, 0.3, 12)
    lane((x0 + x1) / 2, QUAY_Z - 11, x1 - x0, 0.3)
    this.lampMats = []
    this.glows = []
    for (const p of floodlightPositions(slots)) {
      const f = k.make("floodlight"); f.position.set(p.x, p.y, p.z); this.dyn.add(f); for (const m of k.meshes(f, "lamp")) this.lampMats.push(m.userData.src)
      const g = new THREE.Sprite(this.glowMat); g.position.set(p.x, p.y + 11, p.z + 1); g.scale.setScalar(9); g.raycast = () => {}; this.dyn.add(g); this.glows.push(g)
    }
    this.dyn.add(instanced(k, "rock", "Body", rockPositions(breakwaterWidth(slots)).map(r => ({ ...r, y: r.y - 0.5 }))))
    this.markers = []
    for (const m of markerPositions()) {
      const o = k.make("marker"); o.position.set(m.x, 0, m.z)
      const hex = m.color === "red" ? "#d4553e" : "#3fa66b"
      k.meshes(o, "MarkerColor").forEach(d => k.paint(d, hex))
      const lamp = k.meshes(o, "lamp")[0]
      const mat = lamp.userData.src.clone(); mat.color.set(hex); mat.emissive.set(hex); k.setMat(lamp, mat)
      this.markers.push({ mat, ph: m.color === "red" ? 0 : Math.PI })
      this.dyn.add(o)
    }
  }
  update(t, night, motion) {
    this.radar.rotation.y = t * 1.2 * motion
    if (this.officeLights) this.officeLights.emissiveIntensity = 0.3 + 1.6 * night
    for (const m of this.lampMats) m.emissiveIntensity = 0.2 + 2.2 * night
    this.glowMat.opacity = 0.75 * night
    for (const m of this.markers) m.mat.emissiveIntensity = 0.4 + night * (1.2 + 1.6 * (Math.sin(t * 3 + m.ph) > 0 ? 1 : 0))
    for (const b of this.buoys) { b.o.position.y = waveHeight(b.x, b.z, t * motion) * 0.9 + Math.sin(t * 2.4 + b.x) * 0.03 * motion }
  }
}

// The captain's tug: moored alongside the quay (dim when there is no captain) or patrolling the basin
// on an ellipse, with a small wake.
export class Tug {
  constructor(kit, scene) {
    this.kit = kit
    this.group = new THREE.Group(); this.group.position.set(TUG_MOORED.x, 0, TUG_MOORED.z); this.group.rotation.y = TUG_MOORED.angle
    this.model = kit.make("tug"); this.group.add(this.model)
    this.lamp = kit.meshes(this.model, "lamp")[0]
    this.lampMat = this.lamp.userData.src.clone(); kit.setMat(this.lamp, this.lampMat)
    const wake = new THREE.BufferGeometry()
    wake.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1.4, 0, -3.2, 1.4, 0, -3.2, 0, 0, -9]), 3))
    wake.setIndex([0, 1, 2])
    this.wake = new THREE.Mesh(wake, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }))
    this.wake.position.y = 0.1; this.wake.visible = false; this.wake.raycast = () => {}
    this.group.add(this.wake)
    scene.add(this.group)
    this.look = captainLook("none"); this.opacity = 0.4; this.lap = 0; this.W = 36; this.lurchAt = -10
    this.pos = new THREE.Vector3(TUG_MOORED.x, 0, TUG_MOORED.z); this.angle = TUG_MOORED.angle
    kit.fade(this.model, 0.4)
  }
  setState(state) { this.look = captainLook(state) }
  setWidth(W) { this.W = W }
  horn(t) { this.lurchAt = t }
  // Where the horn's ring starts: the tug, or the quay in front of the office when there is no captain.
  hornPoint(state) { return state === "none" ? { x: 0, z: QUAY_Z } : { x: this.pos.x, z: this.pos.z } }
  update(t, dt, motion, night) {
    const l = this.look
    let tx = TUG_MOORED.x, tz = TUG_MOORED.z, ta = TUG_MOORED.angle
    if (l.patrol) { this.lap += (dt * motion) / l.period; const p = tugPosition(this.lap * l.period, l.period, this.W); tx = p.x; tz = p.z; ta = p.angle }
    const k = damp(dt, l.patrol ? 3 : 1.2)
    this.pos.x += (tx - this.pos.x) * k; this.pos.z += (tz - this.pos.z) * k
    let da = ta - this.angle; da = Math.atan2(Math.sin(da), Math.cos(da)); this.angle += da * k
    const lt = t - this.lurchAt, lurch = lt >= 0 && lt < 1.2 ? Math.exp(-lt * 3) : 0
    this.group.position.set(this.pos.x, waveHeight(this.pos.x, this.pos.z, t * motion) * 0.6 - 0.1 - lurch * 0.1 * Math.sin(lt * 9), this.pos.z)
    this.group.rotation.set(Math.cos(t * 0.8) * 0.02 * motion, this.angle, Math.sin(t * 0.9) * 0.03 * motion + lurch * 0.1 * Math.sin(lt * 11))
    this.wake.visible = l.patrol
    this.lampMat.emissiveIntensity = 0.6 + 1.6 * night
    if (Math.abs(this.opacity - l.opacity) > 0.01) { this.opacity += (l.opacity - this.opacity) * damp(dt, 3); this.kit.fade(this.model, Math.abs(this.opacity - 1) < 0.02 ? 1 : Math.round(this.opacity * 20) / 20) }
  }
}
