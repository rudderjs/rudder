import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { encodePayload, decodePayload } from './serialize.js'

function wire<T>(value: T): unknown {
  // Mimic the transport's JSON round-trip — drivers all serialize to JSON
  // before the value crosses the wire.
  return JSON.parse(JSON.stringify(encodePayload(value)))
}

describe('encodePayload / decodePayload', () => {
  it('round-trips Date through the JSON wire', () => {
    const original = new Date('2026-01-01T12:34:56.000Z')
    const decoded = decodePayload(wire(original)) as Date
    assert.ok(decoded instanceof Date)
    assert.equal(decoded.toISOString(), original.toISOString())
  })

  it('round-trips BigInt through the JSON wire', () => {
    const decoded = decodePayload(wire({ n: 42n })) as { n: bigint }
    assert.equal(typeof decoded.n, 'bigint')
    assert.equal(decoded.n, 42n)
  })

  it('round-trips Buffer through the JSON wire', () => {
    const original = Buffer.from('hello world', 'utf8')
    const decoded = decodePayload(wire({ b: original })) as { b: Buffer }
    assert.ok(Buffer.isBuffer(decoded.b))
    assert.equal(decoded.b.toString('utf8'), 'hello world')
  })

  it('round-trips Map with string keys + nested Date values', () => {
    const original = new Map<string, Date>([['birthday', new Date('2026-01-01')]])
    const decoded = decodePayload(wire({ m: original })) as { m: Map<string, Date> }
    assert.ok(decoded.m instanceof Map)
    assert.ok(decoded.m.get('birthday') instanceof Date)
  })

  it('round-trips Set of numbers', () => {
    const decoded = decodePayload(wire({ s: new Set([1, 2, 3]) })) as { s: Set<number> }
    assert.ok(decoded.s instanceof Set)
    assert.deepEqual([...decoded.s], [1, 2, 3])
  })

  it('leaves plain JSON values untouched', () => {
    const original = { a: 1, b: 'hi', c: true, d: null, e: [1, 2, { f: 'x' }] }
    const decoded = decodePayload(wire(original))
    assert.deepEqual(decoded, original)
  })

  it('handles nested mixed payloads end-to-end', () => {
    const original = {
      id:        1,
      createdAt: new Date('2026-05-22T00:00:00.000Z'),
      counter:   10n,
      tags:      new Set(['a', 'b']),
      meta:      new Map<string, unknown>([['key', { stamp: new Date('2026-05-23') }]]),
    }
    const decoded = decodePayload(wire(original)) as typeof original
    assert.ok(decoded.createdAt instanceof Date)
    assert.equal(decoded.counter, 10n)
    assert.ok(decoded.tags instanceof Set)
    assert.deepEqual([...decoded.tags], ['a', 'b'])
    assert.ok(decoded.meta instanceof Map)
    assert.ok((decoded.meta.get('key') as { stamp: Date }).stamp instanceof Date)
  })

  it('encodePayload of a class instance preserves own properties', () => {
    class Demo {
      constructor(public name: string, public when: Date) {}
    }
    const decoded = decodePayload(wire(new Demo('alice', new Date('2026-01-01')))) as { name: string; when: Date }
    assert.equal(decoded.name, 'alice')
    assert.ok(decoded.when instanceof Date)
  })

  // ── depth guard (DoS): a job payload frequently carries user-controlled input,
  // and unbounded recursion would stack-overflow encode (on dispatch) / decode (on
  // the worker). 1000 levels is below the native stack limit (so without the guard
  // these would NOT throw — the green-vs-red gate) but above the 256-level guard.
  describe('payload depth guard', () => {
    const deep = (depth: number): unknown => {
      let o: unknown = { leaf: true }
      for (let i = 0; i < depth; i++) o = { nested: o }
      return o
    }

    it('encodePayload rejects a pathologically deep payload', () => {
      assert.throws(() => encodePayload(deep(1000)), /nesting exceeds/)
    })

    it('decodePayload rejects a pathologically deep payload', () => {
      assert.throws(() => decodePayload(deep(1000)), /nesting exceeds/)
    })

    it('still round-trips a reasonably nested payload', () => {
      assert.doesNotThrow(() => decodePayload(wire(deep(50))))
    })
  })
})
