import { cpus, totalmem, freemem } from 'node:os'
import type { Aggregator, PulseStorage } from '../types.js'

/**
 * Periodically collects server resource metrics — CPU usage and memory.
 */
export class ServerAggregator implements Aggregator {
  readonly name = 'Server Aggregator'

  constructor(
    private readonly storage: PulseStorage,
    private readonly intervalMs: number = 15_000,
  ) {}

  register(): void {
    const timer = setInterval(() => this.collect(), this.intervalMs)
    timer.unref()
    // Collect once immediately
    this.collect()
  }

  private collect(): void {
    // CPU — average load across cores (0–100)
    const cores = cpus()
    const cpuPercent = cores.reduce((sum, core) => {
      const total = Object.values(core.times).reduce((a, b) => a + b, 0)
      const idle  = core.times.idle
      return sum + ((total - idle) / total) * 100
    }, 0) / cores.length

    this.storage.record('server_cpu', Math.round(cpuPercent * 100) / 100)

    // Memory — used percentage
    const total = totalmem()
    const free  = freemem()
    const usedPercent = ((total - free) / total) * 100
    this.storage.record('server_memory', Math.round(usedPercent * 100) / 100)
  }
}
