// Read-replica selection for a read/write-split connection.
//
// The adapter builds ONE picker per split connection and calls it once per
// read terminal — after the sticky check, so a sticky hit never consumes a
// pick. Strategies: round-robin (the default and the historical behavior),
// uniform random, weighted random (one weight per replica), or a
// caller-supplied index function (the escape hatch — Drizzle's `getReplica`
// equivalent). The Drizzle adapter shares this module via the
// `@rudderjs/orm/native` re-export shim, so both engines validate and pick
// identically.

/**
 * How reads pick a replica on a read/write-split connection.
 *
 * - `'round-robin'` (default) — cycle through the replicas in `read.url` order.
 * - `'random'` — uniform random per query.
 * - `number[]` — weighted random: one non-negative weight per replica, in
 *   `read.url` order. `[3, 1]` sends ~75% of reads to the first replica —
 *   size weights to replica capacity.
 * - `(count) => index` — custom: called once per read query with the replica
 *   count; returns the index of the replica to serve it.
 */
export type ReadReplicaPicker =
  | 'round-robin'
  | 'random'
  | readonly number[]
  | ((count: number) => number)

/**
 * Build the per-query index picker for `count` replicas. Weight lists are
 * validated here — at adapter construction, so a bad list fails fast at boot
 * (default connection) or first use (named connection), not per query. A
 * custom function's return value is validated on every call instead (it can't
 * be proven sound up front). `rng` returns a float in `[0, 1)` and is
 * injectable for deterministic tests only.
 */
export function makeReplicaPicker(
  picker: ReadReplicaPicker | undefined,
  count: number,
  rng: () => number = Math.random,
): () => number {
  if (picker === undefined || picker === 'round-robin') {
    let rr = 0
    return () => rr++ % count
  }
  if (picker === 'random') {
    return () => Math.floor(rng() * count)
  }
  if (typeof picker === 'function') {
    return () => {
      const i = picker(count)
      if (!Number.isInteger(i) || i < 0 || i >= count) {
        throw new Error(
          `[RudderJS DB] Custom read picker returned ${String(i)} — ` +
            `expected an integer replica index in [0, ${count - 1}].`,
        )
      }
      return i
    }
  }

  // Weighted random. One weight per replica, validated up front.
  const weights = picker
  if (weights.length !== count) {
    throw new Error(
      `[RudderJS DB] Read picker weights list has ${weights.length} entr${weights.length === 1 ? 'y' : 'ies'} ` +
        `for ${count} replica(s) — provide one weight per read.url entry.`,
    )
  }
  if (weights.some((w) => typeof w !== 'number' || !Number.isFinite(w) || w < 0)) {
    throw new Error('[RudderJS DB] Read picker weights must be finite numbers >= 0.')
  }
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) {
    throw new Error('[RudderJS DB] Read picker weights must sum to more than 0.')
  }
  return () => {
    let roll = rng() * total
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]!
      if (roll < 0) return i
    }
    // Floating-point edge (roll never went negative): last positive weight.
    for (let i = weights.length - 1; i >= 0; i--) {
      if (weights[i]! > 0) return i
    }
    return 0
  }
}
