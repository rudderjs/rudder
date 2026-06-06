import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { disposeNativeDriverCache } from './native-driver-cache.js'

const KEY = '__rudderjs_native_client__'
const g = globalThis as Record<string, unknown>

function fakeDriver(closed: string[], name: string, opts: { throws?: boolean } = {}) {
  return {
    async close() {
      if (opts.throws) throw new Error(`close failed: ${name}`)
      closed.push(name)
    },
  }
}

describe('disposeNativeDriverCache()', () => {
  beforeEach(() => { delete g[KEY] })

  it('no cache → no-op', async () => {
    await disposeNativeDriverCache()
    assert.equal(g[KEY], undefined)
  })

  it('closes every driver + read replica in the per-connection Map and clears it', async () => {
    const closed: string[] = []
    const cache = new Map<string, unknown>([
      ['default', { signature: 'a', driver: fakeDriver(closed, 'pg-primary'), readDrivers: [fakeDriver(closed, 'pg-replica')] }],
      ['analytics', { signature: 'b', driver: fakeDriver(closed, 'mysql'), readDrivers: [] }],
    ])
    g[KEY] = cache
    await disposeNativeDriverCache()
    assert.deepEqual(closed.sort(), ['mysql', 'pg-primary', 'pg-replica'])
    assert.equal(cache.size, 0, 'closed drivers are evicted so nothing reuses them')
  })

  it('handles the legacy single-entry (non-Map) shape', async () => {
    const closed: string[] = []
    g[KEY] = { signature: 'a', driver: fakeDriver(closed, 'legacy') }
    await disposeNativeDriverCache()
    assert.deepEqual(closed, ['legacy'])
    assert.equal(g[KEY], undefined)
  })

  it('a throwing close never propagates and the rest still close', async () => {
    const closed: string[] = []
    g[KEY] = new Map<string, unknown>([
      ['bad',  { signature: 'a', driver: fakeDriver(closed, 'bad', { throws: true }) }],
      ['good', { signature: 'b', driver: fakeDriver(closed, 'good') }],
    ])
    await disposeNativeDriverCache()
    assert.deepEqual(closed, ['good'])
  })

  it('tolerates entries with no driver / missing close (structural read)', async () => {
    g[KEY] = new Map<string, unknown>([
      ['empty',   { signature: 'a' }],
      ['noClose', { signature: 'b', driver: {} }],
    ])
    await disposeNativeDriverCache()
    assert.equal((g[KEY] as Map<string, unknown>).size, 0)
  })
})
