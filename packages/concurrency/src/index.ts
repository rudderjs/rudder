import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ─── Types ────────────────────────────────────────────────

type Task<T = unknown> = () => T | Promise<T>

interface ConcurrencyDriver {
  run<T extends unknown[]>(tasks: { [K in keyof T]: Task<T[K]> }): Promise<T>
  defer(task: Task<void>): void
}

// ─── Worker Driver ────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))

class WorkerDriver implements ConcurrencyDriver {
  private pool:       Worker[] = []
  private available:  Worker[] = []
  private waiting:    Array<{ resolve: (w: Worker) => void; reject: (e: Error) => void }> = []
  private nextId = 0

  constructor(private maxWorkers: number) {}

  private getWorkerScript(): string {
    return join(__dir, 'worker-entry.js')
  }

  private ensurePool(): void {
    if (this.pool.length > 0) return
    for (let i = 0; i < this.maxWorkers; i++) {
      const w = new Worker(this.getWorkerScript())
      this.pool.push(w)
      this.available.push(w)
    }
  }

  private acquire(): Promise<Worker> {
    this.ensurePool()
    const w = this.available.pop()
    if (w) return Promise.resolve(w)
    return new Promise((resolve, reject) => { this.waiting.push({ resolve, reject }) })
  }

  private release(worker: Worker): void {
    const next = this.waiting.shift()
    if (next) {
      next.resolve(worker)
    } else {
      this.available.push(worker)
    }
  }

  /**
   * A worker that emitted `error`/`exit` mid-task is dead — its thread is gone,
   * so returning it to the pool would wedge the next task (and `run()` with it).
   * Drop it, spin up a replacement, and hand that to a waiter so the pool stays
   * at size and nobody blocks forever.
   */
  private replaceWorker(dead: Worker): void {
    const i = this.pool.indexOf(dead)
    if (i !== -1) this.pool.splice(i, 1)
    void dead.terminate()
    const fresh = new Worker(this.getWorkerScript())
    this.pool.push(fresh)
    this.release(fresh)
  }

  async run<T extends unknown[]>(tasks: { [K in keyof T]: Task<T[K]> }): Promise<T> {
    const results = await Promise.all(
      (tasks as Task[]).map(async (task) => {
        const worker = await this.acquire()
        const id = this.nextId++
        let poisoned = false

        try {
          return await new Promise<unknown>((resolve, reject) => {
            const cleanup = () => {
              worker.off('message', handler)
              worker.off('error', errorHandler)
              worker.off('exit', exitHandler)
            }
            const handler = (msg: { id: number; result?: unknown; error?: string }) => {
              if (msg.id !== id) return
              cleanup()
              if (msg.error !== undefined) {
                reject(new Error(msg.error))
              } else {
                resolve(msg.result)
              }
            }
            // A worker-level `error` (uncaught throw / unhandled rejection in
            // the thread) kills the thread. Reject AND mark it poisoned so it
            // is discarded, not recycled — and remove the error listener too,
            // or it would leak across every subsequent task on this worker.
            const errorHandler = (err: Error) => {
              cleanup()
              poisoned = true
              reject(err)
            }
            // The worker exited before replying (process.exit() in the task, a
            // crash, or terminate() mid-task). Without this the task promise
            // would never settle and `run()` would hang forever.
            const exitHandler = (code: number) => {
              cleanup()
              poisoned = true
              reject(new Error(`[RudderJS Concurrency] Worker exited (code ${code}) before the task completed`))
            }
            worker.on('message', handler)
            worker.on('error', errorHandler)
            worker.on('exit', exitHandler)
            worker.postMessage({ id, fnSource: task.toString() })
          })
        } finally {
          if (poisoned) this.replaceWorker(worker)
          else this.release(worker)
        }
      })
    )
    return results as T
  }

  defer(task: Task<void>): void {
    // Fire and forget — run in background, log errors
    void this.run([task]).catch(err => {
      console.error('[RudderJS Concurrency] Deferred task error:', err)
    })
  }

  async terminate(): Promise<void> {
    // Reject anyone still parked in acquire() so their promise doesn't hang
    // forever once the pool is gone.
    const waiters = this.waiting.splice(0)
    for (const w of waiters) {
      w.reject(new Error('[RudderJS Concurrency] Driver terminated while waiting for a worker'))
    }
    await Promise.all(this.pool.map(w => w.terminate()))
    this.pool = []
    this.available = []
  }
}

// ─── Sync Driver ──────────────────────────────────────────

class SyncDriver implements ConcurrencyDriver {
  async run<T extends unknown[]>(tasks: { [K in keyof T]: Task<T[K]> }): Promise<T> {
    const results: unknown[] = []
    for (const task of tasks as Task[]) {
      results.push(await task())
    }
    return results as T
  }

  defer(task: Task<void>): void {
    void Promise.resolve().then(task).catch(err => {
      console.error('[RudderJS Concurrency] Deferred task error:', err)
    })
  }
}

// ─── Registry ─────────────────────────────────────────────

let _driver: ConcurrencyDriver | null = null
let _faked = false

function getDriver(): ConcurrencyDriver {
  if (!_driver) {
    // Auto-create a worker driver with default config
    _driver = new WorkerDriver(cpus().length)
  }
  return _driver
}

// ─── Concurrency facade ──────────────────────────────────

export class Concurrency {
  /**
   * Run tasks in parallel and return results in order.
   *
   * Tasks are serialized via `.toString()` and executed in worker threads.
   * They should be self-contained — closures over external variables will not work.
   * Use dynamic imports inside the function body for dependencies.
   */
  static run<T extends unknown[]>(tasks: { [K in keyof T]: Task<T[K]> }): Promise<T> {
    return getDriver().run(tasks)
  }

  /**
   * Fire-and-forget a task. Errors are logged but not thrown.
   */
  static defer(task: Task<void>): void {
    getDriver().defer(task)
  }

  /**
   * Switch to the synchronous driver for testing.
   * All tasks run sequentially in the main thread.
   */
  static fake(): void {
    // Terminate an auto-created worker driver before replacing it, otherwise
    // its pooled threads leak (restore() later sees only the SyncDriver and
    // would terminate nothing).
    if (_driver instanceof WorkerDriver) void _driver.terminate()
    _driver = new SyncDriver()
    _faked = true
  }

  /**
   * Restore the default worker driver.
   */
  static async restore(): Promise<void> {
    if (_driver && !_faked && _driver instanceof WorkerDriver) {
      await (_driver as WorkerDriver).terminate()
    }
    _driver = null
    _faked = false
  }
}
