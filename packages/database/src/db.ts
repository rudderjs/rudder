// ─── DB facade ─────────────────────────────────────────────
//
// Laravel-style raw-SQL entry point: `DB.select / insert / update / delete /
// statement / raw / listen`. It resolves the active ORM adapter (via the
// registry bridge) and maps onto the adapter's raw-exec seam:
//   - reads  (select)                       → adapter.selectRaw  → Row[]
//   - writes (insert/update/delete/statement) → adapter.affectingStatement → number
//   - query listening (listen)              → adapter.onQuery
//
// One adapter instance is shared with the Models — no second connection. If the
// active adapter doesn't implement the seam (older/partial adapters), each method
// throws a clear error naming that adapter.

import type { OrmAdapter, QueryListener, Row, TransactionOptions } from '@rudderjs/contracts'
import {
  resolveAdapter,
  resolveTransactionRunner,
  resolveConnectionResolver,
  resolveNamedTransactionRunner,
} from './registry-bridge.js'
import { Expression, raw } from './expression.js'

function adapterName(adapter: OrmAdapter): string {
  return adapter.constructor?.name ?? 'the active adapter'
}

function requireSelectRaw(adapter: OrmAdapter): NonNullable<OrmAdapter['selectRaw']> {
  if (typeof adapter.selectRaw !== 'function') {
    throw new Error(
      `[RudderJS DB] ${adapterName(adapter)} does not implement selectRaw() — ` +
        'this adapter cannot run raw DB.select() queries.',
    )
  }
  return adapter.selectRaw.bind(adapter)
}

function requireAffecting(adapter: OrmAdapter): NonNullable<OrmAdapter['affectingStatement']> {
  if (typeof adapter.affectingStatement !== 'function') {
    throw new Error(
      `[RudderJS DB] ${adapterName(adapter)} does not implement affectingStatement() — ` +
        'this adapter cannot run raw DB.insert()/update()/delete()/statement() calls.',
    )
  }
  return adapter.affectingStatement.bind(adapter)
}

function requireOnQuery(adapter: OrmAdapter): NonNullable<OrmAdapter['onQuery']> {
  if (typeof adapter.onQuery !== 'function') {
    throw new Error(
      `[RudderJS DB] ${adapterName(adapter)} does not implement onQuery() — ` +
        'this adapter does not support query listening, so DB.listen() has nothing to hook into.',
    )
  }
  return adapter.onQuery.bind(adapter)
}

/**
 * A scoped facade over one NAMED connection — what `DB.connection('reporting')`
 * returns. Same raw-SQL surface as `DB`, resolved against that connection's
 * adapter (opened lazily on first use). One divergence from the root facade:
 * `listen()` is async here, because attaching the listener may first open the
 * connection.
 */
export interface DBConnection {
  select(sql: string, bindings?: readonly unknown[]): Promise<Row[]>
  insert(sql: string, bindings?: readonly unknown[]): Promise<number>
  update(sql: string, bindings?: readonly unknown[]): Promise<number>
  delete(sql: string, bindings?: readonly unknown[]): Promise<number>
  statement(sql: string, bindings?: readonly unknown[]): Promise<number>
  transaction<T>(fn: () => Promise<T>, opts?: TransactionOptions): Promise<T>
  listen(listener: QueryListener): Promise<void>
}

/**
 * The DB facade. Raw-SQL escape hatch over the active ORM adapter, mirroring
 * Laravel's `DB` facade. All methods take positional `bindings` (`?` / `$n`
 * placeholders) — values are never string-interpolated into `sql`.
 */
// `async` (not bare `return`) so a missing-adapter / missing-seam guard throws
// as a rejected promise rather than synchronously — the facade always presents a
// Promise-returning contract, so callers can `.catch()` / `await assert.rejects`.
export const DB = {
  /** Run a raw `SELECT` and resolve to the matched rows. */
  async select(sql: string, bindings: readonly unknown[] = []): Promise<Row[]> {
    return requireSelectRaw(resolveAdapter())(sql, bindings)
  },

  /** Run a raw `INSERT`. Resolves to the number of rows affected. */
  async insert(sql: string, bindings: readonly unknown[] = []): Promise<number> {
    return requireAffecting(resolveAdapter())(sql, bindings)
  },

  /** Run a raw `UPDATE`. Resolves to the number of rows affected. */
  async update(sql: string, bindings: readonly unknown[] = []): Promise<number> {
    return requireAffecting(resolveAdapter())(sql, bindings)
  },

  /** Run a raw `DELETE`. Resolves to the number of rows affected. */
  async delete(sql: string, bindings: readonly unknown[] = []): Promise<number> {
    return requireAffecting(resolveAdapter())(sql, bindings)
  },

  /** Run an arbitrary raw statement (DDL, etc.). Resolves to rows affected. */
  async statement(sql: string, bindings: readonly unknown[] = []): Promise<number> {
    return requireAffecting(resolveAdapter())(sql, bindings)
  },

  /**
   * Run `fn` inside a database transaction, mirroring Laravel's `DB::transaction`.
   * Every `Model.*` and `DB.*` call issued inside `fn` runs on the *same* open
   * transaction — the runner (pushed in by `@rudderjs/orm`) threads the
   * transaction-scoped adapter through `AsyncLocalStorage`, so no connection is
   * passed around. Commits when `fn` resolves; rolls back and re-throws if it
   * rejects. Nested `DB.transaction()` / `Model.transaction()` calls map to
   * savepoints where the driver supports them.
   *
   * `opts.isolationLevel` sets the transaction's isolation level (`'read
   * uncommitted' | 'read committed' | 'repeatable read' | 'serializable'`) —
   * outermost call only; SQLite-backed adapters throw (no isolation levels).
   *
   * @throws if no transaction runner is registered (no database provider loaded),
   *   or if the active adapter doesn't implement `transaction()`.
   */
  async transaction<T>(fn: () => Promise<T>, opts?: TransactionOptions): Promise<T> {
    return resolveTransactionRunner()(fn, opts)
  },

  /**
   * Register a query listener, mirroring Laravel's `DB::listen`. The listener
   * fires once per executed query with `{ sql, bindings, duration }` (duration
   * in ms) — use it for app-level query logging or slow-query alerting.
   * Delegates to the active adapter's `onQuery()` hook; listener errors are
   * swallowed by the adapter and never break the query.
   *
   * Synchronous, unlike the exec methods — registration happens immediately
   * against the adapter resolved at call time.
   *
   * @throws if no adapter is registered, or the active adapter doesn't
   *   implement query listening (`onQuery`).
   */
  listen(listener: QueryListener): void {
    requireOnQuery(resolveAdapter())(listener)
  },

  /** Wrap a literal SQL fragment so the query layer splices it verbatim. */
  raw(value: string | number): Expression {
    return raw(value)
  },

  /**
   * A facade scoped to a NAMED connection from `config/database.ts`'s
   * `connections` map, mirroring Laravel's `DB::connection('name')`. The
   * connection opens lazily on the first executed call (cheap to call this
   * method itself — it resolves nothing). Inside a `transaction(fn,
   * { connection: name })` callback, calls on the matching scoped facade join
   * that open transaction.
   *
   * @example
   * const rows = await DB.connection('reporting').select('select * from stats')
   * await DB.connection('reporting').transaction(async () => { ... })
   */
  connection(name: string): DBConnection {
    const adapterFor = async (): Promise<OrmAdapter> => resolveConnectionResolver()(name)
    return {
      async select(sql, bindings = []) {
        return requireSelectRaw(await adapterFor())(sql, bindings)
      },
      async insert(sql, bindings = []) {
        return requireAffecting(await adapterFor())(sql, bindings)
      },
      async update(sql, bindings = []) {
        return requireAffecting(await adapterFor())(sql, bindings)
      },
      async delete(sql, bindings = []) {
        return requireAffecting(await adapterFor())(sql, bindings)
      },
      async statement(sql, bindings = []) {
        return requireAffecting(await adapterFor())(sql, bindings)
      },
      async transaction(fn, opts) {
        return resolveNamedTransactionRunner()(name, fn, opts)
      },
      async listen(listener) {
        requireOnQuery(await adapterFor())(listener)
      },
    }
  },
} as const
