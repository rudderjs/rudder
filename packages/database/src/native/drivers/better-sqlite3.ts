// ─── better-sqlite3 Driver (Node) ──────────────────────────
//
// Concrete {@link Driver} over the `better-sqlite3` package. NODE-ONLY:
// `better-sqlite3` is an optional peer of `@rudderjs/orm` and is loaded with a
// lazy `await import()` inside `open()` so this module never drags the native
// addon into a client bundle at eval time (cross-phase rule 5).
//
// better-sqlite3 is synchronous; we wrap its calls in resolved promises to
// satisfy the async {@link Driver} contract shared with RN/WASM drivers.

import type { Driver, Transaction, Row, TransactionOptions } from '../driver.js'
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
  /**
   * Current transaction nesting depth. 0 = no open transaction; 1 = inside a
   * top-level `BEGIN`; ≥2 = inside N−1 nested SAVEPOINTs. Drives the BEGIN-vs-
   * SAVEPOINT choice in {@link transaction}. Single field is safe because
   * better-sqlite3 is single-connection and synchronous — there is exactly one
   * open transaction stack per driver instance.
   */
  private depth = 0

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
    const params = normalizeBindings(bindings)
    const stmt = this.db.prepare(sql)
    // `.all()` is only valid on statements that return rows. A SELECT — or any
    // write with a `RETURNING` clause — is a reader; a plain INSERT/UPDATE/DELETE
    // is not and routes through `.run()`, yielding no rows.
    if (stmt.reader) {
      return stmt.all(...params) as Row[]
    }
    stmt.run(...params)
    return []
  }

  /**
   * Run `fn` inside a transaction. The top-level call wraps it in
   * BEGIN/COMMIT/ROLLBACK; a nested call (depth ≥ 1) wraps it in a uniquely
   * named SAVEPOINT so an inner failure rolls back only its own work, leaving
   * the outer transaction intact. The transaction-scoped {@link Transaction} is
   * the driver itself — better-sqlite3 is synchronous and single-connection, so
   * every `execute` between the markers runs on the one open transaction.
   *
   * (We don't use better-sqlite3's own `db.transaction()` wrapper because it
   * only accepts a *synchronous* function, and our `fn` is async — savepoints
   * give us the same nesting semantics over an async callback.)
   *
   * **Single-connection caveat:** because there is one connection, two
   * *concurrently* in-flight top-level `transaction()` calls would collide on
   * the same connection. SQLite serializes writers anyway; the native engine
   * assumes transactions are not run concurrently against one SQLite handle.
   * Pooled drivers (pg/mysql, Phase 5/6) pin a dedicated client per transaction.
   */
  async transaction<T>(fn: (tx: Transaction) => Promise<T>, opts?: TransactionOptions): Promise<T> {
    // SQLite has no SQL-standard isolation levels (one writer; readers see a
    // serializable snapshot) — a requested level would silently mean nothing,
    // so throw rather than no-op. Checked before the nesting branch: the error
    // is the same at any depth.
    if (opts?.isolationLevel) {
      throw new Error(
        '[RudderJS ORM native] SQLite does not support transaction isolation levels — ' +
        'its single-writer model is already serializable. Drop the isolationLevel ' +
        'option, or use the Postgres/MySQL engine.',
      )
    }
    const top = this.depth === 0
    const savepoint = top ? null : `rudder_sp_${this.depth}`
    if (top) this.db.exec('BEGIN')
    else this.db.exec(`SAVEPOINT ${savepoint}`)
    this.depth++
    try {
      const result = await fn(this)
      if (top) this.db.exec('COMMIT')
      else this.db.exec(`RELEASE ${savepoint}`)
      return result
    } catch (err) {
      try {
        if (top) {
          this.db.exec('ROLLBACK')
        } else {
          // Roll back to the savepoint, then release it so the saved name is
          // discarded — otherwise it lingers on the outer transaction's stack.
          this.db.exec(`ROLLBACK TO ${savepoint}`)
          this.db.exec(`RELEASE ${savepoint}`)
        }
      } catch {
        // A failed ROLLBACK (e.g. the transaction already aborted) must not mask
        // the original error — swallow it and re-throw the cause below.
      }
      throw err
    } finally {
      this.depth--
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

/**
 * better-sqlite3 binds only numbers, strings, bigints, buffers, and `null` —
 * a JS `boolean` throws `TypeError: SQLite3 can only bind …`. SQLite has no
 * boolean type, so map `true`/`false` to the integers `1`/`0`; this round-trips
 * with the ORM's `boolean` cast (which reads `0`/`1` back). The mapping covers
 * raw boolean values that bypass a column cast — an untyped `where('flag', true)`
 * predicate, or a `query().create({ flag: true })` on a column without a
 * boolean cast. Other unbindable values (`Date`, plain objects) are passed
 * through so better-sqlite3 still rejects them with its own clear error.
 *
 * Returns the original array reference when nothing needed coercion, so the
 * common boolean-free path allocates nothing.
 *
 * Any future SQLite driver (libsql, op-sqlite for React Native) needs the same
 * mapping — share this helper rather than re-deriving it per driver.
 */
function normalizeBindings(bindings: readonly unknown[]): unknown[] {
  let hasBoolean = false
  for (const v of bindings) {
    if (typeof v === 'boolean') { hasBoolean = true; break }
  }
  if (!hasBoolean) return bindings as unknown[]
  return bindings.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v))
}

/** Strip a `file:` scheme and default to an in-memory database. */
function normalizeFilename(filename: string | undefined): string {
  if (!filename) return ':memory:'
  return filename.replace(/^file:/, '')
}
