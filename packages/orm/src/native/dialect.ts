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
 * The date/time component a `whereDate`/`whereTime`/`whereDay`/`whereMonth`/
 * `whereYear` predicate extracts from a column before comparing. `date` and
 * `time` compare as strings (`'YYYY-MM-DD'` / `'HH:MM:SS'`); `day`/`month`/
 * `year` compare as integers.
 */
export type DatePart = 'date' | 'time' | 'day' | 'month' | 'year'

/**
 * One step of a JSON arrow path (`meta->prefs->lang`, `meta->items->0`): a
 * validated object key, or a number for an array index (`$[0]` / pg `->0`).
 */
export type JsonPathSegment = string | number

/**
 * The JS type of a JSON comparison value, hinting the dialect's extraction
 * shape: pg casts its text extraction (`::numeric` / `::boolean`) so operators
 * compare typed values; mysql compares booleans against the raw
 * `JSON_EXTRACT` (no `JSON_UNQUOTE`); sqlite ignores the hint (`json_extract`
 * already returns typed values).
 */
export type JsonValueKind = 'text' | 'number' | 'boolean'

/**
 * One JSON path write inside an UPDATE payload (`'meta->prefs->lang': 'en'`
 * → `{ segments: ['prefs', 'lang'], value: 'en' }`), consumed by
 * {@link Dialect.jsonSet}. Segments are validated by {@link parseJsonPath}.
 */
export interface JsonPathWrite {
  segments: readonly JsonPathSegment[]
  value:    unknown
}

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
   * The SQL expression extracting a date/time component from a column — the
   * per-dialect half of `whereDate`/`whereTime`/`whereDay`/`whereMonth`/
   * `whereYear`. `column` arrives ALREADY QUOTED (the compiler runs it through
   * {@link quoteId} first), so the dialect only splices it into its extraction
   * function. The result must compare cleanly against a bound value:
   * `'YYYY-MM-DD'` text for `date`, `'HH:MM:SS'` text for `time`, and an
   * INTEGER for `day`/`month`/`year` (so a bound `5` matches May — dialects
   * whose extractor yields text, like SQLite's `strftime`, must CAST).
   */
  dateExtract(part: DatePart, column: string): string

  /**
   * The SQL expression extracting a JSON path from a column for a scalar
   * comparison — the per-dialect half of `where('meta->prefs->lang', …)`.
   * `column` arrives ALREADY QUOTED (the compiler runs it through
   * {@link quoteId} first); `segments` are validated by {@link parseJsonPath}
   * (quote/backslash/control characters rejected), so the dialect only splices
   * them into its path syntax. `valueKind` hints the comparison value's JS
   * type — see {@link JsonValueKind} for what each dialect does with it.
   */
  jsonExtract(column: string, segments: readonly JsonPathSegment[], valueKind: JsonValueKind): string

  /**
   * Normalize a boolean JSON comparison value for binding, paired with
   * {@link jsonExtract}'s `'boolean'` shape: sqlite `1`/`0` (json_extract
   * yields integers for json booleans), mysql `'true'`/`'false'` (compared
   * against the raw JSON_EXTRACT — MySQL coerces the string via
   * `CAST(… AS JSON)`), pg the boolean itself (the extraction is `::boolean`-cast).
   */
  jsonBoolean(value: boolean): unknown

  /**
   * The containment predicate for `whereJsonContains(column, value)`. `column`
   * arrives quoted; `segments` (possibly empty — a whole-column check)
   * validated. `value` may be a scalar or an array (array = every element
   * contained, matching pg `@>` / mysql `JSON_CONTAINS`). Values are never
   * interpolated — the dialect binds through the `bind` callback (which
   * returns the placeholder for the value it's handed), keeping positional
   * order correct across the statement.
   *
   * - pg: `(col->'a')::jsonb @> $n::jsonb` (value bound as JSON text).
   * - mysql: `JSON_CONTAINS(col, ?, '$."a"')` (value bound as JSON text).
   * - sqlite: emulated via `EXISTS (SELECT 1 FROM json_each(col, '$."a"')
   *   WHERE json_each.value = ?)` per element (AND-joined for arrays) —
   *   scalar elements only; object values throw.
   *
   * The compiler wraps the returned expression in `NOT (…)` for
   * `whereJsonDoesntContain`, so multi-part emulations must self-parenthesize.
   */
  jsonContains(column: string, segments: readonly JsonPathSegment[], value: unknown, bind: (v: unknown) => string): string

  /**
   * The array-length expression for `whereJsonLength(column, op, n)` — the
   * comparison value binds in the compiler. sqlite `json_array_length(col,
   * '$."a"')`, pg `jsonb_array_length((col->'a')::jsonb)`, mysql
   * `JSON_LENGTH(col, '$."a"')`. `segments` may be empty (whole column).
   */
  jsonLength(column: string, segments: readonly JsonPathSegment[]): string

  /**
   * The SET right-hand side writing one or more JSON paths into a single
   * column — the per-dialect half of `update(id, { 'meta->prefs->lang': … })`.
   * `column` arrives ALREADY QUOTED; `writes` carry segments validated by
   * {@link parseJsonPath}. Values are never interpolated — each binds as JSON
   * text (`JSON.stringify`) through the `bind` callback in write order, so
   * positional bindings stay in SQL-text order, and the JSON-text shape keeps
   * every value type (string/number/boolean/null/array/object) round-tripping
   * identically across dialects:
   *
   * - sqlite: `json_set(col, '$."a"', json(?), '$."b"', json(?))`
   * - mysql:  `JSON_SET(col, '$."a"', CAST(? AS JSON), …)`
   * - pg:     nested `jsonb_set((col)::jsonb, ARRAY['a'], $n::jsonb)` (one
   *   wrap per write — jsonb_set takes a single path).
   *
   * Like Laravel's grammars, missing INTERMEDIATE keys are not created (only
   * the leaf key is); a NULL column stays NULL on pg (`jsonb_set(NULL, …)` is
   * NULL) — write the whole column to initialize it.
   */
  jsonSet(column: string, writes: readonly JsonPathWrite[], bind: (v: unknown) => string): string

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
 * Quote a string as a SQL literal (single-quoted, embedded `'` doubled). Used
 * for DDL value lists that can't be bound — `enum`/`set` allowed-value lists and
 * the `CHECK (… IN (…))` constraint on pg/sqlite. Migration-author supplied, so
 * escaping (not an allowlist) is the right boundary, matching the column-DEFAULT
 * literal path in the DDL compiler.
 */
export function quoteSqlString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** Render an `enum`/`set` value list as a `(quoted, list)` for inline use. */
export function quoteValueList(values: readonly string[]): string {
  return values.map(quoteSqlString).join(', ')
}

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

// JSON path segments are user-supplied strings spliced into the SQL text (as
// quoted keys inside a path literal or pg `->'key'` operands), so they're the
// second identifier-like security boundary after `validateIdentifier`. Unlike
// column names they may legitimately contain spaces/dots (`$."a b"` quoting
// handles those), so instead of an allowlist we REJECT the characters that
// could escape the quoting: quotes, backticks, backslashes, and control chars.
// eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
const JSON_SEGMENT_REJECT = /['"`\\\x00-\x1f]/

/**
 * Split a `column->path->to->key` arrow column into the base column and its
 * validated JSON path segments. The column half goes through the normal
 * {@link validateIdentifier} gate at quote time; each path segment is checked
 * against {@link JSON_SEGMENT_REJECT} here. All-digit segments become numeric
 * array indexes (`meta->items->0` → `$[0]` / pg `->0`).
 */
export function parseJsonPath(path: string): { column: string; segments: JsonPathSegment[] } {
  const [column, ...rawSegments] = path.split('->')
  if (!column || rawSegments.length === 0 || rawSegments.some(s => s.length === 0)) {
    throw new NativeOrmError(
      'NATIVE_JSON_PATH_INVALID',
      `[RudderJS ORM native] Malformed JSON path "${path}" — expected column->key[->key…] with non-empty segments.`,
    )
  }
  const segments = rawSegments.map((seg): JsonPathSegment => {
    if (JSON_SEGMENT_REJECT.test(seg)) {
      throw new NativeOrmError(
        'NATIVE_JSON_PATH_SEGMENT',
        `[RudderJS ORM native] JSON path segment ${JSON.stringify(seg)} in "${path}" contains a quote, backslash, backtick, or control character — not allowed (path segments are spliced into SQL text).`,
      )
    }
    return /^\d+$/.test(seg) ? Number(seg) : seg
  })
  return { column, segments }
}

/**
 * Render validated segments as a single-quoted SQL JSON-path literal —
 * `'$."a"."b"[0]'`. Keys are double-quoted inside the path so spaces/dots
 * survive; safe to inline because {@link parseJsonPath} rejected every
 * character that could escape either quoting layer. Shared by the sqlite and
 * mysql dialects (pg uses `->` operator chains instead).
 */
export function jsonPathLiteral(segments: readonly JsonPathSegment[]): string {
  return `'$${segments.map(s => (typeof s === 'number' ? `[${s}]` : `."${s}"`)).join('')}'`
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

  // SQLite stores dates as ISO-8601 text — `strftime` extracts components.
  // `date`/`time` stay text ('YYYY-MM-DD' / 'HH:MM:SS'); `day`/`month`/`year`
  // CAST to INTEGER so a bound number compares (strftime returns zero-padded
  // text like '05', and SQLite never equates TEXT with INTEGER).
  dateExtract(part: DatePart, column: string): string {
    switch (part) {
      case 'date':  return `strftime('%Y-%m-%d', ${column})`
      case 'time':  return `strftime('%H:%M:%S', ${column})`
      case 'day':   return `CAST(strftime('%d', ${column}) AS INTEGER)`
      case 'month': return `CAST(strftime('%m', ${column}) AS INTEGER)`
      case 'year':  return `CAST(strftime('%Y', ${column}) AS INTEGER)`
    }
  }

  // `json_extract` returns typed values (TEXT for strings, INTEGER/REAL for
  // numbers, 1/0 for json booleans, NULL for json null AND missing keys), so
  // the bound value compares directly — no cast, the valueKind hint is unused.
  jsonExtract(column: string, segments: readonly JsonPathSegment[], _valueKind: JsonValueKind): string {
    return `json_extract(${column}, ${jsonPathLiteral(segments)})`
  }

  // json_extract yields INTEGER 1/0 for json true/false — bind the matching int.
  jsonBoolean(value: boolean): unknown {
    return value ? 1 : 0
  }

  // SQLite has no containment operator — emulate per element via json_each:
  // EXISTS (SELECT 1 FROM json_each(col, path) WHERE json_each.value = ?).
  // Array values AND one EXISTS per element (matching pg @> / mysql
  // JSON_CONTAINS "every element contained" semantics). Scalars only — a
  // nested object/array element has no reliable text-equality form here.
  jsonContains(column: string, segments: readonly JsonPathSegment[], value: unknown, bind: (v: unknown) => string): string {
    const target = segments.length === 0 ? column : `${column}, ${jsonPathLiteral(segments)}`
    const elements = Array.isArray(value) ? value : [value]
    const parts = elements.map(v => {
      if (v !== null && typeof v === 'object') {
        throw new NativeOrmError(
          'NATIVE_JSON_CONTAINS_UNSUPPORTED',
          '[RudderJS ORM native] whereJsonContains on SQLite supports scalar values (and arrays of scalars) only — object containment has no json_each equality form. Use whereRaw(...) for structural checks.',
        )
      }
      // json null elements surface as SQL NULL in json_each.value — match on
      // the row's declared type instead (`= NULL` never matches in SQL).
      if (v === null) return `EXISTS (SELECT 1 FROM json_each(${target}) WHERE "json_each"."type" = 'null')`
      const bound = typeof v === 'boolean' ? (v ? 1 : 0) : v
      return `EXISTS (SELECT 1 FROM json_each(${target}) WHERE "json_each"."value" = ${bind(bound)})`
    })
    return parts.length === 1 ? (parts[0] as string) : `(${parts.join(' AND ')})`
  }

  // json_array_length takes the path directly as its second argument.
  jsonLength(column: string, segments: readonly JsonPathSegment[]): string {
    return segments.length === 0
      ? `json_array_length(${column})`
      : `json_array_length(${column}, ${jsonPathLiteral(segments)})`
  }

  // json_set takes (path, value) varargs — one call covers every write on the
  // column. `json(?)` parses the bound JSON text so all value types (string/
  // number/boolean/null/array/object) land as real JSON values, not text.
  jsonSet(column: string, writes: readonly JsonPathWrite[], bind: (v: unknown) => string): string {
    const args = writes
      .map(w => `${jsonPathLiteral(w.segments)}, json(${bind(JSON.stringify(w.value))})`)
      .join(', ')
    return `json_set(${column}, ${args})`
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
      case 'tinyInteger':
      case 'smallInteger':
      case 'mediumInteger':
      case 'boolean':
        return 'INTEGER'
      case 'string':
      case 'char':
      case 'text':
      case 'mediumText':
      case 'longText':
      case 'uuid':
      case 'ulid':
      case 'json':
      case 'jsonb':
      case 'date':
      case 'time':
      case 'dateTime':
      case 'timestamp':
        return 'TEXT'
      case 'float':
      case 'double':
        return 'REAL'
      case 'decimal':
        return 'NUMERIC'
      case 'binary':
        return 'BLOB'
      // SQLite has no enum/set type. Mirror Laravel's SQLite grammar: a TEXT
      // column with a CHECK (… IN (…)) constraint. `set` genuinely has no
      // single-column equivalent (multiple values), so it's unsupported.
      case 'enum':
        return `TEXT CHECK (${this.quoteId(column.name)} IN (${quoteValueList(column.enumValues ?? [])}))`
      case 'set':
        throw new NativeOrmError(
          'NATIVE_DDL_UNSUPPORTED_TYPE',
          `[RudderJS ORM native] SQLite has no SET column type ("${column.name}"). Use enum(), a json column, or a pivot table.`,
        )
      default: {
        // Exhaustiveness guard — a new ColumnType must extend this switch.
        const unreachable: never = column.type
        throw new NativeOrmError('NATIVE_DDL_UNKNOWN_TYPE', `[RudderJS ORM native] No SQLite type mapping for column type ${JSON.stringify(unreachable)}.`)
      }
    }
  }
}
