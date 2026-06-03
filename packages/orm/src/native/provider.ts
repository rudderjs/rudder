// ─── NativeDatabaseProvider ────────────────────────────────
//
// Node-only. The built-in database provider for the native engine, loaded from
// the `@rudderjs/orm/native/provider` subpath via `rudderjs.providerSubpath`
// (the main `@rudderjs/orm` entry is client-bundle-reachable and must never
// import this; the `@rudderjs/orm/native` engine barrel stays framework-free,
// so the provider lives in its own subpath — see #806).
//
// **Opt-in by config.** `@rudderjs/orm` is installed in *every* app, so unlike
// the prisma/drizzle `DatabaseProvider`s — which assume one-adapter-package-per-
// app and set the adapter unconditionally — this provider stays INERT unless the
// active connection explicitly selects the native engine with `engine: 'native'`.
// That keeps it dormant in prisma/drizzle apps even though it's auto-discovered.
//
// `@rudderjs/core` is an OPTIONAL PEER of `@rudderjs/orm` (always present in a
// real Rudder app; absent for standalone-Node ORM use, which wires the adapter
// directly via `ModelRegistry.set(await NativeAdapter.make(...))` and never
// touches this provider). It's a node-only import in this subpath, so it doesn't
// affect the client-bundle gate.

import { ServiceProvider, config, appendToGroup } from '@rudderjs/core'
import { ModelRegistry, ConnectionManager } from '../index.js'
import { databaseContextMiddleware } from '../sticky.js'
import { NativeAdapter } from './adapter.js'
import type { NativeDriverName } from './adapter.js'
// Side effect: wires the DB facade to resolve this app's active ORM adapter and
// pushes the transaction runner — mirrors the prisma/drizzle adapter entries, so
// `DB.*` / `DB.transaction()` work in native-engine apps too. Node-only subpath,
// never on the client bundle path.
import '../db-bridge.js'

/** One connection entry in `config/database.ts`. Mirrors the prisma/drizzle
 *  shapes, plus the `engine` discriminator the native provider gates on. */
export interface NativeDatabaseConnectionConfig {
  /**
   * Selects the native engine for this connection. The native provider is
   * **inert** unless the *default* connection sets this to `'native'`. Omit it
   * (or set another value) to keep using prisma/drizzle.
   */
  engine?:     'native' | (string & {})
  /** Underlying driver: `sqlite` (better-sqlite3), `pg` (postgres), or `mysql`
   *  (mysql2). The matching optional peer must be installed. */
  driver?:     NativeDriverName | (string & {})
  /** Connection URL / path (`file:./dev.db`, `:memory:`, …). Doubles as the
   *  WRITE url on a read/write-split connection (alias: `write.url`). */
  url?:        string
  /** Default primary-key column for models that don't override it. */
  primaryKey?: string
  /** Explicit write-side URL on a read/write split. Defaults to `url`. */
  write?:      { url?: string }
  /** Read replica(s) — one URL or an array (round-robin per query). Un-locked
   *  SELECTs route here; writes, DDL, locked selects, and transactions stay on
   *  the write connection. */
  read?:       { url: string | string[] }
  /** Sticky reads: after a write within the current request scope, reads on
   *  this connection route to the writer (read-your-writes under replication
   *  lag). Requires `read`. */
  sticky?:     boolean
}

/** `config('database')` shape consumed by {@link NativeDatabaseProvider}. The
 *  `default` + `connections` envelope matches the prisma/drizzle adapters so an
 *  app can switch engines without restructuring `config/database.ts`. */
export interface NativeDatabaseConfig {
  default:     string
  connections: Record<string, NativeDatabaseConnectionConfig>
}

/** Native ships three drivers: sqlite (better-sqlite3), pg (postgres), and
 *  mysql (mysql2). Validate the configured name (runs inside the connection
 *  factory, so a typo on a NAMED connection surfaces at first use; the default
 *  connection's factory runs eagerly at boot) — `NativeAdapter.make` then
 *  lazy-loads the matching optional peer and surfaces a clear install /
 *  connection error if it's missing or the URL is unreachable. */
function validateDriver(driver: string, connection: string): NativeDriverName {
  const KNOWN: readonly NativeDriverName[] = ['sqlite', 'pg', 'mysql']
  if (!KNOWN.includes(driver as NativeDriverName)) {
    throw new Error(
      `[RudderJS ORM native] Unknown native driver \`${driver}\` (connection '${connection}') — supported drivers ` +
      `are ${KNOWN.map((d) => `\`${d}\``).join(', ')}. (Postgres uses \`pg\`, MySQL uses \`mysql\`.)`,
    )
  }
  return driver as NativeDriverName
}

/**
 * Auto-discovered (via `rudderjs.providerSubpath: './native/provider'`) service provider
 * that boots a `NativeAdapter` from `config('database')` — but only when the
 * default connection opts in with `engine: 'native'`. Wires:
 *   - `ModelRegistry.set(adapter)` so `@rudderjs/orm` Models route through native
 *   - `app.instance('db', adapter)` for direct DI lookup
 */
export class NativeDatabaseProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<NativeDatabaseConfig | undefined>('database', undefined)
    if (!cfg) return

    // Register a LAZY factory for every connection that selects the native
    // engine — named connections (`DB.connection('reporting')`, per-model
    // `static connection`) open on first use. Registering does no I/O and no
    // driver import, so `connections` keeps its menu semantics: an entry
    // nobody uses never opens (or even imports its optional-peer driver).
    // Other connection shapes (prisma/drizzle) are skipped here; their own
    // providers register those.
    let needsStickyContext = false
    for (const [name, conn] of Object.entries(cfg.connections)) {
      if (conn?.engine !== 'native') continue
      // Read/write split: `url` is the write URL (or the explicit `write.url`);
      // `read.url` normalizes to an array of replicas.
      const writeUrl = conn.write?.url ?? conn.url
      const readUrls = conn.read === undefined
        ? []
        : Array.isArray(conn.read.url) ? conn.read.url : [conn.read.url]
      const sticky = conn.sticky === true && readUrls.length > 0
      if (sticky) needsStickyContext = true
      ConnectionManager.register(name, () =>
        NativeAdapter.make({
          driver: validateDriver(conn.driver ?? 'sqlite', name),
          connectionName: name,
          ...(writeUrl !== undefined && { url: writeUrl }),
          ...(readUrls.length > 0 && { readUrls }),
          ...(sticky && { sticky }),
          ...(conn.primaryKey !== undefined && { primaryKey: conn.primaryKey }),
        }),
      )
    }
    ConnectionManager.setDefaultName(cfg.default)

    // Sticky reads scope to a request — enter a database context per request
    // on both groups (api requests write too). Installed once here, not per
    // connection; the ALS scope is shared by every sticky connection.
    if (needsStickyContext) {
      const mw = databaseContextMiddleware()
      appendToGroup('web', mw)
      appendToGroup('api', mw)
    }

    const conn = cfg.connections[cfg.default]

    // Inert unless this app explicitly selected the native engine as the
    // DEFAULT. This is the collision guard: prisma/drizzle apps discover this
    // provider but skip here (any `engine: 'native'` NAMED connections they
    // declare were still registered above — lazily, so they stay dormant).
    if (!conn || conn.engine !== 'native') return

    // Eager default boot — resolved through the same ConnectionManager entry
    // so `DB.connection(cfg.default)` and the Models share ONE adapter/driver.
    const adapter = await ConnectionManager.ensure(cfg.default)

    ModelRegistry.set(adapter)
    this.app.instance('db', adapter)
  }
}

/**
 * Explicit opt-in: returns the {@link NativeDatabaseProvider} class for apps that
 * list providers by hand in `bootstrap/providers.ts` instead of relying on
 * auto-discovery. The provider still gates on `engine: 'native'`.
 *
 * @example
 * // bootstrap/providers.ts
 * import { nativeDatabase } from '@rudderjs/orm/native/provider'
 * export default [ ...(await defaultProviders()), nativeDatabase(), AppServiceProvider ]
 */
export function nativeDatabase(): typeof NativeDatabaseProvider {
  return NativeDatabaseProvider
}
