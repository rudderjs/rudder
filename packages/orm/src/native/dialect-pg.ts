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
import {
  validateIdentifier,
  quoteValueList,
  type Dialect,
  type DatePart,
  type JsonPathSegment,
  type JsonValueKind,
} from './dialect.js'
import type { ColumnDefinition } from './schema/column.js'

/**
 * Render a pg JSON arrow chain — `col->'a'->'b'`, with the LAST hop as `->>`
 * (text) when `lastAsText`. String segments are single-quoted literals (safe:
 * {@link parseJsonPath} rejected quotes/backslashes); numeric segments splice
 * bare (`->0` = array index — quoting would make pg treat it as an object key).
 */
function pgJsonChain(column: string, segments: readonly JsonPathSegment[], lastAsText: boolean): string {
  return column + segments
    .map((s, i) => {
      const op = lastAsText && i === segments.length - 1 ? '->>' : '->'
      return typeof s === 'number' ? `${op}${s}` : `${op}'${s}'`
    })
    .join('')
}

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

  // Postgres date-component extraction: `::date`/`::time` casts compare against
  // a bound text value (the planner types the parameter from context), and
  // `EXTRACT(... )::int` yields a real integer for `day`/`month`/`year`
  // (EXTRACT alone returns `numeric`, which compares fine, but `::int` keeps
  // the driver-returned value an int for any projection reuse).
  dateExtract(part: DatePart, column: string): string {
    switch (part) {
      case 'date':  return `${column}::date`
      case 'time':  return `${column}::time`
      case 'day':   return `EXTRACT(DAY FROM ${column})::int`
      case 'month': return `EXTRACT(MONTH FROM ${column})::int`
      case 'year':  return `EXTRACT(YEAR FROM ${column})::int`
    }
  }

  // Arrow chain with a text (`->>`) last hop, cast when the comparison value
  // is typed: `::numeric` so `>`/`<` compare numbers (text '10' < '9'),
  // `::boolean` so a bound JS boolean compares ('true'/'false' text coerces).
  // Text comparisons stay uncast — the planner types the parameter from context.
  jsonExtract(column: string, segments: readonly JsonPathSegment[], valueKind: JsonValueKind): string {
    const chain = pgJsonChain(column, segments, true)
    if (valueKind === 'number')  return `(${chain})::numeric`
    if (valueKind === 'boolean') return `(${chain})::boolean`
    return chain
  }

  // The extraction is `::boolean`-cast — bind the JS boolean itself.
  jsonBoolean(value: boolean): unknown {
    return value
  }

  // jsonb containment: `(col->'a')::jsonb @> $n::jsonb`, the value bound as
  // JSON text. The `->` chain (no `->>`) keeps the LHS json; `::jsonb` covers
  // plain-json columns (no-op on jsonb, which our `json` column type maps to).
  jsonContains(column: string, segments: readonly JsonPathSegment[], value: unknown, bind: (v: unknown) => string): string {
    const lhs = segments.length === 0 ? column : pgJsonChain(column, segments, false)
    return `(${lhs})::jsonb @> ${bind(JSON.stringify(value))}::jsonb`
  }

  // jsonb_array_length over the (cast) arrow chain — matches Laravel's pg grammar.
  jsonLength(column: string, segments: readonly JsonPathSegment[]): string {
    const lhs = segments.length === 0 ? column : pgJsonChain(column, segments, false)
    return `jsonb_array_length((${lhs})::jsonb)`
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
      // pg has no tinyint/mediumint — smallint covers tiny/small, integer covers medium.
      case 'tinyInteger':
      case 'smallInteger': return 'smallint'
      case 'mediumInteger': return 'integer'
      // `string` carries a length (Blueprint defaults it to 255); pg honours it.
      case 'string':     return `varchar(${column.length ?? 255})`
      case 'char':       return `char(${column.length ?? 255})`
      // pg has no mediumtext/longtext — `text` is unbounded and covers both.
      case 'text':
      case 'mediumText':
      case 'longText':   return 'text'
      case 'boolean':    return 'boolean'
      case 'date':       return 'date'
      // Optional fractional-seconds precision → time(p); plain time otherwise.
      case 'time':       return column.precision === undefined ? 'time' : `time(${column.precision})`
      // Both dateTime and timestamp map to timestamptz — timezone-aware is the
      // safer default and matches the plan's column-type table.
      case 'dateTime':
      case 'timestamp':  return 'timestamptz'
      // json maps to jsonb (binary, indexable) — the pg-idiomatic default; jsonb
      // is explicit.
      case 'json':
      case 'jsonb':      return 'jsonb'
      case 'uuid':       return 'uuid'
      case 'ulid':       return 'char(26)'
      case 'decimal':    return `numeric(${column.precision ?? 8}, ${column.scale ?? 2})`
      case 'float':      return 'double precision'
      case 'double':     return 'double precision'
      case 'binary':     return 'bytea'
      // pg has no native enum-by-value-list inline; mirror Laravel's pg grammar:
      // a varchar + CHECK (… IN (…)). `set` has no pg equivalent.
      case 'enum':
        return `varchar(255) CHECK (${this.quoteId(column.name)} IN (${quoteValueList(column.enumValues ?? [])}))`
      case 'set':
        throw new NativeOrmError(
          'NATIVE_DDL_UNSUPPORTED_TYPE',
          `[RudderJS ORM native] Postgres has no SET column type ("${column.name}"). Use enum(), a json column, or a join table.`,
        )
      default: {
        // Exhaustiveness guard — a new ColumnType must extend this switch.
        const unreachable: never = column.type
        throw new NativeOrmError('NATIVE_DDL_UNKNOWN_TYPE', `[RudderJS ORM native] No Postgres type mapping for column type ${JSON.stringify(unreachable)}.`)
      }
    }
  }
}
