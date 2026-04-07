import { randomUUID } from 'node:crypto'
import type {
  HorizonStorage, HorizonJob, QueueMetric, WorkerInfo,
  JobListOptions, JobStatus,
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

  updateJob(id: string, updates: Partial<HorizonJob>): void {
    const job = this.jobs.find(j => j.id === id)
    if (job) Object.assign(job, updates)
  }

  recentJobs(options?: JobListOptions): HorizonJob[] {
    return this.filterJobs(options)
  }

  failedJobs(options?: JobListOptions): HorizonJob[] {
    return this.filterJobs({ ...options, status: 'failed' })
  }

  findJob(id: string): HorizonJob | null {
    return this.jobs.find(j => j.id === id) ?? null
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

  deleteJob(id: string): void {
    const idx = this.jobs.findIndex(j => j.id === id)
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
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS horizon_jobs (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        queue         TEXT NOT NULL,
        status        TEXT NOT NULL,
        payload       TEXT NOT NULL DEFAULT '{}',
        attempts      INTEGER NOT NULL DEFAULT 0,
        exception     TEXT,
        dispatched_at TEXT NOT NULL,
        started_at    TEXT,
        completed_at  TEXT,
        duration      INTEGER,
        tags          TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_horizon_status ON horizon_jobs(status, dispatched_at);
      CREATE INDEX IF NOT EXISTS idx_horizon_queue ON horizon_jobs(queue, dispatched_at);

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
      `INSERT INTO horizon_jobs (id, name, queue, status, payload, attempts, exception, dispatched_at, started_at, completed_at, duration, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      job.id, job.name, job.queue, job.status,
      JSON.stringify(job.payload), job.attempts, job.exception,
      job.dispatchedAt.toISOString(),
      job.startedAt?.toISOString() ?? null,
      job.completedAt?.toISOString() ?? null,
      job.duration,
      JSON.stringify(job.tags),
    )
  }

  updateJob(id: string, updates: Partial<HorizonJob>): void {
    const sets: string[] = []
    const params: unknown[] = []

    if (updates.status !== undefined)      { sets.push('status = ?');       params.push(updates.status) }
    if (updates.attempts !== undefined)    { sets.push('attempts = ?');     params.push(updates.attempts) }
    if (updates.exception !== undefined)   { sets.push('exception = ?');    params.push(updates.exception) }
    if (updates.startedAt !== undefined)   { sets.push('started_at = ?');   params.push(updates.startedAt?.toISOString() ?? null) }
    if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(updates.completedAt?.toISOString() ?? null) }
    if (updates.duration !== undefined)    { sets.push('duration = ?');     params.push(updates.duration) }

    if (sets.length === 0) return
    params.push(id)
    this.getDb().prepare(`UPDATE horizon_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  recentJobs(options?: JobListOptions): HorizonJob[] {
    return this.queryJobs(options)
  }

  failedJobs(options?: JobListOptions): HorizonJob[] {
    return this.queryJobs({ ...options, status: 'failed' })
  }

  findJob(id: string): HorizonJob | null {
    const row = this.getDb().prepare('SELECT * FROM horizon_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined
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

  deleteJob(id: string): void {
    this.getDb().prepare('DELETE FROM horizon_jobs WHERE id = ?').run(id)
  }

  pruneOlderThan(date: Date): void {
    const iso = date.toISOString()
    const db  = this.getDb()
    db.prepare('DELETE FROM horizon_jobs WHERE dispatched_at < ?').run(iso)
    db.prepare('DELETE FROM horizon_metrics WHERE created_at < ?').run(iso)
  }

  jobCount(status?: JobStatus): number {
    if (status) {
      const row = this.getDb().prepare('SELECT COUNT(*) as cnt FROM horizon_jobs WHERE status = ?').get(status) as { cnt: number }
      return row.cnt
    }
    const row = this.getDb().prepare('SELECT COUNT(*) as cnt FROM horizon_jobs').get() as { cnt: number }
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
      `SELECT * FROM horizon_jobs ${where} ORDER BY dispatched_at DESC LIMIT ? OFFSET ?`,
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
