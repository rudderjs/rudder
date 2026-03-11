// PrismaClient is imported lazily since it requires `prisma generate` to be run first
type PrismaClient = any

import type {
  OrmAdapter,
  OrmAdapterProvider,
  QueryBuilder,
  WhereClause,
  WhereOperator,
  OrderClause,
  PaginatedResult,
} from '@boostkit/contracts'

// ─── Prisma Query Builder ──────────────────────────────────

class PrismaQueryBuilder<T> implements QueryBuilder<T> {
  private _wheres:   WhereClause[] = []
  private _orWheres: WhereClause[] = []
  private _orders:   OrderClause[] = []
  private _limitN:   number | null = null
  private _offsetN:  number | null = null
  private _withs:    string[] = []

  constructor(
    private prisma: PrismaClient,
    private table:  string
  ) {}

  private get delegate(): any {
    const d = (this.prisma as any)[this.table]
    if (!d) throw new Error(
      `[BoostKit ORM] Prisma has no delegate for table "${this.table}". ` +
      `Did you run "prisma generate" after adding the model to your schema?`
    )
    return d
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
    return this.delegate.findFirst({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
    }) ?? null
  }

  async find(id: number | string): Promise<T | null> {
    return this.delegate.findUnique({ where: { id }, include: this.buildInclude() }) ?? null
  }

  async get(): Promise<T[]> {
    return this.delegate.findMany({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
      take:    this._limitN  ?? undefined,
      skip:    this._offsetN ?? undefined,
    })
  }

  async all(): Promise<T[]> {
    return this.delegate.findMany({
      where:   this.buildWhere(),
      include: this.buildInclude(),
      orderBy: this.buildOrderBy(),
      take:    this._limitN  ?? undefined,
      skip:    this._offsetN ?? undefined,
    })
  }

  async count(): Promise<number> {
    return this.delegate.count({ where: this.buildWhere() })
  }

  async create(data: Partial<T>): Promise<T> {
    return this.delegate.create({ data })
  }

  async update(id: number | string, data: Partial<T>): Promise<T> {
    return this.delegate.update({ where: { id }, data })
  }

  async delete(id: number | string): Promise<void> {
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
      }),
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
  private constructor(private prisma: PrismaClient) {}

  static async make(config: PrismaConfig = {}): Promise<PrismaAdapter> {
    if (config.client) return new PrismaAdapter(config.client)

    const opts: Record<string, unknown> = {}

    if (config.driver === 'postgresql' && config.url) {
      const { Pool } = await import('pg') as any
      const { PrismaPg } = await import('@prisma/adapter-pg') as any
      opts['adapter'] = new PrismaPg(new Pool({ connectionString: config.url }))
    } else if (config.driver === 'libsql' && config.url) {
      // Remote libSQL / Turso
      const { createClient } = await import('@libsql/client') as any
      const { PrismaLibSql } = await import('@prisma/adapter-libsql') as any
      opts['adapter'] = new PrismaLibSql(createClient({ url: config.url }))
    } else {
      // Local SQLite via better-sqlite3 (driver: 'sqlite' or default)
      const dbUrl = config.url ?? process.env['DATABASE_URL'] ?? 'file:./dev.db'
      const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3') as any
      opts['adapter'] = new PrismaBetterSqlite3({ url: dbUrl })
    }

    const mod = await import('@prisma/client') as any
    const PC  = mod.PrismaClient ?? mod.default?.PrismaClient ?? mod.default
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

import { ServiceProvider, type Application } from '@boostkit/core'
import { ModelRegistry } from '@boostkit/orm'

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
      this.app.instance('prisma', (adapter as any).prisma)
    }
  }

  return PrismaServiceProvider
}