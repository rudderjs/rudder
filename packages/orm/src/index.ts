import type { QueryBuilder, OrmAdapter, PaginatedResult } from '@rudderjs/contracts'
import { castGet, castSet, type CastDefinition } from './cast.js'
import { type Attribute } from './attribute.js'

export type { QueryBuilder, OrmAdapter, OrmAdapterProvider, PaginatedResult, WhereOperator, WhereClause, OrderClause, QueryState } from '@rudderjs/contracts'
export type { CastDefinition, CastUsing, BuiltInCast } from './cast.js'
export { Attribute }                               from './attribute.js'
export { JsonResource, ResourceCollection }        from './resource.js'
export { ModelCollection }                         from './collection.js'
export { ModelFactory, sequence }                  from './factory.js'

// ─── Global ORM Registry ───────────────────────────────────

export class ModelRegistry {
  private static adapter: OrmAdapter | null = null
  private static models: Map<string, typeof Model> = new Map()
  private static listeners: Set<(name: string, ModelClass: typeof Model) => void> = new Set()

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

  /**
   * Register a Model class so consumers (e.g. Telescope's model collector)
   * can discover it and attach lifecycle listeners.
   *
   * Keyed by `ModelClass.name`. Idempotent — registering the same class twice
   * is a no-op; late listeners only fire on the first registration.
   *
   * Models are also registered lazily on first query (`query()` / `find()` /
   * `all()` / etc), but eager registration in an `AppServiceProvider` lets
   * observers attach before the first request hits.
   */
  static register(ModelClass: typeof Model): void {
    const name = ModelClass.name
    if (!name || this.models.has(name)) return
    this.models.set(name, ModelClass)
    for (const listener of this.listeners) listener(name, ModelClass)
  }

  /**
   * All registered model classes, keyed by class name. Used by Telescope's
   * model collector and any code that needs to iterate discovered models.
   */
  static all(): Map<string, typeof Model> {
    return this.models
  }

  /**
   * Subscribe to model registrations. Fires once per newly registered
   * class. Returns an unsubscribe function.
   */
  static onRegister(listener: (name: string, ModelClass: typeof Model) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  static reset(): void {
    this.adapter = null
    this.models.clear()
    this.listeners.clear()
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

// ─── Decorators ────────────────────────────────────────────

/**
 * Mark an instance property as hidden from JSON output.
 * Equivalent to adding the field name to `static hidden`.
 *
 * @example
 * class User extends Model {
 *   @Hidden password = ''
 * }
 */
export function Hidden(target: object, key: string | symbol): void {
  const ctor = target.constructor as typeof Model
  if (!Object.prototype.hasOwnProperty.call(ctor, 'hidden')) {
    ctor.hidden = [...ctor.hidden]
  }
  ctor.hidden.push(String(key))
}

/**
 * Restrict JSON output to only visible properties.
 * Equivalent to setting `static visible`.
 * Applied per-field — all `@Visible` fields form the allowlist.
 *
 * @example
 * class User extends Model {
 *   @Visible id = 0
 *   @Visible name = ''
 *   password = ''   // hidden because visible list is set
 * }
 */
export function Visible(target: object, key: string | symbol): void {
  const ctor = target.constructor as typeof Model
  if (!Object.prototype.hasOwnProperty.call(ctor, 'visible')) {
    ctor.visible = []
  }
  ctor.visible.push(String(key))
}

/**
 * Always include the named accessor in JSON output.
 * The property must also be defined in `static attributes` with a getter.
 *
 * @example
 * class User extends Model {
 *   @Appends fullName = ''
 *   static attributes = {
 *     fullName: Attribute.make({ get: (_, a) => `${a['firstName']} ${a['lastName']}` }),
 *   }
 * }
 */
export function Appends(target: object, key: string | symbol): void {
  const ctor = target.constructor as typeof Model
  if (!Object.prototype.hasOwnProperty.call(ctor, 'appends')) {
    ctor.appends = [...(ctor.appends ?? [])]
  }
  ctor.appends.push(String(key))
}

/**
 * Apply a cast to an instance property.
 * Equivalent to adding the field to `static casts`.
 *
 * @example
 * class User extends Model {
 *   @Cast('boolean') isAdmin = false
 *   @Cast('date')    createdAt = new Date()
 *   @Cast(MoneyCast) balance = 0
 * }
 */
export function Cast(type: CastDefinition) {
  return (target: object, key: string | symbol): void => {
    const ctor = target.constructor as typeof Model
    if (!Object.prototype.hasOwnProperty.call(ctor, 'casts')) {
      ctor.casts = { ...(ctor.casts ?? {}) }
    }
    ctor.casts[String(key)] = type
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

  /**
   * Columns to exclusively include in JSON output.
   * When set, only these columns (plus appends) appear in toJSON().
   * Takes precedence over `hidden`.
   */
  static visible: string[] = []

  /**
   * Accessor names (defined in `attributes`) to always append to JSON output.
   * The accessor must have a `get` function.
   */
  static appends: string[] = []

  /**
   * Attribute casts — map column names to their cast types.
   * Applied both when reading (toJSON) and writing (create/update).
   *
   * @example
   * static casts = {
   *   isAdmin:   'boolean',
   *   createdAt: 'date',
   *   settings:  'json',
   *   balance:   MoneyCast,  // custom cast class
   * } as const satisfies Record<string, CastDefinition>
   */
  static casts: Record<string, CastDefinition> = {}

  /**
   * Accessors and mutators using `Attribute.make({ get, set })`.
   *
   * @example
   * static attributes = {
   *   firstName: Attribute.make({ get: v => String(v).charAt(0).toUpperCase() + String(v).slice(1) }),
   *   fullName:  Attribute.make({ get: (_, attrs) => `${attrs['firstName']} ${attrs['lastName']}` }),
   *   password:  Attribute.make({ set: async v => await bcrypt.hash(String(v), 10) }),
   * }
   */
  static attributes: Record<string, Attribute> = {}

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

  // ── Instance-level serialization overrides ─────────────

  /** @internal */
  private _instanceHidden?: string[]
  /** @internal */
  private _instanceVisible?: string[]

  // ── Scopes ─────────────────────────────────────────────

  static globalScopes: Record<string, ScopeFn> = {}
  static scopes: Record<string, ScopeFn> = {}

  // ── Observers ──────────────────────────────────────────

  /** @internal */
  private static _observers: ModelObserver[] = []

  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static _listeners: Map<ModelEvent, Array<(...args: any[]) => any>> = new Map()

  static observe(ObserverClass: new () => ModelObserver): void {
    if (!Object.prototype.hasOwnProperty.call(this, '_observers')) {
      this._observers = []
    }
    this._observers.push(new ObserverClass())
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static on(event: ModelEvent, handler: (...args: any[]) => any): void {
    if (!Object.prototype.hasOwnProperty.call(this, '_listeners')) {
      this._listeners = new Map()
    }
    const list = this._listeners.get(event) ?? []
    list.push(handler)
    this._listeners.set(event, list)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static async _fireEvent(event: ModelEvent, ...args: any[]): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    let result = args[0]

    const observers = Object.prototype.hasOwnProperty.call(this, '_observers') ? this._observers : []
    for (const obs of observers) {
      const method = obs[event as keyof ModelObserver] as ((...a: unknown[]) => unknown) | undefined
      if (method) {
        const ret = await method.call(obs, ...args)
        if (ret === false) return false
        if (ret !== undefined && ret !== null && typeof ret === 'object') result = ret
      }
    }

    const listeners = Object.prototype.hasOwnProperty.call(this, '_listeners')
      ? (this._listeners.get(event) ?? [])
      : []
    for (const fn of listeners) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const ret = await fn(...args)
      if (ret === false) return false
      if (ret !== undefined && ret !== null && typeof ret === 'object') result = ret
    }

    return result
  }

  static clearObservers(): void {
    this._observers = []
    this._listeners = new Map()
  }

  // ── Query Methods ──────────────────────────────────────

  static getTable(this: typeof Model): string {
    return this.table ?? `${this.name.toLowerCase()}s`
  }

  static query<T extends typeof Model>(this: T): QueryBuilder<InstanceType<T>> & { scope(name: string, ...args: unknown[]): QueryBuilder<InstanceType<T>>; withoutGlobalScope(name: string): QueryBuilder<InstanceType<T>> } {
    ModelRegistry.register(this as unknown as typeof Model)
    let q = ModelRegistry.getAdapter().query<InstanceType<T>>(
      (this as typeof Model).getTable()
    )
    if ((this as typeof Model).softDeletes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any)._enableSoftDeletes?.()
    }

    const globalScopes = (this as typeof Model).globalScopes
    const excludedScopes = new Set<string>()

    for (const [, scopeFn] of Object.entries(globalScopes)) {
      q = scopeFn(q) as QueryBuilder<InstanceType<T>>
    }

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
    ModelRegistry.register(self as unknown as typeof Model)
    const q = ModelRegistry.getAdapter().query<InstanceType<T>>((self as typeof Model).getTable())
    if ((self as typeof Model).softDeletes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any)._enableSoftDeletes?.()
    }
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

  static first<T extends typeof Model>(this: T): Promise<InstanceType<T> | null> {
    return Model._q(this).first()
  }

  static count<T extends typeof Model>(this: T): Promise<number> {
    return Model._q(this).count()
  }

  static paginate<T extends typeof Model>(this: T, page: number, perPage?: number): Promise<PaginatedResult<InstanceType<T>>> {
    return Model._q(this).paginate(page, perPage)
  }

  static where<T extends typeof Model>(this: T, column: string, value: unknown): QueryBuilder<InstanceType<T>> {
    return Model._q(this).where(column, value)
  }

  static async create<T extends typeof Model>(this: T, data: Partial<InstanceType<T>>): Promise<InstanceType<T>> {
    const self = this as typeof Model
    let payload = self._applyMutators(data as Record<string, unknown>)
    const result = await self._fireEvent('creating', payload)
    if (result === false) throw new Error(`[RudderJS ORM] Create cancelled by observer on ${self.name}.`)
    if (result && typeof result === 'object') payload = result as Record<string, unknown>

    const record = await Model._q(this).create(payload as Partial<InstanceType<T>>)

    await self._fireEvent('created', record as Record<string, unknown>)
    return record
  }

  static with<T extends typeof Model>(this: T, ...relations: string[]): QueryBuilder<InstanceType<T>> {
    return Model._q(this).with(...relations)
  }

  static async update<T extends typeof Model>(this: T, id: number | string, data: Partial<InstanceType<T>>): Promise<InstanceType<T>> {
    const self = this as typeof Model
    let payload = self._applyMutators(data as Record<string, unknown>)
    const result = await self._fireEvent('updating', id, payload)
    if (result === false) throw new Error(`[RudderJS ORM] Update cancelled by observer on ${self.name}.`)
    if (result && typeof result === 'object') payload = result as Record<string, unknown>

    const record = await Model._q(this).update(id, payload as Partial<InstanceType<T>>)

    await self._fireEvent('updated', record as Record<string, unknown>)
    return record
  }

  static async delete<T extends typeof Model>(this: T, id: number | string): Promise<void> {
    const self = this as typeof Model
    const result = await self._fireEvent('deleting', id)
    if (result === false) throw new Error(`[RudderJS ORM] Delete cancelled by observer on ${self.name}.`)

    await Model._q(this).delete(id)
    await self._fireEvent('deleted', id)
  }

  static async restore<T extends typeof Model>(this: T, id: number | string): Promise<InstanceType<T>> {
    const self = this as typeof Model
    const result = await self._fireEvent('restoring', id)
    if (result === false) throw new Error(`[RudderJS ORM] Restore cancelled by observer on ${self.name}.`)

    const record = await Model._q(this).restore(id)
    await self._fireEvent('restored', record as Record<string, unknown>)
    return record
  }

  static async forceDelete<T extends typeof Model>(this: T, id: number | string): Promise<void> {
    const self = this as typeof Model
    const result = await self._fireEvent('deleting', id)
    if (result === false) throw new Error(`[RudderJS ORM] Delete cancelled by observer on ${self.name}.`)

    await Model._q(this).forceDelete(id)
    await self._fireEvent('deleted', id)
  }

  // ── Cast / Mutator helpers ─────────────────────────────

  /** @internal — apply cast setters and attribute mutators to an incoming data payload */
  private static _applyMutators(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(data)) {
      let val = value

      // Attribute mutator (set side) takes priority
      const attrDef = this.attributes[key]
      if (attrDef?.setter) {
        val = attrDef.setter(val, data)
      } else if (this.casts[key] !== undefined) {
        val = castSet(this.casts[key] as string, key, val, data)
      }

      result[key] = val
    }

    return result
  }

  // ── Instance serialization controls ───────────────────

  /**
   * Make the given keys visible for this instance's JSON output.
   * Removes them from the instance's hidden list and adds to the visible override.
   * Returns `this` for chaining.
   */
  makeVisible(keys: string | string[]): this {
    const k = Array.isArray(keys) ? keys : [keys]
    this._instanceHidden = (this._instanceHidden ?? (this.constructor as typeof Model).hidden)
      .filter(h => !k.includes(h))
    return this
  }

  /**
   * Hide the given keys from this instance's JSON output.
   * Returns `this` for chaining.
   */
  makeHidden(keys: string | string[]): this {
    const k = Array.isArray(keys) ? keys : [keys]
    this._instanceHidden = [...(this._instanceHidden ?? (this.constructor as typeof Model).hidden), ...k]
    return this
  }

  /**
   * Override the visible list for this instance only.
   * Returns `this` for chaining.
   */
  setVisible(keys: string[]): this {
    this._instanceVisible = keys
    return this
  }

  /**
   * Override the hidden list for this instance only.
   * Returns `this` for chaining.
   */
  setHidden(keys: string[]): this {
    this._instanceHidden = keys
    return this
  }

  /**
   * Add keys to the visible list for this instance.
   * Returns `this` for chaining.
   */
  mergeVisible(keys: string[]): this {
    const base = this._instanceVisible ?? (this.constructor as typeof Model).visible
    this._instanceVisible = [...base, ...keys]
    return this
  }

  /**
   * Add keys to the hidden list for this instance.
   * Returns `this` for chaining.
   */
  mergeHidden(keys: string[]): this {
    const base = this._instanceHidden ?? (this.constructor as typeof Model).hidden
    this._instanceHidden = [...base, ...keys]
    return this
  }

  // ── toJSON ─────────────────────────────────────────────

  toJSON(): Record<string, unknown> {
    const ctor        = this.constructor as typeof Model
    const rawEntries  = Object.entries(this).filter(([k]) => !k.startsWith('_instance'))

    const raw: Record<string, unknown> = {}
    for (const [k, v] of rawEntries) {
      raw[k] = v
    }

    const result: Record<string, unknown> = {}

    // Apply casts (get side) and accessor getters
    for (const [k, v] of Object.entries(raw)) {
      const attrDef = ctor.attributes[k]
      if (attrDef?.getter) {
        result[k] = attrDef.getter(v, raw)
      } else if (ctor.casts[k] !== undefined) {
        result[k] = castGet(ctor.casts[k] as string, k, v, raw)
      } else {
        result[k] = v
      }
    }

    // Appends — add computed accessor values that aren't raw properties
    for (const appendKey of ctor.appends) {
      if (!(appendKey in result)) {
        const attrDef = ctor.attributes[appendKey]
        if (attrDef?.getter) {
          result[appendKey] = attrDef.getter(undefined, raw)
        }
      }
    }

    // Determine effective visible / hidden lists
    const effectiveVisible = this._instanceVisible ?? ctor.visible
    const effectiveHidden  = this._instanceHidden  ?? ctor.hidden

    // Apply visible (allowlist) — takes precedence
    if (effectiveVisible.length > 0) {
      const appendKeys = new Set(ctor.appends)
      return Object.fromEntries(
        Object.entries(result).filter(([k]) => effectiveVisible.includes(k) || appendKeys.has(k))
      )
    }

    // Apply hidden (denylist)
    return Object.fromEntries(
      Object.entries(result).filter(([k]) => !effectiveHidden.includes(k))
    )
  }
}
