import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import type { TelescopeStorage, TelescopeConfig, EntryType } from './types.js'
import { Dashboard, EntryList, pages } from './views/vanilla/index.js'
import { listEntries, showEntry, overview, prune, authMiddleware } from './api/routes.js'

const ENTRY_TYPES: EntryType[] = [
  'request', 'query', 'job', 'exception', 'log',
  'mail', 'notification', 'event', 'cache', 'schedule', 'model',
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
 * Register all Telescope routes — UI pages, API endpoints, dashboard,
 * overview, and prune. Called from `TelescopeProvider.boot()` once the
 * router peer is resolved.
 *
 * Mirrors the package-UI shape established by `@rudderjs/auth`'s
 * `registerAuthRoutes()` — package-internal pages live under
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

  // ── UI pages ─────────────────────────────────────────────
  router.get(basePath, (r: AppRequest, s: AppResponse) =>
    html(r, s, Dashboard({ basePath, apiPrefix })), middleware)

  for (const [pagePath, config] of Object.entries(pages)) {
    router.get(`${basePath}/${pagePath}`, (r: AppRequest, s: AppResponse) =>
      html(r, s, EntryList({
        basePath,
        apiPrefix,
        type:    config.type,
        title:   config.title,
        columns: config.columns,
      })), middleware)
  }

  // ── API: list + show per entry type ──────────────────────
  for (const type of ENTRY_TYPES) {
    const apiPath = type === 'query' ? 'queries' : `${type}s`
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

  // ── API: overview + prune ────────────────────────────────
  router.get(`${apiPrefix}/overview`, (_req: AppRequest, res: AppResponse) =>
    overview(storage, res), middleware)
  router.delete(`${apiPrefix}/entries`, (req: AppRequest, res: AppResponse) =>
    prune(storage, req, res), middleware)
}
