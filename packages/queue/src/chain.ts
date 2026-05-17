import type { Job, QueueAdapter } from './index.js'
import { QueueRegistry } from './index.js'

// ─── Chain State ────────────────────────────────────────────
//
// Routed through `globalThis` so duplicate `@rudderjs/queue` bundles share
// one WeakMap. `Chain.of([...]).dispatch()` (entry.mjs bundle) stamps state
// on each job via `_setChainState`; the worker reads via `getChainState(this)`
// inside `handle()` — if the worker was loaded from a different bundle, the
// WeakMap lookup misses (different Map identity even though the Job instance
// is the same object). Same pattern as the static-state-singleton audit.

const CHAIN_STATES_KEY = '__rudderjs_queue_chain_states__'
const _chainStatesGlobal = globalThis as Record<string, unknown>
const _chainStates: WeakMap<Job, Record<string, unknown>> =
  (_chainStatesGlobal[CHAIN_STATES_KEY] as WeakMap<Job, Record<string, unknown>> | undefined)
  ?? (() => { const m = new WeakMap<Job, Record<string, unknown>>(); _chainStatesGlobal[CHAIN_STATES_KEY] = m; return m })()

/** Get the chain state for a job (empty object if not part of a chain). */
export function getChainState(job: Job): Record<string, unknown> {
  return _chainStates.get(job) ?? {}
}

/** @internal */
export function _setChainState(job: Job, state: Record<string, unknown>): void {
  _chainStates.set(job, state)
}

// ─── Chain ──────────────────────────────────────────────────

/**
 * Dispatch a sequence of jobs that run one after another.
 * If any job fails, the chain stops and `onFailure()` is called.
 * Jobs share state via `getChainState(this)` inside their `handle()`.
 *
 * @example
 * await Chain.of([
 *   new ProcessUpload(fileId),
 *   new GenerateThumbnail(fileId),
 *   new NotifyUser(userId),
 * ])
 *   .onFailure((err, job) => console.error('Chain failed at', job))
 *   .onQueue('media')
 *   .dispatch()
 */
export class Chain {
  private _onFailureFn?: (error: unknown, failedJob: Job) => void | Promise<void>
  private _queue = 'default'

  private constructor(private readonly _jobs: Job[]) {}

  static of(jobs: Job[]): Chain {
    return new Chain(jobs)
  }

  onFailure(fn: (error: unknown, failedJob: Job) => void | Promise<void>): this {
    this._onFailureFn = fn
    return this
  }

  onQueue(name: string): this {
    this._queue = name
    return this
  }

  async dispatch(): Promise<void> {
    const adapter = QueueRegistry.get()
    if (!adapter) throw new Error('[RudderJS Queue] No queue adapter registered')

    if (_supportsChain(adapter)) {
      const opts: Parameters<ChainableAdapter['dispatchChain']>[1] = { queue: this._queue }
      if (this._onFailureFn) opts.onFailure = this._onFailureFn
      return adapter.dispatchChain(this._jobs, opts)
    }

    // Default: sequential in-process execution via a single dispatched job
    await adapter.dispatch(
      _makeChainRunner(this._jobs, this._onFailureFn),
      { queue: this._queue },
    )
  }
}

// ─── Chain runner (internal job-like object) ────────────────

function _makeChainRunner(
  jobs: Job[],
  onFailureFn?: (error: unknown, failedJob: Job) => void | Promise<void>,
): Job {
  // Create a job-like object that runs the chain sequentially
  return {
    handle: async () => {
      const state: Record<string, unknown> = {}
      for (const job of jobs) {
        _setChainState(job, state)
        try {
          await job.handle()
        } catch (err) {
          if (onFailureFn) await onFailureFn(err, job)
          throw err
        }
      }
    },
  } as Job
}

// ─── Adapter extension ──────────────────────────────────────

interface ChainableAdapter extends QueueAdapter {
  dispatchChain(
    jobs: Job[],
    options: { queue?: string; onFailure?: (error: unknown, failedJob: Job) => void | Promise<void> },
  ): Promise<void>
}

function _supportsChain(adapter: QueueAdapter): adapter is ChainableAdapter {
  return typeof (adapter as ChainableAdapter).dispatchChain === 'function'
}
