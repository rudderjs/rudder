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
