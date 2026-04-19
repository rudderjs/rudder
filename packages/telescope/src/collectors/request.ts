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

      // Extract response status — prefer the actual final Response's status
      // (so redirect() calls that bypass res.status() still report accurately)
      // and fall back to the normalized res.statusCode.
      const finalRes = (res.raw as { res?: Response } | undefined)?.res
      const status = (finalRes?.status
        ?? ((res as unknown as Record<string, unknown>)['statusCode'] as number | undefined))
      if (status && status >= 400) tags.push('error')

      // Extract IP and user-agent from request headers
      const headers = req.headers as Record<string, unknown>
      const rawIp = (req as unknown as Record<string, unknown>)['ip'] as string | undefined
      const ip = rawIp === '::1' || rawIp === '::ffff:127.0.0.1' ? '127.0.0.1' : rawIp
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

      // Response body — populated by server-hono's res.json() and ViewResponse
      // branch. For redirects (3xx + Location) we synthesize a readable label
      // since the underlying Response has no meaningful body for users.
      let responseBody: unknown
      try {
        const c = res.raw as Record<string, unknown> | undefined
        const stashed = c?.['__rjs_response_body']
        if (stashed !== undefined) {
          responseBody = redactFields(stashed, hideFields)
        } else if (status != null && status >= 300 && status < 400 && responseHeaders?.['location']) {
          responseBody = `Redirected to ${responseHeaders['location']}`
        }
        // Size cap (~100KB serialized) to keep storage bounded.
        if (responseBody !== undefined && typeof responseBody !== 'string') {
          const serialized = JSON.stringify(responseBody)
          if (serialized.length > 100_000) {
            responseBody = { _truncated: true, _size: serialized.length, _preview: serialized.slice(0, 100_000) }
          }
        }
      } catch { /* ignore */ }

      // Session data — read from the SessionInstance if middleware attached one
      let sessionData: Record<string, unknown> | undefined
      try {
        const rawReq = req.raw as Record<string, unknown> | undefined
        const session = rawReq?.['__rjs_session'] as { all(): Record<string, unknown> } | undefined
        if (session) sessionData = redactFields(session.all(), hideFields) as Record<string, unknown>
      } catch { /* session middleware may not be installed */ }

      // Route metadata — stashed by server-hono's registerRoute()
      const rawReqMeta = req.raw as Record<string, unknown> | undefined
      const routeMeta = rawReqMeta?.['__rjs_route'] as {
        method: string; path: string; handler: string; middleware: string[]
      } | undefined
      const viewMeta = rawReqMeta?.['__rjs_view'] as {
        id: string; props: string[]
      } | undefined

      // Authenticated user — read from __rjs_user (populated by AuthMiddleware).
      // Can't call `auth().user()` here: the collector runs OUTSIDE the AuthMiddleware
      // ALS scope (global middleware wraps group middleware), so ALS is already gone.
      // AuthMiddleware writes __rjs_user both pre- and post-next(), so sign-in/sign-out
      // during the handler is reflected.
      let user: Record<string, unknown> | undefined
      const cachedUser = rawReqMeta?.['__rjs_user'] as Record<string, unknown> | undefined
      if (cachedUser) {
        user = {
          id:    cachedUser['id'],
          name:  cachedUser['name'],
          email: cachedUser['email'],
        }
        tags.push(`user:${cachedUser['id']}`)
      }

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
        memoryUsage: process.memoryUsage().heapUsed,
        responseHeaders,
        responseBody,
        session:    sessionData,
        user,
        controller: routeMeta?.handler,
        middleware: routeMeta?.middleware,
        routePath:  routeMeta?.path,
        view:       viewMeta,
      }, { batchId, tags })

      storage.store(entry)

      // Emit a sibling 'view' entry when the handler rendered a view — gives
      // the Views sidebar page a browsable history, keyed to this request
      // via the shared batchId.
      if (viewMeta && this.config.recordViews !== false) {
        const viewEnvelope = (res.raw as Record<string, unknown> | undefined)?.['__rjs_response_body'] as
          | { view?: string; props?: Record<string, unknown> }
          | undefined
        const fullProps = viewEnvelope?.props ?? {}
        const propsSize = (() => {
          try { return JSON.stringify(fullProps).length } catch { return 0 }
        })()
        const viewEntry = createEntry('view', {
          id:         viewMeta.id,
          props:      redactFields(fullProps, hideFields),
          propKeys:   viewMeta.props,
          propsSize,
          method:     req.method,
          path:       req.path,
          status,
          duration,
        }, { batchId, tags: [...tags, `view:${viewMeta.id}`] })
        storage.store(viewEntry)
      }
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
