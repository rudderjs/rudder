import { randomUUID } from 'node:crypto'
import type {
  HorizonStorage, HorizonJob, QueueMetric, WorkerInfo,
  JobListOptions, JobStatus, HorizonRedisConfig,
} from './types.js'

// ─── Memory Storage ────────────────────────────────────────

export class MemoryStorage implements HorizonStorage {
  private readonly jobs: HorizonJob[] = []
  private readonly metricsHistory: Map<string, QueueMetric[]> = new Map()
  private readonly latestMetrics: Map<string, QueueMetric> = new Map()
  private readonly workerMap: Map<string, WorkerInfo> = new Map()

  constructor(private readonly maxJobs: number = 1000) {}

  recordJob(job: HorizonJob): void {
    this.jobs.unshift(job)
    if (this.jobs.length > this.maxJobs) {
      this.jobs.length = this.maxJobs
    }
  }

  updateJob(queue: string, id: string, updates: Partial<HorizonJob>): void {
    const job = this.jobs.find(j => j.queue === queue && j.id === id)
    if (job) Object.assign(job, updates)
  }

  recentJobs(options?: JobListOptions): HorizonJob[] {
    return this.filterJobs(options)
  }

  failedJobs(options?: JobListOptions): HorizonJob[] {
    return this.filterJobs({ ...options, status: 'failed' })
  }

  findJob(queue: string, id: string): HorizonJob | null {
    return this.jobs.find(j => j.queue === queue && j.id === id) ?? null
  }

  recordMetric(metric: QueueMetric): void {
    this.latestMetrics.set(metric.queue, metric)
    const history = this.metricsHistory.get(metric.queue) ?? []
    history.push(metric)
    if (history.length > 1440) history.shift() // keep 24h at 1-min resolution
    this.metricsHistory.set(metric.queue, history)
  }

  metrics(queue: string, since: Date): QueueMetric[] {
    const history = this.metricsHistory.get(queue) ?? []
    const sinceTs = since.getTime()
    // Metrics don't have timestamps in the record — approximate by index
    // For memory storage, return all history (it's already bounded)
    void sinceTs
    return [...history]
  }

  currentMetrics(): QueueMetric[] {
    return [...this.latestMetrics.values()]
  }

  recordWorker(worker: WorkerInfo): void {
    this.workerMap.set(worker.id, worker)
  }

  workers(): WorkerInfo[] {
    return [...this.workerMap.values()]
  }

  deleteJob(queue: string, id: string): void {
    const idx = this.jobs.findIndex(j => j.queue === queue && j.id === id)
    if (idx !== -1) this.jobs.splice(idx, 1)
  }

  pruneOlderThan(date: Date): void {
    const ts = date.getTime()
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      if (this.jobs[i]!.dispatchedAt.getTime() < ts) {
        this.jobs.splice(i, 1)
      }
    }
  }

  jobCount(status?: JobStatus): number {
    if (!status) return this.jobs.length
    return this.jobs.filter(j => j.status === status).length
  }

  private filterJobs(options?: JobListOptions): HorizonJob[] {
    let result = [...this.jobs]

    if (options?.status) {
      const s = options.status
      result = result.filter(j => j.status === s)
    }
    if (options?.queue) {
      const q = options.queue
      result = result.filter(j => j.queue === q)
    }
    if (options?.search) {
      const s = options.search.toLowerCase()
      result = result.filter(j =>
        j.name.toLowerCase().includes(s) ||
        JSON.stringify(j.payload).toLowerCase().includes(s),
      )
    }

    const page    = options?.page    ?? 1
    const perPage = options?.perPage ?? 50
    const start   = (page - 1) * perPage
    return result.slice(start, start + perPage)
  }
}

// ─── SQLite Storage ────────────────────────────────────────

export class SqliteStorage implements HorizonStorage {
  private db: import('better-sqlite3').Database | null = null

  constructor(private readonly dbPath: string) {}

  private getDb(): import('better-sqlite3').Database {
    if (!this.db) {
      const Database = (globalThis as Record<string, unknown>).__betterSqlite3 as typeof import('better-sqlite3') | undefined
      if (!Database) {
        throw new Error('[RudderJS Horizon] better-sqlite3 is required for SQLite storage. Run: pnpm add better-sqlite3')
      }
      this.db = new (Database as unknown as new (path: string) => import('better-sqlite3').Database)(this.dbPath)
      this.migrate()
    }
    return this.db
  }

  private migrate(): void {
    // v2 table: composite PK so cross-queue id collisions (BullMQ assigns ids
    // per-queue) don't clobber records. v1's `horizon_jobs` (single-column id
    // PK) is left untouched on upgrade — pruneAfterHours ages it out.
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS horizon_jobs_v2 (
        queue         TEXT NOT NULL,
        id            TEXT NOT NULL,
        name          TEXT NOT NULL,
        status        TEXT NOT NULL,
        payload       TEXT NOT NULL DEFAULT '{}',
        attempts      INTEGER NOT NULL DEFAULT 0,
        exception     TEXT,
        dispatched_at TEXT NOT NULL,
        started_at    TEXT,
        completed_at  TEXT,
        duration      INTEGER,
        tags          TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (queue, id)
      );
      CREATE INDEX IF NOT EXISTS idx_horizon_status ON horizon_jobs_v2(status, dispatched_at);
      CREATE INDEX IF NOT EXISTS idx_horizon_queue ON horizon_jobs_v2(queue, dispatched_at);

      CREATE TABLE IF NOT EXISTS horizon_metrics (
        id         TEXT PRIMARY KEY,
        queue      TEXT NOT NULL,
        throughput INTEGER NOT NULL DEFAULT 0,
        wait_time  REAL NOT NULL DEFAULT 0,
        runtime    REAL NOT NULL DEFAULT 0,
        pending    INTEGER NOT NULL DEFAULT 0,
        active     INTEGER NOT NULL DEFAULT 0,
        completed  INTEGER NOT NULL DEFAULT 0,
        failed     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_horizon_metrics_queue ON horizon_metrics(queue, created_at);

      CREATE TABLE IF NOT EXISTS horizon_workers (
        id         TEXT PRIMARY KEY,
        queue      TEXT NOT NULL,
        status     TEXT NOT NULL,
        jobs_run   INTEGER NOT NULL DEFAULT 0,
        memory_mb  REAL NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        last_job_at TEXT
      );
    `)
  }

  recordJob(job: HorizonJob): void {
    this.getDb().prepare(
      `INSERT OR REPLACE INTO horizon_jobs_v2 (queue, id, name, status, payload, attempts, exception, dispatched_at, started_at, completed_at, duration, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      job.queue, job.id, job.name, job.status,
      JSON.stringify(job.payload), job.attempts, job.exception,
      job.dispatchedAt.toISOString(),
      job.startedAt?.toISOString() ?? null,
      job.completedAt?.toISOString() ?? null,
      job.duration,
      JSON.stringify(job.tags),
    )
  }

  updateJob(queue: string, id: string, updates: Partial<HorizonJob>): void {
    const sets: string[] = []
    const params: unknown[] = []

    if (updates.status !== undefined)      { sets.push('status = ?');       params.push(updates.status) }
    if (updates.attempts !== undefined)    { sets.push('attempts = ?');     params.push(updates.attempts) }
    if (updates.exception !== undefined)   { sets.push('exception = ?');    params.push(updates.exception) }
    if (updates.startedAt !== undefined)   { sets.push('started_at = ?');   params.push(updates.startedAt?.toISOString() ?? null) }
    if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(updates.completedAt?.toISOString() ?? null) }
    if (updates.duration !== undefined)    { sets.push('duration = ?');     params.push(updates.duration) }

    if (sets.length === 0) return
    params.push(queue, id)
    this.getDb().prepare(`UPDATE horizon_jobs_v2 SET ${sets.join(', ')} WHERE queue = ? AND id = ?`).run(...params)
  }

  recentJobs(options?: JobListOptions): HorizonJob[] {
    return this.queryJobs(options)
  }

  failedJobs(options?: JobListOptions): HorizonJob[] {
    return this.queryJobs({ ...options, status: 'failed' })
  }

  findJob(queue: string, id: string): HorizonJob | null {
    const row = this.getDb().prepare('SELECT * FROM horizon_jobs_v2 WHERE queue = ? AND id = ?').get(queue, id) as Record<string, unknown> | undefined
    return row ? this.jobFromRow(row) : null
  }

  recordMetric(metric: QueueMetric): void {
    this.getDb().prepare(
      `INSERT INTO horizon_metrics (id, queue, throughput, wait_time, runtime, pending, active, completed, failed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(), metric.queue, metric.throughput, metric.waitTime, metric.runtime,
      metric.pending, metric.active, metric.completed, metric.failed,
      new Date().toISOString(),
    )
  }

  metrics(queue: string, since: Date): QueueMetric[] {
    const rows = this.getDb().prepare(
      'SELECT * FROM horizon_metrics WHERE queue = ? AND created_at >= ? ORDER BY created_at ASC',
    ).all(queue, since.toISOString()) as Record<string, unknown>[]
    return rows.map(r => this.metricFromRow(r))
  }

  currentMetrics(): QueueMetric[] {
    const rows = this.getDb().prepare(
      `SELECT m.* FROM horizon_metrics m
       INNER JOIN (SELECT queue, MAX(created_at) as max_created FROM horizon_metrics GROUP BY queue) latest
       ON m.queue = latest.queue AND m.created_at = latest.max_created`,
    ).all() as Record<string, unknown>[]
    return rows.map(r => this.metricFromRow(r))
  }

  recordWorker(worker: WorkerInfo): void {
    this.getDb().prepare(
      `INSERT OR REPLACE INTO horizon_workers (id, queue, status, jobs_run, memory_mb, started_at, last_job_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(worker.id, worker.queue, worker.status, worker.jobsRun, worker.memoryMb,
      worker.startedAt.toISOString(), worker.lastJobAt?.toISOString() ?? null)
  }

  workers(): WorkerInfo[] {
    const rows = this.getDb().prepare('SELECT * FROM horizon_workers').all() as Record<string, unknown>[]
    return rows.map(r => ({
      id:        r['id'] as string,
      queue:     r['queue'] as string,
      status:    r['status'] as WorkerInfo['status'],
      jobsRun:   r['jobs_run'] as number,
      memoryMb:  r['memory_mb'] as number,
      startedAt: new Date(r['started_at'] as string),
      lastJobAt: r['last_job_at'] ? new Date(r['last_job_at'] as string) : null,
    }))
  }

  deleteJob(queue: string, id: string): void {
    this.getDb().prepare('DELETE FROM horizon_jobs_v2 WHERE queue = ? AND id = ?').run(queue, id)
  }

  pruneOlderThan(date: Date): void {
    const iso = date.toISOString()
    const db  = this.getDb()
    db.prepare('DELETE FROM horizon_jobs_v2 WHERE dispatched_at < ?').run(iso)
    db.prepare('DELETE FROM horizon_metrics WHERE created_at < ?').run(iso)
  }

  jobCount(status?: JobStatus): number {
    if (status) {
      const row = this.getDb().prepare('SELECT COUNT(*) as cnt FROM horizon_jobs_v2 WHERE status = ?').get(status) as { cnt: number }
      return row.cnt
    }
    const row = this.getDb().prepare('SELECT COUNT(*) as cnt FROM horizon_jobs_v2').get() as { cnt: number }
    return row.cnt
  }

  private queryJobs(options?: JobListOptions): HorizonJob[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (options?.status) { conditions.push('status = ?'); params.push(options.status) }
    if (options?.queue)  { conditions.push('queue = ?');  params.push(options.queue) }
    if (options?.search) { conditions.push('(name LIKE ? OR payload LIKE ?)'); params.push(`%${options.search}%`, `%${options.search}%`) }

    const where   = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const page    = options?.page    ?? 1
    const perPage = options?.perPage ?? 50
    const offset  = (page - 1) * perPage
    params.push(perPage, offset)

    const rows = this.getDb().prepare(
      `SELECT * FROM horizon_jobs_v2 ${where} ORDER BY dispatched_at DESC LIMIT ? OFFSET ?`,
    ).all(...params) as Record<string, unknown>[]

    return rows.map(r => this.jobFromRow(r))
  }

  private jobFromRow(r: Record<string, unknown>): HorizonJob {
    return {
      id:           r['id'] as string,
      name:         r['name'] as string,
      queue:        r['queue'] as string,
      status:       r['status'] as JobStatus,
      payload:      JSON.parse(r['payload'] as string) as Record<string, unknown>,
      attempts:     r['attempts'] as number,
      exception:    (r['exception'] as string) || null,
      dispatchedAt: new Date(r['dispatched_at'] as string),
      startedAt:    r['started_at'] ? new Date(r['started_at'] as string) : null,
      completedAt:  r['completed_at'] ? new Date(r['completed_at'] as string) : null,
      duration:     (r['duration'] as number) ?? null,
      tags:         JSON.parse(r['tags'] as string) as string[],
    }
  }

  private metricFromRow(r: Record<string, unknown>): QueueMetric {
    return {
      queue:      r['queue'] as string,
      throughput: r['throughput'] as number,
      waitTime:   r['wait_time'] as number,
      runtime:    r['runtime'] as number,
      pending:    r['pending'] as number,
      active:     r['active'] as number,
      completed:  r['completed'] as number,
      failed:     r['failed'] as number,
    }
  }
}

// ─── Redis Storage ─────────────────────────────────────────

interface RedisLike {
  hset(key: string, field: Record<string, string | number>): Promise<number>
  hsetnx(key: string, field: string, value: string | number): Promise<number>
  hgetall(key: string): Promise<Record<string, string>>
  zadd(key: string, score: number, member: string): Promise<number>
  zcard(key: string): Promise<number>
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>
  zrevrange(key: string, start: number, stop: number): Promise<string[]>
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>
  zrem(key: string, member: string): Promise<number>
  smembers(key: string): Promise<string[]>
  sadd(key: string, member: string): Promise<number>
  del(...keys: string[]): Promise<number>
  pipeline(): RedisPipelineLike
  quit(): Promise<'OK'>
}

interface RedisPipelineLike {
  hgetall(key: string): RedisPipelineLike
  exec(): Promise<[Error | null, unknown][] | null>
}

/**
 * Cross-process job/metric/worker store backed by Redis. Works alongside
 * BullMQ's own Redis instance (separate connection by default) so the dev
 * server and worker process share state.
 *
 * Falls back to memory if `ioredis` cannot be imported — the boot warning
 * surfaces the misconfig.
 */
export class RedisStorage implements HorizonStorage {
  private client: RedisLike | null = null
  private readonly prefix: string

  constructor(
    private readonly config:  HorizonRedisConfig = {},
    private readonly maxJobs: number             = 1000,
  ) {
    this.prefix = `${config.prefix ?? 'rudderjs'}:horizon`
  }

  private async getClient(): Promise<RedisLike> {
    if (this.client) return this.client
    const mod = await import(/* @vite-ignore */ 'ioredis') as unknown as {
      default: new (opts: Record<string, unknown>) => RedisLike
    }
    const Redis = mod.default
    this.client = new Redis(this.connectionOpts())
    return this.client
  }

  private connectionOpts(): Record<string, unknown> {
    const c = this.config
    if (c.url) {
      try {
        const u = new URL(c.url.replace(/^rediss?:\/\//, 'http://'))
        return {
          host: u.hostname || '127.0.0.1',
          port: parseInt(u.port || '6379', 10),
          ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
          ...(u.pathname.length > 1 ? { db: parseInt(u.pathname.slice(1), 10) } : {}),
          lazyConnect: false,
        }
      } catch { /* fall through */ }
    }
    return {
      host: c.host ?? '127.0.0.1',
      port: c.port ?? 6379,
      ...(c.password ? { password: c.password } : {}),
      lazyConnect: false,
    }
  }

  // ─── Keys ────────────────────────────────────────────────
  //
  // Job records are stored at `jobs:{queue}:{id}`. BullMQ assigns ids
  // per-queue (each queue starts at 1), so keying by id alone collides
  // across queues. The `recent` and `failed` ZSets store members as
  // `{queue}:{id}` so the listing path can split + lookup.

  private k = {
    job:           (queue: string, id: string) => `${this.prefix}:jobs:${queue}:${id}`,
    recent:        ()                          => `${this.prefix}:jobs:recent`,
    failed:        ()                          => `${this.prefix}:jobs:failed`,
    byQueue:       (q: string)                 => `${this.prefix}:jobs:by-queue:${q}`,
    metricCurrent: (q: string)                 => `${this.prefix}:metrics:${q}:current`,
    metricHistory: (q: string)                 => `${this.prefix}:metrics:${q}:history`,
    worker:        (id: string)                => `${this.prefix}:workers:${id}`,
    workersIndex:  ()                          => `${this.prefix}:workers`,
  }

  private member(queue: string, id: string): string {
    return `${queue}:${id}`
  }

  private parseMember(member: string): { queue: string; id: string } | null {
    const idx = member.indexOf(':')
    if (idx === -1) return null  // legacy v1 member; skip
    return { queue: member.slice(0, idx), id: member.slice(idx + 1) }
  }

  // ─── Jobs ────────────────────────────────────────────────

  async recordJob(job: HorizonJob): Promise<void> {
    const r   = await this.getClient()
    const m   = this.member(job.queue, job.id)
    const key = this.k.job(job.queue, job.id)

    // Idempotent fields — same value across the lifecycle, safe to overwrite.
    await r.hset(key, {
      id:           job.id,
      name:         job.name,
      queue:        job.queue,
      payload:      JSON.stringify(job.payload),
      dispatchedAt: job.dispatchedAt.toISOString(),
      tags:         JSON.stringify(job.tags),
    })

    // Lifecycle fields — set only if not already written. The dashboard
    // process emits `job.dispatched` and queues an async storage write via
    // microtask; the worker process can update the record to `processing`
    // / `completed` BEFORE that microtask flushes (the dispatcher races
    // BullMQ's polling). Plain HSET would let a late dispatched-write
    // clobber the worker's status. HSETNX makes recordJob idempotent for
    // these fields so worker updates always win.
    await Promise.all([
      r.hsetnx(key, 'status',      job.status),
      r.hsetnx(key, 'attempts',    job.attempts),
      r.hsetnx(key, 'startedAt',   job.startedAt   ? job.startedAt.toISOString()   : ''),
      r.hsetnx(key, 'completedAt', job.completedAt ? job.completedAt.toISOString() : ''),
      r.hsetnx(key, 'duration',    job.duration ?? -1),
      r.hsetnx(key, 'exception',   job.exception ?? ''),
    ])

    const score = job.dispatchedAt.getTime()
    await r.zadd(this.k.recent(),           score, m)
    await r.zadd(this.k.byQueue(job.queue), score, job.id)
    if (job.status === 'failed') {
      await r.zadd(this.k.failed(), score, m)
    }
    // Cap recent index to maxJobs (drop oldest)
    const count = await r.zcard(this.k.recent())
    if (count > this.maxJobs) {
      await r.zremrangebyrank(this.k.recent(), 0, count - this.maxJobs - 1)
    }
  }

  async updateJob(queue: string, id: string, updates: Partial<HorizonJob>): Promise<void> {
    const r = await this.getClient()
    const fields: Record<string, string | number> = {}

    if (updates.status      !== undefined) fields['status']        = updates.status
    if (updates.attempts    !== undefined) fields['attempts']      = updates.attempts
    if (updates.exception   !== undefined) fields['exception']     = updates.exception ?? ''
    if (updates.startedAt   !== undefined) fields['startedAt']     = updates.startedAt   ? updates.startedAt.toISOString()   : ''
    if (updates.completedAt !== undefined) fields['completedAt']   = updates.completedAt ? updates.completedAt.toISOString() : ''
    if (updates.duration    !== undefined) fields['duration']      = updates.duration ?? -1
    if (updates.payload     !== undefined) fields['payload']       = JSON.stringify(updates.payload)
    if (updates.tags        !== undefined) fields['tags']          = JSON.stringify(updates.tags)

    if (Object.keys(fields).length === 0) return
    await r.hset(this.k.job(queue, id), fields)

    const m = this.member(queue, id)
    if (updates.status === 'failed') {
      const job = await this.findJob(queue, id)
      if (job) await r.zadd(this.k.failed(), job.dispatchedAt.getTime(), m)
    } else if (updates.status === 'completed') {
      await r.zrem(this.k.failed(), m)
    }
  }

  async recentJobs(options?: JobListOptions): Promise<HorizonJob[]> {
    return this.listJobs(this.k.recent(), options)
  }

  async failedJobs(options?: JobListOptions): Promise<HorizonJob[]> {
    return this.listJobs(this.k.failed(), { ...options, status: 'failed' })
  }

  async findJob(queue: string, id: string): Promise<HorizonJob | null> {
    const r    = await this.getClient()
    const hash = await r.hgetall(this.k.job(queue, id))
    if (!hash || Object.keys(hash).length === 0) return null
    return this.jobFromHash(hash)
  }

  async deleteJob(queue: string, id: string): Promise<void> {
    const r = await this.getClient()
    const m = this.member(queue, id)
    await r.del(this.k.job(queue, id))
    await r.zrem(this.k.recent(), m)
    await r.zrem(this.k.failed(), m)
  }

  async pruneOlderThan(date: Date): Promise<void> {
    const r       = await this.getClient()
    const cut     = date.getTime()
    const members = await r.zrangebyscore(this.k.recent(), '-inf', cut)
    if (members.length === 0) return
    await Promise.all(members.map(m => {
      const parsed = this.parseMember(m)
      return parsed ? r.del(this.k.job(parsed.queue, parsed.id)) : Promise.resolve(0)
    }))
    await r.zremrangebyscore(this.k.recent(), '-inf', cut)
    await r.zremrangebyscore(this.k.failed(), '-inf', cut)
  }

  async jobCount(status?: JobStatus): Promise<number> {
    const r = await this.getClient()
    if (!status) return r.zcard(this.k.recent())
    if (status === 'failed') return r.zcard(this.k.failed())
    // For other statuses we'd have to scan — keep the count approximate by
    // listing then filtering. Cheap relative to the dashboard's polling rate.
    const jobs = await this.listJobs(this.k.recent(), { perPage: this.maxJobs })
    return jobs.filter(j => j.status === status).length
  }

  // ─── Metrics ─────────────────────────────────────────────

  async recordMetric(metric: QueueMetric): Promise<void> {
    const r = await this.getClient()
    await r.hset(this.k.metricCurrent(metric.queue), this.metricToHash(metric))
    const ts = Date.now()
    await r.zadd(this.k.metricHistory(metric.queue), ts, JSON.stringify({ ts, ...metric }))
    const count = await r.zcard(this.k.metricHistory(metric.queue))
    if (count > 1440) {
      await r.zremrangebyrank(this.k.metricHistory(metric.queue), 0, count - 1441)
    }
  }

  async metrics(queue: string, since: Date): Promise<QueueMetric[]> {
    const r       = await this.getClient()
    const members = await r.zrangebyscore(this.k.metricHistory(queue), since.getTime(), '+inf')
    return members.map(m => {
      const { ts: _ts, ...rest } = JSON.parse(m) as QueueMetric & { ts: number }
      void _ts
      return rest
    })
  }

  async currentMetrics(): Promise<QueueMetric[]> {
    const r = await this.getClient()
    // Discover queue names directly from the recent-jobs zset members
    // (now `{queue}:{id}`) — no per-record hgetall needed.
    const members = await r.zrevrange(this.k.recent(), 0, Math.min(this.maxJobs, 500) - 1)
    if (members.length === 0) return []
    const queues = new Set<string>()
    for (const m of members) {
      const parsed = this.parseMember(m)
      if (parsed) queues.add(parsed.queue)
    }

    const metrics: QueueMetric[] = []
    for (const q of queues) {
      const hash = await r.hgetall(this.k.metricCurrent(q))
      if (hash && Object.keys(hash).length > 0) metrics.push(this.metricFromHash(hash))
    }
    return metrics
  }

  // ─── Workers ─────────────────────────────────────────────

  async recordWorker(worker: WorkerInfo): Promise<void> {
    const r = await this.getClient()
    await r.hset(this.k.worker(worker.id), {
      id:         worker.id,
      queue:      worker.queue,
      status:     worker.status,
      jobsRun:    worker.jobsRun,
      memoryMb:   worker.memoryMb,
      startedAt:  worker.startedAt.toISOString(),
      lastJobAt:  worker.lastJobAt ? worker.lastJobAt.toISOString() : '',
    })
    await r.sadd(this.k.workersIndex(), worker.id)
  }

  async workers(): Promise<WorkerInfo[]> {
    const r   = await this.getClient()
    const ids = await r.smembers(this.k.workersIndex())
    if (ids.length === 0) return []
    const out: WorkerInfo[] = []
    for (const id of ids) {
      const h = await r.hgetall(this.k.worker(id))
      if (!h || Object.keys(h).length === 0) continue
      out.push({
        id:        h['id']     ?? id,
        queue:     h['queue']  ?? 'default',
        status:    (h['status']  as WorkerInfo['status']) ?? 'idle',
        jobsRun:   parseInt(h['jobsRun']  ?? '0', 10),
        memoryMb:  parseFloat(h['memoryMb'] ?? '0'),
        startedAt: new Date(h['startedAt'] ?? Date.now()),
        lastJobAt: h['lastJobAt'] ? new Date(h['lastJobAt']) : null,
      })
    }
    return out
  }

  /** @internal — close the Redis connection. Used in tests + shutdown. */
  async disconnect(): Promise<void> {
    if (this.client) {
      try { await this.client.quit() } catch { /* already closed */ }
      this.client = null
    }
  }

  // ─── Hash <-> object ─────────────────────────────────────

  private jobToHash(j: HorizonJob): Record<string, string | number> {
    return {
      id:           j.id,
      name:         j.name,
      queue:        j.queue,
      status:       j.status,
      payload:      JSON.stringify(j.payload),
      attempts:     j.attempts,
      exception:    j.exception ?? '',
      dispatchedAt: j.dispatchedAt.toISOString(),
      startedAt:    j.startedAt   ? j.startedAt.toISOString()   : '',
      completedAt: j.completedAt ? j.completedAt.toISOString() : '',
      duration:     j.duration ?? -1,
      tags:         JSON.stringify(j.tags),
    }
  }

  private jobFromHash(h: Record<string, string>): HorizonJob {
    const dur = parseInt(h['duration'] ?? '-1', 10)
    return {
      id:           h['id']    ?? '',
      name:         h['name']  ?? '',
      queue:        h['queue'] ?? 'default',
      status:       (h['status'] as JobStatus) ?? 'pending',
      payload:      h['payload'] ? JSON.parse(h['payload']) as Record<string, unknown> : {},
      attempts:     parseInt(h['attempts'] ?? '0', 10),
      exception:    h['exception'] ? h['exception'] : null,
      dispatchedAt: h['dispatchedAt'] ? new Date(h['dispatchedAt']) : new Date(0),
      startedAt:    h['startedAt']   ? new Date(h['startedAt'])   : null,
      completedAt:  h['completedAt'] ? new Date(h['completedAt']) : null,
      duration:     dur < 0 ? null : dur,
      tags:         h['tags'] ? JSON.parse(h['tags']) as string[] : [],
    }
  }

  private metricToHash(m: QueueMetric): Record<string, string | number> {
    return {
      queue: m.queue, throughput: m.throughput, waitTime: m.waitTime, runtime: m.runtime,
      pending: m.pending, active: m.active, completed: m.completed, failed: m.failed,
    }
  }

  private metricFromHash(h: Record<string, string>): QueueMetric {
    return {
      queue:      h['queue'] ?? 'default',
      throughput: parseFloat(h['throughput'] ?? '0'),
      waitTime:   parseFloat(h['waitTime']   ?? '0'),
      runtime:    parseFloat(h['runtime']    ?? '0'),
      pending:    parseInt(h['pending']      ?? '0', 10),
      active:     parseInt(h['active']       ?? '0', 10),
      completed:  parseInt(h['completed']    ?? '0', 10),
      failed:     parseInt(h['failed']       ?? '0', 10),
    }
  }

  private async listJobs(indexKey: string, options?: JobListOptions): Promise<HorizonJob[]> {
    const r       = await this.getClient()
    const page    = options?.page    ?? 1
    const perPage = options?.perPage ?? 50
    const start   = (page - 1) * perPage

    const members = await r.zrevrange(indexKey, start, start + perPage * 4)
    if (members.length === 0) return []

    const pipe = r.pipeline()
    for (const m of members) {
      const parsed = this.parseMember(m)
      if (parsed) pipe.hgetall(this.k.job(parsed.queue, parsed.id))
    }
    const rows = await pipe.exec() ?? []

    let jobs: HorizonJob[] = []
    for (const [, hash] of rows) {
      const h = hash as Record<string, string> | null
      if (h && Object.keys(h).length > 0) jobs.push(this.jobFromHash(h))
    }

    if (options?.status) jobs = jobs.filter(j => j.status === options.status)
    if (options?.queue)  jobs = jobs.filter(j => j.queue  === options.queue)
    if (options?.search) {
      const s = options.search.toLowerCase()
      jobs = jobs.filter(j =>
        j.name.toLowerCase().includes(s) ||
        JSON.stringify(j.payload).toLowerCase().includes(s),
      )
    }
    return jobs.slice(0, perPage)
  }
}
