// PrismaClient is imported lazily since it requires `prisma generate` to be run first.
// We use a structural type that covers the runtime API we actually depend on.
type PrismaModelDelegate = {
  findFirst(args?: Record<string, unknown>): Promise<unknown>
  findUnique(args: Record<string, unknown>): Promise<unknown>
  findMany(args?: Record<string, unknown>): Promise<unknown[]>
  count(args?: Record<string, unknown>): Promise<number>
  create(args: Record<string, unknown>): Promise<unknown>
  update(args: Record<string, unknown>): Promise<unknown>
  delete(args: Record<string, unknown>): Promise<unknown>
}
type PrismaClient = {
  $connect(): Promise<void>
  $disconnect(): Promise<void>
  [table: string]: PrismaModelDelegate | ((...args: unknown[]) => unknown)
}

import type {
  OrmAdapter,
  OrmAdapterProvider,
  QueryBuilder,
  WhereClause,
  WhereOperator,
  OrderClause,
  PaginatedResult,
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

  private buildInclude(): Record<string, boolean> | undefined {
    if (!this._withs.length) return undefined
    return Object.fromEntries(this._withs.map(r => [r, true]))
  }

  private buildOrderBy(): Record<string, string>[] {
    return this._orders.map(o => ({ [o.column]: o.direction.toLowerCase() }))
  }

  async first(): Promise<T | null> {
    return (await this.delegate.findFirst({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
    }) ?? null) as T | null
  }

  async find(id: number | string): Promise<T | null> {
    return (await this.delegate.findUnique({ where: { id }, include: this.buildInclude() }) ?? null) as T | null
  }

  async get(): Promise<T[]> {
    return this.delegate.findMany({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
      take:    this._limitN  ?? undefined,
      skip:    this._offsetN ?? undefined,
    }) as Promise<T[]>
  }

  async all(): Promise<T[]> {
    return this.delegate.findMany({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
      take:    this._limitN  ?? undefined,
      skip:    this._offsetN ?? undefined,
    }) as Promise<T[]>
  }

  async count(): Promise<number> {
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

  async paginate(page = 1, perPage = 15): Promise<PaginatedResult<T>> {
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
  private constructor(readonly prismaClient: PrismaClient) {}
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

    type PrismaClientConstructor = new (opts: Record<string, unknown>) => PrismaClient
    const mod = await import('@prisma/client') as unknown as { PrismaClient?: PrismaClientConstructor; default?: PrismaClientConstructor | { PrismaClient?: PrismaClientConstructor } }
    const rawDefault = mod.default
    const PC = (mod.PrismaClient
      ?? (rawDefault && typeof rawDefault === 'object' && 'PrismaClient' in rawDefault ? rawDefault.PrismaClient : rawDefault)
    ) as PrismaClientConstructor
    return new PrismaAdapter(new PC(opts))
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
}

// ─── Config & Factory ──────────────────────────────────────

export interface PrismaConfig {
  client?: PrismaClient
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
}

export function prisma(config: PrismaConfig = {}): OrmAdapterProvider {
  return {
    async create(): Promise<OrmAdapter> {
      return PrismaAdapter.make(config)
    },
  }
}

// ─── PrismaProvider ────────────────────────────────────────

import { ServiceProvider, type Application } from '@rudderjs/core'
import { ModelRegistry } from '@rudderjs/orm'

export function database(config?: DatabaseConfig): new (app: Application) => ServiceProvider {
  class PrismaServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      let prismaConfig: PrismaConfig = {}

      if (config) {
        const conn = config.connections[config.default]
        if (conn) prismaConfig = { driver: conn.driver, ...(conn.url !== undefined && { url: conn.url }) }
      }

      const adapter = await PrismaAdapter.make(prismaConfig)
      await adapter.connect()

      ModelRegistry.set(adapter)
      this.app.instance('db', adapter)
      this.app.instance('prisma', adapter.prisma)
    }
  }

  return PrismaServiceProvider
}