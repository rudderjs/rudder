// Tiny deterministic PRNG — mulberry32. No Math.random() anywhere in the seed
// path so every size produces a byte-identical dataset on every machine (the
// whole bench's credibility rests on all three ORMs measuring the SAME data).

/** @param {number} seed @returns {() => number} a () => float in [0,1) */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic integer in [min, max]. */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1))
}

/** Deterministic pick from an array. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

const WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'labore', 'magna', 'aliqua',
  'enim', 'minim', 'veniam', 'quis', 'nostrud', 'ullamco', 'laboris', 'nisi',
]

/** Deterministic n-word sentence (no Math.random). */
export function words(rng, n) {
  let out = ''
  for (let i = 0; i < n; i++) out += (i ? ' ' : '') + pick(rng, WORDS)
  return out
}
