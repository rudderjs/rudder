import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import { QueueRegistry } from '@rudderjs/queue'
import type { HorizonStorage, HorizonConfig, JobStatus } from '../types.js'

// ─── Handlers ──────────────────────────────────────────────
//
// Pure handler functions invoked from `../routes.ts`. Kept separate from
// route registration so they can be reused or unit-tested without spinning
// up a router.

export async function getStats(
  storage: HorizonStorage,
  _req:    AppRequest,
  res:     AppResponse,
): Promise<void> {
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
}

export async function listRecentJobs(
  storage: HorizonStorage,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const jobs = await storage.recentJobs({
    page:    parseInt(req.query['page']     ?? '1', 10),
    perPage: parseInt(req.query['per_page'] ?? '50', 10),
    queue:   req.query['queue'],
    search:  req.query['search'],
    status:  req.query['status'] as JobStatus | undefined,
  })
  const total = await storage.jobCount()
  res.json({ data: jobs, meta: { total } })
}

export async function listFailedJobs(
  storage: HorizonStorage,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const jobs = await storage.failedJobs({
    page:    parseInt(req.query['page']     ?? '1', 10),
    perPage: parseInt(req.query['per_page'] ?? '50', 10),
    queue:   req.query['queue'],
    search:  req.query['search'],
  })
  const total = await storage.jobCount('failed')
  res.json({ data: jobs, meta: { total } })
}

export async function showJob(
  storage: HorizonStorage,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const job = await storage.findJob(req.params['id'] ?? '')
  if (!job) {
    res.status(404).json({ message: 'Job not found.' })
    return
  }
  res.json({ data: job })
}

export async function retryJob(
  storage: HorizonStorage,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const job = await storage.findJob(req.params['id'] ?? '')
  if (!job) {
    res.status(404).json({ message: 'Job not found.' })
    return
  }
  if (job.status !== 'failed') {
    res.status(422).json({ message: 'Only failed jobs can be retried.' })
    return
  }

  const adapter = QueueRegistry.get()
  if (adapter?.retryFailed) {
    await adapter.retryFailed(job.queue)
    storage.updateJob(job.id, { status: 'pending', exception: null })
    res.json({ message: 'Job queued for retry.' })
  } else {
    res.status(501).json({ message: 'Queue adapter does not support retry.' })
  }
}

export async function deleteJob(
  storage: HorizonStorage,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const job = await storage.findJob(req.params['id'] ?? '')
  if (!job) {
    res.status(404).json({ message: 'Job not found.' })
    return
  }
  storage.deleteJob(job.id)
  res.json({ message: 'Job deleted.' })
}

export async function listQueues(
  storage: HorizonStorage,
  _req:    AppRequest,
  res:     AppResponse,
): Promise<void> {
  const metrics = await storage.currentMetrics()
  res.json({ data: metrics })
}

export async function showQueue(
  storage: HorizonStorage,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const queue = req.params['queue'] ?? 'default'
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000) // last 24h
  const history = await storage.metrics(queue, since)

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
}

export async function listWorkers(
  storage: HorizonStorage,
  _req:    AppRequest,
  res:     AppResponse,
): Promise<void> {
  const workerList = await storage.workers()
  res.json({ data: workerList })
}

// ─── Auth Middleware ───────────────────────────────────────

export function authMiddleware(config: Pick<HorizonConfig, 'auth'>): MiddlewareHandler {
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
