import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { castGet, castSet } from './cast.js'

// The `encrypted` / `encrypted:array` / `encrypted:object` casts reach
// `@rudderjs/crypt` through its globalThis-shared bridge
// (`__rudderjs_crypt_registry__`) — the same pattern `hashed` uses for
// `@rudderjs/hash`. We don't import crypt here (node-only, must stay out of the
// client-safe cast funnel), so the tests install a reversible fake bridge.
//
// Regression guard: the cast previously used `require('@rudderjs/crypt')`, which
// is dead in this ESM package (`require` is undefined at runtime), so every
// encrypted cast threw "requires @rudderjs/crypt" even when crypt was installed.

const CRYPT_KEY = '__rudderjs_crypt_registry__'
const attrs: Record<string, unknown> = {}

// A reversible stand-in for crypt's encryptString/decryptString — base64 round
// trip is enough to prove the cast wires through and (de)serializes correctly.
function installFakeBridge(): void {
  ;(globalThis as Record<string, unknown>)[CRYPT_KEY] = {
    encrypt: (v: string): string => Buffer.from(v, 'utf8').toString('base64'),
    decrypt: (v: string): string => Buffer.from(v, 'base64').toString('utf8'),
  }
}

function clearBridge(): void {
  delete (globalThis as Record<string, unknown>)[CRYPT_KEY]
}

describe('encrypted cast (via the crypt globalThis bridge)', () => {
  afterEach(clearBridge)

  it('round-trips a scalar through the bridge', () => {
    installFakeBridge()
    const stored = castSet('encrypted', 'ssn', '123-45-6789', attrs)
    assert.notStrictEqual(stored, '123-45-6789') // actually encrypted, not passthrough
    assert.strictEqual(castGet('encrypted', 'ssn', stored, attrs), '123-45-6789')
  })

  it('round-trips an array (encrypted:array)', () => {
    installFakeBridge()
    const value = ['a', 'b', 'c']
    const stored = castSet('encrypted:array', 'tags', value, attrs)
    assert.deepStrictEqual(castGet('encrypted:array', 'tags', stored, attrs), value)
  })

  it('round-trips an object (encrypted:object)', () => {
    installFakeBridge()
    const value = { card: '4242', exp: '12/30' }
    const stored = castSet('encrypted:object', 'payment', value, attrs)
    assert.deepStrictEqual(castGet('encrypted:object', 'payment', stored, attrs), value)
  })

  it('passes null/undefined through without touching the bridge', () => {
    // No bridge installed — null/undefined short-circuit before _encrypt/_decrypt.
    assert.strictEqual(castSet('encrypted', 'ssn', null, attrs), null)
    assert.strictEqual(castGet('encrypted', 'ssn', undefined, attrs), undefined)
  })

  it('throws a clear error when crypt is not booted (no bridge)', () => {
    clearBridge()
    assert.throws(
      () => castSet('encrypted', 'ssn', 'secret', attrs),
      /requires @rudderjs\/crypt/,
    )
  })
})
