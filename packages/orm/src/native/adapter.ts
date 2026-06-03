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

import type { OrmAdapter, OrmAdapterProvider, QueryBuilder, OrmAdapterQueryOpts, QueryListener } from '@rudderjs/contracts'
import type { Dialect } from './dialect.js'
import { SqliteDialect } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import { MysqlDialect } from './dialect-mysql.js'
import type { Driver, Executor, Transaction, Row, AffectingExecutor } from './driver.js'
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
  signature: string
  driver:    Driver
  dialect:   Dialect
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
    const legacy = cache as NativeClientCacheEntry | undefined
    if (legacy && typeof legacy.signature === 'string') map.set(legacy.signature, legacy)
    g[NATIVE_CLIENT_CACHE_KEY] = map
    cache = map
  }
  return cache as Map<string, NativeClientCacheEntry>
}

function reusableNativeClient(cacheKey: string, signature: string): { driver: Driver; dialect: Dialect } | undefined {
  const cache = nativeClientCache()
  const cached = cache.get(cacheKey)
  if (!cached) return undefined
  if (cached.signature === signature) return { driver: cached.driver, dialect: cached.dialect }
  // Signature changed for this connection (e.g. a config edit) — dispose the
  // superseded driver, fire-and-forget, so its connection is released.
  void Promise.resolve().then(() => cached.driver.close()).catch(() => { /* best effort */ })
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
): Executor {
  const emit = (sql: string, bindings: readonly unknown[], startedAt: number): void => {
    if (listeners.length === 0) return
    const duration = performance.now() - startedAt
    // Snapshot so a listener registering/removing listeners mid-emit is safe.
    for (const listener of [...listeners]) {
      try {
        listener({ sql, bindings: [...bindings], duration, connection })
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

export class NativeAdapter implements OrmAdapter {
  /** Where queries run — the top-level connection, or a transaction scope,
   *  wrapped with query-listener instrumentation (see {@link instrumentExecutor}). */
  private readonly executor: Executor

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
    /** Driver name reported on query events (`'sqlite'` / `'pg'` / `'mysql'`);
     *  `undefined` for a caller-supplied {@link NativeConfig.driverInstance}. */
    private readonly connection: string | undefined = undefined,
  ) {
    this.executor = instrumentExecutor(executor, listeners, connection)
  }

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
    const signature = `${driverName}::${url}`
    const cacheKey = config.connectionName ?? signature

    const reused = reusableNativeClient(cacheKey, signature)
    if (reused) {
      return NativeAdapter._topLevel(reused.driver, reused.dialect, primaryKey, driverName)
    }

    const { driver, dialect } = await openDriver(driverName, url)
    cacheNativeClient(cacheKey, { signature, driver, dialect })
    return NativeAdapter._topLevel(driver, dialect, primaryKey, driverName)
  }

  /** The adapter that owns the connection — queries and transactions both run
   *  on `driver`; `disconnect()` may close it. */
  private static _topLevel(driver: Driver, dialect: Dialect, primaryKey: string, connection: string | undefined): NativeAdapter {
    return new NativeAdapter(driver, driver, dialect, primaryKey, driver, [], connection)
  }

  query<T>(table: string, opts?: OrmAdapterQueryOpts): QueryBuilder<T> {
    const pk = opts?.primaryKey ?? this.primaryKey
    return new NativeQueryBuilder<T>(this.executor, this.dialect, table, pk)
  }

  /**
   * Raw `SELECT` for the `DB` facade (`DB.select`) — runs `sql` with positional
   * `bindings` on this adapter's executor (the top-level connection, or the
   * transaction scope when inside `transaction()`) and resolves to the rows.
   */
  async selectRaw(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
    return this.executor.execute(sql, bindings)
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
   * Run `fn` inside a transaction (or a SAVEPOINT when already inside one),
   * passing it a transaction-scoped `NativeAdapter` whose queries execute on the
   * transaction's connection. The Model layer threads that scoped adapter
   * through `AsyncLocalStorage` so existing `Model.query()` calls inside `fn`
   * transparently join the transaction. Commits on resolve; rolls back and
   * re-throws on reject.
   */
  transaction<T>(fn: (tx: OrmAdapter) => Promise<T>): Promise<T> {
    return this.scope.transaction((txScope) => {
      // Shares `this.listeners` by reference — queries inside the transaction
      // report to the same listeners as top-level ones.
      const scoped = new NativeAdapter(txScope, txScope, this.dialect, this.primaryKey, null, this.listeners, this.connection)
      return fn(scoped)
    })
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
 * import { native } from '@rudderjs/orm/native'
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
