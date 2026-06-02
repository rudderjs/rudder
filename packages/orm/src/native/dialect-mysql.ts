// ─── MySQL dialect (per-SQL-flavor) ────────────────────────
//
// The MySQL half of the {@link Dialect} seam (Phase 7.8). PURE — string building
// only, no `node:`, no driver, no I/O; the MySQL `Driver` (`drivers/mysql.ts`)
// and information_schema introspection live elsewhere.
//
// MySQL diverges from Postgres in three load-bearing ways the rest of the engine
// branches on:
//   - **No `RETURNING`** (`supportsReturning = false`). MySQL 8 can't return the
//     written rows, so the query builder takes its no-RETURNING path: reads the
//     auto-increment id / affected-row count from the driver's result metadata
//     (see `AffectingExecutor` in `driver.js`) and re-SELECTs by primary key.
//   - **Backtick identifier quoting** (`` `id` ``), not double quotes.
//   - **No real boolean type** — booleans store as `tinyint(1)` integers, so a
//     boolean default renders as `1`/`0` (same as SQLite).

import { NativeOrmError } from './errors.js'
import { validateIdentifier, type Dialect } from './dialect.js'
import type { ColumnDefinition } from './schema/column.js'

/**
 * MySQL {@link Dialect} — backtick-quoted identifiers, `?` placeholders, and
 * **no** `RETURNING`. Maps the portable {@link ColumnDefinition} types to MySQL
 * storage types (parent plan Part 2's column-type table).
 */
export class MysqlDialect implements Dialect {
  readonly name = 'mysql' as const
  // MySQL 8 has no INSERT/UPDATE/DELETE ... RETURNING. The query builder reads
  // write results from the driver's metadata instead (AffectingExecutor).
  readonly supportsReturning = false

  quoteId(identifier: string): string {
    const segments = validateIdentifier(identifier)
    // MySQL quotes with backticks. Double any embedded backtick defensively —
    // the allowlist already forbids them.
    return segments.map(s => `\`${s.replace(/`/g, '``')}\``).join('.')
  }

  // MySQL uses literal `?` positional placeholders (index ignored), like SQLite.
  placeholder(_index: number): string {
    return '?'
  }

  // MySQL has no boolean type — `BOOLEAN` is an alias for `tinyint(1)`, stored as
  // an integer. A boolean default renders as the matching integer literal (the
  // `boolean` cast reads `0`/`1` back), same as SQLite.
  booleanLiteral(value: boolean): string {
    return value ? '1' : '0'
  }

  // MySQL has no ON CONFLICT target — it keys off whatever unique index the row
  // collides with, so `uniqueBy` is ignored. `VALUES(col)` references the would-be
  // inserted value (deprecated in 8.0.20+ but still supported and the widely
  // compatible form). An empty `update` degrades to a no-op self-assignment on the
  // first uniqueBy column so a conflicting row is left untouched (insert-or-ignore).
  upsertClause(uniqueBy: readonly string[], update: readonly string[]): string {
    const cols = update.length > 0 ? update : uniqueBy.slice(0, 1)
    const sets = cols.map(c => `${this.quoteId(c)} = VALUES(${this.quoteId(c)})`).join(', ')
    return `ON DUPLICATE KEY UPDATE ${sets}`
  }

  columnTypeSql(column: ColumnDefinition): string {
    if (column.autoIncrement) {
      // MySQL requires an AUTO_INCREMENT column to be a key; bundling PRIMARY KEY
      // here means the compiler appends no further modifiers (matching the
      // SqliteDialect / PgDialect contract for auto-increment columns). Signed
      // `bigint` (not UNSIGNED) so it matches `bigInteger` foreign keys — MySQL
      // rejects an FK whose signedness differs from the referenced column.
      return 'bigint AUTO_INCREMENT PRIMARY KEY'
    }
    switch (column.type) {
      // A non-auto `increments` column is defensive (Blueprint always sets
      // autoIncrement on increments) — fall back to a plain int.
      case 'increments': return 'int'
      case 'integer':    return 'int'
      case 'bigInteger': return 'bigint'
      // `string` carries a length (Blueprint defaults it to 255); MySQL honours it.
      case 'string':     return `varchar(${column.length ?? 255})`
      case 'text':       return 'text'
      // BOOLEAN is a tinyint(1) alias; spell it out so introspection reads
      // `tinyint` and a `boolean` cast refines it back to `boolean`.
      case 'boolean':    return 'tinyint(1)'
      // MySQL distinguishes datetime (no tz, full range) from timestamp (UTC,
      // 1970–2038, auto-update quirks). Map the portable types straight across.
      case 'dateTime':   return 'datetime'
      case 'timestamp':  return 'timestamp'
      case 'json':       return 'json'
      // MySQL has no native UUID type — store as a fixed-width char(36).
      case 'uuid':       return 'char(36)'
      case 'decimal':    return `decimal(${column.precision ?? 8}, ${column.scale ?? 2})`
      case 'float':      return 'double'
      case 'binary':     return 'blob'
      default: {
        // Exhaustiveness guard — a new ColumnType must extend this switch.
        const unreachable: never = column.type
        throw new NativeOrmError('NATIVE_DDL_UNKNOWN_TYPE', `[RudderJS ORM native] No MySQL type mapping for column type ${JSON.stringify(unreachable)}.`)
      }
    }
  }
}
