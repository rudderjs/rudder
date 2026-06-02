import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { castGet, castSet, type CastDefinition } from './cast.js'

// Cast breadth (Laravel parity): decimal:N, enum, hashed.
// `castGet`/`castSet` are the pure cast helpers — exercised directly here so the
// tests stay adapter-free.

const attrs: Record<string, unknown> = {}

describe('decimal:N cast', () => {
  it('formats to N fractional digits on read (string, not number)', () => {
    const out = castGet('decimal:2', 'price', 9.5, attrs)
    assert.strictEqual(out, '9.50')
    assert.strictEqual(typeof out, 'string')
  })

  it('normalizes on write to the same fixed-precision string', () => {
    assert.strictEqual(castSet('decimal:2', 'price', '9.005', attrs), '9.01')
    assert.strictEqual(castSet('decimal:4', 'rate', 0.1, attrs), '0.1000')
  })

  it('accepts numeric strings and trims excess precision', () => {
    assert.strictEqual(castGet('decimal:0', 'qty', '42.9', attrs), '43')
  })

  it('passes null/undefined through untouched', () => {
    assert.strictEqual(castGet('decimal:2', 'price', null, attrs), null)
    assert.strictEqual(castSet('decimal:2', 'price', undefined, attrs), undefined)
  })

  it('throws on a non-numeric value', () => {
    assert.throws(() => castSet('decimal:2', 'price', 'abc', attrs), /non-numeric/)
  })

  it('throws on a malformed places spec', () => {
    assert.throws(() => castGet('decimal:x', 'price', 1, attrs), /Invalid decimal cast/)
  })
})

describe('enum cast', () => {
  enum Status { Active = 'active', Archived = 'archived' }
  enum Priority { Low, High } // numeric enum → reverse-mapped

  it('passes a valid string-enum member through on read and write', () => {
    assert.strictEqual(castGet(Status as unknown as string, 'status', 'active', attrs), 'active')
    assert.strictEqual(castSet(Status as unknown as string, 'status', Status.Archived, attrs), 'archived')
  })

  it('handles numeric enums (ignores the reverse mapping)', () => {
    assert.strictEqual(castSet(Priority as unknown as string, 'priority', Priority.High, attrs), 1)
    assert.strictEqual(castGet(Priority as unknown as string, 'priority', 0, attrs), 0)
    // The reverse-mapping label is NOT a valid stored value.
    assert.throws(() => castSet(Priority as unknown as string, 'priority', 'High', attrs), /Invalid enum value/)
  })

  it('throws with the allowed set on an unknown value', () => {
    assert.throws(
      () => castGet(Status as unknown as string, 'status', 'deleted', attrs),
      /Invalid enum value for column "status".*"active".*"archived"/s,
    )
  })

  it('supports a plain const object as an enum', () => {
    const Role = { Admin: 'admin', User: 'user' } as const
    assert.strictEqual(castSet(Role as unknown as string, 'role', 'admin', attrs), 'admin')
    assert.throws(() => castSet(Role as unknown as string, 'role', 'root', attrs), /Invalid enum value/)
  })

  it('still routes a CastUsing class (with get/set prototype) to the class, not the enum path', () => {
    class Upper {
      get(_k: string, v: unknown): unknown { return String(v).toUpperCase() }
      set(_k: string, v: unknown): unknown { return String(v).toLowerCase() }
    }
    const def = Upper as unknown as CastDefinition
    assert.strictEqual(castGet(def as unknown as string, 'code', 'ab', attrs), 'AB')
    assert.strictEqual(castSet(def as unknown as string, 'code', 'AB', attrs), 'ab')
  })
})

describe('hashed cast', () => {
  const STORE_KEY = '__rudderjs_hash_registry__'
  const g = globalThis as Record<string, unknown>
  let previous: unknown

  before(() => { previous = g[STORE_KEY] })
  after(() => { g[STORE_KEY] = previous })

  function setDriver(driver: unknown): void { g[STORE_KEY] = { driver } }

  it('hashes a plaintext value on write via the registered driver', () => {
    setDriver({ makeSync: (v: string) => `HASH(${v})`, isHashed: (v: string) => v.startsWith('HASH(') })
    assert.strictEqual(castSet('hashed', 'password', 'secret', attrs), 'HASH(secret)')
  })

  it('is a no-op when the value is already hashed', () => {
    setDriver({ makeSync: (v: string) => `HASH(${v})`, isHashed: (v: string) => v.startsWith('HASH(') })
    const already = 'HASH(secret)'
    assert.strictEqual(castSet('hashed', 'password', already, attrs), already)
  })

  it('falls back to a built-in hash-shape regex when the driver omits isHashed', () => {
    setDriver({ makeSync: (v: string) => `$2b$04$${v}` })
    const bcryptish = '$2b$04$abcdefghijklmnopqrstuv'
    assert.strictEqual(castSet('hashed', 'password', bcryptish, attrs), bcryptish)
  })

  it('returns the stored hash verbatim on read', () => {
    setDriver({ makeSync: (v: string) => `HASH(${v})` })
    assert.strictEqual(castGet('hashed', 'password', 'HASH(secret)', attrs), 'HASH(secret)')
  })

  it('throws a clear error when no hash driver is registered', () => {
    g[STORE_KEY] = undefined
    assert.throws(() => castSet('hashed', 'password', 'secret', attrs), /requires @rudderjs\/hash/)
  })

  it('throws when the registered driver has no synchronous hashing', () => {
    setDriver({ isHashed: () => false }) // argon2-like: no makeSync
    assert.throws(() => castSet('hashed', 'password', 'secret', attrs), /no synchronous hashing/)
  })

  it('passes null through without touching the driver', () => {
    g[STORE_KEY] = undefined
    assert.strictEqual(castSet('hashed', 'password', null, attrs), null)
  })
})
