// ─── Transaction isolation levels ──────────────────────────
//
// Shared by the Postgres + MySQL drivers: maps the lowercase ANSI level names
// from `@rudderjs/contracts` (`TransactionIsolationLevel`) to the SQL keywords
// for `SET TRANSACTION ISOLATION LEVEL …`. The map doubles as a validation
// gate — the level is spliced into SQL text (it can't be bound), so an unknown
// string MUST throw rather than reach the statement. Pure: no `node:` import.

import type { TransactionIsolationLevel } from '@rudderjs/contracts'

const ISOLATION_SQL: Record<TransactionIsolationLevel, string> = {
  'read uncommitted': 'READ UNCOMMITTED',
  'read committed':   'READ COMMITTED',
  'repeatable read':  'REPEATABLE READ',
  'serializable':     'SERIALIZABLE',
}

/**
 * The SQL keyword form of an isolation level (`'repeatable read'` →
 * `'REPEATABLE READ'`). Throws on any value outside the
 * {@link TransactionIsolationLevel} union — the result is spliced into a
 * `SET TRANSACTION ISOLATION LEVEL` statement, never bound, so this lookup is
 * the injection boundary.
 */
export function isolationLevelSql(level: TransactionIsolationLevel): string {
  const sql = ISOLATION_SQL[level]
  if (!sql) {
    throw new Error(
      `[RudderJS ORM native] Unknown transaction isolation level ${JSON.stringify(level)} — ` +
      `expected 'read uncommitted', 'read committed', 'repeatable read', or 'serializable'.`,
    )
  }
  return sql
}

/** The error thrown when a nested transaction (SAVEPOINT) is asked to change
 *  isolation level — a savepoint runs inside the enclosing transaction, whose
 *  isolation is already fixed. */
export function nestedIsolationError(): Error {
  return new Error(
    '[RudderJS ORM native] isolationLevel cannot be set on a nested transaction — ' +
    'a nested call maps to a SAVEPOINT inside the open transaction, whose isolation ' +
    'level is already fixed. Set it on the outermost transaction() call.',
  )
}
