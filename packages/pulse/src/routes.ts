import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import type { PulseStorage, PulseConfig } from './types.js'
import { Dashboard } from './views/vanilla/index.js'
import {
  getOverview, getRequests, listSlowRequests, getQueues, listSlowQueries,
  getExceptions, getCache, getUsers, getServers, authMiddleware,
} from './api/routes.js'

export interface RegisterPulseRoutesOptions {
  /** Path prefix for all pulse routes — default `/pulse` */
  path?:       string
  /** Auth gate — receives request, returns boolean. Same shape as `PulseConfig.auth`. */
  auth?:       PulseConfig['auth']
  /** Extra middleware to prepend to all routes */
  middleware?: MiddlewareHandler[]
}

/**
 * Register all Pulse routes — dashboard page and API endpoints. Called
 * from `PulseProvider.boot()` once the router peer is resolved.
 *
 * Mirrors the package-UI shape established by `@rudderjs/auth`'s
 * `registerAuthRoutes()`, `@rudderjs/telescope`'s
 * `registerTelescopeRoutes()`, and `@rudderjs/horizon`'s
 * `registerHorizonRoutes()`. Package-internal pages live under
 * `views/vanilla/`, route registration is centralised here, the API
 * handler implementations live in `api/routes.ts`.
 */
export async function registerPulseRoutes(
  storage: PulseStorage,
  opts:    RegisterPulseRoutesOptions = {},
): Promise<void> {
  type Router = typeof import('@rudderjs/router')['router']
  let router: Pick<Router, 'get'>
  try {
    router = (await import('@rudderjs/router')).router
  } catch {
    return // @rudderjs/router not installed — pulse routes disabled
  }

  const basePath  = `/${(opts.path ?? 'pulse').replace(/^\/+/, '')}`
  const apiPrefix = `${basePath}/api`
  const middleware: MiddlewareHandler[] = [
    ...(opts.middleware ?? []),
    ...(opts.auth ? [authMiddleware({ auth: opts.auth })] : []),
  ]

  const html = (_req: AppRequest, res: AppResponse, content: string): void => {
    res.header('Content-Type', 'text/html').send(content)
  }

  // ── Dashboard UI ─────────────────────────────────────────
  router.get(basePath, (r: AppRequest, s: AppResponse) =>
    html(r, s, Dashboard({ apiPrefix })), middleware)

  // ── API ──────────────────────────────────────────────────
  router.get(`${apiPrefix}/overview`, (req: AppRequest, res: AppResponse) =>
    getOverview(storage, req, res), middleware)
  router.get(`${apiPrefix}/requests`, (req: AppRequest, res: AppResponse) =>
    getRequests(storage, req, res), middleware)
  router.get(`${apiPrefix}/slow-requests`, (req: AppRequest, res: AppResponse) =>
    listSlowRequests(storage, req, res), middleware)
  router.get(`${apiPrefix}/queues`, (req: AppRequest, res: AppResponse) =>
    getQueues(storage, req, res), middleware)
  router.get(`${apiPrefix}/slow-queries`, (req: AppRequest, res: AppResponse) =>
    listSlowQueries(storage, req, res), middleware)
  router.get(`${apiPrefix}/exceptions`, (req: AppRequest, res: AppResponse) =>
    getExceptions(storage, req, res), middleware)
  router.get(`${apiPrefix}/cache`, (req: AppRequest, res: AppResponse) =>
    getCache(storage, req, res), middleware)
  router.get(`${apiPrefix}/users`, (req: AppRequest, res: AppResponse) =>
    getUsers(storage, req, res), middleware)
  router.get(`${apiPrefix}/servers`, (req: AppRequest, res: AppResponse) =>
    getServers(storage, req, res), middleware)
}
