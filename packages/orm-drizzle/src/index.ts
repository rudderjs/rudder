import {
  eq, ne, gt, gte, lt, lte, like, notLike, inArray, notInArray,
  isNull, isNotNull,
  and, or, not, asc, desc, count as sqlCount, sql,
  exists, notExists,
  getTableColumns,
  type Column, type SQL,
} from 'drizzle-orm'
import type {
  AggregateFn,
  AggregateRequest,
  OrmAdapter,
  OrmAdapterProvider,
  QueryBuilder,
  WhereClause,
  WhereOperator,
  OrderClause,
  PaginatedResult,
  RelationExistencePredicate,
  JoinClause,
  Row,
  QueryListener,
} from '@rudderjs/contracts'
import { Expression } from '@rudderjs/contracts'
import { resolveOptionalPeer } from '@rudderjs/support'
// Side effect: wires the DB facade to resolve this app's active ORM adapter.
import '@rudderjs/orm/db-bridge'

/**
 * Turn a raw SQL fragment with `?` placeholders + a positional `bindings` array
 * into a Drizzle `SQL` chunk, parameterizing each value (so it's bound, not
 * interpolated) while splicing the surrounding text verbatim. Mirrors the native
 * engine's `compileRaw`. `?` count must equal `bindings.length`.
 */
function rawToSql(fragment: string, bindings: readonly unknown[]): SQL {
  const parts = fragment.split('?')
  const holes = parts.length - 1
  if (holes !== bindings.length) {
    throw new Error(
      `[RudderJS ORM Drizzle] Raw SQL expects ${holes} binding(s) for its '?' placeholders but got ${bindings.length}: ${fragment}`,
    )
  }
  const chunks: SQL[] = []
  parts.forEach((part, i) => {
    if (part) chunks.push(sql.raw(part) as SQL)
    if (i < holes) chunks.push(sql`${bindings[i]}` as SQL)
  })
  return (chunks.length ? sql.join(chunks) : sql.raw('')) as SQL
}

/** The date/time component a `whereDate`/`whereTime`/`whereDay`/`whereMonth`/
 *  `whereYear` predicate extracts before comparing (same contract as the native
 *  engine's `Dialect.dateExtract`). */
type DatePart = 'date' | 'time' | 'day' | 'month' | 'year'

/**
 * Normalize a date-helper comparison value for binding — a LOCAL COPY of the
 * native engine's `normalizeDatePartValue` (that one lives in the node-only
 * native module; duplicating ~15 lines beats importing across the boundary):
 * `Date` → the matching **UTC** component ('YYYY-MM-DD' / 'HH:MM:SS' / ints);
 * numeric strings on day/month/year → `Number` (so `'05'` matches an INTEGER
 * extraction); everything else binds as-is.
 */
function normalizeDatePartValue(part: DatePart, value: unknown): unknown {
  if (value instanceof Date) {
    switch (part) {
      case 'date':  return value.toISOString().slice(0, 10)
      case 'time':  return value.toISOString().slice(11, 19)
      case 'day':   return value.getUTCDate()
      case 'month': return value.getUTCMonth() + 1
      case 'year':  return value.getUTCFullYear()
    }
  }
  if ((part === 'day' || part === 'month' || part === 'year') && typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value)
  }
  return value
}

/** Global-registry symbol the ORM's `HydratingQueryBuilder` Proxy answers with
 *  its wrapped adapter builder. `union(other)` reads it to unwrap a passed proxy
 *  back to the underlying `DrizzleQueryBuilder` so it can build the member's
 *  select body. `Symbol.for` (not an imported value) — same pattern as the
 *  native engine's query-builder. */
const QB_TARGET = Symbol.for('rudderjs.orm.qb.target')

// ─── Minimal Drizzle DB interface ──────────────────────────

// Drizzle DB instances share a common fluent query API regardless of driver.
// We capture only the subset this adapter uses so we don't import driver-specific types.
type DrizzleQB = {
  where(cond: SQL): DrizzleQB
  innerJoin(table: unknown, on: SQL): DrizzleQB
  leftJoin(table: unknown, on: SQL): DrizzleQB
  rightJoin(table: unknown, on: SQL): DrizzleQB
  crossJoin(table: unknown): DrizzleQB
  groupBy(...cols: (SQL | Column)[]): DrizzleQB
  having(cond: SQL): DrizzleQB
  /** Set operators — chain another finished select as `UNION [ALL]`. An
   *  `orderBy`/`limit`/`offset` applied AFTER a set operator attaches to the
   *  whole compound (Drizzle renders it at the end, auto-unqualifying order
   *  columns to plain identifiers as set-operation SQL requires). */
  union(other: DrizzleQB): DrizzleQB
  unionAll(other: DrizzleQB): DrizzleQB
  /** Pessimistic locking clause (`FOR UPDATE` / `FOR SHARE`) — present on the
   *  pg + mysql Drizzle select builders, ABSENT on sqlite (no row locks there;
   *  the adapter no-ops the lock on the sqlite dialect, like the native engine). */
  for(strength: 'update' | 'share'): DrizzleQB
  orderBy(...cols: SQL[]): DrizzleQB
  limit(n: number): DrizzleQB
  offset(n: number): DrizzleQB
  returning(): DrizzleQB
  set(data: unknown): DrizzleQB
  values(data: unknown): DrizzleQB
  /** Wrap a finished select as a named subquery (passable to `.from()`).
   *  Used to count groups / distinct rows by COUNT(*)-ing the subquery. */
  as(alias: string): unknown
  then<TResult>(onfulfilled: (value: unknown) => TResult): Promise<TResult>
}

type DrizzleDb = {
  select(fields?: Record<string, unknown>): { from(table: unknown): DrizzleQB }
  selectDistinct(fields?: Record<string, unknown>): { from(table: unknown): DrizzleQB }
  insert(table: unknown): { values(data: unknown): DrizzleQB }
  update(table: unknown): { set(data: unknown): DrizzleQB }
  delete(table: unknown): DrizzleQB
  /** Optional — present on Postgres / libsql Drizzle drivers. Vector
   *  queries route through `execute(sql)` because pgvector ops can't
   *  be expressed via the fluent select API. */
  execute?(query: SQL): Promise<unknown>
  /** Open a transaction. Drizzle's tx object is itself a `DrizzleDb` whose own
   *  `transaction()` opens a nested SAVEPOINT — so the adapter gets cross-adapter
   *  `transaction()` + nesting for free by re-binding to the scoped `tx`. */
  transaction?<T>(fn: (tx: DrizzleDb) => Promise<T>): Promise<T>
  $client?: { end?: () => Promise<void> }
}

// ─── Global Table Registry ─────────────────────────────────

/**
 * Global name → Drizzle table schema map.
 *
 * The Drizzle adapter resolves related-table schemas by name (e.g. for
 * `whereHas('comments', ...)` it needs the `comments` table to build the
 * EXISTS subquery). Apps register their schemas via the `tables` option on
 * `drizzle({ tables: { posts, comments, ... } })`, which proxies into this
 * registry. Library code that needs to register tables outside the
 * adapter's normal init path can call `DrizzleTableRegistry.register()`
 * directly.
 *
 * **Required for `whereHas` / `withAggregate` on Drizzle.** Without a
 * registered schema the adapter throws a clear "no table schema registered
 * for X" error. Prisma's adapter discovers schemas via the generated client
 * and needs no registry — this is Drizzle-specific.
 *
 * @example
 * import { drizzle, DrizzleTableRegistry } from '@rudderjs/orm-drizzle'
 * import { posts, comments } from './schema.js'
 *
 * // Typical: register at adapter init
 * drizzle({ tables: { posts, comments } })
 *
 * // Or imperatively (e.g. tests, dynamic registration)
 * DrizzleTableRegistry.register('comments', comments)
 */
export class DrizzleTableRegistry {
  private static tables: Map<string, unknown> = new Map()

  /** Register a Drizzle table schema by name. Idempotent — last write wins. */
  static register(name: string, table: unknown): void {
    this.tables.set(name, table)
  }

  /** Look up a previously-registered table schema by name. */
  static get(name: string): unknown | undefined {
    return this.tables.get(name)
  }
}

/**
 * @internal — type-erase a Drizzle query builder.
 *
 * Drizzle's query builders are thenable: chaining `.select().from().where()`
 * returns a builder that resolves to row results when awaited. The builder
 * type carries the full chained shape, which is incompatible with our
 * `Promise<T[]>` adapter contract. Rather than peppering every CRUD method
 * with `as unknown as Promise<T[]>`, route every await through `exec<R>(q)`
 * — one cast site, one place to update if Drizzle's API tightens.
 */
function exec<R>(q: unknown): Promise<R> {
  return q as Promise<R>
}

/**
 * Report one executed query to the registered `onQuery` / `DB.listen` listeners.
 * Best-effort, Laravel `QueryExecuted` parity (same contract as the native
 * engine's `instrumentExecutor`): a throwing listener is swallowed — a broken
 * Telescope collector must never fail the query — and callers only emit on
 * *successful* executions. The listener array is snapshotted so a listener
 * registering/removing listeners mid-emit is safe.
 */
function emitQueryEvent(
  listeners:  readonly QueryListener[],
  sqlText:    string,
  bindings:   readonly unknown[],
  startedAt:  number,
  connection: string | undefined,
): void {
  if (listeners.length === 0) return
  const duration = performance.now() - startedAt
  for (const listener of [...listeners]) {
    try {
      listener({ sql: sqlText, bindings: [...bindings], duration, connection })
    } catch {
      // Listener errors must never break the query.
    }
  }
}

/** SQL dialect threaded through the adapter to drive capability branching —
 *  `RETURNING` support on Postgres/SQLite vs `affectedRows` on MySQL. */
export type DrizzleDialect = 'pg' | 'mysql' | 'sqlite'

/**
 * @internal — affected-row count for UPDATE/DELETE.
 *
 * Postgres + SQLite expose row counts via `.returning()` (which we then take
 * `.length` of). MySQL drivers don't support `RETURNING`; their result
 * metadata carries the count on `affectedRows` (mysql2) or `rowsAffected`
 * (planetscale-serverless). We branch on dialect rather than sniffing the
 * result shape because MySQL `.returning()` is a no-op that silently returns
 * the empty array — there's no way to distinguish "zero rows matched" from
 * "driver didn't support it" at the value level.
 */
async function affectedRowCount(q: unknown, dialect: DrizzleDialect): Promise<number> {
  if (dialect === 'mysql') {
    const result = await (q as Promise<unknown>)
    const r = result as { affectedRows?: number; rowsAffected?: number }
    return r.affectedRows ?? r.rowsAffected ?? 0
  }
  const r = (q as { returning: () => Promise<unknown[]> }).returning
  const result = await r.call(q)
  return Array.isArray(result) ? result.length : 0
}

/** @internal — combine SQL exprs with AND. Single-element returns as-is so
 *  callers don't pay an extra wrap. Empty input returns a tautology so
 *  EXISTS subqueries with no inner predicate stay valid. */
function _andSql(exprs: SQL[]): SQL {
  if (exprs.length === 0) return sql`1 = 1` as SQL
  if (exprs.length === 1) return exprs[0]!
  return and(...exprs) as SQL
}

/**
 * Serialize a `number[]` into pgvector's text literal format —
 * `'[0.1,0.2,0.3]'` (without surrounding quotes; caller wraps the
 * result in `${vec}::vector` so Drizzle binds it as a string parameter
 * and the cast happens server-side). Mirrors `vectorLiteral` in
 * `@rudderjs/orm-prisma`.
 */
function vectorLiteral(vec: readonly number[]): string {
  return `[${vec.join(',')}]`
}

/**
 * Resolve the deferred auto-embed for `whereVectorSimilarTo('col',
 * '<text>', { embedWith })` (#B7 Phase 3). Pulls `@rudderjs/ai`
 * lazily via `resolveOptionalPeer` so the orm-drizzle adapter never
 * hard-deps on the AI package — apps that don't do RAG don't load it.
 * Mirrors `resolveAutoEmbed` in `@rudderjs/orm-prisma`.
 */
async function resolveAutoEmbed(pending: { text: string; embedWith: string } | undefined): Promise<number[]> {
  if (!pending) {
    throw new Error(
      '[RudderJS ORM] Vector clause has neither a number[] query nor a deferred embed. ' +
      'This is a bug — please report it.',
    )
  }

  type AiModule = { AI: { embed(input: string, opts: { model: string }): Promise<{ embeddings: number[][] }> } }
  let ai: AiModule
  try {
    ai = await resolveOptionalPeer<AiModule>('@rudderjs/ai')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      '[RudderJS ORM] whereVectorSimilarTo string-query auto-embed requires @rudderjs/ai. ' +
      'Run `pnpm add @rudderjs/ai`, or pre-embed via your own embedder and pass number[] instead. ' +
      `Original: ${msg}`,
      { cause: err },
    )
  }

  const result = await ai.AI.embed(pending.text, { model: pending.embedWith })
  const vec = result.embeddings[0]
  if (!vec || vec.length === 0) {
    throw new Error(
      `[RudderJS ORM] AI.embed("${pending.text}", { model: "${pending.embedWith}" }) returned no embedding.`,
    )
  }
  return vec
}

// ─── Drizzle Query Builder ─────────────────────────────────

class DrizzleQueryBuilder<T> implements QueryBuilder<T> {
  private _wheres:      WhereClause[] = []
  private _orWheres:    WhereClause[] = []
  /** Ordered list of ORDER BY entries — structured `{column,direction}` or a
   *  raw `{ rawSql }` fragment (`orderByRaw` / `orderBy(raw(...))`). One list so
   *  structured and raw orders keep their interleaved insertion order. */
  private _orders:      Array<OrderClause | { rawSql: SQL }> = []
  private _limitN:      number | null = null
  private _offsetN:     number | null = null
  private _withTrashed  = false
  private _onlyTrashed  = false
  private _softDeletes  = false
  /** Extra SQL expressions AND-merged into buildConditions(). Populated by
   *  whereRelationExists with `EXISTS` / `NOT EXISTS` correlated subqueries
   *  and by `whereGroup` with the sub-builder's combined SQL. */
  private _extraExprs:  SQL[] = []
  /** OR-merged SQL expressions. Populated by `orWhereGroup` — each entry is
   *  added to the top-level OR list alongside flat `_orWheres`. */
  private _orExtraExprs: SQL[] = []
  /** Aggregate eager-load requests. Each becomes one correlated subselect in
   *  the SELECT list of the main query (run once per terminal call). */
  private _aggregates: AggregateRequest[] = []
  /** JOIN clauses — `{ kind, table (drizzle obj), on (null for cross) }`. Applied
   *  after `.from()` in every read terminal. */
  private _joins: Array<{ kind: 'inner' | 'left' | 'right' | 'cross'; table: unknown; on: SQL | null }> = []
  /** Structured projection from `select(...)` — qualified names; replaces `*`. */
  private _selectCols: string[] = []
  /** SELECT DISTINCT toggle (`distinct()`). */
  private _distinct = false
  /** GROUP BY columns — qualified `table.col` allowed (resolved like select). */
  private _groupBy: string[] = []
  /** HAVING clauses — structured column/op/value (AND + OR) plus raw fragments,
   *  mirroring the WHERE accumulators. Combined by `buildHaving()`. */
  private _havings:       WhereClause[] = []
  private _orHavings:     WhereClause[] = []
  private _havingExprs:   SQL[] = []
  private _orHavingExprs: SQL[] = []
  /** UNION members — each is another DrizzleQueryBuilder whose select body
   *  (projection → HAVING, no ORDER/LIMIT) chains onto the base query via
   *  Drizzle's `.union()`/`.unionAll()`. The BASE query's ORDER BY / LIMIT /
   *  OFFSET apply to the combined result; member ORDER/LIMIT are dropped
   *  (mirrors the native engine's union semantics). */
  private _unions: Array<{ all: boolean; qb: DrizzleQueryBuilder<T> }> = []
  /** Pessimistic row lock (`lockForUpdate()` / `sharedLock()`). Rendered via
   *  Drizzle's `.for('update' | 'share')` on pg/mysql; NO-OP on sqlite (no row
   *  locks — its write transaction already serializes; same as the native
   *  engine's `lockSql`). Only meaningful inside a `transaction()`. */
  private _lock: 'update' | 'share' | null = null
  /** When true, terminal methods throw — sub-builders are for `where*` chaining only. */
  private _isSubBuilder = false

  /** pgvector similarity clause (#B7 Phase 3 — Postgres + pgvector only).
   *  When set, terminal methods switch to `db.execute(sql\`SELECT ... ORDER BY
   *  col <op> vec\`)` which bypasses the fluent select API (no native pgvector
   *  ops there). Mirrors the orm-prisma adapter's `_vectorClause`. */
  private _vectorClause: {
    column:        string
    query:         number[] | null
    pendingEmbed?: { text: string; embedWith: string }
    minSimilarity?: number
    metric:        'cosine' | 'l2' | 'inner-product'
  } | null = null

  /** Optional projected distance column added to vector-query result rows. */
  private _selectVectorDist: { column: string; query: number[]; alias: string } | null = null

  constructor(
    private readonly db:         DrizzleDb,
    private readonly table:      unknown,
    private readonly primaryKey: string,
    /** Resolves a table name to its drizzle table object. Required for
     *  whereRelationExists to build correlated subqueries against the
     *  related (and pivot) tables. */
    private readonly resolveTable: (name: string) => unknown,
    /** SQL dialect — drives RETURNING vs affectedRows branching for
     *  `increment` / `decrement` / `deleteAll` / `updateAll`. */
    private readonly dialect:    DrizzleDialect = 'pg',
    /** Query listeners (`onQuery` / `DB.listen`) — shared BY REFERENCE with the
     *  owning adapter (and through it, transaction-scoped adapters), so every
     *  builder reports to the same list. Empty = zero-overhead fast path. */
    private readonly listeners:  readonly QueryListener[] = [],
  ) {}

  /** @internal — await a built Drizzle query, reporting it to the registered
   *  query listeners (SQL text + params via the builder's `toSQL()`, wall-clock
   *  duration). The no-listener path is a plain `exec` passthrough; only
   *  successful executions report (Laravel `QueryExecuted` parity). */
  private async _run<R>(q: unknown): Promise<R> {
    if (this.listeners.length === 0) return exec<R>(q)
    const startedAt = performance.now()
    const result = await exec<R>(q)
    try {
      const { sql: text, params } = (q as { toSQL(): { sql: string; params: unknown[] } }).toSQL()
      emitQueryEvent(this.listeners, text, params, startedAt, this.dialect)
    } catch {
      // A query object without toSQL() (not a fluent builder) — skip reporting
      // rather than break the read.
    }
    return result
  }

  /** @internal — mark this builder as a sub-builder so terminals throw. */
  _markSubBuilder(): this { this._isSubBuilder = true; return this }

  private _assertNotSubBuilder(): void {
    if (this._isSubBuilder) {
      throw new Error(
        '[RudderJS ORM] Sub-builder is for where* chaining only — call get() on the parent builder.',
      )
    }
  }

  where(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    if (value === undefined) {
      this._wheres.push({ column, operator: '=', value: operatorOrValue })
    } else {
      this._wheres.push({ column, operator: operatorOrValue as WhereOperator, value })
    }
    return this
  }

  orWhere(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    if (value === undefined) {
      this._orWheres.push({ column, operator: '=', value: operatorOrValue })
    } else {
      this._orWheres.push({ column, operator: operatorOrValue as WhereOperator, value })
    }
    return this
  }

  whereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    const sub = new DrizzleQueryBuilder<T>(this.db, this.table, this.primaryKey, this.resolveTable, this.dialect)
      ._markSubBuilder()
    fn(sub)
    const expr = sub.buildConditions()
    if (expr) this._extraExprs.push(expr)
    return this
  }

  orWhereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    const sub = new DrizzleQueryBuilder<T>(this.db, this.table, this.primaryKey, this.resolveTable, this.dialect)
      ._markSubBuilder()
    fn(sub)
    const expr = sub.buildConditions()
    if (expr) this._orExtraExprs.push(expr)
    return this
  }

  orderBy(column: string | Expression, direction: 'ASC' | 'DESC' = 'ASC'): this {
    if (column instanceof Expression) {
      this._orders.push({ rawSql: sql.raw(String(column.getValue())) as SQL })
    } else {
      this._orders.push({ column, direction })
    }
    return this
  }

  // ── raw-SQL escape hatch ─────────────────────────────────

  selectRaw(_sql: string, _bindings: readonly unknown[] = []): this {
    throw new Error(
      '[RudderJS ORM Drizzle] selectRaw() is not supported — Drizzle\'s typed select can\'t map an arbitrary raw projection back to hydrated models. Run the raw query via the DB facade: DB.select(sql, bindings).',
    )
  }

  whereRaw(rawSql: string, bindings: readonly unknown[] = []): this {
    this._extraExprs.push(rawToSql(rawSql, bindings))
    return this
  }

  orWhereRaw(rawSql: string, bindings: readonly unknown[] = []): this {
    this._orExtraExprs.push(rawToSql(rawSql, bindings))
    return this
  }

  // ── column-vs-column (whereColumn) ───────────────────────
  // Both sides render as Drizzle column refs (quoted per dialect), so unlike
  // whereRaw nothing is verbatim. Two-arg form is equality; three-arg carries
  // the operator (injected raw, like clauseToExprOn does for value operators).
  whereColumn(left: string, operatorOrRight: string, right?: string): this {
    this._extraExprs.push(this._columnExpr(left, operatorOrRight, right))
    return this
  }

  orWhereColumn(left: string, operatorOrRight: string, right?: string): this {
    this._orExtraExprs.push(this._columnExpr(left, operatorOrRight, right))
    return this
  }

  private _columnExpr(left: string, operatorOrRight: string, right?: string): SQL {
    const operator = right === undefined ? '=' : operatorOrRight
    const rightCol = right === undefined ? operatorOrRight : right
    return sql`${this.col(left) as Column} ${sql.raw(operator)} ${this.col(rightCol) as Column}` as SQL
  }

  // ── date-component predicates (whereDate / whereTime / whereDay / …) ──
  // Same surface + semantics as the native engine (#857): two-arg = equality,
  // three-arg carries the operator; the column runs through a per-dialect
  // extraction expression and the value binds. The extraction SQL mirrors the
  // native `Dialect.dateExtract` per dialect.

  whereDate(column: string, operatorOrValue: unknown, value?: unknown): this {
    this._extraExprs.push(this._datePartExpr('date', column, operatorOrValue, value)); return this
  }
  orWhereDate(column: string, operatorOrValue: unknown, value?: unknown): this {
    this._orExtraExprs.push(this._datePartExpr('date', column, operatorOrValue, value)); return this
  }
  whereTime(column: string, operatorOrValue: unknown, value?: unknown): this {
    this._extraExprs.push(this._datePartExpr('time', column, operatorOrValue, value)); return this
  }
  orWhereTime(column: string, operatorOrValue: unknown, value?: unknown): this {
    this._orExtraExprs.push(this._datePartExpr('time', column, operatorOrValue, value)); return this
  }
  whereDay(column: string, operatorOrValue: unknown, value?: unknown): this {
    this._extraExprs.push(this._datePartExpr('day', column, operatorOrValue, value)); return this
  }
  orWhereDay(column: string, operatorOrValue: unknown, value?: unknown): this {
    this._orExtraExprs.push(this._datePartExpr('day', column, operatorOrValue, value)); return this
  }
  whereMonth(column: string, operatorOrValue: unknown, value?: unknown): this {
    this._extraExprs.push(this._datePartExpr('month', column, operatorOrValue, value)); return this
  }
  orWhereMonth(column: string, operatorOrValue: unknown, value?: unknown): this {
    this._orExtraExprs.push(this._datePartExpr('month', column, operatorOrValue, value)); return this
  }
  whereYear(column: string, operatorOrValue: unknown, value?: unknown): this {
    this._extraExprs.push(this._datePartExpr('year', column, operatorOrValue, value)); return this
  }
  orWhereYear(column: string, operatorOrValue: unknown, value?: unknown): this {
    this._orExtraExprs.push(this._datePartExpr('year', column, operatorOrValue, value)); return this
  }

  private _datePartExpr(part: DatePart, column: string, operatorOrValue: unknown, value?: unknown): SQL {
    // Two-arg form means equality; three-arg carries the operator in the middle.
    const operator  = (value === undefined ? '=' : operatorOrValue) as string
    const rawValue  = value === undefined ? operatorOrValue : value
    const bound     = normalizeDatePartValue(part, rawValue)
    const extracted = this._dateExtractExpr(part, this.col(column) as Column)
    return sql`${extracted} ${sql.raw(operator)} ${bound}` as SQL
  }

  /** @internal — the per-dialect date-component extraction expression. Mirrors
   *  the native engine's `Dialect.dateExtract`: sqlite `strftime` (CAST to
   *  INTEGER for day/month/year — strftime returns zero-padded TEXT and SQLite
   *  never equates TEXT with INTEGER), pg `::date`/`::time`/`EXTRACT(...)::int`,
   *  mysql `DATE()`/`TIME()`/`DAY()`/`MONTH()`/`YEAR()`. */
  private _dateExtractExpr(part: DatePart, col: Column): SQL {
    if (this.dialect === 'pg') {
      switch (part) {
        case 'date':  return sql`${col}::date` as SQL
        case 'time':  return sql`${col}::time` as SQL
        case 'day':   return sql`EXTRACT(DAY FROM ${col})::int` as SQL
        case 'month': return sql`EXTRACT(MONTH FROM ${col})::int` as SQL
        case 'year':  return sql`EXTRACT(YEAR FROM ${col})::int` as SQL
      }
    }
    if (this.dialect === 'mysql') {
      switch (part) {
        case 'date':  return sql`DATE(${col})` as SQL
        case 'time':  return sql`TIME(${col})` as SQL
        case 'day':   return sql`DAY(${col})` as SQL
        case 'month': return sql`MONTH(${col})` as SQL
        case 'year':  return sql`YEAR(${col})` as SQL
      }
    }
    switch (part) {
      case 'date':  return sql`strftime('%Y-%m-%d', ${col})` as SQL
      case 'time':  return sql`strftime('%H:%M:%S', ${col})` as SQL
      case 'day':   return sql`CAST(strftime('%d', ${col}) AS INTEGER)` as SQL
      case 'month': return sql`CAST(strftime('%m', ${col}) AS INTEGER)` as SQL
      case 'year':  return sql`CAST(strftime('%Y', ${col}) AS INTEGER)` as SQL
    }
  }

  // ── negated groups (whereNot / orWhereNot) ───────────────
  // Same surface as the native engine (#857): the callback's conditions wrap in
  // NOT (…) via Drizzle's `not()`; an empty callback is a no-op. The hydrating
  // proxy wraps the sub-builder, so named sugar (whereIn/whereNull/…) composes
  // inside the callback.

  whereNot(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    const expr = this._negatedGroupExpr(fn)
    if (expr) this._extraExprs.push(expr)
    return this
  }

  orWhereNot(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    const expr = this._negatedGroupExpr(fn)
    if (expr) this._orExtraExprs.push(expr)
    return this
  }

  private _negatedGroupExpr(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): SQL | undefined {
    const sub = new DrizzleQueryBuilder<T>(this.db, this.table, this.primaryKey, this.resolveTable, this.dialect)
      ._markSubBuilder()
    fn(sub)
    const inner = sub.buildConditions()
    return inner ? (not(inner) as SQL) : undefined
  }

  orderByRaw(rawSql: string, bindings: readonly unknown[] = []): this {
    this._orders.push({ rawSql: rawToSql(rawSql, bindings) })
    return this
  }

  // ── joins + structured projection ────────────────────────
  // Real Drizzle joins. The referenced tables must be registered (via `tables:`
  // config or DrizzleTableRegistry) — same requirement as whereHas. With a join
  // and no explicit `select(...)`, the projection defaults to the BASE table's
  // columns so each row still hydrates as the base model (the join filters/fans
  // out rows but the shape stays flat). `select(...)` overrides the projection.

  select(...columns: string[]): this {
    this._selectCols.push(...columns)
    return this
  }

  join(table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): this {
    return this._addJoin('inner', table, first, operator, second)
  }

  leftJoin(table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): this {
    return this._addJoin('left', table, first, operator, second)
  }

  rightJoin(table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): this {
    return this._addJoin('right', table, first, operator, second)
  }

  crossJoin(table: string): this {
    const tbl = this.resolveTable(table)
    if (!tbl) throw new Error(`[RudderJS ORM Drizzle] crossJoin("${table}") — table not registered (pass tables: { ${table}: ... }).`)
    this._joins.push({ kind: 'cross', table: tbl, on: null })
    return this
  }

  private _addJoin(
    kind: 'inner' | 'left' | 'right',
    table: string,
    first: string | ((join: JoinClause) => void),
    operator?: WhereOperator,
    second?: string,
  ): this {
    const tbl = this.resolveTable(table)
    if (!tbl) {
      throw new Error(
        `[RudderJS ORM Drizzle] join("${table}") — table not registered. Pass tables: { ${table}: myTable } in drizzle() config or call DrizzleTableRegistry.register("${table}", myTable).`,
      )
    }
    let on: SQL
    if (typeof first === 'function') {
      const jc = new DrizzleJoinClause(this)
      first(jc)
      on = jc.build()
    } else {
      // Two-arg ON (`join(t, 'a', 'b')`) is equality; three-arg carries the operator.
      const op    = (second === undefined ? '=' : operator) as WhereOperator
      const right = second === undefined ? (operator as string) : second
      on = this._joinOnExpr(first, op, right)
    }
    this._joins.push({ kind, table: tbl, on })
    return this
  }

  /** @internal — chain the accumulated joins onto a built select query. */
  private _applyJoins(q: DrizzleQB): DrizzleQB {
    for (const j of this._joins) {
      if (j.kind === 'cross') q = q.crossJoin(j.table)
      else if (j.kind === 'inner') q = q.innerJoin(j.table, j.on as SQL)
      else if (j.kind === 'left')  q = q.leftJoin(j.table, j.on as SQL)
      else                         q = q.rightJoin(j.table, j.on as SQL)
    }
    return q
  }

  // ── distinct / groupBy / having (real Drizzle) ───────────
  // Drizzle exposes `.selectDistinct()`, `.groupBy()` and `.having()` natively,
  // so these map straight onto the fluent builder. Projecting a GROUP BY
  // aggregate (e.g. `COUNT(*) AS total`) still needs `selectRaw`, which throws
  // here — so HAVING on an aggregate goes through `havingRaw('COUNT(*) > ?')`,
  // not `having('total', ...)` against a non-projected alias.

  distinct(): this { this._distinct = true; return this }

  groupBy(...columns: string[]): this {
    this._groupBy.push(...columns)
    return this
  }

  having(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    if (value === undefined) this._havings.push({ column, operator: '=', value: operatorOrValue })
    else                     this._havings.push({ column, operator: operatorOrValue as WhereOperator, value })
    return this
  }

  orHaving(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    if (value === undefined) this._orHavings.push({ column, operator: '=', value: operatorOrValue })
    else                     this._orHavings.push({ column, operator: operatorOrValue as WhereOperator, value })
    return this
  }

  havingRaw(rawSql: string, bindings: readonly unknown[] = []): this {
    this._havingExprs.push(rawToSql(rawSql, bindings))
    return this
  }

  orHavingRaw(rawSql: string, bindings: readonly unknown[] = []): this {
    this._orHavingExprs.push(rawToSql(rawSql, bindings))
    return this
  }

  // ── unions ───────────────────────────────────────────────
  // Real Drizzle set operators. The base query's ORDER BY / LIMIT / OFFSET
  // apply to the COMBINED result (Drizzle attaches a post-union orderBy/limit
  // to the whole compound); a member's own ORDER/LIMIT are dropped — same
  // semantics as the native engine. Projections must be union-compatible
  // (same column count/order), as in raw SQL.

  /** `… UNION …` — append another query as a UNION member (duplicate rows
   *  removed). `other` is another Drizzle-adapter query (`Model.query()`). */
  union(other: QueryBuilder<T>): this { return this._addUnion(other, false) }

  /** `… UNION ALL …` — like {@link union} but keeps duplicate rows. */
  unionAll(other: QueryBuilder<T>): this { return this._addUnion(other, true) }

  private _addUnion(other: QueryBuilder<T>, all: boolean): this {
    // `other` is usually the HydratingQueryBuilder Proxy wrapping a
    // DrizzleQueryBuilder — unwrap it via the global symbol the proxy answers.
    const target = (other as unknown as Record<symbol, unknown>)[QB_TARGET] ?? other
    if (!(target instanceof DrizzleQueryBuilder)) {
      throw new Error(
        '[RudderJS ORM Drizzle] union()/unionAll() requires another Drizzle query builder — pass a Model.query() of a Drizzle-adapter model.',
      )
    }
    this._unions.push({ all, qb: target as DrizzleQueryBuilder<T> })
    return this
  }

  limit(n: number):  this { this._limitN  = n; return this }
  offset(n: number): this { this._offsetN = n; return this }

  /** Pessimistic `FOR UPDATE` row lock — writers AND locking readers block until
   *  commit. Renders via Drizzle's `.for('update')` on pg/mysql; no-op on sqlite
   *  (no row locks — its write transaction already serializes, matching the
   *  native engine). Only meaningful inside a `transaction()`. */
  lockForUpdate(): this { this._lock = 'update'; return this }

  /** Shared `FOR SHARE` row lock — readers proceed, writers block until commit.
   *  Same dialect handling as {@link lockForUpdate}. */
  sharedLock(): this { this._lock = 'share'; return this }

  // A normal `Model.with('relation')` no longer reaches this method: the
  // adapter advertises `eagerLoadStrategy = 'model-layer'`, so the ORM resolves
  // direct relations in its Model layer (batched WHERE-IN, stitched onto the
  // parents) instead of forwarding the name here. This QB-level `with()` is now
  // only hit by the `withWhereHas` constrained-eager fallback (`q.with(rel)`),
  // which Drizzle still can't satisfy — its relational query API needs
  // pre-declared `relations()` schemas the adapter doesn't hold. Throw there so
  // a constrained eager-load can't masquerade as success.
  with(...relations: string[]): this {
    if (relations.length === 0) return this
    throw new Error(
      `[RudderJS ORM Drizzle] Constrained eager loading via withWhereHas(${relations.map((r) => `'${r}'`).join(', ')}) ` +
        `is not implemented on the Drizzle adapter. ` +
        `Plain eager loading (\`Model.with('${relations[0]}')\`) IS supported. ` +
        `For filtering by a relation's existence only, use whereHas('${relations[0]}') ` +
        `(it never eager-loads). To load related rows under a constraint, load them explicitly with ` +
        `the related() accessor (e.g. \`await parent.related('${relations[0]}').where(...).get()\`).`,
    )
  }

  // No-op at the adapter level — pivot column projection is handled in the
  // ORM's deferred-QB closure (see `_belongsToManyDeferredQb` and morph
  // siblings). Apps calling `Model.query().withPivot(...)` outside a pivot
  // relation get a silent no-op.
  withPivot(..._columns: string[]): this { return this }

  withTrashed(): this  { this._withTrashed = true; return this }
  onlyTrashed(): this  { this._onlyTrashed = true; return this }

  /** @internal — called by Model to enable automatic soft delete filtering */
  _enableSoftDeletes(): this { this._softDeletes = true; return this }

  private col(column: string): unknown {
    return (this.table as Record<string, unknown>)[column]
  }

  /** @internal — resolve a column on an arbitrary table; shared with the
   *  whereRelationExists subquery builder. */
  private colOf(table: unknown, column: string): Column {
    return (table as Record<string, unknown>)[column] as Column
  }

  private clauseToExpr(clause: WhereClause): SQL {
    return this.clauseToExprOn(this.table, clause)
  }

  /** Same shape as clauseToExpr but parameterised by the column owner —
   *  used to AND constraint clauses into a whereHas inner subquery. */
  private clauseToExprOn(table: unknown, clause: WhereClause): SQL {
    const col = this.colOf(table, clause.column)
    // `where(col, op, raw('NOW()'))` — splice the expression verbatim, no bind.
    // The WhereOperator string IS its SQL text, so reuse it directly.
    if (clause.value instanceof Expression) {
      return sql`${col} ${sql.raw(clause.operator)} ${sql.raw(String(clause.value.getValue()))}` as SQL
    }
    return this._compareValue(col, clause.operator, clause.value)
  }

  /** @internal — column-vs-value comparison → a Drizzle SQL expression. Shared by
   *  `clauseToExprOn` and the join-clause `where()`. */
  private _compareValue(col: Column, operator: WhereOperator, value: unknown): SQL {
    switch (operator) {
      case '=':      return eq(col, value) as SQL
      case '!=':     return ne(col, value) as SQL
      case '>':      return gt(col, value) as SQL
      case '>=':     return gte(col, value) as SQL
      case '<':      return lt(col, value) as SQL
      case '<=':     return lte(col, value) as SQL
      case 'LIKE':     return like(col, value as string) as SQL
      case 'NOT LIKE': return notLike(col, value as string) as SQL
      case 'IN':       return inArray(col, value as unknown[]) as SQL
      case 'NOT IN': return notInArray(col, value as unknown[]) as SQL
      default: {
        const _exhaustive: never = operator
        throw new Error(`[RudderJS ORM Drizzle] Unsupported operator: ${String(_exhaustive)}`)
      }
    }
  }

  /** @internal — resolve a (possibly qualified `table.col`) name to a Drizzle
   *  column. Bare names resolve on the base table; `posts.userId` resolves the
   *  `posts` table via the registry (same requirement as whereHas). */
  private resolveColumn(name: string): Column {
    const dot = name.indexOf('.')
    if (dot === -1) return this.col(name) as Column
    const tableName = name.slice(0, dot)
    const colName   = name.slice(dot + 1)
    const tbl = this.resolveTable(tableName)
    if (!tbl) {
      throw new Error(
        `[RudderJS ORM Drizzle] join references table "${tableName}" which isn't registered. ` +
        `Pass tables: { ${tableName}: myTable } in drizzle() config or call DrizzleTableRegistry.register("${tableName}", myTable).`,
      )
    }
    return this.colOf(tbl, colName)
  }

  /** @internal — column-vs-column ON expression for a join clause. Operator text
   *  is spliced raw (it IS its own SQL), both columns are resolved + bound. */
  _joinOnExpr(left: string, operator: WhereOperator, right: string): SQL {
    return sql`${this.resolveColumn(left)} ${sql.raw(operator)} ${this.resolveColumn(right)}` as SQL
  }

  /** @internal — column-vs-value predicate inside a join's ON clause. */
  _joinWhereExpr(column: string, operator: WhereOperator, value: unknown): SQL {
    return this._compareValue(this.resolveColumn(column), operator, value)
  }

  whereVectorSimilarTo(
    column: string,
    query:  number[] | string,
    opts?:  { minSimilarity?: number; metric?: 'cosine' | 'l2' | 'inner-product'; embedWith?: string },
  ): this {
    if (typeof query === 'string') {
      // Phase 3: defer auto-embed to terminal time so the chain stays sync.
      // `embedWith` is required — fail loud rather than route through whichever
      // provider happens to be the AI default. Mirrors orm-prisma's behavior.
      if (!opts?.embedWith) throw new MissingEmbedderError(column)
      this._vectorClause = {
        column,
        query: null,
        pendingEmbed: { text: query, embedWith: opts.embedWith },
        metric: opts?.metric ?? 'cosine',
        ...(opts?.minSimilarity !== undefined ? { minSimilarity: opts.minSimilarity } : {}),
      }
      return this
    }
    this._vectorClause = {
      column,
      query,
      metric: opts?.metric ?? 'cosine',
      ...(opts?.minSimilarity !== undefined ? { minSimilarity: opts.minSimilarity } : {}),
    }
    return this
  }

  selectVectorDistance(column: string, query: number[], alias: string): this {
    this._selectVectorDist = { column, query, alias }
    return this
  }

  whereRelationExists(p: RelationExistencePredicate): this {
    if (p.count) {
      throw new Error(
        `[RudderJS ORM Drizzle] has("${p.relation}", …) count comparison is not implemented on the Drizzle adapter. Use whereHas() for existence, or load the related rows via related() and count in app code.`,
      )
    }
    if (p.boolean === 'OR') {
      throw new Error(
        `[RudderJS ORM Drizzle] orWhereHas("${p.relation}") (OR-rooted relation existence) is not implemented on the Drizzle adapter. Use whereHas() (AND), or split into two queries and merge in app code.`,
      )
    }
    const Related = this.resolveTable(p.relatedTable)
    if (!Related) {
      throw new Error(
        `[RudderJS ORM Drizzle] whereRelationExists: no table schema registered for "${p.relatedTable}". ` +
        `Pass tables: { ${p.relatedTable}: ... } in drizzle() config.`,
      )
    }

    const parentCol = this.col(p.parentColumn) as Column

    if (p.through) {
      // Pivot path — two-step EXISTS:
      //   EXISTS (
      //     SELECT 1 FROM pivot
      //     WHERE pivot.foreignPivotKey = parent.parentColumn
      //       AND <extraEquals>
      //       AND EXISTS (
      //         SELECT 1 FROM related
      //         WHERE related.relatedColumn = pivot.relatedPivotKey
      //           AND <constraintWheres>
      //       )
      //   )
      const Pivot = this.resolveTable(p.through.pivotTable)
      if (!Pivot) {
        throw new Error(
          `[RudderJS ORM Drizzle] whereRelationExists: no table schema registered for pivot "${p.through.pivotTable}".`,
        )
      }
      const pivotForeignCol = this.colOf(Pivot, p.through.foreignPivotKey)
      const pivotRelatedCol = this.colOf(Pivot, p.through.relatedPivotKey)
      const relatedRelCol   = this.colOf(Related, p.relatedColumn)

      const innerExprs: SQL[] = [eq(relatedRelCol, pivotRelatedCol) as SQL]
      for (const w of p.constraintWheres) innerExprs.push(this.clauseToExprOn(Related, w))
      const innerSelect = this.db.select().from(Related).where(_andSql(innerExprs))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pivotExprs: SQL[] = [eq(pivotForeignCol, parentCol) as SQL, exists(innerSelect as any) as SQL]
      for (const [k, v] of Object.entries(p.extraEquals ?? {})) {
        pivotExprs.push(eq(this.colOf(Pivot, k), v) as SQL)
      }
      const pivotSelect = this.db.select().from(Pivot).where(_andSql(pivotExprs))

      // Cast through `unknown` to side-step the local DrizzleQB type — the
      // real drizzle select implements SQLWrapper, but our stripped interface
      // doesn't expose `getSQL`. exists()/notExists() runtime accepts it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this._extraExprs.push((p.exists ? exists(pivotSelect as any) : notExists(pivotSelect as any)) as SQL)
      return this
    }

    // Direct path — single correlated EXISTS.
    const relatedRelCol = this.colOf(Related, p.relatedColumn)
    const exprs: SQL[] = [eq(relatedRelCol, parentCol) as SQL]
    for (const w of p.constraintWheres) exprs.push(this.clauseToExprOn(Related, w))
    for (const [k, v] of Object.entries(p.extraEquals ?? {})) {
      exprs.push(eq(this.colOf(Related, k), v) as SQL)
    }
    const inner = this.db.select().from(Related).where(_andSql(exprs))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._extraExprs.push((p.exists ? exists(inner as any) : notExists(inner as any)) as SQL)
    return this
  }

  // withConstrained intentionally not implemented yet — Drizzle's relational
  // query API has its own `with(..., { where })` shape we don't currently
  // surface. `withWhereHas` falls back to plain `with()` until we wire it up.

  withAggregate(requests: AggregateRequest[]): this {
    this._aggregates.push(...requests)
    return this
  }

  async _aggregate(fn: AggregateFn, column?: string): Promise<unknown> {
    this._assertNotSubBuilder()
    const cond = this.buildConditions()

    const valueExpr = (() => {
      switch (fn) {
        case 'count':
          return sql<number>`COUNT(*)`
        case 'exists':
          return sql<number>`COUNT(*)`
        case 'sum':
          return sql<number>`COALESCE(SUM(${this.col(column!) as Column}), 0)`
        case 'min':
          return sql<number>`MIN(${this.col(column!) as Column})`
        case 'max':
          return sql<number>`MAX(${this.col(column!) as Column})`
        case 'avg':
          return sql<number>`AVG(${this.col(column!) as Column})`
      }
    })()

    let q = this.db.select({ value: valueExpr }).from(this.table)
    if (cond) q = q.where(cond)

    const result = await this._run<Array<{ value: unknown }>>(q)
    const raw = result[0]?.value
    if (fn === 'count') return Number(raw ?? 0)
    if (fn === 'exists') return Number(raw ?? 0) > 0
    if (raw === null || raw === undefined) {
      return fn === 'sum' ? 0 : null
    }
    return Number(raw)
  }

  /** @internal — build a correlated subselect SQL fragment for one
   *  AggregateRequest. Used by `buildAggregateSelectFields`. */
  private _aggregateSubquery(req: AggregateRequest): SQL {
    const js      = req.joinShape
    const Related = this.resolveTable(js.relatedTable)
    if (!Related) {
      throw new Error(
        `[RudderJS ORM Drizzle] withAggregate: no table schema registered for "${js.relatedTable}". ` +
        `Pass tables: { ${js.relatedTable}: ... } in drizzle() config.`,
      )
    }
    const parentCol = this.col(js.parentColumn) as Column

    if (js.through) {
      const Pivot = this.resolveTable(js.through.pivotTable)
      if (!Pivot) {
        throw new Error(
          `[RudderJS ORM Drizzle] withAggregate: no table schema registered for pivot "${js.through.pivotTable}".`,
        )
      }
      const pivotForeignCol = this.colOf(Pivot,   js.through.foreignPivotKey)
      const pivotRelatedCol = this.colOf(Pivot,   js.through.relatedPivotKey)
      const relatedKeyCol   = this.colOf(Related, js.relatedColumn)

      const needJoin = req.fn === 'sum' || req.fn === 'min' || req.fn === 'max' || req.fn === 'avg'
        || req.constraintWheres.length > 0
        || js.softDeletes === true

      const exprs: SQL[] = [eq(pivotForeignCol, parentCol) as SQL]
      for (const [k, v] of Object.entries(js.extraEquals ?? {})) {
        exprs.push(eq(this.colOf(Pivot, k), v) as SQL)
      }

      const fnExpr = this._aggregateFnExpr(req, Related)

      if (!needJoin) {
        // Simple count(*) over pivot rows for this parent.
        const subq = sql`(SELECT ${fnExpr} FROM ${Pivot as Column} WHERE ${_andSql(exprs)})`
        return req.fn === 'exists' ? (sql`(${subq} > 0)` as SQL) : (subq as SQL)
      }

      // Join pivot → related so we can apply soft-delete + constraints +
      // numeric aggregates over a related column.
      for (const w of req.constraintWheres) exprs.push(this.clauseToExprOn(Related, w))
      if (js.softDeletes) {
        const da = this.colOf(Related, 'deletedAt') as Column | undefined
        if (da) exprs.push(isNull(da) as SQL)
      }
      const subq = sql`(SELECT ${fnExpr} FROM ${Pivot as Column} INNER JOIN ${Related as Column} ON ${relatedKeyCol} = ${pivotRelatedCol} WHERE ${_andSql(exprs)})`
      return req.fn === 'exists' ? (sql`(${subq} > 0)` as SQL) : (subq as SQL)
    }

    // Direct (no pivot): single subselect on the related table.
    const relatedRelCol = this.colOf(Related, js.relatedColumn)
    const exprs: SQL[] = [eq(relatedRelCol, parentCol) as SQL]
    for (const w of req.constraintWheres) exprs.push(this.clauseToExprOn(Related, w))
    for (const [k, v] of Object.entries(js.extraEquals ?? {})) {
      exprs.push(eq(this.colOf(Related, k), v) as SQL)
    }
    if (js.softDeletes) {
      const da = this.colOf(Related, 'deletedAt') as Column | undefined
      if (da) exprs.push(isNull(da) as SQL)
    }

    const fnExpr = this._aggregateFnExpr(req, Related)
    const subq = sql`(SELECT ${fnExpr} FROM ${Related as Column} WHERE ${_andSql(exprs)})`
    return req.fn === 'exists' ? (sql`(${subq} > 0)` as SQL) : (subq as SQL)
  }

  /** @internal — `COUNT(*)` / `SUM(col)` / etc. SQL fragment, plus the
   *  COALESCE wrapping that keeps null-sum from leaking out of an empty
   *  matching set. */
  private _aggregateFnExpr(req: AggregateRequest, Related: unknown): SQL {
    switch (req.fn) {
      case 'count':
      case 'exists':
        return sql`COUNT(*)`
      case 'sum':
        return sql`COALESCE(SUM(${this.colOf(Related, req.column!)}), 0)`
      case 'min':
        return sql`MIN(${this.colOf(Related, req.column!)})`
      case 'max':
        return sql`MAX(${this.colOf(Related, req.column!)})`
      case 'avg':
        return sql`AVG(${this.colOf(Related, req.column!)})`
    }
  }

  /** @internal — the SELECT-list fields object, or `null` for a default `*`.
   *  Combines three projection sources:
   *  - `select(...)` → a flat map keyed by each column's last segment (so a
   *    qualified `users.name` lands under `name` and hydrates onto the model);
   *  - a join with NO explicit select → the BASE table's columns (keeps rows
   *    flat + model-shaped while the join filters/fans out rows);
   *  - aggregate eager-loads (`withCount`/…) → their named subselect columns.
   *  `null` only when none apply (plain `db.select().from(...)`). */
  private buildSelectFields(): Record<string, unknown> | null {
    const hasSelect = this._selectCols.length > 0
    const hasJoins  = this._joins.length > 0
    const hasAgg    = this._aggregates.length > 0
    const hasGroup  = this._groupBy.length > 0
    if (!hasSelect && !hasJoins && !hasAgg && !hasGroup) return null

    let fields: Record<string, unknown>
    if (hasSelect) {
      fields = {}
      for (const name of this._selectCols) {
        const dot = name.lastIndexOf('.')
        const key = dot === -1 ? name : name.slice(dot + 1)
        fields[key] = this.resolveColumn(name)
      }
    } else {
      // joins-default / aggregates-only / groupBy-default → base table columns.
      fields = { ...(getTableColumns(this.table as Parameters<typeof getTableColumns>[0]) as Record<string, unknown>) }
    }
    for (const req of this._aggregates) fields[req.alias] = this._aggregateSubquery(req)
    return fields
  }


  private softDeleteExpr(): SQL | undefined {
    if (!this._softDeletes || this._withTrashed) return undefined
    const deletedAtCol = this.col('deletedAt') as Column | undefined
    if (!deletedAtCol) return undefined
    // SQL: `col = NULL` never matches — must use IS NULL / IS NOT NULL
    return (this._onlyTrashed ? isNotNull(deletedAtCol) : isNull(deletedAtCol)) as SQL
  }

  private buildConditions(): SQL | undefined {
    const andExprs: SQL[] = this._wheres.map(c => this.clauseToExpr(c))
    const orExprs:  SQL[] = this._orWheres.map(c => this.clauseToExpr(c))

    const softExpr = this.softDeleteExpr()
    if (softExpr) andExprs.push(softExpr)

    // EXISTS / NOT EXISTS subqueries from whereRelationExists + AND-rooted
    // whereGroup blocks.
    for (const e of this._extraExprs) andExprs.push(e)
    // OR-rooted whereGroup blocks join the flat orWhere list.
    for (const e of this._orExtraExprs) orExprs.push(e)

    const hasAnd = andExprs.length > 0
    const hasOr  = orExprs.length > 0

    if (!hasAnd && !hasOr) return undefined

    const andCombined: SQL | undefined = hasAnd
      ? (andExprs.length === 1 ? andExprs[0] : and(...andExprs) as SQL)
      : undefined
    const orCombined: SQL | undefined = hasOr
      ? (orExprs.length === 1 ? orExprs[0] : or(...orExprs) as SQL)
      : undefined

    if (andCombined && orCombined) return or(andCombined, orCombined) as SQL
    return (andCombined ?? orCombined) as SQL
  }

  /** @internal — one HAVING clause → SQL. Resolves qualified `table.col` and
   *  splices a raw `Expression` value verbatim, mirroring clauseToExprOn but on
   *  resolveColumn (HAVING may reference a joined table's column). */
  private havingExpr(c: WhereClause): SQL {
    if (c.value instanceof Expression) {
      return sql`${this.resolveColumn(c.column)} ${sql.raw(c.operator)} ${sql.raw(String(c.value.getValue()))}` as SQL
    }
    return this._compareValue(this.resolveColumn(c.column), c.operator, c.value)
  }

  /** @internal — combine structured + raw HAVING clauses, same AND/OR shape as
   *  buildConditions. Returns undefined when no HAVING was set. */
  private buildHaving(): SQL | undefined {
    const andExprs: SQL[] = this._havings.map(c => this.havingExpr(c))
    const orExprs:  SQL[] = this._orHavings.map(c => this.havingExpr(c))
    for (const e of this._havingExprs)   andExprs.push(e)
    for (const e of this._orHavingExprs) orExprs.push(e)

    const hasAnd = andExprs.length > 0
    const hasOr  = orExprs.length > 0
    if (!hasAnd && !hasOr) return undefined

    const andCombined: SQL | undefined = hasAnd
      ? (andExprs.length === 1 ? andExprs[0] : and(...andExprs) as SQL)
      : undefined
    const orCombined: SQL | undefined = hasOr
      ? (orExprs.length === 1 ? orExprs[0] : or(...orExprs) as SQL)
      : undefined

    if (andCombined && orCombined) return or(andCombined, orCombined) as SQL
    return (andCombined ?? orCombined) as SQL
  }

  /** @internal — projection root honoring distinct(). `selectDistinct` when
   *  `.distinct()` was called, else `select`; null fields → project all. */
  private _selectFrom(fields: Record<string, unknown> | null): DrizzleQB {
    const root = this._distinct
      ? (fields ? this.db.selectDistinct(fields) : this.db.selectDistinct())
      : (fields ? this.db.select(fields)         : this.db.select())
    return root.from(this.table)
  }

  /** @internal — apply GROUP BY + HAVING after WHERE. Both no-op when unused so
   *  the non-grouped path stays byte-identical. */
  private _applyGroupHaving(q: DrizzleQB): DrizzleQB {
    if (this._groupBy.length) q = q.groupBy(...this._groupBy.map(c => this.resolveColumn(c)))
    const having = this.buildHaving()
    if (having) q = q.having(having)
    return q
  }

  /** @internal — the full select body: projection → joins → WHERE → GROUP BY /
   *  HAVING, with NO ORDER BY / LIMIT / OFFSET. The shared base for the read
   *  terminals; also what a union member contributes (its ORDER/LIMIT are
   *  dropped — only the base query's apply, to the whole compound). */
  private _selectBodyQuery(): DrizzleQB {
    const cond = this.buildConditions()
    let q = this._selectFrom(this.buildSelectFields())
    q = this._applyJoins(q)
    if (cond) q = q.where(cond)
    return this._applyGroupHaving(q)
  }

  /** @internal — chain accumulated UNION members onto the base select body.
   *  No-op when no unions, keeping the plain path byte-identical. */
  private _applyUnions(q: DrizzleQB): DrizzleQB {
    for (const u of this._unions) {
      const member = u.qb._selectBodyQuery()
      q = u.all ? q.unionAll(member) : q.union(member)
    }
    return q
  }

  /** @internal — chain the pessimistic lock onto a read terminal's query.
   *  No-op on sqlite (its select builders have no `.for()` and the dialect has
   *  no row locks) and on a union'd query (`FOR UPDATE` is not valid SQL on a
   *  set operation — Postgres rejects it). */
  private _applyLock(q: DrizzleQB): DrizzleQB {
    if (this._lock === null || this.dialect === 'sqlite' || this._unions.length > 0) return q
    return q.for(this._lock)
  }

  /** @internal — row count honoring grouping/distinct. A grouped or distinct
   *  query's row count is the number of groups / distinct rows, not a scalar
   *  aggregate — so wrap the full projection as a subquery and COUNT(*) it
   *  (Laravel parity: count() of a grouped builder = group count). The plain
   *  path stays a single COUNT(*) over the base table. */
  private async _countRows(cond: SQL | undefined): Promise<number> {
    // A union'd query's count is the combined row count — wrap the whole
    // compound as a subquery and COUNT(*) it (precedence over the GROUP BY /
    // DISTINCT wrap below, which the body subqueries already include).
    if (this._unions.length) {
      const sub = this._applyUnions(this._selectBodyQuery()).as('aggregate')
      const result = await this._run<Array<{ value: number | string | bigint }>>(
        this.db.select({ value: sqlCount() }).from(sub),
      )
      return Number(result[0]?.value ?? 0)
    }
    if (this._groupBy.length || this._distinct) {
      // Count groups by projecting just the GROUP BY keys (portable — avoids
      // `SELECT * … GROUP BY` which strict dialects reject); an explicit
      // select() or a distinct() falls back to buildSelectFields().
      let fields: Record<string, unknown> | null
      if (this._groupBy.length && this._selectCols.length === 0) {
        fields = {}
        for (const name of this._groupBy) {
          const dot = name.lastIndexOf('.')
          fields[dot === -1 ? name : name.slice(dot + 1)] = this.resolveColumn(name)
        }
      } else {
        fields = this.buildSelectFields()
          ?? { ...(getTableColumns(this.table as Parameters<typeof getTableColumns>[0]) as Record<string, unknown>) }
      }
      let inner = this._selectFrom(fields)
      inner = this._applyJoins(inner)
      if (cond) inner = inner.where(cond)
      inner = this._applyGroupHaving(inner)
      const sub = inner.as('aggregate')
      const result = await this._run<Array<{ value: number | string | bigint }>>(
        this.db.select({ value: sqlCount() }).from(sub),
      )
      return Number(result[0]?.value ?? 0)
    }
    let q = this.db.select({ value: sqlCount() }).from(this.table)
    q = this._applyJoins(q)
    if (cond) q = q.where(cond)
    const result = await this._run<Array<{ value: number | string | bigint }>>(q)
    return Number(result[0]?.value ?? 0)
  }

  private buildOrderBy(): SQL[] {
    return this._orders.map(o => {
      if ('rawSql' in o) return o.rawSql
      const col = this.col(o.column) as Column
      return o.direction === 'DESC' ? desc(col) : asc(col)
    })
  }

  async first(): Promise<T | null> {
    this._assertNotSubBuilder()
    if (this._vectorClause !== null) {
      const prevLimit = this._limitN
      this._limitN = 1
      try {
        const rows = await this._getViaVector()
        return (rows[0] as T | undefined) ?? null
      } finally {
        this._limitN = prevLimit
      }
    }
    const orderBy = this.buildOrderBy()

    let q = this._applyUnions(this._selectBodyQuery())
    if (orderBy.length) q = q.orderBy(...orderBy)
    q = this._applyLock(q.limit(1))

    const result = await this._run<T[]>(q)
    return result[0] ?? null
  }

  async find(id: number | string): Promise<T | null> {
    this._assertNotSubBuilder()
    const pkCol    = this.col(this.primaryKey) as Column
    const pkExpr   = eq(pkCol, id) as SQL
    // Compose with the full chain (wheres + orWheres + soft-delete + extra
    // EXISTS / whereGroup subqueries) — `buildConditions()` already merges
    // all of those. Without this, `User.where('tenantId', t).find(5)` would
    // cross tenants.
    const accumulated = this.buildConditions()
    const cond = accumulated ? and(pkExpr, accumulated) as SQL : pkExpr
    const fields = this.buildSelectFields()

    let sel = this._applyJoins(this._selectFrom(fields))
    sel = sel.where(cond)
    sel = this._applyGroupHaving(sel)
    sel = this._applyUnions(sel)
    sel = this._applyLock(sel.limit(1))
    const result = await this._run<T[]>(sel)
    return result[0] ?? null
  }

  async get(): Promise<T[]> {
    this._assertNotSubBuilder()
    if (this._vectorClause !== null) return this._getViaVector() as Promise<T[]>
    const orderBy = this.buildOrderBy()

    let q = this._applyUnions(this._selectBodyQuery())
    if (orderBy.length) q = q.orderBy(...orderBy)
    if (this._limitN  !== null) q = q.limit(this._limitN)
    if (this._offsetN !== null) q = q.offset(this._offsetN)
    q = this._applyLock(q)

    return this._run<T[]>(q)
  }

  async all(): Promise<T[]> {
    return this.get()
  }

  async count(): Promise<number> {
    this._assertNotSubBuilder()
    if (this._vectorClause !== null) {
      throw new Error(
        '[RudderJS ORM] count() with .whereVectorSimilarTo() is not supported in B7 — ' +
        'vector queries route through raw SQL with an implicit ORDER BY similarity.',
      )
    }
    return this._countRows(this.buildConditions())
  }

  /**
   * Vector-query terminal path (#B7 Phase 3 for Drizzle). Mirrors
   * `_getViaVector` in `@rudderjs/orm-prisma`: routes through
   * `db.execute(sql\`SELECT ... ORDER BY <col> <op> <vec>::vector\`)`
   * because Drizzle's fluent select API can't express pgvector
   * operators (`<=>`, `<->`, `<#>`).
   *
   * Phase 2.5-equivalent chain composition: flat `.where()` /
   * `.orWhere()` clauses compose into the SQL via the existing
   * `buildConditions()`. Soft-delete scoping flows through the same
   * path. Polymorphic / pivot relations handled by the existing
   * `whereRelationExists` `EXISTS` subqueries — they sit in
   * `_extraExprs` and `buildConditions()` already AND-merges them.
   *
   * Still throws (out of scope):
   * - Aggregates — would mix raw SQL with subselect projection.
   * - `orderBy` — redundant; vector queries order by similarity.
   *
   * Errors:
   * - pgvector extension or column missing → wraps as
   *   {@link VectorStorageUnsupportedError}.
   * - `db.execute()` not on the driver → same error class with hint.
   */
  private async _getViaVector(): Promise<Array<Record<string, unknown>>> {
    if (this._vectorClause === null) return []  // unreachable: get() guards

    if (this._aggregates.length > 0) {
      throw new Error(
        '[RudderJS ORM] withCount/withSum/etc. alongside .whereVectorSimilarTo() is not yet supported.',
      )
    }
    if (this._orders.length > 0) {
      throw new Error(
        '[RudderJS ORM] orderBy() alongside .whereVectorSimilarTo() is redundant — vector queries order by similarity.',
      )
    }

    const { column, query, pendingEmbed, minSimilarity, metric } = this._vectorClause
    const opStr =
      metric === 'l2'             ? '<->' :
      metric === 'inner-product'  ? '<#>' :
                                    '<=>'   // cosine
    const op = sql.raw(opStr)

    // Resolve the deferred auto-embed if we kept the string at sync-chain
    // time. Pulls @rudderjs/ai via resolveOptionalPeer so orm-drizzle stays
    // independent of the AI runtime — apps that don't do RAG never load it.
    const resolvedQuery = query ?? await resolveAutoEmbed(pendingEmbed)
    const vecLit = vectorLiteral(resolvedQuery)

    const colExpr = this.col(column) as Column | undefined
    if (!colExpr) {
      throw new VectorStorageUnsupportedError(
        'drizzle',
        `Column "${column}" not found on the registered Drizzle table — make sure the column is declared in your pgTable schema.`,
      )
    }

    // SELECT list — start with `*` from the table; add the optional
    // distance projection if the user opted in via selectVectorDistance.
    let distSelect: SQL = sql``
    if (this._selectVectorDist) {
      const dCol = this.col(this._selectVectorDist.column) as Column | undefined
      if (!dCol) {
        throw new VectorStorageUnsupportedError(
          'drizzle',
          `selectVectorDistance: column "${this._selectVectorDist.column}" not found on the registered Drizzle table.`,
        )
      }
      const dVecLit = vectorLiteral(this._selectVectorDist.query)
      const aliasIdent = sql.identifier(this._selectVectorDist.alias)
      distSelect = sql`, (${dCol} ${op} ${dVecLit}::vector) AS ${aliasIdent}`
    }

    // WHERE composition: vector min-similarity (if set) AND chained user
    // wheres (flat .where()/.orWhere(), soft-delete, EXISTS subqueries).
    const whereExprs: SQL[] = []
    if (minSimilarity !== undefined) {
      whereExprs.push(sql`1 - (${colExpr} ${op} ${vecLit}::vector) >= ${minSimilarity}` as SQL)
    }
    const userCond = this.buildConditions()
    if (userCond) whereExprs.push(userCond)

    const whereSql = whereExprs.length > 0
      ? sql` WHERE ${_andSql(whereExprs)}`
      : sql``

    const limitN = this._limitN ?? 100

    const fullSql = sql`SELECT *${distSelect} FROM ${this.table as Column}${whereSql} ORDER BY ${colExpr} ${op} ${vecLit}::vector LIMIT ${limitN}`

    const exec = this.db.execute
    if (typeof exec !== 'function') {
      throw new VectorStorageUnsupportedError(
        'drizzle',
        'db.execute() is not available on this Drizzle driver — vector queries require a Postgres driver (postgres-js, pg, or neon-serverless).',
      )
    }

    try {
      const result = await exec.call(this.db, fullSql)
      // Normalize across driver result shapes:
      //   - postgres-js: { rows: [...] } (the rows array IS the result iterable)
      //   - pg / neon: { rows: [...] }
      //   - libsql: { rows: [...] }
      //   - some test fakes return rows directly as an array.
      if (Array.isArray(result)) return result as Array<Record<string, unknown>>
      if (result && typeof result === 'object' && 'rows' in result) {
        const rows = (result as { rows: unknown }).rows
        return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : []
      }
      return []
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // pgvector missing — wrap with a friendly error.
      if (/operator does not exist|type "vector" does not exist|extension "vector"|column .* does not exist/i.test(msg)) {
        throw new VectorStorageUnsupportedError(
          'drizzle',
          `pgvector or the column "${column}" is not available on this connection. ` +
          'Run `CREATE EXTENSION IF NOT EXISTS vector;` and `ALTER TABLE ... ADD COLUMN ' +
          `${column} vector(N);\` in a migration. Original: ${msg}`,
        )
      }
      throw err
    }
  }

  async create(data: Partial<T>): Promise<T> {
    this._assertNotSubBuilder()
    const result = await this._run<T[]>(this.db
      .insert(this.table)
      .values(data)
      .returning())
    if (!result[0]) throw new Error('[RudderJS ORM Drizzle] create() returned no rows.')
    return result[0]
  }

  async update(id: number | string, data: Partial<T>): Promise<T> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    const result = await this._run<T[]>(this.db
      .update(this.table)
      .set(data)
      .where(eq(pkCol, id))
      .returning())
    if (!result[0]) throw new Error('[RudderJS ORM Drizzle] update() returned no rows.')
    return result[0]
  }

  async delete(id: number | string): Promise<void> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    if (this._softDeletes) {
      await this._run<void>(this.db.update(this.table).set({ deletedAt: new Date() }).where(eq(pkCol, id)))
      return
    }
    await this._run<void>(this.db
      .delete(this.table)
      .where(eq(pkCol, id)))
  }

  async restore(id: number | string): Promise<T> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    const result = await this._run<T[]>(this.db
      .update(this.table)
      .set({ deletedAt: null })
      .where(eq(pkCol, id))
      .returning())
    return result[0] as T
  }

  async forceDelete(id: number | string): Promise<void> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    await this._run<void>(this.db
      .delete(this.table)
      .where(eq(pkCol, id)))
  }

  async insertMany(rows: Partial<T>[]): Promise<void> {
    this._assertNotSubBuilder()
    if (rows.length === 0) return
    await this._run<void>(this.db.insert(this.table).values(rows))
  }

  /** @internal — build the conflict `set` map: each update column references the
   *  would-be-inserted value (`excluded.<col>` on sqlite/pg, `values(<col>)` on
   *  mysql). Uses the real DB column name so a schema-mapped key (JS `userId` →
   *  SQL `user_id`) resolves correctly. */
  private _upsertSet(columns: string[], mysql: boolean): Record<string, SQL> {
    const set: Record<string, SQL> = {}
    for (const c of columns) {
      const dbName = (this.col(c) as Column).name
      set[c] = mysql
        ? sql`values(${sql.identifier(dbName)})`
        : sql`excluded.${sql.identifier(dbName)}`
    }
    return set
  }

  async upsert(rows: Partial<T>[], uniqueBy: string[], update: string[]): Promise<number> {
    this._assertNotSubBuilder()
    if (rows.length === 0) return 0

    if (this.dialect === 'mysql') {
      // MySQL keys off existing unique indexes — no conflict target. An empty
      // `update` degrades to a no-op self-assignment on the first uniqueBy column.
      const cols = update.length > 0 ? update : uniqueBy.slice(0, 1)
      const q = (this.db.insert(this.table).values(rows) as unknown as {
        onDuplicateKeyUpdate: (cfg: { set: Record<string, SQL> }) => unknown
      }).onDuplicateKeyUpdate({ set: this._upsertSet(cols, true) })
      return affectedRowCount(q, this.dialect)
    }

    // SQLite / Postgres — ON CONFLICT (target) DO UPDATE / DO NOTHING, with
    // RETURNING so we can count affected rows in one round-trip.
    const target = uniqueBy.map(c => this.col(c) as Column)
    const insert = this.db.insert(this.table).values(rows) as unknown as {
      onConflictDoNothing: (cfg: { target: Column[] }) => { returning: () => Promise<unknown[]> }
      onConflictDoUpdate: (cfg: { target: Column[]; set: Record<string, SQL> }) => { returning: () => Promise<unknown[]> }
    }
    const q = update.length === 0
      ? insert.onConflictDoNothing({ target })
      : insert.onConflictDoUpdate({ target, set: this._upsertSet(update, false) })
    const out = await this._run<unknown[]>(q.returning())
    return out.length
  }

  async deleteAll(): Promise<number> {
    this._assertNotSubBuilder()
    const cond = this.buildConditions()
    let q = this.db.delete(this.table)
    if (cond) q = q.where(cond)
    return affectedRowCount(q, this.dialect)
  }

  async updateAll(data: Partial<T>): Promise<number> {
    const cond = this.buildConditions()
    let q = this.db.update(this.table).set(data)
    if (cond) q = q.where(cond)
    return affectedRowCount(q, this.dialect)
  }

  async increment(id: number | string, column: string, amount = 1, extra: Record<string, unknown> = {}): Promise<T> {
    return this._delta(id, column, amount, extra, '+')
  }

  async decrement(id: number | string, column: string, amount = 1, extra: Record<string, unknown> = {}): Promise<T> {
    return this._delta(id, column, amount, extra, '-')
  }

  /** @internal — shared increment/decrement path. MySQL has no RETURNING,
   *  so we run the update then re-select the row. Postgres + SQLite use
   *  RETURNING in the same statement (one round-trip, atomic). */
  private async _delta(
    id: number | string,
    column: string,
    amount: number,
    extra: Record<string, unknown>,
    op: '+' | '-',
  ): Promise<T> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    const col   = this.col(column) as Column
    const delta = op === '+' ? sql`${col} + ${amount}` : sql`${col} - ${amount}`
    const label = op === '+' ? 'increment' : 'decrement'

    if (this.dialect === 'mysql') {
      await this._run<unknown>(this.db
        .update(this.table)
        .set({ [column]: delta, ...extra })
        .where(eq(pkCol, id)))
      const after = await this._run<T[]>(this.db.select().from(this.table).where(eq(pkCol, id)).limit(1))
      if (!after[0]) throw new Error(`[RudderJS ORM Drizzle] ${label}() target row not found.`)
      return after[0]
    }

    const result = await this._run<T[]>(this.db
      .update(this.table)
      .set({ [column]: delta, ...extra })
      .where(eq(pkCol, id))
      .returning())
    if (!result[0]) throw new Error(`[RudderJS ORM Drizzle] ${label}() returned no rows.`)
    return result[0]
  }

  async paginate(page = 1, perPage = 15): Promise<PaginatedResult<T>> {
    this._assertNotSubBuilder()
    const cond    = this.buildConditions()
    const orderBy = this.buildOrderBy()

    let pageQ = this._applyUnions(this._selectBodyQuery())
    if (orderBy.length) pageQ = pageQ.orderBy(...orderBy)
    pageQ = this._applyLock(pageQ.limit(perPage).offset((page - 1) * perPage))

    const [data, total] = await Promise.all([
      this._run<T[]>(pageQ),
      this._countRows(cond),
    ])

    const lastPage = Math.max(1, Math.ceil(total / perPage))

    return {
      data,
      total,
      perPage,
      currentPage: page,
      lastPage,
      from: (page - 1) * perPage + 1,
      to:   Math.min(page * perPage, total),
    }
  }
}

/**
 * The sub-builder passed to the callback form of `join(...)` on the Drizzle
 * adapter. Collects ON conditions (column-vs-column `on`/`orOn`, column-vs-value
 * `where`/`orWhere`) and folds them into a single Drizzle `SQL` ON expression,
 * combining left-to-right by each condition's boolean (mirrors the native ON).
 */
class DrizzleJoinClause implements JoinClause {
  private readonly parts: Array<{ boolean: 'AND' | 'OR'; expr: SQL }> = []

  constructor(private readonly qb: DrizzleQueryBuilder<unknown>) {}

  on(left: string, operatorOrRight: WhereOperator | string, right?: string): this {
    const operator = (right === undefined ? '=' : operatorOrRight) as WhereOperator
    const rightCol = right === undefined ? operatorOrRight as string : right
    this.parts.push({ boolean: 'AND', expr: this.qb._joinOnExpr(left, operator, rightCol) })
    return this
  }

  orOn(left: string, operatorOrRight: WhereOperator | string, right?: string): this {
    const operator = (right === undefined ? '=' : operatorOrRight) as WhereOperator
    const rightCol = right === undefined ? operatorOrRight as string : right
    this.parts.push({ boolean: 'OR', expr: this.qb._joinOnExpr(left, operator, rightCol) })
    return this
  }

  where(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    const operator = (value === undefined ? '=' : operatorOrValue) as WhereOperator
    const val      = value === undefined ? operatorOrValue : value
    this.parts.push({ boolean: 'AND', expr: this.qb._joinWhereExpr(column, operator, val) })
    return this
  }

  orWhere(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    const operator = (value === undefined ? '=' : operatorOrValue) as WhereOperator
    const val      = value === undefined ? operatorOrValue : value
    this.parts.push({ boolean: 'OR', expr: this.qb._joinWhereExpr(column, operator, val) })
    return this
  }

  /** @internal — fold the collected conditions into one ON expression. */
  build(): SQL {
    if (this.parts.length === 0) {
      throw new Error('[RudderJS ORM Drizzle] join callback added no ON conditions — call on()/where() inside it.')
    }
    let result = this.parts[0]!.expr
    for (let i = 1; i < this.parts.length; i++) {
      const p = this.parts[i]!
      result = (p.boolean === 'OR' ? or(result, p.expr) : and(result, p.expr)) as SQL
    }
    return result
  }
}

// ─── Dev HMR: Drizzle client reuse across re-boots ─────────
//
// Every Vite dev re-boot re-runs DrizzleAdapter.make(). Without reuse, each
// re-boot opens a fresh driver connection (a postgres-js socket, a mysql2 pool
// holding ~10 server connections, a libsql client, a better-sqlite3 handle) and
// never closes the previous one — the same per-re-boot leak that exhausted MySQL
// `max_connections` for orm-prisma (#652). We cache one live drizzle `db` on
// globalThis (surviving SSR module re-evaluation), keyed by the resolved
// connection signature (driver + url), alongside a `dispose` that closes the
// underlying driver:
//
//   • same signature  → reuse the live client (no new connection opened)
//   • changed signature (a `config/database.ts` edit) → build a fresh client and
//     dispose the superseded one so its connection(s) are released
//
// No-op in production (single boot → one entry, built once). Apps passing their
// own `config.client` opt out entirely — they own that client's lifecycle.
interface DrizzleClientCacheEntry {
  signature: string
  db:        DrizzleDb
  dialect:   DrizzleDialect
  dispose:   () => void | Promise<void>
}
const DRIZZLE_CLIENT_CACHE_KEY = '__rudderjs_drizzle_client__'

/**
 * Return the cached drizzle client when its connection signature is unchanged.
 * On a signature change, dispose the superseded driver (fire-and-forget — the
 * new client doesn't wait on the old one closing) and report a miss.
 */
function reusableDrizzleClient(signature: string): { db: DrizzleDb; dialect: DrizzleDialect } | undefined {
  const g = globalThis as Record<string, unknown>
  const cached = g[DRIZZLE_CLIENT_CACHE_KEY] as DrizzleClientCacheEntry | undefined
  if (!cached) return undefined
  if (cached.signature === signature) return { db: cached.db, dialect: cached.dialect }
  void Promise.resolve()
    .then(() => cached.dispose())
    .catch(() => { /* best effort — releasing a superseded connection */ })
  delete g[DRIZZLE_CLIENT_CACHE_KEY]
  return undefined
}

function cacheDrizzleClient(entry: DrizzleClientCacheEntry): void {
  ;(globalThis as Record<string, unknown>)[DRIZZLE_CLIENT_CACHE_KEY] = entry
}

// ─── Drizzle Adapter ───────────────────────────────────────

export class DrizzleAdapter implements OrmAdapter {
  /**
   * Drizzle's relational query API needs pre-declared `relations()` schemas the
   * adapter doesn't hold (it has only table schemas via `DrizzleTableRegistry`),
   * so it can't resolve a direct relation from a name alone. Opt into the ORM's
   * Model-layer batched eager-loader (`attachDirectRelations`) — it reads the
   * relation's FK/direction off `static relations` and stitches results on. The
   * QB-level `with()` below therefore never runs for a normal `Model.with(...)`;
   * it stays a guard for the `withWhereHas` constrained-eager fallback.
   */
  readonly eagerLoadStrategy = 'model-layer' as const

  private constructor(
    readonly db:                 DrizzleDb,
    private readonly tables:     Record<string, unknown>,
    private readonly primaryKey: string,
    readonly dialect:            DrizzleDialect,
    /** Query listeners (`onQuery` / `DB.listen`). Shared BY REFERENCE with every
     *  transaction-scoped adapter spawned from this one, so a listener registered
     *  on the top-level adapter also sees queries run inside `transaction()`. */
    private readonly listeners:  QueryListener[] = [],
  ) {}

  static async make(config: DrizzleConfig): Promise<DrizzleAdapter> {
    let db = config.client as DrizzleDb | undefined
    let resolvedDialect: DrizzleDialect | undefined = config.dialect

    if (!db) {
      const url    = config.url ?? process.env['DATABASE_URL'] ?? 'file:./dev.db'
      const driver = config.driver ?? 'sqlite'

      // Reuse the live client across dev re-boots when driver + url are unchanged;
      // a changed signature disposes the superseded driver. See reusableDrizzleClient().
      const signature = `${driver}::${url}`
      const reused = reusableDrizzleClient(signature)
      if (reused) {
        db = reused.db
        resolvedDialect ??= reused.dialect
      } else {
        // `dispose` closes the underlying driver (not the drizzle wrapper) so the
        // cache can release a superseded connection on a signature change.
        let dispose: () => void | Promise<void>

        if (driver === 'postgresql') {
          // postgres uses `export =` so dynamic import wraps it in a `.default`
          const postgresModule          = await import('postgres') as unknown as { default?: (url: string) => unknown }
          const postgres                = postgresModule.default ?? (postgresModule as unknown as (url: string) => unknown)
          const { drizzle: dzPostgres } = await import('drizzle-orm/postgres-js') as typeof import('drizzle-orm/postgres-js')
          const sql                     = postgres(url) as { end: () => Promise<void> }
          db = (dzPostgres as unknown as (sql: unknown) => DrizzleDb)(sql)
          dispose = () => sql.end()
          resolvedDialect ??= 'pg'
        } else if (driver === 'libsql') {
          const { createClient }        = await import('@libsql/client') as typeof import('@libsql/client')
          const { drizzle: dzLibsql }   = await import('drizzle-orm/libsql') as typeof import('drizzle-orm/libsql')
          const client                  = createClient({ url })
          db = dzLibsql(client) as unknown as DrizzleDb
          dispose = () => client.close()
          resolvedDialect ??= 'sqlite'
        } else if (driver === 'mysql') {
          // mysql2 ships its own promise wrapper at `mysql2/promise`. The drizzle
          // mysql core expects the promise pool (not the callback-style client).
          const mysqlModule             = await import('mysql2/promise') as { createPool: (url: string) => unknown }
          const pool                    = mysqlModule.createPool(url) as { end: () => Promise<void> }
          const { drizzle: dzMysql }    = await import('drizzle-orm/mysql2') as typeof import('drizzle-orm/mysql2')
          db = (dzMysql as unknown as (pool: unknown) => DrizzleDb)(pool)
          dispose = () => pool.end()
          resolvedDialect ??= 'mysql'
        } else {
          // better-sqlite3 uses `export =` so dynamic import wraps it in `.default`
          const sqliteModule            = await import('better-sqlite3') as unknown as { default?: new (path: string) => unknown }
          const Database                = sqliteModule.default ?? (sqliteModule as unknown as new (path: string) => unknown)
          const { drizzle: dzSqlite }   = await import('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3')
          const sqliteDb                = new Database(url.replace(/^file:/, '')) as { close: () => void }
          db = (dzSqlite as unknown as (db: unknown) => DrizzleDb)(sqliteDb)
          dispose = () => sqliteDb.close()
          resolvedDialect ??= 'sqlite'
        }

        cacheDrizzleClient({ signature, db, dialect: resolvedDialect ?? 'sqlite', dispose })
      }
    }

    if (!db) throw new Error('[RudderJS ORM Drizzle] Failed to initialize database client.')
    // When the user supplies `client:` without `dialect:`, default to 'pg'.
    // Postgres is the most common pre-built Drizzle setup and the `.returning()`
    // code paths work on both Postgres and SQLite — the explicit dialect knob
    // only changes behavior for MySQL, where omitting it would silently break
    // increment/deleteAll/updateAll.
    return new DrizzleAdapter(db, config.tables ?? {}, config.primaryKey ?? 'id', resolvedDialect ?? 'pg')
  }

  query<T>(table: string, opts?: { primaryKey?: string }): QueryBuilder<T> {
    const schema = this.tables[table] ?? DrizzleTableRegistry.get(table)
    if (!schema) {
      throw new Error(
        `[RudderJS ORM Drizzle] No table schema registered for "${table}". ` +
        `Pass tables: { ${table}: myTable } in drizzle() config or call ` +
        `DrizzleTableRegistry.register("${table}", myTable).`
      )
    }
    // Per-query `primaryKey` (threaded from `Model.primaryKey`) overrides
    // the adapter-global `config.primaryKey` so monorepos with mixed PK
    // columns (e.g. `users.id` + `subscriptions.uuid`) work without forcing
    // every model onto the same PK.
    const pk = opts?.primaryKey ?? this.primaryKey
    return new DrizzleQueryBuilder<T>(this.db, schema, pk, (name) => this.resolveTable(name), this.dialect, this.listeners)
  }

  /** @internal — resolve a table by name across both the constructor-provided
   *  `tables` map and the global `DrizzleTableRegistry`. Returns `undefined`
   *  when unknown so callers can throw a relation-aware error. */
  resolveTable(name: string): unknown {
    return this.tables[name] ?? DrizzleTableRegistry.get(name)
  }

  async connect(): Promise<void> {
    // Drizzle connects lazily on first query — no-op
  }

  async disconnect(): Promise<void> {
    const end = this.db.$client?.end
    if (typeof end === 'function') await end()
  }

  /**
   * Run `fn` inside a Drizzle transaction (`db.transaction`). The adapter passed
   * to `fn` is re-bound to Drizzle's transaction-scoped `db`, so every query
   * built from it — and, via the ORM's `AsyncLocalStorage`, every `Model.*` /
   * `DB.*` call inside the callback — executes on that one transaction. Commits
   * when `fn` resolves; rolls back and re-throws when it rejects.
   *
   * **Nesting → SAVEPOINT for free.** Drizzle's `tx` is itself a `DrizzleDb`
   * whose `transaction()` opens a nested SAVEPOINT, so a nested call on the
   * scoped adapter rolls back only its own savepoint — matching the native
   * engine. The `better-sqlite3` driver runs transactions synchronously and
   * rejects async callbacks; use `libsql` / Postgres / MySQL for async work
   * inside a transaction.
   */
  async transaction<T>(fn: (tx: OrmAdapter) => Promise<T>): Promise<T> {
    const run = this.db.transaction
    if (typeof run !== 'function') {
      throw new Error(
        '[RudderJS ORM Drizzle] This Drizzle driver does not support transaction() — ' +
          'db.transaction() is unavailable on the configured client.',
      )
    }
    // `.call` drops the generic binding, so the callback result widens to
    // `unknown` — cast back to the declared `Promise<T>`.
    return run.call(this.db, (txDb: DrizzleDb) => {
      // Shares `this.listeners` by reference — queries inside the transaction
      // report to the same listeners as top-level ones.
      const scoped = new DrizzleAdapter(txDb, this.tables, this.primaryKey, this.dialect, this.listeners)
      return fn(scoped)
    }) as Promise<T>
  }

  /**
   * Register a query listener ({@link OrmAdapter.onQuery}) — fired once per
   * successfully executed query with the SQL, bindings, and wall-clock duration
   * in ms. The app-facing entry point is `DB.listen()` (`@rudderjs/database`);
   * Telescope's QueryCollector and Pulse's slow-query recorder hook in here too.
   * Listener errors are swallowed — they never break the query. Registering on
   * a transaction-scoped adapter registers on the shared (top-level) listener
   * list. The reported `connection` is the adapter's dialect (`'sqlite'` /
   * `'pg'` / `'mysql'`). Not reported: pgvector similarity queries (they bypass
   * the fluent builder via `db.execute`) and Drizzle-internal BEGIN/COMMIT.
   */
  onQuery(listener: QueryListener): void {
    this.listeners.push(listener)
  }

  /**
   * Compile a raw SQL string + positional bindings into a Drizzle `SQL` value.
   * Splits on `?` / `$n` placeholders and parameterizes each binding via the
   * `sql` template tag, so values are never string-interpolated into the query.
   */
  private rawSql(text: string, bindings: readonly unknown[]): SQL {
    if (bindings.length === 0) return sql.raw(text)
    const parts = text.split(/\?|\$\d+/)
    let query: SQL = sql.raw(parts[0] ?? '')
    for (let i = 0; i < bindings.length; i++) {
      query = sql`${query}${bindings[i]}${sql.raw(parts[i + 1] ?? '')}`
    }
    return query
  }

  /**
   * Raw `SELECT` for the `DB` facade (`DB.select`) via Drizzle's `db.execute`.
   * Normalizes the per-driver result shape (postgres-js returns an array; node-pg
   * returns `{ rows }`) to a flat `Row[]`.
   */
  async selectRaw(text: string, bindings: readonly unknown[]): Promise<Row[]> {
    const exec = this.db.execute
    if (typeof exec !== 'function') {
      throw new Error(
        '[RudderJS DB] db.execute() is not available on this Drizzle driver — ' +
          'raw DB.select() requires a driver that supports execute() (postgres-js, pg, neon, or libsql).',
      )
    }
    const startedAt = performance.now()
    const result = await exec.call(this.db, this.rawSql(text, bindings))
    emitQueryEvent(this.listeners, text, bindings, startedAt, this.dialect)
    if (Array.isArray(result)) return result as Row[]
    return ((result as { rows?: Row[] })?.rows) ?? []
  }

  /**
   * Raw writing statement for the `DB` facade (`DB.insert`/`update`/`delete`/
   * `statement`) via Drizzle's `db.execute`. Resolves to the number of rows
   * affected, reading whichever count field the underlying driver reports.
   */
  async affectingStatement(text: string, bindings: readonly unknown[]): Promise<number> {
    const exec = this.db.execute
    if (typeof exec !== 'function') {
      throw new Error(
        '[RudderJS DB] db.execute() is not available on this Drizzle driver — ' +
          'raw DB writes require a driver that supports execute() (postgres-js, pg, neon, or libsql).',
      )
    }
    const startedAt = performance.now()
    const result = (await exec.call(this.db, this.rawSql(text, bindings))) as unknown
    emitQueryEvent(this.listeners, text, bindings, startedAt, this.dialect)
    if (Array.isArray(result)) return result.length
    const r = result as {
      rowCount?: number; rowsAffected?: number; changes?: number; affectedRows?: number
    }
    return r?.rowCount ?? r?.rowsAffected ?? r?.changes ?? r?.affectedRows ?? 0
  }
}

// ─── Config & Factory ──────────────────────────────────────

export interface DrizzleConfig {
  /** Pre-built drizzle db instance — skips driver setup */
  client?: unknown
  /** Database driver. Defaults to 'sqlite' */
  driver?: 'sqlite' | 'postgresql' | 'libsql' | 'mysql'
  /** Connection URL. Falls back to DATABASE_URL env var */
  url?: string
  /**
   * Map of table name → Drizzle table schema. Required for any table
   * referenced through a relation traversal — `whereHas('comments', ...)`,
   * `withAggregate({ countComments: ... })`, etc. — because the adapter
   * resolves related schemas by name at query-build time. Tables you only
   * query directly (via `from(comments)`) do not need to appear here.
   *
   * Equivalent to calling `DrizzleTableRegistry.register(name, schema)` for
   * each entry. Missing entries surface as a clear "no table schema
   * registered for X" error.
   */
  tables?: Record<string, unknown>
  /** Primary key column name. Defaults to 'id' */
  primaryKey?: string
  /**
   * SQL dialect — drives capability branching for batch updates and
   * counter operations. MySQL has no `RETURNING`, so increment/decrement
   * re-fetch the row and updateAll/deleteAll read `affectedRows` from the
   * driver result metadata.
   *
   * Inferred from `driver` when omitted:
   * - `'postgresql'` → `'pg'`
   * - `'sqlite'` / `'libsql'` → `'sqlite'`
   * - `'mysql'` → `'mysql'`
   *
   * When passing a pre-built `client`, set this explicitly. Defaults to
   * `'pg'` (no `client` + no `driver` + no `dialect` is treated as Postgres,
   * matching the previous code path).
   */
  dialect?: DrizzleDialect
}

/**
 * Build the Drizzle ORM adapter provider.
 *
 * **Null-value reminder.** Drizzle's `eq(col, null)` never matches — SQL
 * requires `IS NULL` semantics, not equality. When writing custom Drizzle
 * predicates in your app code, use `isNull(col)` / `isNotNull(col)` from
 * `drizzle-orm`. The adapter itself routes null comparisons through the
 * correct operators internally.
 *
 * @example
 * import { posts, comments } from './schema.js'
 *
 * database({
 *   default: 'main',
 *   connections: {
 *     main: drizzle({
 *       driver: 'postgresql',
 *       tables: { posts, comments },
 *     }),
 *   },
 * })
 */
export function drizzle(config: DrizzleConfig = {}): OrmAdapterProvider {
  return {
    async create(): Promise<OrmAdapter> {
      return DrizzleAdapter.make(config)
    },
  }
}

// ─── DatabaseProvider ──────────────────────────────────────

import { ServiceProvider, config as appConfig } from '@rudderjs/core'
import {
  ModelRegistry,
  MissingEmbedderError,
  VectorStorageUnsupportedError,
} from '@rudderjs/orm'

export interface DatabaseConnectionConfig {
  driver:   'sqlite' | 'postgresql' | 'libsql' | 'mysql'
  url?:     string
  /** Override the inferred SQL dialect. Use when passing a pre-built
   *  `client` whose driver name doesn't map cleanly (e.g. planetscale
   *  serverless → 'mysql', neon serverless → 'pg'). */
  dialect?: DrizzleDialect
}

/**
 * Database config consumed by `DatabaseProvider`.
 *
 * Mirrors the Prisma adapter's `DatabaseConfig` shape (`default` + `connections`)
 * so apps can switch drivers without restructuring their `config/database.ts`,
 * with two Drizzle-specific extras:
 *
 * - `tables` — map of table name → drizzle table object (Drizzle is schema-first
 *   in TypeScript; the adapter needs the table objects to build queries).
 * - `client` — pre-built drizzle db instance, for tests or hand-wired setups.
 */
export interface DatabaseConfig {
  default:     string
  connections: Record<string, DatabaseConnectionConfig>
  tables?:     Record<string, unknown>
  client?:     unknown
}

/**
 * Auto-discovered service provider that boots a `DrizzleAdapter` from
 * `config('database')` and registers it on the DI container.
 *
 * Wires:
 *   - `ModelRegistry.set(adapter)` so `@rudderjs/orm` Models route through it
 *   - `app.instance('db', adapter)` for direct DI lookup
 */
export class DatabaseProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = appConfig<DatabaseConfig | undefined>('database', undefined)

    const drizzleConfig: DrizzleConfig = {}

    if (cfg) {
      const conn = cfg.connections[cfg.default]
      if (conn) {
        drizzleConfig.driver = conn.driver
        if (conn.url !== undefined) drizzleConfig.url = conn.url
        if (conn.dialect !== undefined) drizzleConfig.dialect = conn.dialect
      }
      if (cfg.tables) drizzleConfig.tables = cfg.tables
      if (cfg.client) drizzleConfig.client = cfg.client
    }

    const adapter = await DrizzleAdapter.make(drizzleConfig)
    await adapter.connect()

    ModelRegistry.set(adapter)
    this.app.instance('db', adapter)
  }
}
