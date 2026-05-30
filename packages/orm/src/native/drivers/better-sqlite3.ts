// ─── better-sqlite3 Driver (Node) ──────────────────────────
//
// Concrete {@link Driver} over the `better-sqlite3` package. NODE-ONLY:
// `better-sqlite3` is an optional peer of `@rudderjs/orm` and is loaded with a
// lazy `await import()` inside `open()` so this module never drags the native
// addon into a client bundle at eval time (cross-phase rule 5).
//
// better-sqlite3 is synchronous; we wrap its calls in resolved promises to
// satisfy the async {@link Driver} contract shared with RN/WASM drivers.

import type { Driver, Executor, Row } from '../driver.js'
import { NativeDriverError } from '../errors.js'

// Minimal structural types for the slice of better-sqlite3 we use — avoids a
// hard type dependency on `@types/better-sqlite3` in the runtime graph.
interface Bs3Statement {
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): unknown
  reader: boolean
}
interface Bs3Database {
  prepare(sql: string): Bs3Statement
  exec(sql: string): unknown
  close(): void
}
interface Bs3Constructor {
  new (filename: string, options?: Record<string, unknown>): Bs3Database
}

/** Connection config for {@link BetterSqlite3Driver.open}. */
export interface BetterSqlite3DriverConfig {
  /**
   * Database location. Accepts a filesystem path, a `file:` URL, or
   * `':memory:'` for an in-memory database (the default). A leading `file:`
   * scheme is stripped for better-sqlite3, which wants a bare path.
   */
  filename?: string
  /** Forwarded to the better-sqlite3 `Database` constructor (e.g. `readonly`). */
  options?: Record<string, unknown>
}

/**
 * {@link Driver} backed by better-sqlite3. Construct via the static
 * {@link BetterSqlite3Driver.open} factory, which performs the lazy import.
 */
export class BetterSqlite3Driver implements Driver {
  private constructor(private readonly db: Bs3Database) {}

  /**
   * Resolve the `better-sqlite3` package, open the database, and return a
   * ready driver. Throws {@link NativeDriverError} with install guidance when
   * the package isn't present (it's an optional peer).
   */
  static async open(config: BetterSqlite3DriverConfig = {}): Promise<BetterSqlite3Driver> {
    const filename = normalizeFilename(config.filename)
    let Database: Bs3Constructor
    try {
      // `better-sqlite3` uses `export =`, so a dynamic import wraps it in
      // `.default`. Fall back to the namespace object for older interop.
      const mod = await import('better-sqlite3') as unknown as { default?: Bs3Constructor }
      Database = mod.default ?? (mod as unknown as Bs3Constructor)
    } catch (err) {
      throw new NativeDriverError(
        `[RudderJS ORM native] Failed to load "better-sqlite3". It is an optional ` +
        `peer of @rudderjs/orm — install it with \`pnpm add better-sqlite3\` to use ` +
        `the native SQLite engine.`,
        { cause: err },
      )
    }

    try {
      const db = new Database(filename, config.options)
      return new BetterSqlite3Driver(db)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new NativeDriverError(
        `[RudderJS ORM native] Could not open SQLite database at ${JSON.stringify(filename)}: ${msg}`,
        { cause: err },
      )
    }
  }

  async execute(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
    const stmt = this.db.prepare(sql)
    // `.all()` is only valid on statements that return rows. A SELECT — or any
    // write with a `RETURNING` clause — is a reader; a plain INSERT/UPDATE/DELETE
    // is not and routes through `.run()`, yielding no rows.
    if (stmt.reader) {
      return stmt.all(...bindings) as Row[]
    }
    stmt.run(...bindings)
    return []
  }

  /**
   * BEGIN/COMMIT/ROLLBACK around `fn`. better-sqlite3 is synchronous and
   * single-connection, so the transaction-scoped {@link Executor} is the driver
   * itself — every `execute` between BEGIN and COMMIT runs on the one open
   * transaction. (We don't use better-sqlite3's own `db.transaction()` wrapper
   * because it only accepts a *synchronous* function, and our `fn` is async.)
   *
   * Phase 2 keeps this single-level; Phase 4 adds SAVEPOINT-based nesting.
   */
  async transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN')
    try {
      const result = await fn(this)
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // A failed ROLLBACK (e.g. the transaction already aborted) must not mask
        // the original error — swallow it and re-throw the cause below.
      }
      throw err
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

/** Strip a `file:` scheme and default to an in-memory database. */
function normalizeFilename(filename: string | undefined): string {
  if (!filename) return ':memory:'
  return filename.replace(/^file:/, '')
}
