import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  vector,
  VectorDimensionMismatchError,
  type CastUsing,
} from './index.js'

// `vector({ dimensions })` returns a class; instantiate it to invoke
// the get/set side of the cast contract.
function makeCast(dimensions: number): CastUsing {
  const Cast = vector({ dimensions })
  return new Cast()
}

// ─── factory validation ───────────────────────────────────

describe('vector() factory', () => {
  it('throws when dimensions is not a positive integer', () => {
    assert.throws(() => vector({ dimensions: 0 }),   /positive integer/i)
    assert.throws(() => vector({ dimensions: -1 }),  /positive integer/i)
    assert.throws(() => vector({ dimensions: 1.5 }), /positive integer/i)
assert.throws(() => vector({ dimensions: 'big' as any }), /positive integer/i)
  })

  it('accepts common embedding dimensions', () => {
    assert.doesNotThrow(() => vector({ dimensions: 1 }))
    assert.doesNotThrow(() => vector({ dimensions: 384 }))
    assert.doesNotThrow(() => vector({ dimensions: 768 }))
    assert.doesNotThrow(() => vector({ dimensions: 1536 }))
    assert.doesNotThrow(() => vector({ dimensions: 3072 }))
  })
})

// ─── set (write side) ─────────────────────────────────────

describe('vector cast — set (number[] → pgvector text)', () => {
  it('serializes to bracketed comma-separated literal', () => {
    const cast = makeCast(3)
    const out = cast.set('embedding', [0.1, 0.2, 0.3], {})
    assert.equal(out, '[0.1,0.2,0.3]')
  })

  it('passes through null + undefined', () => {
    const cast = makeCast(3)
    assert.equal(cast.set('embedding', null,      {}), null)
    assert.equal(cast.set('embedding', undefined, {}), undefined)
  })

  it('throws VectorDimensionMismatchError on length mismatch', () => {
    const cast = makeCast(1536)
    assert.throws(
      () => cast.set('embedding', [1, 2, 3], {}),
      (err: unknown) => {
        if (!(err instanceof VectorDimensionMismatchError)) return false
        assert.equal(err.code,     'VECTOR_DIMENSION_MISMATCH')
        assert.equal(err.column,   'embedding')
        assert.equal(err.expected, 1536)
        assert.equal(err.actual,   3)
        return true
      },
    )
  })

  it('rejects non-array values', () => {
    const cast = makeCast(3)
    assert.throws(() => cast.set('embedding', 'not-an-array' as unknown, {}), /expected number\[\]/)
assert.throws(() => cast.set('embedding', { 0: 1, 1: 2, 2: 3 } as any, {}), /expected number\[\]/)
  })

  it('rejects NaN / Infinity / non-numbers per element', () => {
    const cast = makeCast(3)
    assert.throws(() => cast.set('e', [1, NaN, 3],       {}), /finite number/)
    assert.throws(() => cast.set('e', [1, Infinity, 3],  {}), /finite number/)
    assert.throws(() => cast.set('e', [1, -Infinity, 3], {}), /finite number/)
assert.throws(() => cast.set('e', [1, 'two' as any, 3], {}), /finite number/)
  })

  it('handles negative + scientific notation finite numbers', () => {
    const cast = makeCast(3)
    const out = cast.set('e', [-0.5, 1e-10, 2.5], {})
    // Use String() because exact representation depends on toString — what
    // matters is the round-trip + pgvector parser tolerance.
    assert.match(out as string, /^\[-0\.5,1e-10,2\.5\]$/)
  })
})

// ─── get (read side) ──────────────────────────────────────

describe('vector cast — get (pgvector text → number[])', () => {
  it('parses bracketed comma-separated literal', () => {
    const cast = makeCast(3)
    const out = cast.get('embedding', '[0.1,0.2,0.3]', {})
    assert.deepEqual(out, [0.1, 0.2, 0.3])
  })

  it('passes through null + undefined', () => {
    const cast = makeCast(3)
    assert.equal(cast.get('embedding', null,      {}), null)
    assert.equal(cast.get('embedding', undefined, {}), undefined)
  })

  it('passes through arrays unchanged (idempotent on roundtrip-via-cache)', () => {
    const cast = makeCast(3)
    const out = cast.get('embedding', [0.1, 0.2, 0.3], {})
    assert.deepEqual(out, [0.1, 0.2, 0.3])
  })

  it('throws when string is not valid array literal', () => {
    const cast = makeCast(3)
    assert.throws(() => cast.get('embedding', 'garbage', {}), /failed to parse/)
    assert.throws(() => cast.get('embedding', '{"a":1}', {}), /expected array/)
  })
})

// ─── full round-trip ──────────────────────────────────────

describe('vector cast — round trip', () => {
  it('set → get reproduces the original vector', () => {
    const cast = makeCast(5)
    const original = [0.1, -0.5, 1e-7, 0, 99.99]
    const serialized = cast.set('embedding', original, {}) as string
    const parsed = cast.get('embedding', serialized, {}) as number[]
    // Use a tolerant comparison: shortest-form toString may shorten
    // 99.99 → '99.99' (exact) so deepEqual works here, but pre-emptively
    // round to 9 digits to avoid float drift hiding a real bug.
    assert.deepEqual(parsed.map(n => Number(n.toFixed(9))), original.map(n => Number(n.toFixed(9))))
  })
})

// ─── distinct VectorCast classes per call ─────────────────

describe('vector() returns a fresh class per call', () => {
  it('different dimensions → different cast behavior', () => {
    const c1 = new (vector({ dimensions: 3 }))()
    const c2 = new (vector({ dimensions: 4 }))()

    assert.doesNotThrow(() => c1.set('e', [1, 2, 3],    {}))
    assert.doesNotThrow(() => c2.set('e', [1, 2, 3, 4], {}))

    assert.throws(() => c1.set('e', [1, 2, 3, 4], {}), VectorDimensionMismatchError)
    assert.throws(() => c2.set('e', [1, 2, 3],    {}), VectorDimensionMismatchError)
  })
})
