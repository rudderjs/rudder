// Replica-selection strategies (read/write split) — pure units over
// `makeReplicaPicker`. Routing E2E (which replica actually serves a query)
// lives in read-write-split.test.ts; this file pins the index math and the
// validation behavior of each strategy.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeReplicaPicker } from './replica-picker.js'

/** An rng stub that replays `values` in order (each must be in [0, 1)). */
function rngOf(...values: number[]): () => number {
  let i = 0
  return () => {
    const v = values[i % values.length]!
    i++
    return v
  }
}

test('default (undefined) is round-robin', () => {
  const pick = makeReplicaPicker(undefined, 3)
  assert.deepEqual([pick(), pick(), pick(), pick()], [0, 1, 2, 0])
})

test("'round-robin' cycles in order", () => {
  const pick = makeReplicaPicker('round-robin', 2)
  assert.deepEqual([pick(), pick(), pick()], [0, 1, 0])
})

test("'random' maps the rng roll uniformly onto the index range", () => {
  const pick = makeReplicaPicker('random', 4, rngOf(0, 0.26, 0.74, 0.999))
  assert.deepEqual([pick(), pick(), pick(), pick()], [0, 1, 2, 3])
})

test('weights: rolls land per cumulative weight', () => {
  // [3, 1] over total 4: roll*4 < 3 → index 0, else index 1.
  const pick = makeReplicaPicker([3, 1], 2, rngOf(0, 0.7, 0.75, 0.99))
  assert.deepEqual([pick(), pick(), pick(), pick()], [0, 0, 1, 1])
})

test('weights: a zero weight is never picked', () => {
  const pick = makeReplicaPicker([0, 1], 2, rngOf(0, 0.5, 0.999))
  assert.deepEqual([pick(), pick(), pick()], [1, 1, 1])
})

test('weights: length mismatch throws at build time', () => {
  assert.throws(() => makeReplicaPicker([1, 2, 3], 2), /3 entries for 2 replica/)
  assert.throws(() => makeReplicaPicker([1], 2), /1 entry for 2 replica/)
})

test('weights: negative / non-finite / all-zero throw at build time', () => {
  assert.throws(() => makeReplicaPicker([1, -1], 2), /finite numbers >= 0/)
  assert.throws(() => makeReplicaPicker([1, Number.NaN], 2), /finite numbers >= 0/)
  assert.throws(() => makeReplicaPicker([1, Number.POSITIVE_INFINITY], 2), /finite numbers >= 0/)
  assert.throws(() => makeReplicaPicker([0, 0], 2), /sum to more than 0/)
})

test('custom function: receives the replica count, its index is used as-is', () => {
  const counts: number[] = []
  const pick = makeReplicaPicker((count) => { counts.push(count); return 1 }, 3)
  assert.deepEqual([pick(), pick()], [1, 1])
  assert.deepEqual(counts, [3, 3])
})

test('custom function: out-of-range / non-integer return throws per call', () => {
  assert.throws(() => makeReplicaPicker(() => 5, 2)(), /returned 5 .* \[0, 1\]/)
  assert.throws(() => makeReplicaPicker(() => -1, 2)(), /returned -1/)
  assert.throws(() => makeReplicaPicker(() => 0.5, 2)(), /returned 0\.5/)
})
