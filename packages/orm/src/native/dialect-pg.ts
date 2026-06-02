// ─── Postgres dialect (per-SQL-flavor) ─────────────────────
//
// The Postgres half of the {@link Dialect} seam (Phase 7.7). PURE — string
// building only, no `node:`, no driver, no I/O; the Postgres `Driver`
// (`drivers/postgres.ts`) and information_schema introspection live elsewhere.
//
// Postgres is the richest dialect: real `boolean`, `jsonb`, `timestamptz`,
// native `uuid`/`bytea`, sequence-backed `bigserial` identity, and `$n`
// positional placeholders. Identifiers are double-quoted (same as SQLite) and
// validated through the shared {@link validateIdentifier} security gate.

import { NativeOrmError } from './errors.js'
import { validateIdentifier, type Dialect } from './dialect.js'
import type { ColumnDefinition } from './schema/column.js'

/**
 * Postgres {@link Dialect} — `"`-quoted identifiers, `$1`/`$2`/… placeholders,
 * `RETURNING` supported. Maps the portable {@link ColumnDefinition} types to
 * Postgres storage types (parent plan Part 2's column-type table).
 */
export class PgDialect implements Dialect {
  readonly name = 'pg' as const
  readonly supportsReturning = true

  quoteId(identifier: string): string {
    const segments = validateIdentifier(identifier)
    // Postgres folds unquoted identifiers to lowercase, so we always quote to
    // preserve casing and let reserved words through. Double any embedded `"`
    // defensively — the allowlist already forbids them.
    return segments.map(s => `"${s.replace(/"/g, '""')}"`).join('.')
  }

  // Postgres uses 1-based positional placeholders ($1, $2, …); the query
  // compiler feeds a zero-based index.
  placeholder(index: number): string {
    return `$${index + 1}`
  }

  // Postgres has a real boolean type — `DEFAULT 1` is a type error; it wants the
  // `true`/`false` keyword.
  booleanLiteral(value: boolean): string {
    return value ? 'true' : 'false'
  }

  // Real row-level pessimistic locking — the suffix trails ORDER BY / LIMIT.
  // `FOR UPDATE` blocks concurrent writers; `FOR SHARE` blocks only writers.
  lockSql(mode: 'update' | 'shared'): string {
    return mode === 'shared' ? ' FOR SHARE' : ' FOR UPDATE'
  }

  // Postgres shares SQLite's `ON CONFLICT (target) DO UPDATE`/`DO NOTHING` form,
  // referencing the rejected row via the `excluded` pseudo-table.
  upsertClause(uniqueBy: readonly string[], update: readonly string[]): string {
    const target = uniqueBy.map(c => this.quoteId(c)).join(', ')
    if (update.length === 0) return `ON CONFLICT (${target}) DO NOTHING`
    const sets = update.map(c => `${this.quoteId(c)} = excluded.${this.quoteId(c)}`).join(', ')
    return `ON CONFLICT (${target}) DO UPDATE SET ${sets}`
  }

  columnTypeSql(column: ColumnDefinition): string {
    if (column.autoIncrement) {
      // `bigserial` is the sequence-backed auto-increment column; bundling the
      // PRIMARY KEY here means the compiler appends no further modifiers (matching
      // the SqliteDialect contract for auto-increment columns).
      return 'bigserial PRIMARY KEY'
    }
    switch (column.type) {
      // A non-auto `increments` column is defensive (Blueprint always sets
      // autoIncrement on increments) — fall back to a plain `serial`.
      case 'increments': return 'serial'
      case 'integer':    return 'integer'
      case 'bigInteger': return 'bigint'
      // `string` carries a length (Blueprint defaults it to 255); pg honours it.
      case 'string':     return `varchar(${column.length ?? 255})`
      case 'text':       return 'text'
      case 'boolean':    return 'boolean'
      // Both dateTime and timestamp map to timestamptz — timezone-aware is the
      // safer default and matches the plan's column-type table.
      case 'dateTime':
      case 'timestamp':  return 'timestamptz'
      case 'json':       return 'jsonb'
      case 'uuid':       return 'uuid'
      case 'decimal':    return `numeric(${column.precision ?? 8}, ${column.scale ?? 2})`
      case 'float':      return 'double precision'
      case 'binary':     return 'bytea'
      default: {
        // Exhaustiveness guard — a new ColumnType must extend this switch.
        const unreachable: never = column.type
        throw new NativeOrmError('NATIVE_DDL_UNKNOWN_TYPE', `[RudderJS ORM native] No Postgres type mapping for column type ${JSON.stringify(unreachable)}.`)
      }
    }
  }
}
