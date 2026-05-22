import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { inngest, type InngestConfig } from './index.js'
import { Job } from '@rudderjs/queue'

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

// ─── Phase 4: __context round-trip + retries clamp ───────────

class TestJob extends Job {
  static override readonly retries = 25 // intentionally out of range
  async handle(): Promise<void> { /* no-op */ }
}

describe('InngestAdapter.dispatch — __context propagation (Phase 4)', () => {
  it('embeds DispatchOptions.__context into event.data so the worker can rehydrate', async () => {
    const adapter = inngest({ appId: 't', jobs: [TestJob] }).create()

    // Replace the internal Inngest client's `send` with a capture spy so we
    // can inspect the event payload without an Inngest server. Reaches in
    // through `client` deliberately — that's how the adapter wraps Inngest.
    const captured: Array<Record<string, unknown>> = []
    ;(adapter as unknown as { client: { send(e: unknown): Promise<unknown> } }).client.send =
      async (e: unknown) => { captured.push(e as Record<string, unknown>); return e }

    await adapter.dispatch(new TestJob(), { __context: { tenantId: 't-1' } })

    assert.equal(captured.length, 1)
    const data = (captured[0]!['data'] as Record<string, unknown>) ?? {}
    assert.deepEqual(data['__context'], { tenantId: 't-1' })
  })

  it('omits __context from event.data when DispatchOptions.__context is undefined', async () => {
    const adapter = inngest({ appId: 't', jobs: [TestJob] }).create()
    const captured: Array<Record<string, unknown>> = []
    ;(adapter as unknown as { client: { send(e: unknown): Promise<unknown> } }).client.send =
      async (e: unknown) => { captured.push(e as Record<string, unknown>); return e }

    await adapter.dispatch(new TestJob(), {})

    const data = (captured[0]!['data'] as Record<string, unknown>) ?? {}
    assert.equal('__context' in data, false, '__context must not appear when unset')
  })
})

describe('InngestAdapter retries clamp (Phase 4)', () => {
  it('clamps out-of-range Job.retries to [0,20] at registration with a warning', () => {
    const seen: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => { seen.push(args.map(String).join(' ')) }
    try {
      assert.doesNotThrow(() => inngest({ appId: 't', jobs: [TestJob] }).create())
    } finally {
      console.warn = originalWarn
    }
    assert.equal(seen.length, 1)
    assert.match(seen[0]!, /retries=25.*TestJob.*clamping to 20/)
  })
})
