// The small touches that make the harbor feel alive: blinking, a turning head, a jumping fish, perching gulls,
// lights that flicker on at dusk. Pure maths (no three.js) so it can be tested; effects.js and berths.js play it.
// Every random draw takes a `rnd` (0..1) argument, so a test can feed fixed numbers.

const TAU = Math.PI * 2
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const HEAD_LIMIT = (50 * Math.PI) / 180   // the octopus never turns more than 50° from its rest heading

// The octopus blinks every 3 to 6 s: the time of the next blink after `from`.
export const nextBlink = (from, rnd) => from + 3 + clamp(rnd, 0, 1) * 3
// How closed the eyelids are (0 open, 1 shut) at t for a blink that began at `at`: down and up in 0.2 s.
export function lidClosed(t, at) {
  const k = (t - at) / 0.2
  return k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0
}

// The heading the octopus turns to (radians from its rest heading, 0 = the sea) to keep looking at the camera: `dx`, `dz` is the
// camera's offset from the octopus (in the berth's frame, where the octopus rests facing +Z), held within ±50° (`limit` is wider
// when it looks at a blocked crab behind it).
export function headTarget(dx, dz, limit = HEAD_LIMIT) {
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || (dx === 0 && dz === 0)) return 0
  return clamp(Math.atan2(dx, dz), -limit, limit)
}

// A fish jumps every 20 to 40 s.
export const nextFish = (from, rnd) => from + 20 + clamp(rnd, 0, 1) * 20
export const FISH = { duration: 0.9, reach: 3.2, height: 1.4 }
// The fish's place along its jump at progress p (0..1): `along` metres from where it left the water, `y` its height and
// `pitch` the nose's angle up (down on the way back). Both ends are at the water.
export function fishArc(p) {
  const q = clamp(p, 0, 1), { reach, height } = FISH
  return { along: q * reach, y: height * 4 * q * (1 - q), pitch: Math.atan2(height * 4 * (1 - 2 * q), reach) }
}
// The splash ring at the take-off (p = 0) and landing (p = 1) points: its size 0..1 and opacity at `age` seconds since it began.
export function splash(age) {
  const k = age / 1.1
  return k > 0 && k < 1 ? { scale: 0.3 + k * 1.3, opacity: 0.7 * (1 - k) } : { scale: 0, opacity: 0 }
}

// A gull's day: it circles for 20 to 40 s, lands on a perch for 10 to 20 s, then takes off again. `rnd` gives the
// two draws; the answer is [circle seconds, perch seconds].
export const gullCycle = (r1, r2) => [20 + clamp(r1, 0, 1) * 20, 10 + clamp(r2, 0, 1) * 10]
// A gull's state at `age` seconds into its cycle: "circle" (with progress), "land" (flying to the perch over 2.5 s), "perch", "leave" (2.5 s back).
export function gullState(age, [circle, perch]) {
  if (age < circle) return { s: "circle", k: 0 }
  if (age < circle + 2.5) return { s: "land", k: (age - circle) / 2.5 }
  if (age < circle + 2.5 + perch) return { s: "perch", k: 0 }
  if (age < circle + 5 + perch) return { s: "leave", k: (age - circle - 2.5 - perch) / 2.5 }
  return { s: "done", k: 0 }
}

// Lights coming on at dusk: 0 or 1, flickering on within one second of `p` (seconds since this light was told to come on).
// `seed` (0..1) gives each light its own pattern, so a row of them comes on one by one rather than together. Steady 1 from p = 1.
export function flickerOn(p, seed = 0) {
  if (!(p > 0)) return 0
  if (p >= 1) return 1
  return ((p * 9 + seed * 5) % 1) < p * p * 1.2 + 0.1 ? 1 : 0
}
// The delay (0..0.6 s) before light number i of n starts to come on, so they follow one another.
export const lightDelay = (i, n) => (n > 1 ? (i / (n - 1)) * 0.6 : 0)
