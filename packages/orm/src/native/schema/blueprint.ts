// ─── Blueprint (Laravel-style table definition) ────────────
//
// PURE: records the column / index / primary-key *intents* for one table. No
// SQL is built here — the DDL compiler reads a Blueprint and emits statements
// per-dialect. This is the object handed to a `Schema.create('users', t => …)`
// callback.
//
// Column/timestamp naming follows the native engine's **camelCase** convention
// (`createdAt` / `updatedAt` / `deletedAt`) — the same columns the read path's
// soft-delete scoping already defaults to (`deletedAtColumn = 'deletedAt'`), and
// consistent with the ORM's camelCase polymorphic columns. This is a deliberate
// divergence from Laravel's snake_case.

import {
  ColumnBuilder, makeColumn,
  normalizeForeignKeyAction,
  type ColumnDefinition, type ForeignKeyDefinition, type ForeignKeyActionInput,
} from '@rudderjs/database/native'
import { NativeOrmError } from '@rudderjs/database/native'

/** Validate that an `enum`/`set` column got a non-empty value list. The values
 *  themselves are quoted at compile time, so the only check here is presence. */
function requireValues(kind: 'enum' | 'set', values: string[]): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new NativeOrmError(
      'NATIVE_DDL_EMPTY_ENUM',
      `[RudderJS ORM native] ${kind}() requires a non-empty list of allowed values.`,
    )
  }
  return values
}

/** A table-level index intent (`Blueprint.index` / `.unique` / column modifiers). */
export interface IndexDefinition {
  /** Columns covered, in order. */
  columns: string[]
  unique:  boolean
  /** Index name. Defaults to `{table}_{col[_col…]}_{index|unique}` (Laravel-style). */
  name?:   string
}

/**
 * Fluent builder for a table-level foreign key (`Blueprint.foreign(...)`).
 * Mutates the {@link ForeignKeyDefinition} the Blueprint recorded and returns
 * `this` so the constraint chains Laravel-style:
 * `t.foreign('user_id').references('id').on('users').onDelete('cascade')`.
 */
export class ForeignKeyBuilder {
  constructor(private readonly fk: ForeignKeyDefinition) {}

  /** Referenced column(s) on the foreign table (defaults to `id`). */
  references(columns: string | string[]): this {
    this.fk.references = Array.isArray(columns) ? columns : [columns]
    return this
  }
  /** Referenced table. */
  on(table: string): this {
    this.fk.on = table
    return this
  }
  onDelete(action: ForeignKeyActionInput): this {
    this.fk.onDelete = normalizeForeignKeyAction(action)
    return this
  }
  onUpdate(action: ForeignKeyActionInput): this {
    this.fk.onUpdate = normalizeForeignKeyAction(action)
    return this
  }
  /** `onDelete('cascade')`. */
  cascadeOnDelete(): this { return this.onDelete('cascade') }
  /** `onDelete('restrict')`. */
  restrictOnDelete(): this { return this.onDelete('restrict') }
  /** `onDelete('set null')` — pair with nullable column(s). */
  nullOnDelete(): this { return this.onDelete('set null') }
  /** `onUpdate('cascade')`. */
  cascadeOnUpdate(): this { return this.onUpdate('cascade') }
  /** Override the default `{table}_{col[_col…]}_foreign` constraint name. */
  name(name: string): this {
    this.fk.name = name
    return this
  }
}

/**
 * Records one table's shape. Mirrors Laravel's `Blueprint`: a column method
 * returns a {@link ColumnBuilder} so modifiers chain; table-level helpers
 * (`primary` / `unique` / `index`) record composite constraints.
 */
export class Blueprint {
  readonly columns: ColumnDefinition[] = []
  /** Composite (or explicitly-named single) primary key. Single-column PKs set
   *  inline via `.primary()` live on the column instead. */
  primaryColumns: string[] | null = null
  readonly indexes: IndexDefinition[] = []
  /** Table-level foreign keys (`Blueprint.foreign(...)`). Column-level FKs
   *  (`constrained()`) live on their {@link ColumnDefinition} instead; the
   *  compiler collects both. */
  readonly foreignKeys: ForeignKeyDefinition[] = []

  constructor(readonly table: string) {}

  private add(name: string, type: ColumnDefinition['type'], extra: Partial<ColumnDefinition> = {}): ColumnBuilder {
    const def = makeColumn(name, type, extra)
    this.columns.push(def)
    return new ColumnBuilder(def)
  }

  // ── Auto-incrementing primary key ──
  /** Auto-incrementing integer primary key (`id` by default). */
  id(name = 'id'): ColumnBuilder {
    return this.increments(name)
  }
  /** Auto-incrementing integer primary key under an explicit name. */
  increments(name: string): ColumnBuilder {
    return this.add(name, 'increments', { autoIncrement: true, primary: true })
  }
  /** Alias of {@link increments} — bigint on pg/mysql, INTEGER on SQLite. */
  bigIncrements(name: string): ColumnBuilder {
    return this.add(name, 'increments', { autoIncrement: true, primary: true })
  }

  // ── Integers ──
  integer(name: string): ColumnBuilder {
    return this.add(name, 'integer')
  }
  bigInteger(name: string): ColumnBuilder {
    return this.add(name, 'bigInteger')
  }
  /** Small integer — `smallint` (pg/mysql), `INTEGER` (sqlite). */
  smallInteger(name: string): ColumnBuilder {
    return this.add(name, 'smallInteger')
  }
  /** Tiny integer — `tinyint` (mysql), `smallint` (pg), `INTEGER` (sqlite). */
  tinyInteger(name: string): ColumnBuilder {
    return this.add(name, 'tinyInteger')
  }
  /** Medium integer — `mediumint` (mysql), `integer` (pg), `INTEGER` (sqlite). */
  mediumInteger(name: string): ColumnBuilder {
    return this.add(name, 'mediumInteger')
  }
  /** Unsigned big integer intended as a foreign key. Chain `.constrained()` (or
   *  `.references(...).on(...)`) to attach the FK constraint. */
  foreignId(name: string): ColumnBuilder {
    return this.add(name, 'bigInteger', { unsigned: true })
  }
  /**
   * Laravel `foreignIdFor`: an unsigned big-integer FK column whose name is
   * derived from a related table (`'users'` → `userId`) unless `column` is given.
   * Chain `.constrained()` to attach the constraint. Naming follows the engine's
   * camelCase convention (singularize + `Id`), a divergence from Laravel's
   * `{snake}_id`.
   */
  foreignIdFor(related: string, column?: string): ColumnBuilder {
    const singular = related.endsWith('s') ? related.slice(0, -1) : related
    return this.foreignId(column ?? `${singular}Id`)
  }

  // ── Strings / text ──
  string(name: string, length = 255): ColumnBuilder {
    return this.add(name, 'string', { length })
  }
  /** Fixed-length `char(length)` (pg/mysql); `TEXT` on sqlite. */
  char(name: string, length = 255): ColumnBuilder {
    return this.add(name, 'char', { length })
  }
  text(name: string): ColumnBuilder {
    return this.add(name, 'text')
  }
  /** `mediumtext` (mysql); `text` (pg/sqlite). */
  mediumText(name: string): ColumnBuilder {
    return this.add(name, 'mediumText')
  }
  /** `longtext` (mysql); `text` (pg/sqlite). */
  longText(name: string): ColumnBuilder {
    return this.add(name, 'longText')
  }
  uuid(name = 'uuid'): ColumnBuilder {
    return this.add(name, 'uuid')
  }
  /** 26-char ULID — `char(26)` (pg/mysql), `TEXT` (sqlite). */
  ulid(name = 'ulid'): ColumnBuilder {
    return this.add(name, 'ulid')
  }
  /** A `uuid` column intended as a foreign key — chain `.constrained()`. */
  foreignUuid(name: string): ColumnBuilder {
    return this.add(name, 'uuid')
  }
  /** A `ulid` column intended as a foreign key — chain `.constrained()`. */
  foreignUlid(name: string): ColumnBuilder {
    return this.add(name, 'ulid')
  }
  json(name: string): ColumnBuilder {
    return this.add(name, 'json')
  }
  /** `jsonb` (pg) — binary JSON; falls back to `json` (mysql) / `TEXT` (sqlite). */
  jsonb(name: string): ColumnBuilder {
    return this.add(name, 'jsonb')
  }
  /**
   * Enumerated string column. `enum(...)` on MySQL; `varchar(255)` + a
   * `CHECK (… IN (…))` constraint on pg/sqlite. Values are migration-author
   * supplied — rendered as quoted literals, never bound. Throws on an empty list.
   */
  enum(name: string, values: string[]): ColumnBuilder {
    return this.add(name, 'enum', { enumValues: requireValues('enum', values) })
  }
  /** MySQL `set(...)` — multiple allowed values stored as a comma list. Throws a
   *  clear NotImplemented on pg/sqlite (no native SET type). */
  set(name: string, values: string[]): ColumnBuilder {
    return this.add(name, 'set', { enumValues: requireValues('set', values) })
  }

  // ── Numbers ──
  decimal(name: string, precision = 8, scale = 2): ColumnBuilder {
    return this.add(name, 'decimal', { precision, scale })
  }
  float(name: string): ColumnBuilder {
    return this.add(name, 'float')
  }
  /** Double-precision float — `double precision` (pg), `double` (mysql), `REAL` (sqlite). */
  double(name: string): ColumnBuilder {
    return this.add(name, 'double')
  }

  // ── Booleans / dates / binary ──
  boolean(name: string): ColumnBuilder {
    return this.add(name, 'boolean')
  }
  /** Calendar date (no time) — `date` (pg/mysql), `TEXT` (sqlite). */
  date(name: string): ColumnBuilder {
    return this.add(name, 'date')
  }
  /** Time of day (no date). Optional fractional-seconds `precision` → `time(p)`
   *  on pg/mysql; `TEXT` on sqlite. */
  time(name: string, precision?: number): ColumnBuilder {
    return this.add(name, 'time', precision === undefined ? {} : { precision })
  }
  dateTime(name: string): ColumnBuilder {
    return this.add(name, 'dateTime')
  }
  timestamp(name: string): ColumnBuilder {
    return this.add(name, 'timestamp')
  }
  binary(name: string): ColumnBuilder {
    return this.add(name, 'binary')
  }

  // ── Convenience clusters ──
  /** `createdAt` + `updatedAt`, nullable (Laravel parity), camelCase per engine
   *  convention. */
  timestamps(): void {
    this.timestamp('createdAt').nullable()
    this.timestamp('updatedAt').nullable()
  }
  /** `deletedAt` nullable — the column the soft-delete scope filters on. */
  softDeletes(name = 'deletedAt'): ColumnBuilder {
    return this.timestamp(name).nullable()
  }

  /**
   * Polymorphic relation columns (Laravel `morphs`): a `{name}Id` (unsigned big
   * integer) + `{name}Type` (string) pair plus a composite index over both. The
   * columns use the engine's **camelCase** morph convention (`commentableId` /
   * `commentableType`) — the same columns `morphTo` / `morphMany` read/write —
   * not Laravel's snake_case. The index covers `[{name}Type, {name}Id]` (type
   * first, matching Laravel), defaulting to `{table}_{name}Type_{name}Id_index`;
   * pass `indexName` to override (pair with the same name in {@link dropMorphs}).
   */
  morphs(name: string, indexName?: string): void {
    this.bigInteger(`${name}Id`).unsigned()
    this.string(`${name}Type`)
    this.index([`${name}Type`, `${name}Id`], indexName)
  }
  /** Nullable variant of {@link morphs} — both columns allow NULL (the relation
   *  is optional). Same `[{name}Type, {name}Id]` composite index. */
  nullableMorphs(name: string, indexName?: string): void {
    this.bigInteger(`${name}Id`).unsigned().nullable()
    this.string(`${name}Type`).nullable()
    this.index([`${name}Type`, `${name}Id`], indexName)
  }

  // ── Table-level constraints ──
  /** Composite (or named single) primary key. */
  primary(columns: string | string[]): void {
    this.primaryColumns = Array.isArray(columns) ? columns : [columns]
  }
  /** Composite (or single) unique index. */
  unique(columns: string | string[], name?: string): void {
    this.indexes.push({ columns: Array.isArray(columns) ? columns : [columns], unique: true, ...(name !== undefined && { name }) })
  }
  /** Composite (or single) non-unique index. */
  index(columns: string | string[], name?: string): void {
    this.indexes.push({ columns: Array.isArray(columns) ? columns : [columns], unique: false, ...(name !== undefined && { name }) })
  }

  /**
   * Composite / explicit foreign key:
   * `t.foreign('user_id').references('id').on('users').onDelete('cascade')`.
   * Returns a {@link ForeignKeyBuilder}; the referenced column defaults to `id`.
   * For the single-column shorthand, prefer `t.foreignId('user_id').constrained()`.
   */
  foreign(columns: string | string[]): ForeignKeyBuilder {
    const fk: ForeignKeyDefinition = {
      columns:    Array.isArray(columns) ? columns : [columns],
      references: ['id'],
      on:         '',
    }
    this.foreignKeys.push(fk)
    return new ForeignKeyBuilder(fk)
  }
}
