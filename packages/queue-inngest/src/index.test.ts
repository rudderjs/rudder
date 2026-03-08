import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { inngest, type InngestConfig } from './index.js'

// Note: tests that actually dispatch/trigger require a running Inngest server
// and are covered by integration tests. These tests verify the factory
// contract and adapter shape without opening any connections.

const baseConfig: InngestConfig = {
  appId:  'test-app',
  jobs:   [],
}

describe('inngest() factory', () => {
  it('returns an object with a create() method', () => {
    const provider = inngest(baseConfig)
    assert.strictEqual(typeof provider.create, 'function')
  })

  it('create() returns an adapter with dispatch and serveHandler', () => {
    const adapter = inngest(baseConfig).create() as unknown as Record<string, unknown>
    assert.strictEqual(typeof adapter['dispatch'],     'function', 'missing method: dispatch')
    assert.strictEqual(typeof adapter['serveHandler'], 'function', 'missing method: serveHandler')
  })

  it('works with empty config (all defaults)', () => {
    assert.doesNotThrow(() => inngest({}).create())
  })

  it('works with signingKey and eventKey', () => {
    assert.doesNotThrow(() => inngest({
      appId:      'prod-app',
      signingKey: 'signkey-prod-abc',
      eventKey:   'eventkey-abc',
    }).create())
  })

  it('each call to create() returns a new adapter instance', () => {
    const provider = inngest(baseConfig)
    const a = provider.create()
    const b = provider.create()
    assert.notStrictEqual(a, b)
  })
})
