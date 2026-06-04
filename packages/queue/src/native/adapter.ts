// ─── DatabaseQueueAdapter ──────────────────────────────────
//
// Persistent, self-hosted queue driver backed by the native SQL engine
// (`@rudderjs/database/native`; `@rudderjs/orm/native` re-exports it) — the
// zero-infrastructure default tier, modeled on Laravel's `database` driver.
// Jobs live in a `jobs` table; a worker poll loop reserves them atomically
// (transaction + `lockForUpdate({ skipLocked: true })` — `FOR UPDATE SKIP
// LOCKED` on Postgres/MySQL so concurrent workers never queue on the same
// head-of-queue row; a serializing write transaction on SQLite) and runs them
// through the shared `executeJob` pipeline. Exhausted jobs move to `failed_jobs`.
//
// The engine/ORM are reached via `resolveOptionalPeer(...)` so the queue
// package keeps NO hard dependency on either — only the `database` driver path
// needs them, and only at runtime once selected.

import { randomUUID } from 'node:crypto'
import { resolveOptionalPeer } from '@rudderjs/core'
import type {
  Job,
  QueueAdapter,
  QueueAdapterProvider,
  DispatchOptions,
  QueueStats,
  FailedJobInfo,
  WorkerOptions,
} from '../index.js'
import { queueObservers } from '../observers.js'
import { encodePayload, decodePayload } from '../serialize.js'
import { executeJob } from '../execute.js'
import { defineJobsTable, defineFailedJobsTable } from './migrations.js'

// ── Local structural types for the ORM adapter surface we use ──
// Kept local (not imported from @rudderjs/contracts) so the queue package adds
// no dependency. Only the methods the driver actually calls are modeled.

interface QB {
  where(column: string, operatorOrValue: unknown, value?: unknown): QB
  whereGroup(fn: (q: QB) => void): QB
  orWhere(column: string, operatorOrValue: unknown, value?: unknown): QB
  orderBy(column: string, direction?: 'ASC' | 'DESC'): QB
  limit(n: number): QB
  lockForUpdate?(opts?: { skipLocked?: boolean; noWait?: boolean }): QB
  get(): Promise<Array<Record<string, unknown>>>
  count(): Promise<number>
  create(data: Record<string, unknown>): Promise<Record<string, unknown>>
  updateAll(data: Record<string, unknown>): Promise<number>
  deleteAll(): Promise<number>
}

interface SchemaBuilderLike {
  hasTable(table: string): Promise<boolean>
  create(table: string, build: (t: unknown) => void): Promise<void>
}

interface OrmAdapterLike {
  query(table: string): QB
  transaction<T>(fn: (tx: OrmAdapterLike) => Promise<T>): Promise<T>
  schemaBuilder?(): SchemaBuilderLike
  disconnect?(): Promise<void>
}

/** Connection config for the native `database` queue driver. */
export interface DatabaseQueueConfig {
  driver?: string
  /** Jobs table name. Default `'jobs'`. */
  table?: string
  /** Failed-jobs table name. Default `'failed_jobs'`. */
  failedTable?: string
  /** Default queue name. Default `'default'`. */
  queue?: string
  /**
   * Seconds a reserved job may run before it's considered abandoned (crashed
   * worker) and reclaimable by another worker. Mirrors Laravel's `retry_after`.
   * Keep it comfortably larger than your longest job. Default `90`.
   */
  retryAfter?: number
  /** Connection label stored on failed-job rows. Default `'database'`. */
  connection?: string
  /** Job classes the worker can reconstruct from a stored job-name string. */
  jobs?: Array<new (...args: never[]) => Job>
  /**
   * Open a DEDICATED native engine for the queue's own `jobs` / `failed_jobs`
   * tables, independent of the app's ORM. Set this when the app uses a non-native
   * ORM (Prisma/Drizzle) but still wants the zero-infra database queue — the
   * queue gets its own store and **auto-creates its tables** on first use (its
   * private DB, so no app-migration step is needed). Pair with {@link url}.
   *
   * When omitted, the driver runs against the app's registered ORM adapter
   * (`ModelRegistry.getAdapter()`), which must be the native engine and have the
   * tables created via `rudder queue:table` + `migrate`.
   */
  engine?: 'sqlite' | 'pg' | 'mysql'
  /** Connection string / file path for {@link engine} (e.g. `'./queue.db'`,
   *  `'postgres://…'`). SQLite parent directory must already exist. */
  url?: string
  /**
   * Pre-resolved ORM adapter to run against, bypassing engine setup and
   * `ModelRegistry`. Lets an app pin a specific connection, and lets tests inject
   * an in-memory native engine.
   */
  adapter?: OrmAdapterLike
}

const nowSec = (): number => Math.floor(Date.now() / 1000)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** What a reserved row carries once popped. */
interface ReservedJob {
  row:   Record<string, unknown>
  queue: string
}

export class DatabaseQueueAdapter implements QueueAdapter {
  // JSON transport drops functions, so the closure/chain/batch wrappers can't
  // survive — same constraint as BullMQ/Inngest.
  readonly supportsClosures = false
  readonly supportsChain    = false
  readonly supportsBatch    = false

  private readonly table:       string
  private readonly failedTable: string
  private readonly retryAfter:  number
  private readonly connection:  string
  private readonly engine:      'sqlite' | 'pg' | 'mysql' | undefined
  private readonly url:         string | undefined
  private readonly jobRegistry = new Map<string, new (...args: never[]) => Job>()

  private _cachedAdapter: OrmAdapterLike | null = null
  /** Whether this driver may close the ORM connection on disconnect(). False
   *  when the caller injected an adapter — they own its lifecycle. */
  private readonly _ownsConnection: boolean
  private _ensured = false
  private _stop = false
  private _onSignal: (() => void) | null = null

  constructor(config: DatabaseQueueConfig = {}) {
    this.table       = config.table ?? 'jobs'
    this.failedTable = config.failedTable ?? 'failed_jobs'
    this.retryAfter  = config.retryAfter ?? 90
    this.connection  = config.connection ?? 'database'
    this.engine      = config.engine
    this.url         = config.url
    this._cachedAdapter = config.adapter ?? null
    this._ownsConnection = config.adapter == null
    for (const J of config.jobs ?? []) this.jobRegistry.set(J.name, J)
  }

  /**
   * Resolve (and cache) the ORM adapter the driver runs against:
   * - injected `config.adapter` → use it (set in the constructor);
   * - `config.engine` → open a dedicated native engine + auto-ensure the queue's
   *   own tables (its private store);
   * - otherwise → the app's registered ORM adapter (`ModelRegistry.getAdapter()`),
   *   which must be the native engine with tables already migrated.
   */
  private async _adapter(): Promise<OrmAdapterLike> {
    if (this._cachedAdapter) {
      if (this.engine && !this._ensured) { await this._ensureSchema(this._cachedAdapter); this._ensured = true }
      return this._cachedAdapter
    }

    if (this.engine) {
      // The native engine's canonical home is @rudderjs/database (Phase-2
      // relocation); @rudderjs/orm/native remains as a re-export shim. Try the
      // canonical path first so this driver doesn't depend on the shim's
      // continued existence, falling back for older @rudderjs/orm installs
      // that predate @rudderjs/database.
      type NativeAdapterModule = {
        NativeAdapter: { make(cfg: { driver: string; url?: string }): Promise<OrmAdapterLike> }
      }
      const { NativeAdapter } = await resolveOptionalPeer<NativeAdapterModule>(
        '@rudderjs/database/native',
      ).catch(() => resolveOptionalPeer<NativeAdapterModule>('@rudderjs/orm/native'))
      this._cachedAdapter = await NativeAdapter.make(
        this.url !== undefined ? { driver: this.engine, url: this.url } : { driver: this.engine },
      )
      await this._ensureSchema(this._cachedAdapter)
      this._ensured = true
      return this._cachedAdapter
    }

    let orm: { ModelRegistry: { getAdapter(): OrmAdapterLike } }
    try {
      orm = await resolveOptionalPeer<{ ModelRegistry: { getAdapter(): OrmAdapterLike } }>('@rudderjs/orm')
    } catch {
      throw new Error(
        '[RudderJS Queue] The "database" driver requires @rudderjs/orm (the native ' +
        'engine). Install it and either register a native database connection, or set ' +
        '`engine`/`url` on the queue connection for a dedicated queue database.',
      )
    }
    this._cachedAdapter = orm.ModelRegistry.getAdapter()
    return this._cachedAdapter
  }

  /** Idempotently create the queue's own `jobs` / `failed_jobs` tables. Only used
   *  for a dedicated `engine` connection (the queue's private store). */
  private async _ensureSchema(adapter: OrmAdapterLike): Promise<void> {
    if (typeof adapter.schemaBuilder !== 'function') return
    const sb = adapter.schemaBuilder()
    if (!(await sb.hasTable(this.table)))       await sb.create(this.table, defineJobsTable as (t: unknown) => void)
    if (!(await sb.hasTable(this.failedTable))) await sb.create(this.failedTable, defineFailedJobsTable as (t: unknown) => void)
  }

  // ── dispatch ─────────────────────────────────────────────

  async dispatch(job: Job, options?: DispatchOptions): Promise<void> {
    const adapter = await this._adapter()
    const ctor    = job.constructor as typeof Job
    const name    = ctor.name
    const queue   = options?.queue ?? ctor.queue ?? 'default'
    const maxTries = ctor.retries ?? 3
    const now     = nowSec()
    const delaySec = Math.ceil((options?.delay ?? 0) / 1000)

    const data = encodePayload({ ...job }) as Record<string, unknown>
    const payload = JSON.stringify({
      job:       name,
      data,
      maxTries,
      __context: options?.__context ?? null,
    })

    const row = await adapter.query(this.table).create({
      queue,
      payload,
      attempts:     0,
      reserved_at:  null,
      available_at: now + delaySec,
      created_at:   now,
    })

    queueObservers.emit({
      kind:         'job.dispatched',
      jobId:        String(row['id'] ?? ''),
      name,
      queue,
      payload:      data,
      attempts:     0,
      dispatchedAt: new Date(now * 1000),
    })
  }

  // ── worker ───────────────────────────────────────────────

  async work(queues = 'default', options: WorkerOptions = {}): Promise<void> {
    if (typeof process !== 'undefined') process.env['RUDDERJS_QUEUE_WORKER'] = '1'
    const names   = queues.split(',').map((q) => q.trim()).filter(Boolean)
    const sleepMs = (options.sleep ?? 3) * 1000
    this._stop = false

    const onSignal = (): void => { this._stop = true }
    this._onSignal = onSignal
    process.on('SIGTERM', onSignal)
    process.on('SIGINT', onSignal)

    console.log(
      `[RudderJS Queue:database] worker ready — queues: "${names.join(', ')}", ` +
      `retry_after: ${this.retryAfter}s`,
    )

    let processed = 0
    try {
      while (!this._stop) {
        const reserved = await this._reserveNext(names)
        if (!reserved) {
          if (options.stopWhenEmpty) break
          await sleep(sleepMs)
          continue
        }
        await this._process(reserved, options)
        processed++
        if (options.once) break
        if (options.maxJobs && processed >= options.maxJobs) break
      }
    } finally {
      process.off('SIGTERM', onSignal)
      process.off('SIGINT', onSignal)
      this._onSignal = null
      await this.disconnect()
    }
  }

  /**
   * Atomically reserve the next runnable job across `names` in priority order.
   * One transaction per attempt: `SELECT … ORDER BY id LIMIT 1 FOR UPDATE SKIP
   * LOCKED` then stamp `reserved_at` + bump `attempts`. A job is runnable when
   * it's unreserved and due, OR its reservation is older than `retry_after`
   * (crashed worker).
   *
   * `skipLocked` is what makes multi-worker reservation scale: a worker whose
   * top candidate is mid-reservation by another worker takes the NEXT runnable
   * row immediately instead of blocking on the row lock and then re-evaluating
   * to zero rows (the plain-FOR UPDATE behavior — safe, but every contender
   * serialized on the same head-of-queue row). No-op on SQLite, where the
   * write transaction already serializes the whole reservation.
   */
  private async _reserveNext(names: string[]): Promise<ReservedJob | null> {
    const adapter = await this._adapter()
    for (const name of names) {
      const reserved = await adapter.transaction(async (tx) => {
        const now   = nowSec()
        const stale = now - this.retryAfter
        let qb = tx.query(this.table)
          .where('queue', name)
          .whereGroup((g) => {
            g.whereGroup((a) => a.where('reserved_at', null).where('available_at', '<=', now))
             .orWhere('reserved_at', '<=', stale)
          })
          .orderBy('id', 'ASC')
          .limit(1)
        if (typeof qb.lockForUpdate === 'function') qb = qb.lockForUpdate({ skipLocked: true })

        const rows = await qb.get()
        const row  = rows[0]
        if (!row) return null

        await tx.query(this.table)
          .where('id', row['id'])
          .updateAll({ reserved_at: now, attempts: Number(row['attempts']) + 1 })

        return { ...row, reserved_at: now, attempts: Number(row['attempts']) + 1 }
      })
      if (reserved) return { row: reserved, queue: name }
    }
    return null
  }

  /** Run one reserved job: reconstruct → execute → delete on success, release
   *  with backoff or move to `failed_jobs` on failure. */
  private async _process(reserved: ReservedJob, options: WorkerOptions): Promise<void> {
    const adapter = await this._adapter()
    const { row, queue } = reserved
    const jobId    = String(row['id'])
    const attempts = Number(row['attempts'])
    const dispatchedAt = new Date(Number(row['created_at']) * 1000)
    const startedAt = new Date()

    const parsed = JSON.parse(String(row['payload'])) as {
      job: string
      data: Record<string, unknown>
      maxTries?: number
      __context?: Record<string, unknown> | null
    }
    const maxTries = options.tries ?? parsed.maxTries ?? 3
    const JobClass = this.jobRegistry.get(parsed.job)

    queueObservers.emit({
      kind: 'job.active', jobId, name: parsed.job, queue,
      payload: parsed.data, attempts, dispatchedAt, startedAt,
    })

    if (!JobClass) {
      const err = new Error(
        `[RudderJS Queue:database] Unknown job "${parsed.job}". ` +
        `Add it to the jobs[] array in config/queue.ts.`,
      )
      await this._moveToFailed(row, queue, err)
      await adapter.query(this.table).where('id', row['id']).deleteAll()
      this._emitFailed(jobId, parsed.job, queue, parsed.data, attempts, dispatchedAt, startedAt, err)
      return
    }

    const instance = Object.assign(new JobClass(), decodePayload(parsed.data))

    try {
      await withTimeout(
        executeJob(instance, {
          __context: parsed.__context ?? undefined,
          invokeFailedHook: false,
        }),
        options.timeout,
      )
      await adapter.query(this.table).where('id', row['id']).deleteAll()
      const completedAt = new Date()
      queueObservers.emit({
        kind: 'job.completed', jobId, name: parsed.job, queue,
        payload: parsed.data, attempts, dispatchedAt, startedAt, completedAt,
        duration: completedAt.getTime() - startedAt.getTime(),
      })
    } catch (err) {
      if (attempts >= maxTries) {
        // Terminal: record, remove from the queue, fire failed() exactly once.
        await this._moveToFailed(row, queue, err)
        await adapter.query(this.table).where('id', row['id']).deleteAll()
        try { await instance.failed?.(err) }
        catch (hookErr) {
          console.error(`[RudderJS Queue:database] failed() hook threw for "${parsed.job}":`, hookErr)
        }
      } else {
        // Release for retry after the backoff delay.
        const backoff = options.backoff ?? 0
        await adapter.query(this.table)
          .where('id', row['id'])
          .updateAll({ reserved_at: null, available_at: nowSec() + backoff })
      }
      this._emitFailed(jobId, parsed.job, queue, parsed.data, attempts, dispatchedAt, startedAt, err)
    }
  }

  private _emitFailed(
    jobId: string, name: string, queue: string, payload: Record<string, unknown>,
    attempts: number, dispatchedAt: Date, startedAt: Date, err: unknown,
  ): void {
    const completedAt = new Date()
    queueObservers.emit({
      kind: 'job.failed', jobId, name, queue, payload, attempts, dispatchedAt,
      startedAt, completedAt, duration: completedAt.getTime() - startedAt.getTime(),
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    })
  }

  private async _moveToFailed(row: Record<string, unknown>, queue: string, err: unknown): Promise<void> {
    const adapter = await this._adapter()
    await adapter.query(this.failedTable).create({
      uuid:       randomUUID(),
      connection: this.connection,
      queue,
      payload:    String(row['payload']),
      exception:  err instanceof Error ? (err.stack ?? err.message) : String(err),
      failed_at:  nowSec(),
    })
  }

  // ── admin (powers the queue:* CLI commands) ──────────────

  async status(queueName = 'default'): Promise<QueueStats> {
    const adapter = await this._adapter()
    const now   = nowSec()
    const stale = now - this.retryAfter
    const inQueue = (): QB => adapter.query(this.table).where('queue', queueName)

    const [waiting, delayed, active, failed] = await Promise.all([
      inQueue().where('reserved_at', null).where('available_at', '<=', now).count(),
      inQueue().where('reserved_at', null).where('available_at', '>', now).count(),
      inQueue().where('reserved_at', '!=', null).where('reserved_at', '>', stale).count(),
      adapter.query(this.failedTable).where('queue', queueName).count(),
    ])

    // The database driver deletes jobs on success, so there's no retained
    // "completed" count; "paused" isn't supported in v1.
    return { waiting, active, completed: 0, failed, delayed, paused: 0 }
  }

  async flush(queueName = 'default'): Promise<void> {
    const adapter = await this._adapter()
    await adapter.query(this.table).where('queue', queueName).deleteAll()
  }

  async failures(queueName = 'default', limit = 100): Promise<FailedJobInfo[]> {
    const adapter = await this._adapter()
    const rows = await adapter.query(this.failedTable)
      .where('queue', queueName)
      .orderBy('id', 'DESC')
      .limit(limit)
      .get()

    return rows.map((r) => {
      let name = 'unknown'
      let data: unknown = null
      try {
        const parsed = JSON.parse(String(r['payload'])) as { job?: string; data?: Record<string, unknown> }
        name = parsed.job ?? 'unknown'
        data = parsed.data ? decodePayload(parsed.data) : null
      } catch { /* leave defaults */ }
      return {
        id:       String(r['id']),
        name,
        data,
        error:    String(r['exception'] ?? ''),
        failedAt: new Date(Number(r['failed_at']) * 1000),
        attempts: 0,
      }
    })
  }

  async retryFailed(queueName = 'default'): Promise<number> {
    const adapter = await this._adapter()
    const rows = await adapter.query(this.failedTable).where('queue', queueName).get()
    const now = nowSec()
    for (const r of rows) {
      await adapter.query(this.table).create({
        queue:        String(r['queue']),
        payload:      String(r['payload']),
        attempts:     0,
        reserved_at:  null,
        available_at: now,
        created_at:   now,
      })
      await adapter.query(this.failedTable).where('id', r['id']).deleteAll()
    }
    return rows.length
  }

  async disconnect(): Promise<void> {
    // Close the ORM connection so one-shot CLI commands can exit (and the worker
    // releases it on shutdown). Skipped when the caller injected the adapter —
    // they own its lifecycle, so closing it would break a long-running app.
    if (!this._ownsConnection) return
    const adapter = this._cachedAdapter
    this._cachedAdapter = null
    if (adapter?.disconnect) await adapter.disconnect()
  }
}

/**
 * Soft timeout guard. JS can't preempt a running handler (no `pcntl`), so this
 * only rejects the *await* after `timeoutSec` — the in-flight handler keeps
 * running. The real safety net for a crashed/stuck worker is `retry_after`,
 * which reclaims the reservation. Keep jobs short or raise `retry_after`.
 */
function withTimeout<T>(p: Promise<T>, timeoutSec?: number): Promise<T> {
  if (!timeoutSec || timeoutSec <= 0) return p
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[RudderJS Queue:database] job timed out after ${timeoutSec}s`)),
      timeoutSec * 1000,
    )
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/** Factory matching the `QueueAdapterProvider` shape `QueueProvider.boot` consumes. */
export function database(config: DatabaseQueueConfig = {}): QueueAdapterProvider {
  return {
    create(): QueueAdapter {
      return new DatabaseQueueAdapter(config)
    },
  }
}
