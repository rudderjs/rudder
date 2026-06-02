/**
 * Primary-key generators for `static keyType = 'uuid' | 'ulid'`.
 *
 * Both use the Web Crypto API (`globalThis.crypto`) — available in Node 19+
 * and every browser — so this module stays client-bundle safe (no `node:`
 * import in the eval graph; see the Model client-reachability rule).
 */

/** RFC 4122 v4 UUID. */
export function generateUuid(): string {
  return globalThis.crypto.randomUUID()
}

// Crockford Base32 — excludes I, L, O, U to dodge ambiguity. 26 chars total:
// first 10 encode the 48-bit millisecond timestamp, last 16 encode 80 random bits.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ENCODING_LEN = CROCKFORD.length // 32
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(now: number): string {
  let out = ''
  let mod: number
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    mod = now % ENCODING_LEN
    out = CROCKFORD[mod] + out
    now = (now - mod) / ENCODING_LEN
  }
  return out
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < RANDOM_LEN; i++) {
    // Each byte (0–255) folded into the 32-char alphabet — uniform enough for a
    // 80-bit random tail; collision odds are astronomically low per millisecond.
    out += CROCKFORD[bytes[i]! % ENCODING_LEN]
  }
  return out
}

/**
 * Lexicographically sortable 26-char ULID (Crockford Base32). Timestamp-first,
 * so newer keys sort after older ones — handy for cursor pagination on the PK.
 */
export function generateUlid(): string {
  return encodeTime(Date.now()) + encodeRandom()
}
