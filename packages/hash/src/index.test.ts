import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigRepository, setConfigRepository, getConfigRepository } from '@rudderjs/core'
import { HashProvider, Hash, HashRegistry, BcryptDriver, type HashConfig } from './index.js'

function withHashConfig(cfg: HashConfig): () => void {
  const previous = getConfigRepository()
  setConfigRepository(new ConfigRepository({ hash: cfg }))
  return () => setConfigRepository(previous ?? new ConfigRepository({}))
}

// ─── BcryptDriver (direct) ───────────────────────────────

describe('BcryptDriver', () => {
  const driver = new BcryptDriver({ rounds: 4 }) // low rounds for fast tests

  it('make() produces a bcrypt hash', async () => {
    const hashed = await driver.make('password')
    assert.ok(hashed.startsWith('$2'))
    assert.ok(hashed.length > 50)
  })

  it('check() returns true for a matching password', async () => {
    const hashed = await driver.make('secret')
    assert.strictEqual(await driver.check('secret', hashed), true)
  })

  it('check() returns false for a wrong password', async () => {
    const hashed = await driver.make('secret')
    assert.strictEqual(await driver.check('wrong', hashed), false)
  })

  it('make() produces different hashes for the same input (salted)', async () => {
    const a = await driver.make('same')
    const b = await driver.make('same')
    assert.notStrictEqual(a, b)
  })

  it('needsRehash() returns false when rounds match', async () => {
    const hashed = await driver.make('test')
    assert.strictEqual(driver.needsRehash(hashed), false)
  })

  it('needsRehash() returns true when rounds differ', async () => {
    const driver12 = new BcryptDriver({ rounds: 12 })
    const hashedWith4 = await driver.make('test')
    assert.strictEqual(driver12.needsRehash(hashedWith4), true)
  })

  it('needsRehash() returns true for a non-bcrypt string', () => {
    assert.strictEqual(driver.needsRehash('not-a-hash'), true)
  })
})

// ─── HashRegistry ─────────────────────────────────────────

describe('HashRegistry', () => {
  beforeEach(() => HashRegistry.reset())

  it('get() returns null when no driver is registered', () => {
    assert.strictEqual(HashRegistry.get(), null)
  })

  it('set() + get() registers and retrieves the driver', () => {
    const driver = new BcryptDriver()
    HashRegistry.set(driver)
    assert.strictEqual(HashRegistry.get(), driver)
  })

  it('reset() clears the registered driver', () => {
    HashRegistry.set(new BcryptDriver())
    HashRegistry.reset()
    assert.strictEqual(HashRegistry.get(), null)
  })

  it('state lives on globalThis so it survives a second copy of @rudderjs/hash', () => {
    // Vite-bundled server apps inline `@rudderjs/hash` (`Hash.make` / `Hash.check`
    // read `HashRegistry`) into entry.mjs, but `HashProvider.boot()` runs from
    // a node_modules copy of `@rudderjs/hash` resolved via the provider
    // auto-discovery manifest. Without a globalThis-routed store, `set()` from
    // the externalized copy would never be visible to `get()` from the bundled
    // copy. This test pins the contract: writes from this module copy are
    // visible on a global key the second copy would also read from.
    const driver = new BcryptDriver()
    HashRegistry.set(driver)
    const store = (globalThis as Record<string, unknown>)['__rudderjs_hash_registry__'] as { driver: unknown } | undefined
    assert.ok(store, 'global store should exist after HashRegistry.set()')
    assert.strictEqual(store.driver, driver)
  })
})

// ─── Hash facade ──────────────────────────────────────────

describe('Hash facade', () => {
  let restore: () => void

  beforeEach(async () => {
    HashRegistry.reset()
    restore = withHashConfig({ driver: 'bcrypt', bcrypt: { rounds: 4 } })
    await new HashProvider({ instance: () => undefined } as never).boot?.()
  })

  afterEach(() => restore())

  it('throws when no driver is registered', async () => {
    HashRegistry.reset()
    await assert.rejects(async () => Hash.make('test'), /No hash driver registered/)
  })

  it('make() hashes a password', async () => {
    const hashed = await Hash.make('password')
    assert.ok(hashed.startsWith('$2'))
  })

  it('check() verifies a correct password', async () => {
    const hashed = await Hash.make('secret')
    assert.strictEqual(await Hash.check('secret', hashed), true)
  })

  it('check() rejects a wrong password', async () => {
    const hashed = await Hash.make('secret')
    assert.strictEqual(await Hash.check('wrong', hashed), false)
  })

  it('needsRehash() returns false for current config', async () => {
    const hashed = await Hash.make('test')
    assert.strictEqual(Hash.needsRehash(hashed), false)
  })
})

// ─── HashProvider ─────────────────────────────────────────

describe('HashProvider', () => {
  let restore: () => void

  beforeEach(() => HashRegistry.reset())
  afterEach(() => restore?.())

  const fakeApp = { instance: () => undefined } as never

  it('boots with bcrypt driver and registers', async () => {
    restore = withHashConfig({ driver: 'bcrypt', bcrypt: { rounds: 4 } })
    await new HashProvider(fakeApp).boot?.()
    assert.ok(HashRegistry.get() !== null)
  })

  it('boots with default bcrypt config when no options given', async () => {
    restore = withHashConfig({ driver: 'bcrypt' })
    await new HashProvider(fakeApp).boot?.()
    assert.ok(HashRegistry.get() !== null)
  })

  it('throws on an unknown driver', async () => {
    restore = withHashConfig({ driver: 'scrypt' as 'bcrypt' })
    await assert.rejects(
      () => new HashProvider(fakeApp).boot?.() as Promise<void>,
      /Unknown driver "scrypt"/,
    )
  })

  it('register() is a no-op', () => {
    restore = withHashConfig({ driver: 'bcrypt' })
    assert.doesNotThrow(() => new HashProvider(fakeApp).register?.())
  })
})
