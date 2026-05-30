// ─── Dialect seam (per-SQL-flavor) ─────────────────────────
//
// The `Dialect` captures every place the SQL TEXT differs between databases:
// identifier quoting, placeholder syntax, RETURNING support, etc. The compiler
// builds SQL strings through this interface only, so adding Postgres / MySQL
// later (Phases 5–6) is a new `Dialect` — not a compiler rewrite.
//
// This module is PURE — string building only. No `node:`, no driver, no I/O.

import { NativeIdentifierError } from './errors.js'

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
}
