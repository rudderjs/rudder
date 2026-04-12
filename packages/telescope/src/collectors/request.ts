import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import type { Collector, TelescopeStorage, TelescopeConfig } from '../types.js'
import { createEntry } from '../storage.js'
import { redactHeaders, redactFields } from '../redact.js'
import { setBatchId } from '../batch-context.js'

const DEFAULT_HIDE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'x-api-key']
const DEFAULT_HIDE_FIELDS  = ['password', 'password_confirmation', 'token', 'secret']

/**
 * Records HTTP requests — method, URL, status, duration, headers, payload,
 * response status, IP, user-agent.
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

      // Set batch context so collectors (query, cache, model) can correlate
      setBatchId(batchId)
      try {
        await next()
      } finally {
        setBatchId(null)
      }

      const duration = Date.now() - start
      const tags: string[] = []
      if (duration > (this.config.slowQueryThreshold ?? 100)) tags.push('slow')

      // Extract response status from the res object
      const status = (res as unknown as Record<string, unknown>)['statusCode'] as number | undefined
      if (status && status >= 400) tags.push('error')

      // Extract IP and user-agent from request headers
      const headers = req.headers as Record<string, unknown>
      const ip = (req as unknown as Record<string, unknown>)['ip'] as string | undefined
        ?? headers['x-forwarded-for'] as string | undefined
        ?? headers['x-real-ip'] as string | undefined
      const userAgent = headers['user-agent'] as string | undefined
      const hostname  = headers['host'] as string | undefined

      // Response headers — Hono stores the final Response on c.res after handler runs
      let responseHeaders: Record<string, string> | undefined
      try {
        const c = res.raw as { res?: Response } | undefined
        if (c?.res) {
          responseHeaders = {}
          c.res.headers.forEach((v, k) => { responseHeaders![k] = v })
          responseHeaders = redactHeaders(responseHeaders, hideHeaders) as Record<string, string> | undefined
        }
      } catch { /* ignore — non-Hono adapters may not expose c.res */ }

      // Session data — read from the SessionInstance if middleware attached one
      let sessionData: Record<string, unknown> | undefined
      try {
        const rawReq = req.raw as Record<string, unknown> | undefined
        const session = rawReq?.['__rjs_session'] as { all(): Record<string, unknown> } | undefined
        if (session) sessionData = redactFields(session.all(), hideFields) as Record<string, unknown>
      } catch { /* session middleware may not be installed */ }

      // Memory usage
      const memory = process.memoryUsage()

      const entry = createEntry('request', {
        method:    req.method,
        url:       req.url,
        path:      req.path,
        query:     req.query,
        headers:   redactHeaders(headers, hideHeaders),
        body:      redactFields(req.body, hideFields),
        duration,
        params:    req.params,
        status,
        ip,
        userAgent,
        hostname,
        responseHeaders,
        session:   sessionData,
        memory:    Math.round(memory.heapUsed / 1024 / 1024 * 100) / 100,
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
