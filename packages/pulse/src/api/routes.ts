import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import type { PulseStorage, PulseConfig, MetricType } from '../types.js'
import { dashboardPage } from '../ui/dashboard.js'

const PERIODS: Record<string, number> = {
  '1h':  60 * 60 * 1000,
  '6h':  6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
}

function sinceFromPeriod(period: string): Date {
  const ms = PERIODS[period] ?? PERIODS['1h']!
  return new Date(Date.now() - ms)
}

/**
 * Register all Pulse API routes on the router.
 */
export async function registerRoutes(
  storage: PulseStorage,
  config:  PulseConfig,
): Promise<void> {
  const { router } = await import('@rudderjs/router')

  const basePath  = `/${config.path ?? 'pulse'}`
  const prefix    = `${basePath}/api`
  const middleware = config.auth ? [authMiddleware(config)] : []

  // ── Dashboard UI ─────────────────────────────────────────
  router.get(basePath, (_req: AppRequest, res: AppResponse) => {
    res.header('Content-Type', 'text/html').send(dashboardPage(prefix))
  }, middleware)

  // ── Overview ─────────────────────────────────────────────
  router.get(`${prefix}/overview`, async (req: AppRequest, res: AppResponse) => {
    const since = sinceFromPeriod(req.query['period'] ?? '1h')
    const aggregates = await storage.overview(since)

    // Group by type and compute summary stats
    const summary: Record<string, MetricSummary> = {}
    for (const agg of aggregates) {
      if (!summary[agg.type]) {
        summary[agg.type] = { count: 0, sum: 0, min: null, max: null, buckets: 0 }
      }
      const s = summary[agg.type]!
      s.count  += agg.count
      s.sum    += agg.sum
      s.buckets += 1
      if (agg.min !== null && (s.min === null || agg.min < s.min)) s.min = agg.min
      if (agg.max !== null && (s.max === null || agg.max > s.max)) s.max = agg.max
    }

    // Compute averages
    const metrics: Record<string, unknown> = {}
    for (const [type, s] of Object.entries(summary)) {
      metrics[type] = {
        total:   s.count,
        avg:     s.count > 0 ? Math.round((s.sum / s.count) * 100) / 100 : 0,
        min:     s.min,
        max:     s.max,
        buckets: s.buckets,
      }
    }

    res.json({ period: req.query['period'] ?? '1h', metrics })
  }, middleware)

  // ── Request metrics ──────────────────────────────────────
  router.get(`${prefix}/requests`, async (req: AppRequest, res: AppResponse) => {
    const since = sinceFromPeriod(req.query['period'] ?? '1h')
    const counts    = await storage.aggregates('request_count', since)
    const durations = await storage.aggregates('request_duration', since)

    res.json({
      throughput: counts.map(bucketToJson),
      duration:   durations.map(a => ({
        ...bucketToJson(a),
        avg: a.count > 0 ? Math.round((a.sum / a.count) * 100) / 100 : 0,
      })),
    })
  }, middleware)

  // ── Slow requests ────────────────────────────────────────
  router.get(`${prefix}/slow-requests`, async (req: AppRequest, res: AppResponse) => {
    const entries = await storage.entries('slow_request', {
      page:    parseInt(req.query['page'] ?? '1', 10),
      perPage: parseInt(req.query['per_page'] ?? '50', 10),
    })
    res.json({ data: entries })
  }, middleware)

  // ── Queue metrics ────────────────────────────────────────
  router.get(`${prefix}/queues`, async (req: AppRequest, res: AppResponse) => {
    const since      = sinceFromPeriod(req.query['period'] ?? '1h')
    const throughput  = await storage.aggregates('queue_throughput', since)
    const waitTimes   = await storage.aggregates('queue_wait_time', since)

    res.json({
      throughput: throughput.map(bucketToJson),
      wait_time:  waitTimes.map(a => ({
        ...bucketToJson(a),
        avg: a.count > 0 ? Math.round((a.sum / a.count) * 100) / 100 : 0,
      })),
    })
  }, middleware)

  // ── Slow queries ─────────────────────────────────────────
  router.get(`${prefix}/slow-queries`, async (req: AppRequest, res: AppResponse) => {
    const entries = await storage.entries('slow_query', {
      page:    parseInt(req.query['page'] ?? '1', 10),
      perPage: parseInt(req.query['per_page'] ?? '50', 10),
    })
    res.json({ data: entries })
  }, middleware)

  // ── Exceptions ───────────────────────────────────────────
  router.get(`${prefix}/exceptions`, async (req: AppRequest, res: AppResponse) => {
    const since = sinceFromPeriod(req.query['period'] ?? '1h')
    const aggregates = await storage.aggregates('exceptions', since)
    const entries    = await storage.entries('exception', {
      page:    parseInt(req.query['page'] ?? '1', 10),
      perPage: parseInt(req.query['per_page'] ?? '20', 10),
    })
    res.json({
      over_time: aggregates.map(bucketToJson),
      recent:    entries,
    })
  }, middleware)

  // ── Cache ────────────────────────────────────────────────
  router.get(`${prefix}/cache`, async (req: AppRequest, res: AppResponse) => {
    const since = sinceFromPeriod(req.query['period'] ?? '1h')
    const hits   = await storage.aggregates('cache_hits', since)
    const misses = await storage.aggregates('cache_misses', since)

    const totalHits   = hits.reduce((s, a) => s + a.count, 0)
    const totalMisses = misses.reduce((s, a) => s + a.count, 0)
    const total       = totalHits + totalMisses
    const hitRate     = total > 0 ? Math.round((totalHits / total) * 10000) / 100 : 0

    res.json({
      hit_rate: hitRate,
      total_hits:   totalHits,
      total_misses: totalMisses,
      hits:   hits.map(bucketToJson),
      misses: misses.map(bucketToJson),
    })
  }, middleware)

  // ── Active users ─────────────────────────────────────────
  router.get(`${prefix}/users`, async (req: AppRequest, res: AppResponse) => {
    const since = sinceFromPeriod(req.query['period'] ?? '1h')
    const aggregates = await storage.aggregates('active_users', since)
    res.json({ data: aggregates.map(bucketToJson) })
  }, middleware)

  // ── Server stats ─────────────────────────────────────────
  router.get(`${prefix}/servers`, async (req: AppRequest, res: AppResponse) => {
    const since = sinceFromPeriod(req.query['period'] ?? '1h')
    const cpu    = await storage.aggregates('server_cpu', since)
    const memory = await storage.aggregates('server_memory', since)

    res.json({
      cpu:    cpu.map(a => ({ ...bucketToJson(a), avg: a.count > 0 ? Math.round((a.sum / a.count) * 100) / 100 : 0 })),
      memory: memory.map(a => ({ ...bucketToJson(a), avg: a.count > 0 ? Math.round((a.sum / a.count) * 100) / 100 : 0 })),
    })
  }, middleware)
}

// ─── Helpers ───────────────────────────────────────────────

interface MetricSummary {
  count:   number
  sum:     number
  min:     number | null
  max:     number | null
  buckets: number
}

function bucketToJson(agg: { bucket: Date; type: string; key: string | null; count: number; min: number | null; max: number | null }) {
  return {
    bucket: agg.bucket.toISOString(),
    type:   agg.type,
    key:    agg.key,
    count:  agg.count,
    min:    agg.min,
    max:    agg.max,
  }
}

function authMiddleware(config: PulseConfig): MiddlewareHandler {
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
