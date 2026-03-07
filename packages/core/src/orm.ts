import type { QueryBuilder, OrmAdapter } from '@boostkit/contracts'

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
      throw new Error('[BoostKit ORM] No ORM adapter registered. Did you add a database provider to your providers list?')
    }
    return this.adapter
  }
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

  static find<T extends typeof Model>(this: T, id: number | string): Promise<InstanceType<T> | null> {
    return Model._q(this).find(id)
  }

  static all<T extends typeof Model>(this: T): Promise<InstanceType<T>[]> {
    return Model._q(this).all()
  }

  static where<T extends typeof Model>(this: T, column: string, value: unknown): QueryBuilder<InstanceType<T>> {
    return Model._q(this).where(column, value)
  }

  static create<T extends typeof Model>(this: T, data: Partial<InstanceType<T>>): Promise<InstanceType<T>> {
    return Model._q(this).create(data)
  }

  static with<T extends typeof Model>(this: T, ...relations: string[]): QueryBuilder<InstanceType<T>> {
    return Model._q(this).with(...relations)
  }

  toJSON(): Record<string, unknown> {
    const hidden = (this.constructor as typeof Model).hidden
    return Object.fromEntries(
      Object.entries(this).filter(([k]) => !hidden.includes(k))
    )
  }
}
