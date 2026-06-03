// ─── ConnectionManager — named database connections ────────
//
// Laravel-parity named connections (`DB.connection('reporting')`, per-model
// `static connection`, `Model.on('reporting')`) over the existing one-adapter
// architecture. Holds *factories*, not adapters: `config/database.ts`'s
// `connections` map is a MENU — apps list sqlite/postgresql/mysql alternates
// with only one driver installed — so a connection must never open (or even
// `import()` the driver for) until something actually uses it. Adapter
// providers register a lazy factory per connection they own at boot
// (no I/O); `ensure()` opens on first use, single-flighted and memoized.
//
// The DEFAULT connection keeps its existing eager path (`ModelRegistry.set`
// in each provider's `boot()`) — this registry is additive for named access.
//
// Client-bundle safe: `@rudderjs/orm`'s main entry re-exports this module, so
// no `node:` imports and no unguarded `process.env` reads here (Client Bundle
// Smoke gate).

import type { OrmAdapter } from '@rudderjs/contracts'

/** Builds the adapter for a named connection on first use. Registered by the
 *  adapter provider (native / prisma / drizzle) that owns the connection's
 *  config shape. Must be safe to call once per process lifetime per name —
 *  underlying clients are reused across dev re-boots via each adapter
 *  package's per-signature `globalThis` cache. */
export type ConnectionFactory = () => Promise<OrmAdapter>

interface ConnectionEntry {
  factory: ConnectionFactory
  /** Memoized once opened. */
  adapter: OrmAdapter | null
  /** Single-flight guard: concurrent `ensure()` calls share one open. */
  opening: Promise<OrmAdapter> | null
}

interface ConnectionStore {
  connections: Map<string, ConnectionEntry>
  defaultName: string | null
}

// Shared via globalThis for the same reason as `__rudderjs_orm_registry__`:
// `@rudderjs/orm` can be loaded twice (bundled inline + resolved from
// node_modules by an externalized adapter package), and both copies must see
// the same connection set.
const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_orm_connections__']) {
  _g['__rudderjs_orm_connections__'] = {
    connections: new Map(),
    defaultName: null,
  } satisfies ConnectionStore
}
const _conns = _g['__rudderjs_orm_connections__'] as ConnectionStore

export class ConnectionManager {
  /**
   * Register a lazy factory for a named connection. Called from an adapter
   * provider's `boot()` — registering does NO I/O and no driver import.
   *
   * Re-registering (a dev HMR re-boot re-runs `boot()`) replaces the factory
   * and clears the memoized adapter so a config edit takes effect on next use.
   * This does NOT leak the underlying client: re-running the factory resolves
   * through the adapter package's per-signature `globalThis` client cache,
   * which reuses an unchanged client and disposes a superseded one.
   */
  static register(name: string, factory: ConnectionFactory): void {
    _conns.connections.set(name, { factory, adapter: null, opening: null })
  }

  static has(name: string): boolean {
    return _conns.connections.has(name)
  }

  /** Registered connection names (for error messages / introspection). */
  static names(): string[] {
    return [..._conns.connections.keys()]
  }

  /** The opened adapter for `name`, or `null` when the connection is
   *  registered but not yet opened (or unknown). Sync; never opens. */
  static peek(name: string): OrmAdapter | null {
    return _conns.connections.get(name)?.adapter ?? null
  }

  /**
   * Resolve the adapter for a named connection, opening it on first use.
   * Concurrent callers share a single open (single-flight); the result is
   * memoized so every later call is a sync-fast map hit.
   *
   * @throws when `name` was never registered — the message lists the
   *   configured names so a typo'd connection name is self-diagnosing.
   */
  static async ensure(name: string): Promise<OrmAdapter> {
    const entry = _conns.connections.get(name)
    if (!entry) {
      const known = ConnectionManager.names()
      throw new Error(
        `[RudderJS ORM] Unknown database connection '${name}'. ` +
          (known.length > 0
            ? `Configured connections: ${known.map((n) => `'${n}'`).join(', ')}. `
            : 'No connections are registered — did a database provider boot? ') +
          `Check the 'connections' map in config/database.ts.`,
      )
    }
    if (entry.adapter) return entry.adapter
    if (entry.opening) return entry.opening

    entry.opening = entry
      .factory()
      .then((adapter) => {
        entry.adapter = adapter
        entry.opening = null
        return adapter
      })
      .catch((err: unknown) => {
        // A failed open must not poison the entry — the next ensure() retries.
        entry.opening = null
        throw err
      })
    return entry.opening
  }

  /** The app's default connection name (`config('database.default')`), pushed
   *  by the adapter provider at boot. `null` outside a framework boot
   *  (standalone ORM use). */
  static defaultName(): string | null {
    return _conns.defaultName
  }

  static setDefaultName(name: string): void {
    _conns.defaultName = name
  }

  /** @internal test-only — drop every registration and the default name. */
  static __reset(): void {
    _conns.connections.clear()
    _conns.defaultName = null
  }
}
