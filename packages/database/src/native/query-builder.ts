// ─── NativeQueryBuilder ────────────────────────────────────
//
// Implements the `QueryBuilder<T>` contract over an {@link Executor} + {@link
// Dialect}. PHASE 1 shipped the read path (first/find/get/all/count/paginate);
// PHASE 2 adds the write path (create/update/delete/increment/… + soft deletes).
// Relation, aggregate, and vector terminals still throw
// {@link NativeNotImplementedError} until Phase 3.
//
// It talks ONLY to the compiler (pure) + the Executor interface — never a
// concrete driver, never `node:`. Because writes go through an `Executor` (not
// the top-level connection directly), a transaction scope (Phase 4) drops in
// without touching this class. Construction is cheap; one builder per query.

import type {
  QueryBuilder,
  WhereClause,
  WhereOperator,
  PaginatedResult,
  RelationExistencePredicate,
  AggregateRequest,
  AggregateFn,
  JoinClause,
  LockOptions,
} from '@rudderjs/contracts'
import { Expression } from '@rudderjs/contracts'
import { parseJsonPath, type Dialect, type DatePart } from './dialect.js'
import type { Executor, Row, AffectingExecutor } from './driver.js'
import {
  compileSelect,
  compileCount,
  compileInsert,
  compileInsertUsing,
  compileUpdate,
  compileIncrement,
  compileDelete,
  compileScalarAggregate,
  type ConditionNode,
  type OrderItem,
  type RawFragment,
  type JoinNode,
  type JoinCondition,
  type HavingNode,
  type NativeQueryState,
  type CteNode,
  type SubqueryBody,
} from './compiler.js'

/** One-time dev warning that native `with(<direct relation>)` doesn't eager-load
 *  yet (Phase 3 limitation). Keyed per relation name so each distinct call site
 *  warns once. No-op in production. */
const _warnedWith = new Set<string>()

/** Global-registry symbol the `HydratingQueryBuilder` Proxy answers with its
 *  wrapped native builder. `union(other)` reads it to unwrap a passed proxy back
 *  to the underlying `NativeQueryBuilder` so it can read the member's state.
 *  `Symbol.for` (not an imported value) keeps the node-only native module out of
 *  the client-reachable `index.ts` import graph. */
const QB_TARGET = Symbol.for('rudderjs.orm.qb.target')

export class NativeQueryBuilder<T> implements QueryBuilder<T> {
  /** Capability marker read by the Model layer's hydrating proxy — arrow-path
   *  update keys (`'meta->prefs->lang'`) throw a clear Model-layer error on
   *  adapter QBs without it (Drizzle/Prisma until their follow-up). */
  readonly supportsJsonPathUpdates = true

  /** Capability marker read by the Model layer — nested relation paths
   *  (`whereHas('posts.comments')`) build a predicate chain (`nested` child
   *  predicates) that only adapters with this marker can compile; others get
   *  a clear Model-layer throw instead of a silently-ignored field. */
  readonly supportsNestedRelationPredicates = true

  private readonly _conditions: ConditionNode[] = []
  private readonly _orders:     OrderItem[]     = []
  private readonly _selects:    string[]        = []
  private readonly _joins:      JoinNode[]      = []
  private readonly _groupBy:    string[]        = []
  private readonly _having:     HavingNode[]    = []
  private readonly _unions:     Array<{ all: boolean; state: NativeQueryState }> = []
  private readonly _ctes:       CteNode[]       = []
  private readonly _rawSelects: RawFragment[]   = []
  private readonly _relationExists: RelationExistencePredicate[] = []
  private readonly _aggregates:     AggregateRequest[] = []
  private _distinct = false
  private _limitN:  number | null = null
  private _offsetN: number | null = null
  private _softDeletes  = false
  private _withTrashed  = false
  private _onlyTrashed  = false
  private _lock: 'update' | 'shared' | null = null
  /** Wait behavior for `_lock` (`skipLocked` / `noWait`) — validated mutually
   *  exclusive at the setter, threaded to `Dialect.lockSql` via the state. */
  private _lockOpts: LockOptions | null = null
  /** Marks a sub-builder created for whereGroup — terminals throw on it. */
  private _isSubBuilder = false

  constructor(
    private readonly executor:   Executor,
    private readonly dialect:    Dialect,
    private readonly table:      string,
    private readonly primaryKey: string,
    /** Read-pool picker on a read/write-split connection (round-robin +
     *  sticky-aware, supplied by the adapter); `null` without a split. */
    private readonly readPick:   (() => Executor) | null = null,
  ) {}

  // ── internal helpers ─────────────────────────────────────

  /** The executor for a READ terminal: the read pool on a split connection,
   *  EXCEPT locked selects (`lockForUpdate`/`sharedLock`) — a lock is only
   *  meaningful on the write connection. Writes/`_reselect` never call this. */
  private _readExecutor(): Executor {
    if (this._lock !== null || this.readPick === null) return this.executor
    return this.readPick()
  }

  /** @internal — called by the Model layer to turn on soft-delete scoping. */
  _enableSoftDeletes(): this { this._softDeletes = true; return this }

  /** @internal — mark as a where-group sub-builder so terminals throw. */
  _markSubBuilder(): this { this._isSubBuilder = true; return this }

  private _assertNotSubBuilder(): void {
    if (this._isSubBuilder) {
      throw new Error(
        '[RudderJS ORM native] Sub-builder is for where* chaining only — call the terminal on the parent builder.',
      )
    }
  }

  private _state(): NativeQueryState {
    return {
      table:           this.table,
      primaryKey:      this.primaryKey,
      conditions:      this._conditions,
      orders:          this._orders,
      limitN:          this._limitN,
      offsetN:         this._offsetN,
      softDelete:      this._resolveSoftDelete(),
      deletedAtColumn: 'deletedAt',
      relationExists:  this._relationExists,
      aggregates:      this._aggregates,
      selects:         this._selects,
      rawSelects:      this._rawSelects,
      joins:           this._joins,
      groupBy:         this._groupBy,
      having:          this._having,
      unions:          this._unions,
      ctes:            this._ctes,
      distinct:        this._distinct,
      lock:            this._lock,
      lockOptions:     this._lockOpts,
    }
  }

  private _resolveSoftDelete(): 'exclude' | 'only' | 'with' {
    if (!this._softDeletes || this._withTrashed) return 'with'
    return this._onlyTrashed ? 'only' : 'exclude'
  }

  private _pushClause(boolean: 'AND' | 'OR', column: string, operator: WhereOperator, value: unknown): void {
    // Arrow column (`meta->prefs->lang`) = a JSON-path predicate, Laravel-style.
    // Detection here covers where/orWhere AND everything composed from them:
    // group callbacks, whereNot, and the whereIn/whereNull/whereBetween sugar.
    if (column.includes('->')) {
      const { column: col, segments } = parseJsonPath(column)
      this._conditions.push({ kind: 'json', boolean, column: col, segments, operator, value })
      return
    }
    const clause: WhereClause = { column, operator, value }
    this._conditions.push({ kind: 'clause', boolean, clause })
  }

  // ── where chaining ───────────────────────────────────────

  where(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    if (value === undefined) {
      this._pushClause('AND', column, '=', operatorOrValue)
    } else {
      this._pushClause('AND', column, operatorOrValue as WhereOperator, value)
    }
    return this
  }

  orWhere(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    if (value === undefined) {
      this._pushClause('OR', column, '=', operatorOrValue)
    } else {
      this._pushClause('OR', column, operatorOrValue as WhereOperator, value)
    }
    return this
  }

  whereColumn(left: string, operatorOrRight: WhereOperator | string, right?: string): this {
    this._pushColumn('AND', left, operatorOrRight, right)
    return this
  }

  orWhereColumn(left: string, operatorOrRight: WhereOperator | string, right?: string): this {
    this._pushColumn('OR', left, operatorOrRight, right)
    return this
  }

  private _pushColumn(
    boolean: 'AND' | 'OR',
    left: string,
    operatorOrRight: WhereOperator | string,
    right?: string,
  ): void {
    // Two-arg form (`whereColumn('a', 'b')`) means equality; three-arg carries
    // the operator in the middle.
    const operator = (right === undefined ? '=' : operatorOrRight) as WhereOperator
    const rightCol = right === undefined ? operatorOrRight : right
    this._conditions.push({ kind: 'column', boolean, left, operator, right: rightCol })
  }

  // ── date-component predicates (whereDate / whereTime / whereDay / …) ──

  whereDate(column: string, operatorOrValue: WhereOperator | string | Date, value?: string | Date): this {
    this._pushDatePart('AND', 'date', column, operatorOrValue, value)
    return this
  }

  orWhereDate(column: string, operatorOrValue: WhereOperator | string | Date, value?: string | Date): this {
    this._pushDatePart('OR', 'date', column, operatorOrValue, value)
    return this
  }

  whereTime(column: string, operatorOrValue: WhereOperator | string | Date, value?: string | Date): this {
    this._pushDatePart('AND', 'time', column, operatorOrValue, value)
    return this
  }

  orWhereTime(column: string, operatorOrValue: WhereOperator | string | Date, value?: string | Date): this {
    this._pushDatePart('OR', 'time', column, operatorOrValue, value)
    return this
  }

  whereDay(column: string, operatorOrValue: WhereOperator | number | string | Date, value?: number | string | Date): this {
    this._pushDatePart('AND', 'day', column, operatorOrValue, value)
    return this
  }

  orWhereDay(column: string, operatorOrValue: WhereOperator | number | string | Date, value?: number | string | Date): this {
    this._pushDatePart('OR', 'day', column, operatorOrValue, value)
    return this
  }

  whereMonth(column: string, operatorOrValue: WhereOperator | number | string | Date, value?: number | string | Date): this {
    this._pushDatePart('AND', 'month', column, operatorOrValue, value)
    return this
  }

  orWhereMonth(column: string, operatorOrValue: WhereOperator | number | string | Date, value?: number | string | Date): this {
    this._pushDatePart('OR', 'month', column, operatorOrValue, value)
    return this
  }

  whereYear(column: string, operatorOrValue: WhereOperator | number | string | Date, value?: number | string | Date): this {
    this._pushDatePart('AND', 'year', column, operatorOrValue, value)
    return this
  }

  orWhereYear(column: string, operatorOrValue: WhereOperator | number | string | Date, value?: number | string | Date): this {
    this._pushDatePart('OR', 'year', column, operatorOrValue, value)
    return this
  }

  private _pushDatePart(
    boolean: 'AND' | 'OR',
    part: DatePart,
    column: string,
    operatorOrValue: WhereOperator | unknown,
    value?: unknown,
  ): void {
    // Two-arg form (`whereDate('createdAt', '2026-01-01')`) means equality;
    // three-arg carries the operator in the middle (Laravel semantics).
    const operator = (value === undefined ? '=' : operatorOrValue) as WhereOperator
    const rawValue = value === undefined ? operatorOrValue : value
    this._conditions.push({
      kind: 'date', boolean, part, column,
      operator,
      value: normalizeDatePartValue(part, rawValue),
    })
  }

  // ── JSON predicates (whereJsonContains / whereJsonLength) ──

  /** `whereJsonContains('meta->tags', 'php')` — JSON containment at an arrow
   *  path (or the whole column when no `->`). `value` may be a scalar or an
   *  array (every element contained). pg `@>`, mysql `JSON_CONTAINS`, sqlite
   *  emulated via `json_each` EXISTS (scalars only there). */
  whereJsonContains(column: string, value: unknown): this {
    this._pushJsonContains('AND', column, value, false)
    return this
  }

  /** OR-rooted {@link whereJsonContains}. */
  orWhereJsonContains(column: string, value: unknown): this {
    this._pushJsonContains('OR', column, value, false)
    return this
  }

  /** Negated {@link whereJsonContains} — `NOT (…)` around the containment. */
  whereJsonDoesntContain(column: string, value: unknown): this {
    this._pushJsonContains('AND', column, value, true)
    return this
  }

  /** OR-rooted {@link whereJsonDoesntContain}. */
  orWhereJsonDoesntContain(column: string, value: unknown): this {
    this._pushJsonContains('OR', column, value, true)
    return this
  }

  /** `whereJsonLength('meta->tags', '>', 2)` — compare a JSON array's length.
   *  Two-arg form (`(column, n)`) is equality. sqlite/pg `json(b)_array_length`,
   *  mysql `JSON_LENGTH`. */
  whereJsonLength(column: string, operatorOrValue: WhereOperator | number, value?: number): this {
    this._pushJsonLength('AND', column, operatorOrValue, value)
    return this
  }

  /** OR-rooted {@link whereJsonLength}. */
  orWhereJsonLength(column: string, operatorOrValue: WhereOperator | number, value?: number): this {
    this._pushJsonLength('OR', column, operatorOrValue, value)
    return this
  }

  private _pushJsonContains(boolean: 'AND' | 'OR', column: string, value: unknown, negated: boolean): void {
    const target = this._jsonTarget(column)
    this._conditions.push({ kind: 'jsonContains', boolean, ...target, value, negated })
  }

  private _pushJsonLength(
    boolean: 'AND' | 'OR',
    column: string,
    operatorOrValue: WhereOperator | number,
    value?: number,
  ): void {
    // Two-arg form (`whereJsonLength('meta->tags', 2)`) means equality;
    // three-arg carries the operator in the middle (Laravel semantics).
    const operator = (value === undefined ? '=' : operatorOrValue) as WhereOperator
    const count    = value === undefined ? (operatorOrValue as number) : value
    if (!Number.isInteger(count)) {
      throw new Error(`[RudderJS ORM native] whereJsonLength expects an integer length, got ${String(count)}.`)
    }
    const target = this._jsonTarget(column)
    this._conditions.push({ kind: 'jsonLength', boolean, ...target, operator, value: count })
  }

  /** Column-or-arrow-path → `{ column, segments }` ( `[]` segments = whole column). */
  private _jsonTarget(column: string): { column: string; segments: readonly (string | number)[] } {
    return column.includes('->') ? parseJsonPath(column) : { column, segments: [] }
  }

  whereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    this._addGroup('AND', fn)
    return this
  }

  orWhereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    this._addGroup('OR', fn)
    return this
  }

  /** Negated group — `NOT (…)` around the callback's conditions (Laravel's
   *  `whereNot`). An empty callback is a no-op, same as `whereGroup`. */
  whereNot(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    this._addGroup('AND', fn, true)
    return this
  }

  /** OR-rooted {@link whereNot} — `… OR NOT (…)`. */
  orWhereNot(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    this._addGroup('OR', fn, true)
    return this
  }

  private _addGroup(boolean: 'AND' | 'OR', fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void, negated = false): void {
    const sub = new NativeQueryBuilder<T>(this.executor, this.dialect, this.table, this.primaryKey)
      ._markSubBuilder()
    fn(sub)
    if (sub._conditions.length === 0) return // empty group is a no-op
    this._conditions.push(
      negated
        ? { kind: 'group', boolean, children: sub._conditions, negated: true }
        : { kind: 'group', boolean, children: sub._conditions },
    )
  }

  orderBy(column: string | Expression, direction: 'ASC' | 'DESC' = 'ASC'): this {
    if (column instanceof Expression) {
      this._orders.push({ kind: 'raw', raw: { sql: String(column.getValue()), bindings: [] } })
    } else {
      this._orders.push({ column, direction })
    }
    return this
  }

  // ── raw-SQL escape hatch ─────────────────────────────────

  selectRaw(sql: string, bindings: readonly unknown[] = []): this {
    this._rawSelects.push({ sql, bindings })
    return this
  }

  whereRaw(sql: string, bindings: readonly unknown[] = []): this {
    this._conditions.push({ kind: 'raw', boolean: 'AND', raw: { sql, bindings } })
    return this
  }

  orWhereRaw(sql: string, bindings: readonly unknown[] = []): this {
    this._conditions.push({ kind: 'raw', boolean: 'OR', raw: { sql, bindings } })
    return this
  }

  orderByRaw(sql: string, bindings: readonly unknown[] = []): this {
    this._orders.push({ kind: 'raw', raw: { sql, bindings } })
    return this
  }

  // ── projection + joins ───────────────────────────────────

  /** Structured projection — `select('users.id', 'posts.title')`. Each column is
   *  identifier-quoted (qualified `table.col` supported) and REPLACES the default
   *  `*`. Accumulates with `selectRaw` (structured first, then raw). */
  select(...columns: string[]): this {
    this._selects.push(...columns)
    return this
  }

  /** `SELECT DISTINCT` — de-duplicate the projected rows. */
  distinct(): this {
    this._distinct = true
    return this
  }

  /** `INNER JOIN`. Simple form `join('posts', 'posts.userId', '=', 'users.id')`
   *  (the operator is optional and defaults to `=`); callback form
   *  `join('posts', (j) => j.on(...).where(...))` for compound ON clauses. */
  join(table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): this {
    return this._addJoin('inner', table, first, operator, second)
  }

  /** `LEFT JOIN` — same call forms as {@link join}. */
  leftJoin(table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): this {
    return this._addJoin('left', table, first, operator, second)
  }

  /** `RIGHT JOIN` — same call forms as {@link join}. (SQLite 3.39+; native on pg/mysql.) */
  rightJoin(table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): this {
    return this._addJoin('right', table, first, operator, second)
  }

  /** `CROSS JOIN` — Cartesian product, no ON clause. */
  crossJoin(table: string): this {
    this._joins.push({ type: 'cross', table, conditions: [] })
    return this
  }

  private _addJoin(
    type: 'inner' | 'left' | 'right',
    table: string,
    first: string | ((join: JoinClause) => void),
    operator?: WhereOperator,
    second?: string,
  ): this {
    const conditions: JoinCondition[] = []
    if (typeof first === 'function') {
      first(new NativeJoinClause(conditions))
    } else {
      // Two-arg ON (`join(t, 'a', 'b')`) is equality; three-arg carries the operator.
      const op    = (second === undefined ? '=' : operator) as WhereOperator
      const right = second === undefined ? operator as string : second
      conditions.push({ kind: 'on', boolean: 'AND', left: first, operator: op, right })
    }
    this._joins.push({ type, table, conditions })
    return this
  }

  // ── grouping ─────────────────────────────────────────────

  /** `GROUP BY col [, …]` — columns identifier-quoted (qualified `table.col` ok). */
  groupBy(...columns: string[]): this {
    this._groupBy.push(...columns)
    return this
  }

  /** `HAVING col <op> value` — filter on grouped rows / a SELECT alias. Two-arg
   *  form is equality; the value binds. For an aggregate use {@link havingRaw}. */
  having(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    return this._pushHaving('AND', column, operatorOrValue, value)
  }

  /** OR-rooted {@link having}. */
  orHaving(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    return this._pushHaving('OR', column, operatorOrValue, value)
  }

  /** `HAVING <raw>` — the portable way to filter on an aggregate, e.g.
   *  `havingRaw('COUNT(*) > ?', [3])`. `?` placeholders bind positionally. */
  havingRaw(sql: string, bindings: readonly unknown[] = []): this {
    this._having.push({ kind: 'raw', boolean: 'AND', raw: { sql, bindings } })
    return this
  }

  /** OR-rooted {@link havingRaw}. */
  orHavingRaw(sql: string, bindings: readonly unknown[] = []): this {
    this._having.push({ kind: 'raw', boolean: 'OR', raw: { sql, bindings } })
    return this
  }

  private _pushHaving(boolean: 'AND' | 'OR', column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    const operator = (value === undefined ? '=' : operatorOrValue) as WhereOperator
    const val      = value === undefined ? operatorOrValue : value
    this._having.push({ kind: 'clause', boolean, clause: { column, operator, value: val } })
    return this
  }

  // ── unions ───────────────────────────────────────────────

  /** `… UNION …` — append another query as a UNION member (duplicate rows
   *  removed). The combined result takes THIS query's ORDER BY / LIMIT / OFFSET;
   *  the member's own are ignored. `other` is another native query (`Model.query()`). */
  union(other: QueryBuilder<T>): this {
    return this._addUnion(other, false)
  }

  /** `… UNION ALL …` — like {@link union} but keeps duplicate rows. */
  unionAll(other: QueryBuilder<T>): this {
    return this._addUnion(other, true)
  }

  private _addUnion(other: QueryBuilder<T>, all: boolean): this {
    // `other` is usually the HydratingQueryBuilder Proxy wrapping a
    // NativeQueryBuilder — unwrap it via the global symbol the proxy answers.
    const target = (other as unknown as Record<symbol, unknown>)[QB_TARGET] ?? other
    if (!(target instanceof NativeQueryBuilder)) {
      throw new Error(
        '[RudderJS ORM native] union()/unionAll() requires another native query builder — pass a Model.query() of a native-engine model.',
      )
    }
    this._unions.push({ all, state: (target as NativeQueryBuilder<T>)._state() })
    return this
  }

  // ── common table expressions ─────────────────────────────

  /**
   * `WITH name AS (…)` — prepend a common table expression the main query can
   * reference (typically via `join('name', …)` — the FROM stays the model's
   * table). `query` is another native query (`Model.query()` chain) or a raw
   * SQL string with `?` placeholders + `opts.bindings`. CTE bindings precede
   * the main query's (SQL text order). Read-side only (`get`/`first`/`find`/
   * `count`/`paginate`); a builder-backed body keeps its own UNION members but
   * drops ORDER BY / LIMIT (same rule as `union()`).
   */
  withExpression(name: string, query: QueryBuilder<unknown> | string, opts: { bindings?: readonly unknown[]; columns?: readonly string[] } = {}): this {
    return this._addCte(name, query, opts, false)
  }

  /**
   * `WITH RECURSIVE name [(cols)] AS (…)` — like {@link withExpression} for a
   * self-referencing body. Recursive bodies are usually a raw SQL string (the
   * body references the CTE's own name, which a table-rooted builder can't
   * express): `withRecursiveExpression('tree', 'SELECT … UNION ALL SELECT …
   * FROM t JOIN tree …', { bindings: [rootId], columns: ['id'] })`.
   */
  withRecursiveExpression(name: string, query: QueryBuilder<unknown> | string, opts: { bindings?: readonly unknown[]; columns?: readonly string[] } = {}): this {
    return this._addCte(name, query, opts, true)
  }

  private _addCte(
    name: string,
    query: QueryBuilder<unknown> | string,
    opts: { bindings?: readonly unknown[]; columns?: readonly string[] },
    recursive: boolean,
  ): this {
    const body = this._subqueryBody('withExpression', query, opts.bindings)
    this._ctes.push({ name, recursive, body, ...(opts.columns !== undefined ? { columns: opts.columns } : {}) })
    return this
  }

  // ── EXISTS subqueries ────────────────────────────────────

  /**
   * `WHERE EXISTS (…)` — an arbitrary EXISTS subquery. `query` is another
   * native query (`Model.query()` chain — correlate to the outer table via
   * qualified `whereColumn('orders.userId', 'users.id')` refs) or a raw SQL
   * string with `?` placeholders + `bindings`. For relation-shaped existence
   * checks prefer `whereHas` — this is the escape hatch for subqueries no
   * declared relation describes.
   */
  whereExists(query: QueryBuilder<unknown> | string, bindings?: readonly unknown[]): this {
    return this._addExists('AND', false, query, bindings)
  }

  /** `WHERE NOT EXISTS (…)` — negated {@link whereExists}. */
  whereNotExists(query: QueryBuilder<unknown> | string, bindings?: readonly unknown[]): this {
    return this._addExists('AND', true, query, bindings)
  }

  /** OR-rooted {@link whereExists}. */
  orWhereExists(query: QueryBuilder<unknown> | string, bindings?: readonly unknown[]): this {
    return this._addExists('OR', false, query, bindings)
  }

  /** OR-rooted {@link whereNotExists}. */
  orWhereNotExists(query: QueryBuilder<unknown> | string, bindings?: readonly unknown[]): this {
    return this._addExists('OR', true, query, bindings)
  }

  private _addExists(
    boolean: 'AND' | 'OR',
    negated: boolean,
    query: QueryBuilder<unknown> | string,
    bindings?: readonly unknown[],
  ): this {
    this._conditions.push({ kind: 'exists', boolean, negated, body: this._subqueryBody('whereExists', query, bindings) })
    return this
  }

  /** @internal — resolve a builder-or-raw subquery argument to a `SubqueryBody`
   *  (shared by `whereExists` and `insertUsing`). Raw strings carry their own
   *  `?` bindings; builders are proxy-unwrapped and must be native. */
  private _subqueryBody(method: string, query: QueryBuilder<unknown> | string, bindings?: readonly unknown[]): SubqueryBody {
    if (typeof query === 'string') {
      return { kind: 'raw', raw: { sql: query, bindings: bindings ?? [] } }
    }
    if (bindings !== undefined) {
      throw new Error(
        `[RudderJS ORM native] ${method}() bindings are only valid with a raw-SQL body — a query-builder body carries its own.`,
      )
    }
    const target = (query as unknown as Record<symbol, unknown>)[QB_TARGET] ?? query
    if (!(target instanceof NativeQueryBuilder)) {
      throw new Error(
        `[RudderJS ORM native] ${method}() requires a native query builder or a raw SQL string body.`,
      )
    }
    return { kind: 'state', state: (target as NativeQueryBuilder<unknown>)._state() }
  }

  limit(n: number):  this { this._limitN  = n; return this }
  offset(n: number): this { this._offsetN = n; return this }

  withTrashed(): this { this._withTrashed = true; return this }
  onlyTrashed(): this { this._onlyTrashed = true; return this }

  /** Pessimistic `FOR UPDATE` row lock (no-op on SQLite — see {@link Dialect.lockSql}).
   *  Only meaningful inside a `transaction()`; the powering primitive for the
   *  native database queue's atomic job reservation. `opts.skipLocked` skips
   *  already-locked rows (`SKIP LOCKED`), `opts.noWait` errors instead of
   *  blocking (`NOWAIT`) — mutually exclusive, both throw. */
  lockForUpdate(opts?: LockOptions): this {
    this._lock = 'update'
    this._lockOpts = this._validateLockOpts('lockForUpdate', opts)
    return this
  }

  /** Shared `FOR SHARE` row lock (no-op on SQLite). Same options as
   *  {@link lockForUpdate}. */
  sharedLock(opts?: LockOptions): this {
    this._lock = 'shared'
    this._lockOpts = this._validateLockOpts('sharedLock', opts)
    return this
  }

  /** `skipLocked` skips conflicting rows; `noWait` errors on them — asking for
   *  both is a contradiction, so it throws here at the call site (every
   *  dialect), not at compile/execute time. */
  private _validateLockOpts(method: string, opts?: LockOptions): LockOptions | null {
    if (!opts) return null
    if (opts.skipLocked && opts.noWait) {
      throw new Error(
        `[RudderJS ORM native] ${method}() options skipLocked and noWait are mutually ` +
        'exclusive — skip conflicting rows OR fail fast on them, not both. Pass at most one.',
      )
    }
    return opts
  }

  // ── read terminals ───────────────────────────────────────

  /**
   * Coerce `withExists` aggregate aliases from SQLite's integer `1`/`0` to a JS
   * boolean. SQLite has no boolean type, so the `(COUNT(*) > 0)` subselect comes
   * back as a number — the Model contract (and the other adapters over Postgres,
   * which returns a real boolean) expect `true`/`false`. Only `exists` requests
   * are touched; count/sum/min/max/avg stay numeric. No-op when no aggregates.
   */
  private _coerceAggregates(rows: Row[]): Row[] {
    const existsAliases = this._aggregates.filter(a => a.fn === 'exists').map(a => a.alias)
    if (existsAliases.length === 0) return rows
    for (const row of rows) {
      for (const alias of existsAliases) {
        if (alias in row) row[alias] = Number(row[alias]) > 0
      }
    }
    return rows
  }

  async first(): Promise<T | null> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileSelect(this._state(), this.dialect, { limit: 1 })
    const rows = this._coerceAggregates(await this._readExecutor().execute(sql, bindings))
    return (rows[0] as T | undefined) ?? null
  }

  async find(id: number | string): Promise<T | null> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileSelect(this._state(), this.dialect, { limit: 1, extraConditions: this._pkCondition(id) })
    const rows = this._coerceAggregates(await this._readExecutor().execute(sql, bindings))
    return (rows[0] as T | undefined) ?? null
  }

  async get(): Promise<T[]> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileSelect(this._state(), this.dialect)
    const rows = this._coerceAggregates(await this._readExecutor().execute(sql, bindings))
    return rows as T[]
  }

  async all(): Promise<T[]> {
    return this.get()
  }

  async count(): Promise<number> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileCount(this._state(), this.dialect)
    const rows = await this._readExecutor().execute(sql, bindings)
    return Number((rows[0] as Row | undefined)?.['count'] ?? 0)
  }

  async paginate(page = 1, perPage = 15): Promise<PaginatedResult<T>> {
    this._assertNotSubBuilder()
    const safePage    = page < 1 ? 1 : Math.floor(page)
    const safePerPage = perPage < 1 ? 15 : Math.floor(perPage)

    const total = await this.count()

    const pageState: NativeQueryState = {
      ...this._state(),
      limitN:  safePerPage,
      offsetN: (safePage - 1) * safePerPage,
    }
    const { sql, bindings } = compileSelect(pageState, this.dialect)
    const rows = this._coerceAggregates(await this._readExecutor().execute(sql, bindings))

    const lastPage = Math.max(1, Math.ceil(total / safePerPage))
    return {
      data:        rows as T[],
      total,
      perPage:     safePerPage,
      currentPage: safePage,
      lastPage,
      from: total === 0 ? 0 : (safePage - 1) * safePerPage + 1,
      to:   Math.min(safePage * safePerPage, total),
    }
  }

  // ── write path (Phase 2) ─────────────────────────────────

  with(...relations: string[]): this {
    // Eager loading isn't expressible at THIS level — the adapter receives
    // relation NAMES only, with no join shape to compile from. The Model layer
    // never forwards here: the adapter advertises `eagerLoadStrategy:
    // 'model-layer'`, so direct relations resolve via batched WHERE-IN
    // (direct-eager-load.ts) and polymorphic ones via their own loader. The
    // only remaining callers are `withWhereHas`'s constrained-eager fallback
    // and direct adapter-QB use, where this IS a no-op — warn once per
    // relation in dev so it isn't mistaken for working; production stays silent.
    const isProd = typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'production'
    if (!isProd) {
      for (const rel of relations) {
        if (_warnedWith.has(rel)) continue
        _warnedWith.add(rel)
        console.warn(
          `[RudderJS ORM native] adapter-level with("${rel}") is a no-op — the row is returned ` +
          `without "${rel}" populated. Constrained eager-load (withWhereHas) isn't supported on ` +
          `the native engine: chain .whereHas(...) for the filter plus .with("${rel}") for the ` +
          `(unconstrained) load, or use instance.related("${rel}").`,
        )
      }
    }
    return this
  }

  withPivot(..._columns: string[]): this { return this }

  /** @internal — the primary-key match used by by-id terminals. */
  private _pkCondition(id: number | string): ConditionNode[] {
    return [{ kind: 'clause', boolean: 'AND', clause: { column: this.primaryKey, operator: '=', value: id } }]
  }

  /**
   * @internal — state for a by-id write (`update`/`delete`/`restore`/
   * `forceDelete`/`increment`). The accumulated `where()` predicate and
   * soft-delete scoping are dropped — these target a single row by primary key
   * (the PK match is passed as an `extraCondition`). Matches the orm-drizzle
   * adapter, whose by-id writes also ignore chained wheres.
   */
  private _idState(): NativeQueryState {
    return { ...this._state(), conditions: [], softDelete: 'with', lock: null }
  }

  // ── no-RETURNING write path (MySQL) ──────────────────────
  //
  // SQLite/Postgres read written rows back via `RETURNING *`. MySQL has none, so
  // the write terminals below branch on `dialect.supportsReturning`: they run the
  // bare INSERT/UPDATE/DELETE and read the result from the driver's metadata
  // ({@link AffectingExecutor}) — `insertId` for `create`, `affectedRows` for the
  // bulk terminals — then re-SELECT by primary key for terminals that must return
  // the row. SQLite/Postgres keep their exact existing RETURNING path untouched.

  /** @internal — run a write and read its `insertId` / `affectedRows`. Throws if
   *  the active driver can't report write metadata (an internal invariant: every
   *  no-RETURNING dialect driver implements `AffectingExecutor`). */
  private async _affecting(sql: string, bindings: readonly unknown[]): Promise<{ insertId: number | null; affectedRows: number }> {
    const ex = this.executor as Partial<AffectingExecutor>
    if (typeof ex.affectingExecute !== 'function') {
      throw new Error(
        '[RudderJS ORM native] The active driver cannot run writes without RETURNING ' +
        '(no affectingExecute). Every non-RETURNING dialect driver must implement AffectingExecutor.',
      )
    }
    return ex.affectingExecute(sql, bindings)
  }

  /** @internal — re-SELECT a row by primary key after a no-RETURNING write. Runs
   *  on `this.executor`, so inside a transaction it stays on the txn connection. */
  private async _reselect(id: number | string): Promise<T | null> {
    const { sql, bindings } = compileSelect(this._idState(), this.dialect, { limit: 1, extraConditions: this._pkCondition(id) })
    const rows = await this.executor.execute(sql, bindings)
    return (rows[0] as T | undefined) ?? null
  }

  async create(data: Partial<T>): Promise<T> {
    this._assertNotSubBuilder()
    if (this.dialect.supportsReturning) {
      const { sql, bindings } = compileInsert(
        this._state(), this.dialect, [data as Record<string, unknown>], { returning: true },
      )
      const rows = await this.executor.execute(sql, bindings)
      if (!rows[0]) throw new Error('[RudderJS ORM native] create() returned no rows.')
      return rows[0] as T
    }
    // No RETURNING (MySQL): INSERT, then re-SELECT by primary key — same as the
    // `update()` path — so the returned row is the REAL stored row (DB-applied
    // defaults, driver type mapping), byte-consistent with the RETURNING
    // dialects. The PK is the auto-increment `insertId`, or the caller-supplied
    // key (uuid/ulid models stamp it before insert).
    const { sql, bindings } = compileInsert(
      this._state(), this.dialect, [data as Record<string, unknown>], { returning: false },
    )
    const { insertId } = await this._affecting(sql, bindings)
    const suppliedKey = (data as Record<string, unknown>)[this.primaryKey]
    const id = insertId ?? (suppliedKey as number | string | undefined)
    if (id === undefined || id === null) {
      // No way to identify the row (no auto-increment, no supplied key) —
      // synthesize from the input as the best effort.
      return { ...(data as Record<string, unknown>) } as T
    }
    const row = await this._reselect(id)
    if (!row) throw new Error('[RudderJS ORM native] create() could not re-select the inserted row.')
    return row
  }

  async update(id: number | string, data: Partial<T>): Promise<T> {
    this._assertNotSubBuilder()
    if (this.dialect.supportsReturning) {
      const { sql, bindings } = compileUpdate(
        this._idState(), this.dialect, data as Record<string, unknown>,
        { extraConditions: this._pkCondition(id), returning: true },
      )
      const rows = await this.executor.execute(sql, bindings)
      if (!rows[0]) throw new Error('[RudderJS ORM native] update() returned no rows.')
      return rows[0] as T
    }
    // No RETURNING (MySQL): UPDATE, then re-SELECT the row by primary key.
    const { sql, bindings } = compileUpdate(
      this._idState(), this.dialect, data as Record<string, unknown>,
      { extraConditions: this._pkCondition(id), returning: false },
    )
    await this.executor.execute(sql, bindings)
    const row = await this._reselect(id)
    if (!row) throw new Error('[RudderJS ORM native] update() target row not found.')
    return row
  }

  async updateAll(data: Partial<T>): Promise<number> {
    this._assertNotSubBuilder()
    if (this.dialect.supportsReturning) {
      const { sql, bindings } = compileUpdate(
        this._state(), this.dialect, data as Record<string, unknown>, { returning: true },
      )
      const rows = await this.executor.execute(sql, bindings)
      return rows.length
    }
    const { sql, bindings } = compileUpdate(
      this._state(), this.dialect, data as Record<string, unknown>, { returning: false },
    )
    const { affectedRows } = await this._affecting(sql, bindings)
    return affectedRows
  }

  async delete(id: number | string): Promise<void> {
    this._assertNotSubBuilder()
    if (this._softDeletes) {
      // Soft delete: stamp deletedAt instead of removing the row. ISO string —
      // the read path filters on `deletedAt IS [NOT] NULL` regardless of format,
      // and better-sqlite3 can't bind a Date directly.
      const { sql, bindings } = compileUpdate(
        this._idState(), this.dialect, { deletedAt: new Date().toISOString() },
        { extraConditions: this._pkCondition(id) },
      )
      await this.executor.execute(sql, bindings)
      return
    }
    const { sql, bindings } = compileDelete(
      this._idState(), this.dialect, { extraConditions: this._pkCondition(id) },
    )
    await this.executor.execute(sql, bindings)
  }

  async deleteAll(): Promise<number> {
    this._assertNotSubBuilder()
    // Uses the full current predicate INCLUDING soft-delete scope (call
    // withTrashed() first to bulk-delete trashed rows too) — matches orm-drizzle.
    if (this.dialect.supportsReturning) {
      const { sql, bindings } = compileDelete(this._state(), this.dialect, { returning: true })
      const rows = await this.executor.execute(sql, bindings)
      return rows.length
    }
    const { sql, bindings } = compileDelete(this._state(), this.dialect, { returning: false })
    const { affectedRows } = await this._affecting(sql, bindings)
    return affectedRows
  }

  async insertMany(rows: Partial<T>[]): Promise<void> {
    this._assertNotSubBuilder()
    if (rows.length === 0) return
    const { sql, bindings } = compileInsert(
      this._state(), this.dialect, rows as Record<string, unknown>[], { returning: false },
    )
    await this.executor.execute(sql, bindings)
  }

  async upsert(rows: Partial<T>[], uniqueBy: string[], update: string[]): Promise<number> {
    this._assertNotSubBuilder()
    if (rows.length === 0) return 0
    const upsert = { uniqueBy, update }
    // SQLite/Postgres: one statement with RETURNING — affected = rows returned.
    if (this.dialect.supportsReturning) {
      const { sql, bindings } = compileInsert(
        this._state(), this.dialect, rows as Record<string, unknown>[], { returning: true, upsert },
      )
      const out = await this.executor.execute(sql, bindings)
      return out.length
    }
    // MySQL: no RETURNING — read affectedRows off the driver metadata. (MySQL
    // counts 1 per inserted row and 2 per row updated via ON DUPLICATE KEY, so
    // this is rows-touched, not rows-distinct — a documented MySQL quirk.)
    const { sql, bindings } = compileInsert(
      this._state(), this.dialect, rows as Record<string, unknown>[], { returning: false, upsert },
    )
    const { affectedRows } = await this._affecting(sql, bindings)
    return affectedRows
  }

  /**
   * `INSERT INTO table (cols) SELECT …` — insert rows produced by a subquery
   * (another native query or a raw SQL string + bindings; same body forms as
   * {@link whereExists}). The column list is required and maps the subquery's
   * projection positionally. Returns the inserted-row count. Bulk data-plane
   * write: no observer events, no fillable/guarded filtering, no key
   * generation — like `insertMany`/`upsert`.
   */
  async insertUsing(columns: readonly string[], query: QueryBuilder<unknown> | string, bindings?: readonly unknown[]): Promise<number> {
    this._assertNotSubBuilder()
    const body = this._subqueryBody('insertUsing', query, bindings)
    // SQLite/Postgres: RETURNING * — inserted = rows returned.
    if (this.dialect.supportsReturning) {
      const { sql, bindings: binds } = compileInsertUsing(this._state(), this.dialect, columns, body, { returning: true })
      const out = await this.executor.execute(sql, binds)
      return out.length
    }
    // MySQL: no RETURNING — read affectedRows off the driver metadata.
    const { sql, bindings: binds } = compileInsertUsing(this._state(), this.dialect, columns, body, { returning: false })
    const { affectedRows } = await this._affecting(sql, binds)
    return affectedRows
  }

  async restore(id: number | string): Promise<T> {
    this._assertNotSubBuilder()
    if (this.dialect.supportsReturning) {
      const { sql, bindings } = compileUpdate(
        this._idState(), this.dialect, { deletedAt: null },
        { extraConditions: this._pkCondition(id), returning: true },
      )
      const rows = await this.executor.execute(sql, bindings)
      return rows[0] as T
    }
    // No RETURNING (MySQL): clear deletedAt, then re-SELECT the restored row.
    const { sql, bindings } = compileUpdate(
      this._idState(), this.dialect, { deletedAt: null },
      { extraConditions: this._pkCondition(id), returning: false },
    )
    await this.executor.execute(sql, bindings)
    return (await this._reselect(id)) as T
  }

  async forceDelete(id: number | string): Promise<void> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileDelete(
      this._idState(), this.dialect, { extraConditions: this._pkCondition(id) },
    )
    await this.executor.execute(sql, bindings)
  }

  increment(id: number | string, column: string, amount = 1, extra: Record<string, unknown> = {}): Promise<T> {
    return this._delta(id, column, amount, extra)
  }

  decrement(id: number | string, column: string, amount = 1, extra: Record<string, unknown> = {}): Promise<T> {
    return this._delta(id, column, -amount, extra)
  }

  /** @internal — shared increment/decrement path. `delta` is signed. Atomic
   *  `SET col = col + ?` at the DB; NO observer events fire (pure data-plane,
   *  matching the ORM's documented increment/decrement semantics). */
  private async _delta(
    id: number | string, column: string, delta: number, extra: Record<string, unknown>,
  ): Promise<T> {
    this._assertNotSubBuilder()
    if (this.dialect.supportsReturning) {
      const { sql, bindings } = compileIncrement(
        this._idState(), this.dialect, column, delta, extra,
        { extraConditions: this._pkCondition(id), returning: true },
      )
      const rows = await this.executor.execute(sql, bindings)
      if (!rows[0]) throw new Error('[RudderJS ORM native] increment/decrement target row not found.')
      return rows[0] as T
    }
    // No RETURNING (MySQL): atomic UPDATE, then re-SELECT the updated row.
    const { sql, bindings } = compileIncrement(
      this._idState(), this.dialect, column, delta, extra,
      { extraConditions: this._pkCondition(id), returning: false },
    )
    await this.executor.execute(sql, bindings)
    const row = await this._reselect(id)
    if (!row) throw new Error('[RudderJS ORM native] increment/decrement target row not found.')
    return row
  }

  // ── relations + aggregates (Phase 3) ─────────────────────

  /**
   * Accumulate a relation-existence predicate (`whereHas` / `whereDoesntHave`).
   * Compiled to a correlated `EXISTS` / `NOT EXISTS` subquery AND-merged into
   * the WHERE at terminal time. Composes with flat wheres, soft deletes, and
   * other relation predicates.
   */
  whereRelationExists(predicate: RelationExistencePredicate): this {
    this._relationExists.push(predicate)
    return this
  }

  /**
   * Accumulate aggregate eager-load requests (`withCount`/`withSum`/etc.). Each
   * becomes a correlated `(subselect) AS alias` column in the SELECT list, so
   * the value is stamped on every returned row under `alias` (the Model
   * hydration layer copies it onto the instance).
   */
  withAggregate(requests: AggregateRequest[]): this {
    this._aggregates.push(...requests)
    return this
  }

  /**
   * Single-scalar aggregate terminal — `SELECT fn(col) FROM table WHERE …`.
   * Powers `instance.loadSum`/`loadMin`/etc. Returns `0` for count, `0` for sum
   * on an empty set, `null` for min/max/avg on an empty set, and a boolean for
   * `exists`. `column` is required for sum/min/max/avg.
   */
  async _aggregate(fn: AggregateFn, column?: string): Promise<unknown> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileScalarAggregate(this._state(), this.dialect, fn, column)
    const rows = await this._readExecutor().execute(sql, bindings)
    const raw = (rows[0] as Row | undefined)?.['value']
    if (fn === 'count')  return Number(raw ?? 0)
    if (fn === 'exists') return Number(raw ?? 0) > 0
    if (raw === null || raw === undefined) return fn === 'sum' ? 0 : null
    return Number(raw)
  }
}

/**
 * The sub-builder passed to the callback form of `join(...)`. Pushes
 * {@link JoinCondition}s into the array the `NativeQueryBuilder` holds for that
 * join — `on`/`orOn` are column-vs-column (nothing binds), `where`/`orWhere`
 * are column-vs-value (the value binds at compile time).
 */
export class NativeJoinClause implements JoinClause {
  constructor(private readonly conditions: JoinCondition[]) {}

  on(left: string, operatorOrRight: WhereOperator | string, right?: string): this {
    return this._pushOn('AND', left, operatorOrRight, right)
  }

  orOn(left: string, operatorOrRight: WhereOperator | string, right?: string): this {
    return this._pushOn('OR', left, operatorOrRight, right)
  }

  where(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    return this._pushWhere('AND', column, operatorOrValue, value)
  }

  orWhere(column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    return this._pushWhere('OR', column, operatorOrValue, value)
  }

  private _pushOn(boolean: 'AND' | 'OR', left: string, operatorOrRight: WhereOperator | string, right?: string): this {
    const operator = (right === undefined ? '=' : operatorOrRight) as WhereOperator
    const rightCol = right === undefined ? operatorOrRight as string : right
    this.conditions.push({ kind: 'on', boolean, left, operator, right: rightCol })
    return this
  }

  private _pushWhere(boolean: 'AND' | 'OR', column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): this {
    const operator = (value === undefined ? '=' : operatorOrValue) as WhereOperator
    const val      = value === undefined ? operatorOrValue : value
    this.conditions.push({ kind: 'where', boolean, clause: { column, operator, value: val } })
    return this
  }
}

/**
 * Normalize a date-helper comparison value for binding (Laravel accepts a
 * `DateTimeInterface` everywhere; the JS analogue is `Date`):
 *
 * - `Date` → the matching component, **UTC-based** (`'YYYY-MM-DD'` for `date`,
 *   `'HH:MM:SS'` for `time`, integers for `day`/`month`/`year`) — consistent
 *   with the ORM storing ISO-8601/UTC timestamps.
 * - numeric strings on `day`/`month`/`year` → `Number`, so a `'05'` compares
 *   against the dialect's INTEGER extraction (SQLite never equates TEXT with
 *   INTEGER; pg/mysql would have to coerce).
 * - everything else passes through and binds as-is.
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
