import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import type { TelescopeStorage, TelescopeConfig, EntryType } from './types.js'
import { Dashboard, EntryList, pages } from './views/vanilla/index.js'
import { DetailLayout, detailViews, NotFoundPage, BatchPage } from './views/vanilla/details/index.js'
import { listEntries, showEntry, overview, prune, listBatch, authMiddleware } from './api/routes.js'

const ENTRY_TYPES: EntryType[] = [
  'request', 'query', 'job', 'exception', 'log',
  'mail', 'notification', 'event', 'cache', 'schedule', 'model', 'command', 'broadcast', 'live',
  'http', 'gate', 'dump',
]

export interface RegisterTelescopeRoutesOptions {
  /** Path prefix for all telescope routes — default `/telescope` */
  path?: string
  /** Auth gate — receives request, returns boolean. Same shape as TelescopeConfig.auth. */
  auth?: TelescopeConfig['auth']
  /** Extra middleware to prepend to all routes */
  middleware?: MiddlewareHandler[]
}

/**
 * Register all Telescope routes — UI pages, per-entry detail pages, batch
 * groupings, API endpoints. Called from `TelescopeProvider.boot()` once
 * the router peer is resolved.
 *
 * Mirrors the package-UI shape established by `@rudderjs/auth`'s
 * `registerAuthRoutes()`. Package-internal pages live under
 * `views/vanilla/`, route registration is centralised here, the API
 * handler implementations live in `api/routes.ts`.
 */
export async function registerTelescopeRoutes(
  storage: TelescopeStorage,
  opts:    RegisterTelescopeRoutesOptions = {},
): Promise<void> {
  let router: { get: Function; delete: Function }
  try {
    router = (await import('@rudderjs/router')).router as never
  } catch {
    return // @rudderjs/router not installed — telescope routes disabled
  }

  const basePath  = `/${(opts.path ?? 'telescope').replace(/^\/+/, '')}`
  const apiPrefix = `${basePath}/api`
  const middleware: MiddlewareHandler[] = [
    ...(opts.middleware ?? []),
    ...(opts.auth ? [authMiddleware({ auth: opts.auth })] : []),
  ]

  const html = (_req: AppRequest, res: AppResponse, content: string): void => {
    res.header('Content-Type', 'text/html').send(content)
  }

  // ── Dashboard ─────────────────────────────────────────────
  router.get(basePath, (r: AppRequest, s: AppResponse) =>
    html(r, s, Dashboard({ basePath, apiPrefix })), middleware)

  // ── List + detail pages per watcher ──────────────────────
  for (const [pageKey, config] of Object.entries(pages)) {
    // List
    router.get(`${basePath}/${pageKey}`, (r: AppRequest, s: AppResponse) =>
      html(r, s, EntryList({
        basePath,
        apiPrefix,
        type:    config.type,
        pageKey,
        title:   config.title,
        columns: config.columns,
      })), middleware)

    // Detail — fetches the entry, dispatches to the watcher-specific view
    router.get(`${basePath}/${pageKey}/:id`, async (req: AppRequest, res: AppResponse) => {
      const id = req.params['id'] ?? ''
      const entry = await storage.find(id)
      if (!entry) {
        res.status(404).header('Content-Type', 'text/html').send(
          NotFoundPage({ basePath, what: config.title.replace(/s$/, ''), id }),
        )
        return
      }

      const viewFn = detailViews[entry.type]
      if (!viewFn) {
        res.status(500).header('Content-Type', 'text/html').send(
          NotFoundPage({ basePath, what: 'Detail view', id: entry.type }),
        )
        return
      }

      // Fetch related entries from the same batch (queries, cache, events, etc.)
      let relatedEntries: import('./types.js').TelescopeEntry[] = []
      if (entry.batchId) {
        const all = await storage.list({ batchId: entry.batchId, perPage: 200 })
        relatedEntries = all.filter(e => e.id !== entry.id)
      }

      res.header('Content-Type', 'text/html').send(
        DetailLayout({
          basePath,
          pageKey,
          pageTitle: config.title,
          entry,
          body:      viewFn(entry),
          relatedEntries,
        }),
      )
    }, middleware)
  }

  // ── Batch detail page ─────────────────────────────────────
  router.get(`${basePath}/batches/:batchId`, async (req: AppRequest, res: AppResponse) => {
    const batchId = req.params['batchId'] ?? ''
    const entries = await storage.list({ batchId, perPage: 500 })
    if (entries.length === 0) {
      res.status(404).header('Content-Type', 'text/html').send(
        NotFoundPage({ basePath, what: 'Batch', id: batchId }),
      )
      return
    }
    res.header('Content-Type', 'text/html').send(BatchPage({ basePath, batchId, entries }))
  }, middleware)

  // ── API: list + show per entry type ──────────────────────
  for (const type of ENTRY_TYPES) {
    const apiPath = type === 'query' ? 'queries' : type === 'http' ? 'http' : `${type}s`
    router.get(
      `${apiPrefix}/${apiPath}`,
      (req: AppRequest, res: AppResponse) => listEntries(storage, type, req, res),
      middleware,
    )
    router.get(
      `${apiPrefix}/${apiPath}/:id`,
      (req: AppRequest, res: AppResponse) => showEntry(storage, req, res),
      middleware,
    )
  }

  // ── API: batches + overview + prune ──────────────────────
  router.get(`${apiPrefix}/batches/:batchId`, (req: AppRequest, res: AppResponse) =>
    listBatch(storage, req, res), middleware)
  router.get(`${apiPrefix}/overview`, (_req: AppRequest, res: AppResponse) =>
    overview(storage, res), middleware)
  router.delete(`${apiPrefix}/entries`, (req: AppRequest, res: AppResponse) =>
    prune(storage, req, res), middleware)
}
