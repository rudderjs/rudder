import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bullmq, type BullMQConfig } from './index.js'

// Note: tests that actually dispatch/work require a running Redis instance
// and are covered by integration tests. These tests verify the factory
// contract and adapter shape without opening any connections.

const baseConfig: BullMQConfig = {
  host:   '127.0.0.1',
  port:   6379,
  prefix: 'test',
  jobs:   [],
}

describe('bullmq() factory', () => {
  it('returns an object with a create() method', () => {
    const provider = bullmq(baseConfig)
    assert.strictEqual(typeof provider.create, 'function')
  })

  it('create() returns a QueueAdapter-shaped object', () => {
    const adapter = bullmq(baseConfig).create()
    const methods = ['dispatch', 'work', 'status', 'flush', 'failures', 'retryFailed', 'disconnect']
    for (const method of methods) {
      assert.strictEqual(
        typeof (adapter as unknown as Record<string, unknown>)[method],
        'function',
        `missing method: ${method}`,
      )
    }
  })

  it('works with empty config (all defaults)', () => {
    assert.doesNotThrow(() => bullmq({}).create())
  })

  it('works with url config', () => {
    assert.doesNotThrow(() => bullmq({ url: 'redis://127.0.0.1:6379' }).create())
  })

  it('works with concurrency and retention options', () => {
    assert.doesNotThrow(() => bullmq({
      concurrency:      5,
      removeOnComplete: 200,
      removeOnFail:     1000,
    }).create())
  })

  it('each call to create() returns a new adapter instance', () => {
    const provider = bullmq(baseConfig)
    const a = provider.create()
    const b = provider.create()
    assert.notStrictEqual(a, b)
  })
})

// ─── Phase 4: shutdown hygiene ───────────────────────────────

describe('BullMQAdapter.disconnect — shutdown hygiene (Phase 4)', () => {
  it('awaits worker close before queues, allSettled, and logs rejections without abandoning the rest', async () => {
    const adapter = bullmq(baseConfig).create() as unknown as {
      workers: Array<{ close(): Promise<void>; isRunning?(): boolean }>
      disconnect(): Promise<void>
    }

    // Simulate 3 active workers — one rejects, two resolve. allSettled should
    // log the rejection and still close the other two; the workers array must
    // reset to empty afterwards.
    let closed = 0
    adapter.workers.push(
      { async close() { closed++ } },
      { async close() { closed++; throw new Error('boom') } },
      { async close() { closed++ } },
    )

    const errors: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => { errors.push(args) }
    try {
      await adapter.disconnect()
    } finally {
      console.error = originalError
    }

    assert.equal(closed, 3, 'all three workers should have been close()d despite one rejection')
    assert.equal(adapter.workers.length, 0, 'workers array must reset after disconnect')
    const matched = errors.find(e => String(e[0] ?? '').includes('Worker close failed'))
    assert.ok(matched, 'rejection must be logged')
  })

  it('removes SIGTERM / SIGINT listeners that work() would register', async () => {
    const adapter = bullmq(baseConfig).create() as unknown as { disconnect(): Promise<void> }
    // Simulate what work() does — register the shutdown listener so we can
    // confirm disconnect() removes it. Read the bound handler via the same
    // private field name `_shutdown` the adapter uses.
    const shutdown = (adapter as unknown as { _shutdown: () => void })._shutdown
    process.on('SIGTERM', shutdown)
    process.on('SIGINT',  shutdown)
    const beforeTerm = process.listeners('SIGTERM').filter(l => l === shutdown).length
    const beforeInt  = process.listeners('SIGINT').filter(l => l === shutdown).length
    assert.equal(beforeTerm, 1)
    assert.equal(beforeInt,  1)

    await adapter.disconnect()

    const afterTerm = process.listeners('SIGTERM').filter(l => l === shutdown).length
    const afterInt  = process.listeners('SIGINT').filter(l => l === shutdown).length
    assert.equal(afterTerm, 0, 'disconnect() must remove SIGTERM listener')
    assert.equal(afterInt,  0, 'disconnect() must remove SIGINT listener')
  })
})
