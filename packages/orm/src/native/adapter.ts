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
import type { Driver } from './driver.js'
import { NativeQueryBuilder } from './query-builder.js'
import { BetterSqlite3Driver } from './drivers/better-sqlite3.js'

/** Supported native drivers. Phase 1 ships `sqlite`; `pg`/`mysql` land later. */
export type NativeDriverName = 'sqlite'

/** Config for {@link native} / {@link NativeAdapter.make}. */
export interface NativeConfig {
  /**
   * Pre-built {@link Driver} — skips driver setup and HMR caching. Use for
   * tests or hand-wired setups (you own the driver's lifecycle).
   */
  driverInstance?: Driver
  /** Which built-in driver to open. Defaults to `'sqlite'`. */
  driver?: NativeDriverName
  /**
   * Connection URL / path. For SQLite: a file path, `file:` URL, or
   * `':memory:'`. Falls back to `DATABASE_URL`, then `:memory:`.
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
    private readonly driver:     Driver,
    private readonly dialect:    Dialect,
    private readonly primaryKey: string,
  ) {}

  /** Build a `NativeAdapter`, opening the configured driver (lazy import). */
  static async make(config: NativeConfig = {}): Promise<NativeAdapter> {
    const primaryKey = config.primaryKey ?? 'id'

    // Caller-supplied driver: no caching, they own the lifecycle.
    if (config.driverInstance) {
      return new NativeAdapter(config.driverInstance, new SqliteDialect(), primaryKey)
    }

    const driverName = config.driver ?? 'sqlite'
    const url =
      config.url ??
      (typeof process !== 'undefined' ? process.env?.['DATABASE_URL'] : undefined) ??
      ':memory:'
    const signature = `${driverName}::${url}`

    const reused = reusableNativeClient(signature)
    if (reused) {
      return new NativeAdapter(reused.driver, reused.dialect, primaryKey)
    }

    const { driver, dialect } = await openDriver(driverName, url)
    cacheNativeClient({ signature, driver, dialect })
    return new NativeAdapter(driver, dialect, primaryKey)
  }

  query<T>(table: string, opts?: OrmAdapterQueryOpts): QueryBuilder<T> {
    const pk = opts?.primaryKey ?? this.primaryKey
    return new NativeQueryBuilder<T>(this.driver, this.dialect, table, pk)
  }

  async connect(): Promise<void> {
    // Drivers open eagerly in make(); nothing to do here.
  }

  async disconnect(): Promise<void> {
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
