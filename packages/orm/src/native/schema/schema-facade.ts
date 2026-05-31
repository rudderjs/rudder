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
import { SchemaBuilder } from './schema-builder.js'
import { NativeOrmError } from '../errors.js'

let current: SchemaBuilder | null = null

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
  /** Bind the connection-scoped builder. Called by the migrator. */
  use(builder: SchemaBuilder): void {
    current = builder
  },
  /** Unbind. Called by the migrator after each migration. */
  reset(): void {
    current = null
  },

  // These are `async` (not just Promise-returning) so an unbound call — where
  // `active()` throws — surfaces as a rejected promise, not a synchronous throw.
  // Callers `await` them, so a uniform rejection is the least surprising contract.
  async create(table: string, build: (table: Blueprint) => void): Promise<void> {
    return active().create(table, build)
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

/** Run `fn` with `builder` bound to {@link Schema}, unbinding afterwards even on
 *  throw. The migrator wraps each migration's up()/down() in this. */
export async function withSchema<T>(builder: SchemaBuilder, fn: () => Promise<T> | T): Promise<T> {
  Schema.use(builder)
  try {
    return await fn()
  } finally {
    Schema.reset()
  }
}
