import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import type { Collector, TelescopeStorage, TelescopeConfig } from '../types.js'
import { createEntry } from '../storage.js'
import { redactHeaders, redactFields } from '../redact.js'

const DEFAULT_HIDE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'x-api-key']
const DEFAULT_HIDE_FIELDS  = ['password', 'password_confirmation', 'token', 'secret']

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
    const storage     = this.storage
    const ignore      = this.config.ignoreRequests ?? []
    const hideHeaders = this.config.hideRequestHeaders ?? DEFAULT_HIDE_HEADERS
    const hideFields  = this.config.hideRequestFields  ?? DEFAULT_HIDE_FIELDS

    return async (req: AppRequest, res: AppResponse, next: () => Promise<void>) => {
      // Skip Vite internals, static assets, and source files
      if (this.isAsset(req.path)) return next()
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
        headers:  redactHeaders(req.headers as Record<string, unknown>, hideHeaders),
        body:     redactFields(req.body, hideFields),
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

  /** True for Vite internals, source files, and static assets */
  private isAsset(path: string): boolean {
    if (path.startsWith('/@'))            return true  // Vite internals: /@vite, /@react-refresh, /@id, /@fs
    if (path.startsWith('/node_modules')) return true
    if (path.startsWith('/src/'))         return true  // Vite source modules during dev
    if (path.startsWith('/pages/'))       return true  // Vike page modules during dev
    if (path.startsWith('/.vite/'))       return true  // Vite cache
    const segment = path.split('/').pop() ?? ''
    return segment.includes('.')                       // any file extension → static asset
  }
}
