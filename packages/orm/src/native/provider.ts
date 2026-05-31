// ─── NativeDatabaseProvider ────────────────────────────────
//
// Node-only. The built-in database provider for the native engine, loaded from
// the `@rudderjs/orm/native` subpath via `rudderjs.providerSubpath` (the main
// `@rudderjs/orm` entry is client-bundle-reachable and must never import this).
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

/** One connection entry in `config/database.ts`. Mirrors the prisma/drizzle
 *  shapes, plus the `engine` discriminator the native provider gates on. */
export interface NativeDatabaseConnectionConfig {
  /**
   * Selects the native engine for this connection. The native provider is
   * **inert** unless the *default* connection sets this to `'native'`. Omit it
   * (or set another value) to keep using prisma/drizzle.
   */
  engine?:     'native' | (string & {})
  /** Underlying driver. Native ships `sqlite` today (pg/mysql land later). */
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
 * Auto-discovered (via `rudderjs.providerSubpath: './native'`) service provider
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

    if (conn.driver && conn.driver !== 'sqlite') {
      throw new Error(
        `[RudderJS ORM native] The native engine currently supports the \`sqlite\` ` +
        `driver only — got \`${conn.driver}\`. Use @rudderjs/orm-prisma or ` +
        `@rudderjs/orm-drizzle for Postgres/MySQL, or set \`driver: 'sqlite'\`.`,
      )
    }

    const adapter = await NativeAdapter.make({
      driver: 'sqlite',
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
 * import { nativeDatabase } from '@rudderjs/orm/native'
 * export default [ ...(await defaultProviders()), nativeDatabase(), AppServiceProvider ]
 */
export function nativeDatabase(): typeof NativeDatabaseProvider {
  return NativeDatabaseProvider
}
