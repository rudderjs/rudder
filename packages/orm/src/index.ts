// ─── Types ─────────────────────────────────────────────────

export type WhereOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN' | 'NOT IN'

export interface WhereClause {
  column:   string
  operator: WhereOperator
  value:    unknown
}

export interface OrderClause {
  column:    string
  direction: 'ASC' | 'DESC'
}

export interface QueryState {
  wheres:  WhereClause[]
  orders:  OrderClause[]
  limitN:  number | null
  offsetN: number | null
  withs:   string[]
}

// ─── Query Builder Contract ────────────────────────────────

export interface QueryBuilder<T> {
  where(column: string, value: unknown): this
  where(column: string, operator: WhereOperator, value: unknown): this
  orWhere(column: string, value: unknown): this
  orderBy(column: string, direction?: 'ASC' | 'DESC'): this
  limit(n: number): this
  offset(n: number): this
  with(...relations: string[]): this
  first(): Promise<T | null>
  find(id: number | string): Promise<T | null>
  get(): Promise<T[]>
  all(): Promise<T[]>
  count(): Promise<number>
  create(data: Partial<T>): Promise<T>
  update(id: number | string, data: Partial<T>): Promise<T>
  delete(id: number | string): Promise<void>
  paginate(page: number, perPage?: number): Promise<PaginatedResult<T>>
}

// ─── Paginated Result ──────────────────────────────────────

export interface PaginatedResult<T> {
  data:        T[]
  total:       number
  perPage:     number
  currentPage: number
  lastPage:    number
  from:        number
  to:          number
}

// ─── Model Base Class ──────────────────────────────────────

export abstract class Model {
  /** The table name — defaults to lowercase class name + 's' */
  static table: string

  /** Primary key column */
  static primaryKey = 'id'

  /** Columns to hide from JSON output */
  static hidden: string[] = []

  /** Columns that are mass-assignable */
  static fillable: string[] = []

  /** Get the table name, auto-pluralizing if not set */
  static getTable(this: typeof Model): string {
    return this.table ?? `${this.name.toLowerCase()}s`
  }

  /** Return a query builder for this model */
  static query<T extends typeof Model>(this: T): QueryBuilder<InstanceType<T>> {
    return ModelRegistry.getAdapter().query<InstanceType<T>>(
      (this as typeof Model).getTable()
    )
  }

  private static _q<T extends typeof Model>(self: T): QueryBuilder<InstanceType<T>> {
    return ModelRegistry.getAdapter().query<InstanceType<T>>((self as typeof Model).getTable())
  }

  /** Shorthand — find by primary key */
  static find<T extends typeof Model>(this: T, id: number | string): Promise<InstanceType<T> | null> {
    return Model._q(this).find(id)
  }

  /** Shorthand — get all records */
  static all<T extends typeof Model>(this: T): Promise<InstanceType<T>[]> {
    return Model._q(this).all()
  }

  /** Shorthand — where clause */
  static where<T extends typeof Model>(this: T, column: string, value: unknown): QueryBuilder<InstanceType<T>> {
    return Model._q(this).where(column, value)
  }

  /** Shorthand — create a record */
  static create<T extends typeof Model>(this: T, data: Partial<InstanceType<T>>): Promise<InstanceType<T>> {
    return Model._q(this).create(data)
  }

  /** Shorthand — eager load relations */
  static with<T extends typeof Model>(this: T, ...relations: string[]): QueryBuilder<InstanceType<T>> {
    return Model._q(this).with(...relations)
  }

  /** Convert model to JSON, respecting hidden fields */
  toJSON(): Record<string, unknown> {
    const hidden = (this.constructor as typeof Model).hidden
    return Object.fromEntries(
      Object.entries(this).filter(([k]) => !hidden.includes(k))
    )
  }
}

// ─── ORM Adapter Contract ──────────────────────────────────

export interface OrmAdapter {
  query<T>(table: string): QueryBuilder<T>
  connect(): Promise<void>
  disconnect(): Promise<void>
}

export interface OrmAdapterProvider {
  create(): OrmAdapter | Promise<OrmAdapter>
}

// ─── Global ORM Registry ───────────────────────────────────

export class ModelRegistry {
  private static adapter: OrmAdapter | null = null

  static set(adapter: OrmAdapter): void {
    this.adapter = adapter
  }

  static get(): OrmAdapter | null {
    return this.adapter
  }

  static getAdapter(): OrmAdapter {
    if (!this.adapter) {
      throw new Error('[BoostKit ORM] No ORM adapter registered. Did you configure one in boostkit.config.ts?')
    }
    return this.adapter
  }
}