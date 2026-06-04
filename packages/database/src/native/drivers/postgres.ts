// ─── postgres Driver (Node, porsager `postgres`) ───────────
//
// Concrete {@link Driver} over the `postgres` package (porsager). NODE-ONLY:
// `postgres` is an optional peer of `@rudderjs/orm`, lazy-`import()`ed inside
// `open()` so this module never drags the driver into a client bundle at eval
// time (cross-phase rule 5). Mirrors the same shape used by `@rudderjs/orm-drizzle`.
//
// Unlike better-sqlite3 (single synchronous connection), porsager pools
// connections. So a transaction MUST run on one pinned connection — we use
// porsager's own `sql.begin()` / `sql.savepoint()`, which reserve a connection
// for the whole scope, rather than issuing a bare `BEGIN` on the pool (which
// could land BEGIN and the following statements on different connections).

import type { Driver, Transaction, Row, TransactionOptions } from '../driver.js'
import { NativeDriverError } from '../errors.js'
import { isolationLevelSql, nestedIsolationError } from '../isolation.js'

/**
 * The structural slice of porsager's `postgres` API we depend on. Typed here
 * (not via `@types`) so the optional peer carries no compile-time dependency —
 * same approach as the better-sqlite3 driver.
 */
interface PgSql {
  /** Run raw SQL with positional ($1, $2, …) params; resolves to the result rows
   *  (empty for statements with no result set). */
  unsafe(query: string, params?: readonly unknown[]): Promise<unknown[]>
  /** Open a transaction; `fn` receives a connection-pinned `sql`. BEGIN/COMMIT,
   *  ROLLBACK on throw. */
  begin<T>(fn: (sql: PgSql) => Promise<T>): Promise<T>
  /** Open a SAVEPOINT inside a transaction; only valid on a transaction `sql`. */
  savepoint<T>(fn: (sql: PgSql) => Promise<T>): Promise<T>
  /** Drain the pool and close all connections. */
  end(options?: { timeout?: number }): Promise<void>
}
type PgFactory = (url: string, options?: Record<string, unknown>) => PgSql

/** Connection config for {@link PostgresDriver.open}. */
export interface PostgresDriverConfig {
  /** Postgres connection string, e.g. `postgres://user:pass@host:5432/db`. */
  url: string
  /** Forwarded to the porsager `postgres()` factory (e.g. `max`, `ssl`). */
  options?: Record<string, unknown>
}

/**
 * A {@link Transaction} scope bound to one porsager `sql` handle — the pool, a
 * transaction, or a savepoint. Every query on the scope runs on that handle, so
 * a transaction-scoped query stays on the transaction's pinned connection.
 */
class PgScope implements Transaction {
  constructor(protected readonly sql: PgSql) {}

  async execute(query: string, bindings: readonly unknown[]): Promise<Row[]> {
    // porsager binds JS booleans / Dates / numbers to their native Postgres
    // types, so no value coercion is needed (unlike the SQLite driver's
    // boolean→0/1 mapping). A no-binding call (DDL) goes through the simple
    // query protocol; statements with no result set resolve to an empty list.
    const rows = bindings.length
      ? await this.sql.unsafe(query, bindings)
      : await this.sql.unsafe(query)
    return rows as Row[]
  }

  // Nested transaction → SAVEPOINT on the current (already-transactional)
  // connection. Reachable only from a scope created inside `begin` (the
  // top-level driver overrides `transaction` to open the BEGIN), so `savepoint`
  // is always valid here. An isolation level is rejected — a savepoint runs
  // inside the open transaction, whose isolation is already fixed.
  async transaction<T>(fn: (tx: Transaction) => Promise<T>, opts?: TransactionOptions): Promise<T> {
    if (opts?.isolationLevel) throw nestedIsolationError()
    return this.sql.savepoint((sp) => fn(new PgScope(sp)))
  }
}

/**
 * {@link Driver} backed by porsager `postgres`. Construct via the static
 * {@link PostgresDriver.open} factory, which lazy-imports the package and
 * validates connectivity up front.
 */
export class PostgresDriver extends PgScope implements Driver {
  private constructor(sql: PgSql) {
    super(sql)
  }

  /**
   * Resolve the `postgres` package, build a pool for `config.url`, validate the
   * connection, and return a ready driver. Throws {@link NativeDriverError} with
   * install guidance when the package is missing, or a connection error when the
   * URL is unreachable — so failures surface at setup, not deep in a request.
   */
  static async open(config: PostgresDriverConfig): Promise<PostgresDriver> {
    let factory: PgFactory
    try {
      // porsager uses `export =`; a dynamic import wraps it in `.default`.
      const mod = await import('postgres') as unknown as { default?: PgFactory }
      factory = mod.default ?? (mod as unknown as PgFactory)
    } catch (err) {
      throw new NativeDriverError(
        `[RudderJS ORM native] Failed to load "postgres". It is an optional peer of ` +
        `@rudderjs/orm — install it with \`pnpm add postgres\` to use the native Postgres engine.`,
        { cause: err },
      )
    }

    // Silence Postgres NOTICEs (e.g. "table does not exist, skipping" on DROP IF
    // EXISTS) so they don't pollute CLI / migration output, and parse int8 /
    // bigserial (OID 20) as a JS number rather than porsager's default string —
    // so a model's auto-increment `id` is a number on Postgres just as it is on
    // SQLite (INTEGER PK → number). Precision caveat: int8 values above 2^53 lose
    // precision; that's fine for auto-increment ids, and a column needing the
    // full int8 range should declare a cast.
    const sql = factory(config.url, {
      onnotice: () => { /* swallow NOTICEs */ },
      types: {
        int8AsNumber: {
          to:        20,
          from:      [20],
          serialize: (x: number | bigint | string) => String(x),
          parse:     (x: string) => parseInt(x, 10),
        },
        // Replace porsager's default `date` type. Its serializer round-trips
        // EVERY bound value through `new Date(x).toISOString()` — and because
        // serializers register for all `from` OIDs, a param the server
        // describes as date/timestamp/timestamptz (1082/1114/1184) hits it
        // even when the JS value is a plain string. `new Date('2026-01-20
        // 11:20:45')` parses as MACHINE-LOCAL time, so bound string timestamps
        // were stored TZ-shifted on any non-UTC machine (silent data
        // corruption; CI is UTC, which hid it). Strings now pass through
        // verbatim — Postgres casts text natively, machine-TZ independent.
        // `Date` values keep the exact previous behavior (`toISOString()`,
        // same instant) and reads keep porsager's default parse (JS `Date`).
        date: {
          to:   1184,
          from: [1082, 1114, 1184],
          serialize: (x: unknown) =>
            x instanceof Date        ? x.toISOString()
            : typeof x === 'number'  ? new Date(x).toISOString()
            : String(x),
          parse: (x: string) => new Date(x),
        },
        // Replace porsager's default `json` type for the same reason as `date`
        // above: its serializer `JSON.stringify`s EVERY bound value a server
        // describes as json/jsonb (114/3802), so an already-stringified JSON
        // param — the pg dialect's `jsonContains` binds `JSON.stringify(value)`,
        // and apps porting sqlite-style code bind JSON text into jsonb columns —
        // was DOUBLE-encoded: `'"php"'` arrived server-side as the JSON string
        // `"\"php\""` and `@>` containment silently matched nothing. Strings now
        // pass through verbatim (Postgres parses the JSON text natively; an
        // invalid document surfaces as a clear server parse error); non-strings
        // keep porsager's `JSON.stringify`, and reads keep its `JSON.parse`.
        json: {
          to:   114,
          from: [114, 3802],
          serialize: (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x)),
          parse: (x: string) => JSON.parse(x) as unknown,
        },
      },
      ...config.options,
    })
    const driver = new PostgresDriver(sql)
    try {
      await sql.unsafe('select 1')
    } catch (err) {
      await sql.end({ timeout: 1 }).catch(() => { /* best effort */ })
      const msg = err instanceof Error ? err.message : String(err)
      throw new NativeDriverError(
        `[RudderJS ORM native] Could not connect to Postgres at the configured URL: ${msg}`,
        { cause: err },
      )
    }
    return driver
  }

  // Top-level transaction → BEGIN/COMMIT (ROLLBACK on throw). porsager's `begin`
  // reserves a connection for the whole scope, so every query inside runs on it.
  // An isolation level is applied via `SET TRANSACTION ISOLATION LEVEL` as the
  // FIRST statement inside the transaction — Postgres allows it any time before
  // the first query, and `isolationLevelSql` validates the level (the keyword is
  // spliced, never bound).
  override async transaction<T>(fn: (tx: Transaction) => Promise<T>, opts?: TransactionOptions): Promise<T> {
    const level = opts?.isolationLevel ? isolationLevelSql(opts.isolationLevel) : null
    return this.sql.begin(async (tx) => {
      if (level) await tx.unsafe(`SET TRANSACTION ISOLATION LEVEL ${level}`)
      return fn(new PgScope(tx))
    })
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 })
  }
}
