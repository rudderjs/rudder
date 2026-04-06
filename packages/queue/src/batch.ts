import type { Job, QueueAdapter } from './index.js'
import { QueueRegistry } from './index.js'

// ─── Batch ──────────────────────────────────────────────────

let _batchIdCounter = 0

/**
 * Represents an active batch of jobs with tracking and callbacks.
 *
 * @example
 * const batch = await Bus.batch([
 *   new SendEmail(user1),
 *   new SendEmail(user2),
 *   new SendEmail(user3),
 * ])
 *   .then(batch  => console.log('All done!', batch.id))
 *   .catch((err, batch) => console.error('Failure!', batch.failedCount))
 *   .finally(batch => console.log('Finished, success or not'))
 *   .onQueue('mail')
 *   .dispatch()
 *
 * batch.progress      // 0..100
 * batch.totalJobs     // 3
 * batch.processedJobs // how many completed
 * batch.failedJobs    // how many failed
 * batch.finished      // boolean
 */
export class Batch {
  readonly id: string
  private _total      = 0
  private _processed  = 0
  private _failed     = 0
  private _cancelled  = false

  constructor(id: string, total: number) {
    this.id     = id
    this._total = total
  }

  get totalJobs(): number     { return this._total }
  get processedJobs(): number { return this._processed }
  get failedJobs(): number    { return this._failed }
  get pendingJobs(): number   { return this._total - this._processed - this._failed }
  get progress(): number      { return this._total === 0 ? 100 : Math.round(((this._processed + this._failed) / this._total) * 100) }
  get finished(): boolean     { return this._processed + this._failed >= this._total }
  get cancelled(): boolean    { return this._cancelled }

  /** Cancel the batch — remaining jobs will not be executed. */
  cancel(): void { this._cancelled = true }

  /** @internal */
  _recordSuccess(): void { this._processed++ }
  /** @internal */
  _recordFailure(): void { this._failed++ }
}

// ─── PendingBatch ───────────────────────────────────────────

export class PendingBatch {
  private _thenFn?:    (batch: Batch) => void | Promise<void>
  private _catchFn?:   (error: unknown, batch: Batch) => void | Promise<void>
  private _finallyFn?: (batch: Batch) => void | Promise<void>
  private _queue = 'default'
  private _allowFailures = false

  constructor(private readonly _jobs: Job[]) {}

  /** Called when ALL jobs complete successfully. */
  then(fn: (batch: Batch) => void | Promise<void>): this {
    this._thenFn = fn
    return this
  }

  /** Called when ANY job fails (unless `allowFailures()` is set). */
  catch(fn: (error: unknown, batch: Batch) => void | Promise<void>): this {
    this._catchFn = fn
    return this
  }

  /** Called when the batch finishes (success or failure). */
  finally(fn: (batch: Batch) => void | Promise<void>): this {
    this._finallyFn = fn
    return this
  }

  /** Allow individual job failures without stopping the batch. */
  allowFailures(): this {
    this._allowFailures = true
    return this
  }

  /** Dispatch the batch to a specific queue. */
  onQueue(name: string): this {
    this._queue = name
    return this
  }

  /** Dispatch all jobs and return the batch tracker. */
  async dispatch(): Promise<Batch> {
    const adapter = QueueRegistry.get()
    if (!adapter) throw new Error('[RudderJS Queue] No queue adapter registered')

    const batchId = `batch_${++_batchIdCounter}_${Date.now()}`
    const batch   = new Batch(batchId, this._jobs.length)

    if (_supportsBatch(adapter)) {
      const opts: Parameters<BatchableAdapter['dispatchBatch']>[1] = {
        batchId,
        queue:         this._queue,
        allowFailures: this._allowFailures,
      }
      if (this._thenFn)    opts.then    = this._thenFn
      if (this._catchFn)   opts.catch   = this._catchFn
      if (this._finallyFn) opts.finally = this._finallyFn
      return adapter.dispatchBatch(this._jobs, opts)
    }

    // Default: dispatch each job and track via a wrapper
    await _runBatchDefault(
      adapter,
      batch,
      this._jobs,
      this._queue,
      this._allowFailures,
      this._thenFn,
      this._catchFn,
      this._finallyFn,
    )

    return batch
  }
}

// ─── Bus ────────────────────────────────────────────────────

export class Bus {
  /** Create a batch of jobs. */
  static batch(jobs: Job[]): PendingBatch {
    return new PendingBatch(jobs)
  }
}

// ─── Default batch runner ───────────────────────────────────

async function _runBatchDefault(
  adapter: QueueAdapter,
  batch: Batch,
  jobs: Job[],
  queue: string,
  allowFailures: boolean,
  thenFn?: (batch: Batch) => void | Promise<void>,
  catchFn?: (error: unknown, batch: Batch) => void | Promise<void>,
  finallyFn?: (batch: Batch) => void | Promise<void>,
): Promise<void> {
  // Wrap each job to track success/failure
  const wrappedJobs = jobs.map(job => ({
    handle: async () => {
      if (batch.cancelled) return
      try {
        await job.handle()
        batch._recordSuccess()
      } catch (err) {
        batch._recordFailure()
        if (!allowFailures && catchFn) {
          await catchFn(err, batch)
        }
        if (!allowFailures) throw err
      }
    },
  } as Job))

  // Dispatch all wrapped jobs
  const results = await Promise.allSettled(
    wrappedJobs.map(j => adapter.dispatch(j, { queue }))
  )

  // For sync adapter, jobs already ran. For async adapters, they're just enqueued.
  // Check if any rejected
  const firstError = results.find(r => r.status === 'rejected')

  if (batch.failedJobs === 0 && !firstError) {
    if (thenFn) await thenFn(batch)
  }

  if (finallyFn) await finallyFn(batch)
}

// ─── Adapter extension ──────────────────────────────────────

interface BatchableAdapter extends QueueAdapter {
  dispatchBatch(
    jobs: Job[],
    options: {
      batchId: string
      queue?: string
      allowFailures?: boolean
      then?:    (batch: Batch) => void | Promise<void>
      catch?:   (error: unknown, batch: Batch) => void | Promise<void>
      finally?: (batch: Batch) => void | Promise<void>
    },
  ): Promise<Batch>
}

function _supportsBatch(adapter: QueueAdapter): adapter is BatchableAdapter {
  return typeof (adapter as BatchableAdapter).dispatchBatch === 'function'
}
