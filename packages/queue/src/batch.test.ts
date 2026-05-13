import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Job, QueueRegistry, SyncAdapter } from './index.js'
import { Batch, Bus } from './batch.js'

class CountingJob extends Job {
  static runCount = 0
  ran = false
  async handle(): Promise<void> {
    CountingJob.runCount++
    this.ran = true
  }
}

class ThrowingJob extends Job {
  async handle(): Promise<void> {
    throw new Error('boom')
  }
}

describe('Batch', () => {
  beforeEach(() => {
    CountingJob.runCount = 0
    QueueRegistry.reset()
    QueueRegistry.set(new SyncAdapter())
  })

  describe('Bus.batch + dispatch', () => {
    it('runs every job and reports a finished batch', async () => {
      const batch = await Bus.batch([
        new CountingJob(),
        new CountingJob(),
        new CountingJob(),
      ]).dispatch()

      assert.strictEqual(CountingJob.runCount, 3)
      assert.strictEqual(batch.totalJobs, 3)
      assert.strictEqual(batch.processedJobs, 3)
      assert.strictEqual(batch.failedJobs, 0)
      assert.strictEqual(batch.finished, true)
      assert.strictEqual(batch.progress, 100)
    })

    it('then() fires when all jobs succeed', async () => {
      let thenCalledWith: Batch | null = null
      await Bus.batch([new CountingJob(), new CountingJob()])
        .then((b) => { thenCalledWith = b })
        .dispatch()

      assert.ok(thenCalledWith, 'expected then() to fire')
      assert.strictEqual((thenCalledWith as Batch).processedJobs, 2)
    })

    it('finally() fires whether or not jobs succeed', async () => {
      let finallyCount = 0
      await Bus.batch([new CountingJob()])
        .finally(() => { finallyCount++ })
        .dispatch()
      assert.strictEqual(finallyCount, 1)
    })

    it('catch() fires on a failed job with the error and batch', async () => {
      let caughtError: unknown = null
      let caughtBatch: Batch | null = null

      const batch = await Bus.batch([
        new CountingJob(),
        new ThrowingJob(),
        new CountingJob(),
      ])
        .catch((err, b) => { caughtError = err; caughtBatch = b })
        .dispatch()

      assert.ok(caughtError instanceof Error)
      assert.match((caughtError as Error).message, /boom/)
      assert.strictEqual(caughtBatch, batch)
      assert.strictEqual(batch.failedJobs, 1)
    })

    it('allowFailures() keeps the batch going past a failure', async () => {
      let thenCalled = false
      const batch = await Bus.batch([
        new CountingJob(),
        new ThrowingJob(),
        new CountingJob(),
      ])
        .allowFailures()
        .then(() => { thenCalled = true })
        .dispatch()

      // Sync runs in-process: 2 succeed, 1 fails. Counter only ticks for success.
      assert.strictEqual(CountingJob.runCount, 2)
      assert.strictEqual(batch.processedJobs, 2)
      assert.strictEqual(batch.failedJobs, 1)
      assert.strictEqual(batch.finished, true)
      // then() only fires when zero failures
      assert.strictEqual(thenCalled, false)
    })
  })

  describe('Batch state', () => {
    it('reports correct progress as recording happens', () => {
      const batch = new Batch('test_id', 4)
      assert.strictEqual(batch.progress, 0)
      assert.strictEqual(batch.pendingJobs, 4)

      batch._recordSuccess()
      assert.strictEqual(batch.progress, 25)
      assert.strictEqual(batch.processedJobs, 1)
      assert.strictEqual(batch.pendingJobs, 3)

      batch._recordFailure()
      batch._recordSuccess()
      batch._recordSuccess()
      assert.strictEqual(batch.processedJobs, 3)
      assert.strictEqual(batch.failedJobs, 1)
      assert.strictEqual(batch.pendingJobs, 0)
      assert.strictEqual(batch.finished, true)
      assert.strictEqual(batch.progress, 100)
    })

    it('cancel() flips cancelled but does not affect totals', () => {
      const batch = new Batch('test', 3)
      assert.strictEqual(batch.cancelled, false)
      batch.cancel()
      assert.strictEqual(batch.cancelled, true)
      assert.strictEqual(batch.totalJobs, 3)
    })

    it('empty batch reports 100% immediately', () => {
      const batch = new Batch('empty', 0)
      assert.strictEqual(batch.progress, 100)
      assert.strictEqual(batch.finished, true)
    })
  })
})
