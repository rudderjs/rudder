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
  private waiting:    Array<(worker: Worker) => void> = []
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
    return new Promise(resolve => { this.waiting.push(resolve) })
  }

  private release(worker: Worker): void {
    const next = this.waiting.shift()
    if (next) {
      next(worker)
    } else {
      this.available.push(worker)
    }
  }

  async run<T extends unknown[]>(tasks: { [K in keyof T]: Task<T[K]> }): Promise<T> {
    const results = await Promise.all(
      (tasks as Task[]).map(async (task) => {
        const worker = await this.acquire()
        const id = this.nextId++

        try {
          return await new Promise<unknown>((resolve, reject) => {
            const handler = (msg: { id: number; result?: unknown; error?: string }) => {
              if (msg.id !== id) return
              worker.off('message', handler)
              worker.off('error', errorHandler)
              if (msg.error !== undefined) {
                reject(new Error(msg.error))
              } else {
                resolve(msg.result)
              }
            }
            const errorHandler = (err: Error) => {
              worker.off('message', handler)
              reject(err)
            }
            worker.on('message', handler)
            worker.on('error', errorHandler)
            worker.postMessage({ id, fnSource: task.toString() })
          })
        } finally {
          this.release(worker)
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
