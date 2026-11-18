// Things that happen for a moment: bubbles when something is petted, a jumping fish, fireworks, and the gulls (one per viewer).
import * as THREE from "three"
import { part } from "./world.js"
import { OFFICE } from "./layout.js"
import { gullCount } from "./look.js"
import { nextFish, FISH, fishArc, splash, gullCycle, gullState } from "./life.js"

const TAU = Math.PI * 2
const COLORS = ["#ff5d5d", "#ffd24a", "#5de08a", "#5db7ff", "#c58bff", "#ff9a4a"]

// Bubbles that rise from a creature that has just been petted: three at a time, from a pool of 12 sprites that is reused
// (nothing is made or freed per pet).
export class Bubbles {
  constructor(scene, tex) {
    this.mat = new THREE.SpriteMaterial({ map: tex, color: "#dff4ff", transparent: true, opacity: 0, depthWrite: false })
    this.items = Array.from({ length: 12 }, () => { const s = new THREE.Sprite(this.mat.clone()); s.visible = false; s.raycast = () => {}; scene.add(s); return { s, at: -10, x: 0, y: 0, z: 0, ph: 0 } })
    this.next = 0
  }
  // Three bubbles rise from (x, y, z), 0.25 s apart, from time t.
  emit(x, y, z, t) {
    for (let i = 0; i < 3; i++) { const b = this.items[this.next++ % this.items.length]; b.at = t + i * 0.25; b.x = x + (i - 1) * 0.35; b.y = y; b.z = z; b.ph = i * 2.1 }
  }
  update(t) {
    for (const b of this.items) {
      const k = (t - b.at) / 1.8
      if (k <= 0 || k >= 1) { b.s.visible = false; continue }
      b.s.visible = true
      b.s.position.set(b.x + Math.sin(k * 7 + b.ph) * 0.2, b.y + k * 3.2, b.z)
      b.s.scale.setScalar(0.3 + 0.2 * k); b.s.material.opacity = 0.8 * (1 - k * k)
    }
  }
}

// A fish that jumps somewhere in the basin every 20 to 40 s: a flat silver fish (two triangles and a tail, built here)
// on a short arc, with a splash ring where it leaves and where it lands. One fish and two rings, reused. Off with reduced motion.
export class Fish {
  constructor(scene) {
    const g = new THREE.BufferGeometry()
    const P = { n: [0.5, 0], t: [0.05, 0.14], b: [0.05, -0.14], p: [-0.4, 0], u: [-0.62, 0.17], d: [-0.62, -0.17] }
    const v = []
    for (const tri of [["n", "t", "b"], ["t", "p", "b"], ["p", "u", "d"]]) for (const k of tri) v.push(...P[k], 0)
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals()
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#cfdde6", side: THREE.DoubleSide }))
    this.mesh.scale.setScalar(1.6); this.mesh.visible = false; this.mesh.raycast = () => {}
    this.rings = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); m.visible = false; m.raycast = () => {}; scene.add(m); return m })
    scene.add(this.mesh)
    this.next = null; this.at = -100; this.from = { x: 0, z: 0 }; this.dir = 0; this.W = 36
  }
  setWidth(W) { this.W = W }
  update(t, motion) {
    if (!motion) { this.mesh.visible = false; for (const r of this.rings) r.visible = false; this.next = null; return }
    if (this.next === null) this.next = t + 6 + Math.random() * 10
    if (t >= this.next) {
      this.at = t; this.next = nextFish(t, Math.random())
      this.from = { x: (Math.random() - 0.5) * this.W * 0.8, z: 38 + Math.random() * 12 }; this.dir = Math.random() * TAU
    }
    const p = (t - this.at) / FISH.duration, a = fishArc(p)
    this.mesh.visible = p > 0 && p < 1
    if (this.mesh.visible) {
      const dx = Math.sin(this.dir), dz = Math.cos(this.dir)
      this.mesh.position.set(this.from.x + dx * a.along, a.y, this.from.z + dz * a.along)
      this.mesh.rotation.set(0, this.dir - Math.PI / 2, a.pitch, "YXZ")
    }
    for (let i = 0; i < 2; i++) {
      const r = this.rings[i], sp = splash(t - this.at - i * FISH.duration)
      r.visible = sp.opacity > 0
      if (r.visible) { r.position.set(this.from.x + Math.sin(this.dir) * FISH.reach * i, 0.1, this.from.z + Math.cos(this.dir) * FISH.reach * i); r.scale.setScalar(sp.scale * 1.4); r.material.opacity = sp.opacity }
    }
  }
}

// Fireworks: three coloured bursts over a berth's ship within 3 s, as points (one buffer, 600 particles).
export class Fireworks {
  constructor(scene) {
    this.N = 600
    this.pos = new Float32Array(this.N * 3); this.col = new Float32Array(this.N * 3)
    this.vel = new Float32Array(this.N * 3); this.life = new Float32Array(this.N)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3)); this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3))
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.points.frustumCulled = false; this.points.raycast = () => {}
    scene.add(this.points)
    this.queue = []
    this.cursor = 0
    this.alive = 0
    this.c = new THREE.Color()
  }
  // Three bursts above (x, z): at 0, 1.1 and 2.4 s from `t`.
  launch(x, z, t) {
    for (let i = 0; i < 3; i++) this.queue.push({ at: t + [0, 1.1, 2.4][i], x: x + (i - 1) * 1.6, y: 7 + i * 1.2, z: z + (i === 1 ? 1.2 : -0.6), color: COLORS[(i * 2 + Math.floor(t)) % COLORS.length] })
  }
  burst(b) {
    this.c.set(b.color)
    for (let i = 0; i < 70; i++) {
      const j = this.cursor++ % this.N, a = Math.random() * TAU, e = Math.acos(2 * Math.random() - 1), s = 3 + Math.random() * 3
      this.pos.set([b.x, b.y, b.z], j * 3)
      this.vel.set([Math.sin(e) * Math.cos(a) * s, Math.cos(e) * s, Math.sin(e) * Math.sin(a) * s], j * 3)
      this.col.set([this.c.r, this.c.g, this.c.b], j * 3)
      this.life[j] = 1.4 + Math.random() * 0.5
    }
  }
  update(t, dt) {
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].at <= t) this.burst(this.queue.splice(i, 1)[0])
    let alive = 0
    for (let j = 0; j < this.N; j++) {
      if (this.life[j] <= 0) continue
      this.life[j] -= dt; alive++
      const k = j * 3
      this.vel[k + 1] -= 4.5 * dt
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt
      if (this.life[j] <= 0) this.pos[k + 1] = -1000
    }
    if (alive || this.alive) { this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true }
    this.alive = alive
  }
}

// Gulls: one per viewer (at most 20) circling the harbour office's radar at 16 m. Feeding makes them dive to
// the water at (0, 0, 30) and climb back.
export class Gulls {
  constructor(kit, scene) {
    this.kit = kit; this.scene = scene
    this.gulls = []
    this.feedAt = -100
    this.perches = []; this.tmp = new THREE.Vector3()
    this.group = new THREE.Group(); scene.add(this.group)
  }
  // The places a gull may land: the tops of the cranes (berths, which know where theirs is now) and the office roof (a point).
  setPerches(list) { this.perches = list }
  setCount(n) {
    n = gullCount(n)
    while (this.gulls.length < n) {
      const i = this.gulls.length, o = this.kit.make("gull")
      const cycle = gullCycle(Math.random(), Math.random())
      const g = { obj: o, wl: part(o, "Wing.L"), wr: part(o, "Wing.R"), i, phase: i * 2.4, r: 16 + (i % 4) * 2.5, speed: (0.32 + (i % 3) * 0.05) * (i % 2 ? 1 : -1), cycle, age: Math.random() * cycle[0], round: i, yaw: 0, spot: null }
      o.raycast = () => {}
      this.group.add(o); this.gulls.push(g)
    }
    while (this.gulls.length > n) this.group.remove(this.gulls.pop().obj)
  }
  feed(t) { this.feedAt = t }
  update(t, motion, dt = 0) {
    for (const g of this.gulls) {
      const fp = (t - this.feedAt - g.i * 0.12) / 3.6, dive = fp > 0 && fp < 1 ? Math.sin(fp * Math.PI) : 0
      const a = g.phase + t * g.speed * motion
      // the circle round the radar, pulled towards a smaller circle over the feeding spot as it dives
      const ox = OFFICE.x + Math.cos(a) * g.r, oz = OFFICE.z + Math.sin(a) * g.r, oy = 15 + (motion ? Math.sin(t * 0.8 + g.i) * 0.5 : 0)
      const fx = Math.cos(a * 2) * 4, fz = 30 + Math.sin(a * 2) * 4
      // between flights it lands on a perch (a crane's top or the office roof) for 10 to 20 s; none with reduced motion
      let w = 0
      if (motion && this.perches.length) {
        g.age += dt
        let st = gullState(g.age, g.cycle)
        if (st.s === "done") { g.age = 0; g.cycle = gullCycle(Math.random(), Math.random()); g.round++; st = gullState(0, g.cycle) }
        if (st.s === "land" && !g.spot) g.spot = this.perches[(g.i + g.round) % this.perches.length]
        w = st.s === "land" ? smooth(st.k) : st.s === "perch" ? 1 : st.s === "leave" ? 1 - smooth(st.k) : 0
        if (w === 0) g.spot = null
      }
      const sp = g.spot ? (typeof g.spot.perchPoint === "function" ? g.spot.perchPoint(this.tmp) : g.spot) : { x: ox, y: oy, z: oz }
      const bx = ox + (sp.x - ox) * w, by = oy + (sp.y - oy) * w, bz = oz + (sp.z - oz) * w
      g.obj.position.set(bx + (fx - bx) * dive, by + (1.4 - by) * dive, bz + (fz - bz) * dive)
      const dir = Math.sign(g.speed)
      const goalYaw = w >= 1 ? 0.6 * (g.i % 5) : Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir)
      let dy = goalYaw - g.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.yaw += dy * (w >= 1 ? 0.2 : 1)
      g.obj.rotation.y = g.yaw
      g.obj.rotation.z = -dir * 0.25 * (1 - w)
      const flap = Math.sin(t * (dive > 0 ? 14 : 7) * (motion || dive ? 1 : 0) + g.i) * 0.55 * (dive > 0 ? 1 : 1 - w * 0.9)
      g.wl.rotation.z = flap; g.wr.rotation.z = -flap
    }
  }
}
const smooth = k => k * k * (3 - 2 * k)
