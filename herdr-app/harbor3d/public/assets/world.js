// The harbor itself, apart from the runs: the model kit (load once, clone, recolour through a cache),
// water, sky and lights, the lighthouse with its beam, and the captain's boat.
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { BOAT } from "./layout.js"
import { captainLook, stepBeam } from "./look.js"

export const MODEL_NAMES = ["octopus", "crab", "boat", "reef", "dock", "buoy", "flagpole", "flag", "lighthouse", "gull", "palm", "crane", "driftwood"]
const TAU = Math.PI * 2

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
  col = mix(col, uSky, smoothstep(70.0, 115.0, vD));
  gl_FragColor = vec4(col, mix(0.86, 1.0, smoothstep(70.0, 115.0, vD)));
  #include <colorspace_fragment>
}`

// The sea (one plane, waves in the vertex shader, flat-shaded in the fragment shader) over a dark seabed
// so that things below the surface (the lowered anchor) show through.
export class Water {
  constructor() {
    const geo = new THREE.PlaneGeometry(240, 240, 64, 64); geo.rotateX(-Math.PI / 2)
    this.uniforms = { uTime: { value: 0 }, uDeep: { value: new THREE.Color("#1d5f8f") }, uShallow: { value: new THREE.Color("#3f9acb") }, uSky: { value: new THREE.Color("#9fd2f0") }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uLight: { value: 1 } }
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false }))
    this.mesh.renderOrder = -1
    this.bed = new THREE.Mesh(new THREE.PlaneGeometry(240, 240).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#1d5f8f" }))
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
    const n = 220, pos = new Float32Array(n * 3)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < n; i++) { const a = rnd() * TAU, e = 0.12 + rnd() * 1.2, r = 150; pos[i * 3] = Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r }
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
    this.scene.background.copy(c.sky)
    this.hemi.color.copy(c.sky); this.hemi.groundColor.copy(c.ground); this.hemi.intensity = c.hemiI
    this.sun.color.copy(c.sun); this.sun.intensity = c.sunI
    this.sun.position.copy(c.dir).normalize().multiplyScalar(100)
    this.stars.material.opacity = Math.max(0, (c.night - 0.5) * 2)
    const u = water.uniforms, nt = c.night, g = c.grey
    const deep = new THREE.Color("#1d5f8f").lerp(new THREE.Color("#081a33"), nt).lerp(new THREE.Color("#4f6a7c"), g * 0.8)
    const shallow = new THREE.Color("#3f9acb").lerp(new THREE.Color("#12335c"), nt).lerp(new THREE.Color("#7f98a8"), g * 0.8)
    u.uDeep.value.copy(deep); u.uShallow.value.copy(shallow); u.uSky.value.copy(c.sky); u.uSun.value.copy(c.dir).normalize()
    u.uLight.value = 1 - 0.1 * g
    water.bed.material.color.copy(deep).multiplyScalar(0.7)
  }
}

// The lighthouse at the origin and its beam, a soft cone turning about the lamp.
export class Lighthouse {
  constructor(kit) {
    this.root = kit.make("lighthouse")
    this.lamp = part(this.root, "Lamp")
    const len = 60, rad = 5
    const geo = new THREE.ConeGeometry(rad, len, 20, 1, true); geo.translate(0, -len / 2, 0); geo.rotateZ(Math.PI / 2)
    // fade to nothing at the far end (additive blending: black adds nothing), so the open end is never seen
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) { const f = 1 - Math.min(1, pos.getX(i) / len); col.fill(f * f, i * 3, i * 3 + 3) }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
    this.beamMat = new THREE.MeshBasicMaterial({ color: "#fff1c4", transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, vertexColors: true })
    this.beam = new THREE.Mesh(geo, this.beamMat)
    this.beam.position.y = 6.8
    this.beam.raycast = () => {}
    this.root.add(this.beam)
    this.state = { theta: 0, hold: 0, last: null }
    this.lampMats = kit.meshes(this.root, "lamp").map(m => m.material)
  }
  // `targets`: angles (radians in the x-z plane) of the reefs that need you. `night` 0..1 makes it stronger.
  update(dt, targets, night) {
    this.state = stepBeam(this.state, targets, dt)
    this.beam.rotation.y = -this.state.theta
    this.beamMat.opacity = 0.12 + 0.45 * night
    for (const m of this.lampMats) m.emissiveIntensity = 1.2 + 1.2 * night
  }
}

// The captain's boat: floats on the waves, anchor on a thin line, sail up or down, lurches at the horn.
export class Boat {
  constructor(kit) {
    this.kit = kit
    this.group = new THREE.Group(); this.group.position.set(BOAT.x, 0, BOAT.z); this.group.rotation.y = 2.2
    this.model = kit.make("boat")
    this.anchor = part(this.model, "Anchor"); this.sail = part(this.model, "Sail")
    this.anchorY = this.anchor.position.y
    this.line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5), new THREE.MeshBasicMaterial({ color: "#c9cfd4" }))
    this.line.raycast = () => {}
    this.model.add(this.line)
    this.group.add(this.model)
    this.look = captainLook("none"); this.depth = 0; this.opacity = 0.4
    this.lurchAt = -10
    kit.fade(this.model, 0.4)
  }
  setState(state) { this.look = captainLook(state); this.sail.visible = this.look.sail }
  horn(t) { this.lurchAt = t }
  update(t, dt, motion) {
    const l = this.look, k = damp(dt, 3)
    this.depth += (l.anchor - this.depth) * k
    this.anchor.position.y = this.anchorY - this.depth
    this.line.visible = this.depth > 0.05
    this.line.scale.y = Math.max(this.depth, 0.001); this.line.position.set(0, this.anchorY - this.depth / 2, this.anchor.position.z)
    if (Math.abs(this.opacity - l.opacity) > 0.01) { this.opacity += (l.opacity - this.opacity) * k; this.kit.fade(this.model, Math.abs(this.opacity - 1) < 0.02 ? 1 : Math.round(this.opacity * 20) / 20) }
    const m = motion
    const lt = t - this.lurchAt, lurch = lt >= 0 && lt < 1.6 ? Math.exp(-lt * 2.5) : 0
    this.group.position.y = waveHeight(BOAT.x, BOAT.z, t * (m ? 1 : 0)) * 0.8 - 0.15 - lurch * 0.18 * Math.sin(lt * 9)
    this.group.rotation.z = Math.sin(t * 0.9) * l.rock * m + lurch * 0.22 * Math.sin(lt * 11)
    this.group.rotation.x = Math.cos(t * 0.7) * l.rock * 0.7 * m - lurch * 0.18 * Math.cos(lt * 9)
  }
}
