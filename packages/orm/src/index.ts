import type { QueryBuilder, OrmAdapter } from '@rudderjs/contracts'

export type { QueryBuilder, OrmAdapter, OrmAdapterProvider, PaginatedResult, WhereOperator, WhereClause, OrderClause, QueryState } from '@rudderjs/contracts'

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
      throw new Error('[RudderJS ORM] No ORM adapter registered. Did you add a database provider to your providers list?')
    }
    return this.adapter
  }

  static reset(): void {
    this.adapter = null
  }
}

// ─── Observer Types ─────────────────────────────────────────

export type ModelEvent = 'creating' | 'created' | 'updating' | 'updated' | 'deleting' | 'deleted' | 'restoring' | 'restored'

export interface ModelObserver {
  creating?(data: Record<string, unknown>): Record<string, unknown> | void | Promise<Record<string, unknown> | void>
  created?(record: Record<string, unknown>): void | Promise<void>
  updating?(id: string | number, data: Record<string, unknown>): Record<string, unknown> | false | void | Promise<Record<string, unknown> | false | void>
  updated?(record: Record<string, unknown>): void | Promise<void>
  deleting?(id: string | number): false | void | Promise<false | void>
  deleted?(id: string | number): void | Promise<void>
  restoring?(id: string | number): false | void | Promise<false | void>
  restored?(record: Record<string, unknown>): void | Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScopeFn = (query: QueryBuilder<any>, ...args: any[]) => QueryBuilder<any>

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

  /**
   * Enable soft deletes for this model. When true:
   * - `delete()` sets `deletedAt` instead of removing the record
   * - Queries automatically exclude records where `deletedAt` is not null
   * - Use `withTrashed()` to include soft-deleted records
   * - Use `onlyTrashed()` to return only soft-deleted records
   * - Use `restore()` to un-delete a record
   * - Use `forceDelete()` to permanently remove a record
   */
  static softDeletes = false

  // ── Scopes ─────────────────────────────────────────────

  /**
   * Global scopes — automatically applied to every query on this model.
   * Override in subclass. Use `withoutGlobalScope('name')` to bypass.
   *
   * @example
   * static globalScopes = {
   *   ordered: (q) => q.orderBy('createdAt', 'DESC'),
   *   active: (q) => q.where('active', true),
   * }
   */
  static globalScopes: Record<string, ScopeFn> = {}

  /**
   * Local scopes — reusable query fragments applied via `.scope('name')`.
   * Override in subclass.
   *
   * @example
   * static scopes = {
   *   published: (q) => q.where('draftStatus', 'published'),
   *   recent: (q) => q.where('createdAt', '>', new Date(Date.now() - 30 * 86400000).toISOString()),
   *   byAuthor: (q, authorId: string) => q.where('authorId', authorId),
   * }
   *
   * // Usage:
   * Article.query().scope('published').scope('recent').get()
   * Article.query().scope('byAuthor', userId).get()
   */
  static scopes: Record<string, ScopeFn> = {}

  // ── Observers ──────────────────────────────────────────

  /** @internal — registered observer instances */
  private static _observers: ModelObserver[] = []

  /** @internal — registered inline event listeners */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static _listeners: Map<ModelEvent, Array<(...args: any[]) => any>> = new Map()

  /**
   * Register an observer class. All matching lifecycle methods will be called.
   *
   * @example
   * class ArticleObserver {
   *   creating(data) { data.slug = slugify(data.title); return data }
   *   created(record) { console.log('Created:', record.id) }
   * }
   * Article.observe(ArticleObserver)
   */
  static observe(ObserverClass: new () => ModelObserver): void {
    // Each subclass needs its own observer array
    if (!Object.prototype.hasOwnProperty.call(this, '_observers')) {
      this._observers = []
    }
    this._observers.push(new ObserverClass())
  }

  /**
   * Register an inline event listener.
   *
   * @example
   * Article.on('creating', (data) => { data.slug = slugify(data.title); return data })
   * Article.on('deleting', (id) => { if (id === protectedId) return false })
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static on(event: ModelEvent, handler: (...args: any[]) => any): void {
    if (!Object.prototype.hasOwnProperty.call(this, '_listeners')) {
      this._listeners = new Map()
    }
    const list = this._listeners.get(event) ?? []
    list.push(handler)
    this._listeners.set(event, list)
  }

  /** @internal — fire an event on all observers and inline listeners. Returns transformed data or false to cancel. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static async _fireEvent(event: ModelEvent, ...args: any[]): Promise<any> {
    let result = args[0]

    // Observer methods
    const observers = Object.prototype.hasOwnProperty.call(this, '_observers') ? this._observers : []
    for (const obs of observers) {
      const method = obs[event as keyof ModelObserver] as ((...a: unknown[]) => unknown) | undefined
      if (method) {
        const ret = await method.call(obs, ...args)
        if (ret === false) return false
        if (ret !== undefined && ret !== null && typeof ret === 'object') result = ret
      }
    }

    // Inline listeners
    const listeners = Object.prototype.hasOwnProperty.call(this, '_listeners')
      ? (this._listeners.get(event) ?? [])
      : []
    for (const fn of listeners) {
      const ret = await fn(...args)
      if (ret === false) return false
      if (ret !== undefined && ret !== null && typeof ret === 'object') result = ret
    }

    return result
  }

  /** Remove all observers and listeners (for testing). */
  static clearObservers(): void {
    this._observers = []
    this._listeners = new Map()
  }

  // ── Query Methods ──────────────────────────────────────

  /** Get the table name, auto-pluralizing if not set */
  static getTable(this: typeof Model): string {
    return this.table ?? `${this.name.toLowerCase()}s`
  }

  /** Return a query builder for this model (auto-filters soft deletes, applies global scopes) */
  static query<T extends typeof Model>(this: T): QueryBuilder<InstanceType<T>> & { scope(name: string, ...args: unknown[]): QueryBuilder<InstanceType<T>>; withoutGlobalScope(name: string): QueryBuilder<InstanceType<T>> } {
    let q = ModelRegistry.getAdapter().query<InstanceType<T>>(
      (this as typeof Model).getTable()
    )
    if ((this as typeof Model).softDeletes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any)._enableSoftDeletes?.()
    }

    // Apply global scopes
    const globalScopes = (this as typeof Model).globalScopes
    const excludedScopes = new Set<string>()

    for (const [, scopeFn] of Object.entries(globalScopes)) {
      q = scopeFn(q) as QueryBuilder<InstanceType<T>>
    }

    // Attach .scope() and .withoutGlobalScope() to the query builder
    const modelClass = this as typeof Model
    const localScopes = modelClass.scopes

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enhanced = q as any
    enhanced.scope = (name: string, ...args: unknown[]) => {
      const scopeFn = localScopes[name]
      if (!scopeFn) throw new Error(`[RudderJS ORM] Scope "${name}" is not defined on ${modelClass.name}.`)
      return scopeFn(enhanced, ...args)
    }
    enhanced.withoutGlobalScope = (name: string) => {
      excludedScopes.add(name)
      // Re-build query without the excluded scope
      let rebuilt = ModelRegistry.getAdapter().query<InstanceType<T>>(modelClass.getTable())
      if (modelClass.softDeletes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rebuilt as any)._enableSoftDeletes?.()
      }
      for (const [scopeName, scopeFn] of Object.entries(globalScopes)) {
        if (!excludedScopes.has(scopeName)) {
          rebuilt = scopeFn(rebuilt) as QueryBuilder<InstanceType<T>>
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(rebuilt as any).scope = enhanced.scope
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(rebuilt as any).withoutGlobalScope = enhanced.withoutGlobalScope
      return rebuilt
    }

    return enhanced
  }

  private static _q<T extends typeof Model>(self: T): QueryBuilder<InstanceType<T>> {
    const q = ModelRegistry.getAdapter().query<InstanceType<T>>((self as typeof Model).getTable())
    if ((self as typeof Model).softDeletes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any)._enableSoftDeletes?.()
    }
    // Apply global scopes
    let result = q
    for (const [, scopeFn] of Object.entries((self as typeof Model).globalScopes)) {
      result = scopeFn(result) as QueryBuilder<InstanceType<T>>
    }
    return result
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

  static async create<T extends typeof Model>(this: T, data: Partial<InstanceType<T>>): Promise<InstanceType<T>> {
    // Fire 'creating' event — can transform data or cancel
    const self = this as typeof Model
    let payload = data as Record<string, unknown>
    const result = await self._fireEvent('creating', payload)
    if (result === false) throw new Error(`[RudderJS ORM] Create cancelled by observer on ${self.name}.`)
    if (result && typeof result === 'object') payload = result

    const record = await Model._q(this).create(payload as Partial<InstanceType<T>>)

    // Fire 'created' event
    await self._fireEvent('created', record as Record<string, unknown>)

    return record
  }

  static with<T extends typeof Model>(this: T, ...relations: string[]): QueryBuilder<InstanceType<T>> {
    return Model._q(this).with(...relations)
  }

  /** Update a record by ID. Fires 'updating' and 'updated' observer events. */
  static async update<T extends typeof Model>(this: T, id: number | string, data: Partial<InstanceType<T>>): Promise<InstanceType<T>> {
    const self = this as typeof Model
    let payload = data as Record<string, unknown>
    const result = await self._fireEvent('updating', id, payload)
    if (result === false) throw new Error(`[RudderJS ORM] Update cancelled by observer on ${self.name}.`)
    if (result && typeof result === 'object') payload = result

    const record = await Model._q(this).update(id, payload as Partial<InstanceType<T>>)

    await self._fireEvent('updated', record as Record<string, unknown>)
    return record
  }

  /** Delete a record by ID. Fires 'deleting' and 'deleted' observer events. */
  static async delete<T extends typeof Model>(this: T, id: number | string): Promise<void> {
    const self = this as typeof Model
    const result = await self._fireEvent('deleting', id)
    if (result === false) throw new Error(`[RudderJS ORM] Delete cancelled by observer on ${self.name}.`)

    await Model._q(this).delete(id)

    await self._fireEvent('deleted', id)
  }

  /** Restore a soft-deleted record by ID. */
  static async restore<T extends typeof Model>(this: T, id: number | string): Promise<InstanceType<T>> {
    const self = this as typeof Model
    const result = await self._fireEvent('restoring', id)
    if (result === false) throw new Error(`[RudderJS ORM] Restore cancelled by observer on ${self.name}.`)

    const record = await Model._q(this).restore(id)

    await self._fireEvent('restored', record as Record<string, unknown>)
    return record
  }

  /** Permanently delete a record by ID, bypassing soft deletes. */
  static async forceDelete<T extends typeof Model>(this: T, id: number | string): Promise<void> {
    const self = this as typeof Model
    const result = await self._fireEvent('deleting', id)
    if (result === false) throw new Error(`[RudderJS ORM] Delete cancelled by observer on ${self.name}.`)

    await Model._q(this).forceDelete(id)

    await self._fireEvent('deleted', id)
  }

  toJSON(): Record<string, unknown> {
    const hidden = (this.constructor as typeof Model).hidden
    return Object.fromEntries(
      Object.entries(this).filter(([k]) => !hidden.includes(k))
    )
  }
}
