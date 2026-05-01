import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import type { HorizonStorage, HorizonConfig } from './types.js'
import { Dashboard, RecentJobs, FailedJobs, Queues, Workers } from './views/vanilla/index.js'
import {
  getStats, listRecentJobs, listFailedJobs, showJob, retryJob, deleteJob,
  listQueues, showQueue, listWorkers, authMiddleware,
} from './api/routes.js'

export interface RegisterHorizonRoutesOptions {
  /** Path prefix for all horizon routes — default `/horizon` */
  path?:       string
  /** Auth gate — receives request, returns boolean. Same shape as `HorizonConfig.auth`. */
  auth?:       HorizonConfig['auth']
  /** Extra middleware to prepend to all routes */
  middleware?: MiddlewareHandler[]
}

/**
 * Register all Horizon routes — UI pages and API endpoints. Called from
 * `HorizonProvider.boot()` once the router peer is resolved.
 *
 * Mirrors the package-UI shape established by `@rudderjs/auth`'s
 * `registerAuthRoutes()` and `@rudderjs/telescope`'s
 * `registerTelescopeRoutes()`. Package-internal pages live under
 * `views/vanilla/`, route registration is centralised here, the API
 * handler implementations live in `api/routes.ts`.
 */
export async function registerHorizonRoutes(
  storage: HorizonStorage,
  opts:    RegisterHorizonRoutesOptions = {},
): Promise<void> {
  type Router = typeof import('@rudderjs/router')['router']
  let router: Pick<Router, 'get' | 'post' | 'delete'>
  try {
    router = (await import('@rudderjs/router')).router
  } catch {
    return // @rudderjs/router not installed — horizon routes disabled
  }

  const basePath  = `/${(opts.path ?? 'horizon').replace(/^\/+/, '')}`
  const apiPrefix = `${basePath}/api`
  const middleware: MiddlewareHandler[] = [
    ...(opts.middleware ?? []),
    ...(opts.auth ? [authMiddleware({ auth: opts.auth })] : []),
  ]

  const html = (_req: AppRequest, res: AppResponse, content: string): void => {
    res.header('Content-Type', 'text/html').send(content)
  }

  // ── UI Pages ─────────────────────────────────────────────
  router.get(basePath, (r: AppRequest, s: AppResponse) =>
    html(r, s, Dashboard({ basePath, apiPrefix })), middleware)
  router.get(`${basePath}/jobs/recent`, (r: AppRequest, s: AppResponse) =>
    html(r, s, RecentJobs({ basePath, apiPrefix })), middleware)
  router.get(`${basePath}/jobs/failed`, (r: AppRequest, s: AppResponse) =>
    html(r, s, FailedJobs({ basePath, apiPrefix })), middleware)
  router.get(`${basePath}/queues`, (r: AppRequest, s: AppResponse) =>
    html(r, s, Queues({ basePath, apiPrefix })), middleware)
  router.get(`${basePath}/workers`, (r: AppRequest, s: AppResponse) =>
    html(r, s, Workers({ basePath, apiPrefix })), middleware)

  // ── API ──────────────────────────────────────────────────
  router.get(`${apiPrefix}/stats`, (req: AppRequest, res: AppResponse) =>
    getStats(storage, req, res), middleware)
  router.get(`${apiPrefix}/jobs/recent`, (req: AppRequest, res: AppResponse) =>
    listRecentJobs(storage, req, res), middleware)
  router.get(`${apiPrefix}/jobs/failed`, (req: AppRequest, res: AppResponse) =>
    listFailedJobs(storage, req, res), middleware)
  router.get(`${apiPrefix}/jobs/:queue/:id`, (req: AppRequest, res: AppResponse) =>
    showJob(storage, req, res), middleware)
  router.post(`${apiPrefix}/jobs/:queue/:id/retry`, (req: AppRequest, res: AppResponse) =>
    retryJob(storage, req, res), middleware)
  router.delete(`${apiPrefix}/jobs/:queue/:id`, (req: AppRequest, res: AppResponse) =>
    deleteJob(storage, req, res), middleware)
  router.get(`${apiPrefix}/queues`, (req: AppRequest, res: AppResponse) =>
    listQueues(storage, req, res), middleware)
  router.get(`${apiPrefix}/queues/:queue`, (req: AppRequest, res: AppResponse) =>
    showQueue(storage, req, res), middleware)
  router.get(`${apiPrefix}/workers`, (req: AppRequest, res: AppResponse) =>
    listWorkers(storage, req, res), middleware)
}
