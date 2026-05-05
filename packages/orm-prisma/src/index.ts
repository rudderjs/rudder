// PrismaClient is imported lazily since it requires `prisma generate` to be run first.
// We use a structural type that covers the runtime API we actually depend on.
type PrismaModelDelegate = {
  findFirst(args?: Record<string, unknown>): Promise<unknown>
  findUnique(args: Record<string, unknown>): Promise<unknown>
  findMany(args?: Record<string, unknown>): Promise<unknown[]>
  count(args?: Record<string, unknown>): Promise<number>
  create(args: Record<string, unknown>): Promise<unknown>
  createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>
  update(args: Record<string, unknown>): Promise<unknown>
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

  private buildInclude(): Record<string, unknown> | undefined {
    if (!this._withs.length && this._withConstrained.length === 0) return undefined
    const include: Record<string, unknown> = {}
    for (const r of this._withs) include[r] = true
    // Constrained eager-loads override unconstrained for the same relation —
    // `withWhereHas` is the canonical source when both are present.
    for (const c of this._withConstrained) include[c.relation] = { where: c.filter }
    return include
  }

  private buildOrderBy(): Record<string, string>[] {
    return this._orders.map(o => ({ [o.column]: o.direction.toLowerCase() }))
  }

  async first(): Promise<T | null> {
    await this._resolveDeferred()
    return (await this.delegate.findFirst({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
    }) ?? null) as T | null
  }

  async find(id: number | string): Promise<T | null> {
    await this._resolveDeferred()
    return (await this.delegate.findUnique({ where: { id }, include: this.buildInclude() }) ?? null) as T | null
  }

  async get(): Promise<T[]> {
    await this._resolveDeferred()
    return this.delegate.findMany({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
      take:    this._limitN  ?? undefined,
      skip:    this._offsetN ?? undefined,
    }) as Promise<T[]>
  }

  async all(): Promise<T[]> {
    await this._resolveDeferred()
    return this.delegate.findMany({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
      take:    this._limitN  ?? undefined,
      skip:    this._offsetN ?? undefined,
    }) as Promise<T[]>
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
    const [data, total] = await Promise.all([
      this.delegate.findMany({
        where:   this.buildWhere(),
        include: this.buildInclude(),
        orderBy: this.buildOrderBy(),
        take:    perPage,
        skip:    (page - 1) * perPage,
      }) as Promise<T[]>,
      this.delegate.count({ where: this.buildWhere() }),
    ])

    const lastPage = Math.ceil(total / perPage)
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