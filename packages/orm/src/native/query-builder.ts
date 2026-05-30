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
  type ConditionNode,
  type NativeQueryState,
} from './compiler.js'
import { NativeNotImplementedError } from './errors.js'

export class NativeQueryBuilder<T> implements QueryBuilder<T> {
  private readonly _conditions: ConditionNode[] = []
  private readonly _orders:     OrderClause[]   = []
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

  async first(): Promise<T | null> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileSelect(this._state(), this.dialect, { limit: 1 })
    const rows = await this.executor.execute(sql, bindings)
    return (rows[0] as T | undefined) ?? null
  }

  async find(id: number | string): Promise<T | null> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileSelect(this._state(), this.dialect, { limit: 1, extraConditions: this._pkCondition(id) })
    const rows = await this.executor.execute(sql, bindings)
    return (rows[0] as T | undefined) ?? null
  }

  async get(): Promise<T[]> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileSelect(this._state(), this.dialect)
    const rows = await this.executor.execute(sql, bindings)
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
    const rows = await this.executor.execute(sql, bindings)

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

  with(..._relations: string[]): this {
    // Eager loading lands in Phase 3; tolerate the call so the contract stays
    // satisfied and read chains that pass `with()` don't blow up early.
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

  whereRelationExists(_predicate: RelationExistencePredicate): this {
    throw new NativeNotImplementedError('whereRelationExists', 'Phase 3 (relations)')
  }
  withAggregate(_requests: AggregateRequest[]): this {
    throw new NativeNotImplementedError('withAggregate', 'Phase 3 (relations)')
  }
  _aggregate(_fn: AggregateFn, _column?: string): Promise<unknown> {
    throw new NativeNotImplementedError('_aggregate', 'Phase 3 (relations)')
  }
}
