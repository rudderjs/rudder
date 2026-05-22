import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch, QueueRegistry, SyncAdapter, type Job, type QueueAdapter, type DispatchOptions } from './index.js'

// ─── A fake async-style driver that opts OUT of closure dispatch ──

class AsyncOnlyAdapter implements QueueAdapter {
  readonly supportsClosures = false
  readonly supportsChain    = false
  readonly supportsBatch    = false
  readonly pushed: Array<{ job: Job; options?: DispatchOptions | undefined }> = []
  async dispatch(job: Job, options?: DispatchOptions): Promise<void> {
    this.pushed.push(options !== undefined ? { job, options } : { job })
  }
}

// ─── closure dispatch ────────────────────────────────────────

describe('closure dispatch — capability gating', () => {
  let saved: QueueAdapter | null
  beforeEach(() => { saved = QueueRegistry.get(); QueueRegistry.reset() })
  afterEach(()  => { QueueRegistry.reset(); if (saved) QueueRegistry.set(saved) })

  it('runs the closure on the sync driver', async () => {
    QueueRegistry.set(new SyncAdapter())
    let ran = false
    await dispatch(async () => { ran = true })
    assert.equal(ran, true)
  })

  it('throws a clear error on an adapter that does not support closures', async () => {
    QueueRegistry.set(new AsyncOnlyAdapter())
    await assert.rejects(
      () => dispatch(async () => {}),
      /Closure dispatch.*not supported.*AsyncOnlyAdapter|dispatch\(fn\).*not supported.*AsyncOnlyAdapter/,
    )
  })

  it('the throw mentions the sync-driver remediation', async () => {
    QueueRegistry.set(new AsyncOnlyAdapter())
    let err: Error | undefined
    try { await dispatch(async () => {}) } catch (e) { err = e as Error }
    assert.ok(err, 'expected dispatch(fn) to throw')
    assert.match(err.message, /sync/i)
  })
})
