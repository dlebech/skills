// Sea names and keyed ids. Pure: the same (secret, value) always gives the same answer, and nothing
// here can be reversed to the real key or address without the server-start secret.
import { createHmac } from "node:crypto"

export const SEA_NAMES = ["Kelp Reef", "Gull Rock", "Coral Shelf", "Anchor Bank", "Pelican Point", "Driftwood Cay", "Lantern Shoal", "Mussel Ledge", "Heron Spit", "Sandbar Nine", "Tern Island", "Barnacle Bar", "Seal Skerry", "Otter Cove", "Marlin Deep", "Urchin Flat", "Puffin Stack", "Cockle Strand", "Limpet Head", "Oyster Bed", "Wrack Point", "Plover Key", "Squid Hollow", "Starfish Rise"]
const NUMERALS = ["", "", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]

// HMAC-SHA256 of a value, hex. The secret is random per server start.
const mac = (secret, value) => createHmac("sha256", secret).update(String(value)).digest("hex")

// An id for the browser: "r" or "a" plus the first 8 hex of the keyed hash. Never the real key.
export const hmacId = (secret, prefix, value) => prefix + mac(secret, `id:${value}`).slice(0, 8)

// A sea name for a run key. `names` is a Map key -> name that the caller keeps for the server's lifetime and that is
// only ever added to, so a run keeps its name when the Crew's order changes. A collision gets " II", " III", ...
export function seaName(secret, key, names = new Map()) {
  if (names.has(key)) return names.get(key)
  const base = SEA_NAMES[parseInt(mac(secret, `name:${key}`).slice(0, 8), 16) % SEA_NAMES.length]
  const taken = new Set(names.values())
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base} ${NUMERALS[n] || n}`
  names.set(key, name)
  return name
}
