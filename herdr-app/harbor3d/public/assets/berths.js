// A berth and everything at it (pier, ship, crane, signal, containers, octopus, crabs), a parked ship at anchor,
// and the rafts of adrift agents. look.js says what things look like; this applies it and animates it.
// A scene update only changes what changed: objects are reused by id (workers) or task index (containers)
// and eased to their new places over about 0.6 s.
import * as THREE from "three"
import { part, waveHeight, damp } from "./world.js"
import {
  pierPosition, cranePosition, signalPosition, octopusPosition, shipPosition, crabLane, flagPosition, deckPosition, deckToBerth, hazePosition,
  adriftPosition, MAX_WORKERS, MAX_FLAGS, MAX_DECK, OCTOPUS_SCALE, CRAB_SCALE, CONTAINER,
} from "./layout.js"
import { berthLook, workerLook, containerPlan, flagLook, stageOf } from "./look.js"
import { deckOverflow } from "./layout.js"
import { crewEvents, crewStances, checksIn, blockedWorker, faceOctopus, beat, walk, cheer, clap, ROLL_CALL, WAVE_OFF, CHECK_IN } from "./crew.js"
import { nextBlink, lidClosed, headTarget, flickerOn, lightDelay } from "./life.js"

const TAU = Math.PI * 2
const none = () => {}
// A stable 0..1 number from an id, so objects do not all move in step.
const seed = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (Math.abs(h) % 1000) / 1000 }
// Exponential approach: a position eased to its target in about 0.6 s.
const EASE = 7
const ease = (cur, target, dt) => cur.lerp(target, damp(dt, EASE))
const smooth = k => k * k * (3 - 2 * k)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const LIFT_S = 1.6, LIFT_TOP = 6.5
const LAMP_HEX = { Red: "#ff4a3a", Amber: "#ffb43a", Green: "#4ae07a" }

// Shared by every berth: lamp materials (lit and dark), sprite materials, the selection frame's pieces.
export function berthAssets(kit, softTex) {
  const lampOn = (src, hex) => { const m = src.clone(); m.color.set(hex); m.emissive.set(hex); m.emissiveIntensity = 2; return m }
  const signal = {}
  for (const n of ["Red", "Amber", "Green"]) { const off = kit.meshes(kit.make("signal"), `Signal${n}`)[0].userData.src; signal[n] = { off, on: lampOn(off, LAMP_HEX[n]) } }
  const shipOff = kit.meshes(kit.make("ship"), "ShipLights")[0].userData.src.clone(); shipOff.emissive.set("#000000"); shipOff.emissiveIntensity = 0; shipOff.color.set("#27323b")
  const shipOn = lampOn(shipOff, "#ffd98a")
  const frameMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false })
  return {
    kit, softTex, signal, shipOn, shipOff, frameMat,
    strip: new THREE.BoxGeometry(1, 0.1, 1),
    pole: new THREE.CylinderGeometry(0.03, 0.03, 1, 6), poleMat: new THREE.MeshStandardMaterial({ color: "#d9dde0", roughness: 1 }),
    smokeMat: new THREE.SpriteMaterial({ map: softTex, color: "#e8ecef", transparent: true, opacity: 0.5, depthWrite: false }),
    hazeMat: new THREE.SpriteMaterial({ map: softTex, color: "#ffffff", transparent: true, opacity: 0.45, depthWrite: false }),
  }
}

// A white rectangle outline just above the water (x0..x1, z0..z1).
function frameOf(a, x0, x1, z0, z1) {
  const g = new THREE.Group(), w = 0.3
  for (const [x, z, sx, sz] of [[(x0 + x1) / 2, z0, x1 - x0, w], [(x0 + x1) / 2, z1, x1 - x0, w], [x0, (z0 + z1) / 2, w, z1 - z0], [x1, (z0 + z1) / 2, w, z1 - z0]]) {
    const m = new THREE.Mesh(a.strip, a.frameMat); m.position.set(x, 0.45, z); m.scale.set(sx, 1, sz); m.raycast = none; g.add(m)
  }
  g.visible = false
  return g
}

// One container: root (place, turn, scale) > tilt > model, recoloured through the kit's cache.
function makeCargo(kit) {
  const root = new THREE.Group(), tilt = new THREE.Group(), model = kit.make("container")
  tilt.add(model); root.add(tilt)
  return { root, tilt, body: kit.meshes(model, "ContainerColor")[0], color: null, pos: new THREE.Vector3(), target: new THREE.Vector3(), scale: 0, goalScale: 1, yaw: 0, goalYaw: 0, tiltAmt: 0, tiltGoal: 0, frame: "berth", zone: "none", idx: 0, pending: false, towards: false }
}

// The ship: hull, mast with flags, funnel smoke, lights, and the deck where finished containers sit.
class Ship {
  constructor(assets, heading = 0) {
    this.a = assets; this.kit = assets.kit
    this.group = new THREE.Group(); this.group.rotation.y = heading
    this.model = this.kit.make("ship"); this.group.add(this.model)
    this.mast = part(this.model, "Mast"); this.funnel = part(this.model, "Funnel")
    this.lights = this.kit.meshes(this.model, "ShipLights")
    this.deck = new THREE.Group(); this.group.add(this.deck)
    this.flags = []; this.lit = null; this.scale = 1; this.goalScale = 1
    this.puffs = Array.from({ length: 7 }, () => { const s = new THREE.Sprite(assets.smokeMat.clone()); s.visible = false; s.raycast = none; this.group.add(s); return { s, age: 9 } })
    this.nextPuff = 0; this.smoke = false
    this.ph = 0
    this.nightAt = null; this.gateDelay = 0; this.gateOn = true
    // "+n more": a small flag on the last deck slot's container when more tasks are done than the deck holds
    this.more = new THREE.Group()
    const pole = new THREE.Mesh(assets.pole, assets.poleMat); pole.scale.y = 0.9; pole.position.y = 0.45; pole.raycast = none
    const flag = this.kit.make("flag"); flag.scale.setScalar(0.5); flag.position.set(0.02, 0.8, 0); flag.raycast = none
    this.kit.meshes(flag, "FlagColor").forEach(m => this.kit.paint(m, "#d4553e"))
    this.more.add(pole, flag); this.more.visible = false
    const d = deckPosition(MAX_DECK - 1); this.more.position.set(d.x, d.y + CONTAINER.h, d.z)
    this.deck.add(this.more)
  }
  // Show or hide the "+n more" flag.
  setMore(on) { this.more.visible = on }
  // Lights come on one by one at dusk: each ship has its own delay (a fraction of a second), and flickers on within 0.4 s
  // after it; in daylight the lights follow the look at once.
  lightGate(t, night) {
    if (night > 0.5) { if (this.nightAt === null) this.nightAt = t; return flickerOn((t - this.nightAt - this.gateDelay) / 0.4, this.gateDelay + 0.17) === 1 }
    this.nightAt = null
    return true
  }
  // Apply the look: size, lights, smoke, flags (`prs` is the run's PR list).
  setLook(look, prs, snap) {
    this.goalScale = look.scale; if (snap) this.scale = look.scale
    this.want = look.lights
    this.showLights(look.lights && this.gateOn)
    this.smoke = look.smoke
    const n = Math.min(prs.length, MAX_FLAGS)
    while (this.flags.length > n) this.mast.remove(this.flags.pop().pivot)
    for (let i = 0; i < n; i++) {
      let f = this.flags[i]
      if (!f) {
        const pivot = new THREE.Group(), m = this.kit.make("flag"); pivot.add(m)
        const p = flagPosition(i); pivot.position.set(p.x, p.y - this.mast.position.y, p.z)
        f = { pivot, mesh: this.kit.meshes(m, "FlagColor")[0], color: null, speed: 1, ph: i * 1.7 }
        this.flags.push(f); this.mast.add(pivot)
      }
      const l = flagLook(prs[i])
      if (f.color !== l.color) { f.color = l.color; this.kit.paint(f.mesh, l.color) }
      f.speed = l.speed
    }
  }
  showLights(on) {
    if (this.lit === on) return
    this.lit = on
    for (const m of this.lights) this.kit.setMat(m, on ? this.a.shipOn : this.a.shipOff)
  }
  update(t, dt, motion, night, x, z) {
    if (motion) { this.gateOn = this.lightGate(t, night); this.showLights(!!this.want && this.gateOn) }
    this.scale += (this.goalScale - this.scale) * damp(dt, 4)
    this.group.scale.setScalar(this.scale)
    this.group.position.y = waveHeight(x, z, t * motion) * 0.4 - 0.08
    this.group.rotation.z = Math.sin(t * 0.8 + this.ph) * 0.012 * motion
    for (const f of this.flags) f.pivot.rotation.y = Math.sin(t * 2.2 * f.speed + f.ph) * 0.35 * motion + 0.2
    // funnel smoke: a puff every 0.55 s while CI runs, rising and fading over 3.2 s
    if (this.smoke && t >= this.nextPuff) {
      const p = this.puffs.find(q => q.age >= 3.2)
      if (p) { p.age = 0; p.s.visible = true }
      this.nextPuff = t + 0.55
    }
    for (const p of this.puffs) {
      if (p.age >= 3.2) { p.s.visible = false; continue }
      p.age += dt
      const k = p.age / 3.2
      p.s.position.set(this.funnel.position.x, this.funnel.position.y + 0.3 + p.age * 0.9, this.funnel.position.z - p.age * 0.35)
      p.s.scale.setScalar(0.7 + p.age * 0.9); p.s.material.opacity = 0.5 * (1 - k)
    }
  }
  // Free the per-ship smoke materials.
  dispose() { for (const p of this.puffs) p.s.material.dispose() }
  // The world-space top of the mast, for the label.
  top(out, parentPos) { return out.set(parentPos.x + this.group.position.x, 10.5 * this.scale, parentPos.z + this.group.position.z) }
}

// A berth: the pier with its ship, crane and signal, and the octopus and crabs, containers and flags.
export class Berth {
  constructor(assets, id, slot) {
    this.a = assets; this.kit = assets.kit
    this.id = id; this.slot = slot; this.ph = seed(id) * TAU
    this.group = new THREE.Group(); this.group.position.set(slot.x, 0, slot.z)
    this.group.userData.berth = this
    this.stuff = new THREE.Group(); this.group.add(this.stuff)
    const k = this.kit
    const pp = pierPosition(); this.pier = k.make("pier"); this.pier.position.set(pp.x, pp.y, pp.z); this.stuff.add(this.pier)
    this.sel = frameOf(assets, -12, 8, 0.5, 35); this.group.add(this.sel)

    this.ship = new Ship(assets); this.ship.ph = this.ph; this.ship.gateDelay = lightDelay(Math.round(seed(id) * 11), 12)
    const sp = shipPosition(); this.ship.group.position.set(sp.x, 0, sp.z); this.stuff.add(this.ship.group)
    this.shipGoal = { x: sp.x, z: sp.z }

    const cp = cranePosition(); this.crane = k.make("crane"); this.crane.position.set(cp.x, cp.y, cp.z); this.stuff.add(this.crane)
    this.trolley = part(this.crane, "Trolley"); this.hook = part(this.crane, "Hook"); this.hookY = this.hook.position.y
    this.trolleyX = 0; this.hookGoal = -1; this.craneZ = cp.z

    const gp = signalPosition(); this.signal = k.make("signal"); this.signal.position.set(gp.x, gp.y, gp.z); this.stuff.add(this.signal)
    this.lamps = Object.fromEntries(["Red", "Amber", "Green"].map(n => [n, k.meshes(this.signal, `Signal${n}`)[0]]))
    this.lampOn = null
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: assets.softTex, color: "#ff3a2e", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.glow.position.set(gp.x, gp.y + 4.2, gp.z + 0.4); this.glow.scale.setScalar(3.2); this.glow.visible = false; this.glow.raycast = none; this.group.add(this.glow)

    // octopus: root (position, bob, turn to the pier) > lean > model
    const op = octopusPosition()
    this.octoRoot = new THREE.Group(); this.octoRoot.position.set(op.x, op.y, op.z); this.octoRoot.rotation.y = op.angle
    this.octoLean = new THREE.Group(); this.octoRoot.add(this.octoLean)
    this.octo = k.make("octopus"); this.octo.scale.setScalar(OCTOPUS_SCALE); this.octoLean.add(this.octo)
    this.tent = Array.from({ length: 8 }, (_, i) => part(this.octo, `Tentacle.${i}`))
    this.lids = [part(this.octo, "EyeLid.L"), part(this.octo, "EyeLid.R")]
    this.stuff.add(this.octoRoot)
    this.octoRoot.userData.petId = null
    this.leanAmt = 0; this.waveUntil = -1
    // the foreman: what just happened (set by apply, played by update), and the clocks of what is playing
    this.pending = null; this.rollUntil = -1; this.cheerAt = -100; this.clapAt = -100; this.rolling = false
    this.stances = []; this.rollAmt = 0; this.head = 0
    this.blinkAt = -100; this.nextBlinkAt = 2 + seed(id + "b") * 4
    this.deckSlots = null
    // needs you, seen from afar: a red beacon over the crane top and a red ring spreading round the octopus
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: assets.softTex, color: "#ff2a1f", transparent: true, opacity: 0, depthWrite: false }))
    this.beacon.position.set(0, 12.2, 0); this.beacon.visible = false; this.beacon.raycast = none; this.crane.add(this.beacon)
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ff3a2e", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }))
    this.ring.position.set(op.x, 0.12, op.z); this.ring.visible = false; this.ring.raycast = none; this.group.add(this.ring)

    this.workers = new Map()
    this.cargo = []          // by task index
    this.lift = null; this.queue = []
    this.run = null; this.look = berthLook(null)
    this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3()
  }
  get position() { return this.group.position }
  select(on) { this.sel.visible = on }
  // Take the berth out of the scene and free what it owns alone: smoke, glow, beacon and ring materials.
  dispose() {
    this.group.removeFromParent(); this.ship.dispose()
    this.glow.material.dispose(); this.beacon.material.dispose(); this.ring.material.dispose(); this.ring.geometry.dispose()
  }
  // Where the label goes.
  labelPoint(out) { return this.ship.top(out, this.group.position) }
  // The ship's current place in the world.
  focus(out) { return out.set(this.group.position.x + this.ship.group.position.x, 2, this.group.position.z + this.ship.group.position.z) }

  // A deck spot of container i in the berth's frame, for the ship as it is now.
  deckSpot(i, out) {
    const p = deckToBerth(deckPosition(i), this.ship.group.position, this.ship.scale)
    return out.set(p.x, p.y, p.z)
  }
  // Take a container into the ship's frame (its place on deck) or out of it (to where it stands in the berth).
  toShip(c) {
    const p = deckPosition(c.idx)
    this.ship.deck.add(c.root); c.frame = "ship"; c.pos.set(p.x, p.y, p.z); c.target.copy(c.pos); c.scale = 1; c.goalScale = 1; c.yaw = c.goalYaw = p.angle; c.pending = false; c.towards = false
  }
  toBerth(c) {
    this.deckSpot(c.idx, c.pos)
    this.stuff.add(c.root); c.frame = "berth"; c.scale = this.ship.scale; c.pending = false; c.towards = false
  }

  // Apply a run from the scene: what changed becomes the new target; `snap` skips the easing.
  apply(run, snap = false) {
    const k = this.kit, look = berthLook(run)
    // what changed since the last push (not on the first sight, and not when snapping to a still)
    if (!snap && this.run) {
      const ev = crewEvents(this.run, run)
      if (ev.rollCall || ev.done.length || ev.castOff) { const p = this.pending || (this.pending = { rollCall: false, done: false, castOff: false }); p.rollCall ||= ev.rollCall; p.done ||= ev.done.length > 0; p.castOff ||= ev.castOff }
    }
    const fresh = !!this.run && !snap
    this.run = run; this.look = look
    const o = look.orchestrator
    this.octoRoot.userData.petId = run.orchestrator && typeof run.orchestrator.id === "string" ? run.orchestrator.id : null
    k.fade(this.octoRoot, Math.min(o.opacity, 1))
    const sp = shipPosition(look.castOff, look.scale); this.shipGoal = { x: sp.x, z: sp.z }
    if (snap) this.ship.group.position.set(sp.x, 0, sp.z)
    this.ship.setLook(look, run.prs || [], snap)
    this.syncWorkers(run.workers || [], snap, fresh)
    const plan = containerPlan(run.tasks || [], look.castOff, this.deckSlots)
    this.deckSlots = plan.map(p => (p.zone === "deck" ? p.index : null))
    this.ship.setMore(deckOverflow((run.tasks || []).map(stageOf)) > 0)
    this.syncCargo(plan, snap)
    this.refreshStances()
  }

  // What each crab does (from crew.js), by its place in the run's worker list.
  refreshStances() {
    const checking = new Set()
    for (const e of this.workers.values()) if (e.checkUntil !== null) checking.add(e.id)
    this.stances = crewStances(this.run, this.rolling, checking)
    for (const e of this.workers.values()) e.st = this.stances[e.idx] || { stance: "stand" }
  }

  syncCargo(plan, snap) {
    while (this.cargo.length > plan.length) { const c = this.cargo.pop(); this.queue = this.queue.filter(q => q !== c); if (this.lift?.c === c) this.lift = null; c.root.parent?.remove(c.root) }
    plan.forEach((p, i) => {
      let c = this.cargo[i]
      if (!c) {
        c = makeCargo(this.kit); c.idx = i; this.cargo[i] = c
        this.stuff.add(c.root)
        if (p.zone === "deck") this.deckSpot(p.index, c.pos)
        else if (p.zone !== "none") c.pos.set(p.x, p.y, p.z)
        c.scale = snap ? 1 : 0
        c.yaw = p.angle
      }
      const prev = c.zone
      c.zone = p.zone; c.idx = p.index === undefined ? i : p.index
      c.tiltGoal = p.tilt
      if (c.color !== p.color) { c.color = p.color; this.kit.paint(c.body, p.color) }
      if (p.zone === "none") { c.goalScale = 0; if (c.frame === "ship") this.toBerth(c); return }
      c.goalYaw = p.angle
      if (p.zone === "deck") {
        c.goalScale = 1
        if (c.frame === "ship") { const d = deckPosition(c.idx); c.target.set(d.x, d.y, d.z) }
        else if (snap) { if (prev === "none" && !c.scale) c.scale = 1; this.toShip(c) }
        else if (!c.pending && !c.towards) {
          if (this.look.craneBusy && c.scale > 0.5) { c.pending = true; this.queue.push(c) }
          else c.towards = true
        }
      } else {
        if (c.frame === "ship") this.toBerth(c)
        c.pending = false; c.towards = false; this.queue = this.queue.filter(q => q !== c); if (this.lift?.c === c) this.lift = null
        c.goalScale = 1
        c.target.set(p.x, p.y, p.z)
        if (snap) c.pos.copy(c.target)
      }
    })
  }

  // `fresh`: the berth was already on screen, so a crab that has just gone idle or done checks in with the octopus.
  syncWorkers(list, snap, fresh = false) {
    const seen = new Set()
    list.slice(0, MAX_WORKERS).forEach((w, i) => {
      if (typeof w.id !== "string") return
      seen.add(w.id)
      const p = crabLane(i)
      let e = this.workers.get(w.id)
      if (!e) {
        const root = new THREE.Group(), tilt = new THREE.Group(), model = this.kit.make("crab")
        tilt.add(model); root.add(tilt); this.stuff.add(root)
        e = { id: w.id, root, tilt, claws: [part(model, "Claw.L"), part(model, "Claw.R")], home: new THREE.Vector3(p.x, p.y, p.z), target: new THREE.Vector3(), scale: snap ? 1 : 0, goal: 1, ph: seed(w.id) * TAU, waveUntil: -1, tiltAmt: 0, yaw: Math.PI / 2, oz: 0, idx: i, st: { stance: "stand" }, state: undefined, checkUntil: null }
        this.workers.set(w.id, e)
      }
      // a check-in starts on the next frame (update has the clock): Infinity until then
      if (checksIn(e.state, w.state, fresh)) e.checkUntil = Infinity
      else if (w.state !== "idle" && w.state !== "done") e.checkUntil = null
      e.state = w.state
      e.goal = 1; e.target.set(p.x, p.y, p.z); e.look = workerLook(w.state); e.idx = i; e.st = this.stances[i] || { stance: "stand" }
      e.root.userData.petId = w.id
      if (snap) e.home.copy(e.target)
    })
    for (const [id, e] of this.workers) if (!seen.has(id)) e.goal = 0
  }

  // The octopus and every worker by scene id, for pokes.
  waveTarget(id, t) {
    if (this.run?.orchestrator?.id === id) { this.waveUntil = t + 2; return true }
    const e = this.workers.get(id)
    if (e && e.goal) { e.waveUntil = t + 2; return true }
    return false
  }
  // The world point of the crane's top, where a gull may perch.
  perchPoint(out) { const c = cranePosition(); return out.set(this.group.position.x + c.x + 0.5, c.y + 11.5, this.group.position.z + this.craneZ) }
  // The crab at place i in the worker list.
  crabAt(i) { for (const e of this.workers.values()) if (e.idx === i && e.goal) return e; return null }
  // The world place of a creature of this berth by its scene id (bubbles rise from it), or null.
  creaturePoint(id, out) {
    if (this.run?.orchestrator?.id === id) return this.octoRoot.getWorldPosition(out).setY(1)
    const e = this.workers.get(id)
    return e ? e.root.getWorldPosition(out) : null
  }

  // Animate. `env`: { t, dt, camera, motion (1 or 0), night }.
  update(env) {
    const { t, dt, camera } = env
    const m = env.motion, look = this.look, o = look.orchestrator, ph = this.ph
    const gx = this.group.position.x, gz = this.group.position.z

    // ship: glides out when it has cast off
    this.ship.group.position.x += (this.shipGoal.x - this.ship.group.position.x) * damp(dt, 3)
    this.ship.group.position.z += (this.shipGoal.z - this.ship.group.position.z) * damp(dt, 1.2)
    this.ship.update(t, dt, m, env.night, gx + this.ship.group.position.x, gz + this.ship.group.position.z)

    // what just happened: a roll call, a cheer, a wave-off (set by apply)
    if (this.pending) {
      const p = this.pending; this.pending = null
      if (p.rollCall) this.rollUntil = t + ROLL_CALL
      if (p.done) { this.cheerAt = t; this.clapAt = t }
      if (p.castOff) this.waveUntil = Math.max(this.waveUntil, t + WAVE_OFF)
    }
    const rolling = this.rollUntil > t
    if (rolling !== this.rolling) { this.rolling = rolling; this.refreshStances() }

    // octopus
    const op = octopusPosition()
    const bob = o.bob ? o.bob.amp * Math.sin((TAU * t) / o.bob.period + ph) * m : 0
    this.octoRoot.position.y = op.y + bob + waveHeight(gx + op.x, gz + op.z, t * m) * 0.5
    const waving = this.waveUntil > t
    const blocked = this.run && !look.parked ? blockedWorker(this.run) : -1
    for (let i = 0; i < 8; i++) {
      const tn = this.tent[i]; if (!tn) continue
      const sway = o.sway ? m : 0
      tn.rotation.x = Math.sin(t * 2.6 + i * 0.8 + ph) * 0.2 * sway
      tn.rotation.z = Math.cos(t * 2.1 + i * 1.1 + ph) * 0.2 * sway
    }
    // working: one tentacle beats slowly, and the crabs walk to the same beat
    if (o.sway && this.tent[5]) this.tent[5].rotation.x += beat(t, ph) * 0.55 * m
    // roll call: Tentacle.2 rises and points at the pier (behind the octopus, towards -Z)
    this.rollAmt += ((rolling ? 1 : 0) - this.rollAmt) * damp(dt, 9)
    if (this.rollAmt > 0.01 && this.tent[2]) { this.tent[2].rotation.x = 1.5 * this.rollAmt; this.tent[2].rotation.z = 0 }
    if (o.wave && this.tent[0]) this.tent[0].rotation.z = 0.9 + Math.sin(t * 7 + ph) * 0.45
    // a task became done: clap two tentacles once
    const cl = clap(t, this.clapAt)
    if (cl.raise > 0 && this.tent[0] && this.tent[4]) { const a = 2.9 * cl.raise + 0.6 * cl.close; this.tent[0].rotation.z = a; this.tent[4].rotation.z = -a }
    if (waving) {
      this.tent[0].rotation.z = 1.2 + Math.sin(t * 13) * 0.7
      if (this.tent[4]) this.tent[4].rotation.z = -(1.2 + Math.sin(t * 13 + 1) * 0.7)
    }
    // blink every 3 to 6 s (not with reduced motion)
    if (m && t >= this.nextBlinkAt) { this.blinkAt = t; this.nextBlinkAt = nextBlink(t, seed(this.id + Math.floor(t))) }
    const lid = Math.max(o.eyelids, m ? lidClosed(t, this.blinkAt) : 0)
    for (const l of this.lids) { l.scale.setScalar(lid); l.visible = lid > 0.02 }
    // the head: follows the camera within 50° of its heading, or looks at a blocked crab (and leans towards it)
    const ox = gx + this.octoRoot.position.x, oz = gz + this.octoRoot.position.z
    let look3 = camera.position, lookLimit = 0
    if (blocked >= 0 && !(this.run && this.run.needsYou === true)) { const e = this.crabAt(blocked); if (e) { look3 = this.tmp2.set(gx + e.root.position.x, 0, gz + e.root.position.z); lookLimit = 1 } }
    const yawGoal = m ? headTarget(look3.x - ox, look3.z - oz, lookLimit ? 2.2 : undefined) : 0
    this.head += (yawGoal - this.head) * damp(dt, lookLimit ? 3 : 0.8)
    this.octoRoot.rotation.y = op.angle + this.head
    const leaning = o.lean || lookLimit
    this.leanAmt += ((leaning ? 0.22 : 0) - this.leanAmt) * damp(dt, 4)
    if (this.leanAmt > 0.002) {
      // the direction to look at (the camera, or the blocked crab) in the octopus's own frame
      const wx = look3.x - ox, wz = look3.z - oz
      const c = Math.cos(this.octoRoot.rotation.y), s = Math.sin(this.octoRoot.rotation.y)
      const dx = wx * c - wz * s, dz = wx * s + wz * c, n = Math.hypot(dx, dz) || 1
      this.octoLean.quaternion.setFromAxisAngle(this.tmp.set(dz / n, 0, -dx / n), this.leanAmt)
    } else this.octoLean.quaternion.identity()

    // check-ins: start the clock of the new ones, end the ones whose time is up
    let checks = false
    for (const e of this.workers.values()) {
      if (e.checkUntil === Infinity) { e.checkUntil = t + CHECK_IN; checks = true }
      else if (e.checkUntil !== null && t >= e.checkUntil) { e.checkUntil = null; checks = true }
    }
    if (checks) this.refreshStances()

    // crabs: what each does comes from crew.js (work in step with the beat, check in, potter, roll call, face the camera, hop)
    for (const [id, e] of this.workers) {
      e.scale += (e.goal - e.scale) * damp(dt, 8)
      if (!e.goal && e.scale < 0.03) { this.stuff.remove(e.root); this.workers.delete(id); continue }
      const st = e.st, stance = st.stance
      if (st.spot) e.target.set(st.spot.x, e.target.y, st.spot.z)
      else { const p = crabLane(e.idx); e.target.set(p.x, p.y, p.z) }
      ease(e.home, e.target, dt)
      const l = e.look, tau = TAU / l.period
      let oy = 0, clawA = 0.2, yaw = Math.PI / 2, goalOz = 0
      if (stance === "work") { const w = walk(t, ph, l.amp); goalOz = w.oz * m; yaw = m ? w.yaw : Math.PI / 2; clawA = 0.25 + Math.sin(t * 9 + e.ph) * 0.15 * m }
      else if (stance === "busy") { const w = walk(t * 0.7, e.ph, 1.4); goalOz = w.oz * m; yaw = m ? w.yaw : Math.PI / 2; clawA = 0.25 + (0.5 + 0.5 * Math.sin(t * 5 + e.ph)) * 0.35 * m }
      else if (stance === "roll" || stance === "facing") goalOz = e.oz
      if (stance === "roll") yaw = faceOctopus(e.home.x, e.home.z + e.oz)
      else if (stance === "facing") yaw = 0
      else if (stance === "gather") yaw = faceOctopus(e.home.x, e.home.z)
      if (stance === "work" || stance === "busy") e.oz += (goalOz - e.oz) * damp(dt, 8) // eased, so a crab that starts walking does not jump to its place in the stroke
      else e.oz += (goalOz - e.oz) * damp(dt, 6)
      if (stance === "hop" || (stance === "facing" && st.hop)) oy = Math.abs(Math.sin(t * tau * 0.5 + e.ph)) * 0.25 * m
      else if (stance === "roll" || stance === "gather" || stance === "facing") clawA = 0.25 + (0.5 + 0.5 * Math.sin(t * 2.4 + e.ph)) * 0.2 * m
      else if (stance !== "work" && l.motion === "claws") clawA = 0.25 + (0.5 + 0.5 * Math.sin(t * tau + e.ph)) * 0.45 * m
      oy += cheer(t, this.cheerAt, e.idx)
      const w = e.waveUntil > t
      if (w) { oy = Math.abs(Math.sin(t * 9)) * 0.25; clawA = 0.9 + Math.sin(t * 14) * 0.5 }
      e.root.position.set(e.home.x, e.home.y + oy, e.home.z + e.oz)
      let dy = yaw - e.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); e.yaw += dy * damp(dt, 10)
      e.root.rotation.y = e.yaw
      e.root.scale.setScalar(CRAB_SCALE * Math.max(e.scale, 0.001))
      e.tiltAmt += ((stance === "stand" ? (l.tilt * Math.PI) / 180 : 0) - e.tiltAmt) * damp(dt, 5)
      e.tilt.rotation.z = e.tiltAmt
      e.claws[0].rotation.y = -clawA; e.claws[1].rotation.y = clawA
      if (w) { e.claws[0].rotation.z = Math.abs(clawA) * 0.8; e.claws[1].rotation.z = -Math.abs(clawA) * 0.8 } else { e.claws[0].rotation.z = 0; e.claws[1].rotation.z = 0 }
    }

    this.updateCargo(env)
    this.updateCrane(env)
    this.updateSignal(env)
    this.updateBeacon(env)
  }

  // Containers ease to their places; a finished one rides the crane's hook to the deck when the crane is busy.
  updateCargo(env) {
    const { t, dt } = env
    if (!this.lift && this.queue.length) { const c = this.queue.shift(); this.lift = { c, p: 0, from: c.pos.clone() } }
    for (const c of this.cargo) {
      c.scale += (c.goalScale - c.scale) * damp(dt, 8)
      let dy = c.goalYaw - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); c.yaw += dy * damp(dt, 8)
      c.tiltAmt += (c.tiltGoal - c.tiltAmt) * damp(dt, 5)
      c.tilt.rotation.x = c.tiltAmt
      c.root.visible = c.scale > 0.02
      const lifting = this.lift && this.lift.c === c
      if (lifting) {
        const L = this.lift, D = this.deckSpot(c.idx, this.tmp)
        L.p = Math.min(1, L.p + dt / LIFT_S)
        const p = L.p
        if (p < 0.3) { const q = smooth(p / 0.3); c.pos.set(L.from.x, L.from.y + (LIFT_TOP - L.from.y) * q, L.from.z) }
        else if (p < 0.7) { const q = smooth((p - 0.3) / 0.4); c.pos.set(L.from.x + (D.x - L.from.x) * q, LIFT_TOP, L.from.z + (D.z - L.from.z) * q) }
        else { const q = smooth((p - 0.7) / 0.3); c.pos.set(D.x, LIFT_TOP + (D.y - LIFT_TOP) * q, D.z) }
        c.scale += (this.ship.scale - c.scale) * damp(dt, 6)
        if (p >= 1) { this.lift = null; this.toShip(c) }
      } else if (c.frame === "berth") {
        if (c.pending) { /* waits its turn at its place */ }
        else if (c.towards) {
          const D = this.deckSpot(c.idx, this.tmp)
          ease(c.pos, D, dt)
          if (c.pos.distanceTo(D) < 0.06) this.toShip(c)
        } else ease(c.pos, c.target, dt)
      } else ease(c.pos, c.target, dt)
      c.root.position.copy(c.pos)
      c.root.rotation.y = c.yaw
      const sc = c.frame === "ship" ? c.scale : c.scale * (c.towards || lifting ? this.ship.scale : 1)
      c.root.scale.setScalar(Math.max(sc, 0.001))
    }
  }

  // The crane: at rest, working (trolley and hook move), or travelling along the pier with a lifted container.
  updateCrane(env) {
    const { t, dt } = env, cp = cranePosition()
    const c = this.lift?.c
    const goalZ = c ? c.pos.z : cp.z
    this.craneZ += (goalZ - this.craneZ) * damp(dt, 6)
    this.crane.position.z = this.craneZ
    let tx = 0, hy = -1
    if (c) { tx = clamp(c.pos.x - cp.x, 0, 7); hy = clamp(c.pos.y + 1.1 + 0.5 - (cp.y + 9), -6, -1) }
    else if (this.look.craneBusy) { tx = 3.5 + 3.5 * Math.sin(t * 0.6 + this.ph) * env.motion; hy = -3.5 + 2 * Math.sin(t * 1.3 + this.ph) * env.motion }
    this.trolleyX += (tx - this.trolleyX) * damp(dt, c ? 10 : 3)
    this.hookGoal += (hy - this.hookGoal) * damp(dt, c ? 10 : 3)
    this.trolley.position.x = this.trolleyX
    this.hook.position.y = this.hookGoal
  }

  // Needs you: the beacon pulses once a second and the ring spreads from 3 to 6 m every 2 s (both steady with
  // reduced motion).
  updateBeacon(env) {
    const on = this.look.beacon, still = env.motion === 0, t = env.t + this.ph
    this.beacon.visible = this.ring.visible = on
    if (!on) return
    const pulse = still ? 1 : 0.5 + 0.5 * Math.sin(t * TAU)
    this.beacon.scale.setScalar(2.6 + 1.2 * pulse); this.beacon.material.opacity = 0.55 + 0.45 * pulse
    const p = still ? 0.5 : (t % 2) / 2
    this.ring.scale.setScalar(3 + 3 * p); this.ring.material.opacity = still ? 0.5 : 0.8 * (1 - p)
  }

  // The signal head: one lamp lit (the red one blinks, with a glow), the others dark.
  updateSignal(env) {
    const { t, night } = env, s = this.look.signal
    const on = s.lamp === "red" ? (Math.sin(t * 5 + this.ph) > -0.2 || env.motion === 0 ? "Red" : null) : s.lamp === "green" ? "Green" : s.lamp === "amber" ? "Amber" : null
    if (this.lampOn !== on) {
      this.lampOn = on
      for (const n of ["Red", "Amber", "Green"]) this.kit.setMat(this.lamps[n], n === on ? this.a.signal[n].on : this.a.signal[n].off)
    }
    this.glow.visible = on === "Red"
    if (on === "Red") this.glow.material.opacity = Math.min(1, 0.7 + night * 0.3)
  }
}

// A parked ship at anchor in the roadstead: bow to the east, three haze sprites over it, no crew, no signal.
export class Anchored {
  constructor(assets, id, pos) {
    this.a = assets; this.kit = assets.kit; this.id = id; this.ph = seed(id) * TAU
    this.group = new THREE.Group(); this.group.position.set(pos.x, 0, pos.z); this.group.rotation.y = pos.angle
    this.group.userData.berth = this
    this.ship = new Ship(assets); this.ship.ph = this.ph; this.group.add(this.ship.group)
    this.sel = frameOf(assets, -5, 5, -12, 12); this.group.add(this.sel)
    this.haze = new THREE.Group()
    for (let j = 0; j < 3; j++) { const s = new THREE.Sprite(assets.hazeMat); const p = hazePosition(j); s.position.set(p.x, p.y, p.z); s.scale.setScalar(8); s.raycast = none; this.haze.add(s) }
    this.ship.group.add(this.haze)
    this.cargo = []; this.run = null; this.look = berthLook(null)
  }
  get position() { return this.group.position }
  select(on) { this.sel.visible = on }
  dispose() { this.group.removeFromParent(); this.ship.dispose() }
  labelPoint(out) { return out.set(this.group.position.x, 10.5 * this.ship.scale, this.group.position.z) }
  focus(out) { return out.set(this.group.position.x, 2, this.group.position.z) }
  place(pos) { this.group.position.set(pos.x, 0, pos.z) }
  apply(run, snap = false) {
    const look = berthLook(run)
    this.run = run; this.look = look
    this.ship.setLook({ ...look, smoke: false }, run.prs || [], true)
    this.ship.setMore(deckOverflow((run.tasks || []).map(stageOf)) > 0)
    const plan = containerPlan(run.tasks || []).filter(p => p.zone === "deck")
    while (this.cargo.length > plan.length) this.ship.deck.remove(this.cargo.pop().root)
    plan.forEach((p, i) => {
      let c = this.cargo[i]
      if (!c) { c = makeCargo(this.kit); c.scale = 1; this.cargo[i] = c; this.ship.deck.add(c.root) }
      const d = deckPosition(p.index)
      c.root.position.set(d.x, d.y, d.z); c.root.rotation.y = d.angle
      if (c.color !== p.color) { c.color = p.color; this.kit.paint(c.body, p.color) }
    })
  }
  waveTarget() { return false }
  update(env) {
    this.ship.update(env.t, env.dt, env.motion, env.night, this.group.position.x, this.group.position.z)
    this.haze.children.forEach((s, i) => { s.position.x = hazePosition(i).x + Math.sin(env.t * 0.2 + i * 2 + this.ph) * 1.2 * env.motion })
  }
}

// An adrift agent: a crab on a driftwood raft inside the breakwater, bobbing on the waves.
export class Raft {
  constructor(kit, id, slot) {
    this.kit = kit; this.id = id; this.slot = slot; this.ph = seed(id) * TAU
    const p = adriftPosition(slot)
    this.group = new THREE.Group(); this.angle = p.angle
    this.home = new THREE.Vector3(p.x, 0, p.z); this.target = this.home.clone()
    this.wood = kit.make("driftwood"); this.group.add(this.wood)
    this.crabRoot = new THREE.Group(); this.crabRoot.position.set(0, 0.2, 0); this.crabRoot.scale.setScalar(CRAB_SCALE)
    this.crab = kit.make("crab"); this.crabRoot.add(this.crab); this.group.add(this.crabRoot)
    this.claws = [part(this.crab, "Claw.L"), part(this.crab, "Claw.R")]
    this.scale = 0; this.goal = 1; this.look = workerLook("idle"); this.waveUntil = -1
    this.group.userData.raft = this; this.crabRoot.userData.petId = id
  }
  apply(a, snap) { this.look = workerLook(a.state); if (snap) this.scale = 1 }
  dispose() { this.group.removeFromParent() }
  setSlot(slot) { this.slot = slot; const p = adriftPosition(slot); this.target.set(p.x, 0, p.z); this.angle = p.angle }
  waveTarget(id, t) { if (id === this.id && this.goal) { this.waveUntil = t + 2; return true } return false }
  creaturePoint(id, out) { return id === this.id ? this.crabRoot.getWorldPosition(out) : null }
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
    else if (l.motion === "walk") clawA = 0.25 + Math.sin(t * 9 + this.ph) * 0.15 * m
    else if (l.motion === "hop") oy = Math.abs(Math.sin(t * 4 + this.ph)) * l.amp * m
    if (w) { oy = Math.abs(Math.sin(t * 9)) * 0.25; clawA = 0.9 + Math.sin(t * 14) * 0.5 }
    this.crabRoot.position.y = 0.2 + oy
    this.crabRoot.rotation.z = (l.tilt * Math.PI) / 180
    this.claws[0].rotation.y = -clawA; this.claws[1].rotation.y = clawA
  }
}
