// ─── Dialect seam (per-SQL-flavor) ─────────────────────────
//
// The `Dialect` captures every place the SQL TEXT differs between databases:
// identifier quoting, placeholder syntax, RETURNING support, etc. The compiler
// builds SQL strings through this interface only, so adding Postgres / MySQL
// later (Phases 5–6) is a new `Dialect` — not a compiler rewrite.
//
// This module is PURE — string building only. No `node:`, no driver, no I/O.

import { NativeIdentifierError, NativeOrmError } from './errors.js'
import type { ColumnDefinition } from './schema/column.js'

/**
 * A SQL dialect: the knobs that change the emitted SQL text between databases.
 * `SqliteDialect` is the first concrete impl; `PgDialect` / `MysqlDialect`
 * plug in here later.
 */
export interface Dialect {
  /** Short dialect tag — drives any capability branching in the compiler. */
  readonly name: 'sqlite' | 'pg' | 'mysql'

  /**
   * Quote a single identifier (table or column). The identifier is validated
   * first (letters/digits/underscores only, not starting with a digit) and
   * then wrapped in the dialect's quote character so reserved words and casing
   * survive. Dotted identifiers (`table.column`) are quoted segment-by-segment.
   *
   * Identifiers can't be bound as parameters, so this is the security boundary
   * for the only user-influenced text that reaches the SQL string.
   */
  quoteId(identifier: string): string

  /**
   * Positional placeholder for the value at zero-based `index`. SQLite/MySQL
   * use a literal `?` (index ignored); Postgres uses `$1`, `$2`, … (1-based).
   */
  placeholder(index: number): string

  /** Whether the dialect supports `INSERT/UPDATE/DELETE ... RETURNING`.
   *  Unused on the read path; defined now so Phase 2 branches on the seam. */
  readonly supportsReturning: boolean

  /**
   * DDL: the SQL fragment that follows a quoted column name in `CREATE TABLE` —
   * the dialect's storage type plus any type-bundled clause. For an
   * auto-incrementing column the dialect returns the *complete* spec
   * (SQLite: `INTEGER PRIMARY KEY AUTOINCREMENT`; pg: `bigserial PRIMARY KEY`),
   * and the DDL compiler appends no further modifiers to it. For every other
   * column it returns just the type keyword and the compiler appends the shared
   * `NOT NULL` / `DEFAULT` / `PRIMARY KEY` modifiers.
   *
   * This is the per-dialect half of the schema builder (parent plan Part 2's
   * column-type table); pg/mysql implement the same method.
   */
  columnTypeSql(column: ColumnDefinition): string

  /**
   * Render a `boolean` column DEFAULT as a SQL literal. DDL can't bind values,
   * so the DDL compiler asks the dialect how to spell a boolean default: SQLite
   * and MySQL store booleans as `0`/`1` integers, but Postgres has a real
   * `boolean` type that rejects `DEFAULT 1` and wants `DEFAULT true`/`false`.
   * This is the only spot in `defaultLiteral` that diverges per dialect.
   */
  booleanLiteral(value: boolean): string

  /**
   * The conflict-resolution suffix appended to an `INSERT … VALUES …` for an
   * upsert (before any `RETURNING`). Diverges sharply per dialect:
   *
   * - SQLite / Postgres: `ON CONFLICT (<uniqueBy>) DO UPDATE SET col = excluded.col, …`
   *   (or `… DO NOTHING` when `update` is empty). The conflict target is the
   *   `uniqueBy` columns; a matching unique index/constraint must exist.
   * - MySQL: `ON DUPLICATE KEY UPDATE col = VALUES(col), …`. MySQL keys off any
   *   existing unique index, so `uniqueBy` is ignored here (the caller still
   *   needs the unique constraint to exist). An empty `update` degrades to a
   *   no-op assignment on the first `uniqueBy` column so the row is left intact.
   *
   * `uniqueBy` and `update` are already-resolved, validated column-name arrays
   * (the Model layer computes the default `update` set). Values are never
   * interpolated here — only identifiers, quoted via {@link quoteId}.
   */
  upsertClause(uniqueBy: readonly string[], update: readonly string[]): string

  /**
   * The pessimistic-locking suffix appended to a `SELECT` (after ORDER BY /
   * LIMIT), or `''` when the dialect has no row-level locking. Powers
   * `QueryBuilder.lockForUpdate()` / `sharedLock()`:
   *
   * - Postgres / MySQL 8: `' FOR UPDATE'` / `' FOR SHARE'`.
   * - SQLite: `''` — there is no per-row lock; a write transaction already
   *   serializes writers, so the reservation is safe without a suffix.
   *
   * Always prefixed with a leading space so the compiler can concatenate it
   * unconditionally.
   */
  lockSql(mode: 'update' | 'shared'): string
}

// Strict identifier allowlist. Anything outside it is rejected rather than
// escaped — the ORM only ever feeds column/table names here, so a value with
// quotes, spaces, or SQL meta-characters means a bug or an injection attempt.
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Validate a (possibly dotted) identifier and return its segments. Throws
 * {@link NativeIdentifierError} on anything that isn't a plain
 * `[letter|_][letter|digit|_]*` per dot-separated segment.
 */
export function validateIdentifier(identifier: string): string[] {
  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new NativeIdentifierError(String(identifier))
  }
  const segments = identifier.split('.')
  for (const seg of segments) {
    if (!SEGMENT.test(seg)) throw new NativeIdentifierError(identifier)
  }
  return segments
}

/** SQLite dialect — `"`-quoted identifiers, `?` placeholders, RETURNING since
 *  3.35. Also the dialect used by libsql/Turso (Phase 6). */
export class SqliteDialect implements Dialect {
  readonly name = 'sqlite' as const
  readonly supportsReturning = true

  quoteId(identifier: string): string {
    const segments = validateIdentifier(identifier)
    // Double any embedded `"` defensively; the allowlist already forbids them,
    // so this is belt-and-suspenders for the quoting itself.
    return segments.map(s => `"${s.replace(/"/g, '""')}"`).join('.')
  }

  placeholder(_index: number): string {
    return '?'
  }

  // SQLite has no boolean type; booleans round-trip as 0/1 integers, so a
  // boolean default renders as the matching integer literal.
  booleanLiteral(value: boolean): string {
    return value ? '1' : '0'
  }

  // SQLite has no row-level pessimistic lock — a write transaction (BEGIN
  // IMMEDIATE) already serializes writers, so the queue reservation is safe
  // without a `FOR UPDATE` suffix. No-op.
  lockSql(_mode: 'update' | 'shared'): string {
    return ''
  }

  // SQLite + Postgres share the ON CONFLICT (target) DO UPDATE / DO NOTHING form,
  // referencing the rejected row's values via the `excluded` pseudo-table.
  upsertClause(uniqueBy: readonly string[], update: readonly string[]): string {
    const target = uniqueBy.map(c => this.quoteId(c)).join(', ')
    if (update.length === 0) return `ON CONFLICT (${target}) DO NOTHING`
    const sets = update.map(c => `${this.quoteId(c)} = excluded.${this.quoteId(c)}`).join(', ')
    return `ON CONFLICT (${target}) DO UPDATE SET ${sets}`
  }

  // SQLite has a small set of storage classes and no real type checking, so the
  // mapping is coarse: TEXT for anything string-ish, INTEGER for ints/booleans,
  // REAL/NUMERIC for floats/decimals, BLOB for binary. `length`/`precision` are
  // recorded on the column for pg/mysql but carry no meaning in SQLite types.
  columnTypeSql(column: ColumnDefinition): string {
    if (column.autoIncrement) {
      // SQLite bundles the PK into the type: an INTEGER PRIMARY KEY column is the
      // rowid alias, and AUTOINCREMENT prevents id reuse. The compiler appends
      // nothing else to this.
      return 'INTEGER PRIMARY KEY AUTOINCREMENT'
    }
    switch (column.type) {
      case 'increments': // only reached if an increments column isn't auto (defensive)
      case 'integer':
      case 'bigInteger':
      case 'boolean':
        return 'INTEGER'
      case 'string':
      case 'text':
      case 'uuid':
      case 'json':
      case 'dateTime':
      case 'timestamp':
        return 'TEXT'
      case 'float':
        return 'REAL'
      case 'decimal':
        return 'NUMERIC'
      case 'binary':
        return 'BLOB'
      default: {
        // Exhaustiveness guard — a new ColumnType must extend this switch.
        const unreachable: never = column.type
        throw new NativeOrmError('NATIVE_DDL_UNKNOWN_TYPE', `[RudderJS ORM native] No SQLite type mapping for column type ${JSON.stringify(unreachable)}.`)
      }
    }
  }
}
