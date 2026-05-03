import type { QueryBuilder, OrmAdapter, PaginatedResult, ModelLike } from '@rudderjs/contracts'
import { castGet, castSet, type CastDefinition } from './cast.js'
import { type Attribute } from './attribute.js'

export type { QueryBuilder, OrmAdapter, OrmAdapterProvider, PaginatedResult, WhereOperator, WhereClause, OrderClause, QueryState } from '@rudderjs/contracts'
export type { CastDefinition, CastUsing, BuiltInCast } from './cast.js'
export { Attribute }                               from './attribute.js'
export { JsonResource, ResourceCollection }        from './resource.js'
export { ModelCollection }                         from './collection.js'
export { ModelFactory, sequence }                  from './factory.js'
export { Seeder }                                  from './seeder.js'
export type { SeederConstructor }                  from './seeder.js'

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
    _installBelongsToManyMethods(ModelClass)
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

// ─── Errors ────────────────────────────────────────────────

/**
 * Thrown by `Model.findOrFail()` and `Model.firstOrFail()` when no record matches.
 * Apps can catch this to render a custom 404, or let it bubble — `@rudderjs/core`
 * picks up the duck-typed `httpStatus` and renders an HTTP 404 by default.
 */
export class ModelNotFoundError extends Error {
  readonly model: string
  readonly id?: string | number

  /** Duck-typed signal to `@rudderjs/core`'s exception handler. */
  readonly httpStatus = 404

  constructor(model: string, id?: string | number) {
    super(id !== undefined
      ? `[RudderJS ORM] No ${model} found for id ${String(id)}.`
      : `[RudderJS ORM] No ${model} found.`)
    this.name = 'ModelNotFoundError'
    this.model = model
    if (id !== undefined) this.id = id
  }
}

// ─── Observer Types ─────────────────────────────────────────

export type ModelEvent =
  | 'retrieved'
  | 'creating' | 'created'
  | 'updating' | 'updated'
  | 'saving'   | 'saved'
  | 'deleting' | 'deleted'
  | 'restoring' | 'restored'

export interface ModelObserver {
  /** Fired after a record is loaded from the database (find/first/all/get). */
  retrieved?(record: Record<string, unknown>): void | Promise<void>
  creating?(data: Record<string, unknown>): Record<string, unknown> | void | Promise<Record<string, unknown> | void>
  created?(record: Record<string, unknown>): void | Promise<void>
  updating?(id: string | number, data: Record<string, unknown>): Record<string, unknown> | false | void | Promise<Record<string, unknown> | false | void>
  updated?(record: Record<string, unknown>): void | Promise<void>
  /** Fired before BOTH creating and updating, after the per-event handler. */
  saving?(data: Record<string, unknown>): Record<string, unknown> | void | Promise<Record<string, unknown> | void>
  /** Fired after BOTH created and updated. */
  saved?(record: Record<string, unknown>): void | Promise<void>
  deleting?(id: string | number): false | void | Promise<false | void>
  deleted?(id: string | number): void | Promise<void>
  restoring?(id: string | number): false | void | Promise<false | void>
  restored?(record: Record<string, unknown>): void | Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScopeFn = (query: QueryBuilder<any>, ...args: any[]) => QueryBuilder<any>

// ─── Relations ─────────────────────────────────────────────

/**
 * Thin relation declaration consumed by {@link Model.related}.
 *
 * Lazy `model: () => SomeModel` avoids circular imports — relation declarations
 * sit on each side of the relationship and would otherwise need to reference
 * each other at module evaluation time.
 *
 * - `hasMany` / `hasOne`: parent owns the foreign key on the related table.
 *   `foreignKey` is the column on the *related* table pointing back to the
 *   parent's primary key. Defaults to `<parentClassName>Id` (camelCased), e.g.
 *   `userId` for a `User`.
 * - `belongsTo`: this model carries the foreign key. `foreignKey` is the column
 *   on *this* model holding the related row's primary key. Defaults to
 *   `<relatedClassName>Id`, e.g. `teamId` for `team: belongsTo(Team)`.
 *
 * `localKey` lets you override the column resolved on the parent side (the
 * primary key by default for has*, or the foreign key for belongsTo).
 *
 * `belongsToMany` declares a many-to-many relation through a pivot table.
 * `pivotTable` is required; the two pivot keys default to camelCase of each
 * side's class name + `Id` (`User` ⇄ `Role` → `userId` / `roleId`). Reads
 * route through `Model.related(name)` returning a chainable QueryBuilder on
 * the related model; pivot mutations (`attach` / `detach` / `sync`) live on
 * the per-relation accessor (`user.roles().attach([1,2])`) — see
 * {@link Model.belongsToMany}.
 */
export type RelationDefinition =
  | {
      type:        'hasOne' | 'hasMany' | 'belongsTo'
      /** Lazy reference to the related model class — avoids circular imports. */
      model:       () => typeof Model
      /** Foreign-key column. Defaults are described in the interface comment. */
      foreignKey?: string
      /** Override the local column joined against `foreignKey`. */
      localKey?:   string
    }
  | {
      type:             'belongsToMany'
      /** Lazy reference to the related model class — avoids circular imports. */
      model:            () => typeof Model
      /** Pivot table name — required. Conventionally `<a>_<b>` alphabetical. */
      pivotTable:       string
      /** Pivot column pointing at the parent. Default: `${camelCase(thisClass)}Id`. */
      foreignPivotKey?: string
      /** Pivot column pointing at the related row. Default: `${camelCase(relatedClass)}Id`. */
      relatedPivotKey?: string
      /** Column on the parent model joined against `foreignPivotKey`. Default: `primaryKey`. */
      parentKey?:       string
      /** Column on the related model joined against `relatedPivotKey`. Default: `Related.primaryKey`. */
      relatedKey?:      string
    }

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

  /**
   * Column used to resolve a route parameter into a Model instance via
   * {@link Model.findForRoute}. Defaults to the primary key. Override to
   * resolve by slug, uuid, or any other unique column:
   *
   * ```ts
   * class Post extends Model {
   *   static override routeKey = 'slug'
   * }
   * ```
   *
   * Then in `routes/web.ts`:
   *
   * ```ts
   * router.bind('post', Post)
   * router.get('/posts/:post', (req) => req.bound['post'])
   * ```
   */
  static routeKey = 'id'

  /**
   * Resolve a route parameter value into a Model instance.
   *
   * Default implementation runs `Model.where(routeKey, value).first()`. Override
   * on a subclass to apply additional constraints (auth scope, soft-delete
   * behavior, etc.):
   *
   * ```ts
   * static override async findForRoute(value: string) {
   *   return await this.where('slug', value)
   *     .where('publishedAt', '!=', null)
   *     .first()
   * }
   * ```
   *
   * Returns `null` when no record matches; the router translates that into a
   * `RouteModelNotFoundError` (HTTP 404) for required bindings.
   *
   * The return type is `Model | null` rather than the generic `InstanceType<T>`
   * so subclass overrides can narrow it without violating variance under
   * `exactOptionalPropertyTypes`.
   */
  static async findForRoute(value: string): Promise<Model | null> {
    return Model._q(this as unknown as typeof Model).where(this.routeKey, value).first() as Promise<Model | null>
  }

  /**
   * Relation map — a thin declaration of how each named relation joins to the
   * owner model. Used by {@link Model.related} (instance) and {@link Model.with}.
   *
   * **This is not a substitute for the adapter's relation engine.** Prisma's
   * `include` and Drizzle's `with()` already handle eager loading, joins, and
   * type inference. The relation map exists for the *fluent lazy-fetch* case —
   * `await user.related('posts').where('published', true).get()` — where you
   * want a chainable QueryBuilder scoped to the parent record.
   *
   * Supported types: `hasMany`, `hasOne`, `belongsTo`, `belongsToMany`.
   * Polymorphic relations are intentionally out of scope — reach for the
   * adapter directly when you need them.
   *
   * For `belongsToMany`, pivot mutations (`attach` / `detach` / `sync`) live
   * on a separate accessor — see {@link Model.belongsToMany}. `related()`
   * returns the related rows already filtered through the pivot, so callers
   * can chain `where`/`orderBy`/`paginate` without seeing the pivot.
   *
   * @example
   * class User extends Model {
   *   static override relations = {
   *     posts: { type: 'hasMany',       model: () => Post,    foreignKey: 'authorId' },
   *     team:  { type: 'belongsTo',     model: () => Team,    foreignKey: 'teamId' },
   *     phone: { type: 'hasOne',        model: () => Phone,   foreignKey: 'userId' },
   *     roles: { type: 'belongsToMany', model: () => Role,    pivotTable: 'role_user' },
   *   } as const
   * }
   *
   * const user = await User.find(1)
   * await user!.related('posts').where('published', true).get()
   * await user!.related('roles').orderBy('name').get()
   * await user!.roles().attach([1, 2, 3])
   */
  static relations: Record<string, RelationDefinition> = {}

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

  /**
   * Columns that are mass-assignable via `Model.create()`, `Model.update()`,
   * and `instance.fill()`. When non-empty, this is an allowlist — any other
   * key in the incoming payload is silently dropped.
   *
   * Empty `fillable` + empty `guarded` (the default) means no enforcement —
   * every key is passed through. Setting either opts in to mass-assignment
   * protection.
   *
   * `instance.forceFill(data)` and direct property assignment + `save()`
   * bypass this allowlist.
   */
  static fillable: string[] = []

  /**
   * Columns that are NOT mass-assignable. Pass `['*']` to forbid all keys
   * (the most restrictive setting — combine with `fillable` to allow specific
   * exceptions, or use `forceFill()` to bypass).
   *
   * `fillable` (when non-empty) takes precedence over `guarded`.
   */
  static guarded: string[] = []

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
  //
  // True ECMAScript private fields (`#`) so they don't appear in
  // `Object.entries(this)` / object spread / `JSON.stringify` — keeps
  // hydrated instances clean wire-format equivalents of plain records.

  /** @internal */
  #instanceHidden?: string[]
  /** @internal */
  #instanceVisible?: string[]

  // ── Scopes ─────────────────────────────────────────────

  static globalScopes: Record<string, ScopeFn> = {}
  static scopes: Record<string, ScopeFn> = {}

  // ── Observers ──────────────────────────────────────────

  /** @internal */
  private static _observers: ModelObserver[] = []

  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static _listeners: Map<ModelEvent, Array<(...args: any[]) => any>> = new Map()

  /** @internal — true while a withoutEvents() block is active for this class. */
  private static _eventsMuted = false

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
    if (Object.prototype.hasOwnProperty.call(this, '_eventsMuted') && this._eventsMuted) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return args[0]
    }

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
    if (this.table) return this.table
    const name = this.name.toLowerCase()
    // basic English pluralization for table name inference
    if (/[^aeiou]y$/.test(name)) return name.slice(0, -1) + 'ies'
    if (/(?:s|x|z|ch|sh)$/.test(name)) return name + 'es'
    return name + 's'
  }

  /**
   * Build a Model instance from a plain database record.
   *
   * The returned object is `instanceof <ModelClass>`, has the model's
   * prototype methods (`save`, `fill`, `refresh`, `delete`, etc.), and
   * carries every column from `record` as an enumerable own property.
   *
   * Idempotent: passing an already-hydrated instance of the same class
   * returns it unchanged. Passing `null`/`undefined` returns `null`.
   *
   * Most callers don't need to invoke this directly — query results
   * (`find`, `first`, `all`, `paginate`, `where().get()`, etc.) are
   * hydrated automatically. Use it when you have a raw record from
   * outside the ORM (e.g. cached JSON, a fixture file) and want a
   * working Model instance.
   */
  static hydrate<T extends typeof Model>(this: T, record: unknown): InstanceType<T> | null {
    if (record === null || record === undefined) return null
    if (record instanceof Model && record.constructor === this) return record as InstanceType<T>
    const Ctor = this as unknown as new () => InstanceType<T>
    const instance = new Ctor()
    Object.assign(instance, record)
    return instance
  }

  /** @internal — wrap a QueryBuilder so its read methods return Model instances. */
  private static _hydratingQb<T extends typeof Model>(self: T, qb: QueryBuilder<InstanceType<T>>): QueryBuilder<InstanceType<T>> {
    const ModelClass  = self as typeof Model
    const wrap        = (r: unknown): InstanceType<T> => ModelClass.hydrate.call(self, r) as InstanceType<T>
    const wrapMaybe   = (r: unknown): InstanceType<T> | null => r == null ? null : wrap(r)
    const wrapMany    = (rs: unknown[]): InstanceType<T>[]  => rs.map(wrap)

    const proxy: QueryBuilder<InstanceType<T>> = new Proxy(qb as object, {
      get(target, prop, receiver): unknown {
        const value = Reflect.get(target, prop, receiver) as unknown
        if (typeof value !== 'function') return value

        switch (prop) {
          case 'find':
            return async (id: number | string): Promise<InstanceType<T> | null> =>
              wrapMaybe(await (target as QueryBuilder<InstanceType<T>>).find(id))
          case 'first':
            return async (): Promise<InstanceType<T> | null> =>
              wrapMaybe(await (target as QueryBuilder<InstanceType<T>>).first())
          case 'get':
            return async (): Promise<InstanceType<T>[]> =>
              wrapMany(await (target as QueryBuilder<InstanceType<T>>).get())
          case 'all':
            return async (): Promise<InstanceType<T>[]> =>
              wrapMany(await (target as QueryBuilder<InstanceType<T>>).all())
          case 'paginate':
            return async (page?: number, perPage?: number): Promise<PaginatedResult<InstanceType<T>>> => {
              const r = await (target as QueryBuilder<InstanceType<T>>).paginate(page ?? 1, perPage)
              return { ...r, data: wrapMany(r.data) }
            }
          case 'create':
            return async (data: Partial<InstanceType<T>>): Promise<InstanceType<T>> =>
              wrap(await (target as QueryBuilder<InstanceType<T>>).create(data))
          case 'update':
            return async (id: number | string, data: Partial<InstanceType<T>>): Promise<InstanceType<T>> =>
              wrap(await (target as QueryBuilder<InstanceType<T>>).update(id, data))
          case 'restore':
            return async (id: number | string): Promise<InstanceType<T>> =>
              wrap(await (target as QueryBuilder<InstanceType<T>>).restore(id))
          case 'increment':
            return async (id: number | string, column: string, amount?: number, extra?: Record<string, unknown>): Promise<InstanceType<T>> =>
              wrap(await (target as QueryBuilder<InstanceType<T>>).increment(id, column, amount, extra))
          case 'decrement':
            return async (id: number | string, column: string, amount?: number, extra?: Record<string, unknown>): Promise<InstanceType<T>> =>
              wrap(await (target as QueryBuilder<InstanceType<T>>).decrement(id, column, amount, extra))
          default:
            // Chainable methods (where/orderBy/with/...) typically return `target` —
            // re-wrap so `Model.where('a', 1).first()` keeps hydrating.
            return (...args: unknown[]): unknown => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
              const result = (value as (...a: unknown[]) => unknown).apply(target, args)
              return result === target ? proxy : result
            }
        }
      },
    }) as QueryBuilder<InstanceType<T>>

    return proxy
  }

  static query<T extends typeof Model>(this: T): QueryBuilder<InstanceType<T>> & { scope(name: string, ...args: unknown[]): QueryBuilder<InstanceType<T>>; withoutGlobalScope(name: string): QueryBuilder<InstanceType<T>> } {
    ModelRegistry.register(this as unknown as typeof Model)
    const modelClass = this as typeof Model
    const localScopes = modelClass.scopes
    const globalScopes = modelClass.globalScopes
    const excludedScopes = new Set<string>()

    const buildScoped = (): QueryBuilder<InstanceType<T>> => {
      let raw = ModelRegistry.getAdapter().query<InstanceType<T>>(modelClass.getTable())
      if (modelClass.softDeletes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (raw as any)._enableSoftDeletes?.()
      }
      for (const [scopeName, scopeFn] of Object.entries(globalScopes)) {
        if (!excludedScopes.has(scopeName)) {
          raw = scopeFn(raw) as QueryBuilder<InstanceType<T>>
        }
      }
      return Model._hydratingQb(this, raw)
    }

    const enhance = (q: QueryBuilder<InstanceType<T>>): QueryBuilder<InstanceType<T>> & { scope(name: string, ...args: unknown[]): QueryBuilder<InstanceType<T>>; withoutGlobalScope(name: string): QueryBuilder<InstanceType<T>> } => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enhanced = q as any
      enhanced.scope = (name: string, ...args: unknown[]) => {
        const scopeFn = localScopes[name]
        if (!scopeFn) throw new Error(`[RudderJS ORM] Scope "${name}" is not defined on ${modelClass.name}.`)
        return scopeFn(enhanced, ...args)
      }
      enhanced.withoutGlobalScope = (name: string) => {
        excludedScopes.add(name)
        return enhance(buildScoped())
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return enhanced
    }

    return enhance(buildScoped())
  }

  private static _q<T extends typeof Model>(self: T): QueryBuilder<InstanceType<T>> {
    ModelRegistry.register(self as unknown as typeof Model)
    const ModelClass = self as typeof Model
    let q = ModelRegistry.getAdapter().query<InstanceType<T>>(ModelClass.getTable())
    if (ModelClass.softDeletes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any)._enableSoftDeletes?.()
    }
    for (const [, scopeFn] of Object.entries(ModelClass.globalScopes)) {
      q = scopeFn(q) as QueryBuilder<InstanceType<T>>
    }
    return Model._hydratingQb(self, q)
  }

  static async find<T extends typeof Model>(this: T, id: number | string): Promise<InstanceType<T> | null> {
    const self = this as typeof Model
    const record = await Model._q(this).find(id)
    if (record) await self._fireEvent('retrieved', record as Record<string, unknown>)
    return record
  }

  /** Like `find()`, but throws `ModelNotFoundError` if no record matches. */
  static async findOrFail<T extends typeof Model>(this: T, id: number | string): Promise<InstanceType<T>> {
    const record = await (this as T & typeof Model).find(id)
    if (!record) throw new ModelNotFoundError((this as typeof Model).name, id)
    return record
  }

  static async all<T extends typeof Model>(this: T): Promise<InstanceType<T>[]> {
    const self = this as typeof Model
    const records = await Model._q(this).all()
    for (const r of records) await self._fireEvent('retrieved', r as Record<string, unknown>)
    return records
  }

  static async first<T extends typeof Model>(this: T): Promise<InstanceType<T> | null> {
    const self = this as typeof Model
    const record = await Model._q(this).first()
    if (record) await self._fireEvent('retrieved', record as Record<string, unknown>)
    return record
  }

  /** Like `first()`, but throws `ModelNotFoundError` if no record matches. */
  static async firstOrFail<T extends typeof Model>(this: T): Promise<InstanceType<T>> {
    const record = await (this as T & typeof Model).first()
    if (!record) throw new ModelNotFoundError((this as typeof Model).name)
    return record
  }

  static count<T extends typeof Model>(this: T): Promise<number> {
    return Model._q(this).count()
  }

  static async paginate<T extends typeof Model>(this: T, page: number, perPage?: number): Promise<PaginatedResult<InstanceType<T>>> {
    const self = this as typeof Model
    const result = await Model._q(this).paginate(page, perPage)
    for (const r of result.data) await self._fireEvent('retrieved', r as Record<string, unknown>)
    return result
  }

  static where<T extends typeof Model>(this: T, column: string, value: unknown): QueryBuilder<InstanceType<T>> {
    return Model._q(this).where(column, value)
  }

  /**
   * Find a record by attributes; if none exists, create one with `attrs` merged with `values`.
   * Returns the existing or newly-created record.
   */
  static async firstOrCreate<T extends typeof Model>(
    this: T,
    attrs: Partial<InstanceType<T>>,
    values: Partial<InstanceType<T>> = {},
  ): Promise<InstanceType<T>> {
    const self = this as typeof Model
    let q: QueryBuilder<InstanceType<T>> = Model._q(this)
    for (const [col, val] of Object.entries(attrs)) {
      q = q.where(col, val)
    }
    const existing = await q.first()
    if (existing) {
      await self._fireEvent('retrieved', existing as Record<string, unknown>)
      return existing
    }
    return (this as T & typeof Model).create({ ...attrs, ...values } as Partial<InstanceType<T>>)
  }

  /**
   * Find a record by attributes; if found, update it with `values`. If not, create it
   * with `attrs` merged with `values`. Returns the upserted record.
   */
  static async updateOrCreate<T extends typeof Model>(
    this: T,
    attrs: Partial<InstanceType<T>>,
    values: Partial<InstanceType<T>>,
  ): Promise<InstanceType<T>> {
    const self = this as typeof Model
    let q: QueryBuilder<InstanceType<T>> = Model._q(this)
    for (const [col, val] of Object.entries(attrs)) {
      q = q.where(col, val)
    }
    const existing = await q.first() as (InstanceType<T> & Record<string, unknown>) | null
    if (existing) {
      const id = existing[self.primaryKey] as string | number
      return (this as T & typeof Model).update(id, values)
    }
    return (this as T & typeof Model).create({ ...attrs, ...values } as Partial<InstanceType<T>>)
  }

  /**
   * Run `fn` with all observer / listener firing muted for this model class.
   * Useful for bulk seeding or tests where lifecycle hooks would interfere.
   */
  static async withoutEvents<T>(this: typeof Model, fn: () => T | Promise<T>): Promise<T> {
    const previous = Object.prototype.hasOwnProperty.call(this, '_eventsMuted') ? this._eventsMuted : false
    this._eventsMuted = true
    try {
      return await fn()
    } finally {
      this._eventsMuted = previous
    }
  }

  /**
   * @internal — true when `key` is mass-assignable under this class's
   * `fillable` / `guarded` configuration.
   *
   * Rules (mirrors Laravel Eloquent):
   *   1. Both `fillable` and `guarded` empty → all keys pass (no enforcement).
   *   2. `fillable` non-empty → allowlist; any key outside it is rejected.
   *   3. Otherwise `guarded` applies; `['*']` rejects everything; specific keys reject only those.
   */
  private static _isFillable(key: string): boolean {
    if (this.fillable.length === 0 && this.guarded.length === 0) return true
    if (this.fillable.length > 0) return this.fillable.includes(key)
    if (this.guarded.includes('*')) return false
    return !this.guarded.includes(key)
  }

  /**
   * @internal — drop keys that are not mass-assignable. When neither
   * `fillable` nor `guarded` is set, the input is returned unchanged.
   */
  private static _filterFillable(data: Record<string, unknown>): Record<string, unknown> {
    if (this.fillable.length === 0 && this.guarded.length === 0) return data
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      if (this._isFillable(k)) out[k] = v
    }
    return out
  }

  static async create<T extends typeof Model>(this: T, data: Partial<InstanceType<T>>): Promise<InstanceType<T>> {
    const self = this as typeof Model
    const filtered = self._filterFillable(data as Record<string, unknown>)
    return Model._doCreate.call(this, filtered) as Promise<InstanceType<T>>
  }

  /** @internal — create path that skips the fillable filter. Used by `save()`. */
  private static async _doCreate<T extends typeof Model>(this: T, data: Record<string, unknown>): Promise<InstanceType<T>> {
    const self = this as typeof Model
    let payload = self._applyMutators(data)

    const creatingResult = await self._fireEvent('creating', payload)
    if (creatingResult === false) throw new Error(`[RudderJS ORM] Create cancelled by observer on ${self.name}.`)
    if (creatingResult && typeof creatingResult === 'object') payload = creatingResult as Record<string, unknown>

    const savingResult = await self._fireEvent('saving', payload)
    if (savingResult === false) throw new Error(`[RudderJS ORM] Create cancelled by saving observer on ${self.name}.`)
    if (savingResult && typeof savingResult === 'object') payload = savingResult as Record<string, unknown>

    const record = await Model._q(this).create(payload as Partial<InstanceType<T>>)

    await self._fireEvent('created', record as Record<string, unknown>)
    await self._fireEvent('saved',   record as Record<string, unknown>)
    return record
  }

  static with<T extends typeof Model>(this: T, ...relations: string[]): QueryBuilder<InstanceType<T>> {
    return Model._q(this).with(...relations)
  }

  static async update<T extends typeof Model>(this: T, id: number | string, data: Partial<InstanceType<T>>): Promise<InstanceType<T>> {
    const self = this as typeof Model
    const filtered = self._filterFillable(data as Record<string, unknown>)
    return Model._doUpdate.call(this, id, filtered) as Promise<InstanceType<T>>
  }

  /** @internal — update path that skips the fillable filter. Used by `save()`. */
  private static async _doUpdate<T extends typeof Model>(this: T, id: number | string, data: Record<string, unknown>): Promise<InstanceType<T>> {
    const self = this as typeof Model
    let payload = self._applyMutators(data)

    const updatingResult = await self._fireEvent('updating', id, payload)
    if (updatingResult === false) throw new Error(`[RudderJS ORM] Update cancelled by observer on ${self.name}.`)
    if (updatingResult && typeof updatingResult === 'object') payload = updatingResult as Record<string, unknown>

    const savingResult = await self._fireEvent('saving', payload)
    if (savingResult === false) throw new Error(`[RudderJS ORM] Update cancelled by saving observer on ${self.name}.`)
    if (savingResult && typeof savingResult === 'object') payload = savingResult as Record<string, unknown>

    const record = await Model._q(this).update(id, payload as Partial<InstanceType<T>>)

    await self._fireEvent('updated', record as Record<string, unknown>)
    await self._fireEvent('saved',   record as Record<string, unknown>)
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

  /**
   * Atomically add `amount` to `column` for the row with the given primary key.
   * Optionally update other columns at the same time via `extra`.
   *
   * The increment is performed as a single SQL `UPDATE col = col + amount`,
   * so it's safe under concurrent writes — no read-modify-write race.
   *
   * Lifecycle observers (`updating`/`updated`/`saving`/`saved`) do NOT fire
   * for `increment`/`decrement`. Counter updates are intentionally a pure
   * data-plane operation; if you need observer hooks, read the row, set the
   * resolved value, and call `update()` instead.
   */
  static async increment<T extends typeof Model>(
    this: T,
    id:     number | string,
    column: string,
    amount: number = 1,
    extra:  Partial<InstanceType<T>> = {} as Partial<InstanceType<T>>,
  ): Promise<InstanceType<T>> {
    return Model._q(this).increment(id, column, amount, extra as Record<string, unknown>)
  }

  /**
   * Atomically subtract `amount` from `column` for the row with the given
   * primary key. Symmetric to {@link Model.increment} — see its docs for the
   * observer-firing caveat.
   */
  static async decrement<T extends typeof Model>(
    this: T,
    id:     number | string,
    column: string,
    amount: number = 1,
    extra:  Partial<InstanceType<T>> = {} as Partial<InstanceType<T>>,
  ): Promise<InstanceType<T>> {
    return Model._q(this).decrement(id, column, amount, extra as Record<string, unknown>)
  }

  // ── Instance persistence methods ───────────────────────

  /** @internal — pull the primary-key value from this instance, or `undefined` if unset. */
  private _getKey(): string | number | undefined {
    const ctor = this.constructor as typeof Model
    const value = (this as unknown as Record<string, unknown>)[ctor.primaryKey]
    if (value === undefined || value === null) return undefined
    return value as string | number
  }

  /**
   * @internal — own enumerable data fields, with framework-internal `_` keys
   * stripped and `undefined` values dropped so a class-declared but never-set
   * field (`id!: number`) doesn't leak into a create/update payload.
   */
  private _toData(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(this)) {
      if (k.startsWith('_')) continue
      if (v === undefined) continue
      out[k] = v
    }
    return out
  }

  /**
   * Persist this instance. Inserts when the primary key is unset; otherwise updates.
   *
   * Goes through the static `create()` / `update()` path so observers, casts,
   * and mutators all fire. The instance is mutated in place with the canonical
   * fields returned by the database (default values, generated ids, computed columns)
   * and returned for chaining.
   */
  async save(): Promise<this> {
    const ctor = this.constructor as typeof Model
    const data = this._toData()
    const id   = this._getKey()
    // Bypass fillable: data was set via property assignment, not mass-assignment.
    const persisted = id === undefined
      ? await Model._doCreate.call(ctor, data)
      : await Model._doUpdate.call(ctor, id, data)
    Object.assign(this, persisted)
    return this
  }

  /**
   * Mass-assign a partial set of attributes onto this instance. Does not persist —
   * call `save()` afterwards. Returns `this` for chaining.
   *
   * Drops keys that aren't mass-assignable under the class's `fillable` /
   * `guarded` configuration. Use `forceFill()` to bypass.
   */
  fill(data: Partial<this>): this {
    const ctor = this.constructor as typeof Model
    const filtered = ctor._filterFillable(data as Record<string, unknown>)
    Object.assign(this, filtered)
    return this
  }

  /**
   * Mass-assign attributes without applying the `fillable` / `guarded` filter.
   * Use when you trust the source (factory output, internal sync, fixture data)
   * and want every key on the instance regardless of mass-assignment protection.
   */
  forceFill(data: Partial<this>): this {
    Object.assign(this, data)
    return this
  }

  /**
   * Re-read this instance from the database, replacing in-place with fresh
   * column values. Throws `ModelNotFoundError` if the row no longer exists.
   * Useful after triggers, generated columns, or a parallel update from another process.
   */
  async refresh(): Promise<this> {
    const ctor = this.constructor as typeof Model
    const id = this._getKey()
    if (id === undefined) {
      throw new Error(`[RudderJS ORM] Cannot refresh a ${ctor.name} without a primary key.`)
    }
    const fresh = await (ctor as typeof Model & { find(i: string | number): Promise<Model | null> }).find(id)
    if (!fresh) throw new ModelNotFoundError(ctor.name, id)
    for (const k of Object.keys(this)) {
      if (!k.startsWith('_')) delete (this as unknown as Record<string, unknown>)[k]
    }
    Object.assign(this, fresh)
    return this
  }

  /**
   * Delete this instance from the database. Soft-deletes when `static softDeletes`
   * is enabled. Routes through the static `delete()` so observers fire.
   */
  async delete(): Promise<void> {
    const ctor = this.constructor as typeof Model
    const id = this._getKey()
    if (id === undefined) {
      throw new Error(`[RudderJS ORM] Cannot delete a ${ctor.name} without a primary key.`)
    }
    await (ctor as typeof Model & { delete(i: string | number): Promise<void> }).delete(id)
  }

  /**
   * Atomically add `amount` to `column` on this instance. The row is updated
   * via SQL `UPDATE col = col + amount` and the new value is merged back into
   * `this` for direct access. Returns `this` for chaining.
   *
   * See the static {@link Model.increment} for caveats — observer events do
   * not fire for counter updates.
   */
  async increment(column: string, amount = 1, extra: Partial<this> = {}): Promise<this> {
    const ctor = this.constructor as typeof Model
    const id = this._getKey()
    if (id === undefined) {
      throw new Error(`[RudderJS ORM] Cannot increment a ${ctor.name} without a primary key.`)
    }
    const updated = await (ctor as typeof Model & {
      increment(i: string | number, c: string, a?: number, e?: Record<string, unknown>): Promise<Model>
    }).increment(id, column, amount, extra as Record<string, unknown>)
    Object.assign(this, updated)
    return this
  }

  /**
   * Atomically subtract `amount` from `column` on this instance. Symmetric to
   * {@link increment}.
   */
  async decrement(column: string, amount = 1, extra: Partial<this> = {}): Promise<this> {
    const ctor = this.constructor as typeof Model
    const id = this._getKey()
    if (id === undefined) {
      throw new Error(`[RudderJS ORM] Cannot decrement a ${ctor.name} without a primary key.`)
    }
    const updated = await (ctor as typeof Model & {
      decrement(i: string | number, c: string, a?: number, e?: Record<string, unknown>): Promise<Model>
    }).decrement(id, column, amount, extra as Record<string, unknown>)
    Object.assign(this, updated)
    return this
  }

  /**
   * Clone this instance into a new, unsaved copy — the primary key and the
   * standard timestamp columns are dropped, and any keys passed in `except`
   * are also stripped. Call `save()` on the returned instance to persist.
   *
   * @example
   * const draft = post.replicate(['publishedAt'])
   * draft.title = 'Copy: ' + draft.title
   * await draft.save()
   */
  replicate(except: string[] = []): this {
    const ctor = this.constructor as typeof Model
    const exclude = new Set<string>([ctor.primaryKey, 'createdAt', 'updatedAt', 'deletedAt', ...except])
    const Ctor = ctor as unknown as new () => this
    const clone = new Ctor()
    // Drop class-declared field defaults that fall under `exclude`, otherwise
    // a subclass with `id!: number` ships an `id: undefined` own property.
    // Then drop any other undefined defaults so the clone reads as a freshly-
    // built record from the source instance, not a half-initialized template.
    for (const k of Object.keys(clone)) {
      if (exclude.has(k) || (clone as Record<string, unknown>)[k] === undefined) {
        delete (clone as Record<string, unknown>)[k]
      }
    }
    for (const [k, v] of Object.entries(this)) {
      if (k.startsWith('_') || exclude.has(k) || v === undefined) continue
      ;(clone as unknown as Record<string, unknown>)[k] = v
    }
    return clone
  }

  /**
   * True when `other` represents the same record — same model class (by table)
   * and same primary key.
   */
  is(other: Model | null | undefined): boolean {
    if (!other || !(other instanceof Model)) return false
    const here  = this.constructor as typeof Model
    const there = other.constructor as typeof Model
    if (here.getTable() !== there.getTable()) return false
    const a = this._getKey()
    const b = (other as unknown as { _getKey(): string | number | undefined })._getKey()
    return a !== undefined && a === b
  }

  /** Inverse of `is()`. */
  isNot(other: Model | null | undefined): boolean {
    return !this.is(other)
  }

  /** True when this instance has been soft-deleted (its `deletedAt` is set). */
  trashed(): boolean {
    const v = (this as unknown as Record<string, unknown>)['deletedAt']
    return v !== null && v !== undefined
  }

  // ── Relations ──────────────────────────────────────────

  /**
   * Lazy-fetch a related record (or set of records) as a chainable query.
   *
   * Looks up the relation declared on `static relations`, builds a
   * {@link QueryBuilder} on the related model already filtered to this
   * instance, and returns it. Call any builder method (`where`, `orderBy`,
   * `first`, `get`, `paginate`, ...) to finalize the query.
   *
   * For eager loading, prefer the adapter's native `with()` / `include` /
   * `select` — this method is for the deferred, fluent case.
   *
   * @example
   * const user = await User.find(1)
   * const recent = await user!.related('posts').orderBy('createdAt', 'desc').limit(5).get()
   *
   * @throws Error when the relation is not declared on `static relations`.
   * @throws Error when `belongsTo` is used and this instance has no value for
   *   the foreign-key column.
   */
  related(name: string): QueryBuilder<Model> {
    const ctor = this.constructor as typeof Model
    const def = ctor.relations[name]
    if (!def) {
      throw new Error(`[RudderJS ORM] Relation "${name}" is not defined on ${ctor.name}.`)
    }
    const Related = def.model() as typeof Model
    const fkCamel = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)

    if (def.type === 'belongsToMany') {
      const meta = _resolveBelongsToManyMeta(ctor, Related, def)
      const parentVal = (this as unknown as Record<string, unknown>)[meta.parentKey]
      if (parentVal === undefined || parentVal === null) {
        throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${meta.parentKey} is unset.`)
      }
      return _belongsToManyDeferredQb(Related, def, meta, parentVal) as QueryBuilder<Model>
    }

    if (def.type === 'belongsTo') {
      // This model holds the FK; query the related model's PK.
      const fk        = def.foreignKey ?? `${fkCamel(Related.name)}Id`
      const localCol  = def.localKey   ?? fk
      const localVal  = (this as unknown as Record<string, unknown>)[localCol]
      if (localVal === undefined || localVal === null) {
        throw new Error(`[RudderJS ORM] Cannot resolve belongsTo "${name}" — ${ctor.name}.${localCol} is unset.`)
      }
      return Related.where(Related.primaryKey, localVal) as QueryBuilder<Model>
    }

    // hasOne / hasMany — related model holds the FK pointing back to us.
    const fk       = def.foreignKey ?? `${fkCamel(ctor.name)}Id`
    const localCol = def.localKey   ?? ctor.primaryKey
    const localVal = (this as unknown as Record<string, unknown>)[localCol]
    if (localVal === undefined || localVal === null) {
      throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${localCol} is unset.`)
    }
    return Related.where(fk, localVal) as QueryBuilder<Model>
  }

  /**
   * Pivot-mutation accessor for a `belongsToMany` relation.
   *
   * Most callers use the auto-generated per-relation method
   * (`user.roles().attach([1, 2])`) installed when the parent model is
   * first queried. This static is the public-facing alias the
   * auto-method dispatches to — call it directly when you want to define
   * a typed wrapper on your Model subclass:
   *
   * ```ts
   * class User extends Model {
   *   static override relations = {
   *     roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
   *   }
   *   // Override for typing — same behavior as the auto-generated method.
   *   roles() { return Model.belongsToMany(this, 'roles') }
   * }
   * ```
   */
  static belongsToMany(parent: Model, name: string): BelongsToManyAccessor {
    const ctor = parent.constructor as typeof Model
    const def = ctor.relations[name]
    if (!def) {
      throw new Error(`[RudderJS ORM] Relation "${name}" is not defined on ${ctor.name}.`)
    }
    if (def.type !== 'belongsToMany') {
      throw new Error(`[RudderJS ORM] Relation "${name}" on ${ctor.name} is "${def.type}", not "belongsToMany".`)
    }
    const Related = def.model() as typeof Model
    const meta = _resolveBelongsToManyMeta(ctor, Related, def)
    const parentVal = (parent as unknown as Record<string, unknown>)[meta.parentKey]
    if (parentVal === undefined || parentVal === null) {
      throw new Error(`[RudderJS ORM] Cannot use belongsToMany "${name}" on ${ctor.name} — ${meta.parentKey} is unset.`)
    }
    // Belt-and-suspenders: make sure the auto-method is installed even
    // for instances constructed before any query against this class.
    _installBelongsToManyMethods(ctor)
    return _makeBelongsToManyAccessor(ctor, Related, def, parentVal)
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
    this.#instanceHidden = (this.#instanceHidden ?? (this.constructor as typeof Model).hidden)
      .filter(h => !k.includes(h))
    return this
  }

  /**
   * Hide the given keys from this instance's JSON output.
   * Returns `this` for chaining.
   */
  makeHidden(keys: string | string[]): this {
    const k = Array.isArray(keys) ? keys : [keys]
    this.#instanceHidden = [...(this.#instanceHidden ?? (this.constructor as typeof Model).hidden), ...k]
    return this
  }

  /**
   * Override the visible list for this instance only.
   * Returns `this` for chaining.
   */
  setVisible(keys: string[]): this {
    this.#instanceVisible = keys
    return this
  }

  /**
   * Override the hidden list for this instance only.
   * Returns `this` for chaining.
   */
  setHidden(keys: string[]): this {
    this.#instanceHidden = keys
    return this
  }

  /**
   * Add keys to the visible list for this instance.
   * Returns `this` for chaining.
   */
  mergeVisible(keys: string[]): this {
    const base = this.#instanceVisible ?? (this.constructor as typeof Model).visible
    this.#instanceVisible = [...base, ...keys]
    return this
  }

  /**
   * Add keys to the hidden list for this instance.
   * Returns `this` for chaining.
   */
  mergeHidden(keys: string[]): this {
    const base = this.#instanceHidden ?? (this.constructor as typeof Model).hidden
    this.#instanceHidden = [...base, ...keys]
    return this
  }

  // ── toJSON ─────────────────────────────────────────────

  toJSON(): Record<string, unknown> {
    const ctor = this.constructor as typeof Model
    const raw: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(this)) {
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
    const effectiveVisible = this.#instanceVisible ?? ctor.visible
    const effectiveHidden  = this.#instanceHidden  ?? ctor.hidden

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

// ─── belongsToMany internals ───────────────────────────────

interface BelongsToManyMeta {
  pivotTable:      string
  foreignPivotKey: string
  relatedPivotKey: string
  parentKey:       string
  relatedKey:      string
}

type BelongsToManyDef = Extract<RelationDefinition, { type: 'belongsToMany' }>

function _camelHead(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function _resolveBelongsToManyMeta(
  Parent:  typeof Model,
  Related: typeof Model,
  def:     BelongsToManyDef,
): BelongsToManyMeta {
  return {
    pivotTable:      def.pivotTable,
    foreignPivotKey: def.foreignPivotKey ?? `${_camelHead(Parent.name)}Id`,
    relatedPivotKey: def.relatedPivotKey ?? `${_camelHead(Related.name)}Id`,
    parentKey:       def.parentKey       ?? Parent.primaryKey,
    relatedKey:      def.relatedKey      ?? Related.primaryKey,
  }
}

const _CHAIN_METHODS = new Set([
  'where', 'orWhere', 'orderBy', 'limit', 'offset', 'with', 'withTrashed', 'onlyTrashed',
])
const _TERMINAL_METHODS = new Set([
  'first', 'find', 'get', 'all', 'count', 'paginate',
])
const _UNSUPPORTED_TERMINALS = new Set([
  'create', 'update', 'delete', 'restore', 'forceDelete', 'increment', 'decrement', 'insertMany', 'deleteAll',
])

/**
 * Build a deferred QueryBuilder that runs the pivot lookup on terminal
 * evaluation. Chain methods (where/orderBy/etc.) are recorded and replayed
 * against `Related.where(relatedKey, 'IN', ids)` once ids are resolved.
 *
 * Mutations (`create`/`update`/`delete`/`insertMany`/`deleteAll`) throw —
 * write the pivot via `belongsToMany().attach/detach/sync` and write the
 * related rows via the related model directly.
 */
type QbAsDict = Record<string, ((...a: unknown[]) => unknown) | undefined>

function _replayChain(q: QueryBuilder<Model>, recorded: ReadonlyArray<[string, unknown[]]>): QueryBuilder<Model> {
  let cur = q
  for (const [m, args] of recorded) {
    const fn = (cur as unknown as QbAsDict)[m]
    if (fn) cur = fn.apply(cur, args) as QueryBuilder<Model>
  }
  return cur
}

function _belongsToManyDeferredQb(
  Related:    typeof Model,
  _def:       BelongsToManyDef,
  meta:       BelongsToManyMeta,
  parentVal:  unknown,
): QueryBuilder<Model> {
  const recorded: Array<[string, unknown[]]> = []

  const buildResolved = async (): Promise<QueryBuilder<Model>> => {
    const adapter = ModelRegistry.getAdapter()
    const pivotRows = await adapter
      .query<Record<string, unknown>>(meta.pivotTable)
      .where(meta.foreignPivotKey, parentVal)
      .get()
    const ids = pivotRows.map(r => r[meta.relatedPivotKey])
    // Empty IN list — short-circuit with a guaranteed-empty query so
    // adapters don't have to handle the edge case.
    const q = (Related.query() as unknown as QueryBuilder<Model>)
      .where(meta.relatedKey, 'IN', ids.length === 0 ? [] : ids)
    return _replayChain(q, recorded)
  }

  const proxy: QueryBuilder<Model> = new Proxy({} as QueryBuilder<Model>, {
    get(_t, prop): unknown {
      const name = String(prop)
      if (_CHAIN_METHODS.has(name)) {
        return (...args: unknown[]) => {
          recorded.push([name, args])
          return proxy
        }
      }
      if (_TERMINAL_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          const q = await buildResolved()
          const fn = (q as unknown as QbAsDict)[name]
          return fn ? fn.apply(q, args) : undefined
        }
      }
      if (_UNSUPPORTED_TERMINALS.has(name)) {
        return () => {
          throw new Error(
            `[RudderJS ORM] "${name}" is not supported on a belongsToMany lazy-fetch query. ` +
            `Use Model.belongsToMany(parent, name) for pivot mutations or call methods on the related Model directly.`,
          )
        }
      }
      return undefined
    },
  })

  return proxy
}

/**
 * Helper for `Model.belongsToMany` — accepts both flat pivot data
 * (same row written for every id) and a per-id map.
 *
 * Flat:    `attach([1, 2, 3], { addedBy: 'admin' })`
 * Per-id:  `attach({ 1: { addedBy: 'admin' }, 2: { addedBy: 'system' } })`
 */
type AttachInput = ReadonlyArray<number | string> | Record<string | number, Record<string, unknown>>

function _normalizeAttachInput(
  input:           AttachInput,
  foreignPivotKey: string,
  parentVal:       unknown,
  relatedPivotKey: string,
  flatPivot?:      Record<string, unknown>,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  if (Array.isArray(input)) {
    for (const id of input) {
      rows.push({
        ...(flatPivot ?? {}),
        [foreignPivotKey]: parentVal,
        [relatedPivotKey]: id,
      })
    }
  } else {
    for (const [id, perIdPivot] of Object.entries(input as Record<string | number, Record<string, unknown>>)) {
      // Normalize numeric-string keys back to numbers when possible — JS
      // object keys are always strings; the pivot column may be int.
      const idVal: unknown = /^\d+$/.test(id) ? Number(id) : id
      rows.push({
        ...perIdPivot,
        [foreignPivotKey]: parentVal,
        [relatedPivotKey]: idVal,
      })
    }
  }
  return rows
}

function _idsFromAttachInput(input: AttachInput): unknown[] {
  if (Array.isArray(input)) return [...input]
  return Object.keys(input).map(k => /^\d+$/.test(k) ? Number(k) : k)
}

/**
 * Per-relation accessor for a `belongsToMany` relation. Returned from
 * {@link Model.belongsToMany} and from the auto-generated prototype
 * methods.
 *
 * `attach` writes new pivot rows. `detach` removes pivot rows. `sync`
 * diffs the current pivot ids against the requested set and runs
 * `attach`/`detach` for the difference.
 */
export interface BelongsToManyAccessor {
  /**
   * Insert pivot rows. Accepts a list of ids (with optional flat pivot data
   * applied to every row) or a per-id map keyed by related id with that
   * row's pivot data.
   *
   * Empty input is a no-op — no INSERT, no error.
   */
  attach(input: AttachInput, flatPivot?: Record<string, unknown>): Promise<void>
  /**
   * Delete pivot rows. With ids, deletes only the matching pivot rows.
   * With no args, deletes all pivot rows for this parent.
   */
  detach(ids?: ReadonlyArray<number | string>): Promise<number>
  /**
   * Diff the current pivot set against `desiredIds` — attach the missing,
   * detach what's no longer present. Optional flat pivot data is written
   * onto the *new* pivot rows only; existing rows are not modified.
   *
   * Returns counts of what changed.
   */
  sync(
    desiredIds: ReadonlyArray<number | string>,
    flatPivot?: Record<string, unknown>,
  ): Promise<{ attached: unknown[]; detached: unknown[] }>
}

function _makeBelongsToManyAccessor(
  Parent:    typeof Model,
  Related:   typeof Model,
  def:       BelongsToManyDef,
  parentVal: unknown,
): BelongsToManyAccessor {
  const meta = _resolveBelongsToManyMeta(Parent, Related, def)

  return {
    async attach(input, flatPivot) {
      const ids = _idsFromAttachInput(input)
      if (ids.length === 0) return
      const rows = _normalizeAttachInput(input, meta.foreignPivotKey, parentVal, meta.relatedPivotKey, flatPivot)
      await ModelRegistry.getAdapter()
        .query<Record<string, unknown>>(meta.pivotTable)
        .insertMany(rows)
    },

    async detach(ids) {
      const adapter = ModelRegistry.getAdapter()
      let q = adapter
        .query<Record<string, unknown>>(meta.pivotTable)
        .where(meta.foreignPivotKey, parentVal)
      if (ids !== undefined) {
        if (ids.length === 0) return 0
        q = q.where(meta.relatedPivotKey, 'IN', [...ids])
      }
      return q.deleteAll()
    },

    async sync(desiredIds, flatPivot) {
      const adapter = ModelRegistry.getAdapter()
      const currentRows = await adapter
        .query<Record<string, unknown>>(meta.pivotTable)
        .where(meta.foreignPivotKey, parentVal)
        .get()
      const current = new Set(currentRows.map(r => r[meta.relatedPivotKey]))
      const desired = new Set<unknown>(desiredIds)
      const attached: unknown[] = []
      const detached: unknown[] = []
      for (const id of desired) if (!current.has(id)) attached.push(id)
      for (const id of current) if (!desired.has(id)) detached.push(id)

      if (attached.length > 0) {
        const rows = attached.map(id => ({
          ...(flatPivot ?? {}),
          [meta.foreignPivotKey]: parentVal,
          [meta.relatedPivotKey]: id,
        }))
        await adapter.query<Record<string, unknown>>(meta.pivotTable).insertMany(rows)
      }
      if (detached.length > 0) {
        await adapter
          .query<Record<string, unknown>>(meta.pivotTable)
          .where(meta.foreignPivotKey, parentVal)
          .where(meta.relatedPivotKey, 'IN', detached)
          .deleteAll()
      }

      return { attached, detached }
    },
  }
}

/**
 * Install per-relation prototype methods for every `belongsToMany` entry
 * declared on `static relations`. Idempotent — won't overwrite a method
 * the author already defined (typing escape hatch).
 *
 * Called on first query (via `ModelRegistry.register`) and once more
 * defensively from `Model.belongsToMany` so apps that construct instances
 * without ever querying still get the auto-method.
 */
function _installBelongsToManyMethods(ModelClass: typeof Model): void {
  for (const [name, def] of Object.entries(ModelClass.relations)) {
    if (def.type !== 'belongsToMany') continue
    if (Object.prototype.hasOwnProperty.call(ModelClass.prototype, name)) continue
    Object.defineProperty(ModelClass.prototype, name, {
      configurable: true,
      writable:     true,
      value(this: Model): BelongsToManyAccessor {
        return Model.belongsToMany(this, name)
      },
    })
  }
}

// ─── Compile-time contract check ───────────────────────────
// Asserts that `Model`'s static surface conforms to the `ModelLike`
// contract from `@rudderjs/contracts`. Downstream tools (admin panels
// with auto-wired CRUD, generic resource browsers, etc.) target
// `ModelLike` so they don't need to depend on `@rudderjs/orm` directly.
// This line will fail to compile if a future change to Model breaks
// that contract.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _modelSatisfiesContract: ModelLike = Model
void _modelSatisfiesContract
