import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import { QueueRegistry } from '@rudderjs/queue'
import type { HorizonStorage, HorizonConfig } from '../types.js'

/**
 * Register all Horizon API routes on the router.
 */
export async function registerRoutes(
  storage: HorizonStorage,
  config:  HorizonConfig,
): Promise<void> {
  const { router } = await import('@rudderjs/router')

  const prefix    = `/${config.path ?? 'horizon'}/api`
  const middleware = config.auth ? [authMiddleware(config)] : []

  // ── Overview stats ───────────────────────────────────────
  router.get(`${prefix}/stats`, async (_req: AppRequest, res: AppResponse) => {
    const [total, pending, processing, completed, failed, metrics, workerList] = await Promise.all([
      storage.jobCount(),
      storage.jobCount('pending'),
      storage.jobCount('processing'),
      storage.jobCount('completed'),
      storage.jobCount('failed'),
      storage.currentMetrics(),
      storage.workers(),
    ])

    res.json({
      jobs:    { total, pending, processing, completed, failed },
      queues:  metrics,
      workers: workerList.length,
    })
  }, middleware)

  // ── Recent jobs ──────────────────────────────────────────
  router.get(`${prefix}/jobs/recent`, async (req: AppRequest, res: AppResponse) => {
    const jobs = await storage.recentJobs({
      page:    parseInt(req.query['page']     ?? '1', 10),
      perPage: parseInt(req.query['per_page'] ?? '50', 10),
      queue:   req.query['queue'],
      search:  req.query['search'],
      status:  req.query['status'] as 'pending' | 'processing' | 'completed' | 'failed' | undefined,
    })
    const total = await storage.jobCount()
    res.json({ data: jobs, meta: { total } })
  }, middleware)

  // ── Failed jobs ──────────────────────────────────────────
  router.get(`${prefix}/jobs/failed`, async (req: AppRequest, res: AppResponse) => {
    const jobs = await storage.failedJobs({
      page:    parseInt(req.query['page']     ?? '1', 10),
      perPage: parseInt(req.query['per_page'] ?? '50', 10),
      queue:   req.query['queue'],
      search:  req.query['search'],
    })
    const total = await storage.jobCount('failed')
    res.json({ data: jobs, meta: { total } })
  }, middleware)

  // ── Single job detail ────────────────────────────────────
  router.get(`${prefix}/jobs/:id`, async (req: AppRequest, res: AppResponse) => {
    const job = await storage.findJob(req.params['id'] ?? '')
    if (!job) {
      res.status(404).json({ message: 'Job not found.' })
      return
    }
    res.json({ data: job })
  }, middleware)

  // ── Retry a failed job ───────────────────────────────────
  router.post(`${prefix}/jobs/:id/retry`, async (req: AppRequest, res: AppResponse) => {
    const job = await storage.findJob(req.params['id'] ?? '')
    if (!job) {
      res.status(404).json({ message: 'Job not found.' })
      return
    }
    if (job.status !== 'failed') {
      res.status(422).json({ message: 'Only failed jobs can be retried.' })
      return
    }

    // Use the queue adapter's retry if available, otherwise re-dispatch
    const adapter = QueueRegistry.get()
    if (adapter?.retryFailed) {
      await adapter.retryFailed(job.queue)
      storage.updateJob(job.id, { status: 'pending', exception: null })
      res.json({ message: 'Job queued for retry.' })
    } else {
      res.status(501).json({ message: 'Queue adapter does not support retry.' })
    }
  }, middleware)

  // ── Delete a failed job ──────────────────────────────────
  router.delete(`${prefix}/jobs/:id`, async (req: AppRequest, res: AppResponse) => {
    const job = await storage.findJob(req.params['id'] ?? '')
    if (!job) {
      res.status(404).json({ message: 'Job not found.' })
      return
    }
    storage.deleteJob(job.id)
    res.json({ message: 'Job deleted.' })
  }, middleware)

  // ── Queue-level metrics ──────────────────────────────────
  router.get(`${prefix}/queues`, async (_req: AppRequest, res: AppResponse) => {
    const metrics = await storage.currentMetrics()
    res.json({ data: metrics })
  }, middleware)

  router.get(`${prefix}/queues/:queue`, async (req: AppRequest, res: AppResponse) => {
    const queue = req.params['queue'] ?? 'default'
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000) // last 24h
    const history = await storage.metrics(queue, since)

    // Also get live stats from the adapter if available
    let live = null
    const adapter = QueueRegistry.get()
    if (adapter?.status) {
      try {
        live = await adapter.status(queue)
      } catch {
        // Not available
      }
    }

    res.json({ queue, history, live })
  }, middleware)

  // ── Worker status ────────────────────────────────────────
  router.get(`${prefix}/workers`, async (_req: AppRequest, res: AppResponse) => {
    const workerList = await storage.workers()
    res.json({ data: workerList })
  }, middleware)
}

// ─── Auth Middleware ────────────────────────────────────────

function authMiddleware(config: HorizonConfig): MiddlewareHandler {
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
