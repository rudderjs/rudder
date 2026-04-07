import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import type { TelescopeStorage, TelescopeConfig, EntryType } from '../types.js'
import {
  dashboardPage, requestsPage, queriesPage, jobsPage, exceptionsPage,
  logsPage, mailPage, notificationsPage, eventsPage, cachePage, schedulePage, modelsPage,
} from '../ui/pages.js'

const ENTRY_TYPES: EntryType[] = [
  'request', 'query', 'job', 'exception', 'log',
  'mail', 'notification', 'event', 'cache', 'schedule', 'model',
]

/**
 * Register all Telescope API routes on the router.
 * Called during the service provider's boot phase.
 */
export async function registerRoutes(
  storage: TelescopeStorage,
  config:  TelescopeConfig,
): Promise<void> {
  const { router } = await import('@rudderjs/router')

  const basePath   = `/${config.path ?? 'telescope'}`
  const prefix     = `${basePath}/api`
  const middleware  = config.auth ? [authMiddleware(config)] : []

  // ── UI Pages ─────────────────────────────────────────────
  const html = (_req: AppRequest, res: AppResponse, content: string) =>
    res.header('Content-Type', 'text/html').send(content)

  router.get(basePath,                   (r, s) => html(r, s, dashboardPage(basePath, prefix)), middleware)
  router.get(`${basePath}/requests`,     (r, s) => html(r, s, requestsPage(basePath, prefix)), middleware)
  router.get(`${basePath}/queries`,      (r, s) => html(r, s, queriesPage(basePath, prefix)), middleware)
  router.get(`${basePath}/jobs`,         (r, s) => html(r, s, jobsPage(basePath, prefix)), middleware)
  router.get(`${basePath}/exceptions`,   (r, s) => html(r, s, exceptionsPage(basePath, prefix)), middleware)
  router.get(`${basePath}/logs`,         (r, s) => html(r, s, logsPage(basePath, prefix)), middleware)
  router.get(`${basePath}/mail`,         (r, s) => html(r, s, mailPage(basePath, prefix)), middleware)
  router.get(`${basePath}/notifications`,(r, s) => html(r, s, notificationsPage(basePath, prefix)), middleware)
  router.get(`${basePath}/events`,       (r, s) => html(r, s, eventsPage(basePath, prefix)), middleware)
  router.get(`${basePath}/cache`,        (r, s) => html(r, s, cachePage(basePath, prefix)), middleware)
  router.get(`${basePath}/schedule`,     (r, s) => html(r, s, schedulePage(basePath, prefix)), middleware)
  router.get(`${basePath}/models`,       (r, s) => html(r, s, modelsPage(basePath, prefix)), middleware)

  // ── List routes for each entry type ──────────────────────
  for (const type of ENTRY_TYPES) {
    router.get(
      `${prefix}/${type === 'query' ? 'queries' : `${type}s`}`,
      (req: AppRequest, res: AppResponse) => listEntries(storage, type, req, res),
      middleware,
    )

    router.get(
      `${prefix}/${type === 'query' ? 'queries' : `${type}s`}/:id`,
      (req: AppRequest, res: AppResponse) => showEntry(storage, req, res),
      middleware,
    )
  }

  // ── Overview ─────────────────────────────────────────────
  router.get(`${prefix}/overview`, async (_req: AppRequest, res: AppResponse) => {
    const counts: Record<string, number> = {}
    for (const type of ENTRY_TYPES) {
      counts[type] = await storage.count(type)
    }
    res.json({ counts, total: await storage.count() })
  }, middleware)

  // ── Prune ────────────────────────────────────────────────
  router.delete(`${prefix}/entries`, async (req: AppRequest, res: AppResponse) => {
    const type = req.query['type'] as EntryType | undefined
    if (type && ENTRY_TYPES.includes(type)) {
      await storage.prune(type)
    } else {
      await storage.prune()
    }
    res.json({ message: 'Entries pruned.' })
  }, middleware)
}

// ─── Handlers ──────────────────────────────────────────────

async function listEntries(
  storage: TelescopeStorage,
  type:    EntryType,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const page    = parseInt(req.query['page']     ?? '1', 10)
  const perPage = parseInt(req.query['per_page'] ?? '50', 10)
  const tag     = req.query['tag']
  const search  = req.query['search']
  const batchId = req.query['batch_id']

  const entries = await storage.list({ type, page, perPage, tag, search, batchId })
  const total   = await storage.count(type)

  res.json({
    data: entries,
    meta: {
      total,
      page,
      per_page: perPage,
      last_page: Math.ceil(total / perPage),
    },
  })
}

async function showEntry(
  storage: TelescopeStorage,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const entry = await storage.find(req.params['id'] ?? '')
  if (!entry) {
    res.status(404).json({ message: 'Entry not found.' })
    return
  }

  // If this entry has a batchId, include related entries
  let related: unknown[] = []
  if (entry.batchId) {
    related = await storage.list({ batchId: entry.batchId, perPage: 100 })
  }

  res.json({ data: entry, related })
}

// ─── Auth Middleware ────────────────────────────────────────

function authMiddleware(config: TelescopeConfig): MiddlewareHandler {
  return async (req, res, next) => {
    if (config.auth) {
      const allowed = await config.auth(req)
      if (!allowed) {
        res.status(403).json({ message: 'Unauthorized.' })
        return
      }
    }
    return next()
  }
}
