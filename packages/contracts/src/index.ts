// ─── ORM Types ─────────────────────────────────────────────

// Raw SQL expression wrapper (`raw(...)` / `DB.raw(...)`). Lives here, not in
// @rudderjs/database, so the query builder's raw methods stay client-safe.
import { Expression } from './expression.js'
export { Expression, raw } from './expression.js'

export type WhereOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN'

export interface WhereClause {
  column:   string
  operator: WhereOperator
  value:    unknown
}

export interface OrderClause {
  column:    string
  direction: 'ASC' | 'DESC'
}

export interface QueryState {
  wheres:  WhereClause[]
  orders:  OrderClause[]
  limitN:  number | null
  offsetN: number | null
  withs:   string[]
  aggregates: AggregateRequest[]
}

/**
 * Scalar aggregate function. Used both as the discriminator in
 * {@link AggregateRequest} and as the parameter to the internal
 * {@link QueryBuilder._aggregate} terminal for single-scalar reads.
 */
export type AggregateFn = 'count' | 'sum' | 'min' | 'max' | 'avg' | 'exists'

/**
 * One normalized aggregate-eager-load entry. The orm Model layer translates
 * every `withCount(...)` / `withSum(...)` / etc. overload — including the
 * map-form constraint shape — into one or more of these and pushes them
 * onto {@link QueryState.aggregates} for the adapter to consume.
 *
 * `relation` is the relation name on the parent Model. `column` is required
 * for `sum`/`min`/`max`/`avg` and ignored for `count`/`exists`.
 *
 * `alias` is the property name stamped onto the parent row in result hydration.
 * Default = `<relation><FnSuffix>`: `posts` + count → `postsCount`,
 * `posts` + sumViews → `postsSumViews`. The orm layer fills `alias` from
 * `<aliasOverride ?? relation><FnSuffix>` where `aliasOverride` is the
 * `.as(name)` setter on the constraint builder.
 *
 * `joinShape` carries the fully-resolved join layout — the adapter uses it to
 * build the COUNT/SUM subquery without re-deriving foreign keys, pivot tables,
 * or polymorphic discriminators. Same {@link RelationExistencePredicate}-style
 * decomposition; reusing those fields keeps the adapter mechanics single-shape.
 */
export interface AggregateRequest {
  relation:    string
  fn:          AggregateFn
  alias:       string
  /** Required for sum/min/max/avg; absent for count/exists. */
  column?:     string
  joinShape:   AggregateJoinShape
  /** Recorded `where`/`orWhere` calls captured from the constraint callback. */
  constraintWheres: WhereClause[]
}

/**
 * Join layout for an {@link AggregateRequest}. Mirrors the
 * {@link RelationExistencePredicate} fields adapters already understand for
 * `whereHas` so a single subquery shape covers both.
 */
export interface AggregateJoinShape {
  relatedTable:    string
  parentColumn:    string
  relatedColumn:   string
  /** Polymorphic discriminator(s) (`{morphName}Type` for morph relations,
   *  pivot-side type discriminator for `morphToMany`/`morphedByMany`). */
  extraEquals?:    Record<string, unknown>
  /** Pivot table the relation passes through (`belongsToMany` /
   *  `morphToMany` / `morphedByMany`). Two-step subquery when set. */
  through?: {
    pivotTable:      string
    foreignPivotKey: string
    relatedPivotKey: string
  }
  /** True when the related Model has soft deletes enabled — adapters AND
   *  `deleted_at IS NULL` (or its camelCase `deletedAt`) into the subquery. */
  softDeletes?: boolean
}

/**
 * Relation predicate passed by `@rudderjs/orm`'s Model layer to the adapter
 * via {@link QueryBuilder.whereRelationExists}. Carries everything an adapter
 * needs to express "rows whose named relation has (or doesn't have) at least
 * one matching child" without leaking ORM-package types.
 *
 * - Name-based adapters (Prisma) usually only need `relation`, `exists`, and
 *   `constraintWheres` to build a `{ [relation]: { some|none: ... } }` filter.
 * - SQL-based adapters (Drizzle) need the structural columns + tables to
 *   build a correlated `EXISTS (...)` subquery.
 *
 * `extraEquals` carries the polymorphic discriminator (`{morph}Type`) for
 * morph relations and the pivot-side discriminator for `morphToMany`.
 *
 * `through` is set when the relation passes through a pivot table
 * (`belongsToMany` / `morphToMany` / `morphedByMany`). When set, the EXISTS
 * subquery is two-step: pivot rows by parent + extras → project related ids,
 * then the related table is filtered by `relatedKey IN (...)` plus
 * `constraintWheres`.
 */
export interface RelationExistencePredicate {
  /** Relation name on the parent model (used for clearer error messages). */
  relation:        string
  /** True for `whereHas`, false for `whereDoesntHave`. */
  exists:          boolean
  /** How this predicate joins to the WHERE built so far. `'AND'` (default) for
   *  `whereHas`/`whereDoesntHave`; `'OR'` for the `orWhereHas` family. */
  boolean?:        'AND' | 'OR'
  /** Count comparison for the `has(relation, operator, count)` family. When set,
   *  the subquery becomes `(SELECT COUNT(*) …) <operator> <value>` instead of a
   *  bare `EXISTS`. Absent = plain existence. */
  count?:          { operator: WhereOperator; value: number }
  /** Related table name (already resolved from the relation declaration). */
  relatedTable:    string
  /** Column on the parent table joined against `relatedColumn`. */
  parentColumn:    string
  /** Column on the related table joined against `parentColumn`. */
  relatedColumn:   string
  /** Where clauses to AND into the relation subquery. */
  constraintWheres: WhereClause[]
  /** Optional equality filter — used by morph relations to add the
   *  discriminator (`{morph}Type`), and by morph pivots to add the pivot-side
   *  type discriminator. */
  extraEquals?:    Record<string, unknown>
  /** Optional pivot table the relation passes through. When set, the subquery
   *  is two-step (pivot → related) instead of a single direct EXISTS. */
  through?: {
    pivotTable:      string
    /** Pivot column compared against the parent's `parentColumn`. */
    foreignPivotKey: string
    /** Pivot column projected as the inner select for the second step. */
    relatedPivotKey: string
  }
}

export interface QueryBuilder<T> {
  where(column: string, value: unknown): this
  where(column: string, operator: WhereOperator, value: unknown): this
  orWhere(column: string, value: unknown): this
  orWhere(column: string, operator: WhereOperator, value: unknown): this
  /**
   * Wrap a chain of `where`/`orWhere` (and nested `whereGroup`s) in a single
   * AND-grouped clause. Composes with surrounding AND/OR like any other where
   * call. The callback receives a fresh sub-builder; calls inside it compose
   * among themselves and the resulting grouped clause is spliced back into
   * this builder. Empty groups (no recorded calls) are a no-op. Terminal
   * methods (`get`/`find`/`first`/`paginate`/etc.) on the sub-builder throw.
   *
   * @example
   *   q.where('status', 'active')
   *    .whereGroup(g => g.where('priority', 'high').orWhere('starred', true))
   *   // WHERE status = 'active' AND (priority = 'high' OR starred = TRUE)
   */
  whereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this
  /** OR-rooted variant of {@link whereGroup}. */
  orWhereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this
  orderBy(column: string | Expression, direction?: 'ASC' | 'DESC'): this
  /**
   * Raw-SQL escape hatch for any clause where the structured builder is too
   * narrow. The fragment is spliced verbatim (identifiers are NOT quoted — the
   * caller owns correctness); values must travel as `?` placeholders with a
   * matching `bindings` array (rebound to the dialect's placeholder form, e.g.
   * `$n` on Postgres). Mirrors Laravel's `selectRaw`/`whereRaw`/`orderByRaw`.
   *
   * Caveat: a literal `?` inside a string literal in the fragment is counted as
   * a placeholder — same limitation as Laravel. Prefer a bound value.
   *
   * Not every adapter can splice raw SQL: the structured Prisma client throws
   * with a pointer to the `DB` facade (`DB.select(sql, bindings)`); the native
   * engine and Drizzle support it directly.
   *
   * @example
   *   q.whereRaw('age > ? and active = ?', [18, true])
   *   q.orderByRaw('field(status, ?, ?)', ['urgent', 'high'])
   *   q.selectRaw('count(*) as total, max(created_at) as latest')
   */
  selectRaw(sql: string, bindings?: readonly unknown[]): this
  whereRaw(sql: string, bindings?: readonly unknown[]): this
  orWhereRaw(sql: string, bindings?: readonly unknown[]): this
  orderByRaw(sql: string, bindings?: readonly unknown[]): this
  limit(n: number): this
  offset(n: number): this
  with(...relations: string[]): this
  /**
   * Project pivot-table columns onto each related row when the query is
   * a deferred `belongsToMany` / `morphToMany` / `morphedByMany` lookup.
   *
   * Each returned related row carries `row.pivot = { col: value, ... }` for
   * the requested columns. No-op on non-pivot queries (the column list is
   * discarded by adapters that don't run a pivot lookup).
   *
   * Throws when called with no arguments — the column list is required so
   * the contract is explicit, not "all pivot columns".
   */
  withPivot(...columns: string[]): this
  /** Include soft-deleted records in query results. */
  withTrashed(): this
  /** Return only soft-deleted records. */
  onlyTrashed(): this
  first(): Promise<T | null>
  find(id: number | string): Promise<T | null>
  get(): Promise<T[]>
  all(): Promise<T[]>
  count(): Promise<number>
  create(data: Partial<T>): Promise<T>
  update(id: number | string, data: Partial<T>): Promise<T>
  delete(id: number | string): Promise<void>
  /**
   * Bulk insert. Used by `belongsToMany` attach to write pivot rows in one
   * round-trip and by callers that need batched inserts. No return value —
   * adapters that can't echo inserted ids without a round-trip don't have to.
   */
  insertMany(rows: Partial<T>[]): Promise<void>
  /**
   * Bulk insert-or-update. For each row, insert it; on a unique-key conflict
   * (the columns named in `uniqueBy`), update the `update` columns from the
   * incoming values instead of failing. Resolves to the number of rows
   * affected/processed.
   *
   * Mirrors Laravel's `upsert($values, $uniqueBy, $update)`. The Model layer
   * (`Model.upsert`) normalizes `uniqueBy` to an array and computes the default
   * `update` set (every inserted column except `uniqueBy`), so adapters always
   * receive concrete arrays. An empty `update` means insert-or-ignore.
   *
   * Each backend maps to its native clause: native/Drizzle emit a single
   * `ON CONFLICT … DO UPDATE` (SQLite/Postgres) / `ON DUPLICATE KEY UPDATE`
   * (MySQL) statement; the Prisma adapter falls back to a per-row `upsert`
   * batched in one transaction (no portable bulk ON CONFLICT). A matching unique
   * constraint on `uniqueBy` must exist, exactly as the SQL clause requires.
   *
   * **Optional capability.** Adapters that don't implement it omit it; the Model
   * layer throws an adapter-named error if `Model.upsert()` is called against one.
   */
  upsert?(rows: Partial<T>[], uniqueBy: string[], update: string[]): Promise<number>
  /**
   * Delete every row matching the chained `where`/`orWhere` clauses.
   * Returns the number of rows deleted. Bypasses soft deletes — call
   * `withTrashed()` first if you need to scope including trashed rows
   * (most adapters apply the soft-delete filter automatically otherwise).
   */
  deleteAll(): Promise<number>
  /**
   * Update every row matching the chained `where`/`orWhere` clauses with
   * the given partial. Returns the number of rows updated. Used by the
   * `belongsToMany` / `morphToMany` / `morphedByMany` accessors'
   * `updatePivot()` to write extras on a composite-keyed pivot row, and
   * available for any bulk-update need beyond pivots.
   */
  updateAll(data: Partial<T>): Promise<number>
  /** Restore a soft-deleted record. */
  restore(id: number | string): Promise<T>
  /** Permanently delete a record, bypassing soft deletes. */
  forceDelete(id: number | string): Promise<void>
  /**
   * Atomically add `amount` to `column`. Optionally update other columns at the
   * same time via `extra`. Returns the updated record. Throws if the row is missing.
   */
  increment(id: number | string, column: string, amount?: number, extra?: Record<string, unknown>): Promise<T>
  /**
   * Atomically subtract `amount` from `column`. Optionally update other columns
   * at the same time via `extra`. Returns the updated record. Throws if the row is missing.
   */
  decrement(id: number | string, column: string, amount?: number, extra?: Record<string, unknown>): Promise<T>
  paginate(page: number, perPage?: number): Promise<PaginatedResult<T>>
  /**
   * Add an EXISTS / NOT EXISTS subquery filter representing a relation
   * predicate. Adapters translate to their native shape (Prisma → `some`/
   * `none`; Drizzle → correlated subquery via `exists()`/`notExists()`).
   *
   * Called by `@rudderjs/orm`'s `Model.whereHas` / `whereDoesntHave` /
   * `withWhereHas`. Apps don't call this directly.
   */
  whereRelationExists(predicate: RelationExistencePredicate): this
  /**
   * Add a pessimistic `FOR UPDATE` row lock to the SELECT (`SELECT … FOR UPDATE`).
   * Concurrent transactions block on the locked rows until this transaction
   * commits — the primitive behind a database-backed job queue's atomic
   * reservation. Only meaningful inside a `transaction()`.
   *
   * Optional capability. Engines without row-level pessimistic locking (e.g.
   * SQLite, whose write transaction already serializes) implement it as a no-op;
   * adapters that can't express it omit the method entirely.
   */
  lockForUpdate?(): this
  /**
   * Add a shared `FOR SHARE` row lock to the SELECT — readers may proceed but
   * writers block until commit. Same optionality as {@link lockForUpdate}.
   */
  sharedLock?(): this
  /**
   * Eager-load `relation` constrained to rows matching `constraintWheres`.
   * Adapters that don't support a constrained include (Drizzle today) may
   * apply the filter in JS or throw a clear "not yet supported" error.
   *
   * Optional — adapters may omit it and `Model.withWhereHas` falls back to
   * unconstrained `with(relation)`.
   */
  withConstrained?(relation: string, constraintWheres: WhereClause[]): this

  /**
   * pgvector similarity filter (#B7 Phase 1 — Postgres + pgvector only).
   *
   * Adds an `ORDER BY <column> <op> $vec` clause to the query, optionally
   * gated by `minSimilarity` (cosine in `[-1, 1]`, higher = closer). The
   * default operator is cosine distance (`<=>`); `'l2'` and
   * `'inner-product'` map to `<->` and `<#>`.
   *
   * `query` accepts either a literal embedding (`number[]`) or a string
   * for auto-embed via `AI.embed()` (#B7 Phase 2). The string form
   * requires `opts.embedWith` (a `<provider>/<model>` id); omitting it
   * throws `MissingEmbedderError`. Auto-embed resolves at terminal time
   * via the optional `@rudderjs/ai` peer.
   *
   * Chained `.where()` / `.orWhere()` clauses compose into the SQL
   * (#B7 Phase 2.5) — flat predicates work; `whereGroup` and direct
   * `whereHas` still throw. Polymorphic / pivot relations route through
   * pre-resolved `IN` clauses and work transparently.
   *
   * Adapters that don't support pgvector (Drizzle today; Prisma against
   * a non-Postgres connection or one without the extension) throw
   * `VectorStorageUnsupportedError`.
   */
  whereVectorSimilarTo?(
    column: string,
    query: number[] | string,
    opts?: {
      minSimilarity?: number
      metric?: 'cosine' | 'l2' | 'inner-product'
      embedWith?: string
    },
  ): this

  /**
   * Project the **distance** (not similarity) between `column` and
   * `query` as `alias` on each returned row. Adapters translate to a
   * `SELECT <op>(...) AS alias` fragment.
   *
   * Lets apps render the score next to the row in their UI. Note this
   * is *distance* — `0` means identical, `>=2` means opposite for
   * cosine. `1 - alias` gives back similarity.
   *
   * Optional on the contract — adapters not implementing pgvector
   * (today: Drizzle) can omit. Adapters that opt-in implement and
   * throw `VectorStorageUnsupportedError` if the connection isn't a
   * Postgres + pgvector setup.
   */
  selectVectorDistance?(column: string, query: number[], alias: string): this

  /**
   * Append one or more aggregate eager-load requests. Adapters translate to
   * their native shape (Prisma → `_count` selector for count/exists +
   * `groupBy` second-batch for sum/min/max/avg; Drizzle → correlated subselect
   * in the SELECT list).
   *
   * Called by `@rudderjs/orm`'s Model layer with already-normalized
   * {@link AggregateRequest} entries — apps don't call this directly. The
   * Model proxy translates the typed `withCount`/`withSum`/etc. overloads
   * into requests and forwards them here.
   *
   * Aggregate values are stamped onto the result row under `alias` and
   * the orm hydration layer copies them onto the Model instance.
   */
  withAggregate(requests: AggregateRequest[]): this

  /**
   * Single-scalar aggregate terminal — runs `SELECT fn(column) FROM table
   * WHERE …` against the QB's accumulated wheres and returns the value.
   *
   * Used by `Model#loadSum`/`loadMin`/`loadMax`/`loadAvg` for the per-instance
   * aggregate-load path. Apps don't call this directly; use the typed
   * `Model.query().withSum(...)` overloads on the parent or the instance
   * `loadSum` helper instead.
   *
   * `column` is required for `sum`/`min`/`max`/`avg`; ignored for
   * `count`/`exists`. Returns `null` when no rows match (sum/avg on empty
   * sets) — adapters coerce numeric `null` to `0` for `count` to match
   * SQL semantics. `exists` returns a boolean.
   *
   * The underscore-prefix signals "not for app code" — the contract is on
   * the public interface because ORM adapters are public implementers and
   * must satisfy this member.
   */
  _aggregate(fn: AggregateFn, column?: string): Promise<unknown>
}

/**
 * The sub-builder handed to the callback form of a `join(...)`:
 * `join('posts', (j) => j.on('posts.userId', '=', 'users.id'))`.
 *
 * `on` / `orOn` add **column-vs-column** comparisons (both sides are
 * identifiers, quoted per dialect). `where` / `orWhere` add **column-vs-value**
 * predicates (the value is bound) — useful for `LEFT JOIN … ON a = b AND c = ?`.
 *
 * Standalone type, deliberately NOT a member of {@link QueryBuilder}: joins are
 * implemented on the concrete adapter query builders (native = real SQL;
 * Drizzle / Prisma throw and point at the `DB` facade), so adding the methods to
 * the contract would force every hand-rolled QB stub to implement them. The ORM
 * surfaces them through `HydratingQueryBuilder` instead.
 */
export interface JoinClause {
  /** Column-vs-column ON condition. Two-arg form is equality; three-arg carries the operator. */
  on(left: string, right: string): this
  on(left: string, operator: WhereOperator, right: string): this
  /** OR-rooted {@link on}. */
  orOn(left: string, right: string): this
  orOn(left: string, operator: WhereOperator, right: string): this
  /** Column-vs-value ON predicate (the value binds). Two-arg form is equality. */
  where(column: string, value: unknown): this
  where(column: string, operator: WhereOperator, value: unknown): this
  /** OR-rooted {@link JoinClause.where}. */
  orWhere(column: string, value: unknown): this
  orWhere(column: string, operator: WhereOperator, value: unknown): this
}

export interface PaginatedResult<T> {
  data:        T[]
  total:       number
  perPage:     number
  currentPage: number
  lastPage:    number
  from:        number
  to:          number
}

/** Per-query opts threaded from `Model._q()` so the adapter can honor
 *  per-model state (currently just the primary-key column). Optional —
 *  adapters that ignore it still work for `id`-PK models. */
export interface OrmAdapterQueryOpts {
  /**
   * Primary-key column for this model. Defaults to `'id'` when the adapter
   * needs a fallback. Required for non-`id` PK models (`static primaryKey =
   * 'uuid'`) — without it, `find` / `update` / `delete` / `increment` etc.
   * hardcode `where: { id }` and silently target the wrong column.
   */
  primaryKey?: string
}

// ─── DB execution contracts (DB-facade seam) ───────────────
//
// The model-independent SQL execution surface. Owned here — the zero-dependency
// foundation, beside `OrmAdapter` — and surfaced to apps via `@rudderjs/database`'s
// `DB` facade, which re-exports these. The native engine (`@rudderjs/orm/native`)
// implements them; every adapter shares this one import point, so the data layer
// can later be extracted without a flag-day.

/** A single result row — column name → value, as returned by the driver. */
export type Row = Record<string, unknown>

/**
 * Runs parameterized SQL and returns rows. The minimal execution surface a SQL
 * compiler / query builder depends on. Values flow through `bindings` (`?` / `$n`
 * placeholders in `sql`) — the engine never string-interpolates them into `sql`.
 */
export interface Executor {
  execute(sql: string, bindings: readonly unknown[]): Promise<Row[]>
}

/**
 * A transaction scope: an {@link Executor} that can open a *nested* transaction
 * (mapped to a SAVEPOINT). The inner work executes on the scope; a nested
 * `scope.transaction(...)` rolls back only its own savepoint on failure.
 */
export interface Transaction extends Executor {
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
}

/**
 * A database connection: a {@link Transaction} (so it can open a top-level
 * transaction) plus connection lifecycle. Async by contract so RN/WASM drivers
 * implement it the natural way.
 */
export interface Connection extends Transaction {
  /** Release the underlying connection/handle. Idempotent. */
  close(): Promise<void>
}

/**
 * A single executed query, as reported to {@link OrmAdapter.onQuery} listeners.
 * The shape Telescope's QueryCollector and Pulse's slow-query recorder already
 * consume, now owned here so every adapter reports the same event.
 */
export interface QueryEvent {
  /** The SQL text as sent to the driver (placeholders, not interpolated values). */
  sql: string
  /** Positional binding values, in placeholder order. */
  bindings: unknown[]
  /** Wall-clock execution time in milliseconds. */
  duration: number
  /** Driver/connection name when the adapter knows it (e.g. `'sqlite'`). */
  connection?: string | undefined
  /** Model name when the adapter can infer it from the query. */
  model?: string | undefined
}

/** A query listener registered via {@link OrmAdapter.onQuery} / `DB.listen`. */
export type QueryListener = (event: QueryEvent) => void

export interface OrmAdapter {
  query<T>(table: string, opts?: OrmAdapterQueryOpts): QueryBuilder<T>
  connect(): Promise<void>
  disconnect(): Promise<void>
  /**
   * Run `fn` inside a database transaction. The adapter passed to `fn` is
   * **transaction-scoped** — every query built from it executes on the
   * transaction's connection/handle, and the whole unit commits when `fn`
   * resolves or rolls back (and re-throws) when it rejects. Nesting maps to
   * savepoints.
   *
   * **Optional capability.** Adapters that don't support transactions omit this
   * method; the ORM surfaces a clear error if `Model.transaction()` is called
   * against one. The native engine (`@rudderjs/orm/native`) implements it; the
   * Prisma/Drizzle adapters may not yet. The Model layer never calls the passed
   * adapter directly — it threads it through an `AsyncLocalStorage` so existing
   * `Model.query()` call sites inside `fn` transparently use the transaction.
   */
  transaction?<T>(fn: (tx: OrmAdapter) => Promise<T>): Promise<T>

  /**
   * Raw `SELECT` escape hatch — the read half of `@rudderjs/database`'s `DB`
   * facade (`DB.select`). Resolves to the matched rows.
   *
   * **Optional capability.** Adapters that don't implement it omit it; the
   * facade throws an adapter-named error. Implemented over each adapter's
   * existing raw path (native `Executor.execute`, Prisma `$queryRawUnsafe`,
   * Drizzle `db.execute`).
   */
  selectRaw?(sql: string, bindings: readonly unknown[]): Promise<Row[]>

  /**
   * Raw writing-statement escape hatch — the write half of the `DB` facade
   * (`DB.insert` / `update` / `delete` / `statement`). Resolves to the number
   * of rows affected. Optional, mirroring {@link OrmAdapter.selectRaw}.
   */
  affectingStatement?(sql: string, bindings: readonly unknown[]): Promise<number>

  /**
   * Register a query listener — fired once per executed query with the SQL,
   * bindings, and wall-clock duration. The app-facing entry point is
   * `DB.listen()` in `@rudderjs/database`; Telescope/Pulse hook in here too.
   *
   * **Optional capability.** Adapters that can't observe their driver's query
   * stream omit it; `DB.listen()` throws an adapter-named error. Listener
   * errors must never break the query — adapters swallow them.
   */
  onQuery?(listener: QueryListener): void

  /**
   * How the adapter resolves *direct* relations (`hasOne` / `hasMany` /
   * `belongsTo` / `belongsToMany`) passed to `QueryBuilder.with(...)`.
   *
   * - `'native'` (default when omitted) — the adapter's own `with()` resolves
   *   the relation from schema-level metadata it already holds (Prisma's
   *   `include`). The ORM forwards relation names to `QueryBuilder.with(...)`
   *   unchanged.
   * - `'model-layer'` — the adapter has no schema-level relation graph, so the
   *   ORM resolves direct relations itself: it reads `static relations` for the
   *   foreign key / direction, fires one batched `WHERE … IN` query per relation
   *   against the related model, and stitches the results onto each parent
   *   (the same machinery polymorphic relations already use). The Drizzle
   *   adapter sets this — Drizzle's relational query API needs pre-declared
   *   `relations()` schemas the adapter doesn't hold.
   *
   * Polymorphic relations are always resolved in the model layer regardless of
   * this setting; it governs only the direct-relation routing.
   */
  eagerLoadStrategy?: 'native' | 'model-layer'
}

export interface OrmAdapterProvider {
  create(): OrmAdapter | Promise<OrmAdapter>
}

/**
 * Minimal chainable query surface a `ModelLike` exposes via `.query()`.
 * `QueryBuilder<T>` from this file already structurally satisfies it for
 * any concrete `T` — invariance in the input positions is widened to
 * `unknown` here so the contract is consumer-facing rather than tied to
 * a specific Model type.
 */
export interface ModelQuery {
  where(column: string, value: unknown): ModelQuery
  where(column: string, operator: WhereOperator, value: unknown): ModelQuery
  orWhere(column: string, value: unknown): ModelQuery
  orWhere(column: string, operator: WhereOperator, value: unknown): ModelQuery
  orderBy(column: string, direction?: 'ASC' | 'DESC'): ModelQuery
  paginate(page: number, perPage?: number): Promise<{ data: unknown[]; total: number }>
}

/**
 * Static surface of an Eloquent-style ORM Model — the contract that
 * downstream tools (e.g. admin panels with auto-wired CRUD, generic
 * resource browsers) target when they want to call into "the model"
 * without depending on the `@rudderjs/orm` package directly.
 * `@rudderjs/orm`'s `Model` base class satisfies this structurally.
 */
export interface ModelLike {
  /** Primary-key column name. Defaults to `'id'`. */
  primaryKey?: string

  find(id: string | number):                                  Promise<unknown>
  create(data: Record<string, unknown>):                      Promise<unknown>
  update(id: string | number, data: Record<string, unknown>): Promise<unknown>
  delete(id: string | number):                                Promise<void>
  query():                                                    ModelQuery
}

// ─── Request & Response ────────────────────────────────────

/**
 * Thrown by typed request accessors when the value cannot be coerced.
 */
export class InputTypeError extends Error {
  constructor(key: string, expected: string, received: unknown) {
    const type = received === null ? 'null'
      : Array.isArray(received) ? 'array'
      : typeof received
    super(`Input "${key}" expected ${expected}, got ${type}.`)
    this.name = 'InputTypeError'
  }
}

/**
 * Thrown by server adapters when the request advertises a parseable body
 * (`Content-Type: application/json` or `application/x-www-form-urlencoded`)
 * but the body fails to parse. Lives in contracts so adapters can throw it
 * without taking a `@rudderjs/core` dependency. The framework's exception
 * pipeline in `@rudderjs/core` renders this as HTTP 400 via the
 * duck-typed `httpStatus` path.
 *
 * Replaces the legacy silent `req.body = {}` fallback which made malformed
 * requests look like missing-field validation errors to handlers.
 */
export class MalformedBodyError extends Error {
  readonly httpStatus = 400
  readonly contentType: string
  constructor(contentType: string, cause?: Error) {
    super(`Malformed request body (Content-Type: ${contentType})`)
    this.name = 'MalformedBodyError'
    this.contentType = contentType
    if (cause) this.cause = cause
  }
}

/**
 * Thrown by validation pipelines (FormRequest, router `.query(schema)`, etc.)
 * when input fails schema validation. Lives in contracts so packages outside
 * `@rudderjs/core` can throw it without taking a core dependency. The
 * framework's exception handler in `@rudderjs/core` renders this as
 * HTTP 422 with a JSON body of `{ message, errors }`.
 */
export class ValidationError extends Error {
  constructor(public errors: Record<string, string[]>) {
    super('Validation failed')
    this.name = 'ValidationError'
  }

  toJSON(): { message: string; errors: Record<string, string[]> } {
    return {
      message: this.message,
      errors:  this.errors,
    }
  }
}

export interface AppRequest {
  method:  string
  url:     string
  path:    string
  query:   Record<string, string>
  params:  Record<string, string>
  headers: Record<string, string>
  body:    unknown
  raw:     unknown  // the original server-specific request object

  /**
   * Client IP address. Set by the server adapter when `trustProxy: true`;
   * `undefined` otherwise. Always read from `req.ip` rather than raw headers —
   * the adapter normalises `::1` → `127.0.0.1` and picks the right header.
   */
  ip?: string

  // user?, session?, token? are intentionally absent from this base interface.
  // Each is declared via module augmentation in its owning package:
  //   user?    → @rudderjs/auth   (AuthUser)
  //   session? → @rudderjs/session (SessionInstance)
  //   token?   → @rudderjs/passport / @rudderjs/sanctum
  // Adding them here as `unknown` causes TS2687/TS2717 when the augmentations
  // redeclare them with different types or optionality.

  /**
   * Resolved values for any route parameters bound via `router.bind(name, ...)`.
   * Populated by the router's per-route binding middleware before the handler runs.
   * Absent on routes that have no bound params; the raw string value remains in
   * `req.params[name]` regardless.
   *
   * @example
   * router.bind('user', User)
   * router.get('/users/:user', (req) => req.bound!['user'])
   */
  bound?: Record<string, unknown>

  // ── Typed input accessors ─────────────────────────────────
  // Merge order: params > body > query (params take priority)

  /** Raw merged input value for `key`. */
  input<T = unknown>(key: string, fallback?: T): T
  /** Input as a string. Throws `InputTypeError` if the value is an object or array. */
  string(key: string, fallback?: string): string
  /** Input as an integer. Throws `InputTypeError` if not parseable. */
  integer(key: string, fallback?: number): number
  /** Input as a float. Throws `InputTypeError` if not parseable. */
  float(key: string, fallback?: number): number
  /** Input as a boolean. Truthy: `'true'`,`'1'`,`'yes'`,`'on'`. Falsy: `'false'`,`'0'`,`'no'`,`'off'`. */
  boolean(key: string, fallback?: boolean): boolean
  /** Input parsed as a `Date`. Throws `InputTypeError` if not parseable. */
  date(key: string, fallback?: Date): Date
  /** Input as an array. Accepts arrays, comma-separated strings, or JSON array strings. */
  array(key: string, fallback?: unknown[]): unknown[]
  /** True if the key exists in any input source. */
  has(key: string): boolean
  /** True if the key is absent from all input sources. */
  missing(key: string): boolean
  /** True if key exists and value is non-empty (not null/undefined/''). */
  filled(key: string): boolean
}

// ─── Input accessor factory ───────────────────────────────

/**
 * Attach typed input accessor methods to a plain `AppRequest`-shaped object.
 * Called by server adapters in their request normalizer.
 * Merge priority: params > body > query.
 */
export function attachInputAccessors(req: Record<string, unknown>): void {
  function merged(): Record<string, unknown> {
    const body = typeof req['body'] === 'object' && req['body'] !== null
      ? req['body'] as Record<string, unknown>
      : {}
    return {
      ...(req['query'] as Record<string, unknown>),
      ...body,
      ...(req['params'] as Record<string, unknown>),
    }
  }

  req['input'] = function <T = unknown>(key: string, fallback?: T): T {
    const val = merged()[key]
    return (val !== undefined ? val : fallback) as T
  }

  req['has'] = function (key: string): boolean {
    return merged()[key] !== undefined
  }

  req['missing'] = function (key: string): boolean {
    return merged()[key] === undefined
  }

  req['filled'] = function (key: string): boolean {
    const val = merged()[key]
    return val !== undefined && val !== null && val !== ''
  }

  req['string'] = function (key: string, fallback?: string): string {
    const val = merged()[key]
    if (val === undefined || val === null) return fallback ?? ''
    if (typeof val === 'object') throw new InputTypeError(key, 'string', val)
    return String(val)
  }

  req['integer'] = function (key: string, fallback?: number): number {
    const val = merged()[key]
    if (val === undefined || val === null) return fallback ?? 0
    const n = parseInt(String(val), 10)
    if (isNaN(n)) throw new InputTypeError(key, 'integer', val)
    return n
  }

  req['float'] = function (key: string, fallback?: number): number {
    const val = merged()[key]
    if (val === undefined || val === null) return fallback ?? 0
    const n = parseFloat(String(val))
    if (isNaN(n)) throw new InputTypeError(key, 'float', val)
    return n
  }

  req['boolean'] = function (key: string, fallback?: boolean): boolean {
    const val = merged()[key]
    if (val === undefined || val === null) return fallback ?? false
    if (typeof val === 'boolean') return val
    const str = String(val).toLowerCase().trim()
    if (['true', '1', 'yes', 'on'].includes(str))   return true
    if (['false', '0', 'no', 'off'].includes(str))  return false
    throw new InputTypeError(key, 'boolean', val)
  }

  req['date'] = function (key: string, fallback?: Date): Date {
    const val = merged()[key]
    if (val === undefined || val === null) {
      if (fallback !== undefined) return fallback
      throw new InputTypeError(key, 'date', undefined)
    }
    if (val instanceof Date) return val
    const d = new Date(String(val))
    if (isNaN(d.getTime())) throw new InputTypeError(key, 'date', val)
    return d
  }

  req['array'] = function (key: string, fallback?: unknown[]): unknown[] {
    const val = merged()[key]
    if (val === undefined || val === null) return fallback ?? []
    if (Array.isArray(val)) return val
    if (typeof val === 'string') {
      if (val.startsWith('[')) {
        try { return JSON.parse(val) as unknown[] } catch { /* fall through to CSV */ }
      }
      return val.split(',').map(v => v.trim())
    }
    return [val]
  }
}

export interface AppResponse {
  /** Current response status code (read after middleware chain completes) */
  statusCode: number
  status:  (code: number) => AppResponse
  header:  (key: string, value: string) => AppResponse
  json:    (data: unknown) => void
  send:    (data: string) => void
  redirect:(url: string, code?: number) => void
  raw:     unknown  // the original server-specific response object
}

// ─── Handler & Middleware ──────────────────────────────────

export type RouteHandler = (
  req: AppRequest,
  res: AppResponse
) => unknown | Promise<unknown>

export type MiddlewareHandler = (
  req: AppRequest,
  res: AppResponse,
  next: () => Promise<void>
) => unknown | Promise<unknown>

// ─── HTTP Methods ──────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL'

// ─── Route Groups ──────────────────────────────────────────

/**
 * Route group — Laravel-style middleware scoping.
 * Routes loaded via `withRouting({ web })` are tagged 'web'; via `withRouting({ api })` tagged 'api'.
 * The server adapter prepends the matching group's middleware stack before per-route middleware.
 */
export type RouteGroup = 'web' | 'api'

// ─── Route Definition ──────────────────────────────────────

export interface RouteDefinition {
  method:     HttpMethod
  path:       string
  handler:    RouteHandler
  middleware: MiddlewareHandler[]
  /** Middleware group this route belongs to. Undefined = no group middleware applied. */
  group?:     RouteGroup
  /**
   * Subdomain match template. Plain hosts (`'api.example.com'`) match exact;
   * `:param` segments capture into `req.params` (`':tenant.example.com'`).
   * The server adapter must 404 on host mismatch and merge captured params.
   */
  host?:      string
  /**
   * Custom 404 handler when an explicit route binding (`router.bind(...)`) fails
   * to resolve. The error has duck-typed fields (`httpStatus`, `param`, `value`,
   * `model`) so contracts stays free of `@rudderjs/router`. Return any value the
   * route handler may return — `Response`, plain object → JSON, string → body,
   * or `undefined` if the callback wrote to `res` directly.
   */
  missing?:   (
    req: AppRequest,
    err: Error & { httpStatus: number; param: string; value: string; model: string },
  ) => unknown | Promise<unknown>
}

// ─── Server Adapter Contract ───────────────────────────────

export interface ServerAdapter {
  /** Register a single route */
  registerRoute(route: RouteDefinition): void

  /** Apply a global middleware — runs on every request regardless of route group */
  applyMiddleware(middleware: MiddlewareHandler): void

  /**
   * Apply middleware to a named route group. Routes tagged with this group get
   * these handlers prepended to their per-route middleware chain. Optional —
   * adapters without group support ignore group tags entirely.
   */
  applyGroupMiddleware?(group: RouteGroup, middleware: MiddlewareHandler): void

  /** Register a global error handler — called for any unhandled error thrown by a route */
  setErrorHandler?(handler: (err: unknown, req: AppRequest) => Response | Promise<Response>): void

  /** Start listening on a port */
  listen(port: number, callback?: () => void): void

  /** Return the underlying native server instance (Hono/Express/etc) */
  getNativeServer(): unknown
}

export interface ServerAdapterFactory<TConfig = unknown> {
  (config?: TConfig): ServerAdapterProvider
}

export type FetchHandler = (
  request: Request,
  env?:    unknown,
  ctx?:    unknown
) => Promise<Response>

export interface ServerAdapterProvider {
  /** Identifies the server framework */
  type: string

  /** Create the ServerAdapter instance for decorator routing */
  create(): ServerAdapter

  /** Create the raw native framework app (Hono, H3, …) */
  createApp(): unknown

  /**
   * Create a WinterCG-compatible fetch handler with Vike SSR applied.
   * `setup` receives a ServerAdapter — mount your router onto it.
   */
  createFetchHandler(setup?: (adapter: ServerAdapter) => void): Promise<FetchHandler>
}
