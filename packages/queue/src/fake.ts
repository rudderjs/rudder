import assert from 'node:assert/strict'
import { QueueRegistry } from './index.js'
import type { QueueAdapter, DispatchOptions } from './index.js'
import { Job } from './index.js'

/**
 * Testing fake for @rudderjs/queue.
 *
 * Records all dispatched jobs instead of processing them, and provides
 * assertion methods for verifying queue behavior in tests.
 *
 * @example
 * const fake = Queue.fake()
 *
 * await SendWelcomeEmail.dispatch(user).send()
 *
 * fake.assertPushed(SendWelcomeEmail)
 * fake.assertPushedTimes(SendWelcomeEmail, 1)
 * fake.restore()
 */
export class FakeQueueAdapter implements QueueAdapter {
  // Behaves like an in-process driver for capability gating — closure /
  // chain / batch dispatchers can record under the fake the same way they
  // would on SyncAdapter.
  readonly supportsClosures = true
  readonly supportsChain    = true
  readonly supportsBatch    = true

  private readonly _jobs: Array<{ job: Job; options?: DispatchOptions | undefined }> = []

  // ─── QueueAdapter interface ──────────────────────────────

  async dispatch(job: Job, options?: DispatchOptions): Promise<void> {
    this._jobs.push(options !== undefined ? { job, options } : { job })
  }

  // ─── Assertions ──────────────────────────────────────────

  /** Assert that a job of the given class was pushed, optionally matching a predicate. */
  assertPushed(
    jobClass: new (...args: unknown[]) => Job,
    predicate?: (job: Job, options?: DispatchOptions) => boolean,
  ): void {
    const matching = this._matching(jobClass, predicate)
    assert.ok(
      matching.length > 0,
      `[RudderJS Queue] Expected job "${jobClass.name}" to be pushed, but it was not.`,
    )
  }

  /** Assert that a job was pushed to a specific queue. */
  assertPushedOn(
    queue: string,
    jobClass: new (...args: unknown[]) => Job,
  ): void {
    const matching = this._jobs.filter(
      (entry) =>
        this._isInstance(entry.job, jobClass) &&
        entry.options?.queue === queue,
    )
    assert.ok(
      matching.length > 0,
      `[RudderJS Queue] Expected job "${jobClass.name}" to be pushed on queue "${queue}", but it was not.`,
    )
  }

  /** Assert that a job was pushed exactly N times. */
  assertPushedTimes(
    jobClass: new (...args: unknown[]) => Job,
    count: number,
  ): void {
    const matching = this._matching(jobClass)
    assert.strictEqual(
      matching.length,
      count,
      `[RudderJS Queue] Expected job "${jobClass.name}" to be pushed ${count} time(s), but it was pushed ${matching.length} time(s).`,
    )
  }

  /** Assert that a job was NOT pushed. */
  assertNotPushed(jobClass: new (...args: unknown[]) => Job): void {
    const matching = this._matching(jobClass)
    assert.strictEqual(
      matching.length,
      0,
      `[RudderJS Queue] Expected job "${jobClass.name}" not to be pushed, but it was pushed ${matching.length} time(s).`,
    )
  }

  /** Assert that nothing was pushed at all. */
  assertNothingPushed(): void {
    assert.strictEqual(
      this._jobs.length,
      0,
      `[RudderJS Queue] Expected no jobs to be pushed, but ${this._jobs.length} were pushed.`,
    )
  }

  // ─── Access ──────────────────────────────────────────────

  /** Get all pushed jobs, optionally filtered by class. */
  pushed(
    jobClass?: new (...args: unknown[]) => Job,
  ): Array<{ job: Job; options?: DispatchOptions | undefined }> {
    if (!jobClass) return [...this._jobs]
    return this._matching(jobClass)
  }

  // ─── Cleanup ─────────────────────────────────────────────

  /** Restore the queue registry — clears the fake adapter. */
  restore(): void {
    QueueRegistry.reset()
  }

  // ─── Install ─────────────────────────────────────────────

  /** Install the fake — replaces the registered queue adapter with this fake. */
  static fake(): FakeQueueAdapter {
    const fake = new FakeQueueAdapter()
    QueueRegistry.set(fake)
    return fake
  }

  // ─── Internal ────────────────────────────────────────────

  private _isInstance(
    job: Job,
    jobClass: new (...args: unknown[]) => Job,
  ): boolean {
    return (
      job instanceof jobClass ||
      (job as object).constructor.name === jobClass.name
    )
  }

  private _matching(
    jobClass: new (...args: unknown[]) => Job,
    predicate?: (job: Job, options?: DispatchOptions) => boolean,
  ): Array<{ job: Job; options?: DispatchOptions | undefined }> {
    return this._jobs.filter((entry) => {
      if (!this._isInstance(entry.job, jobClass)) return false
      if (predicate && !predicate(entry.job, entry.options)) return false
      return true
    })
  }
}
