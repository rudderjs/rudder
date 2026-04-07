import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import type { Aggregator, PulseStorage, PulseConfig } from '../types.js'

/**
 * Tracks request throughput, duration (p50/p95/p99), and slow requests.
 * Installs as global middleware.
 */
export class RequestAggregator implements Aggregator {
  readonly name = 'Request Aggregator'

  constructor(
    private readonly storage: PulseStorage,
    private readonly config:  PulseConfig,
  ) {}

  register(): void {
    // Middleware is registered by the service provider
  }

  middleware() {
    const storage   = this.storage
    const threshold = this.config.slowRequestThreshold ?? 1000
    const ignore    = this.config.path ?? 'pulse'

    return async (req: AppRequest, res: AppResponse, next: () => Promise<void>) => {
      // Skip pulse's own routes
      if (req.path.startsWith(`/${ignore}`)) return next()
      // Skip static assets
      if (req.path.startsWith('/@') || (req.path.split('/').pop() ?? '').includes('.')) return next()

      const start = Date.now()
      await next()
      const duration = Date.now() - start

      // Record aggregates
      storage.record('request_count', 1)
      storage.record('request_duration', duration)

      // Slow request entry
      if (duration > threshold) {
        storage.storeEntry('slow_request', {
          method:   req.method,
          url:      req.url,
          path:     req.path,
          duration,
        })
      }
    }
  }
}
