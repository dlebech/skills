// Where things stand. Pure maths (metres, Y up, water at y = 0), no three.js, so it can be tested.
// The lighthouse is at the origin; reefs sit on three rings around it; each reef has its own local frame
// (+Z points at the lighthouse).

export const BOAT = { x: 6, y: 0, z: 6 }
export const RINGS = [{ n: 6, r: 18 }, { n: 10, r: 31 }, { n: 14, r: 44 }]
export const MAX_SLOTS = RINGS.reduce((s, r) => s + r.n, 0)
export const MAX_WORKERS = 16
export const MAX_BUOYS = 16
export const MAX_FLAGS = 4
export const MAX_ADRIFT = 12
export const ADRIFT_RADIUS = 10
export const REEF_TOP = 0.6
export const DOCK = { start: 3.6, length: 4 }
export const POLE = { x: -2.6, y: REEF_TOP, z: -1.5 }
export const PALM = { x: 2.4, y: REEF_TOP, z: -2.0 }

// Where slot i (0-based, 0..29) is: its world position and the angle that turns a reef's +Z towards the
// lighthouse. Slots are evenly spaced on their ring; each ring starts half a slot of its own after the
// previous ring's start, so neighbouring rings do not line up.
export function slotPosition(i) {
  if (!Number.isInteger(i) || i < 0 || i >= MAX_SLOTS) return null
  let ring = 0, j = i, start = 0
  for (let k = 0; k < RINGS.length; k++) {
    if (k > 0) start += Math.PI / RINGS[k].n
    if (j < RINGS[k].n) { ring = k; break }
    j -= RINGS[k].n
  }
  const { n, r } = RINGS[ring]
  const a = start + (2 * Math.PI * j) / n
  const x = r * Math.cos(a), z = r * Math.sin(a)
  return { x, y: 0, z, ring, angle: Math.atan2(-x, -z) }
}

// Keep every id that is still there where it was, free the slots of ids that left, and give each new
// id the lowest free slot. Ids that find no slot are simply left out of the map (not drawn).
export function assignSlots(prev, ids, capacity = MAX_SLOTS) {
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

// Worker i on a reef: 0..7 on the circle of radius 2.1, 8..15 on the one of radius 3.0. Eight fixed spots
// per circle, so a new worker never moves the others. `angle` turns the crab to face outward.
export function workerPosition(i) {
  if (!Number.isInteger(i) || i < 0 || i >= MAX_WORKERS) return null
  const second = i >= 8, k = second ? i - 8 : i
  const r = second ? 3.0 : 2.1
  const a = (2 * Math.PI * k) / 8 + (second ? Math.PI / 8 : Math.PI / 4)
  return { x: r * Math.cos(a), y: REEF_TOP, z: r * Math.sin(a), angle: Math.atan2(Math.cos(a), Math.sin(a)), r, circle: a }
}

// The dock's centre (it is 4 m long along Z, deck 0.5 m up): its near end at z = 3.6, far end at 7.6.
export function dockPosition() { return { x: 0, y: 0, z: DOCK.start + DOCK.length / 2 } }

// The crane stands on the dock at its far end.
export function cranePosition() { return { x: 0, y: 0.5, z: DOCK.start + DOCK.length - 0.6 } }

// Buoy i of n: a row 0.9 m apart, centred on the dock's axis, just beyond the dock's end. At most 16.
export function buoyPosition(i, n) {
  const m = Math.min(n, MAX_BUOYS)
  if (!Number.isInteger(i) || i < 0 || i >= m) return null
  return { x: (i - (m - 1) / 2) * 0.9, y: 0, z: DOCK.start + DOCK.length + 1 }
}

// Flag i on the pole (at most 4), stacked downwards 0.7 m apart from near the top.
export function flagPosition(i) {
  if (!Number.isInteger(i) || i < 0 || i >= MAX_FLAGS) return null
  return { x: POLE.x + 0.04, y: POLE.y + 3.1 - 0.7 * i, z: POLE.z }
}

// Raft i of 12 for adrift agents, on a ring of radius 10 around the lighthouse.
export function adriftPosition(i) {
  if (!Number.isInteger(i) || i < 0 || i >= MAX_ADRIFT) return null
  const a = (2 * Math.PI * i) / MAX_ADRIFT
  return { x: ADRIFT_RADIUS * Math.cos(a), y: 0, z: ADRIFT_RADIUS * Math.sin(a), angle: Math.atan2(-Math.cos(a), -Math.sin(a)) }
}

// A slot's reef-local point to world coordinates (the reef is turned by `angle` about Y).
export function toWorld(slot, p) {
  const c = Math.cos(slot.angle), s = Math.sin(slot.angle)
  return { x: slot.x + p.x * c + p.z * s, y: (p.y || 0), z: slot.z - p.x * s + p.z * c }
}
