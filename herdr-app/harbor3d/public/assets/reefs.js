// A reef and everything on it (octopus, crabs, dock, buoys, flagpole and flags, palm, crane, fog, flare),
// and the rafts of adrift agents. look.js says what things look like; this applies it and animates it.
// A scene update only changes what changed: objects are reused by id (workers) or index (buoys, flags)
// and eased to their new places over about 0.6 s.
import * as THREE from "three"
import { part, waveHeight, damp } from "./world.js"
import { workerPosition, dockPosition, cranePosition, buoyPosition, flagPosition, adriftPosition, toWorld, POLE, PALM, REEF_TOP, MAX_WORKERS, MAX_BUOYS, MAX_FLAGS, MAX_ADRIFT } from "./layout.js"
import { reefLook, workerLook, buoyLook, flagLook } from "./look.js"

const TAU = Math.PI * 2
const none = () => {}
// A stable 0..1 number from an id, so objects do not all move in step.
const seed = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (Math.abs(h) % 1000) / 1000 }
// Exponential approach: a position eased to its target in about 0.6 s.
const EASE = 7
const ease = (cur, target, dt) => cur.lerp(target, damp(dt, EASE))

// Shared by every reef: the shadow disc, the fog and flare textures' materials.
export function reefAssets(kit, softTex) {
  // The dock's lantern: the shared glowing "lamp" material, and a dark glass twin for runs that are not finished.
  const on = kit.meshes(kit.make("dock"), "lamp")[0].userData.src
  const off = on.clone(); off.emissive.set("#000000"); off.emissiveIntensity = 0; off.color.set("#27323b")
  return {
    kit,
    disc: new THREE.Mesh(new THREE.CircleGeometry(5.3, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#04243d", transparent: true, opacity: 0.3, depthWrite: false })),
    ring: new THREE.Mesh(new THREE.RingGeometry(5.6, 5.72, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false })),
    fogMat: new THREE.SpriteMaterial({ map: softTex, color: "#ffffff", transparent: true, opacity: 0.4, depthWrite: false }),
    softTex,
    lanternOn: on, lanternOff: off,
  }
}

export class Reef {
  constructor(assets, id, slot) {
    this.a = assets; this.kit = assets.kit
    this.id = id; this.slot = slot; this.ph = seed(id) * TAU
    this.group = new THREE.Group(); this.group.position.set(slot.x, 0, slot.z); this.group.rotation.y = slot.angle
    this.group.userData.reef = this
    this.stuff = new THREE.Group(); this.group.add(this.stuff)   // everything that fades with the reef
    const k = this.kit
    this.stuff.add(k.make("reef"))
    this.disc = assets.disc.clone(); this.disc.position.y = 0.04; this.disc.raycast = none; this.group.add(this.disc)
    this.sel = assets.ring.clone(); this.sel.position.y = 0.06; this.sel.visible = false; this.sel.raycast = none; this.group.add(this.sel)

    // octopus: root (position, bob) > lean > model
    this.octoRoot = new THREE.Group(); this.octoRoot.position.set(0, REEF_TOP, 0)
    this.octoLean = new THREE.Group(); this.octoRoot.add(this.octoLean)
    this.octo = k.make("octopus"); this.octoLean.add(this.octo)
    this.tent = Array.from({ length: 8 }, (_, i) => part(this.octo, `Tentacle.${i}`))
    this.lids = [part(this.octo, "EyeLid.L"), part(this.octo, "EyeLid.R")]
    this.stuff.add(this.octoRoot)
    this.leanAmt = 0; this.waveUntil = -1; this.octoOpacity = 1

    // dock with lanterns
    this.dock = k.make("dock"); const dp = dockPosition(); this.dock.position.set(dp.x, dp.y, dp.z); this.stuff.add(this.dock)
    this.lanterns = [part(this.dock, "Lantern.L"), part(this.dock, "Lantern.R")]
    this.lit = null
    // crane (only with a PR)
    this.crane = k.make("crane"); const cp = cranePosition(); this.crane.position.set(cp.x, cp.y, cp.z); this.crane.visible = false
    this.arm = part(this.crane, "Arm"); this.armAngle = 0; this.stuff.add(this.crane)
    // palm
    this.palm = k.make("palm"); this.palm.position.set(PALM.x, PALM.y, PALM.z); this.palmScale = 1; this.palmTarget = 1; this.stuff.add(this.palm)
    // flagpole and flags
    this.pole = k.make("flagpole"); this.pole.position.set(POLE.x, POLE.y, POLE.z); this.pole.visible = false; this.stuff.add(this.pole)
    this.flags = []
    // fog (parked) and flare (needs you): sprites, not part of the fading content
    this.fog = new THREE.Group(); this.fog.visible = false
    for (let i = 0; i < 6; i++) { const s = new THREE.Sprite(assets.fogMat); s.scale.setScalar(5.5); s.raycast = none; this.fog.add(s) }
    this.group.add(this.fog)
    this.flareMat = new THREE.SpriteMaterial({ map: assets.softTex, color: "#ff3a2e", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    this.flare = new THREE.Sprite(this.flareMat); this.flare.visible = false; this.flare.raycast = none; this.group.add(this.flare)

    this.workers = new Map()   // id -> entity
    this.buoys = []
    this.run = null; this.look = reefLook(null)
    this.pokedWorld = new THREE.Vector3()
  }

  get position() { return this.group.position }

  select(on) { this.sel.visible = on }

  // Apply a run from the scene: what changed becomes the new target; `snap` skips the easing.
  apply(run, snap = false) {
    const k = this.kit, look = reefLook(run)
    this.run = run; this.look = look
    // fading: the reef's content, the octopus on its own when gone
    const op = look.opacity
    k.fade(this.stuff, op)
    const oo = Math.min(op, look.orchestrator.opacity)
    if (oo !== op) k.fade(this.octoRoot, oo)
    for (const l of this.lids) { l.scale.setScalar(look.orchestrator.eyelids); l.visible = look.orchestrator.eyelids > 0 }
    // lanterns: glowing when finished, dark glass otherwise
    if (this.lit !== look.lanterns) { this.lit = look.lanterns; for (const l of this.lanterns) k.setMat(l, look.lanterns ? this.a.lanternOn : this.a.lanternOff) }
    this.crane.visible = look.crane
    this.palmTarget = look.palm
    this.pole.visible = look.hasPr
    this.fog.visible = look.parked
    this.syncFlags(run.prs || [], snap)
    this.syncWorkers(run.workers || [], snap)
    this.syncBuoys(run.tasks || [], snap)
    if (snap) this.palmScale = this.palmTarget
  }

  syncFlags(prs, snap) {
    const k = this.kit, n = Math.min(prs.length, MAX_FLAGS)
    while (this.flags.length > n) { const f = this.flags.pop(); this.stuff.remove(f.pivot) }
    for (let i = 0; i < n; i++) {
      let f = this.flags[i]
      if (!f) {
        const pivot = new THREE.Group(), m = k.make("flag"); pivot.add(m)
        const p = flagPosition(i); pivot.position.set(p.x, p.y, p.z)
        f = { pivot, mesh: part(m, "Flag"), color: null, speed: 1, ph: i * 1.7 }
        this.flags.push(f); this.stuff.add(pivot)
        if (this.look.opacity < 1) k.fade(pivot, this.look.opacity)
      }
      const l = flagLook(prs[i])
      if (f.color !== l.color) { f.color = l.color; k.paint(f.mesh, l.color) }
      f.speed = l.speed
    }
  }

  syncWorkers(list, snap) {
    const seen = new Set()
    list.slice(0, MAX_WORKERS).forEach((w, i) => {
      if (typeof w.id !== "string") return
      seen.add(w.id)
      const p = workerPosition(i)
      let e = this.workers.get(w.id)
      if (!e) {
        const root = new THREE.Group(), tilt = new THREE.Group(), model = this.kit.make("crab")
        tilt.add(model); root.add(tilt); this.stuff.add(root)
        e = { id: w.id, root, tilt, claws: [part(model, "Claw.L"), part(model, "Claw.R")], home: new THREE.Vector3(p.x, p.y, p.z), target: new THREE.Vector3(), scale: snap ? 1 : 0, goal: 1, ph: seed(w.id) * TAU, waveUntil: -1, tiltAmt: 0 }
        this.workers.set(w.id, e)
        if (this.look.opacity < 1) this.kit.fade(root, this.look.opacity)
      }
      e.goal = 1; e.target.set(p.x, p.y, p.z); e.angle = p.angle; e.circle = p.circle; e.look = workerLook(w.state)
      if (snap) e.home.copy(e.target)
    })
    for (const [id, e] of this.workers) if (!seen.has(id)) e.goal = 0
  }

  syncBuoys(tasks, snap) {
    const k = this.kit, n = Math.min(tasks.length, MAX_BUOYS)
    while (this.buoys.length > n) { const b = this.buoys.pop(); b.goal = 0; (this.leaving ||= []).push(b) }
    for (let i = 0; i < n; i++) {
      let b = this.buoys[i]
      const p = buoyPosition(i, n)
      if (!b) {
        const root = new THREE.Group(), m = k.make("buoy"); root.add(m); this.stuff.add(root)
        b = { root, mesh: part(m, "Float"), color: null, home: new THREE.Vector3(p.x, 0, p.z), target: new THREE.Vector3(), scale: snap ? 1 : 0, goal: 1, ph: i * 1.3, fast: false }
        this.buoys.push(b)
        if (this.look.opacity < 1) k.fade(root, this.look.opacity)
      }
      b.goal = 1; b.target.set(p.x, 0, p.z)
      const l = buoyLook(tasks[i])
      if (b.color !== l.color) { b.color = l.color; k.paint(b.mesh, l.color) }
      b.fast = l.fast
      if (snap) b.home.copy(b.target)
    }
  }

  // Every creature on this reef by scene id (the octopus is the orchestrator's id), for pokes.
  waveTarget(id, t) {
    if (this.run?.orchestrator?.id === id) { this.waveUntil = t + 2; return true }
    const e = this.workers.get(id)
    if (e && e.goal) { e.waveUntil = t + 2; return true }
    return false
  }

  // Animate. `env`: { t, dt, camera, motion (1 or 0), night }.
  update(env) {
    const { t, dt, camera } = env
    const m = this.look.still ? 0 : env.motion
    const look = this.look, o = look.orchestrator, ph = this.ph

    // octopus
    const bob = o.bob ? o.bob.amp * Math.sin((TAU * t) / o.bob.period + ph) * env.motion : 0
    this.octoRoot.position.y = REEF_TOP + bob
    const waving = this.waveUntil > t
    for (let i = 0; i < 8; i++) {
      const tn = this.tent[i]; if (!tn) continue
      const sway = o.sway ? m : 0
      tn.rotation.x = Math.sin(t * 2.6 + i * 0.8 + ph) * 0.2 * sway
      tn.rotation.z = Math.cos(t * 2.1 + i * 1.1 + ph) * 0.2 * sway
    }
    if (o.wave && this.tent[0]) this.tent[0].rotation.z = 0.9 + Math.sin(t * 7 + ph) * 0.45
    if (waving) {
      this.tent[0].rotation.z = 1.2 + Math.sin(t * 13) * 0.7
      if (this.tent[4]) this.tent[4].rotation.z = -(1.2 + Math.sin(t * 13 + 1) * 0.7)
    }
    this.leanAmt += ((o.lean ? 0.22 : 0) - this.leanAmt) * damp(dt, 4)
    if (this.leanAmt > 0.002) {
      const c = Math.cos(this.slot.angle), s = Math.sin(this.slot.angle)
      const wx = camera.position.x - this.group.position.x, wz = camera.position.z - this.group.position.z
      const dx = wx * c - wz * s, dz = wx * s + wz * c, n = Math.hypot(dx, dz) || 1
      this.octoLean.quaternion.setFromAxisAngle(new THREE.Vector3(dz / n, 0, -dx / n), this.leanAmt)
    } else this.octoLean.quaternion.identity()

    // workers
    for (const [id, e] of this.workers) {
      e.scale += (e.goal - e.scale) * damp(dt, 8)
      if (!e.goal && e.scale < 0.03) { this.stuff.remove(e.root); this.workers.delete(id); continue }
      ease(e.home, e.target, dt)
      const l = e.look, tau = TAU / l.period
      let ox = 0, oy = 0, oz = 0, clawA = 0.2
      if (l.motion === "scuttle") { const s = Math.sin(t * tau + e.ph) * l.amp * m; ox = -Math.sin(e.circle) * s; oz = Math.cos(e.circle) * s; clawA = 0.25 + Math.sin(t * 9 + e.ph) * 0.15 * m }
      else if (l.motion === "hop") oy = Math.abs(Math.sin(t * tau * 0.5 + e.ph)) * l.amp * m
      else if (l.motion === "claws") clawA = 0.25 + (0.5 + 0.5 * Math.sin(t * tau + e.ph)) * 0.45 * m
      const w = e.waveUntil > t
      if (w) { oy = Math.abs(Math.sin(t * 9)) * 0.25; clawA = 0.9 + Math.sin(t * 14) * 0.5 }
      e.root.position.set(e.home.x + ox, e.home.y + oy, e.home.z + oz)
      e.root.rotation.y = e.angle
      e.root.scale.setScalar(Math.max(e.scale, 0.001))
      e.tiltAmt += ((l.tilt * Math.PI) / 180 - e.tiltAmt) * damp(dt, 5)
      e.tilt.rotation.z = e.tiltAmt
      e.claws[0].rotation.y = -clawA; e.claws[1].rotation.y = clawA
      if (w) { e.claws[0].rotation.z = Math.abs(clawA) * 0.8; e.claws[1].rotation.z = -Math.abs(clawA) * 0.8 } else { e.claws[0].rotation.z = 0; e.claws[1].rotation.z = 0 }
    }

    // buoys float on the same waves as the water
    const gw = this.group.position
    const tick = (b, dying) => {
      b.scale += (b.goal - b.scale) * damp(dt, 8)
      ease(b.home, b.target, dt)
      const wp = toWorld(this.slot, b.home)
      const fast = b.fast
      const bobAmp = (fast ? 0.07 : 0.03) * env.motion
      b.root.position.set(b.home.x, waveHeight(wp.x, wp.z, t * env.motion) * 0.9 + Math.sin(t * (fast ? 5.2 : 2.4) + b.ph) * bobAmp, b.home.z)
      b.root.rotation.z = Math.sin(t * (fast ? 4 : 2) + b.ph) * (fast ? 0.1 : 0.04) * env.motion
      b.root.scale.setScalar(Math.max(b.scale, 0.001))
    }
    for (const b of this.buoys) tick(b)
    if (this.leaving) this.leaving = this.leaving.filter(b => { tick(b); if (b.scale < 0.03) { this.stuff.remove(b.root); return false } return true })

    // flags
    for (const f of this.flags) f.pivot.rotation.y = Math.sin(t * 2.2 * f.speed + f.ph) * 0.35 * env.motion + 0.2

    // crane, palm
    const armGoal = look.craneSpin ? Math.sin(t * 0.9) * 1.2 : 0
    this.armAngle += (armGoal - this.armAngle) * damp(dt, 3)
    this.arm.rotation.y = this.armAngle
    this.palmScale += (this.palmTarget - this.palmScale) * damp(dt, 5)
    this.palm.scale.setScalar(this.palmScale)
    this.palm.rotation.z = Math.sin(t * 1.1 + ph) * 0.03 * m

    // fog
    if (look.parked) {
      this.fog.children.forEach((s, i) => { const a = t * 0.12 + i * 1.05 + ph; s.position.set(Math.cos(a) * (2.5 + (i % 3)), 1.3 + Math.sin(t * 0.3 + i) * 0.4 + (i % 2) * 0.8, Math.sin(a * 0.9) * (2.5 + (i % 2))) })
    }
    // flare: rises from 1 m to 5 m and fades, every 2.4 s
    this.flare.visible = look.flare
    if (look.flare) {
      const p = (t % 2.4) / 2.4, boost = 1 + env.night * 0.6
      this.flare.position.set(0, REEF_TOP + 1 + p * 4, 0)
      this.flare.scale.setScalar((1.6 + p * 1.4) * boost)
      this.flareMat.opacity = Math.min(1, (1 - p) * 0.95 * boost)
    }
  }
}

// An adrift agent: a crab on a driftwood raft on the ring of radius 10, bobbing on the waves.
export class Raft {
  constructor(kit, id, slot) {
    this.kit = kit; this.id = id; this.slot = slot; this.ph = seed(id) * TAU
    const p = adriftPosition(slot)
    this.group = new THREE.Group(); this.angle = p.angle
    this.home = new THREE.Vector3(p.x, 0, p.z); this.target = this.home.clone()
    this.wood = kit.make("driftwood"); this.group.add(this.wood)
    this.crabRoot = new THREE.Group(); this.crabRoot.position.set(0, 0.2, 0); this.crab = kit.make("crab"); this.crabRoot.add(this.crab); this.group.add(this.crabRoot)
    this.claws = [part(this.crab, "Claw.L"), part(this.crab, "Claw.R")]
    this.scale = 0; this.goal = 1; this.look = workerLook("idle"); this.waveUntil = -1
    this.group.userData.raft = this
  }
  apply(a, snap) {
    this.look = workerLook(a.state)
    if (snap) this.scale = 1
  }
  setSlot(slot) { this.slot = slot; const p = adriftPosition(slot); this.target.set(p.x, 0, p.z); this.angle = p.angle }
  waveTarget(id, t) { if (id === this.id && this.goal) { this.waveUntil = t + 2; return true } return false }
  update(env) {
    const { t, dt } = env, m = env.motion
    this.scale += (this.goal - this.scale) * damp(dt, 8)
    ease(this.home, this.target, dt)
    this.group.position.set(this.home.x, waveHeight(this.home.x, this.home.z, t * m) * 0.9 - 0.05, this.home.z)
    this.group.rotation.set(Math.sin(t * 1.3 + this.ph) * 0.05 * m, this.angle, Math.cos(t * 1.1 + this.ph) * 0.06 * m)
    this.group.scale.setScalar(Math.max(this.scale, 0.001))
    const l = this.look, w = this.waveUntil > t
    let clawA = 0.2, oy = 0
    if (l.motion === "claws") clawA = 0.25 + (0.5 + 0.5 * Math.sin((t * TAU) / l.period + this.ph)) * 0.45 * m
    else if (l.motion === "scuttle") clawA = 0.25 + Math.sin(t * 9 + this.ph) * 0.15 * m
    else if (l.motion === "hop") oy = Math.abs(Math.sin(t * 4 + this.ph)) * l.amp * m
    if (w) { oy = Math.abs(Math.sin(t * 9)) * 0.25; clawA = 0.9 + Math.sin(t * 14) * 0.5 }
    this.crabRoot.position.y = 0.2 + oy
    this.crabRoot.rotation.z = (l.tilt * Math.PI) / 180
    this.claws[0].rotation.y = -clawA; this.claws[1].rotation.y = clawA
  }
}

export { MAX_ADRIFT }
