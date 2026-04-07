import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import type { Collector, TelescopeStorage, TelescopeConfig } from '../types.js'
import { createEntry } from '../storage.js'

/**
 * Records HTTP requests — method, URL, status, duration, headers, payload.
 * Installs as global middleware via the router.
 */
export class RequestCollector implements Collector {
  readonly name = 'Request Collector'
  readonly type = 'request' as const

  constructor(
    private readonly storage: TelescopeStorage,
    private readonly config:  TelescopeConfig,
  ) {}

  register(): void {
    // Registration handled by the service provider — it adds this.middleware() to the router
  }

  /** Returns a middleware handler that records requests */
  middleware() {
    const storage  = this.storage
    const ignore   = this.config.ignoreRequests ?? []

    return async (req: AppRequest, res: AppResponse, next: () => Promise<void>) => {
      if (this.shouldIgnore(req.path, ignore)) {
        return next()
      }

      const start   = Date.now()
      const batchId = crypto.randomUUID()

      // Stash batchId on the raw request for other collectors to correlate
      ;(req as unknown as Record<string, unknown>)['__telescopeBatchId'] = batchId

      await next()

      const duration = Date.now() - start
      const tags: string[] = []
      if (duration > (this.config.slowQueryThreshold ?? 100)) tags.push('slow')

      const entry = createEntry('request', {
        method:   req.method,
        url:      req.url,
        path:     req.path,
        query:    req.query,
        headers:  req.headers,
        body:     req.body,
        duration,
        params:   req.params,
      }, { batchId, tags })

      storage.store(entry)
    }
  }

  private shouldIgnore(path: string, patterns: string[]): boolean {
    return patterns.some(p => {
      if (p.endsWith('*')) return path.startsWith(p.slice(0, -1))
      return path === p
    })
  }
}
