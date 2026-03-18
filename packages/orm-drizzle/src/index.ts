import {
  eq, ne, gt, gte, lt, lte, like, inArray, notInArray,
  and, asc, desc, count as sqlCount,
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
} from '@boostkit/contracts'

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
  private _wheres:  WhereClause[] = []
  private _orders:  OrderClause[] = []
  private _limitN:  number | null = null
  private _offsetN: number | null = null

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

  orWhere(column: string, value: unknown): this {
    this._wheres.push({ column, operator: '=', value })
    return this
  }

  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this._orders.push({ column, direction })
    return this
  }

  limit(n: number):  this { this._limitN  = n; return this }
  offset(n: number): this { this._offsetN = n; return this }

  // Drizzle relational queries require pre-defined relation schemas — no-op here
  with(..._relations: string[]): this { return this }

  private col(column: string): unknown {
    return (this.table as Record<string, unknown>)[column]
  }

  private buildConditions(): SQL | undefined {
    if (!this._wheres.length) return undefined

    const exprs = this._wheres.map(clause => {
      const col = this.col(clause.column) as Column
      switch (clause.operator) {
        case '=':      return eq(col, clause.value)
        case '!=':     return ne(col, clause.value)
        case '>':      return gt(col, clause.value)
        case '>=':     return gte(col, clause.value)
        case '<':      return lt(col, clause.value)
        case '<=':     return lte(col, clause.value)
        case 'LIKE':   return like(col, clause.value as string)
        case 'IN':     return inArray(col, clause.value as unknown[])
        case 'NOT IN': return notInArray(col, clause.value as unknown[])
      }
    })

    return exprs.length === 1 ? exprs[0] : and(...(exprs as SQL[]))
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
    const pkCol = this.col(this.primaryKey) as Column
    const result = await (this.db
      .select()
      .from(this.table)
      .where(eq(pkCol, id))
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
    return this.db.select().from(this.table) as unknown as Promise<T[]>
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
    if (!result[0]) throw new Error('[BoostKit ORM Drizzle] create() returned no rows.')
    return result[0]
  }

  async update(id: number | string, data: Partial<T>): Promise<T> {
    const pkCol = this.col(this.primaryKey) as Column
    const result = await (this.db
      .update(this.table)
      .set(data)
      .where(eq(pkCol, id))
      .returning() as unknown as Promise<T[]>)
    if (!result[0]) throw new Error('[BoostKit ORM Drizzle] update() returned no rows.')
    return result[0]
  }

  async delete(id: number | string): Promise<void> {
    const pkCol = this.col(this.primaryKey) as Column
    await (this.db
      .delete(this.table)
      .where(eq(pkCol, id)) as unknown as Promise<void>)
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

class DrizzleAdapter implements OrmAdapter {
  private constructor(
    private readonly db:         DrizzleDb,
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

    if (!db) throw new Error('[BoostKit ORM Drizzle] Failed to initialize database client.')
    return new DrizzleAdapter(db, config.tables ?? {}, config.primaryKey ?? 'id')
  }

  query<T>(table: string): QueryBuilder<T> {
    const schema = this.tables[table] ?? DrizzleTableRegistry.get(table)
    if (!schema) {
      throw new Error(
        `[BoostKit ORM Drizzle] No table schema registered for "${table}". ` +
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
