/**
 * Lightweight fractional indexing for CRDT-friendly sibling ordering.
 *
 * Generates string keys that sort lexicographically between any two keys.
 * Based on the same concept as TLDraw/Excalidraw.
 */

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = CHARS.length

/** Generate a key between `before` and `after`. Either can be empty string. */
export function generateIndex(before = '', after = ''): string {
  if (before === '' && after === '') return 'a0'
  if (before === '') return midpoint('', after)
  if (after === '') return increment(before)
  return midpoint(before, after)
}

/** Generate the first N indices starting from 'a0'. */
export function generateNIndices(n: number): string[] {
  const result: string[] = []
  let prev = ''
  for (let i = 0; i < n; i++) {
    const next = generateIndex(prev, '')
    result.push(next)
    prev = next
  }
  return result
}

function increment(key: string): string {
  // Append a middle character to produce a key that sorts after
  return key + CHARS[Math.floor(BASE / 2)]!
}

function midpoint(a: string, b: string): string {
  // Pad to equal length
  const maxLen = Math.max(a.length, b.length)
  const padA = a.padEnd(maxLen, CHARS[0]!)
  const padB = b.padEnd(maxLen, CHARS[0]!)

  const result: string[] = []
  let carry = false

  for (let i = maxLen - 1; i >= 0; i--) {
    const ca = CHARS.indexOf(padA[i]!)
    const cb = CHARS.indexOf(padB[i]!)
    const mid = Math.floor((ca + cb) / 2)

    if (mid === ca && !carry) {
      result.unshift(CHARS[mid]!)
      // Need to go deeper
      return padA.slice(0, i + 1) + CHARS[Math.floor(BASE / 2)]!
    }

    result.unshift(CHARS[mid]!)
  }

  const out = result.join('')
  // If result equals `a`, append a midpoint character
  if (out === a) return a + CHARS[Math.floor(BASE / 2)]!
  return out
}
