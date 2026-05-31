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

import type { OrmAdapter, OrmAdapterProvider, QueryBuilder, OrmAdapterQueryOpts } from '@rudderjs/contracts'
import type { Dialect } from './dialect.js'
import { SqliteDialect } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import type { Driver, Executor, Transaction } from './driver.js'
import { NativeQueryBuilder } from './query-builder.js'
import { BetterSqlite3Driver } from './drivers/better-sqlite3.js'
import { PostgresDriver } from './drivers/postgres.js'
import { SchemaBuilder } from './schema/schema-builder.js'
import type { ModelCastInfo } from './schema/schema-types.js'

/** Supported native drivers. SQLite (better-sqlite3) + Postgres (porsager
 *  `postgres`); MySQL lands in 7.8. */
export type NativeDriverName = 'sqlite' | 'pg'

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
}

// ── Dev-HMR driver reuse (mirrors orm-drizzle / orm-prisma) ──
interface NativeClientCacheEntry {
  signature: string
  driver:    Driver
  dialect:   Dialect
}
const NATIVE_CLIENT_CACHE_KEY = '__rudderjs_native_client__'

function reusableNativeClient(signature: string): { driver: Driver; dialect: Dialect } | undefined {
  const g = globalThis as Record<string, unknown>
  const cached = g[NATIVE_CLIENT_CACHE_KEY] as NativeClientCacheEntry | undefined
  if (!cached) return undefined
  if (cached.signature === signature) return { driver: cached.driver, dialect: cached.dialect }
  // Signature changed (e.g. a config edit) — dispose the superseded driver,
  // fire-and-forget, so its connection is released.
  void Promise.resolve().then(() => cached.driver.close()).catch(() => { /* best effort */ })
  delete g[NATIVE_CLIENT_CACHE_KEY]
  return undefined
}

function cacheNativeClient(entry: NativeClientCacheEntry): void {
  ;(globalThis as Record<string, unknown>)[NATIVE_CLIENT_CACHE_KEY] = entry
}

export class NativeAdapter implements OrmAdapter {
  private constructor(
    /** Where queries run — the top-level connection, or a transaction scope. */
    private readonly executor:   Executor,
    /** Where a (nested) transaction is opened. Top-level: the {@link Driver};
     *  scoped: the active {@link Transaction} (so nesting → SAVEPOINT). */
    private readonly scope:      Transaction,
    private readonly dialect:    Dialect,
    private readonly primaryKey: string,
    /** The owned connection — present only on the top-level adapter, `null` on
     *  a transaction-scoped one (it must not close the shared connection). */
    private readonly driver:     Driver | null,
  ) {}

  /** Build a `NativeAdapter`, opening the configured driver (lazy import). */
  static async make(config: NativeConfig = {}): Promise<NativeAdapter> {
    const primaryKey = config.primaryKey ?? 'id'

    // Caller-supplied driver: no caching, they own the lifecycle.
    if (config.driverInstance) {
      return NativeAdapter._topLevel(config.driverInstance, config.dialect ?? new SqliteDialect(), primaryKey)
    }

    const driverName = config.driver ?? 'sqlite'
    const url =
      config.url ??
      (typeof process !== 'undefined' ? process.env?.['DATABASE_URL'] : undefined) ??
      ':memory:'
    const signature = `${driverName}::${url}`

    const reused = reusableNativeClient(signature)
    if (reused) {
      return NativeAdapter._topLevel(reused.driver, reused.dialect, primaryKey)
    }

    const { driver, dialect } = await openDriver(driverName, url)
    cacheNativeClient({ signature, driver, dialect })
    return NativeAdapter._topLevel(driver, dialect, primaryKey)
  }

  /** The adapter that owns the connection — queries and transactions both run
   *  on `driver`; `disconnect()` may close it. */
  private static _topLevel(driver: Driver, dialect: Dialect, primaryKey: string): NativeAdapter {
    return new NativeAdapter(driver, driver, dialect, primaryKey, driver)
  }

  query<T>(table: string, opts?: OrmAdapterQueryOpts): QueryBuilder<T> {
    const pk = opts?.primaryKey ?? this.primaryKey
    return new NativeQueryBuilder<T>(this.executor, this.dialect, table, pk)
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
      const scoped = new NativeAdapter(txScope, txScope, this.dialect, this.primaryKey, null)
      return fn(scoped)
    })
  }

  async connect(): Promise<void> {
    // Drivers open eagerly in make(); nothing to do here.
  }

  async disconnect(): Promise<void> {
    // A transaction-scoped adapter owns no connection — never close the shared
    // one out from under the owning adapter.
    if (!this.driver) return
    // Evict the cached client BEFORE closing so a later make() with the same
    // driver::url signature opens a fresh driver instead of reusing this closed
    // one. The cache only holds a self-opened driver (driverInstance bypasses
    // caching), so a stale entry here is always the one we're about to close.
    const g = globalThis as Record<string, unknown>
    const cached = g[NATIVE_CLIENT_CACHE_KEY] as NativeClientCacheEntry | undefined
    if (cached?.driver === this.driver) delete g[NATIVE_CLIENT_CACHE_KEY]
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
