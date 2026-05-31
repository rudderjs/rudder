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
  OrderClause,
  PaginatedResult,
  RelationExistencePredicate,
  AggregateRequest,
  AggregateFn,
} from '@rudderjs/contracts'
import type { Dialect } from './dialect.js'
import type { Executor, Row } from './driver.js'
import {
  compileSelect,
  compileCount,
  compileInsert,
  compileUpdate,
  compileIncrement,
  compileDelete,
  compileScalarAggregate,
  type ConditionNode,
  type NativeQueryState,
} from './compiler.js'

/** One-time dev warning that native `with(<direct relation>)` doesn't eager-load
 *  yet (Phase 3 limitation). Keyed per relation name so each distinct call site
 *  warns once. No-op in production. */
const _warnedWith = new Set<string>()

export class NativeQueryBuilder<T> implements QueryBuilder<T> {
  private readonly _conditions: ConditionNode[] = []
  private readonly _orders:     OrderClause[]   = []
  private readonly _relationExists: RelationExistencePredicate[] = []
  private readonly _aggregates:     AggregateRequest[] = []
  private _limitN:  number | null = null
  private _offsetN: number | null = null
  private _softDeletes  = false
  private _withTrashed  = false
  private _onlyTrashed  = false
  /** Marks a sub-builder created for whereGroup — terminals throw on it. */
  private _isSubBuilder = false

  constructor(
    private readonly executor:   Executor,
    private readonly dialect:    Dialect,
    private readonly table:      string,
    private readonly primaryKey: string,
  ) {}

  // ── internal helpers ─────────────────────────────────────

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
    }
  }

  private _resolveSoftDelete(): 'exclude' | 'only' | 'with' {
    if (!this._softDeletes || this._withTrashed) return 'with'
    return this._onlyTrashed ? 'only' : 'exclude'
  }

  private _pushClause(boolean: 'AND' | 'OR', column: string, operator: WhereOperator, value: unknown): void {
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

  whereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    this._addGroup('AND', fn)
    return this
  }

  orWhereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    this._addGroup('OR', fn)
    return this
  }

  private _addGroup(boolean: 'AND' | 'OR', fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): void {
    const sub = new NativeQueryBuilder<T>(this.executor, this.dialect, this.table, this.primaryKey)
      ._markSubBuilder()
    fn(sub)
    if (sub._conditions.length === 0) return // empty group is a no-op
    this._conditions.push({ kind: 'group', boolean, children: sub._conditions })
  }

  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this._orders.push({ column, direction })
    return this
  }

  limit(n: number):  this { this._limitN  = n; return this }
  offset(n: number): this { this._offsetN = n; return this }

  withTrashed(): this { this._withTrashed = true; return this }
  onlyTrashed(): this { this._onlyTrashed = true; return this }

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
    const rows = this._coerceAggregates(await this.executor.execute(sql, bindings))
    return (rows[0] as T | undefined) ?? null
  }

  async find(id: number | string): Promise<T | null> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileSelect(this._state(), this.dialect, { limit: 1, extraConditions: this._pkCondition(id) })
    const rows = this._coerceAggregates(await this.executor.execute(sql, bindings))
    return (rows[0] as T | undefined) ?? null
  }

  async get(): Promise<T[]> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileSelect(this._state(), this.dialect)
    const rows = this._coerceAggregates(await this.executor.execute(sql, bindings))
    return rows as T[]
  }

  async all(): Promise<T[]> {
    return this.get()
  }

  async count(): Promise<number> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileCount(this._state(), this.dialect)
    const rows = await this.executor.execute(sql, bindings)
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
    const rows = this._coerceAggregates(await this.executor.execute(sql, bindings))

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
    // Direct (non-polymorphic) eager-load isn't expressible through the current
    // adapter contract — the adapter receives relation NAMES only, with no join
    // shape. Polymorphic relations are already resolved in the Model layer
    // (polymorphic-eager-load.ts) and never reach here. So a direct `with()`
    // here is a silent no-op that would return rows WITHOUT the relation
    // populated. Warn once per relation in dev so it isn't mistaken for working;
    // production stays silent. Real native direct-eager-load is a contract-gap
    // decision reported at the end of Phase 3.
    const isProd = typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'production'
    if (!isProd) {
      for (const rel of relations) {
        if (_warnedWith.has(rel)) continue
        _warnedWith.add(rel)
        console.warn(
          `[RudderJS ORM native] with("${rel}") does not eager-load direct relations yet — ` +
          `the row is returned without "${rel}" populated. Load it via the relation accessor ` +
          `(await instance.related("${rel}").get()) for now. Polymorphic relations are unaffected.`,
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
    return { ...this._state(), conditions: [], softDelete: 'with' }
  }

  async create(data: Partial<T>): Promise<T> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileInsert(
      this._state(), this.dialect, [data as Record<string, unknown>], { returning: true },
    )
    const rows = await this.executor.execute(sql, bindings)
    if (!rows[0]) throw new Error('[RudderJS ORM native] create() returned no rows.')
    return rows[0] as T
  }

  async update(id: number | string, data: Partial<T>): Promise<T> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileUpdate(
      this._idState(), this.dialect, data as Record<string, unknown>,
      { extraConditions: this._pkCondition(id), returning: true },
    )
    const rows = await this.executor.execute(sql, bindings)
    if (!rows[0]) throw new Error('[RudderJS ORM native] update() returned no rows.')
    return rows[0] as T
  }

  async updateAll(data: Partial<T>): Promise<number> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileUpdate(
      this._state(), this.dialect, data as Record<string, unknown>, { returning: true },
    )
    const rows = await this.executor.execute(sql, bindings)
    return rows.length
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
    const { sql, bindings } = compileDelete(this._state(), this.dialect, { returning: true })
    const rows = await this.executor.execute(sql, bindings)
    return rows.length
  }

  async insertMany(rows: Partial<T>[]): Promise<void> {
    this._assertNotSubBuilder()
    if (rows.length === 0) return
    const { sql, bindings } = compileInsert(
      this._state(), this.dialect, rows as Record<string, unknown>[], { returning: false },
    )
    await this.executor.execute(sql, bindings)
  }

  async restore(id: number | string): Promise<T> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileUpdate(
      this._idState(), this.dialect, { deletedAt: null },
      { extraConditions: this._pkCondition(id), returning: true },
    )
    const rows = await this.executor.execute(sql, bindings)
    return rows[0] as T
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
    const { sql, bindings } = compileIncrement(
      this._idState(), this.dialect, column, delta, extra,
      { extraConditions: this._pkCondition(id), returning: true },
    )
    const rows = await this.executor.execute(sql, bindings)
    if (!rows[0]) throw new Error('[RudderJS ORM native] increment/decrement target row not found.')
    return rows[0] as T
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
    const rows = await this.executor.execute(sql, bindings)
    const raw = (rows[0] as Row | undefined)?.['value']
    if (fn === 'count')  return Number(raw ?? 0)
    if (fn === 'exists') return Number(raw ?? 0) > 0
    if (raw === null || raw === undefined) return fn === 'sum' ? 0 : null
    return Number(raw)
  }
}
