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

import { NativeOrmError } from '../errors.js'

/**
 * The referential actions a foreign key may take on `ON DELETE` / `ON UPDATE`.
 * Stored in the canonical SQL-keyword-lowercase form; the compiler upper-cases
 * it (`'set null'` → `SET NULL`). camelCase aliases (`setNull` / `noAction`) are
 * accepted at the call site and normalized here.
 */
export type ForeignKeyAction = 'cascade' | 'restrict' | 'set null' | 'no action'

/** What callers may pass to `onDelete` / `onUpdate` — the canonical forms plus
 *  the camelCase aliases Laravel users reach for. */
export type ForeignKeyActionInput = ForeignKeyAction | 'setNull' | 'noAction'

/** A recorded foreign-key intent. Built by `ColumnBuilder.constrained()` /
 *  `.references().on()` (column-level) or `Blueprint.foreign()` (table-level);
 *  rendered as a `FOREIGN KEY` table constraint by the DDL compiler. */
export interface ForeignKeyDefinition {
  /** Local column(s) the constraint covers. */
  columns:    string[]
  /** Referenced column(s) on the foreign table. Defaults to `['id']`. */
  references: string[]
  /** Referenced table. Required at compile time — `constrained()` infers it,
   *  `.on(...)` sets it explicitly. Empty until one of those runs. */
  on:         string
  onDelete?:  ForeignKeyAction
  onUpdate?:  ForeignKeyAction
  /** Explicit constraint name; defaults to `{table}_{col[_col…]}_foreign`. */
  name?:      string
}

const FK_ACTIONS: Record<string, ForeignKeyAction> = {
  'cascade':   'cascade',
  'restrict':  'restrict',
  'set null':  'set null',
  'setnull':   'set null',
  'no action': 'no action',
  'noaction':  'no action',
}

/**
 * Validate a referential action against the allowlist and normalize it to its
 * canonical form. Accepts the SQL forms (`'set null'`) and the camelCase aliases
 * (`'setNull'`). Throws {@link NativeOrmError} on anything else so arbitrary text
 * never reaches the `ON DELETE` / `ON UPDATE` clause (DDL can't bind values).
 */
export function normalizeForeignKeyAction(input: string): ForeignKeyAction {
  const action = FK_ACTIONS[String(input).trim().toLowerCase()]
  if (!action) {
    throw new NativeOrmError(
      'NATIVE_DDL_BAD_FK_ACTION',
      `[RudderJS ORM native] Invalid foreign-key action ${JSON.stringify(input)}. ` +
      `Use one of: cascade, restrict, set null (setNull), no action (noAction).`,
    )
  }
  return action
}

/** Laravel-style table inference for `constrained()`: strip a trailing `_id` /
 *  `Id` from the column name and naively pluralize (`user_id` → `users`,
 *  `authorId` → `authors`). */
export function inferForeignTable(column: string): string {
  let base = column
  if (base.endsWith('_id'))      base = base.slice(0, -3)
  else if (base.endsWith('Id'))  base = base.slice(0, -2)
  return base.endsWith('s') ? base : `${base}s`
}

function toColumns(columns: string | string[]): string[] {
  return Array.isArray(columns) ? columns : [columns]
}

/**
 * The portable column types v1 supports — the common 80% (parent plan Part 2).
 * Each dialect maps these to its own SQL type; SQLite's mapping lives in
 * `SqliteDialect.columnTypeSql`. Exotic types (geometry, set, …) are deferred.
 */
export type ColumnType =
  | 'increments'   // auto-incrementing integer primary key
  | 'integer'
  | 'bigInteger'
  | 'tinyInteger'
  | 'smallInteger'
  | 'mediumInteger'
  | 'string'       // varchar(length) on pg/mysql; TEXT on sqlite
  | 'char'         // char(length) on pg/mysql; TEXT on sqlite
  | 'text'
  | 'mediumText'   // mediumtext on mysql; text on pg/sqlite
  | 'longText'     // longtext on mysql; text on pg/sqlite
  | 'boolean'
  | 'date'
  | 'time'         // time(precision?) on pg/mysql; TEXT on sqlite
  | 'dateTime'
  | 'timestamp'
  | 'json'
  | 'jsonb'        // jsonb on pg; json on mysql; TEXT on sqlite
  | 'uuid'
  | 'ulid'         // char(26) on pg/mysql; TEXT on sqlite
  | 'decimal'
  | 'float'
  | 'double'
  | 'binary'
  | 'enum'         // enum(...) on mysql; varchar+CHECK on pg/sqlite
  | 'set'          // set(...) on mysql; NotImplemented on pg/sqlite

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
  /** `decimal(name, precision, scale)`; also the fractional-seconds precision
   *  for `time(name, precision)`. */
  precision?:    number
  scale?:        number
  /** Allowed values for `enum(name, [...])` / `set(name, [...])`. Rendered as a
   *  quoted literal list (mysql `enum(...)`/`set(...)`) or a `CHECK (... IN ...)`
   *  constraint (pg/sqlite `enum`). Migration-author supplied — quoted, never bound. */
  enumValues?:   string[]
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
  /** `useCurrentOnUpdate()` — `ON UPDATE CURRENT_TIMESTAMP`. MySQL-only (Laravel
   *  grammar parity); silently ignored on pg/sqlite, which have no inline form. */
  useCurrentOnUpdate: boolean
  /** `comment(text)` — a column comment. Rendered inline (`COMMENT '…'`) on MySQL,
   *  as a separate `COMMENT ON COLUMN` statement on pg, and ignored on sqlite. */
  comment?:      string
  /** `after(column)` — position an added column after another (MySQL ALTER only). */
  after?:        string
  /** `first()` — position an added column first (MySQL ALTER only). */
  first?:        boolean
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
  /** Column-level foreign key (`constrained()` / `.references().on()`). Recorded
   *  here as an intent; the compiler emits it as a table-level `FOREIGN KEY`
   *  constraint, not an inline column modifier. */
  foreignKey?:   ForeignKeyDefinition
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

  /** Refresh this timestamp on UPDATE (`ON UPDATE CURRENT_TIMESTAMP`). MySQL-only;
   *  a no-op on pg/sqlite (recorded for portability, ignored by their grammar). */
  useCurrentOnUpdate(): this {
    this.def.useCurrentOnUpdate = true
    return this
  }

  /** Attach a column comment. Inline on MySQL, a separate `COMMENT ON COLUMN`
   *  statement on pg, ignored on sqlite (no column comments). */
  comment(text: string): this {
    this.def.comment = text
    return this
  }

  /** Position this (added) column after another. MySQL ALTER only — ignored
   *  elsewhere, matching Laravel. */
  after(column: string): this {
    this.def.after = column
    return this
  }

  /** Position this (added) column first. MySQL ALTER only — ignored elsewhere. */
  first(): this {
    this.def.first = true
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

  // ── Foreign keys (column-level) ──

  /**
   * Laravel `constrained()`: add a foreign key on this column. With no argument
   * the referenced table is inferred from the column name (`user_id` → `users`)
   * and the referenced column defaults to `id`. Pass an explicit table (and
   * optionally column) to override the inference.
   */
  constrained(table?: string, column = 'id'): this {
    const fk = this.foreignKey()
    fk.on = table ?? inferForeignTable(this.def.name)
    fk.references = [column]
    return this
  }

  /** Set the referenced column(s). Pair with `.on(table)` for the full FK:
   *  `t.foreignId('user_id').references('id').on('users')`. */
  references(columns: string | string[]): this {
    this.foreignKey().references = toColumns(columns)
    return this
  }

  /** Set the referenced table for the FK started by `.references(...)`. */
  on(table: string): this {
    this.foreignKey().on = table
    return this
  }

  /** `ON DELETE` action (validated against the allowlist). */
  onDelete(action: ForeignKeyActionInput): this {
    this.foreignKey().onDelete = normalizeForeignKeyAction(action)
    return this
  }

  /** `ON UPDATE` action (validated against the allowlist). */
  onUpdate(action: ForeignKeyActionInput): this {
    this.foreignKey().onUpdate = normalizeForeignKeyAction(action)
    return this
  }

  // ── Referential-action shorthands (Laravel parity) ──
  /** `onDelete('cascade')`. */
  cascadeOnDelete(): this { return this.onDelete('cascade') }
  /** `onDelete('restrict')`. */
  restrictOnDelete(): this { return this.onDelete('restrict') }
  /** `onDelete('set null')` — pair with a `.nullable()` column. */
  nullOnDelete(): this { return this.onDelete('set null') }
  /** `onUpdate('cascade')`. */
  cascadeOnUpdate(): this { return this.onUpdate('cascade') }

  /** Lazily create the FK intent on first FK-method call, then return it for
   *  incremental building (`.references().on().onDelete()`). */
  private foreignKey(): ForeignKeyDefinition {
    return (this.def.foreignKey ??= { columns: [this.def.name], references: ['id'], on: '' })
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
    useCurrentOnUpdate: false,
    primary:       false,
    unique:        false,
    index:         false,
    unsigned:      false,
    autoIncrement: false,
    change:        false,
    ...extra,
  }
}
