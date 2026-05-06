// PrismaClient is imported lazily since it requires `prisma generate` to be run first.
// We use a structural type that covers the runtime API we actually depend on.
type PrismaModelDelegate = {
  findFirst(args?: Record<string, unknown>): Promise<unknown>
  findUnique(args: Record<string, unknown>): Promise<unknown>
  findMany(args?: Record<string, unknown>): Promise<unknown[]>
  count(args?: Record<string, unknown>): Promise<number>
  /** Optional on the structural type so test fixtures don't have to stub them.
   *  Real `@prisma/client` delegates always provide both. The adapter only
   *  invokes them through `withAggregate` / `_aggregate`. */
  aggregate?(args: Record<string, unknown>): Promise<unknown>
  groupBy?(args: Record<string, unknown>): Promise<unknown[]>
  create(args: Record<string, unknown>): Promise<unknown>
  createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>
  update(args: Record<string, unknown>): Promise<unknown>
  updateMany(args: { where?: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  delete(args: Record<string, unknown>): Promise<unknown>
  deleteMany(args: { where?: Record<string, unknown> }): Promise<{ count: number }>
}
type PrismaClient = {
  $connect(): Promise<void>
  $disconnect(): Promise<void>
  [table: string]: PrismaModelDelegate | ((...args: unknown[]) => unknown)
}
type PrismaClientWithEvents = PrismaClient & {
  $on(event: string, listener: (e: unknown) => void): void
}

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
} from '@rudderjs/contracts'

// ─── Prisma Query Builder ──────────────────────────────────

class PrismaQueryBuilder<T> implements QueryBuilder<T> {
  private _wheres:       WhereClause[] = []
  private _orWheres:     WhereClause[] = []
  private _orders:       OrderClause[] = []
  private _limitN:       number | null = null
  private _offsetN:      number | null = null
  private _withs:        string[] = []
  private _withTrashed   = false
  private _onlyTrashed   = false
  private _softDeletes   = false
  /** Direct (non-polymorphic, non-pivot) relation predicates — translated
   *  to Prisma `{ [relation]: { some|none: filter } }` filters in buildWhere. */
  private _relationFilters: Array<{ relation: string; polarity: 'some' | 'none'; filter: Record<string, unknown> }> = []
  /** Constrained eager-load — Prisma's nested `include: { rel: { where } }`. */
  private _withConstrained: Array<{ relation: string; filter: Record<string, unknown> }> = []
  /** Predicates with `extraEquals` (polymorphic) or `through` (pivot) — resolved
   *  via a 2-step lookup in `_resolveDeferred()` before each terminal call. */
  private _deferredPredicates: RelationExistencePredicate[] = []
  /** Aggregate eager-loads. Direct (no extraEquals, no through) count/exists
   *  go through Prisma's native `_count.select`; everything else routes through
   *  a second-batch query in `_stampAggregates`. */
  private _aggregates: AggregateRequest[] = []

  constructor(
    private prisma: PrismaClient,
    private table:  string
  ) {}

  private get delegate(): PrismaModelDelegate {
    const d = this.prisma[this.table]
    if (!d) throw new Error(
      `[RudderJS ORM] Prisma has no delegate for table "${this.table}". ` +
      `Did you run "prisma generate" after adding the model to your schema?`
    )
    return d as PrismaModelDelegate
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

  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this._orders.push({ column, direction })
    return this
  }

  limit(n: number):  this { this._limitN  = n; return this }
  offset(n: number): this { this._offsetN = n; return this }
  with(...relations: string[]): this { this._withs.push(...relations); return this }

  // No-op at the adapter level — pivot column projection is handled in the
  // ORM's deferred-QB closure (see `_belongsToManyDeferredQb` and morph
  // siblings). Apps calling `Model.query().withPivot(...)` outside a pivot
  // relation get a silent no-op, which matches Prisma's posture for unknown
  // chainables on a regular query.
  withPivot(..._columns: string[]): this { return this }

  withTrashed(): this  { this._withTrashed = true; return this }
  onlyTrashed(): this  { this._onlyTrashed = true; return this }

  /** @internal — called by Model to enable automatic soft delete filtering */
  _enableSoftDeletes(): this { this._softDeletes = true; return this }

  whereRelationExists(p: RelationExistencePredicate): this {
    if (p.extraEquals === undefined && p.through === undefined) {
      // Direct relation — assumes the relation is declared in the Prisma
      // schema with the same name. Prisma resolves the join itself.
      this._relationFilters.push({
        relation: p.relation,
        polarity: p.exists ? 'some' : 'none',
        filter:   this._wheresToPrismaFilter(p.constraintWheres),
      })
      return this
    }
    // Polymorphic or pivot — defer to a 2-step lookup at terminal time.
    this._deferredPredicates.push(p)
    return this
  }

  withConstrained(relation: string, constraintWheres: WhereClause[]): this {
    this._withConstrained.push({
      relation,
      filter: this._wheresToPrismaFilter(constraintWheres),
    })
    return this
  }

  withAggregate(requests: AggregateRequest[]): this {
    this._aggregates.push(...requests)
    return this
  }

  async _aggregate(fn: AggregateFn, column?: string): Promise<unknown> {
    await this._resolveDeferred()
    const where = this.buildWhere()
    if (fn === 'count') return this.delegate.count({ where })
    if (fn === 'exists') {
      const n = await this.delegate.count({ where })
      return n > 0
    }
    if (column === undefined) {
      throw new Error(`[RudderJS ORM Prisma] _aggregate("${fn}") requires a column.`)
    }
    const args: Record<string, unknown> = { where }
    args[`_${fn}`] = { [column]: true }
    if (!this.delegate.aggregate) {
      throw new Error(`[RudderJS ORM Prisma] delegate "${this.table}" has no aggregate() method.`)
    }
    const raw = await this.delegate.aggregate(args) as Record<string, Record<string, unknown> | undefined>
    return raw[`_${fn}`]?.[column] ?? null
  }

  /** @internal — translate a flat WhereClause[] into a single Prisma
   *  `where` filter object. Mirrors clauseToFilter(); same caveat —
   *  multiple clauses on the same column override (last-wins). */
  private _wheresToPrismaFilter(clauses: WhereClause[]): Record<string, unknown> {
    if (clauses.length === 0) return {}
    return Object.assign({}, ...clauses.map(c => this.clauseToFilter(c))) as Record<string, unknown>
  }

  /** @internal — resolve any deferred (polymorphic / pivot) predicates into
   *  flat IN/NOT IN clauses on `_wheres`. Runs once per terminal call. */
  private async _resolveDeferred(): Promise<void> {
    if (this._deferredPredicates.length === 0) return
    const pending = this._deferredPredicates
    this._deferredPredicates = []
    for (const p of pending) {
      const ids = await this._resolveDeferredIds(p)
      this._wheres.push({
        column:   p.parentColumn,
        operator: p.exists ? 'IN' : 'NOT IN',
        value:    ids,
      })
    }
  }

  /** @internal — for deferred predicates, return the list of parent-column
   *  values that satisfy the relation predicate (polymorphic or pivot path). */
  private async _resolveDeferredIds(p: RelationExistencePredicate): Promise<unknown[]> {
    const through = p.through
    if (through) {
      // Pivot mediated — step A: find related rows matching the constraint,
      // step B: find pivot rows pointing at those related ids (plus the
      // pivot-side discriminator from extraEquals), project foreignPivotKey.
      const relatedFilter = this._wheresToPrismaFilter(p.constraintWheres)
      const relatedDelegate = this.delegateFor(p.relatedTable)
      const relatedRows = await relatedDelegate.findMany({ where: relatedFilter }) as Array<Record<string, unknown>>
      const relatedIds  = relatedRows.map(r => r[p.relatedColumn])
      // Empty matching set — short-circuit so we don't issue a wasted pivot query.
      if (relatedIds.length === 0) return []

      const pivotFilter: Record<string, unknown> = {
        [through.relatedPivotKey]: { in: relatedIds },
        ...(p.extraEquals ?? {}),
      }
      const pivotDelegate = this.delegateFor(through.pivotTable)
      const pivotRows = await pivotDelegate.findMany({ where: pivotFilter }) as Array<Record<string, unknown>>
      return pivotRows.map(r => r[through.foreignPivotKey])
    }
    // Direct polymorphic relation — constraint AND extraEquals on related.
    const filter: Record<string, unknown> = {
      ...this._wheresToPrismaFilter(p.constraintWheres),
      ...(p.extraEquals ?? {}),
    }
    const delegate = this.delegateFor(p.relatedTable)
    const rows = await delegate.findMany({ where: filter }) as Array<Record<string, unknown>>
    return rows.map(r => r[p.relatedColumn])
  }

  /** @internal — resolve a Prisma delegate by table name (camelCase Prisma
   *  model name). Same shape as `delegate` but parameterised by table. */
  private delegateFor(table: string): PrismaModelDelegate {
    const d = this.prisma[table]
    if (!d) throw new Error(
      `[RudderJS ORM] Prisma has no delegate for table "${table}". ` +
      `Did you run "prisma generate" after adding the model to your schema?`,
    )
    return d as PrismaModelDelegate
  }

  private clauseToFilter(clause: WhereClause): Record<string, unknown> {
    switch (clause.operator) {
      case '=':      return { [clause.column]: clause.value }
      case '!=':     return { [clause.column]: { not: clause.value } }
      case '>':      return { [clause.column]: { gt: clause.value } }
      case '>=':     return { [clause.column]: { gte: clause.value } }
      case '<':      return { [clause.column]: { lt: clause.value } }
      case '<=':     return { [clause.column]: { lte: clause.value } }
      case 'LIKE': {
        const raw = String(clause.value)
        const hasLeading  = raw.startsWith('%')
        const hasTrailing = raw.endsWith('%')
        const inner = raw.replace(/^%|%$/g, '')
        if (hasLeading && hasTrailing) {
          return { [clause.column]: { contains: inner } }
        } else if (hasTrailing) {
          return { [clause.column]: { startsWith: inner } }
        } else if (hasLeading) {
          return { [clause.column]: { endsWith: inner } }
        }
        return { [clause.column]: { equals: raw } }
      }
      case 'IN':     return { [clause.column]: { in: clause.value } }
      case 'NOT IN': return { [clause.column]: { notIn: clause.value } }
      default:       return { [clause.column]: clause.value }
    }
  }

  private buildWhere(): Record<string, unknown> {
    const andFilters = this._wheres.map(c => this.clauseToFilter(c))
    const orFilters  = this._orWheres.map(c => this.clauseToFilter(c))

    // Direct relation predicates → { [relation]: { some|none: filter } }
    for (const r of this._relationFilters) {
      andFilters.push({ [r.relation]: { [r.polarity]: r.filter } })
    }

    // Soft delete filtering
    if (this._softDeletes && !this._withTrashed) {
      if (this._onlyTrashed) {
        andFilters.push({ deletedAt: { not: null } })
      } else {
        andFilters.push({ deletedAt: null })
      }
    }

    if (andFilters.length === 0 && orFilters.length === 0) return {}

    const where: Record<string, unknown> = {}
    if (andFilters.length > 0) Object.assign(where, ...andFilters)
    if (orFilters.length > 0)  where['OR'] = orFilters

    return where
  }

  /** @internal — direct count/exists requests go through Prisma's native
   *  `_count.select` selector (saves a round-trip). Polymorphic / pivot /
   *  numeric aggregates fall through to `_stampAggregates`. */
  private _directCountReqs(): AggregateRequest[] {
    return this._aggregates.filter(r =>
      (r.fn === 'count' || r.fn === 'exists') &&
      !r.joinShape.extraEquals &&
      !r.joinShape.through,
    )
  }

  private buildInclude(): Record<string, unknown> | undefined {
    const directCounts = this._directCountReqs()
    if (
      this._withs.length === 0 &&
      this._withConstrained.length === 0 &&
      directCounts.length === 0
    ) return undefined

    const include: Record<string, unknown> = {}
    for (const r of this._withs) include[r] = true
    // Constrained eager-loads override unconstrained for the same relation —
    // `withWhereHas` is the canonical source when both are present.
    for (const c of this._withConstrained) include[c.relation] = { where: c.filter }

    if (directCounts.length > 0) {
      const countSelect: Record<string, unknown> = {}
      for (const r of directCounts) {
        // Multiple withCount/withExists on the same relation collide on the
        // Prisma `_count.select.{relation}` key. The orm normalization layer
        // requires distinct .as() aliases, but two requests for the *same*
        // relation produce the same Prisma selector either way — last-wins on
        // the filter. Document and rely on user discipline (the orm Symbol-
        // tagged alias copy preserves both result keys).
        const filter = r.constraintWheres.length > 0
          ? this._wheresToPrismaFilter(r.constraintWheres)
          : undefined
        countSelect[r.relation] = filter ? { where: filter } : true
      }
      include['_count'] = { select: countSelect }
    }

    return include
  }

  /** @internal — translate the `_count` field on each result row into the
   *  caller-facing aliases, then run a second-batch query for any aggregate
   *  that didn't fit the `_count.select` shape (polymorphic, pivot,
   *  numeric). Mutates rows in place. */
  private async _stampAggregates(rows: Array<Record<string, unknown>>): Promise<void> {
    if (this._aggregates.length === 0) return

    // Step 1: copy `_count.{relation}` → row[alias] for direct count/exists.
    const directCounts = this._directCountReqs()
    if (directCounts.length > 0) {
      for (const row of rows) {
        const counts = row['_count'] as Record<string, number> | undefined
        for (const r of directCounts) {
          const n = counts?.[r.relation] ?? 0
          row[r.alias] = r.fn === 'exists' ? n > 0 : n
        }
      }
      // Strip `_count` so callers don't see the Prisma artifact.
      for (const row of rows) {
        if ('_count' in row) delete row['_count']
      }
    }

    // Step 2: every other aggregate → second-batch query, JS-stamp.
    const directSet = new Set(directCounts)
    const batchReqs = this._aggregates.filter(r => !directSet.has(r))
    for (const r of batchReqs) await this._runBatchAggregate(r, rows)
  }

  /** @internal — second-batch path for one aggregate request. Called once
   *  per polymorphic / pivot / numeric aggregate; no fan-out across rows. */
  private async _runBatchAggregate(
    req:        AggregateRequest,
    parentRows: Array<Record<string, unknown>>,
  ): Promise<void> {
    const js        = req.joinShape
    const parentIds = parentRows.map(r => r[js.parentColumn])
    if (parentIds.length === 0) {
      // No parents — leave rows untouched. (Stamping defaults isn't needed
      // since there's nothing to iterate.)
      return
    }

    const constraintFilter = this._wheresToPrismaFilter(req.constraintWheres)
    const softFilter: Record<string, unknown> = js.softDeletes ? { deletedAt: null } : {}

    if (!js.through) {
      // Single-step: groupBy on the related table, joining
      // relatedColumn ↔ parentColumn (or polymorphic discriminator filter).
      const relatedDelegate = this.delegateFor(js.relatedTable)
      const where: Record<string, unknown> = {
        [js.relatedColumn]: { in: parentIds },
        ...constraintFilter,
        ...(js.extraEquals ?? {}),
        ...softFilter,
      }
      const groupArgs: Record<string, unknown> = { by: [js.relatedColumn], where }
      if (req.fn === 'count' || req.fn === 'exists') {
        groupArgs['_count'] = { _all: true }
      } else {
        groupArgs[`_${req.fn}`] = { [req.column!]: true }
      }
      if (!relatedDelegate.groupBy) {
        throw new Error(`[RudderJS ORM Prisma] delegate "${js.relatedTable}" has no groupBy() method.`)
      }
      const groups = await relatedDelegate.groupBy(groupArgs) as Array<Record<string, unknown>>

      const lookup = new Map<unknown, unknown>()
      for (const g of groups) {
        const parentVal = g[js.relatedColumn]
        let value: unknown
        if (req.fn === 'count') {
          value = (g['_count'] as Record<string, unknown> | undefined)?.['_all'] ?? 0
        } else if (req.fn === 'exists') {
          const n = ((g['_count'] as Record<string, unknown> | undefined)?.['_all'] as number) ?? 0
          value = n > 0
        } else {
          value = (g[`_${req.fn}`] as Record<string, unknown> | undefined)?.[req.column!] ?? null
        }
        lookup.set(parentVal, value)
      }

      for (const row of parentRows) {
        const v = lookup.get(row[js.parentColumn])
        row[req.alias] = v ?? _aggregateDefault(req.fn)
      }
      return
    }

    // Pivot path: 2-step JS aggregation. Polymorphic-pivot (`extraEquals` on
    // the pivot table) handled here too.
    const through = js.through
    const pivotDelegate = this.delegateFor(through.pivotTable)
    const pivotWhere: Record<string, unknown> = {
      [through.foreignPivotKey]: { in: parentIds },
      ...(js.extraEquals ?? {}),
    }
    const pivotRows = await pivotDelegate.findMany({ where: pivotWhere }) as Array<Record<string, unknown>>

    if (req.fn === 'count' || req.fn === 'exists') {
      // Apply the constraint by filtering related rows first (when present),
      // then count surviving pivot rows per parent.
      let acceptable: Set<unknown> | null = null
      if (req.constraintWheres.length > 0 || js.softDeletes) {
        const relatedDelegate = this.delegateFor(js.relatedTable)
        const pivotRelatedIds = pivotRows.map(p => p[through.relatedPivotKey])
        const relatedWhere: Record<string, unknown> = {
          [js.relatedColumn]: { in: pivotRelatedIds },
          ...constraintFilter,
          ...softFilter,
        }
        const relatedRows = await relatedDelegate.findMany({ where: relatedWhere }) as Array<Record<string, unknown>>
        acceptable = new Set(relatedRows.map(r => r[js.relatedColumn]))
      }
      const counts = new Map<unknown, number>()
      for (const p of pivotRows) {
        const fk = p[through.foreignPivotKey]
        const rk = p[through.relatedPivotKey]
        if (acceptable && !acceptable.has(rk)) continue
        counts.set(fk, (counts.get(fk) ?? 0) + 1)
      }
      for (const row of parentRows) {
        const n = counts.get(row[js.parentColumn]) ?? 0
        row[req.alias] = req.fn === 'exists' ? n > 0 : n
      }
      return
    }

    // Pivot sum/min/max/avg: fetch related rows and JS-aggregate per parent.
    const relatedDelegate = this.delegateFor(js.relatedTable)
    const pivotRelatedIds = pivotRows.map(p => p[through.relatedPivotKey])
    const relatedWhere: Record<string, unknown> = {
      [js.relatedColumn]: { in: pivotRelatedIds },
      ...constraintFilter,
      ...softFilter,
    }
    const relatedRows = await relatedDelegate.findMany({ where: relatedWhere }) as Array<Record<string, unknown>>
    const relatedById = new Map<unknown, Record<string, unknown>>()
    for (const r of relatedRows) relatedById.set(r[js.relatedColumn], r)

    const groups = new Map<unknown, number[]>()
    for (const p of pivotRows) {
      const fk = p[through.foreignPivotKey]
      const r  = relatedById.get(p[through.relatedPivotKey])
      if (!r) continue
      const v = Number(r[req.column!])
      if (Number.isNaN(v)) continue
      const list = groups.get(fk)
      if (list) list.push(v); else groups.set(fk, [v])
    }
    for (const row of parentRows) {
      const list = groups.get(row[js.parentColumn])
      if (!list || list.length === 0) {
        row[req.alias] = _aggregateDefault(req.fn)
        continue
      }
      switch (req.fn) {
        case 'sum': row[req.alias] = list.reduce((a, b) => a + b, 0); break
        case 'min': row[req.alias] = Math.min(...list); break
        case 'max': row[req.alias] = Math.max(...list); break
        case 'avg': row[req.alias] = list.reduce((a, b) => a + b, 0) / list.length; break
      }
    }
  }

  private buildOrderBy(): Record<string, string>[] {
    return this._orders.map(o => ({ [o.column]: o.direction.toLowerCase() }))
  }

  async first(): Promise<T | null> {
    await this._resolveDeferred()
    const row = await this.delegate.findFirst({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
    }) as Record<string, unknown> | null
    if (!row) return null
    await this._stampAggregates([row])
    return row as T
  }

  async find(id: number | string): Promise<T | null> {
    await this._resolveDeferred()
    const row = await this.delegate.findUnique({ where: { id }, include: this.buildInclude() }) as Record<string, unknown> | null
    if (!row) return null
    await this._stampAggregates([row])
    return row as T
  }

  async get(): Promise<T[]> {
    await this._resolveDeferred()
    const rows = await this.delegate.findMany({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
      take:    this._limitN  ?? undefined,
      skip:    this._offsetN ?? undefined,
    }) as Array<Record<string, unknown>>
    await this._stampAggregates(rows)
    return rows as unknown as T[]
  }

  async all(): Promise<T[]> {
    await this._resolveDeferred()
    const rows = await this.delegate.findMany({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
      take:    this._limitN  ?? undefined,
      skip:    this._offsetN ?? undefined,
    }) as Array<Record<string, unknown>>
    await this._stampAggregates(rows)
    return rows as unknown as T[]
  }

  async count(): Promise<number> {
    await this._resolveDeferred()
    return this.delegate.count({ where: this.buildWhere() })
  }

  async create(data: Partial<T>): Promise<T> {
    return this.delegate.create({ data }) as Promise<T>
  }

  async update(id: number | string, data: Partial<T>): Promise<T> {
    return this.delegate.update({ where: { id }, data }) as Promise<T>
  }

  async delete(id: number | string): Promise<void> {
    if (this._softDeletes) {
      await this.delegate.update({ where: { id }, data: { deletedAt: new Date() } })
    } else {
      await this.delegate.delete({ where: { id } })
    }
  }

  async restore(id: number | string): Promise<T> {
    return this.delegate.update({ where: { id }, data: { deletedAt: null } }) as Promise<T>
  }

  async forceDelete(id: number | string): Promise<void> {
    await this.delegate.delete({ where: { id } })
  }

  async insertMany(rows: Partial<T>[]): Promise<void> {
    if (rows.length === 0) return
    await this.delegate.createMany({ data: rows as Record<string, unknown>[] })
  }

  async deleteAll(): Promise<number> {
    await this._resolveDeferred()
    const result = await this.delegate.deleteMany({ where: this.buildWhere() })
    return result.count
  }

  async updateAll(data: Partial<T>): Promise<number> {
    await this._resolveDeferred()
    const result = await this.delegate.updateMany({
      where: this.buildWhere(),
      data:  data as Record<string, unknown>,
    })
    return result.count
  }

  async increment(id: number | string, column: string, amount = 1, extra: Record<string, unknown> = {}): Promise<T> {
    return this.delegate.update({
      where: { id },
      data:  { [column]: { increment: amount }, ...extra },
    }) as Promise<T>
  }

  async decrement(id: number | string, column: string, amount = 1, extra: Record<string, unknown> = {}): Promise<T> {
    return this.delegate.update({
      where: { id },
      data:  { [column]: { decrement: amount }, ...extra },
    }) as Promise<T>
  }

  async paginate(page = 1, perPage = 15): Promise<PaginatedResult<T>> {
    await this._resolveDeferred()
    const [rows, total] = await Promise.all([
      this.delegate.findMany({
        where:   this.buildWhere(),
        include: this.buildInclude(),
        orderBy: this.buildOrderBy(),
        take:    perPage,
        skip:    (page - 1) * perPage,
      }) as Promise<Array<Record<string, unknown>>>,
      this.delegate.count({ where: this.buildWhere() }),
    ])

    await this._stampAggregates(rows)

    const lastPage = Math.ceil(total / perPage)
    return {
      data: rows as unknown as T[],
      total,
      perPage,
      currentPage: page,
      lastPage,
      from: (page - 1) * perPage + 1,
      to:   Math.min(page * perPage, total),
    }
  }
}

/** @internal — default value to stamp when an aggregate has no matching rows. */
function _aggregateDefault(fn: AggregateFn): unknown {
  switch (fn) {
    case 'count':  return 0
    case 'exists': return false
    case 'sum':    return 0
    case 'min':    return null
    case 'max':    return null
    case 'avg':    return null
  }
}

// ─── Prisma Adapter ────────────────────────────────────────

class PrismaAdapter implements OrmAdapter {
  private _driver: string

  private constructor(readonly prismaClient: PrismaClient, driver?: string) {
    this._driver = driver ?? 'sqlite'
  }
  /** @internal — expose the raw PrismaClient for DI binding */
  get prisma(): PrismaClient { return this.prismaClient }

  static async make(config: PrismaConfig = {}): Promise<PrismaAdapter> {
    if (config.client) return new PrismaAdapter(config.client)

    const opts: Record<string, unknown> = {}

    if (config.driver === 'postgresql' && config.url) {
      const { Pool } = await import('pg') as typeof import('pg')
      const { PrismaPg } = await import('@prisma/adapter-pg') as typeof import('@prisma/adapter-pg')
      opts['adapter'] = new PrismaPg(new Pool({ connectionString: config.url }))
    } else if (config.driver === 'libsql' && config.url) {
      // Remote libSQL / Turso
      const { PrismaLibSql } = await import('@prisma/adapter-libsql') as typeof import('@prisma/adapter-libsql')
      opts['adapter'] = new PrismaLibSql({ url: config.url })
    } else {
      // Local SQLite via better-sqlite3 (driver: 'sqlite' or default)
      const dbUrl = config.url ?? process.env['DATABASE_URL'] ?? 'file:./dev.db'
      const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3') as typeof import('@prisma/adapter-better-sqlite3')
      opts['adapter'] = new PrismaBetterSqlite3({ url: dbUrl })
    }

    let PC: PrismaClientConstructor
    if (config.PrismaClient) {
      PC = config.PrismaClient
    } else {
      // Apps using the new `prisma-client` generator (Prisma 7+) emit a
      // self-contained client at a custom output path and don't install
      // @prisma/client at all. Those apps must pass `PrismaClient` via config.
      // The fallback below is only for the legacy `prisma-client-js` generator.
      let mod: unknown
      try {
        mod = await import('@prisma/client')
      } catch (err) {
        throw new Error(
          `[RudderJS ORM] Could not load @prisma/client. ` +
          `If you're using Prisma's new "prisma-client" generator, pass ` +
          `\`PrismaClient\` via the database config:\n\n` +
          `  import { PrismaClient } from './prisma/generated/prisma/client.js'\n` +
          `  export default { PrismaClient, default: '...', connections: { ... } }\n\n` +
          `Otherwise install @prisma/client (legacy "prisma-client-js" generator).`,
          { cause: err }
        )
      }
      const m = mod as { PrismaClient?: PrismaClientConstructor; default?: PrismaClientConstructor | { PrismaClient?: PrismaClientConstructor } }
      const rawDefault = m.default
      PC = (m.PrismaClient
        ?? (rawDefault && typeof rawDefault === 'object' && 'PrismaClient' in rawDefault ? rawDefault.PrismaClient : rawDefault)
      ) as PrismaClientConstructor
    }
    // Enable query event logging so telescope's QueryCollector can capture queries
    opts['log'] = [{ emit: 'event', level: 'query' }]
    return new PrismaAdapter(new PC(opts), config.driver)
  }

  query<T>(table: string): QueryBuilder<T> {
    return new PrismaQueryBuilder<T>(this.prisma, table)
  }

  async connect(): Promise<void> {
    await this.prisma.$connect()
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect()
  }

  /**
   * Register a query listener. Used by telescope's QueryCollector.
   * Hooks into Prisma's `$on('query', ...)` event if available.
   */
  onQuery(listener: (info: { sql: string; bindings: unknown[]; duration: number; connection?: string | undefined; model?: string | undefined }) => void): void {
    const client = this.prisma as Partial<PrismaClientWithEvents>
    if (!client.$on) return
    const driver = this._driver
    client.$on('query', (event: unknown) => {
      const e = event as { query?: string; params?: string; duration?: number }
      let bindings: unknown[] = []
      if (e.params) {
        try { bindings = JSON.parse(e.params) as unknown[] } catch { /* ignore */ }
      }
      // Try to extract model name from SQL (e.g. `main`.`User` → User)
      const sql = e.query ?? ''
      const modelMatch = sql.match(/`main`\.`(\w+)`/) ?? sql.match(/FROM\s+"?(\w+)"?/i)
      listener({
        sql,
        bindings,
        duration: e.duration ?? 0,
        connection: driver,
        model: modelMatch?.[1],
      })
    })
  }
}

// ─── Config & Factory ──────────────────────────────────────

type PrismaClientConstructor = new (opts: Record<string, unknown>) => PrismaClient

export interface PrismaConfig {
  client?: PrismaClient
  /** Pass the PrismaClient class from your app's @prisma/client to avoid
   *  cross-repo resolution issues with pnpm-linked packages. */
  PrismaClient?: PrismaClientConstructor
  driver?: 'postgresql' | 'sqlite' | 'libsql' | 'mysql'
  url?: string
}

export interface DatabaseConnectionConfig {
  driver: 'postgresql' | 'sqlite' | 'libsql' | 'mysql'
  url?: string
}

export interface DatabaseConfig {
  default: string
  connections: Record<string, DatabaseConnectionConfig>
  /** Pass the PrismaClient class from your app's @prisma/client to avoid
   *  cross-repo resolution issues with pnpm-linked packages. */
  PrismaClient?: PrismaClientConstructor
}

export function prisma(config: PrismaConfig = {}): OrmAdapterProvider {
  return {
    async create(): Promise<OrmAdapter> {
      return PrismaAdapter.make(config)
    },
  }
}

// ─── PrismaProvider ────────────────────────────────────────

import { ServiceProvider, config } from '@rudderjs/core'
import { ModelRegistry } from '@rudderjs/orm'

export class DatabaseProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<DatabaseConfig | undefined>('database', undefined)

    let prismaConfig: PrismaConfig = {}

    if (cfg) {
      const conn = cfg.connections[cfg.default]
      if (conn) prismaConfig = { driver: conn.driver, ...(conn.url !== undefined && { url: conn.url }) }
      if (cfg.PrismaClient) prismaConfig.PrismaClient = cfg.PrismaClient
    }

    const adapter = await PrismaAdapter.make(prismaConfig)
    await adapter.connect()

    ModelRegistry.set(adapter)
    this.app.instance('db', adapter)
    this.app.instance('prisma', adapter.prisma)
  }
}