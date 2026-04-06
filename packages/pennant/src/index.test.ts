import 'reflect-metadata'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Application } from '@rudderjs/core'
import {
  Feature,
  Lottery,
  MemoryDriver,
  FakePennant,
  FeatureMiddleware,
  pennant,
} from './index.js'
import type { Scopeable } from './index.js'

// ─── Bootstrap helper ─────────────────────────────────────

let app: Application

beforeEach(async () => {
  Application.resetForTesting()
  app = Application.create({
    providers: [pennant()],
    env: 'testing',
  })
  await app.bootstrap()
})

afterEach(() => {
  Application.resetForTesting()
})

// ─── Feature.define + active/value ────────────────────────

describe('Feature.define() + active()', () => {
  it('resolves a boolean feature', async () => {
    Feature.define('dark-mode', () => true)
    assert.strictEqual(await Feature.active('dark-mode'), true)
  })

  it('resolves a feature to false', async () => {
    Feature.define('beta', () => false)
    assert.strictEqual(await Feature.active('beta'), false)
  })

  it('throws for undefined features', async () => {
    await assert.rejects(
      () => Feature.active('nonexistent'),
      /not defined/,
    )
  })
})

describe('Feature.value()', () => {
  it('returns a rich value (not just boolean)', async () => {
    Feature.define('plan', () => 'premium')
    assert.strictEqual(await Feature.value('plan'), 'premium')
  })

  it('returns a numeric value', async () => {
    Feature.define('max-uploads', () => 10)
    assert.strictEqual(await Feature.value('max-uploads'), 10)
  })
})

// ─── Scoping ──────────────────────────────────────────────

describe('Feature.for(scope)', () => {
  it('resolves per-scope', async () => {
    const alice: Scopeable = { id: 1, name: 'Alice' }
    const bob: Scopeable   = { id: 2, name: 'Bob' }

    Feature.define('beta', (scope) => {
      const s = scope as Scopeable | null
      return s?.id === 1
    })

    assert.strictEqual(await Feature.for(alice).active('beta'), true)
    assert.strictEqual(await Feature.for(bob).active('beta'), false)
  })

  it('caches resolved value per scope', async () => {
    let calls = 0
    Feature.define('counted', () => { calls++; return true })

    await Feature.active('counted')
    await Feature.active('counted')
    assert.strictEqual(calls, 1) // only resolved once, then cached
  })

  it('resolves different values for different scopes', async () => {
    let calls = 0
    Feature.define('scoped-count', () => { calls++; return true })

    await Feature.for({ id: 1 }).active('scoped-count')
    await Feature.for({ id: 2 }).active('scoped-count')
    assert.strictEqual(calls, 2) // resolved once per scope
  })
})

// ─── Feature.values() bulk ────────────────────────────────

describe('Feature.values()', () => {
  it('resolves multiple features at once', async () => {
    Feature.define('a', () => true)
    Feature.define('b', () => 'hello')
    Feature.define('c', () => 42)

    const result = await Feature.values(['a', 'b', 'c'])
    assert.deepStrictEqual(result, { a: true, b: 'hello', c: 42 })
  })
})

// ─── Lottery ──────────────────────────────────────────────

describe('Lottery', () => {
  it('100% odds always returns true', () => {
    const lottery = Lottery.odds(1, 1)
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(lottery.pick(), true)
    }
  })

  it('0% odds always returns false', () => {
    const lottery = Lottery.odds(0, 1)
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(lottery.pick(), false)
    }
  })

  it('integrates with Feature.define — resolves to boolean', async () => {
    Feature.define('gradual', () => Lottery.odds(1, 1)) // 100%
    const result = await Feature.active('gradual')
    assert.strictEqual(result, true)
  })

  it('persists the lottery result after first resolve', async () => {
    Feature.define('lottery-test', () => Lottery.odds(1, 1))
    const first  = await Feature.value('lottery-test')
    const second = await Feature.value('lottery-test')
    assert.strictEqual(first, second) // same cached value
    assert.strictEqual(typeof first, 'boolean')
  })
})

// ─── Feature.activate / deactivate / purge ────────────────

describe('Feature.activate() / deactivate()', () => {
  it('force-activates a feature', async () => {
    Feature.define('manual', () => false)
    assert.strictEqual(await Feature.active('manual'), false)

    await Feature.activate('manual')
    assert.strictEqual(await Feature.active('manual'), true)
  })

  it('force-deactivates a feature', async () => {
    Feature.define('manual2', () => true)
    assert.strictEqual(await Feature.active('manual2'), true)

    await Feature.deactivate('manual2')
    assert.strictEqual(await Feature.active('manual2'), false)
  })
})

describe('Feature.purge()', () => {
  it('clears all stored values for a feature', async () => {
    let calls = 0
    Feature.define('purgeable', () => { calls++; return true })

    await Feature.active('purgeable')
    assert.strictEqual(calls, 1)

    await Feature.purge('purgeable')
    await Feature.active('purgeable')
    assert.strictEqual(calls, 2) // re-resolved after purge
  })
})

// ─── MemoryDriver ─────────────────────────────────────────

describe('MemoryDriver', () => {
  it('stores and retrieves values', async () => {
    const driver = new MemoryDriver()
    await driver.set('feat', 'scope1', 'val')
    assert.strictEqual(await driver.get('feat', 'scope1'), 'val')
  })

  it('returns undefined for missing values', async () => {
    const driver = new MemoryDriver()
    assert.strictEqual(await driver.get('feat', 'scope1'), undefined)
  })

  it('deletes a specific scope', async () => {
    const driver = new MemoryDriver()
    await driver.set('feat', 's1', true)
    await driver.set('feat', 's2', true)
    await driver.delete('feat', 's1')
    assert.strictEqual(await driver.get('feat', 's1'), undefined)
    assert.strictEqual(await driver.get('feat', 's2'), true)
  })

  it('purges all scopes for a feature', async () => {
    const driver = new MemoryDriver()
    await driver.set('feat', 's1', true)
    await driver.set('feat', 's2', true)
    await driver.purge('feat')
    assert.strictEqual(await driver.get('feat', 's1'), undefined)
    assert.strictEqual(await driver.get('feat', 's2'), undefined)
  })
})

// ─── Feature.fake() ───────────────────────────────────────

describe('Feature.fake()', () => {
  afterEach(() => {
    try { Feature.fake().restore() } catch { /* */ }
  })

  it('records feature checks', async () => {
    Feature.define('tracked', () => true)
    const fake = Feature.fake()

    await Feature.active('tracked')
    fake.assertChecked('tracked')
    fake.assertNotChecked('other')
    fake.restore()
  })

  it('overrides feature values', async () => {
    Feature.define('real', () => false)
    const fake = Feature.fake()
    fake.override('real', true)

    const result = await Feature.active('real')
    assert.strictEqual(result, true)
    fake.restore()
  })

  it('assertCheckedFor() validates scope', async () => {
    Feature.define('scoped', () => true)
    const fake = Feature.fake()

    const user = { id: 5 }
    await Feature.active('scoped', user)
    fake.assertCheckedFor('scoped', user)
    fake.restore()
  })
})

// ─── FeatureMiddleware ────────────────────────────────────

describe('FeatureMiddleware', () => {
  it('calls next() when feature is active', async () => {
    Feature.define('allowed', () => true)
    const mw = FeatureMiddleware('allowed')

    let called = false
    await mw(
      { user: null } as never,
      { status: () => {}, json: () => {} } as never,
      async () => { called = true },
    )
    assert.ok(called)
  })

  it('returns 403 when feature is inactive', async () => {
    Feature.define('blocked', () => false)
    const mw = FeatureMiddleware('blocked')

    let statusCode: number | undefined
    let called = false
    await mw(
      { user: null } as never,
      {
        status: (code: number) => { statusCode = code },
        json: () => {},
      } as never,
      async () => { called = true },
    )
    assert.strictEqual(statusCode, 403)
    assert.ok(!called)
  })
})
