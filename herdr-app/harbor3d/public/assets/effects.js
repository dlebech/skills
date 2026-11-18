// Things that happen for a moment: the horn's ring and tone, fireworks, and the gulls (one per viewer).
import * as THREE from "three"
import { part, waveHeight } from "./world.js"
import { BOAT } from "./layout.js"
import { gullCount } from "./look.js"

const TAU = Math.PI * 2
const COLORS = ["#ff5d5d", "#ffd24a", "#5de08a", "#5db7ff", "#c58bff", "#ff9a4a"]

// White rings that spread on the water from the boat, and a short synthesised tone (WebAudio, off until
// the viewer turns Sound on).
export class Horn {
  constructor(scene) {
    this.scene = scene
    this.rings = Array.from({ length: 3 }, () => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }))
      m.visible = false; m.raycast = () => {}; m.userData.at = -10
      scene.add(m)
      return m
    })
    this.next = 0
    this.audio = null
    this.sound = false
  }
  // The viewer's choice, made on a click (a user gesture, which the browser needs before it plays).
  setSound(on) {
    this.sound = on
    if (on && !this.audio) { try { this.audio = new (window.AudioContext || window.webkitAudioContext)() } catch { this.audio = null } }
    if (on && this.audio && this.audio.state === "suspended") this.audio.resume().catch(() => {})
  }
  play(t) {
    const r = this.rings[this.next++ % this.rings.length]
    r.userData.at = t; r.position.set(BOAT.x, 0.08, BOAT.z); r.visible = true
    if (this.sound && this.audio) this.tone()
  }
  tone() {
    const a = this.audio, now = a.currentTime, g = a.createGain()
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.18, now + 0.05); g.gain.setValueAtTime(0.18, now + 0.55); g.gain.linearRampToValueAtTime(0, now + 0.9)
    g.connect(a.destination)
    for (const f of [98, 147]) { const o = a.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.connect(g); o.start(now); o.stop(now + 0.95) }
  }
  update(t) {
    for (const r of this.rings) {
      if (!r.visible) continue
      const p = (t - r.userData.at) / 2.4
      if (p >= 1 || p < 0) { r.visible = false; continue }
      r.scale.setScalar(1 + p * 28); r.material.opacity = 0.7 * (1 - p) * (1 - p)
    }
  }
}

// Fireworks: three coloured bursts over a reef within 3 s, as points (one buffer, 600 particles).
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

// Gulls: one per viewer (at most 20) circling the lighthouse at 12 m. Feeding makes them dive to the water
// near the lighthouse and climb back.
export class Gulls {
  constructor(kit, scene) {
    this.kit = kit; this.scene = scene
    this.gulls = []
    this.feedAt = -100
    this.group = new THREE.Group(); scene.add(this.group)
  }
  setCount(n) {
    n = gullCount(n)
    while (this.gulls.length < n) {
      const i = this.gulls.length, o = this.kit.make("gull")
      const g = { obj: o, wl: part(o, "Wing.L"), wr: part(o, "Wing.R"), i, phase: i * 2.4, r: 14 + (i % 4) * 2.5, speed: (0.32 + (i % 3) * 0.05) * (i % 2 ? 1 : -1) }
      o.raycast = () => {}
      this.group.add(o); this.gulls.push(g)
    }
    while (this.gulls.length > n) this.group.remove(this.gulls.pop().obj)
  }
  feed(t) { this.feedAt = t }
  update(t, motion) {
    for (const g of this.gulls) {
      const fp = (t - this.feedAt - g.i * 0.12) / 3.6, dive = fp > 0 && fp < 1 ? Math.sin(fp * Math.PI) : 0
      const a = g.phase + t * g.speed * motion
      const r = g.r - dive * (g.r - 7)
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      g.obj.position.set(x, 12 - dive * 10.8 + (motion ? Math.sin(t * 0.8 + g.i) * 0.5 : 0), z)
      const dir = Math.sign(g.speed)
      g.obj.rotation.y = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir)
      g.obj.rotation.z = -dir * 0.25
      const flap = Math.sin(t * (dive > 0 ? 14 : 7) * (motion || dive ? 1 : 0) + g.i) * 0.55
      g.wl.rotation.z = flap; g.wr.rotation.z = -flap
    }
  }
}
