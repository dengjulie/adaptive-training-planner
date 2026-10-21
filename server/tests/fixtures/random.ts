/** A seeded random number generator (mulberry32), so fixtures come out the same every run. */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Roughly normal noise in [-1, 1] (the average of three uniform draws, rescaled). */
export const noise = (random: () => number) => (random() + random() + random()) / 1.5 - 1
