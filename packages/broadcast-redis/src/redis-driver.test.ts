import { describe, it } from 'node:test'
import assert           from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import type { BroadcastMeta } from '@rudderjs/broadcast'

// ─── ioredis stub ──────────────────────────────────────────
//
// In-memory replacement for ioredis. Two instances pointed at the same
// `Bus` round-trip publish → subscribe like the real pub/sub. We can't
// `mock.module()` the static `import Redis from 'ioredis'` cleanly across
// node:test runs without --experimental-test-module-mocks, so instead we
// load the driver via a fresh module-mocker that returns this stub.
//
// Approach: install module mock at file scope (per memory
// [[node-mock-module-gotchas]]: NOT inside before()) and run the suite
// with --experimental-test-module-mocks. Tests then import RedisDriver
// AFTER the mock is registered.

class Bus extends EventEmitter {}

class StubRedis extends EventEmitter {
  private subscriptions = new Set<string>()
  private connected     = true

  constructor(private readonly bus: Bus) {
    super()
    bus.on('publish', this.onBusPublish.bind(this))
  }

  duplicate(): StubRedis {
    return new StubRedis(this.bus)
  }

  async publish(channel: string, message: string): Promise<number> {
    if (!this.connected) throw new Error('disconnected')
    this.bus.emit('publish', channel, message)
    return 1
  }

  async subscribe(channel: string): Promise<void> {
    this.subscriptions.add(channel)
  }

  async unsubscribe(channel: string): Promise<void> {
    this.subscriptions.delete(channel)
  }

  disconnect(): void {
    this.connected = false
    this.subscriptions.clear()
  }

  private onBusPublish(channel: string, raw: string): void {
    if (this.subscriptions.has(channel)) {
      this.emit('message', channel, raw)
    }
  }
}

// Shared bus across the test file so two StubRedis instances simulate
// two app processes pointed at the same Redis.
const bus = new Bus()

import { mock } from 'node:test'

mock.module('ioredis', {
  defaultExport: class extends StubRedis {
    constructor(_url?: string) { super(bus) }
  },
  namedExports: {},
})

// Import AFTER the mock is registered so the driver picks up StubRedis.
const { RedisDriver } = await import('./redis-driver.js')

// ─── Tests ──────────────────────────────────────────────────

describe('RedisDriver', () => {
  it('round-trips a published message to its own subscriber', async () => {
    const drv = new RedisDriver({ redis: 'redis://stub' })
    const seen: Array<{ c: string; e: string; d: unknown; m?: BroadcastMeta }> = []
    drv.subscribe((c, e, d, m) => seen.push({ c, e, d, ...(m ? { m } : {}) }))
    await new Promise((r) => setTimeout(r, 5))  // let subscribe() resolve
    await drv.publish('chat', 'message', { text: 'hi' })
    await new Promise((r) => setTimeout(r, 5))
    assert.equal(seen.length, 1)
    assert.equal(seen[0]?.c, 'chat')
    assert.equal(seen[0]?.e, 'message')
    assert.deepEqual(seen[0]?.d, { text: 'hi' })
    await drv.close()
  })

  it('two driver instances on the same bus fan messages across', async () => {
    const a = new RedisDriver({ redis: 'redis://stub' })
    const b = new RedisDriver({ redis: 'redis://stub' })
    const seenA: string[] = []
    const seenB: string[] = []
    a.subscribe((_c, e) => seenA.push(e))
    b.subscribe((_c, e) => seenB.push(e))
    await new Promise((r) => setTimeout(r, 5))
    await a.publish('chan', 'from-a', {})
    await b.publish('chan', 'from-b', {})
    await new Promise((r) => setTimeout(r, 5))
    assert.deepEqual(seenA.sort(), ['from-a', 'from-b'])
    assert.deepEqual(seenB.sort(), ['from-a', 'from-b'])
    await a.close()
    await b.close()
  })

  it('strips excludeConnectionId on foreign-origin deliveries', async () => {
    const a = new RedisDriver({ redis: 'redis://stub' })
    const b = new RedisDriver({ redis: 'redis://stub' })
    const seenA: BroadcastMeta[] = []
    const seenB: BroadcastMeta[] = []
    a.subscribe((_c, _e, _d, m) => { if (m) seenA.push(m) })
    b.subscribe((_c, _e, _d, m) => { if (m) seenB.push(m) })
    await new Promise((r) => setTimeout(r, 5))
    // A publishes with exclude id "sock-a-1" — should be honoured on A,
    // dropped on B (different origin).
    await a.publish('chan', 'evt', null, { excludeConnectionId: 'sock-a-1' })
    await new Promise((r) => setTimeout(r, 5))
    assert.equal(seenA[0]?.excludeConnectionId, 'sock-a-1')
    assert.equal(seenB[0]?.excludeConnectionId, undefined)
    await a.close()
    await b.close()
  })

  it('publish swallows transport errors instead of throwing', async () => {
    const drv = new RedisDriver({ redis: 'redis://stub' })
    await drv.close()  // forces the underlying stub to throw on publish
    await assert.doesNotReject(drv.publish('chan', 'evt', {}))
  })

  it('close() unsubscribes + disconnects', async () => {
    const drv = new RedisDriver({ redis: 'redis://stub' })
    const seen: string[] = []
    drv.subscribe((_c, e) => seen.push(e))
    await new Promise((r) => setTimeout(r, 5))
    await drv.close()
    // After close, further publish should no-op (errors swallowed).
    await drv.publish('chan', 'after-close', {})
    await new Promise((r) => setTimeout(r, 5))
    assert.equal(seen.length, 0)
  })
})
