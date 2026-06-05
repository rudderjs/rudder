// ─── Schema facade (Laravel `Schema::`) ────────────────────
//
// The static entry point migration files call: `Schema.create(...)`,
// `Schema.dropIfExists(...)`, etc. It delegates to a {@link SchemaBuilder} the
// {@link Migrator} binds (`Schema.use(builder)`) for the duration of each
// migration's `up()` / `down()`, then unbinds (`Schema.reset()`). This mirrors
// Laravel's facade resolving the schema builder from the active connection.
//
// Migrations run serially in a single CLI process, so a module-level "current
// builder" is sufficient — there's no concurrency to guard. Calling a `Schema`
// method with nothing bound (e.g. importing `Schema` and using it outside a
// migration run) throws a clear error rather than a null-deref.

import type { Blueprint } from './blueprint.js'
import type { AlterBlueprint } from './alter-blueprint.js'
import { SchemaBuilder } from './schema-builder.js'
import { NativeOrmError } from '../errors.js'
import { resolveConnectionResolver } from '../../registry-bridge.js'

let current: SchemaBuilder | null = null
// `--pretend` runs bind a RECORDING builder — a `Schema.connection()` call in
// that window would execute REAL DDL on the named connection while the bound
// connection only records. Tracked here so connection() can refuse instead.
let pretending = false

function active(): SchemaBuilder {
  if (!current) {
    throw new NativeOrmError(
      'NATIVE_SCHEMA_UNBOUND',
      `[RudderJS ORM native] Schema is not bound to a connection. ` +
      `Schema methods may only be called from a migration's up()/down() run by the migrator.`,
    )
  }
  return current
}

/**
 * The Laravel-style `Schema` facade. Static methods delegate to the bound
 * {@link SchemaBuilder}. The {@link Migrator} owns binding via {@link Schema.use}
 * / {@link Schema.reset}; migration authors only call the table operations.
 */
export const Schema = {
  /** Bind the connection-scoped builder. Called by the migrator. `pretend`
   *  marks a recording (dry-run) bind — see {@link Schema.connection}. */
  use(builder: SchemaBuilder, opts: { pretend?: boolean } = {}): void {
    current = builder
    pretending = opts.pretend === true
  },
  /** Unbind. Called by the migrator after each migration. */
  reset(): void {
    current = null
    pretending = false
  },

  /**
   * The same table operations, scoped to a NAMED connection from
   * `config/database.ts` (Laravel `Schema::connection('reporting')->create(…)`):
   *
   *   await Schema.connection('reporting').create('events', (t) => { … })
   *
   * Resolves through the same named-connection seam as `DB.connection()` —
   * lazy (the connection opens at the first operation) and available wherever
   * the app has booted, not only inside a migration run. The connection must
   * use the native engine (`engine: 'native'`); prisma/drizzle connections
   * throw a clear error.
   *
   * Two boundaries:
   * - Inside a migration, DDL on another connection runs OUTSIDE the
   *   migrator's batch transaction (a transaction can't span connections) —
   *   a failed batch rolls back the bound connection only.
   * - Throws under `migrate --pretend`: the dry-run records the bound
   *   connection's SQL without executing, and there is no recording seam for
   *   a second connection — executing its DDL for real would betray the dry run.
   */
  connection(name: string): ConnectionSchemaOps {
    if (pretending) {
      throw new NativeOrmError(
        'NATIVE_SCHEMA_PRETEND_CONNECTION',
        `[RudderJS ORM native] Schema.connection("${name}") is not supported under --pretend — ` +
        `the dry run records the bound connection only; DDL on a second connection would execute for real.`,
      )
    }
    const builder = async (): Promise<SchemaBuilder> => {
      const adapter = await resolveConnectionResolver()(name) as { schemaBuilder?: () => SchemaBuilder }
      if (typeof adapter.schemaBuilder !== 'function') {
        throw new NativeOrmError(
          'NATIVE_SCHEMA_CONNECTION_ENGINE',
          `[RudderJS ORM native] Connection "${name}" does not use the native engine — ` +
          `Schema.connection() needs an \`engine: 'native'\` connection (prisma/drizzle manage schema with their own tooling).`,
        )
      }
      return adapter.schemaBuilder()
    }
    return {
      async create(table, build) { return (await builder()).create(table, build) },
      async table(table, build) { return (await builder()).table(table, build) },
      async rename(from, to) { return (await builder()).rename(from, to) },
      async drop(table) { return (await builder()).drop(table) },
      async dropIfExists(table) { return (await builder()).dropIfExists(table) },
      async hasTable(table) { return (await builder()).hasTable(table) },
      async hasColumn(table, column) { return (await builder()).hasColumn(table, column) },
    }
  },

  // These are `async` (not just Promise-returning) so an unbound call — where
  // `active()` throws — surfaces as a rejected promise, not a synchronous throw.
  // Callers `await` them, so a uniform rejection is the least surprising contract.
  async create(table: string, build: (table: Blueprint) => void): Promise<void> {
    return active().create(table, build)
  },
  async table(table: string, build: (table: AlterBlueprint) => void): Promise<void> {
    return active().table(table, build)
  },
  async rename(from: string, to: string): Promise<void> {
    return active().rename(from, to)
  },
  async drop(table: string): Promise<void> {
    return active().drop(table)
  },
  async dropIfExists(table: string): Promise<void> {
    return active().dropIfExists(table)
  },
  async hasTable(table: string): Promise<boolean> {
    return active().hasTable(table)
  },
  async hasColumn(table: string, column: string): Promise<boolean> {
    return active().hasColumn(table, column)
  },
} as const

/** The named-connection table operations returned by {@link Schema.connection}
 *  — the facade's surface minus the migrator-owned bind/unbind. */
export interface ConnectionSchemaOps {
  create(table: string, build: (table: Blueprint) => void): Promise<void>
  table(table: string, build: (table: AlterBlueprint) => void): Promise<void>
  rename(from: string, to: string): Promise<void>
  drop(table: string): Promise<void>
  dropIfExists(table: string): Promise<void>
  hasTable(table: string): Promise<boolean>
  hasColumn(table: string, column: string): Promise<boolean>
}

/** Run `fn` with `builder` bound to {@link Schema}, unbinding afterwards even on
 *  throw. The migrator wraps each migration's up()/down() in this — `pretend`
 *  marks the recording (dry-run) bind so `Schema.connection()` can refuse. */
export async function withSchema<T>(
  builder: SchemaBuilder,
  fn: () => Promise<T> | T,
  opts: { pretend?: boolean } = {},
): Promise<T> {
  Schema.use(builder, opts)
  try {
    return await fn()
  } finally {
    Schema.reset()
  }
}
