// ─── DB facade ─────────────────────────────────────────────
//
// Laravel-style raw-SQL entry point: `DB.select / insert / update / delete /
// statement / raw`. It resolves the active ORM adapter (via the registry bridge)
// and maps onto the adapter's raw-exec seam:
//   - reads  (select)                       → adapter.selectRaw  → Row[]
//   - writes (insert/update/delete/statement) → adapter.affectingStatement → number
//
// One adapter instance is shared with the Models — no second connection. If the
// active adapter doesn't implement the seam (older/partial adapters), each method
// throws a clear error naming that adapter.

import type { OrmAdapter, Row } from '@rudderjs/contracts'
import { resolveAdapter } from './registry-bridge.js'
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

  /** Wrap a literal SQL fragment so the query layer splices it verbatim. */
  raw(value: string | number): Expression {
    return raw(value)
  },
} as const
