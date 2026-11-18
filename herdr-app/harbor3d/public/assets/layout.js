// Where things stand in the port. Pure maths (metres, Y up, water at y = 0, north is -Z, the quay edge runs
// east-west at z = QUAY_Z), no three.js, so it can be tested. A berth has a local frame whose origin is on the
// quay edge (+Z towards the sea); a ship's containers use the ship's own frame (bow towards +Z).

export const SLOT_W = 22
export const MAX_BERTHS = 12
export const QUAY_Z = -10
export const QUAY_TOP = 1.2
export const MAX_WORKERS = 8
export const MAX_FLAGS = 4
export const MAX_ADRIFT = 12
export const MAX_YARD = 24
export const MAX_PROGRESS = 12
export const MAX_DECK = 24
export const PIER = { x: -6, length: 26, width: 4 }
export const SHIP = { z: 13, castoffZ: 46, beam: 5, gap: 0.15 }
export const CRANE = { x: -6, y: QUAY_TOP, z: 14 }
export const SIGNAL = { x: -6, y: QUAY_TOP, z: 25 }
// The octopus floats in open water just off the pier's tip, facing the sea, in front of everything on its berth.
export const OCTOPUS = { x: -6, y: -1.4, z: 30 }
// The creatures are drawn bigger than life so that they read as the crew beside an 18 m ship.
export const OCTOPUS_SCALE = 3.2
export const CRAB_SCALE = 2.6
export const MAST_FLAG_TOP = 7.6
export const BASIN = { x: 0, z: 34, ry: 10 }
export const BREAKWATER_Z = 56
export const ROADSTEAD_Z = 78
export const LAND = { z: -22 }
export const CARGO_COLORS = ["#3f8f8a", "#b5653a", "#2f4f6f", "#d9b44a", "#8a5a9c"]

const int = (i, max) => Number.isInteger(i) && i >= 0 && i < max

// A slot's offset from the middle: 0, +1, -1, +2, -2, ... (null outside 0..MAX_BERTHS-1).
export function slotOffset(slot) {
  if (!int(slot, MAX_BERTHS)) return null
  return slot === 0 ? 0 : slot % 2 ? (slot + 1) / 2 : -slot / 2
}

// Berth slot k: where its local origin is on the quay edge.
export function berthPosition(slot) {
  const o = slotOffset(slot)
  return o === null ? null : { x: o * SLOT_W, y: 0, z: QUAY_Z, offset: o }
}

// Keep every id that is still there where it was, free the slots of ids that left, and give each new
// id the lowest free slot. Ids that find no slot are simply left out of the map (not drawn).
export function assignSlots(prev, ids, capacity = MAX_BERTHS) {
  const next = new Map()
  const taken = new Set()
  for (const id of ids) {
    const s = prev.get(id)
    if (s !== undefined && s < capacity && !taken.has(s)) { next.set(id, s); taken.add(s) }
  }
  let free = 0
  for (const id of ids) {
    if (next.has(id)) continue
    while (free < capacity && taken.has(free)) free++
    if (free >= capacity) break
    next.set(id, free); taken.add(free)
  }
  return next
}

// The lowest and highest offset of the slots in use (0, 0 when none), from a list of slot numbers.
export function offsetRange(slots) {
  let lo = 0, hi = 0
  for (const s of slots) { const o = slotOffset(s); if (o !== null) { lo = Math.min(lo, o); hi = Math.max(hi, o) } }
  return { lo, hi }
}

// The breakwater's half-width W for the slots in use: (largest used |offset| + 1) quay segments and 14 m.
export function breakwaterWidth(slots) {
  const { lo, hi } = offsetRange(slots)
  return (Math.max(-lo, hi) + 1) * SLOT_W + 14
}

// The x of every quay segment (22 m long): one per used offset plus one at each end.
export function quaySegments(slots) {
  const { lo, hi } = offsetRange(slots), out = []
  for (let o = lo - 1; o <= hi + 1; o++) out.push(o * SLOT_W)
  return out
}

// A floodlight mast on the quay edge between every two neighbouring slots and one beyond each end (z = -12).
export function floodlightPositions(slots) {
  const { lo, hi } = offsetRange(slots), out = []
  for (let o = lo - 1; o <= hi; o++) out.push({ x: o * SLOT_W + SLOT_W / 2, y: QUAY_TOP, z: QUAY_Z - 2 })
  return out
}

// ---- inside a berth (local frame) ----
export const pierPosition = () => ({ x: PIER.x, y: 0, z: 0 })
export const cranePosition = () => ({ ...CRANE })
export const signalPosition = () => ({ ...SIGNAL })
export const octopusPosition = () => ({ ...OCTOPUS, angle: 0 })

// The ship alongside (cast off: out in the fairway, same heading). Its x follows its size on purpose: the hull's
// side must always touch the pier's fenders (east edge x = -4, 0.15 m of clearance), so the centre sits half
// the ship's beam (5 m x scale) beyond it. The design's fixed x of 0.8 left a 2 m gap for a medium ship.
export function shipPosition(castOff = false, scale = 1) { return { x: PIER.x + PIER.width / 2 + (SHIP.beam / 2) * scale + SHIP.gap, y: 0, z: castOff ? SHIP.castoffZ : SHIP.z } }

// A container as the model is built: 1.1 wide (x), 1.1 high, 2.4 long along z (door bars reach 0.045 past the far end).
// At angle 0 its length runs along z, which is how every slot below lays it out (along the pier and the ship).
export const CONTAINER = { w: 1.1, h: 1.1, z0: -1.2, z1: 1.245 }
// One storey of stacking: the container's height and a 5 cm gap, so tiers never share a face.
export const TIER = 1.15

// Planned container i in the yard on the quay: 4 across, 2 high, then further rows back, 2.6 m apart so
// the 2.4 m containers leave a gap. At most 24.
export function yardPosition(i) {
  if (!int(i, MAX_YARD)) return null
  const col = i % 4, tier = Math.floor(i / 4) % 2, row = Math.floor(i / 8)
  return { x: [-3, -0.4, 2.2, 4.8][col], y: QUAY_TOP + tier * TIER, z: -5 - row * 2.6, angle: 0 }
}

// Container i in progress, on the pier's west side: z = 4, 6.8, 9.6, then past the crane's legs (z 12.5 to 15.5)
// at 17.4, 20.2, 23 (6 of them), then a second tier. At most 12.
export function progressPosition(i) {
  if (!int(i, MAX_PROGRESS)) return null
  return { x: -7.2, y: QUAY_TOP + Math.floor(i / 6) * TIER, z: [4, 6.8, 9.6, 17.4, 20.2, 23][i % 6], angle: 0 }
}

// Deck slot i in the ship's own frame: 3 across, 4 rows stern to bow, tier 1 first, then tier 2. At most 24.
export function deckPosition(i) {
  if (!int(i, MAX_DECK)) return null
  return { x: [-1.3, 0, 1.3][i % 3], y: 1.6 + Math.floor(i / 12) * TIER, z: [-3.5, -0.9, 1.7, 4.3][Math.floor(i / 3) % 4], angle: 0 }
}

// A deck spot in the berth's frame, for a ship at `ship` (its position) and uniform `scale`.
export function deckToBerth(p, ship, scale) {
  return { x: ship.x + p.x * scale, y: ship.y + p.y * scale, z: ship.z + p.z * scale }
}

// Which deck slot each task's container takes (null when the task is not done or the deck is full). A task keeps
// the slot it had (`prev`, the last answer) while it stays done, so nothing shuffles when another task finishes;
// a newly done task takes the lowest free slot, in task order. A tier-2 container whose slot below is empty
// drops to the lowest free one, so a second tier never floats or starts before the first is full.
export function deckAssign(prev, stages) {
  const out = stages.map(() => null), used = new Set()
  const old = Array.isArray(prev) ? prev : []
  stages.forEach((st, i) => { const s = old[i]; if (st === "done" && int(s, MAX_DECK) && !used.has(s)) { out[i] = s; used.add(s) } })
  stages.forEach((st, i) => { const s = out[i]; if (s !== null && s >= 12 && !used.has(s - 12)) { used.delete(s); out[i] = null } })
  let free = 0
  stages.forEach((st, i) => {
    if (st !== "done" || out[i] !== null) return
    while (free < MAX_DECK && used.has(free)) free++
    if (free < MAX_DECK) { out[i] = free; used.add(free) }
  })
  return out
}

// How many done tasks do not fit on the deck.
export const deckOverflow = stages => Math.max(0, stages.filter(s => s === "done").length - MAX_DECK)

// Where each task's container goes, from the tasks' stages. Returns one { zone, index, ...position } per task
// (`zone` yard | pier | deck | none when over the caps). Yard and pier count in task order; the deck uses
// `deckSlots` (from deckAssign) so a container keeps its place.
export function containerSlots(stages, deckSlots = null) {
  const slots = deckSlots || deckAssign([], stages)
  const next = { yard: 0, pier: 0 }
  return stages.map((stage, t) => {
    if (stage === "done") { const s = slots[t], p = int(s, MAX_DECK) ? deckPosition(s) : null; return p ? { zone: "deck", index: s, ...p } : { zone: "none", index: -1 } }
    const zone = stage === "planned" ? "yard" : "pier"
    const i = next[zone]++
    const p = zone === "yard" ? yardPosition(i) : progressPosition(i)
    return p ? { zone, index: i, ...p } : { zone: "none", index: i }
  })
}

// Every drawn container of a run as a box in world metres, { task, zone, min: [x, y, z], max: [x, y, z] }, for the
// berth in `slot`, a ship of uniform `scale` and `castOff`. Deck boxes are the container grown by the ship's scale.
// This is what the "no two containers touch" test and any collision check read.
export function containerBoxes(stages, { slot = 0, scale = 1, castOff = false, deckSlots = null } = {}) {
  const b = berthPosition(slot) || { x: 0, y: 0, z: QUAY_Z }
  const sh = shipPosition(castOff, scale)
  return containerSlots(stages, deckSlots).flatMap((c, task) => {
    if (c.zone === "none" || (castOff && c.zone === "pier")) return []
    const k = c.zone === "deck" ? scale : 1
    const turned = Math.abs(Math.sin(c.angle)) > 0.5
    const [x0, x1, z0, z1] = turned ? [CONTAINER.z0, CONTAINER.z1, -CONTAINER.w / 2, CONTAINER.w / 2] : [-CONTAINER.w / 2, CONTAINER.w / 2, CONTAINER.z0, CONTAINER.z1]
    const o = c.zone === "deck" ? { x: b.x + sh.x + c.x * scale, y: c.y * scale, z: b.z + sh.z + c.z * scale } : { x: b.x + c.x, y: c.y, z: b.z + c.z }
    return [{ task, zone: c.zone, min: [o.x + x0 * k, o.y, o.z + z0 * k], max: [o.x + x1 * k, o.y + CONTAINER.h * k, o.z + z1 * k] }]
  })
}

// Crab lane spot i (at most 8): one lane at x = -6 down the pier's deck, spread along z = 1.5 to 22.5.
export function crabLane(i) {
  if (!int(i, MAX_WORKERS)) return null
  return { x: -6, y: QUAY_TOP, z: 1.5 + i * 3 }
}

// Flag i on the ship's mast (at most 4), stacked down from y 7.6 in the mast's frame, 0.7 m apart.
export function flagPosition(i) {
  if (!int(i, MAX_FLAGS)) return null
  return { x: 0.04, y: MAST_FLAG_TOP - 0.7 * i, z: 0 }
}

// ---- the sea ----
// Parked ship i of n: anchored in the roadstead south of the breakwater, 20 m apart, bow to the east.
export function roadsteadPosition(i, n) {
  if (!int(i, MAX_BERTHS) || !(n > i)) return null
  return { x: (i - (n - 1) / 2) * 20, y: 0, z: ROADSTEAD_Z, angle: Math.PI / 2 }
}

// Haze sprite j (0..2) over a parked ship, in the ship's frame.
export function hazePosition(j) { return { x: [-4, 0.5, 4.5][j] ?? 0, y: [3, 5, 3.5][j] ?? 3, z: [1, -1.5, 0.5][j] ?? 0 } }

// Breakwater boulders: two arms along z = 56 from x = ±W to x = ±14, a boulder every 3.2 m with a small
// deterministic wobble in position, turn and size. Returns [{ x, y, z, rot, scale }].
export function rockPositions(W) {
  const out = []
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (const side of [-1, 1]) {
    for (let d = 14; d <= W; d += 3.2) out.push({ x: side * d + (rnd() - 0.5) * 0.8, y: -0.2 + rnd() * 0.3, z: BREAKWATER_Z + (rnd() - 0.5) * 1.4, rot: rnd() * Math.PI * 2, scale: 0.85 + rnd() * 0.4 })
  }
  return out
}

// The two entrance markers at the inner ends of the arms: red on the west side, green on the east.
export function markerPositions() { return [{ x: -14, y: 0, z: BREAKWATER_Z, color: "red" }, { x: 14, y: 0, z: BREAKWATER_Z, color: "green" }] }

// Four fairway buoys between the berths and the harbour mouth: two red, two green.
export function buoyPositions() {
  return [{ x: -8, z: 46, color: "red" }, { x: -8, z: 62, color: "red" }, { x: 8, z: 46, color: "green" }, { x: 8, z: 62, color: "green" }]
}

// Raft i of 12 for adrift agents: z = 50, spread along X inside the breakwater (5.5 m apart, middle first).
export function adriftPosition(i) {
  const o = slotOffset(i)
  return o === null ? null : { x: o * 5.5, y: 0, z: 50, angle: Math.PI / 2 + (i % 3) * 0.4 }
}

// The tug: moored alongside the quay, or on its ellipse in the basin. `t` is the time, `period` seconds per
// lap, W the breakwater's half-width. Returns { x, z, angle } with the angle turning the bow along the way.
export const TUG_MOORED = { x: 10, y: 0, z: -7.5, angle: Math.PI / 2 }
export function tugPosition(t, period, W) {
  const a = (2 * Math.PI * t) / period, rx = W * 0.6
  const x = BASIN.x + rx * Math.cos(a), z = BASIN.z + BASIN.ry * Math.sin(a)
  // heading: the bow is the model's +Z; the direction of travel is (-rx sin a, ry cos a)
  return { x, y: 0, z, angle: Math.atan2(-rx * Math.sin(a), BASIN.ry * Math.cos(a)) }
}

// The harbour office, warehouses and silos behind the quay (decor), and the yard clutter: a few grey
// stacks of containers at z = -22, in fixed spots (not random per run).
export const OFFICE = { x: 0, y: QUAY_TOP, z: -34 }
export const WAREHOUSES = [{ x: -26, y: QUAY_TOP, z: -34 }, { x: 26, y: QUAY_TOP, z: -34 }]
export const SILO = { x: -48, y: QUAY_TOP, z: -32 }
export function clutterStacks() {
  const xs = [-72, -61, -40, -33, 14, 37, 44, 58, 70]
  return xs.map((x, i) => ({ x, z: LAND.z + (i % 2) * -1.5, cols: 2 + (i % 3), tiers: 1 + (i % 2), angle: 0 }))
}

// Labels that would sit on top of each other: `items` are { id, x, y, w, h, a } (x the centre, y the bottom
// edge, as drawn). Sorted by screen x, each visible label is raised by its own height (up to 3 levels) while
// its box intersects one already placed. Returns [{ id, x, y, a, raised, anchorY }]; a raised label gets a
// line down to anchorY.
export function declutterLabels(items, levels = 3) {
  const out = [], placed = []
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  for (const it of [...items].sort((p, q) => p.x - q.x)) {
    let y = it.y, level = 0
    const box = yy => ({ x0: it.x - it.w / 2, x1: it.x + it.w / 2, y0: yy - it.h, y1: yy })
    if (it.a > 0) {
      while (level < levels && placed.some(p => hit(box(y), p))) { y -= it.h; level++ }
      placed.push(box(y))
    }
    out.push({ id: it.id, x: it.x, y, a: it.a, raised: level, anchorY: it.y })
  }
  return out
}

// Does a label's box (x centre, y bottom edge, w, h, as drawn) touch the card's rectangle, grown by `pad`?
export function labelUnderCard(l, rect, pad = 8) {
  if (!rect) return false
  return l.x + l.w / 2 > rect.left - pad && l.x - l.w / 2 < rect.right + pad && l.y > rect.top - pad && l.y - l.h < rect.bottom + pad
}

// ---- the camera that fits a berth ----
// The view direction of a selected berth: from the south-east (+X, +Z), 30° above the water. Unit vector from the target to the camera.
export const VIEW_DIR = (() => { const az = Math.atan2(24, 28), el = (30 * Math.PI) / 180; return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)] })()

// The points that must be visible for a berth at `origin` ({ x, z }) with a ship of uniform `scale`: the ship's bow, stern, beam and
// mast top, the crane's top and the end of its boom, the pier's tip, and the octopus off the tip (its whole body, radius included).
export function berthFitPoints(origin, scale = 1) {
  const o = origin, s = shipPosition(false, scale), pts = []
  const at = (x, y, z) => pts.push([o.x + x, y, o.z + z])
  for (const dz of [-9, 9]) for (const dx of [-2.5, 2.5]) at(s.x + dx * scale, 0, s.z + dz * scale)
  at(s.x, MAST_FLAG_TOP * scale + 0.5, s.z - 6.9 * scale)
  at(CRANE.x - 3.03, CRANE.y + 11.46, CRANE.z); at(CRANE.x + 8.02, CRANE.y + 11.46, CRANE.z)
  at(PIER.x, 0, PIER.length)
  const r = 0.72 * OCTOPUS_SCALE
  for (const dx of [-r, r]) for (const dz of [-r, r]) for (const y of [OCTOPUS.y - 0.27 * OCTOPUS_SCALE, OCTOPUS.y + 1.41 * OCTOPUS_SCALE]) at(OCTOPUS.x + dx, y, OCTOPUS.z + dz)
  return pts
}
// The same for an anchored ship at `pos` ({ x, z }), bow to the east: the ship only.
export function anchoredFitPoints(pos, scale = 1) {
  const pts = []
  for (const dx of [-9, 9]) for (const dz of [-2.5, 2.5]) pts.push([pos.x + dx * scale, 0, pos.z + dz * scale])
  pts.push([pos.x, MAST_FLAG_TOP * scale + 0.5, pos.z])
  return pts
}

// The part of a w x h window that is free of the info card and the toolbar, as fractions { left, top, right, bottom } of the window.
// `card` and `bar` are their boxes ({ left, top, right, bottom } in pixels) or null. A card at the side leaves the area to its left; one
// across the full width (a narrow window) leaves the area above it. The toolbar takes a band at the top or the bottom, whichever it is nearer.
export function freeRect(w, h, card, bar, pad = 8) {
  let left = 0, top = 0, right = w, bottom = h
  if (card && card.right > card.left) {
    if (card.right - card.left >= w * 0.9) { if (card.top > h / 2) bottom = Math.min(bottom, card.top - pad); else top = Math.max(top, card.bottom + pad) }
    else if (card.left > w / 2) right = Math.min(right, card.left - pad)
    else left = Math.max(left, card.right + pad)
  }
  if (bar && bar.bottom > bar.top) { if (bar.top > h / 2) bottom = Math.min(bottom, bar.top - pad); else top = Math.max(top, bar.bottom + pad) }
  return { left: left / w, top: top / h, right: right / w, bottom: bottom / h }
}

// Where to put a camera so that every point shows inside `free` (fractions of the window, from freeRect) with `margin` of the free
// size to spare on each side, and the points are centred in it. `fov` is the vertical field of view in radians, `aspect` the window's
// width over height, `dir` the unit vector from the target to the camera (VIEW_DIR). Only the distance and the target change: the target
// slides sideways and up in the view plane, which moves nothing in depth, so each point's bounds are exact and the nearest fitting
// distance is found by bisection. Returns { position: [x, y, z], target: [x, y, z], distance }.
export function fitView(points, { fov, aspect, free, dir = VIEW_DIR, margin = 0.08 }) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const norm = a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l] }
  const fwd = [-dir[0], -dir[1], -dir[2]], right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd)
  const c0 = [0, 1, 2].map(i => (Math.min(...points.map(p => p[i])) + Math.max(...points.map(p => p[i]))) / 2)
  const q = points.map(p => { const v = sub(p, c0); return { x: dot(v, right), y: dot(v, up), z: dot(v, fwd) } })
  const ty = Math.tan(fov / 2), tx = ty * aspect
  const fw = free.right - free.left, fh = free.bottom - free.top
  const L = (free.left + margin * fw) * 2 - 1, R = (free.right - margin * fw) * 2 - 1
  const B = 1 - (free.bottom - margin * fh) * 2, T = 1 - (free.top + margin * fh) * 2
  const near = Math.max(...q.map(p => -p.z)) + 0.5
  // the range of sideways shifts (a) and upward shifts (b) of the target that keep every point inside, for a distance d
  const span = d => {
    let aLo = -Infinity, aHi = Infinity, bLo = -Infinity, bHi = Infinity
    for (const p of q) {
      const dep = d + p.z
      aLo = Math.max(aLo, p.x - R * tx * dep); aHi = Math.min(aHi, p.x - L * tx * dep)
      bLo = Math.max(bLo, p.y - T * ty * dep); bHi = Math.min(bHi, p.y - B * ty * dep)
    }
    return { aLo, aHi, bLo, bHi }
  }
  const fits = d => { const s = span(d); return s.aLo <= s.aHi && s.bLo <= s.bHi }
  let lo = near, hi = near + 10
  while (!fits(hi) && hi < 1e5) hi *= 2
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m }
  const d = hi, s = span(d), a = (s.aLo + s.aHi) / 2, b = (s.bLo + s.bHi) / 2
  const target = [0, 1, 2].map(i => c0[i] + right[i] * a + up[i] * b)
  return { position: [0, 1, 2].map(i => target[i] + dir[i] * d), target, distance: d }
}
