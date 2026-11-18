// The berth memory. The server, not the page, decides which run sits in which slot, so every viewer sees the same order.
// These two capacities are the server's own (a test checks they equal the page's layout.js).
export const MAX_BERTHS = 12
export const MAX_ADRIFT = 12

// The berth memory: real run key -> slot at the quay, real run key -> index among the anchored ships, and real adrift id -> raft
// index. One of these lives as long as the server and is handed to every listener's sanitize. It holds real keys and is never sent anywhere.
export const createSlots = () => ({ quay: new Map(), parked: new Map(), adrift: new Map() })

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
