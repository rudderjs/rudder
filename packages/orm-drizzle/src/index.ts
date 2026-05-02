import {
  eq, ne, gt, gte, lt, lte, like, inArray, notInArray,
  isNull, isNotNull,
  and, or, asc, desc, count as sqlCount, sql,
  type Column, type SQL,
} from 'drizzle-orm'
import type {
  OrmAdapter,
  OrmAdapterProvider,
  QueryBuilder,
  WhereClause,
  WhereOperator,
  OrderClause,
  PaginatedResult,
} from '@rudderjs/contracts'

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

  constructor(
    private readonly db:         DrizzleDb,
    private readonly table:      unknown,
    private readonly primaryKey: string,
  ) {}

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

  // Drizzle relational queries require pre-defined relation schemas. We don't
  // yet thread a relations object into the adapter, so eager-loading via .with()
  // is not implemented. Calls are silently dropped to keep the QueryBuilder
  // contract compatible across adapters; use Drizzle's relational query API
  // directly when you need eager loading.
  with(..._relations: string[]): this { return this }

  withTrashed(): this  { this._withTrashed = true; return this }
  onlyTrashed(): this  { this._onlyTrashed = true; return this }

  /** @internal — called by Model to enable automatic soft delete filtering */
  _enableSoftDeletes(): this { this._softDeletes = true; return this }

  private col(column: string): unknown {
    return (this.table as Record<string, unknown>)[column]
  }

  private clauseToExpr(clause: WhereClause): SQL {
    const col = this.col(clause.column) as Column
    switch (clause.operator) {
      case '=':      return eq(col, clause.value) as SQL
      case '!=':     return ne(col, clause.value) as SQL
      case '>':      return gt(col, clause.value) as SQL
      case '>=':     return gte(col, clause.value) as SQL
      case '<':      return lt(col, clause.value) as SQL
      case '<=':     return lte(col, clause.value) as SQL
      case 'LIKE':   return like(col, clause.value as string) as SQL
      case 'IN':     return inArray(col, clause.value as unknown[]) as SQL
      case 'NOT IN': return notInArray(col, clause.value as unknown[]) as SQL
      default: {
        const _exhaustive: never = clause.operator
        throw new Error(`[RudderJS ORM Drizzle] Unsupported operator: ${String(_exhaustive)}`)
      }
    }
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
    const cond    = this.buildConditions()
    const orderBy = this.buildOrderBy()

    let q = this.db.select().from(this.table)
    if (cond)           q = q.where(cond)
    if (orderBy.length) q = q.orderBy(...orderBy)
    q = q.limit(1)

    const result = await (q as unknown as Promise<T[]>)
    return result[0] ?? null
  }

  async find(id: number | string): Promise<T | null> {
    const pkCol    = this.col(this.primaryKey) as Column
    const softExpr = this.softDeleteExpr()
    const pkExpr   = eq(pkCol, id) as SQL
    const cond     = softExpr ? and(pkExpr, softExpr) as SQL : pkExpr

    const result = await (this.db
      .select()
      .from(this.table)
      .where(cond)
      .limit(1) as unknown as Promise<T[]>)
    return result[0] ?? null
  }

  async get(): Promise<T[]> {
    const cond    = this.buildConditions()
    const orderBy = this.buildOrderBy()

    let q = this.db.select().from(this.table)
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
    const cond = this.buildConditions()

    let q = this.db.select({ value: sqlCount() }).from(this.table)
    if (cond) q = q.where(cond)

    const result: Array<{ value: number | string | bigint }> = await (q as unknown as Promise<Array<{ value: number | string | bigint }>>)
    return Number(result[0]?.value ?? 0)
  }

  async create(data: Partial<T>): Promise<T> {
    const result = await (this.db
      .insert(this.table)
      .values(data)
      .returning() as unknown as Promise<T[]>)
    if (!result[0]) throw new Error('[RudderJS ORM Drizzle] create() returned no rows.')
    return result[0]
  }

  async update(id: number | string, data: Partial<T>): Promise<T> {
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
    const pkCol = this.col(this.primaryKey) as Column
    const result = await (this.db
      .update(this.table)
      .set({ deletedAt: null })
      .where(eq(pkCol, id))
      .returning() as unknown as Promise<T[]>)
    return result[0] as T
  }

  async forceDelete(id: number | string): Promise<void> {
    const pkCol = this.col(this.primaryKey) as Column
    await (this.db
      .delete(this.table)
      .where(eq(pkCol, id)) as unknown as Promise<void>)
  }

  async increment(id: number | string, column: string, amount = 1, extra: Record<string, unknown> = {}): Promise<T> {
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
    const cond    = this.buildConditions()
    const orderBy = this.buildOrderBy()

    let pageQ = this.db.select().from(this.table)
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
    return new DrizzleQueryBuilder<T>(this.db, schema, this.primaryKey)
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
import { ModelRegistry } from '@rudderjs/orm'

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
