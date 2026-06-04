// ─── MySQL Driver (Node, mysql2/promise) ───────────────────
//
// Concrete {@link Driver} over the `mysql2` package (its `mysql2/promise` API).
// NODE-ONLY: `mysql2` is an optional peer of `@rudderjs/orm`, lazy-`import()`ed
// inside `open()` so this module never drags the driver into a client bundle at
// eval time (cross-phase rule 5). Mirrors the postgres driver's shape.
//
// Like postgres (and unlike single-connection better-sqlite3), mysql2 pools
// connections — so a transaction MUST pin one connection. The top-level driver
// runs autocommit statements on the pool; `transaction()` reserves a connection
// (`getConnection()` + `beginTransaction`), and nested transactions map to
// SAVEPOINTs on that pinned connection (same savepoint semantics the prisma/
// drizzle adapters use).
//
// MySQL has no `RETURNING`, so this driver also implements {@link
// AffectingExecutor}: writes report their auto-increment `insertId` and
// `affectedRows` from mysql2's `ResultSetHeader`, which the query builder's
// no-RETURNING path consumes.

import type { Driver, Transaction, Row, AffectingExecutor, AffectingResult } from '../driver.js'
import { NativeDriverError } from '../errors.js'

/** Monotonic counter for unique nested-transaction SAVEPOINT names. */
let savepointSeq = 0

/**
 * The structural slice of `mysql2/promise` we depend on. Typed here (not via
 * `@types`) so the optional peer carries no compile-time dependency — same
 * approach as the postgres / better-sqlite3 drivers.
 */
interface Mysql2ResultSetHeader { affectedRows?: number; insertId?: number }
interface Mysql2Queryable {
  /** Run SQL with positional `?` params; resolves to `[rows | ResultSetHeader, fields]`.
   *  SELECT → an array of row objects; INSERT/UPDATE/DELETE → a ResultSetHeader. */
  query(sql: string, values?: readonly unknown[]): Promise<[unknown, unknown]>
}
interface Mysql2Connection extends Mysql2Queryable {
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
}
interface Mysql2Pool extends Mysql2Queryable {
  getConnection(): Promise<Mysql2Connection>
  end(): Promise<void>
}
type Mysql2Module = { createPool(config: string | Record<string, unknown>): Mysql2Pool }

/** Connection config for {@link MysqlDriver.open}. */
export interface MysqlDriverConfig {
  /** MySQL connection string, e.g. `mysql://user:pass@host:3306/db`. */
  url: string
  /** Forwarded to `mysql2.createPool()` (e.g. `connectionLimit`, `ssl`). */
  options?: Record<string, unknown>
}

/** Run a statement on a queryable and normalize the row result to `Row[]`
 *  (a write's ResultSetHeader is not an array → no rows). */
async function runQuery(q: Mysql2Queryable, sql: string, bindings: readonly unknown[]): Promise<Row[]> {
  const [result] = await q.query(sql, bindings)
  return Array.isArray(result) ? (result as Row[]) : []
}

/** Run a write and read its metadata. A SELECT (array result) reports its row
 *  count as `affectedRows` and no `insertId`; a write reads the header. */
async function runAffecting(q: Mysql2Queryable, sql: string, bindings: readonly unknown[]): Promise<AffectingResult> {
  const [result] = await q.query(sql, bindings)
  if (Array.isArray(result)) return { insertId: null, affectedRows: result.length }
  const header = result as Mysql2ResultSetHeader
  const insertId = typeof header.insertId === 'number' && header.insertId > 0 ? header.insertId : null
  return { insertId, affectedRows: header.affectedRows ?? 0 }
}

/**
 * A {@link Transaction} scope pinned to one mysql2 connection. Every query on
 * the scope runs on that connection, so a transaction-scoped query stays on the
 * transaction's connection; nesting opens a SAVEPOINT on it.
 */
class MysqlScope implements Transaction, AffectingExecutor {
  constructor(protected readonly conn: Mysql2Connection) {}

  execute(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
    return runQuery(this.conn, sql, bindings)
  }

  affectingExecute(sql: string, bindings: readonly unknown[]): Promise<AffectingResult> {
    return runAffecting(this.conn, sql, bindings)
  }

  // Nested transaction → SAVEPOINT on the current (already-transactional)
  // connection, so an inner failure rolls back only its own work.
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const name = `rudder_sp_${(savepointSeq = (savepointSeq + 1) % Number.MAX_SAFE_INTEGER)}`
    await this.conn.query(`SAVEPOINT ${name}`)
    try {
      const result = await fn(this)
      await this.conn.query(`RELEASE SAVEPOINT ${name}`)
      return result
    } catch (err) {
      try {
        // Roll back to the savepoint, then release it so the name is discarded.
        await this.conn.query(`ROLLBACK TO SAVEPOINT ${name}`)
        await this.conn.query(`RELEASE SAVEPOINT ${name}`)
      } catch {
        // A failed rollback must not mask the original error.
      }
      throw err
    }
  }
}

/**
 * {@link Driver} backed by `mysql2`. Construct via the static
 * {@link MysqlDriver.open} factory, which lazy-imports the package, builds a
 * pool, and validates connectivity up front. Autocommit statements run on the
 * pool; `transaction()` reserves a dedicated connection.
 */
export class MysqlDriver implements Driver, AffectingExecutor {
  private constructor(private readonly pool: Mysql2Pool) {}

  /**
   * Resolve `mysql2`, build a pool for `config.url`, validate the connection, and
   * return a ready driver. Throws {@link NativeDriverError} with install guidance
   * when the package is missing, or a connection error when the URL is
   * unreachable — so failures surface at setup, not deep in a request.
   */
  static async open(config: MysqlDriverConfig): Promise<MysqlDriver> {
    let mod: Mysql2Module
    try {
      // mysql2 ships its promise API at `mysql2/promise`.
      mod = await import('mysql2/promise') as unknown as Mysql2Module
    } catch (err) {
      throw new NativeDriverError(
        `[RudderJS ORM native] Failed to load "mysql2". It is an optional peer of ` +
        `@rudderjs/orm — install it with \`pnpm add mysql2\` to use the native MySQL engine.`,
        { cause: err },
      )
    }

    const pool = mod.createPool({
      uri: config.url,
      // MySQL has no boolean type — `t.boolean()` columns are `tinyint(1)`
      // (the BOOLEAN alias). Map them back to JS booleans on read so boolean
      // columns round-trip like they do on Postgres (whose driver parses the
      // native bool type). Only display-width-1 TINY columns qualify — a plain
      // `t.tinyInt()` (width 4) stays numeric. `config.options` can override.
      typeCast: (field: { type: string; length: number; string(): string | null }, next: () => unknown) => {
        if (field.type === 'TINY' && field.length === 1) {
          const value = field.string()
          return value === null ? null : value === '1'
        }
        return next()
      },
      ...config.options,
    })
    const driver = new MysqlDriver(pool)
    try {
      await pool.query('select 1')
    } catch (err) {
      await pool.end().catch(() => { /* best effort */ })
      const msg = err instanceof Error ? err.message : String(err)
      throw new NativeDriverError(
        `[RudderJS ORM native] Could not connect to MySQL at the configured URL: ${msg}`,
        { cause: err },
      )
    }
    return driver
  }

  execute(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
    return runQuery(this.pool, sql, bindings)
  }

  affectingExecute(sql: string, bindings: readonly unknown[]): Promise<AffectingResult> {
    return runAffecting(this.pool, sql, bindings)
  }

  // Top-level transaction → reserve a connection, BEGIN, COMMIT (ROLLBACK on
  // throw), always release. Every query inside runs on the pinned connection.
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection()
    try {
      await conn.beginTransaction()
      try {
        const result = await fn(new MysqlScope(conn))
        await conn.commit()
        return result
      } catch (err) {
        try { await conn.rollback() } catch { /* best effort */ }
        throw err
      }
    } finally {
      conn.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
