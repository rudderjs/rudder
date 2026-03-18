import {
  eq, ne, gt, gte, lt, lte, like, inArray, notInArray,
  and, asc, desc, count as sqlCount,
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
    private readonly db:         unknown,
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

  private buildConditions(): unknown | undefined {
    if (!this._wheres.length) return undefined

    const exprs = this._wheres.map(clause => {
      const col = this.col(clause.column)
      switch (clause.operator) {
        case '=':      return eq(col as any, clause.value)
        case '!=':     return ne(col as any, clause.value)
        case '>':      return gt(col as any, clause.value)
        case '>=':     return gte(col as any, clause.value)
        case '<':      return lt(col as any, clause.value)
        case '<=':     return lte(col as any, clause.value)
        case 'LIKE':   return like(col as any, clause.value as string)
        case 'IN':     return inArray(col as any, clause.value as unknown[])
        case 'NOT IN': return notInArray(col as any, clause.value as unknown[])
      }
    })

    return exprs.length === 1 ? exprs[0] : and(...(exprs as any[]))
  }

  private buildOrderBy(): unknown[] {
    return this._orders.map(o => {
      const col = this.col(o.column)
      return o.direction === 'DESC' ? desc(col as any) : asc(col as any)
    })
  }

  async first(): Promise<T | null> {
    const db      = this.db as any
    const cond    = this.buildConditions()
    const orderBy = this.buildOrderBy()

    let q = db.select().from(this.table)
    if (cond)        q = q.where(cond)
    if (orderBy.length) q = q.orderBy(...orderBy)
    q = q.limit(1)

    const result: T[] = await q
    return result[0] ?? null
  }

  async find(id: number | string): Promise<T | null> {
    const db     = this.db as any
    const pkCol  = this.col(this.primaryKey)
    const result: T[] = await db
      .select()
      .from(this.table)
      .where(eq(pkCol as any, id))
      .limit(1)
    return result[0] ?? null
  }

  async get(): Promise<T[]> {
    const db      = this.db as any
    const cond    = this.buildConditions()
    const orderBy = this.buildOrderBy()

    let q = db.select().from(this.table)
    if (cond)           q = q.where(cond)
    if (orderBy.length) q = q.orderBy(...orderBy)
    if (this._limitN  !== null) q = q.limit(this._limitN)
    if (this._offsetN !== null) q = q.offset(this._offsetN)

    return q as Promise<T[]>
  }

  async all(): Promise<T[]> {
    return (this.db as any).select().from(this.table) as Promise<T[]>
  }

  async count(): Promise<number> {
    const db   = this.db as any
    const cond = this.buildConditions()

    let q = db.select({ value: sqlCount() }).from(this.table)
    if (cond) q = q.where(cond)

    const result: Array<{ value: number | string | bigint }> = await q
    return Number(result[0]?.value ?? 0)
  }

  async create(data: Partial<T>): Promise<T> {
    const result: T[] = await (this.db as any)
      .insert(this.table)
      .values(data)
      .returning()
    if (!result[0]) throw new Error('[BoostKit ORM Drizzle] create() returned no rows.')
    return result[0]
  }

  async update(id: number | string, data: Partial<T>): Promise<T> {
    const pkCol   = this.col(this.primaryKey)
    const result: T[] = await (this.db as any)
      .update(this.table)
      .set(data)
      .where(eq(pkCol as any, id))
      .returning()
    if (!result[0]) throw new Error('[BoostKit ORM Drizzle] update() returned no rows.')
    return result[0]
  }

  async delete(id: number | string): Promise<void> {
    const pkCol = this.col(this.primaryKey)
    await (this.db as any)
      .delete(this.table)
      .where(eq(pkCol as any, id))
  }

  async paginate(page = 1, perPage = 15): Promise<PaginatedResult<T>> {
    const cond    = this.buildConditions()
    const orderBy = this.buildOrderBy()
    const db      = this.db as any

    let pageQ = db.select().from(this.table)
    let cntQ  = db.select({ value: sqlCount() }).from(this.table)

    if (cond) {
      pageQ = pageQ.where(cond)
      cntQ  = cntQ.where(cond)
    }
    if (orderBy.length) pageQ = pageQ.orderBy(...orderBy)
    pageQ = pageQ.limit(perPage).offset((page - 1) * perPage)

    const [data, countResult]: [T[], Array<{ value: number | string | bigint }>] =
      await Promise.all([pageQ, cntQ])

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
    private readonly db:         unknown,
    private readonly tables:     Record<string, unknown>,
    private readonly primaryKey: string,
  ) {}

  static async make(config: DrizzleConfig): Promise<DrizzleAdapter> {
    let db = config.client

    if (!db) {
      const url    = config.url ?? process.env['DATABASE_URL'] ?? 'file:./dev.db'
      const driver = config.driver ?? 'sqlite'

      if (driver === 'postgresql') {
        const { default: postgres }  = await import('postgres') as any
        const { drizzle: dzPostgres } = await import('drizzle-orm/postgres-js') as any
        db = dzPostgres(postgres(url))
      } else if (driver === 'libsql') {
        const { createClient }       = await import('@libsql/client') as any
        const { drizzle: dzLibsql }  = await import('drizzle-orm/libsql') as any
        db = dzLibsql(createClient({ url }))
      } else {
        // default: SQLite via better-sqlite3
        const { default: Database }    = await import('better-sqlite3') as any
        const { drizzle: dzSqlite }    = await import('drizzle-orm/better-sqlite3') as any
        db = dzSqlite(new Database(url.replace(/^file:/, '')))
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
    const end = (this.db as any)?.$client?.end
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
