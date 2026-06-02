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

import { ServiceProvider, config } from '@rudderjs/core'
import { ModelRegistry } from '../index.js'
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
  /** Connection URL / path (`file:./dev.db`, `:memory:`, …). */
  url?:        string
  /** Default primary-key column for models that don't override it. */
  primaryKey?: string
}

/** `config('database')` shape consumed by {@link NativeDatabaseProvider}. The
 *  `default` + `connections` envelope matches the prisma/drizzle adapters so an
 *  app can switch engines without restructuring `config/database.ts`. */
export interface NativeDatabaseConfig {
  default:     string
  connections: Record<string, NativeDatabaseConnectionConfig>
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
    const conn = cfg?.connections[cfg.default]

    // Inert unless this app explicitly selected the native engine. This is the
    // collision guard: prisma/drizzle apps discover this provider but skip here.
    if (!conn || conn.engine !== 'native') return

    // Native ships three drivers: sqlite (better-sqlite3), pg (postgres), and
    // mysql (mysql2). Validate the configured name here — `NativeAdapter.make`
    // then lazy-loads the matching optional peer and surfaces a clear install /
    // connection error if it's missing or the URL is unreachable.
    const driver = conn.driver ?? 'sqlite'
    const KNOWN: readonly NativeDriverName[] = ['sqlite', 'pg', 'mysql']
    if (!KNOWN.includes(driver as NativeDriverName)) {
      throw new Error(
        `[RudderJS ORM native] Unknown native driver \`${driver}\` — supported drivers ` +
        `are ${KNOWN.map((d) => `\`${d}\``).join(', ')}. (Postgres uses \`pg\`, MySQL uses \`mysql\`.)`,
      )
    }

    const adapter = await NativeAdapter.make({
      driver: driver as NativeDriverName,
      ...(conn.url !== undefined && { url: conn.url }),
      ...(conn.primaryKey !== undefined && { primaryKey: conn.primaryKey }),
    })

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
