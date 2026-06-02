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
  /** Single-row insert-or-update. The adapter's bulk `upsert` calls this once per
   *  row (Prisma has no portable bulk ON CONFLICT) and batches them in one
   *  `$transaction`. Optional on the structural type so existing fixtures don't
   *  have to stub it. */
  upsert?(args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>
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

// ─── Dev HMR: PrismaClient reuse across re-boots ───────────
//
// In dev, the @rudderjs/vite watcher re-bootstraps the app on every `app/`
// edit, which re-runs `DatabaseProvider.boot()` → `PrismaAdapter.make()`. Before
// this cache, each re-boot built a brand-new PrismaClient and opened a fresh
// driver connection (a new better-sqlite3 handle on dev.db, a new pg/mariadb
// pool, …) every time — and never disconnected the superseded one. Abandoned
// connections piled up across edits and, under concurrent load, wedged the read
// path to empty rows with no error and no self-recovery (only a process restart
// cleared it). See docs/plans/2026-05-24-hmr-reboot-window-serves-half-booted-responses.md.
//
// Prisma performs no HMR de-duplication of its own — under the Prisma 7
// driver-adapter model the app owns the client lifecycle, and the documented
// pattern is to cache one client on globalThis (`globalThis.prisma ??= new
// PrismaClient()`). We do the framework-level equivalent here, keyed by the
// resolved connection signature (driver + url) and stored on globalThis so it
// survives Vite's SSR module re-evaluation:
//
//   • same signature  → reuse the live client (no new connection opened)
//   • changed signature (a `config/database.ts` edit) → build a fresh client and
//     `$disconnect()` the superseded one so its handle is released
//
// No-op in production: a single boot means a single `make()` call → one entry,
// built once, never re-entered. Apps passing their own `config.client` opt out
// entirely (they own that client's lifecycle) via the early return in `make()`.
interface PrismaClientCacheEntry { signature: string; client: PrismaClient }
const PRISMA_CLIENT_CACHE_KEY = '__rudderjs_prisma_client__'

/**
 * Return the cached PrismaClient when its connection signature is unchanged.
 * On a signature change, disconnect the superseded client (fire-and-forget —
 * the new client doesn't wait on the old one closing) and report a miss.
 */
function reusablePrismaClient(signature: string): PrismaClient | undefined {
  const g = globalThis as Record<string, unknown>
  const cached = g[PRISMA_CLIENT_CACHE_KEY] as PrismaClientCacheEntry | undefined
  if (!cached) return undefined
  if (cached.signature === signature) return cached.client
  void Promise.resolve()
    .then(() => cached.client.$disconnect())
    .catch(() => { /* best effort — releasing a superseded connection */ })
  delete g[PRISMA_CLIENT_CACHE_KEY]
  return undefined
}

function cachePrismaClient(signature: string, client: PrismaClient): void {
  ;(globalThis as Record<string, unknown>)[PRISMA_CLIENT_CACHE_KEY] =
    { signature, client } satisfies PrismaClientCacheEntry
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
  Row,
} from '@rudderjs/contracts'
import { Expression } from '@rudderjs/contracts'
import {
  MissingEmbedderError,
  VectorStorageUnsupportedError,
} from '@rudderjs/orm'
import { resolveOptionalPeer } from '@rudderjs/support'

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
  /** AND-rooted nested groups — each entry is a Prisma where filter object
   *  produced by a sub-builder's `buildWhere()`. Spliced into the top-level
   *  `AND` array in `buildWhere()`. */
  private _andGroups: Record<string, unknown>[] = []
  /** OR-rooted nested groups — each entry is added to the top-level `OR` array. */
  private _orGroups: Record<string, unknown>[] = []
  /** When true, terminal methods throw — sub-builders are for `where*` chaining only. */
  private _isSubBuilder = false

  /** pgvector similarity clause (#B7 Phase 1). When set, terminal methods
   *  switch to a `$queryRawUnsafe` path that bypasses the standard
   *  fluent-API `findMany`. v1 disallows mixing with other where clauses.
   *
   *  Phase 2 widens `query` to support deferred auto-embed: when the user
   *  passes a string + `embedWith`, `query` stays `null` and `pendingEmbed`
   *  carries the text + model id so `_getViaVector` can lazy-embed at
   *  terminal time. */
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
    private prisma:     PrismaClient,
    private table:      string,
    /** Primary-key column name, threaded from `Model.primaryKey` via the
     *  adapter contract's `OrmAdapterQueryOpts`. Falls back to `'id'` when
     *  the contract opts aren't provided so older test fakes + third-party
     *  callers keep working without explicit threading. */
    private primaryKey: string = 'id',
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

  whereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    const sub = new PrismaQueryBuilder<T>(this.prisma, this.table)._markSubBuilder()
    fn(sub)
    const filter = sub.buildWhere()
    if (Object.keys(filter).length > 0) this._andGroups.push(filter)
    return this
  }

  orWhereGroup(fn: (q: QueryBuilder<T>) => QueryBuilder<T> | void): this {
    const sub = new PrismaQueryBuilder<T>(this.prisma, this.table)._markSubBuilder()
    fn(sub)
    const filter = sub.buildWhere()
    if (Object.keys(filter).length > 0) this._orGroups.push(filter)
    return this
  }

  orderBy(column: string | Expression, direction: 'ASC' | 'DESC' = 'ASC'): this {
    if (column instanceof Expression) this._rawUnsupported('orderBy(raw(...))')
    this._orders.push({ column: column as string, direction })
    return this
  }

  // ── raw-SQL escape hatch ─────────────────────────────────
  //
  // Prisma's structured client can't splice arbitrary raw SQL fragments into a
  // `findMany` projection / where / orderBy. Rather than silently dropping them,
  // throw and point at the `DB` facade (which runs raw SQL via `$queryRawUnsafe`
  // under the hood). The native engine and Drizzle support these directly.
  private _rawUnsupported(method: string): never {
    throw new Error(
      `[RudderJS ORM Prisma] ${method} is not supported on the Prisma adapter — its structured client can't splice raw SQL. Run the raw query via the DB facade: DB.select(sql, bindings) / DB.statement(sql, bindings).`,
    )
  }
  /** Plain whereHas/whereDoesntHave work on Prisma via `some`/`none`; the count
   *  (`has(rel, op, n)`) and OR-rooted (`orWhereHas`) forms have no structured
   *  equivalent — throw with a pointer rather than silently dropping them. */
  private _assertPlainRelationPredicate(p: RelationExistencePredicate): void {
    if (p.count) {
      throw new Error(
        `[RudderJS ORM Prisma] has("${p.relation}", …) count comparison is not supported — Prisma relation filters (some/none/every) can't express a count operator. Use whereHas() for existence, or DB.select(...) with a COUNT(*) subquery.`,
      )
    }
    if (p.boolean === 'OR') {
      throw new Error(
        `[RudderJS ORM Prisma] orWhereHas("${p.relation}") (OR-rooted relation existence) is not supported on the Prisma adapter. Use whereHas() (AND), or split into two queries and merge in app code.`,
      )
    }
  }

  selectRaw(_sql: string, _bindings: readonly unknown[] = []): this { this._rawUnsupported('selectRaw()') }
  whereRaw(_sql: string, _bindings: readonly unknown[] = []): this { this._rawUnsupported('whereRaw()') }
  orWhereRaw(_sql: string, _bindings: readonly unknown[] = []): this { this._rawUnsupported('orWhereRaw()') }
  orderByRaw(_sql: string, _bindings: readonly unknown[] = []): this { this._rawUnsupported('orderByRaw()') }
  // Prisma's query API has no column-vs-column comparison; route through raw.
  whereColumn(_left: string, _operatorOrRight: string, _right?: string): this { this._rawUnsupported('whereColumn()') }
  orWhereColumn(_left: string, _operatorOrRight: string, _right?: string): this { this._rawUnsupported('orWhereColumn()') }

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
    this._assertPlainRelationPredicate(p)
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

  whereVectorSimilarTo(
    column: string,
    query:  number[] | string,
    opts?:  {
      minSimilarity?: number
      metric?:        'cosine' | 'l2' | 'inner-product'
      embedWith?:     string
    },
  ): this {
    if (typeof query === 'string') {
      // Phase 2: defer auto-embed to terminal time so the chain stays sync.
      // `embedWith` is still required — fail loud rather than route through
      // whichever provider happens to be the AI default.
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
    this._assertNotSubBuilder()
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
  /**
   * Vector-query terminal path (#B7 Phase 1, lifted in Phase 2.5).
   * Switches from Prisma's fluent `findMany` to `$queryRawUnsafe` because
   * the standard API has no way to express pgvector ops (`<=>`, `<->`,
   * `<#>`).
   *
   * Phase 2.5 lifts the standalone-only restriction on flat
   * `.where()` / `.orWhere()` chains — those compose into the SQL via
   * {@link clauseToSql} with positional `$N` parameters. Soft-delete
   * scoping (`withTrashed` / `onlyTrashed`) flows in too. Polymorphic /
   * pivot relations resolve through {@link _resolveDeferred} into flat
   * `IN` / `NOT IN` clauses ahead of SQL composition.
   *
   * Still unsupported (throws):
   * - `whereGroup` / `orWhereGroup` — sub-builders pre-flatten to Prisma
   *   filter objects; the original `WhereClause[]` is lost.
   * - `whereHas` / `whereDoesntHave` (direct relations) — translate to
   *   Prisma `some` / `none` filters that don't have a flat SQL form.
   * - `with()` (eager load), aggregates, `orderBy()` — same reasons as
   *   Phase 1.
   *
   * Errors:
   * - pgvector extension missing on the connection → surfaces as
   *   {@link VectorStorageUnsupportedError} with the underlying msg.
   * - Non-Postgres adapter (e.g. SQLite) → same error class, different hint.
   */
  private async _getViaVector(): Promise<Array<Record<string, unknown>>> {
    if (this._vectorClause === null) return []  // unreachable: get() guards

    // Resolve polymorphic / pivot predicates first — they translate to
    // flat `IN` / `NOT IN` clauses pushed onto `_wheres`, which the SQL
    // composer below picks up like any other where.
    await this._resolveDeferred()

    if (this._andGroups.length > 0 || this._orGroups.length > 0 ||
        this._relationFilters.length > 0) {
      throw new Error(
        '[RudderJS ORM] whereGroup() / orWhereGroup() / direct whereHas() with .whereVectorSimilarTo() ' +
        'is not yet supported — use flat .where(col, op, val) / .orWhere() chains for now. ' +
        'Polymorphic / pivot relations route through whereHas internally and DO work since they pre-resolve to IN clauses.',
      )
    }
    if (this._withs.length > 0 || this._withConstrained.length > 0) {
      throw new Error(
        '[RudderJS ORM] Eager loading via .with() alongside .whereVectorSimilarTo() is not yet supported.',
      )
    }
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
    const op =
      metric === 'l2'             ? '<->' :
      metric === 'inner-product'  ? '<#>' :
                                    '<=>'   // cosine

    // Resolve the deferred auto-embed if we kept the string at sync-chain
    // time. Pulls @rudderjs/ai via resolveOptionalPeer so orm-prisma stays
    // independent of the AI runtime — apps that don't do RAG never load it.
    const resolvedQuery = query ?? await resolveAutoEmbed(pendingEmbed)
    const vec = vectorLiteral(resolvedQuery)
    const id  = quoteIdent
    const limit = this._limitN ?? 100

    // Compose the WHERE chain. Vector min-similarity is inlined (numeric,
    // safe). User-supplied where values bind through positional `$N`
    // placeholders so $queryRawUnsafe doesn't string-interpolate them.
    const params: unknown[] = []
    const whereParts: string[] = []

    if (minSimilarity !== undefined) {
      whereParts.push(
        `1 - (${id(column)} ${op} '${vec}'::vector) >= ${Number(minSimilarity)}`,
      )
    }

    // ── Laravel / Drizzle precedence parity (2026-05-22 breaking) ─────
    //
    // Same shape contract as `buildWhere()` above. The vector-search SQL
    // path historically emitted `(andChain) AND (or1 OR or2)` which
    // constrained every OR alternative by the prior AND chain. Laravel
    // parity is `(andChain) OR or1 OR or2`. See the `buildWhere()` block
    // for the full rationale.
    const andClauses: string[] = this._wheres.map(c => this.clauseToSql(c, params))
    if (this._softDeletes && !this._withTrashed) {
      andClauses.push(this._onlyTrashed
        ? `${id('deletedAt')} IS NOT NULL`
        : `${id('deletedAt')} IS NULL`)
    }
    const orClauses: string[] = this._orWheres.map(c => this.clauseToSql(c, params))

    if (andClauses.length > 0 && orClauses.length > 0) {
      const andSide = andClauses.length === 1 ? andClauses[0]! : `(${andClauses.join(' AND ')})`
      whereParts.push(`(${[andSide, ...orClauses].join(' OR ')})`)
    } else if (andClauses.length > 0) {
      whereParts.push(andClauses.join(' AND '))
    } else if (orClauses.length > 0) {
      whereParts.push(`(${orClauses.join(' OR ')})`)
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''

    // Optional projected distance column.
    const distSelect = this._selectVectorDist
      ? `, (${id(this._selectVectorDist.column)} ${op} '${vectorLiteral(this._selectVectorDist.query)}'::vector) AS ${id(this._selectVectorDist.alias)}`
      : ''

    const sql =
      `SELECT *${distSelect} FROM ${id(this.table)} ${whereSql} ` +
      `ORDER BY ${id(column)} ${op} '${vec}'::vector LIMIT ${Number(limit)}`

    type RawClient = { $queryRawUnsafe?: (sql: string, ...args: unknown[]) => Promise<unknown> }
    const raw = this.prisma as unknown as RawClient
    if (typeof raw.$queryRawUnsafe !== 'function') {
      throw new VectorStorageUnsupportedError(
        'prisma',
        'PrismaClient is missing $queryRawUnsafe — ensure you are using @prisma/client (not a fake without raw-query support).',
      )
    }

    try {
      const rows = await raw.$queryRawUnsafe(sql, ...params) as Array<Record<string, unknown>>
      return rows
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // pgvector missing — wrap with a friendly error.
      if (/operator does not exist|type "vector" does not exist|extension "vector"|column .* does not exist/i.test(msg)) {
        throw new VectorStorageUnsupportedError(
          'prisma',
          `pgvector or the column "${column}" is not available on this connection. ` +
          'Run `CREATE EXTENSION IF NOT EXISTS vector;` and `ALTER TABLE ... ADD COLUMN ' +
          `${column} vector(N);\` in a migration. Original: ${msg}`,
        )
      }
      throw err
    }
  }

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

  /**
   * Translate a single {@link WhereClause} to a parameterised SQL fragment
   * for the vector terminal path (#B7 Phase 2.5). Values bind through
   * positional `$N` placeholders that the caller passes to
   * `$queryRawUnsafe(sql, ...params)`.
   *
   * `null` values on `=` / `!=` map to `IS NULL` / `IS NOT NULL`.
   * Empty `IN` arrays short-circuit to `FALSE`; empty `NOT IN` arrays to
   * `TRUE` — Postgres rejects empty IN-lists with a syntax error otherwise.
   */
  private clauseToSql(clause: WhereClause, params: unknown[]): string {
    const col = quoteIdent(clause.column)
    const bind = (v: unknown): string => {
      params.push(v)
      return `$${params.length}`
    }
    switch (clause.operator) {
      case '=':
        if (clause.value === null) return `${col} IS NULL`
        return `${col} = ${bind(clause.value)}`
      case '!=':
        if (clause.value === null) return `${col} IS NOT NULL`
        return `${col} != ${bind(clause.value)}`
      case '>':
      case '>=':
      case '<':
      case '<=':
        return `${col} ${clause.operator} ${bind(clause.value)}`
      case 'LIKE':
        return `${col} LIKE ${bind(String(clause.value))}`
      case 'NOT LIKE':
        return `${col} NOT LIKE ${bind(String(clause.value))}`
      case 'IN': {
        const arr = Array.isArray(clause.value) ? clause.value : []
        if (arr.length === 0) return 'FALSE'
        return `${col} IN (${arr.map(v => bind(v)).join(', ')})`
      }
      case 'NOT IN': {
        const arr = Array.isArray(clause.value) ? clause.value : []
        if (arr.length === 0) return 'TRUE'
        return `${col} NOT IN (${arr.map(v => bind(v)).join(', ')})`
      }
      default:
        return `${col} = ${bind(clause.value)}`
    }
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
      case 'NOT LIKE': {
        const raw = String(clause.value)
        const hasLeading  = raw.startsWith('%')
        const hasTrailing = raw.endsWith('%')
        const inner = raw.replace(/^%|%$/g, '')
        if (hasLeading && hasTrailing) {
          return { [clause.column]: { not: { contains: inner } } }
        } else if (hasTrailing) {
          return { [clause.column]: { not: { startsWith: inner } } }
        } else if (hasLeading) {
          return { [clause.column]: { not: { endsWith: inner } } }
        }
        return { [clause.column]: { not: { equals: raw } } }
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

    const hasAndGroups = this._andGroups.length > 0
    const hasOrGroups  = this._orGroups.length > 0
    const hasAndItems  = andFilters.length > 0 || hasAndGroups
    const hasOrItems   = orFilters.length > 0 || hasOrGroups

    if (!hasAndItems && !hasOrItems) return {}

    // ── Laravel / Drizzle precedence parity (2026-05-22 breaking) ─────────
    //
    // Before this change, Prisma's shape was
    //   `{ ...andSpread, OR: [...orFilters] }`
    // which Prisma interpreted as
    //   `andSpread AND (or1 OR or2 ...)`.
    // That constrained every `.orWhere()` alternative by the prior AND
    // chain — so `where('a').where('b').orWhere('c')` matched only rows
    // where `(a AND b AND c)`, not `(a AND b) OR c` as Eloquent does.
    //
    // The Laravel-parity shape is
    //   `OR: [(AND chain), or1, or2, ...]`
    // so each `.orWhere()` / `.orWhereGroup()` is a top-level alternative
    // and the prior AND chain becomes one of those alternatives. This
    // matches `@rudderjs/orm-drizzle`'s Laravel-parity behaviour (see
    // `packages/orm-drizzle/src/index.ts:buildConditions`) and the
    // sequence of operators in Eloquent's query grammar.
    //
    // Edge cases:
    // - Only AND content → keep the legacy flat shape (Object.assign spread
    //   when no andGroups; `{ AND: [...] }` array form when groups are
    //   present to avoid sibling-key clobbering). Tests for AND-only
    //   queries are unaffected.
    // - Only OR content → emit `{ OR: [...] }`.
    // - Both → emit `{ OR: [andSide, ...orItems] }`. The AND side
    //   collapses to a single flat object if it has exactly one element
    //   and no andGroups (the common case for `.where().orWhere()`);
    //   otherwise it's `{ AND: [...] }`.
    const buildAndSide = (): Record<string, unknown> => {
      if (hasAndGroups) {
        return { AND: [...andFilters, ...this._andGroups] }
      }
      if (andFilters.length === 1) return { ...andFilters[0] }
      if (andFilters.length > 1) {
        // Use AND-array form so duplicate columns survive — Object.assign
        // would clobber e.g. two `.where('priority', ...)` calls. Honour
        // the same column-collision safety as the andGroups branch.
        return { AND: [...andFilters] }
      }
      // andFilters.length === 0 && !hasAndGroups — caller is guarded.
      /* istanbul ignore next */
      return {}
    }

    if (!hasOrItems) {
      // Pure AND chain — for AND-only-no-groups with multiple items the
      // legacy shape was Object.assign-spread. Keep that to avoid churning
      // tests of unrelated callers; the new AND-array form is only used
      // when we need to compose with OR alternatives.
      if (hasAndGroups) {
        return { AND: [...andFilters, ...this._andGroups] }
      }
      if (andFilters.length > 0) return Object.assign({}, ...andFilters)
      return {}
    }

    if (!hasAndItems) {
      return { OR: [...orFilters, ...this._orGroups] }
    }

    // Both AND and OR content — Laravel-parity OR-of-alternatives.
    return { OR: [buildAndSide(), ...orFilters, ...this._orGroups] }
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
    this._assertNotSubBuilder()
    if (this._vectorClause) {
      // Vector first(): cap limit to 1, run the vector path, unwrap.
      const prevLimit = this._limitN
      this._limitN = 1
      try {
        const rows = await this._getViaVector()
        return (rows[0] as T) ?? null
      } finally {
        this._limitN = prevLimit
      }
    }
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
    this._assertNotSubBuilder()
    await this._resolveDeferred()
    // Compose accumulated wheres + global scopes + soft-delete + relation
    // predicates with the PK match — `findUnique` only accepts unique columns
    // as the where filter, so we shift to `findFirst` to AND the PK with the
    // rest of the chain. Without this, `User.where('tenantId', t).find(5)`
    // would cross tenants.
    const composed = this.buildWhere()
    const pkMatch  = { [this.primaryKey]: id }
    const where    = Object.keys(composed).length > 0
      ? { AND: [pkMatch, composed] }
      : pkMatch
    const row = await this.delegate.findFirst({ where, include: this.buildInclude() }) as Record<string, unknown> | null
    if (!row) return null
    await this._stampAggregates([row])
    return row as T
  }

  async get(): Promise<T[]> {
    this._assertNotSubBuilder()
    if (this._vectorClause) return this._getViaVector() as Promise<T[]>
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
    this._assertNotSubBuilder()
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
    this._assertNotSubBuilder()
    if (this._vectorClause) {
      throw new Error(
        '[RudderJS ORM] count() with .whereVectorSimilarTo() is not supported in B7 Phase 1 — ' +
        'similarity-bounded counts add complexity for marginal value. Call get() and check .length.',
      )
    }
    await this._resolveDeferred()
    return this.delegate.count({ where: this.buildWhere() })
  }

  async create(data: Partial<T>): Promise<T> {
    this._assertNotSubBuilder()
    return this.delegate.create({ data }) as Promise<T>
  }

  async update(id: number | string, data: Partial<T>): Promise<T> {
    this._assertNotSubBuilder()
    return this.delegate.update({ where: { [this.primaryKey]: id }, data }) as Promise<T>
  }

  async delete(id: number | string): Promise<void> {
    this._assertNotSubBuilder()
    if (this._softDeletes) {
      await this.delegate.update({ where: { [this.primaryKey]: id }, data: { deletedAt: new Date() } })
    } else {
      await this.delegate.delete({ where: { [this.primaryKey]: id } })
    }
  }

  async restore(id: number | string): Promise<T> {
    this._assertNotSubBuilder()
    return this.delegate.update({ where: { [this.primaryKey]: id }, data: { deletedAt: null } }) as Promise<T>
  }

  async forceDelete(id: number | string): Promise<void> {
    this._assertNotSubBuilder()
    await this.delegate.delete({ where: { [this.primaryKey]: id } })
  }

  async insertMany(rows: Partial<T>[]): Promise<void> {
    this._assertNotSubBuilder()
    if (rows.length === 0) return
    await this.delegate.createMany({ data: rows as Record<string, unknown>[] })
  }

  async upsert(rows: Partial<T>[], uniqueBy: string[], update: string[]): Promise<number> {
    this._assertNotSubBuilder()
    if (rows.length === 0) return 0
    const delegateUpsert = this.delegate.upsert
    if (typeof delegateUpsert !== 'function') {
      throw new Error('[RudderJS ORM Prisma] The Prisma client delegate has no upsert() — cannot perform Model.upsert().')
    }
    // Prisma has no portable bulk ON CONFLICT, so map each row to a single-row
    // upsert. `where` is a unique selector: one column → `{ col: val }`; a
    // composite uniqueBy → Prisma's compound-unique input `{ a_b: { a, b } }`
    // (a matching `@@unique([a, b])` must exist, exactly as ON CONFLICT requires).
    const ops = (rows as Record<string, unknown>[]).map((row) => {
      const where = uniqueBy.length === 1
        ? { [uniqueBy[0]!]: row[uniqueBy[0]!] }
        : { [uniqueBy.join('_')]: Object.fromEntries(uniqueBy.map((c) => [c, row[c]])) }
      const updateData: Record<string, unknown> = {}
      for (const c of update) updateData[c] = row[c]
      return delegateUpsert.call(this.delegate, { where, create: row, update: updateData })
    })
    // Batch atomically via the array form of $transaction when available; a fake
    // client without it just runs the operations as already-issued promises.
    const tx = (this.prisma as unknown as { $transaction?: (p: unknown[]) => Promise<unknown[]> }).$transaction
    if (typeof tx === 'function') await tx.call(this.prisma, ops)
    else await Promise.all(ops)
    return rows.length
  }

  async deleteAll(): Promise<number> {
    this._assertNotSubBuilder()
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
    this._assertNotSubBuilder()
    return this.delegate.update({
      where: { [this.primaryKey]: id },
      data:  { [column]: { increment: amount }, ...extra },
    }) as Promise<T>
  }

  async decrement(id: number | string, column: string, amount = 1, extra: Record<string, unknown> = {}): Promise<T> {
    this._assertNotSubBuilder()
    return this.delegate.update({
      where: { [this.primaryKey]: id },
      data:  { [column]: { decrement: amount }, ...extra },
    }) as Promise<T>
  }

  async paginate(page = 1, perPage = 15): Promise<PaginatedResult<T>> {
    this._assertNotSubBuilder()
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

/** Monotonic counter for unique nested-transaction SAVEPOINT names. */
let savepointSeq = 0

class PrismaAdapter implements OrmAdapter {
  private _driver: string

  private constructor(
    readonly prismaClient: PrismaClient,
    driver?: string,
    /** True when bound to an interactive-transaction client (`tx`): nesting maps
     *  to a SAVEPOINT and lifecycle calls are no-ops on the shared connection. */
    private readonly txScoped = false,
  ) {
    this._driver = driver ?? 'sqlite'
  }
  /** @internal — expose the raw PrismaClient for DI binding */
  get prisma(): PrismaClient { return this.prismaClient }

  static async make(config: PrismaConfig = {}): Promise<PrismaAdapter> {
    if (config.client) return new PrismaAdapter(config.client, config.driver)

    // Resolve the connection signature up front so dev HMR re-boots reuse one
    // live PrismaClient instead of opening (and leaking) a fresh connection on
    // every edit. The url falls back to DATABASE_URL, then to the sqlite default,
    // matching the driver branches below. See reusablePrismaClient().
    const driver = config.driver ?? 'sqlite'
    const resolvedUrl = config.url ?? process.env['DATABASE_URL'] ?? (driver === 'sqlite' ? 'file:./dev.db' : '')
    const signature = `${driver}::${resolvedUrl}`

    const reused = reusablePrismaClient(signature)
    if (reused) return new PrismaAdapter(reused, config.driver)

    const opts: Record<string, unknown> = {}

    if (config.driver === 'postgresql' && config.url) {
      const { Pool } = await import('pg') as typeof import('pg')
      const { PrismaPg } = await import('@prisma/adapter-pg') as typeof import('@prisma/adapter-pg')
      opts['adapter'] = new PrismaPg(new Pool({ connectionString: config.url }))
    } else if (config.driver === 'mysql' && config.url) {
      // MySQL / MariaDB via the mariadb wire-compatible adapter. The
      // `@prisma/adapter-mariadb` constructor takes parsed connection options
      // (the underlying `mariadb` npm client doesn't accept a URL directly),
      // so we parse the standard mysql:// URL into host / user / password
      // / port / database.
      const { PrismaMariaDb } = await import('@prisma/adapter-mariadb') as typeof import('@prisma/adapter-mariadb')
      const u = new URL(config.url)
      opts['adapter'] = new PrismaMariaDb({
        host:     u.hostname,
        port:     u.port ? Number(u.port) : 3306,
        user:     decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, ''),
      })
    } else if (config.driver === 'libsql' && config.url) {
      // Remote libSQL / Turso
      const { PrismaLibSql } = await import('@prisma/adapter-libsql') as typeof import('@prisma/adapter-libsql')
      opts['adapter'] = new PrismaLibSql({ url: config.url })
    } else {
      // Local SQLite via better-sqlite3 (driver: 'sqlite' or default).
      // `resolvedUrl` already applied the DATABASE_URL / dev.db fallback above.
      const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3') as typeof import('@prisma/adapter-better-sqlite3')
      opts['adapter'] = new PrismaBetterSqlite3({ url: resolvedUrl })
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
    const client = new PC(opts)
    cachePrismaClient(signature, client)
    return new PrismaAdapter(client, config.driver)
  }

  query<T>(table: string, opts?: { primaryKey?: string }): QueryBuilder<T> {
    return new PrismaQueryBuilder<T>(this.prisma, table, opts?.primaryKey ?? 'id')
  }

  async connect(): Promise<void> {
    // A transaction-scoped adapter shares the open connection — never re-connect.
    if (this.txScoped) return
    await this.prisma.$connect()
  }

  async disconnect(): Promise<void> {
    // Never close the shared connection from inside a transaction scope (and the
    // interactive-transaction client has no `$disconnect`).
    if (this.txScoped) return
    await this.prisma.$disconnect()
  }

  /**
   * Run `fn` inside a Prisma interactive transaction. The adapter passed to `fn`
   * is bound to Prisma's transaction client, so every query built from it — and,
   * via the ORM's `AsyncLocalStorage`, every `Model.*` / `DB.*` call inside the
   * callback — executes on that one transaction. Commits when `fn` resolves;
   * rolls back and re-throws when it rejects.
   *
   * **Nesting → SAVEPOINT.** Prisma's interactive-transaction client can't open
   * another `$transaction`, so a nested call brackets `fn` with a `SAVEPOINT` /
   * `RELEASE SAVEPOINT` (or `ROLLBACK TO SAVEPOINT` on failure) on the same
   * connection — matching the native engine's savepoint semantics. SAVEPOINT is
   * supported by SQLite, Postgres, and MySQL alike.
   */
  async transaction<T>(fn: (tx: OrmAdapter) => Promise<T>): Promise<T> {
    if (this.txScoped) return this.savepoint(fn)

    const client = this.prisma as unknown as {
      $transaction<R>(fn: (tx: PrismaClient) => Promise<R>): Promise<R>
    }
    return client.$transaction((txClient) => {
      const scoped = new PrismaAdapter(txClient, this._driver, true)
      return fn(scoped)
    })
  }

  /** Nested-transaction body: a SAVEPOINT on the current transaction connection.
   *  `fn` receives this same scoped adapter (same `tx` client / connection). */
  private async savepoint<T>(fn: (tx: OrmAdapter) => Promise<T>): Promise<T> {
    const name = `rudder_sp_${(savepointSeq = (savepointSeq + 1) % Number.MAX_SAFE_INTEGER)}`
    const exec = this.prisma as unknown as {
      $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>
    }
    await exec.$executeRawUnsafe(`SAVEPOINT ${name}`)
    try {
      const result = await fn(this)
      await exec.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`)
      return result
    } catch (err) {
      await exec.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`)
      throw err
    }
  }

  /**
   * Raw `SELECT` for the `DB` facade (`DB.select`) via Prisma's
   * `$queryRawUnsafe`. Bindings are passed as positional params, so Prisma
   * parameterizes them rather than string-interpolating into `sql`.
   */
  async selectRaw(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
    const client = this.prisma as unknown as {
      $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T>
    }
    return (await client.$queryRawUnsafe<Row[]>(sql, ...bindings)) ?? []
  }

  /**
   * Raw writing statement for the `DB` facade (`DB.insert`/`update`/`delete`/
   * `statement`) via Prisma's `$executeRawUnsafe`, which resolves to the number
   * of rows affected.
   */
  async affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number> {
    const client = this.prisma as unknown as {
      $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>
    }
    return client.$executeRawUnsafe(sql, ...bindings)
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
// Side effect: wires the DB facade to resolve this app's active ORM adapter.
import '@rudderjs/orm/db-bridge'

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
    // Prisma's `$connect()` is optional — the client connects lazily on first
    // query. Skipping it saves ~20–40 ms cold boot; the trade-off is DB-down
    // surfacing on first query instead of at boot. Apps that need fail-fast at
    // boot can call `await app.make('db').connect()` from AppServiceProvider.

    ModelRegistry.set(adapter)
    this.app.instance('db', adapter)
    this.app.instance('prisma', adapter.prisma)
  }
}

// ─── Vector-query SQL helpers (#B7 Phase 1) ────────────────

/**
 * Quote a SQL identifier as a double-quoted Postgres identifier. Used
 * by the vector-query path which builds `$queryRawUnsafe` strings.
 *
 * pgvector accepts both `"snake_case"` and `"camelCase"` table names —
 * Prisma typically maps Model names to camelCase delegates over
 * snake_case `@@map`'d tables, so we accept either as a passthrough.
 *
 * Escapes embedded double quotes by doubling them — Postgres's SQL
 * quoting rule. Even though `table` + `column` come from typed Model
 * definitions in practice, defensive quoting keeps the path robust if
 * the future migration helper passes through user input.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Serialize a `number[]` into pgvector's text literal format —
 * `'[0.1,0.2,0.3]'` — without the surrounding quotes (caller wraps
 * in `'...'::vector`). Numbers go through `.toString()` which yields
 * the shortest unambiguous form for finite floats. Caller is
 * responsible for ensuring finiteness (the cast does this on write;
 * vector queries trust the caller).
 */
function vectorLiteral(vec: readonly number[]): string {
  return `[${vec.join(',')}]`
}

/**
 * Resolve the deferred auto-embed for `whereVectorSimilarTo('col',
 * '<text>', { embedWith })` (#B7 Phase 2). Pulls `@rudderjs/ai`
 * lazily via `resolveOptionalPeer` so the orm-prisma adapter never
 * hard-deps on the AI package — apps that don't do RAG don't load it.
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