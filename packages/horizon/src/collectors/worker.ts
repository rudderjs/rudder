import { randomUUID } from 'node:crypto'
import type { HorizonStorage, WorkerInfo } from '../types.js'

/**
 * Tracks the current process as a worker.
 * Reports memory usage and job count periodically.
 */
export class WorkerCollector {
  readonly name = 'Worker Collector'
  private readonly workerId: string
  private jobsRun = 0
  private lastJobAt: Date | null = null

  constructor(
    private readonly storage: HorizonStorage,
    private readonly queue: string = 'default',
  ) {
    this.workerId = `worker-${randomUUID().slice(0, 8)}`
  }

  register(): void {
    // Report initial status
    this.report('active')

    // Periodically update
    const timer = setInterval(() => this.report('active'), 30_000)
    timer.unref()
  }

  /** Call when a job is processed by this worker */
  recordJobProcessed(): void {
    this.jobsRun++
    this.lastJobAt = new Date()
  }

  private report(status: WorkerInfo['status']): void {
    const memUsage = process.memoryUsage()
    const info: WorkerInfo = {
      id:        this.workerId,
      queue:     this.queue,
      status,
      jobsRun:   this.jobsRun,
      memoryMb:  Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
      startedAt: new Date(),
      lastJobAt: this.lastJobAt,
    }
    this.storage.recordWorker(info)
  }
}
