// ─── NativeQueryBuilder ────────────────────────────────────
//
// Implements the `QueryBuilder<T>` contract over a {@link Driver} + {@link
// Dialect}. PHASE 1: the read path (first/find/get/all/count/paginate) is
// live; every write, relation, aggregate, and vector terminal throws
// {@link NativeNotImplementedError} until its phase lands.
//
// It talks ONLY to the compiler (pure) + the Driver interface — never a
// concrete driver, never `node:`. Construction is cheap; one builder per query.

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
import type { Driver, Row } from './driver.js'
import {
  compileSelect,
  compileCount,
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
    private readonly driver:     Driver,
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
    const sub = new NativeQueryBuilder<T>(this.driver, this.dialect, this.table, this.primaryKey)
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
    const rows = await this.driver.execute(sql, bindings)
    return (rows[0] as T | undefined) ?? null
  }

  async find(id: number | string): Promise<T | null> {
    this._assertNotSubBuilder()
    const extra: ConditionNode[] = [
      { kind: 'clause', boolean: 'AND', clause: { column: this.primaryKey, operator: '=', value: id } },
    ]
    const { sql, bindings } = compileSelect(this._state(), this.dialect, { limit: 1, extraConditions: extra })
    const rows = await this.driver.execute(sql, bindings)
    return (rows[0] as T | undefined) ?? null
  }

  async get(): Promise<T[]> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileSelect(this._state(), this.dialect)
    const rows = await this.driver.execute(sql, bindings)
    return rows as T[]
  }

  async all(): Promise<T[]> {
    return this.get()
  }

  async count(): Promise<number> {
    this._assertNotSubBuilder()
    const { sql, bindings } = compileCount(this._state(), this.dialect)
    const rows = await this.driver.execute(sql, bindings)
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
    const rows = await this.driver.execute(sql, bindings)

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

  create(_data: Partial<T>): Promise<T> {
    throw new NativeNotImplementedError('create', 'Phase 2 (write path)')
  }
  update(_id: number | string, _data: Partial<T>): Promise<T> {
    throw new NativeNotImplementedError('update', 'Phase 2 (write path)')
  }
  delete(_id: number | string): Promise<void> {
    throw new NativeNotImplementedError('delete', 'Phase 2 (write path)')
  }
  insertMany(_rows: Partial<T>[]): Promise<void> {
    throw new NativeNotImplementedError('insertMany', 'Phase 2 (write path)')
  }
  deleteAll(): Promise<number> {
    throw new NativeNotImplementedError('deleteAll', 'Phase 2 (write path)')
  }
  updateAll(_data: Partial<T>): Promise<number> {
    throw new NativeNotImplementedError('updateAll', 'Phase 2 (write path)')
  }
  restore(_id: number | string): Promise<T> {
    throw new NativeNotImplementedError('restore', 'Phase 2 (write path)')
  }
  forceDelete(_id: number | string): Promise<void> {
    throw new NativeNotImplementedError('forceDelete', 'Phase 2 (write path)')
  }
  increment(_id: number | string, _column: string, _amount?: number, _extra?: Record<string, unknown>): Promise<T> {
    throw new NativeNotImplementedError('increment', 'Phase 2 (write path)')
  }
  decrement(_id: number | string, _column: string, _amount?: number, _extra?: Record<string, unknown>): Promise<T> {
    throw new NativeNotImplementedError('decrement', 'Phase 2 (write path)')
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
