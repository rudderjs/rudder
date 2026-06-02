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
} from './column.js'

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
  /** Unsigned big integer intended as a foreign key. Chain `.constrained()` (or
   *  `.references(...).on(...)`) to attach the FK constraint. */
  foreignId(name: string): ColumnBuilder {
    return this.add(name, 'bigInteger', { unsigned: true })
  }

  // ── Strings / text ──
  string(name: string, length = 255): ColumnBuilder {
    return this.add(name, 'string', { length })
  }
  text(name: string): ColumnBuilder {
    return this.add(name, 'text')
  }
  uuid(name = 'uuid'): ColumnBuilder {
    return this.add(name, 'uuid')
  }
  json(name: string): ColumnBuilder {
    return this.add(name, 'json')
  }

  // ── Numbers ──
  decimal(name: string, precision = 8, scale = 2): ColumnBuilder {
    return this.add(name, 'decimal', { precision, scale })
  }
  float(name: string): ColumnBuilder {
    return this.add(name, 'float')
  }

  // ── Booleans / dates / binary ──
  boolean(name: string): ColumnBuilder {
    return this.add(name, 'boolean')
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
