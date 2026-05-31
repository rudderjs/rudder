// ─── Column definition + chainable builder ─────────────────
//
// PURE: no driver, no `node:`, no I/O. A `ColumnBuilder` records the *intent*
// of one column (type + modifiers) as a plain {@link ColumnDefinition}; the DDL
// compiler turns those intents into SQL per-dialect. This mirrors the read
// path's split — the query builder records state, the compiler emits SQL.
//
// Laravel's `Blueprint` column methods return a fluent column object so
// modifiers chain (`t.string('email').nullable().unique()`); `ColumnBuilder` is
// that object. It mutates its backing definition in place and returns `this`.

/**
 * The portable column types v1 supports — the common 80% (parent plan Part 2).
 * Each dialect maps these to its own SQL type; SQLite's mapping lives in
 * `SqliteDialect.columnTypeSql`. Exotic types (geometry, set, …) are deferred.
 */
export type ColumnType =
  | 'increments'   // auto-incrementing integer primary key
  | 'integer'
  | 'bigInteger'
  | 'string'       // varchar(length) on pg/mysql; TEXT on sqlite
  | 'text'
  | 'boolean'
  | 'dateTime'
  | 'timestamp'
  | 'json'
  | 'uuid'
  | 'decimal'
  | 'float'
  | 'binary'

/**
 * The recorded shape of one column. Built by {@link ColumnBuilder}; consumed by
 * the DDL compiler + the dialect's type mapper. Modifier flags default to the
 * unset state so a bare `t.integer('age')` carries no surprises.
 */
export interface ColumnDefinition {
  name:          string
  type:          ColumnType
  /** `string(name, length)` — kept for pg/mysql `varchar(N)`; SQLite ignores it. */
  length?:       number
  /** `decimal(name, precision, scale)`. */
  precision?:    number
  scale?:        number
  nullable:      boolean
  /** Whether a DEFAULT was set (distinguishes `default(null)` from "no default"). */
  hasDefault:    boolean
  /** The default literal when {@link hasDefault}. DDL defaults are rendered as
   *  literals (most databases reject bound parameters in DDL), so the value is
   *  escaped, not parameterized — safe because migration authors, not end users,
   *  write these. */
  default?:      unknown
  /** `useCurrent()` — `DEFAULT CURRENT_TIMESTAMP`. Takes precedence over `default`. */
  useCurrent:    boolean
  /** Single-column inline `PRIMARY KEY`. Composite PKs go through `Blueprint.primary`. */
  primary:       boolean
  /** Emit a `CREATE UNIQUE INDEX` for this column (Laravel-style separate index). */
  unique:        boolean
  /** Emit a `CREATE INDEX` for this column. */
  index:         boolean
  /** `unsigned()` — recorded for pg/mysql; a no-op on SQLite. */
  unsigned:      boolean
  /** True for `increments()` — the dialect emits the full auto-increment PK
   *  spec, so the compiler skips the other inline modifiers for this column. */
  autoIncrement: boolean
  /** `change()` — in a `Schema.table` alter, modify the existing column rather
   *  than add it. On SQLite this needs the table-rebuild dance (7.4b); the alter
   *  compiler throws a clear "not yet" until then. */
  change:        boolean
}

/**
 * Fluent wrapper over a {@link ColumnDefinition}. Returned by every
 * `Blueprint` column method so modifiers chain Laravel-style. Mutates its
 * backing definition and returns `this`.
 */
export class ColumnBuilder {
  constructor(readonly def: ColumnDefinition) {}

  /** Allow NULLs (columns are `NOT NULL` by default, matching Laravel). */
  nullable(value = true): this {
    this.def.nullable = value
    return this
  }

  /** Set a column default. Pass `null` for a literal `DEFAULT NULL`. */
  default(value: unknown): this {
    this.def.hasDefault = true
    this.def.default = value
    return this
  }

  /** Default this timestamp/dateTime column to `CURRENT_TIMESTAMP`. */
  useCurrent(): this {
    this.def.useCurrent = true
    return this
  }

  /** Mark as the table's (single-column) primary key. */
  primary(): this {
    this.def.primary = true
    return this
  }

  /** Add a unique index over this column. */
  unique(): this {
    this.def.unique = true
    return this
  }

  /** Add a (non-unique) index over this column. */
  index(): this {
    this.def.index = true
    return this
  }

  /** Mark unsigned (pg/mysql); a no-op on SQLite, recorded for portability. */
  unsigned(): this {
    this.def.unsigned = true
    return this
  }

  /** In a `Schema.table` alter, modify this existing column instead of adding it.
   *  (SQLite implements this via a table rebuild — lands in 7.4b.) */
  change(): this {
    this.def.change = true
    return this
  }
}

/** Build a {@link ColumnDefinition} with modifier defaults filled in. */
export function makeColumn(
  name: string,
  type: ColumnType,
  extra: Partial<ColumnDefinition> = {},
): ColumnDefinition {
  return {
    name,
    type,
    nullable:      false,
    hasDefault:    false,
    useCurrent:    false,
    primary:       false,
    unique:        false,
    index:         false,
    unsigned:      false,
    autoIncrement: false,
    change:        false,
    ...extra,
  }
}
