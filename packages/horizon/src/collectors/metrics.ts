import { QueueRegistry } from '@rudderjs/queue'
import type { HorizonStorage, QueueMetric } from '../types.js'

/**
 * Periodically polls the queue adapter for stats and records metrics per queue.
 * Also tracks job throughput by counting completed jobs in each interval.
 */
export class MetricsCollector {
  readonly name = 'Metrics Collector'
  private throughputCounters: Map<string, number> = new Map()
  private waitTimeAccum: Map<string, { sum: number; count: number }> = new Map()
  private runtimeAccum: Map<string, { sum: number; count: number }> = new Map()

  constructor(
    private readonly storage: HorizonStorage,
    private readonly intervalMs: number = 60_000,
  ) {}

  register(): void {
    const timer = setInterval(() => this.collect(), this.intervalMs)
    timer.unref()
  }

  /** Called by the job collector when a job completes */
  recordJobCompleted(queue: string, waitTime: number, runtime: number): void {
    this.throughputCounters.set(queue, (this.throughputCounters.get(queue) ?? 0) + 1)

    const wt = this.waitTimeAccum.get(queue) ?? { sum: 0, count: 0 }
    wt.sum += waitTime
    wt.count += 1
    this.waitTimeAccum.set(queue, wt)

    const rt = this.runtimeAccum.get(queue) ?? { sum: 0, count: 0 }
    rt.sum += runtime
    rt.count += 1
    this.runtimeAccum.set(queue, rt)
  }

  private async collect(): Promise<void> {
    const adapter = QueueRegistry.get()
    if (!adapter) return

    // Collect metrics for each queue we've seen throughput on
    const queues = new Set(this.throughputCounters.keys())

    // Also query the adapter for known queue stats
    if (adapter.status) {
      try {
        const stats = await adapter.status()
        // Default queue always exists
        if (!queues.has('default')) queues.add('default')
        void stats // We'll use per-queue stats below
      } catch {
        // Adapter doesn't support per-queue stats
      }
    }

    for (const queue of queues) {
      const throughput = this.throughputCounters.get(queue) ?? 0
      const wt         = this.waitTimeAccum.get(queue)
      const rt         = this.runtimeAccum.get(queue)
      const avgWait    = wt && wt.count > 0 ? Math.round((wt.sum / wt.count) * 100) / 100 : 0
      const avgRuntime = rt && rt.count > 0 ? Math.round((rt.sum / rt.count) * 100) / 100 : 0

      // Try to get real queue stats from the adapter
      let pending = 0, active = 0, completed = 0, failed = 0
      if (adapter.status) {
        try {
          const stats = await adapter.status(queue)
          pending   = stats.waiting
          active    = stats.active
          completed = stats.completed
          failed    = stats.failed
        } catch {
          // Not supported for this queue
        }
      }

      const metric: QueueMetric = {
        queue,
        throughput,
        waitTime: avgWait,
        runtime:  avgRuntime,
        pending,
        active,
        completed,
        failed,
      }

      this.storage.recordMetric(metric)
    }

    // Reset accumulators
    this.throughputCounters.clear()
    this.waitTimeAccum.clear()
    this.runtimeAccum.clear()
  }
}
