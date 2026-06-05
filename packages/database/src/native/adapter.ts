// ─── NativeAdapter ─────────────────────────────────────────
//
// Node-only. Wires a {@link Driver} + {@link Dialect} into the `OrmAdapter`
// contract so `@rudderjs/orm` Models route through hand-built SQL instead of
// Prisma/Drizzle. Phase 1 = SQLite read path.
//
// Mirrors orm-drizzle's lifecycle: a `make()` factory does the (lazy) driver
// load, and a dev-HMR client cache on `globalThis` (keyed by `driver::url`)
// reuses one live connection across Vite re-boots, disposing the superseded
// one on a signature change — so a `config/database.ts` edit doesn't leak a
// connection per re-boot. No-op in production (single boot).

import type { OrmAdapter, OrmAdapterProvider, QueryBuilder, OrmAdapterQueryOpts, QueryListener, TransactionOptions } from '@rudderjs/contracts'
import type { Dialect } from './dialect.js'
import { SqliteDialect } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import { MysqlDialect } from './dialect-mysql.js'
import type { Driver, Executor, Transaction, Row, AffectingExecutor } from './driver.js'
import { markWrote, stickyWrote } from '../sticky.js'
import type { ReadReplicaPicker } from './replica-picker.js'
import { makeReplicaPicker } from './replica-picker.js'
import { NativeQueryBuilder } from './query-builder.js'
import { BetterSqlite3Driver } from './drivers/better-sqlite3.js'
import { PostgresDriver } from './drivers/postgres.js'
import { MysqlDriver } from './drivers/mysql.js'
import { SchemaBuilder } from './schema/schema-builder.js'
import type { ModelCastInfo } from './schema/schema-types.js'

/** Supported native drivers. SQLite (better-sqlite3), Postgres (porsager
 *  `postgres`), and MySQL (`mysql2`). */
export type NativeDriverName = 'sqlite' | 'pg' | 'mysql'

/** Config for {@link native} / {@link NativeAdapter.make}. */
export interface NativeConfig {
  /**
   * Pre-built {@link Driver} — skips driver setup and HMR caching. Use for
   * tests or hand-wired setups (you own the driver's lifecycle).
   */
  driverInstance?: Driver
  /** Dialect to pair with a {@link driverInstance}. Defaults to SQLite — pass
   *  `new PgDialect()` when hand-wiring a Postgres driver. Ignored when a
   *  built-in `driver` is named (that path picks the matching dialect). */
  dialect?: Dialect
  /** Which built-in driver to open. Defaults to `'sqlite'`. */
  driver?: NativeDriverName
  /**
   * Connection URL / path. For SQLite: a file path, `file:` URL, or `':memory:'`.
   * For Postgres: a `postgres://…` connection string. Falls back to
   * `DATABASE_URL`, then `:memory:` (SQLite only — a Postgres driver with no URL
   * fails fast with a clear connection error).
   */
  url?: string
  /** Default primary-key column for models that don't override it. */
  primaryKey?: string
  /**
   * The `config/database.ts` connection name this adapter serves (passed by
   * the provider / ConnectionManager factory). Keys the dev-HMR driver cache
   * so each named connection holds its own driver and a config edit disposes
   * only that connection's superseded client. Omitted for standalone use.
   */
  connectionName?: string
  /**
   * Read-replica URLs (read/write split). When set, un-locked SELECTs (and
   * `selectRaw`) round-robin across these; writes, DDL, locked selects, and
   * every transaction run on the write connection (`url`). Same driver as the
   * write connection.
   */
  readUrls?: string[]
  /**
   * How reads pick a replica: `'round-robin'` (default), `'random'`, a
   * weights array (one non-negative weight per replica, in `readUrls` order),
   * or a custom `(count) => index` function. See {@link ReadReplicaPicker}.
   * Only meaningful with `readUrls`.
   */
  readPicker?: ReadReplicaPicker
  /**
   * Sticky reads: after a write on this connection within the current request
   * scope (see `@rudderjs/orm/sticky`), subsequent reads in that scope route
   * to the write connection — read-your-writes under replication lag. Only
   * meaningful with `readUrls`.
   */
  sticky?: boolean
}

// ── Dev-HMR driver reuse (mirrors orm-drizzle / orm-prisma) ──
//
// One cache entry PER CONNECTION: named connections (multi-connection support)
// key by their config name so each holds its own driver and a config edit
// disposes/reopens only that connection; unnamed standalone `make()` calls key
// by the signature itself (no supersede semantics — standalone use has no dev
// re-boot loop, and two coexisting unnamed adapters with different URLs are
// legitimate there).
interface NativeClientCacheEntry {
  signature:   string
  driver:      Driver
  /** Read-replica drivers (read/write split) — empty without `readUrls`. */
  readDrivers: Driver[]
  dialect:     Dialect
}
const NATIVE_CLIENT_CACHE_KEY = '__rudderjs_native_client__'

function nativeClientCache(): Map<string, NativeClientCacheEntry> {
  const g = globalThis as Record<string, unknown>
  let cache = g[NATIVE_CLIENT_CACHE_KEY]
  if (!(cache instanceof Map)) {
    const map = new Map<string, NativeClientCacheEntry>()
    // Pre-map single-entry shape from an older bundle of this module (dev
    // re-boot across a version edit) — keep the live driver, keyed by its
    // signature so an unnamed lookup still reuses it.
    const legacy = cache as (NativeClientCacheEntry & { readDrivers?: Driver[] }) | undefined
    if (legacy && typeof legacy.signature === 'string') {
      map.set(legacy.signature, { ...legacy, readDrivers: legacy.readDrivers ?? [] })
    }
    g[NATIVE_CLIENT_CACHE_KEY] = map
    cache = map
  }
  return cache as Map<string, NativeClientCacheEntry>
}

function reusableNativeClient(
  cacheKey: string,
  signature: string,
): { driver: Driver; readDrivers: Driver[]; dialect: Dialect } | undefined {
  const cache = nativeClientCache()
  const cached = cache.get(cacheKey)
  if (!cached) return undefined
  if (cached.signature === signature) {
    return { driver: cached.driver, readDrivers: cached.readDrivers, dialect: cached.dialect }
  }
  // Signature changed for this connection (e.g. a config edit) — dispose the
  // superseded drivers (write + replicas), fire-and-forget, so their
  // connections are released.
  void Promise.resolve()
    .then(() => Promise.all([cached.driver, ...cached.readDrivers].map((d) => d.close())))
    .catch(() => { /* best effort */ })
  cache.delete(cacheKey)
  return undefined
}

function cacheNativeClient(cacheKey: string, entry: NativeClientCacheEntry): void {
  nativeClientCache().set(cacheKey, entry)
}

/**
 * Wrap an {@link Executor} so every `execute` / `affectingExecute` call is timed
 * with `performance.now()` and reported to the registered query listeners. The
 * emit is best-effort: a throwing listener is swallowed (a broken Telescope
 * collector must never fail the query), and only *successful* executions are
 * reported (Laravel parity — `QueryExecuted` doesn't fire on a query error).
 * `affectingExecute` is forwarded only when the underlying driver implements it,
 * so capability checks (`typeof ex.affectingExecute === 'function'`) still hold.
 */
function instrumentExecutor(
  exec:       Executor,
  listeners:  readonly QueryListener[],
  connection: string | undefined,
  /** Read/write-split side tag for query events. Only set when the connection
   *  is configured with read replicas — single-connection events carry none. */
  target?:    'read' | 'write',
): Executor {
  const emit = (sql: string, bindings: readonly unknown[], startedAt: number): void => {
    if (listeners.length === 0) return
    const duration = performance.now() - startedAt
    // Snapshot so a listener registering/removing listeners mid-emit is safe.
    for (const listener of [...listeners]) {
      try {
        listener({ sql, bindings: [...bindings], duration, connection, target })
      } catch {
        // Listener errors must never break the query.
      }
    }
  }

  const wrapped: Executor & Partial<AffectingExecutor> = {
    async execute(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
      const startedAt = performance.now()
      const rows = await exec.execute(sql, bindings)
      emit(sql, bindings, startedAt)
      return rows
    },
  }

  const affecting = exec as Partial<AffectingExecutor>
  if (typeof affecting.affectingExecute === 'function') {
    const affectingExecute = affecting.affectingExecute.bind(exec)
    wrapped.affectingExecute = async (sql, bindings) => {
      const startedAt = performance.now()
      const result = await affectingExecute(sql, bindings)
      emit(sql, bindings, startedAt)
      return result
    }
  }

  return wrapped
}

/**
 * Wrap an executor so every statement records a sticky write for `connection`
 * (see `../sticky.js`). Applied to the WRITE side of a split connection only —
 * statements through it are writes, DDL, locked selects, or sticky-routed
 * reads; marking the last two is a harmless over-approximation (conservative
 * direction: more reads on the primary). Marks BEFORE executing so a
 * concurrent read issued while the write is in flight already routes sticky.
 */
function markWritesExecutor(exec: Executor, connection: string): Executor {
  const marked: Executor & Partial<AffectingExecutor> = {
    async execute(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
      markWrote(connection)
      return exec.execute(sql, bindings)
    },
  }
  const affecting = exec as Partial<AffectingExecutor>
  if (typeof affecting.affectingExecute === 'function') {
    const affectingExecute = affecting.affectingExecute.bind(exec)
    marked.affectingExecute = async (sql, bindings) => {
      markWrote(connection)
      return affectingExecute(sql, bindings)
    }
  }
  return marked
}

export class NativeAdapter implements OrmAdapter {
  /** Where queries run — the top-level connection, or a transaction scope,
   *  wrapped with query-listener instrumentation (see {@link instrumentExecutor}). */
  private readonly executor: Executor

  /** Read-executor picker — set only on a split connection (`readUrls`).
   *  Strategy from `readPicker` (round-robin default). Returns the write
   *  executor on a sticky hit. The QB calls it per read terminal; locked
   *  selects bypass it (see `_readExecutor`). */
  private readonly readPick: (() => Executor) | null

  private constructor(
    /** The raw connection / transaction scope queries run on (pre-instrumentation). */
    executor: Executor,
    /** Where a (nested) transaction is opened. Top-level: the {@link Driver};
     *  scoped: the active {@link Transaction} (so nesting → SAVEPOINT). */
    private readonly scope:      Transaction,
    private readonly dialect:    Dialect,
    private readonly primaryKey: string,
    /** The owned connection — present only on the top-level adapter, `null` on
     *  a transaction-scoped one (it must not close the shared connection). */
    private readonly driver:     Driver | null,
    /** Query listeners (`onQuery` / `DB.listen`). Shared BY REFERENCE with every
     *  transaction-scoped adapter spawned from this one, so a listener registered
     *  on the top-level adapter also sees queries run inside `transaction()`. */
    private readonly listeners:  QueryListener[] = [],
    /** Connection name reported on query events — the `config/database.ts`
     *  connection name when the provider passed one, else the driver name
     *  (`'sqlite'` / `'pg'` / `'mysql'`); `undefined` for a caller-supplied
     *  {@link NativeConfig.driverInstance}. */
    private readonly connection: string | undefined = undefined,
    /** Read-replica drivers (read/write split). Owned by the top-level adapter
     *  (closed by `disconnect()`); always empty on a transaction-scoped one. */
    private readonly readDrivers: Driver[] = [],
    /** Sticky reads enabled for this connection (only meaningful with a split). */
    private readonly sticky: boolean = false,
    /** Replica-selection strategy for the read pool (round-robin when omitted);
     *  see {@link ReadReplicaPicker}. Only meaningful with read drivers. */
    readPicker: ReadReplicaPicker | undefined = undefined,
    /** Inherited split participation for transaction-scoped adapters: a tx
     *  spawned from a split adapter has no read drivers of its own but still
     *  tags its events `'write'` and marks sticky writes. */
    inheritedSplitTag: 'write' | undefined = undefined,
  ) {
    const split = readDrivers.length > 0
    this.splitTag = split ? 'write' : inheritedSplitTag
    // Sticky marking wraps the WRITE side only, and only when this connection
    // participates in a split (directly or via its spawning adapter).
    const base = sticky && this.splitTag === 'write' && connection !== undefined
      ? markWritesExecutor(executor, connection)
      : executor
    this.executor = instrumentExecutor(base, listeners, connection, this.splitTag)
    if (split && connection !== undefined) {
      const readExecs = readDrivers.map((d) => instrumentExecutor(d, listeners, connection, 'read'))
      // Builds the per-query index picker — weight lists validate here, so a
      // bad config fails at adapter construction, not on the first read.
      const pick = makeReplicaPicker(readPicker, readExecs.length)
      this.readPick = () => {
        if (this.sticky && stickyWrote(connection)) return this.executor
        return readExecs[pick()] ?? this.executor
      }
    } else {
      this.readPick = null
    }
  }

  /** `'write'` when this adapter participates in a read/write split (directly
   *  or as a transaction scope spawned from one) — the query-event tag. */
  private readonly splitTag: 'write' | undefined

  /** Direct relations (`hasOne`/`hasMany`/`belongsTo`/`belongsToMany`) resolve
   *  in the ORM's Model layer — one batched `WHERE … IN` per relation, stitched
   *  onto the parents (same machinery as Drizzle and the polymorphic loader).
   *  The native QB's own `with()` stays a warn-only no-op: the adapter contract
   *  passes relation NAMES only, with no join shape to compile from. */
  readonly eagerLoadStrategy = 'model-layer' as const

  /** Build a `NativeAdapter`, opening the configured driver (lazy import). */
  static async make(config: NativeConfig = {}): Promise<NativeAdapter> {
    const primaryKey = config.primaryKey ?? 'id'

    // Caller-supplied driver: no caching, they own the lifecycle. No built-in
    // driver name to report on query events.
    if (config.driverInstance) {
      return NativeAdapter._topLevel(config.driverInstance, config.dialect ?? new SqliteDialect(), primaryKey, undefined)
    }

    const driverName = config.driver ?? 'sqlite'
    const url =
      config.url ??
      (typeof process !== 'undefined' ? process.env?.['DATABASE_URL'] : undefined) ??
      ':memory:'
    const readUrls = config.readUrls ?? []
    const sticky = config.sticky ?? false
    // Replica list is part of the signature so a replica edit disposes/reopens
    // just this connection. The no-replica form stays byte-identical to before.
    const signature = readUrls.length > 0
      ? `${driverName}::${url}::${readUrls.join(',')}`
      : `${driverName}::${url}`
    const cacheKey = config.connectionName ?? signature
    const connection = config.connectionName ?? driverName

    const reused = reusableNativeClient(cacheKey, signature)
    if (reused) {
      return NativeAdapter._topLevel(reused.driver, reused.dialect, primaryKey, connection, reused.readDrivers, sticky, config.readPicker)
    }

    const { driver, dialect } = await openDriver(driverName, url)
    const readDrivers: Driver[] = []
    for (const readUrl of readUrls) {
      readDrivers.push((await openDriver(driverName, readUrl)).driver)
    }
    cacheNativeClient(cacheKey, { signature, driver, readDrivers, dialect })
    return NativeAdapter._topLevel(driver, dialect, primaryKey, connection, readDrivers, sticky, config.readPicker)
  }

  /** The adapter that owns the connection — queries and transactions both run
   *  on `driver`; `disconnect()` may close it. */
  private static _topLevel(
    driver: Driver,
    dialect: Dialect,
    primaryKey: string,
    connection: string | undefined,
    readDrivers: Driver[] = [],
    sticky = false,
    readPicker: ReadReplicaPicker | undefined = undefined,
  ): NativeAdapter {
    return new NativeAdapter(driver, driver, dialect, primaryKey, driver, [], connection, readDrivers, sticky, readPicker)
  }

  query<T>(table: string, opts?: OrmAdapterQueryOpts): QueryBuilder<T> {
    const pk = opts?.primaryKey ?? this.primaryKey
    return new NativeQueryBuilder<T>(this.executor, this.dialect, table, pk, this.readPick)
  }

  /**
   * Raw `SELECT` for the `DB` facade (`DB.select`) — on a split connection
   * routes to the read pool (sticky-aware, Laravel parity for `DB::select`);
   * otherwise runs on this adapter's executor (the top-level connection, or
   * the transaction scope when inside `transaction()`).
   */
  async selectRaw(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
    return (this.readPick?.() ?? this.executor).execute(sql, bindings)
  }

  /**
   * Raw writing statement for the `DB` facade (`DB.insert`/`update`/`delete`/
   * `statement`). On SQLite/Postgres the caller's `RETURNING *` makes
   * `Executor.execute` resolve to the affected rows, so the count is
   * `rows.length`. On MySQL (no RETURNING) the affected count comes from the
   * driver's result metadata via {@link AffectingExecutor} instead.
   */
  async affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number> {
    // On a no-RETURNING driver (MySQL) a raw write returns no rows — read the
    // affected count from the driver's result metadata instead. SQLite/Postgres
    // don't implement AffectingExecutor; they fall back to `rows.length`, where
    // the caller's `RETURNING *` makes the count correct (the existing contract).
    const ex = this.executor as Partial<AffectingExecutor>
    if (typeof ex.affectingExecute === 'function') {
      const { affectedRows } = await ex.affectingExecute(sql, bindings)
      return affectedRows
    }
    const rows = await this.executor.execute(sql, bindings)
    return rows.length
  }

  /**
   * A {@link SchemaBuilder} bound to this adapter's connection — the DDL surface
   * the migration runner drives. Runs on the same executor as queries, so a
   * transaction-scoped adapter's schema builder participates in the transaction.
   */
  schemaBuilder(): SchemaBuilder {
    return new SchemaBuilder(this.executor, this.dialect)
  }

  /**
   * A {@link SchemaBuilder} bound to a *recording* executor: every statement it
   * would run is handed to `record` instead of touching the database. Powers
   * `migrate --pretend` — the migrator binds this to a migration's `up()` and
   * collects the DDL it would emit. Catalog reads (`hasTable`/`hasColumn`)
   * resolve to "absent" (empty rows), which is the correct dry-run default.
   */
  pretendSchemaBuilder(record: (sql: string, bindings: readonly unknown[]) => void): SchemaBuilder {
    const recordingExecutor: Executor = {
      async execute(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
        record(sql, bindings)
        return []
      },
    }
    return new SchemaBuilder(recordingExecutor, this.dialect)
  }

  /**
   * Generate `app/Models/__schema/registry.d.ts` from THIS connection's live
   * schema (GATE 7-types) — introspect every table, fold in each model's
   * declared `casts`, and (re)write the registry. Node-only; the fs-writing
   * orchestrator is lazily imported so the adapter's static eval graph stays
   * import-light. Returns the written path + table count for the CLI to report.
   */
  async generateSchemaTypes(
    cwd: string,
    models: ModelCastInfo[] = [],
  ): Promise<{ path: string; tableCount: number }> {
    const { generateSchemaTypes } = await import('./schema/schema-types.js')
    return generateSchemaTypes(this.executor, this.dialect, cwd, models)
  }

  /**
   * Database overview for `rudder db:show` — dialect, version, database name,
   * and every user table (with sizes where the dialect can report them, row
   * counts/views on request). Lazily imported like {@link generateSchemaTypes}
   * to keep the adapter's static eval graph import-light.
   */
  async inspectDatabase(opts: { counts?: boolean; views?: boolean } = {}): Promise<import('./schema/inspect.js').DatabaseInfo> {
    const { inspectDatabase } = await import('./schema/inspect.js')
    return inspectDatabase(this.executor, this.dialect, opts)
  }

  /**
   * Single-table detail for `rudder db:table <name>` — columns, indexes,
   * foreign keys, row count. Null when the table doesn't exist.
   */
  async inspectTable(table: string): Promise<import('./schema/inspect.js').TableInfo | null> {
    const { inspectTable } = await import('./schema/inspect.js')
    return inspectTable(this.executor, this.dialect, table)
  }

  /**
   * Run `fn` inside a transaction (or a SAVEPOINT when already inside one),
   * passing it a transaction-scoped `NativeAdapter` whose queries execute on the
   * transaction's connection. The Model layer threads that scoped adapter
   * through `AsyncLocalStorage` so existing `Model.query()` calls inside `fn`
   * transparently join the transaction. Commits on resolve; rolls back and
   * re-throws on reject.
   *
   * `opts.isolationLevel` is forwarded to the driver: SET TRANSACTION ISOLATION
   * LEVEL at transaction start on Postgres/MySQL; SQLite throws (no isolation
   * levels); any driver throws when this scope is already a SAVEPOINT.
   */
  transaction<T>(fn: (tx: OrmAdapter) => Promise<T>, opts?: TransactionOptions): Promise<T> {
    return this.scope.transaction((txScope) => {
      // Shares `this.listeners` by reference — queries inside the transaction
      // report to the same listeners as top-level ones. No read drivers: every
      // statement in a transaction runs on the write connection; the inherited
      // splitTag keeps event tagging + sticky marking intact.
      const scoped = new NativeAdapter(
        txScope, txScope, this.dialect, this.primaryKey, null, this.listeners, this.connection,
        [], this.sticky, undefined, this.splitTag,
      )
      return fn(scoped)
    }, opts)
  }

  /**
   * Register a query listener ({@link OrmAdapter.onQuery}) — fired once per
   * successfully executed query with the SQL, bindings, and wall-clock duration
   * in ms. The app-facing entry point is `DB.listen()` (`@rudderjs/database`);
   * Telescope's QueryCollector and Pulse's slow-query recorder hook in here too.
   * Listener errors are swallowed — they never break the query. Registering on
   * a transaction-scoped adapter registers on the shared (top-level) listener
   * list. Transaction control statements (BEGIN/COMMIT/SAVEPOINT) run inside
   * the driver and are not reported.
   */
  onQuery(listener: QueryListener): void {
    this.listeners.push(listener)
  }

  async connect(): Promise<void> {
    // Drivers open eagerly in make(); nothing to do here.
  }

  async disconnect(): Promise<void> {
    // A transaction-scoped adapter owns no connection — never close the shared
    // one out from under the owning adapter.
    if (!this.driver) return
    // Evict the cached client BEFORE closing so a later make() with the same
    // cache key opens a fresh driver instead of reusing this closed one. The
    // cache only holds self-opened drivers (driverInstance bypasses caching),
    // so any entry holding this driver is the one we're about to close.
    const cache = nativeClientCache()
    for (const [key, entry] of cache) {
      if (entry.driver === this.driver) cache.delete(key)
    }
    await this.driver.close()
    for (const readDriver of this.readDrivers) {
      await readDriver.close()
    }
  }
}

/** Open the built-in driver for `driverName` and pair it with its dialect. */
async function openDriver(
  driverName: NativeDriverName,
  url: string,
): Promise<{ driver: Driver; dialect: Dialect }> {
  switch (driverName) {
    case 'sqlite': {
      const driver = await BetterSqlite3Driver.open({ filename: url })
      return { driver, dialect: new SqliteDialect() }
    }
    case 'pg': {
      const driver = await PostgresDriver.open({ url })
      return { driver, dialect: new PgDialect() }
    }
    case 'mysql': {
      const driver = await MysqlDriver.open({ url })
      return { driver, dialect: new MysqlDialect() }
    }
    default: {
      const _exhaustive: never = driverName
      throw new Error(`[RudderJS ORM native] Unknown driver: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Build the native ORM adapter provider — the `OrmAdapterProvider` shape the
 * database provider consumes (mirrors `drizzle(...)` / the prisma factory).
 *
 * @example
 * import { native } from '@rudderjs/database'
 * database({
 *   default: 'main',
 *   connections: { main: native({ driver: 'sqlite', url: 'file:./dev.db' }) },
 * })
 */
export function native(config: NativeConfig = {}): OrmAdapterProvider {
  return {
    async create(): Promise<OrmAdapter> {
      return NativeAdapter.make(config)
    },
  }
}
