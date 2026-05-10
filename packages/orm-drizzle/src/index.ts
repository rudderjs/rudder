import {
  eq, ne, gt, gte, lt, lte, like, notLike, inArray, notInArray,
  isNull, isNotNull,
  and, or, asc, desc, count as sqlCount, sql,
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
} from '@rudderjs/contracts'
import { resolveOptionalPeer } from '@rudderjs/support'

// ─── Minimal Drizzle DB interface ──────────────────────────

// Drizzle DB instances share a common fluent query API regardless of driver.
// We capture only the subset this adapter uses so we don't import driver-specific types.
type DrizzleQB = {
  where(cond: SQL): DrizzleQB
  orderBy(...cols: SQL[]): DrizzleQB
  limit(n: number): DrizzleQB
  offset(n: number): DrizzleQB
  returning(): DrizzleQB
  set(data: unknown): DrizzleQB
  values(data: unknown): DrizzleQB
  then<TResult>(onfulfilled: (value: unknown) => TResult): Promise<TResult>
}

type DrizzleDb = {
  select(fields?: Record<string, unknown>): { from(table: unknown): DrizzleQB }
  insert(table: unknown): { values(data: unknown): DrizzleQB }
  update(table: unknown): { set(data: unknown): DrizzleQB }
  delete(table: unknown): DrizzleQB
  /** Optional — present on Postgres / libsql Drizzle drivers. Vector
   *  queries route through `execute(sql)` because pgvector ops can't
   *  be expressed via the fluent select API. */
  execute?(query: SQL): Promise<unknown>
  $client?: { end?: () => Promise<void> }
}

// ─── Global Table Registry ─────────────────────────────────

export class DrizzleTableRegistry {
  private static tables: Map<string, unknown> = new Map()

  static register(name: string, table: unknown): void {
    this.tables.set(name, table)
  }

  static get(name: string): unknown | undefined {
    return this.tables.get(name)
  }
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
  private _orders:      OrderClause[] = []
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
  ) {}

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
    const sub = new DrizzleQueryBuilder<T>(this.db, this.table, this.primaryKey, this.resolveTable)
      ._markSubBuilder()
    fn(sub)
    const expr = sub.buildConditions()
    if (expr) this._extraExprs.push(expr)
    return this
  }

  orWhereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    const sub = new DrizzleQueryBuilder<T>(this.db, this.table, this.primaryKey, this.resolveTable)
      ._markSubBuilder()
    fn(sub)
    const expr = sub.buildConditions()
    if (expr) this._orExtraExprs.push(expr)
    return this
  }

  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this._orders.push({ column, direction })
    return this
  }

  limit(n: number):  this { this._limitN  = n; return this }
  offset(n: number): this { this._offsetN = n; return this }

  // Drizzle relational queries require pre-defined relation schemas. We don't
  // yet thread a relations object into the adapter, so eager-loading via .with()
  // is not implemented. Calls are silently dropped to keep the QueryBuilder
  // contract compatible across adapters; use Drizzle's relational query API
  // directly when you need eager loading.
  with(..._relations: string[]): this { return this }

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
    switch (clause.operator) {
      case '=':      return eq(col, clause.value) as SQL
      case '!=':     return ne(col, clause.value) as SQL
      case '>':      return gt(col, clause.value) as SQL
      case '>=':     return gte(col, clause.value) as SQL
      case '<':      return lt(col, clause.value) as SQL
      case '<=':     return lte(col, clause.value) as SQL
      case 'LIKE':     return like(col, clause.value as string) as SQL
      case 'NOT LIKE': return notLike(col, clause.value as string) as SQL
      case 'IN':       return inArray(col, clause.value as unknown[]) as SQL
      case 'NOT IN': return notInArray(col, clause.value as unknown[]) as SQL
      default: {
        const _exhaustive: never = clause.operator
        throw new Error(`[RudderJS ORM Drizzle] Unsupported operator: ${String(_exhaustive)}`)
      }
    }
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

    const result = await (q as unknown as Promise<Array<{ value: unknown }>>)
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

  /** @internal — returns the SELECT-list fields object when aggregates are
   *  present, or `null` to signal "default *-select." Mixing the two forms
   *  is what lets `db.select(<fields>)` inject named aggregate columns
   *  alongside the original table columns. */
  private buildAggregateSelectFields(): Record<string, unknown> | null {
    if (this._aggregates.length === 0) return null
    const cols = getTableColumns(this.table as Parameters<typeof getTableColumns>[0]) as Record<string, unknown>
    const fields: Record<string, unknown> = { ...cols }
    for (const req of this._aggregates) {
      fields[req.alias] = this._aggregateSubquery(req)
    }
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

  private buildOrderBy(): SQL[] {
    return this._orders.map(o => {
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
    const cond    = this.buildConditions()
    const orderBy = this.buildOrderBy()
    const fields  = this.buildAggregateSelectFields()

    let q = fields ? this.db.select(fields).from(this.table) : this.db.select().from(this.table)
    if (cond)           q = q.where(cond)
    if (orderBy.length) q = q.orderBy(...orderBy)
    q = q.limit(1)

    const result = await (q as unknown as Promise<T[]>)
    return result[0] ?? null
  }

  async find(id: number | string): Promise<T | null> {
    this._assertNotSubBuilder()
    const pkCol    = this.col(this.primaryKey) as Column
    const softExpr = this.softDeleteExpr()
    const pkExpr   = eq(pkCol, id) as SQL
    const cond     = softExpr ? and(pkExpr, softExpr) as SQL : pkExpr
    const fields   = this.buildAggregateSelectFields()

    const sel = fields ? this.db.select(fields).from(this.table) : this.db.select().from(this.table)
    const result = await (sel
      .where(cond)
      .limit(1) as unknown as Promise<T[]>)
    return result[0] ?? null
  }

  async get(): Promise<T[]> {
    this._assertNotSubBuilder()
    if (this._vectorClause !== null) return this._getViaVector() as Promise<T[]>
    const cond    = this.buildConditions()
    const orderBy = this.buildOrderBy()
    const fields  = this.buildAggregateSelectFields()

    let q = fields ? this.db.select(fields).from(this.table) : this.db.select().from(this.table)
    if (cond)           q = q.where(cond)
    if (orderBy.length) q = q.orderBy(...orderBy)
    if (this._limitN  !== null) q = q.limit(this._limitN)
    if (this._offsetN !== null) q = q.offset(this._offsetN)

    return q as unknown as Promise<T[]>
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
    const cond = this.buildConditions()

    let q = this.db.select({ value: sqlCount() }).from(this.table)
    if (cond) q = q.where(cond)

    const result: Array<{ value: number | string | bigint }> = await (q as unknown as Promise<Array<{ value: number | string | bigint }>>)
    return Number(result[0]?.value ?? 0)
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
    const result = await (this.db
      .insert(this.table)
      .values(data)
      .returning() as unknown as Promise<T[]>)
    if (!result[0]) throw new Error('[RudderJS ORM Drizzle] create() returned no rows.')
    return result[0]
  }

  async update(id: number | string, data: Partial<T>): Promise<T> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    const result = await (this.db
      .update(this.table)
      .set(data)
      .where(eq(pkCol, id))
      .returning() as unknown as Promise<T[]>)
    if (!result[0]) throw new Error('[RudderJS ORM Drizzle] update() returned no rows.')
    return result[0]
  }

  async delete(id: number | string): Promise<void> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    if (this._softDeletes) {
      await (this.db.update(this.table).set({ deletedAt: new Date() }).where(eq(pkCol, id)) as unknown as Promise<void>)
      return
    }
    await (this.db
      .delete(this.table)
      .where(eq(pkCol, id)) as unknown as Promise<void>)
  }

  async restore(id: number | string): Promise<T> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    const result = await (this.db
      .update(this.table)
      .set({ deletedAt: null })
      .where(eq(pkCol, id))
      .returning() as unknown as Promise<T[]>)
    return result[0] as T
  }

  async forceDelete(id: number | string): Promise<void> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    await (this.db
      .delete(this.table)
      .where(eq(pkCol, id)) as unknown as Promise<void>)
  }

  async insertMany(rows: Partial<T>[]): Promise<void> {
    this._assertNotSubBuilder()
    if (rows.length === 0) return
    await (this.db.insert(this.table).values(rows) as unknown as Promise<void>)
  }

  async deleteAll(): Promise<number> {
    this._assertNotSubBuilder()
    const cond = this.buildConditions()
    let q = this.db.delete(this.table)
    if (cond) q = q.where(cond)
    // .returning() lets us count rows deleted across SQLite/Postgres without
    // a driver-specific RowsAffected hop. MySQL drivers ignore .returning()
    // and the count comes back zero — adapter consumers needing precise MySQL
    // counts should switch to a Postgres or SQLite Drizzle driver until we
    // surface driver capability flags.
    const result = await ((q as unknown as { returning?: () => DrizzleQB }).returning?.() ?? q) as unknown as Array<unknown>
    return Array.isArray(result) ? result.length : 0
  }

  async updateAll(data: Partial<T>): Promise<number> {
    const cond = this.buildConditions()
    let q = this.db.update(this.table).set(data)
    if (cond) q = q.where(cond)
    // Same .returning() rationale as deleteAll — count via returning where the
    // driver supports it (Postgres/SQLite). MySQL returns zero.
    const result = await ((q as unknown as { returning?: () => DrizzleQB }).returning?.() ?? q) as unknown as Array<unknown>
    return Array.isArray(result) ? result.length : 0
  }

  async increment(id: number | string, column: string, amount = 1, extra: Record<string, unknown> = {}): Promise<T> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    const col   = this.col(column) as Column
    const result = await (this.db
      .update(this.table)
      .set({ [column]: sql`${col} + ${amount}`, ...extra })
      .where(eq(pkCol, id))
      .returning() as unknown as Promise<T[]>)
    if (!result[0]) throw new Error('[RudderJS ORM Drizzle] increment() returned no rows.')
    return result[0]
  }

  async decrement(id: number | string, column: string, amount = 1, extra: Record<string, unknown> = {}): Promise<T> {
    this._assertNotSubBuilder()
    const pkCol = this.col(this.primaryKey) as Column
    const col   = this.col(column) as Column
    const result = await (this.db
      .update(this.table)
      .set({ [column]: sql`${col} - ${amount}`, ...extra })
      .where(eq(pkCol, id))
      .returning() as unknown as Promise<T[]>)
    if (!result[0]) throw new Error('[RudderJS ORM Drizzle] decrement() returned no rows.')
    return result[0]
  }

  async paginate(page = 1, perPage = 15): Promise<PaginatedResult<T>> {
    this._assertNotSubBuilder()
    const cond    = this.buildConditions()
    const orderBy = this.buildOrderBy()
    const fields  = this.buildAggregateSelectFields()

    let pageQ = fields ? this.db.select(fields).from(this.table) : this.db.select().from(this.table)
    let cntQ  = this.db.select({ value: sqlCount() }).from(this.table)

    if (cond) {
      pageQ = pageQ.where(cond)
      cntQ  = cntQ.where(cond)
    }
    if (orderBy.length) pageQ = pageQ.orderBy(...orderBy)
    pageQ = pageQ.limit(perPage).offset((page - 1) * perPage)

    const [data, countResult] = await Promise.all([
      pageQ as unknown as Promise<T[]>,
      cntQ  as unknown as Promise<Array<{ value: number | string | bigint }>>,
    ])

    const total    = Number(countResult[0]?.value ?? 0)
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

// ─── Drizzle Adapter ───────────────────────────────────────

export class DrizzleAdapter implements OrmAdapter {
  private constructor(
    readonly db:                 DrizzleDb,
    private readonly tables:     Record<string, unknown>,
    private readonly primaryKey: string,
  ) {}

  static async make(config: DrizzleConfig): Promise<DrizzleAdapter> {
    let db = config.client as DrizzleDb | undefined

    if (!db) {
      const url    = config.url ?? process.env['DATABASE_URL'] ?? 'file:./dev.db'
      const driver = config.driver ?? 'sqlite'

      if (driver === 'postgresql') {
        // postgres uses `export =` so dynamic import wraps it in a `.default`
        const postgresModule          = await import('postgres') as unknown as { default?: (url: string) => unknown }
        const postgres                = postgresModule.default ?? (postgresModule as unknown as (url: string) => unknown)
        const { drizzle: dzPostgres } = await import('drizzle-orm/postgres-js') as typeof import('drizzle-orm/postgres-js')
        db = (dzPostgres as unknown as (sql: unknown) => DrizzleDb)(postgres(url))
      } else if (driver === 'libsql') {
        const { createClient }        = await import('@libsql/client') as typeof import('@libsql/client')
        const { drizzle: dzLibsql }   = await import('drizzle-orm/libsql') as typeof import('drizzle-orm/libsql')
        db = dzLibsql(createClient({ url })) as unknown as DrizzleDb
      } else {
        // better-sqlite3 uses `export =` so dynamic import wraps it in `.default`
        const sqliteModule            = await import('better-sqlite3') as unknown as { default?: new (path: string) => unknown }
        const Database                = sqliteModule.default ?? (sqliteModule as unknown as new (path: string) => unknown)
        const { drizzle: dzSqlite }   = await import('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3')
        db = (dzSqlite as unknown as (db: unknown) => DrizzleDb)(new Database(url.replace(/^file:/, '')))
      }
    }

    if (!db) throw new Error('[RudderJS ORM Drizzle] Failed to initialize database client.')
    return new DrizzleAdapter(db, config.tables ?? {}, config.primaryKey ?? 'id')
  }

  query<T>(table: string): QueryBuilder<T> {
    const schema = this.tables[table] ?? DrizzleTableRegistry.get(table)
    if (!schema) {
      throw new Error(
        `[RudderJS ORM Drizzle] No table schema registered for "${table}". ` +
        `Pass tables: { ${table}: myTable } in drizzle() config or call ` +
        `DrizzleTableRegistry.register("${table}", myTable).`
      )
    }
    return new DrizzleQueryBuilder<T>(this.db, schema, this.primaryKey, (name) => this.resolveTable(name))
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
}

// ─── Config & Factory ──────────────────────────────────────

export interface DrizzleConfig {
  /** Pre-built drizzle db instance — skips driver setup */
  client?: unknown
  /** Database driver. Defaults to 'sqlite' */
  driver?: 'sqlite' | 'postgresql' | 'libsql'
  /** Connection URL. Falls back to DATABASE_URL env var */
  url?: string
  /** Map of table name → drizzle table schema object */
  tables?: Record<string, unknown>
  /** Primary key column name. Defaults to 'id' */
  primaryKey?: string
}

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
  driver: 'sqlite' | 'postgresql' | 'libsql'
  url?:   string
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
