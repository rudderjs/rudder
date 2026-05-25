import type { AggregateRequest, QueryBuilder, OrmAdapter, PaginatedResult, ModelLike, WhereClause, WhereOperator, RelationExistencePredicate } from '@rudderjs/contracts'
import { castGet, castSet, type CastDefinition } from './cast.js'
import { type Attribute } from './attribute.js'
import {
  AGGREGATES_SYMBOL,
  aggregateKeysOf,
  loadCountOrExists,
  loadMissingRelations,
  loadNumericAggregate,
  normalizeWithCount,
  normalizeWithExists,
  normalizeWithNumericAggregate,
  type AggregateConstraint,
  type AggregateSumSpec,
} from './aggregate.js'
import { camelHead, attrEqual, readField, writeField, deleteField } from './utils.js'
import {
  resolveBelongsToManyMeta,
  resolveMorphToManyMeta,
  resolveMorphedByManyMeta,
  type BelongsToManyMeta,
  type MorphToManyMeta,
  type MorphedByManyMeta,
  type BelongsToManyDef,
  type MorphToManyDef,
  type MorphedByManyDef,
} from './relations/pivot-meta.js'
import {
  attachWhereHas,
  attachWithWhereHas,
  attachWhereBelongsTo,
} from './relations/where-has.js'
import {
  morphParentQuery,
  belongsToManyDeferredQb,
  morphToManyDeferredQb,
  morphedByManyDeferredQb,
} from './relations/pivot-deferred.js'
import {
  makeBelongsToManyAccessor,
  makeMorphToManyAccessor,
  makeMorphedByManyAccessor,
  installBelongsToManyMethods,
  installMorphPivotMethods,
  type BelongsToManyAccessor,
  type MorphToManyAccessor,
  type MorphedByManyAccessor,
} from './relations/pivot-accessors.js'
import {
  partitionEagerLoads,
  attachPolymorphicRelations,
} from './polymorphic-eager-load.js'

export type { QueryBuilder, OrmAdapter, OrmAdapterProvider, PaginatedResult, WhereOperator, WhereClause, OrderClause, QueryState, RelationExistencePredicate, AggregateFn, AggregateRequest, AggregateJoinShape } from '@rudderjs/contracts'
export type { CastDefinition, CastUsing, BuiltInCast } from './cast.js'
export { vector }                                  from './cast.js'
export {
  VectorDimensionMismatchError,
  VectorStorageUnsupportedError,
  MissingEmbedderError,
}                                                  from './vector-errors.js'
export { Attribute }                               from './attribute.js'
export { JsonResource, ResourceCollection }        from './resource.js'
export { ModelCollection }                         from './collection.js'
export { ModelFactory, sequence }                  from './factory.js'
export { Seeder }                                  from './seeder.js'
export type { SeederConstructor }                  from './seeder.js'
export { AggregateConstraintBuilder, AGGREGATES_SYMBOL }    from './aggregate.js'
export type { AggregateConstraint, AggregateSumSpec } from './aggregate.js'
export { pruneModels }                              from './prune.js'
export type { PruneOptions, PruneReport }           from './prune.js'
export type { BelongsToManyAccessor, MorphToManyAccessor, MorphedByManyAccessor } from './relations/pivot-accessors.js'

// ─── Global ORM Registry ───────────────────────────────────

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@rudderjs/orm` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles `@rudderjs/orm` inline but externalizes
 * `@rudderjs/orm-prisma` / `@rudderjs/orm-drizzle`. Those adapter packages
 * resolve their own copy of `@rudderjs/orm` from `node_modules` at runtime;
 * without a shared store, `ModelRegistry.set()` would land on a different
 * class than the one Model handlers read from. Same pattern as ai/mcp/http/
 * queue/sync/broadcast observer registries.
 */
interface OrmRegistryStore {
  adapter:   OrmAdapter | null
  models:    Map<string, typeof Model>
  listeners: Set<(name: string, ModelClass: typeof Model) => void>
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_orm_registry__']) {
  _g['__rudderjs_orm_registry__'] = {
    adapter:   null,
    models:    new Map(),
    listeners: new Set(),
  } satisfies OrmRegistryStore
}
const _store = _g['__rudderjs_orm_registry__'] as OrmRegistryStore

// ─── RUDDER_ORM_TRACE — dev diagnostic for the HMR re-boot wedge ──────────────
//
// Set RUDDER_ORM_TRACE=1 to log one line per read terminal (find/first/get/all/
// paginate). Built to diagnose the "booted-ORM path returns empty after a dev
// re-boot, no error" residual (docs/plans/2026-05-24-hmr-reboot-window-...md,
// REOPEN #2): the symptom is empty-not-error, so the line surfaces exactly which
// of the plausible causes is in play —
//   • `table=` ......... a wrong / unexpected table (class-name → table drift)
//   • `class=#N` ....... the Model class IDENTITY. A re-imported model gets a
//                        NEW tag; if a query runs against a different #N than the
//                        one returning rows, stale-class capture is implicated.
//   • `adapter=#M` ..... the ORM adapter object the query was built from. A
//                        different #M than a working query = adapter swap/stale.
//   • `softDeletes` / `scopes=[...]` — a filter that could empty the result set.
//   • `rows=` .......... the count actually returned (0 = the wedge).
// Zero overhead when the env var is off (every call early-returns). The class /
// adapter tag maps live in this module, which is externalized (not re-evaluated
// on HMR), so tags stay stable across re-boots — re-imported app/Models/* get
// fresh tags precisely because THEY are re-evaluated. That contrast is the point.
const _ormTrace = process.env['RUDDER_ORM_TRACE'] === '1'
let _classSeq = 0
let _adapterSeq = 0
const _classTags = new WeakMap<object, number>()
const _adapterTags = new WeakMap<object, number>()
function _tagOf(map: WeakMap<object, number>, next: () => number, obj: object | null): string {
  if (!obj) return 'none'
  let t = map.get(obj)
  if (t === undefined) { t = next(); map.set(obj, t) }
  return `#${t}`
}
function ormTraceTerminal(self: typeof Model, terminal: string, rowCount: number, adapter: object | null): void {
  if (!_ormTrace) return
  const scopes = Object.keys(self.globalScopes ?? {})
  console.log(
    `[orm] ${terminal} model=${self.name} class=${_tagOf(_classTags, () => ++_classSeq, self)} ` +
    `table=${self.getTable()} adapter=${_tagOf(_adapterTags, () => ++_adapterSeq, adapter)} ` +
    `softDeletes=${self.softDeletes} scopes=[${scopes.join(',')}] rows=${rowCount}`,
  )
}

export class ModelRegistry {
  static set(adapter: OrmAdapter): void {
    _store.adapter = adapter
  }

  static get(): OrmAdapter | null {
    return _store.adapter
  }

  static getAdapter(): OrmAdapter {
    if (!_store.adapter) {
      throw new Error('[RudderJS ORM] No ORM adapter registered. Did you add a database provider to your providers list?')
    }
    return _store.adapter
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
    if (!name || _store.models.has(name)) return
    _store.models.set(name, ModelClass)
    installBelongsToManyMethods(ModelClass)
    installMorphPivotMethods(ModelClass)
    for (const listener of _store.listeners) listener(name, ModelClass)
  }

  /**
   * All registered model classes, keyed by class name. Used by Telescope's
   * model collector and any code that needs to iterate discovered models.
   */
  static all(): Map<string, typeof Model> {
    return _store.models
  }

  /**
   * Subscribe to model registrations. Fires once per newly registered
   * class. Returns an unsubscribe function.
   */
  static onRegister(listener: (name: string, ModelClass: typeof Model) => void): () => void {
    _store.listeners.add(listener)
    return () => { _store.listeners.delete(listener) }
  }

  static reset(): void {
    _store.adapter = null
    _store.models.clear()
    _store.listeners.clear()
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

/**
 * Models implementing `Prunable` are eligible for `pnpm rudder model:prune`.
 * Each matching record is hydrated, the optional static `pruning()` hook
 * fires, then the standard `deleting` / `deleted` observers run and the
 * record is removed via `instance.delete()` (so soft-deletes are honored).
 *
 * Use when you need observer hooks, per-row reactions, or cleanup side
 * effects (S3 delete, search-index removal). For high-volume retention with
 * no per-row work, prefer {@link MassPrunable}.
 */
export interface Prunable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prunable(): QueryBuilder<any>
  pruning?(model: Model): void | Promise<void>
}

/**
 * Bulk-pruned via a single `deleteAll()` per chunk. Faster than
 * {@link Prunable}, but observers do NOT fire, `pruning()` is NOT called,
 * and `softDeletes` is NOT applied (mirrors Laravel; `deleteAll()` is the
 * existing bulk DELETE primitive). Use for append-only retention
 * (analytics events, expired tokens, job-batch records).
 */
export interface MassPrunable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prunable(): QueryBuilder<any>
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
  | {
      type:       'morphMany'
      /** Lazy reference to the related (child) model class — avoids circular imports. */
      model:      () => typeof Model
      /** Polymorphic relation name — drives `{morphName}Id` + `{morphName}Type` columns.
       *  E.g. `morphName: 'commentable'` → columns `commentableId` / `commentableType`. */
      morphName:  string
      /** Override the discriminator value written to `{morphName}Type`.
       *  Defaults to `Parent.morphAlias ?? Parent.name`. */
      morphType?: string
      /** Override the parent column joined against `{morphName}Id`. Default: `Parent.primaryKey`. */
      localKey?:  string
    }
  | {
      type:       'morphOne'
      /** Lazy reference to the related (child) model class — avoids circular imports. */
      model:      () => typeof Model
      /** Polymorphic relation name — drives `{morphName}Id` + `{morphName}Type` columns. */
      morphName:  string
      /** Override the discriminator value written to `{morphName}Type`.
       *  Defaults to `Parent.morphAlias ?? Parent.name`. */
      morphType?: string
      /** Override the parent column joined against `{morphName}Id`. Default: `Parent.primaryKey`. */
      localKey?:  string
    }
  | {
      type:       'morphTo'
      /** Polymorphic relation name — drives `{morphName}Id` + `{morphName}Type` columns. */
      morphName:  string
      /** Closed list of allowed target classes. Lazy thunk dodges circular imports.
       *  Required: `morphTo` resolution looks up the class whose `morphAlias ?? name`
       *  matches the value stored in `{morphName}Type`. Listing the closed set keeps
       *  lookup deterministic without depending on `ModelRegistry.register` having
       *  been called eagerly for every target. */
      types:      () => Array<typeof Model>
    }
  | {
      type:             'morphToMany'
      /** Lazy reference to the related (strong-side) model class. */
      model:            () => typeof Model
      /** Pivot table name — required. Conventionally a singular noun (`taggable`). */
      pivotTable:       string
      /** Polymorphic relation name — drives `{morphName}Id` + `{morphName}Type` columns
       *  on the pivot. E.g. `morphName: 'taggable'` → pivot columns `taggableId` / `taggableType`. */
      morphName:        string
      /** Override the discriminator value written to / read from `{morphName}Type`.
       *  Defaults to `Owning.morphAlias ?? Owning.name`. */
      morphType?:       string
      /** Pivot column pointing at the related (strong) row. Default: `${camelCase(Related.name)}Id`. */
      relatedPivotKey?: string
      /** Column on the parent model joined against `{morphName}Id`. Default: `parent.primaryKey`. */
      parentKey?:       string
      /** Column on the related model joined against `relatedPivotKey`. Default: `Related.primaryKey`. */
      relatedKey?:      string
    }
  | {
      type:             'morphedByMany'
      /** Lazy reference to the related (owning-side) model class. */
      model:            () => typeof Model
      /** Pivot table name — required. Same value as the matching morphToMany side. */
      pivotTable:       string
      /** Polymorphic relation name — must match the owning side's `morphName`. */
      morphName:        string
      /** Override the discriminator value written to / queried in `{morphName}Type` for the related class.
       *  Defaults to `Related.morphAlias ?? Related.name`. */
      morphType?:       string
      /** Pivot column pointing at the parent (strong) row. Default: `${camelCase(Parent.name)}Id`. */
      foreignPivotKey?: string
      /** Column on the parent model joined against `foreignPivotKey`. Default: `parent.primaryKey`. */
      parentKey?:       string
      /** Column on the related model joined against `{morphName}Id`. Default: `Related.primaryKey`. */
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

// ─── Hydrating QueryBuilder ────────────────────────────────

/**
 * The QueryBuilder shape that `Model.query()` / `Model._q()` / `where()` /
 * `with()` etc. actually return. Extends the adapter contract with the
 * ORM-side sugars added by the hydrating Proxy: relation predicates
 * (`whereHas` and friends) and the eager-aggregate methods (`withCount`,
 * `withExists`, `withSum`, `withMin`, `withMax`, `withAvg`).
 *
 * Adapters don't implement these — the proxy at `Model._hydratingQb` does.
 * Keeping them off the adapter contract avoids forcing every adapter to
 * stub them.
 */
export interface HydratingQueryBuilder<T> extends QueryBuilder<T> {
  whereHas(relation: string, constrain?: (q: QueryBuilder<Model>) => void): this
  whereDoesntHave(relation: string, constrain?: (q: QueryBuilder<Model>) => void): this
  withWhereHas(relation: string, constrain?: (q: QueryBuilder<Model>) => void): this
  whereBelongsTo(parent: Model, relation?: string): this
  withCount(arg: string | readonly string[] | Record<string, AggregateConstraint>): this
  withExists(arg: string | readonly string[]): this
  withSum(arg1: string | Record<string, AggregateSumSpec>, arg2?: string): this
  withMin(arg1: string | Record<string, AggregateSumSpec>, arg2?: string): this
  withMax(arg1: string | Record<string, AggregateSumSpec>, arg2?: string): this
  withAvg(arg1: string | Record<string, AggregateSumSpec>, arg2?: string): this
}

// ─── Model Base Class ──────────────────────────────────────

export abstract class Model {
  /** The table name — defaults to lowercase class name + 's' */
  static table: string

  /** Primary key column */
  static primaryKey = 'id'

  /**
   * Discriminator value written to `{morph}Type` columns by polymorphic
   * relations (`morphTo` / `morphMany` / `morphOne`). Defaults to `Class.name`.
   * Override to decouple the persisted discriminator from the JS class name —
   * lets you rename the class without rewriting historical rows.
   *
   * Once set and data exists, treat as immutable storage — same posture as a
   * column rename.
   *
   * @example
   * class BlogPost extends Model {
   *   static override morphAlias = 'post'   // stores 'post', not 'BlogPost'
   * }
   */
  static morphAlias?: string

  /**
   * Pruning mode for `pnpm rudder model:prune`. Override to `'mass'` for
   * {@link MassPrunable}. The runner only considers models that also define
   * `static prunable()`; this static just disambiguates instance- vs
   * bulk-mode for those that do.
   */
  static pruneMode: 'instance' | 'mass' = 'instance'

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
    return Model._q(this).where(this.routeKey, value).first() as Promise<Model | null>
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
   * Supported types: `hasMany`, `hasOne`, `belongsTo`, `belongsToMany`,
   * `morphMany`, `morphOne`, `morphTo`, `morphToMany`, `morphedByMany`.
   * Polymorphic columns use camelCase (`commentableId` / `commentableType`)
   * for ORM consistency — a deliberate divergence from Laravel's snake_case.
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
   *     image: { type: 'morphOne',      model: () => Image,   morphName: 'imageable' },
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

  // ── Dirty Tracking ─────────────────────────────────────
  //
  // Snapshot of attribute values as of the last load / save / refresh.
  // Used by isDirty / isClean / wasChanged / getOriginal / getChanges /
  // getDirty. Captured by hydrate(), save(), refresh(), and increment/
  // decrement so the baseline always matches the persisted state.

  /**
   * @internal — materialized own-column baseline as of last load/save/refresh.
   * Populated lazily: hydrate just stores the raw input record in
   * {@link Model.#originalRaw} and defers the filter pass until the first
   * dirty-tracking access. Save/refresh/etc. populate this field eagerly
   * because they have current instance state in hand.
   */
  #originalSnapshot: Record<string, unknown> = {}

  /**
   * @internal — reference to the raw record passed to `hydrate()`. While
   * non-undefined, dirty-tracking reads route through {@link Model._original}
   * which materializes {@link Model.#originalSnapshot} on first access. Reset
   * to `undefined` once materialized or once an explicit `_syncOriginal()`
   * captures the post-save / post-refresh state.
   */
  #originalRaw: Record<string, unknown> | undefined = undefined

  /** @internal — diff of attributes that changed during the most recent save. */
  #changes: Record<string, unknown> = {}

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
  // Returns `unknown` (not `Promise<unknown>`) so the common fast path stays
  // synchronous: when a class has no observers or event listeners — the typical
  // case for read paths like `.all()` / `.find()` — the call returns the payload
  // directly, and `await self._fireEvent(...)` becomes a no-op in V8 (no
  // microtask scheduling). This recovers ~1ms on `.all()` over 5000 rows where
  // the per-row `retrieved` event would otherwise schedule 5000 empty microtasks.
  // Slow-path observers/listeners route through `_fireEventSlow` and still get
  // their async semantics.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static _fireEvent(event: ModelEvent, ...args: any[]): unknown | Promise<unknown> {
    if (Object.prototype.hasOwnProperty.call(this, '_eventsMuted') && this._eventsMuted) {
      return args[0]
    }

    const hasObservers = Object.prototype.hasOwnProperty.call(this, '_observers') && this._observers.length > 0
    const hasListeners = Object.prototype.hasOwnProperty.call(this, '_listeners') && this._listeners.size    > 0
    if (!hasObservers && !hasListeners) return args[0]

    return this._fireEventSlow(event, ...args)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static async _fireEventSlow(event: ModelEvent, ...args: any[]): Promise<any> {
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
    // Defer the dirty-tracking baseline. _original() materializes the filtered
    // snapshot on first access — typically never, for read-and-discard rows.
    instance.#originalRaw = record as Record<string, unknown>
    return instance
  }

  /** @internal — wrap a QueryBuilder so its read methods return Model instances. */
  private static _hydratingQb<T extends typeof Model>(self: T, qb: QueryBuilder<InstanceType<T>>, traceAdapter?: object | null): HydratingQueryBuilder<InstanceType<T>> {
    const ModelClass  = self as typeof Model
    const _traceAdapter = traceAdapter ?? null
    /** Aliases stamped onto rows by the adapter for any aggregates registered
     *  on this QB. Tagged on each hydrated instance via `aggregateKeysOf` so
     *  `_toData()` excludes them on writes. */
    const aggregateAliases = new Set<string>()
    /** Polymorphic eager-load names captured by the proxy's `with` intercept.
     *  Resolved after the terminal call returns hydrated parents (see
     *  `./polymorphic-eager-load.ts`). Direct relation names are forwarded to
     *  the adapter unchanged in the same call. */
    const polymorphicWiths: string[] = []
    const attachPoly = async (instances: InstanceType<T>[]): Promise<void> => {
      if (polymorphicWiths.length === 0) return
      await attachPolymorphicRelations(ModelClass, instances as ReadonlyArray<Model>, polymorphicWiths)
    }
    const wrap = (r: unknown): InstanceType<T> => {
      const inst = ModelClass.hydrate.call(self, r) as InstanceType<T>
      if (inst && aggregateAliases.size > 0) {
        const set = aggregateKeysOf(inst)
        for (const a of aggregateAliases) set.add(a)
      }
      return inst
    }
    const wrapMaybe   = (r: unknown): InstanceType<T> | null => r == null ? null : wrap(r)
    const wrapMany    = (rs: unknown[]): InstanceType<T>[]  => rs.map(wrap)

    const dispatchAggregates = (reqs: AggregateRequest[]): void => {
      for (const r of reqs) aggregateAliases.add(r.alias)
      ;(qb as QueryBuilder<unknown>).withAggregate(reqs)
    }

    // The Proxy's `get` handler implements the extra `HydratingQueryBuilder`
    // methods at runtime (whereHas / withCount / etc.). TS can't verify that
    // through the Proxy constructor, so we assert here — the assertion is
    // contained to this one site instead of leaking to every call site.
    const proxy = new Proxy(qb as object, {
      get(target, prop, receiver): unknown {
        // ORM-side chainables that don't exist on the adapter QB itself —
        // intercept before the existence check below, since `whereHas` etc.
        // are added by this proxy, not by the adapter.
        if (prop === 'whereHas') {
          return (relation: string, constrain?: (q: QueryBuilder<Model>) => void): QueryBuilder<InstanceType<T>> => {
            attachWhereHas(ModelClass, target as QueryBuilder<Model>, relation, true, constrain)
            return proxy
          }
        }
        if (prop === 'whereDoesntHave') {
          return (relation: string, constrain?: (q: QueryBuilder<Model>) => void): QueryBuilder<InstanceType<T>> => {
            attachWhereHas(ModelClass, target as QueryBuilder<Model>, relation, false, constrain)
            return proxy
          }
        }
        if (prop === 'withWhereHas') {
          return (relation: string, constrain?: (q: QueryBuilder<Model>) => void): QueryBuilder<InstanceType<T>> => {
            attachWithWhereHas(ModelClass, target as QueryBuilder<Model>, relation, constrain)
            return proxy
          }
        }
        if (prop === 'whereBelongsTo') {
          return (parent: Model, relation?: string): QueryBuilder<InstanceType<T>> => {
            attachWhereBelongsTo(ModelClass, target as QueryBuilder<Model>, parent, relation)
            return proxy
          }
        }
        if (prop === 'whereGroup' || prop === 'orWhereGroup') {
          const groupName = prop
          return (
            fn: (q: QueryBuilder<InstanceType<T>>) => QueryBuilder<InstanceType<T>> | void,
          ): QueryBuilder<InstanceType<T>> => {
            ;(target as QueryBuilder<InstanceType<T>>)[groupName]((sub) => {
              fn(Model._hydratingQb(self, sub))
            })
            return proxy
          }
        }
        if (prop === 'withCount') {
          return (arg: string | readonly string[] | Record<string, AggregateConstraint>): QueryBuilder<InstanceType<T>> => {
            dispatchAggregates(normalizeWithCount(ModelClass, arg))
            return proxy
          }
        }
        if (prop === 'withExists') {
          return (arg: string | readonly string[]): QueryBuilder<InstanceType<T>> => {
            dispatchAggregates(normalizeWithExists(ModelClass, arg))
            return proxy
          }
        }
        if (prop === 'withSum' || prop === 'withMin' || prop === 'withMax' || prop === 'withAvg') {
          const fn = prop.slice(4).toLowerCase() as 'sum' | 'min' | 'max' | 'avg'
          return (
            arg1: string | Record<string, AggregateSumSpec>,
            arg2?: string,
          ): QueryBuilder<InstanceType<T>> => {
            dispatchAggregates(normalizeWithNumericAggregate(ModelClass, fn, arg1, arg2))
            return proxy
          }
        }
        // `with(...names)` — intercept to partition polymorphic vs adapter
        // relations. Polymorphic names are captured for post-terminal batch
        // resolution; adapter names are forwarded unchanged.
        if (prop === 'with') {
          return (...names: string[]): QueryBuilder<InstanceType<T>> => {
            const { adapter, polymorphic } = partitionEagerLoads(ModelClass, names)
            for (const n of polymorphic) if (!polymorphicWiths.includes(n)) polymorphicWiths.push(n)
            if (adapter.length > 0) {
              ;(target as QueryBuilder<unknown>).with(...adapter)
            }
            return proxy
          }
        }
        const value = Reflect.get(target, prop, receiver) as unknown
        if (typeof value !== 'function') return value

        switch (prop) {
          case 'find':
            return async (id: number | string): Promise<InstanceType<T> | null> => {
              const inst = wrapMaybe(await (target as QueryBuilder<InstanceType<T>>).find(id))
              ormTraceTerminal(ModelClass, 'find', inst ? 1 : 0, _traceAdapter)
              if (inst) await attachPoly([inst])
              return inst
            }
          case 'first':
            return async (): Promise<InstanceType<T> | null> => {
              const inst = wrapMaybe(await (target as QueryBuilder<InstanceType<T>>).first())
              ormTraceTerminal(ModelClass, 'first', inst ? 1 : 0, _traceAdapter)
              if (inst) await attachPoly([inst])
              return inst
            }
          case 'get':
            return async (): Promise<InstanceType<T>[]> => {
              const insts = wrapMany(await (target as QueryBuilder<InstanceType<T>>).get())
              ormTraceTerminal(ModelClass, 'get', insts.length, _traceAdapter)
              await attachPoly(insts)
              return insts
            }
          case 'all':
            return async (): Promise<InstanceType<T>[]> => {
              const insts = wrapMany(await (target as QueryBuilder<InstanceType<T>>).all())
              ormTraceTerminal(ModelClass, 'all', insts.length, _traceAdapter)
              await attachPoly(insts)
              return insts
            }
          case 'paginate':
            return async (page?: number, perPage?: number): Promise<PaginatedResult<InstanceType<T>>> => {
              const r = await (target as QueryBuilder<InstanceType<T>>).paginate(page ?? 1, perPage)
              const data = wrapMany(r.data)
              ormTraceTerminal(ModelClass, 'paginate', data.length, _traceAdapter)
              await attachPoly(data)
              return { ...r, data }
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
              const result = (value as (...a: unknown[]) => unknown).apply(target, args)
              return result === target ? proxy : result
            }
        }
      },
    }) as HydratingQueryBuilder<InstanceType<T>>

    return proxy
  }

  static query<T extends typeof Model>(this: T): HydratingQueryBuilder<InstanceType<T>> & { scope(name: string, ...args: unknown[]): HydratingQueryBuilder<InstanceType<T>>; withoutGlobalScope(name: string): HydratingQueryBuilder<InstanceType<T>> } {
    ModelRegistry.register(this)
    const modelClass = this as typeof Model
    const localScopes = modelClass.scopes
    const globalScopes = modelClass.globalScopes
    const excludedScopes = new Set<string>()

    const buildScoped = (): HydratingQueryBuilder<InstanceType<T>> => {
      const adapter = ModelRegistry.getAdapter()
      let raw = adapter.query<InstanceType<T>>(
        modelClass.getTable(),
        { primaryKey: modelClass.primaryKey },
      )
      if (modelClass.softDeletes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (raw as any)._enableSoftDeletes?.()
      }
      for (const [scopeName, scopeFn] of Object.entries(globalScopes)) {
        if (!excludedScopes.has(scopeName)) {
          raw = scopeFn(raw) as HydratingQueryBuilder<InstanceType<T>>
        }
      }
      return Model._hydratingQb(this, raw, adapter as object)
    }

    const enhance = (q: HydratingQueryBuilder<InstanceType<T>>): HydratingQueryBuilder<InstanceType<T>> & { scope(name: string, ...args: unknown[]): HydratingQueryBuilder<InstanceType<T>>; withoutGlobalScope(name: string): HydratingQueryBuilder<InstanceType<T>> } => {
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
      return enhanced
    }

    return enhance(buildScoped())
  }

  private static _q<T extends typeof Model>(self: T): HydratingQueryBuilder<InstanceType<T>> {
    ModelRegistry.register(self)
    const ModelClass = self as typeof Model
    const adapter = ModelRegistry.getAdapter()
    let q = adapter.query<InstanceType<T>>(
      ModelClass.getTable(),
      { primaryKey: ModelClass.primaryKey },
    )
    if (ModelClass.softDeletes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any)._enableSoftDeletes?.()
    }
    for (const [, scopeFn] of Object.entries(ModelClass.globalScopes)) {
      q = scopeFn(q) as HydratingQueryBuilder<InstanceType<T>>
    }
    return Model._hydratingQb(self, q, adapter as object)
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

  static where<T extends typeof Model>(this: T, column: string, value: unknown): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).where(column, value)
  }

  /**
   * Filter rows where the named relation has at least one matching child.
   * The optional callback receives a sub-QueryBuilder scoped to the related
   * model — chain `.where()` etc. on it to narrow the relation predicate
   * further.
   *
   * Resolves the relation declaration on `static relations`, builds a
   * {@link RelationExistencePredicate}, and dispatches it to the adapter via
   * `whereRelationExists`. `morphTo` relations are not supported (the related
   * table is dynamic) — call sites should filter on the discriminator
   * columns directly.
   *
   * @example
   * await User.whereHas('posts').get()                                         // users with at least one post
   * await User.whereHas('posts', q => q.where('published', true)).get()        // users with at least one published post
   * await Post.whereHas('tags', q => q.where('name', 'featured')).get()        // belongsToMany pivot path
   * await Post.whereHas('comments').get()                                      // morphMany — adds the {morph}Type filter automatically
   */
  static whereHas<T extends typeof Model>(
    this:      T,
    relation:  string,
    constrain?: (q: QueryBuilder<Model>) => void,
  ): HydratingQueryBuilder<InstanceType<T>> {
    return attachWhereHas(this as typeof Model, Model._q(this), relation, true, constrain) as HydratingQueryBuilder<InstanceType<T>>
  }

  /**
   * Inverse of {@link Model.whereHas} — rows whose named relation has zero
   * matching children. Same constrain-callback semantics: when present,
   * narrows the "matching" set so `whereDoesntHave` matches "no children
   * matching the constraint" rather than "no children at all".
   */
  static whereDoesntHave<T extends typeof Model>(
    this:      T,
    relation:  string,
    constrain?: (q: QueryBuilder<Model>) => void,
  ): HydratingQueryBuilder<InstanceType<T>> {
    return attachWhereHas(this as typeof Model, Model._q(this), relation, false, constrain) as HydratingQueryBuilder<InstanceType<T>>
  }

  /**
   * `whereHas` + `with` — filter by the relation predicate AND eager-load the
   * matching rows under the same constraint when the adapter supports it
   * (`withConstrained`). Adapters without constrained eager-load fall back to
   * unconstrained `with(relation)` — every related row is returned even if
   * the parent was matched on a narrower predicate.
   */
  static withWhereHas<T extends typeof Model>(
    this:      T,
    relation:  string,
    constrain?: (q: QueryBuilder<Model>) => void,
  ): HydratingQueryBuilder<InstanceType<T>> {
    return attachWithWhereHas(this as typeof Model, Model._q(this), relation, constrain) as HydratingQueryBuilder<InstanceType<T>>
  }

  /**
   * Filter rows whose `belongsTo` relation points at `parent`. Sugar for
   * `where(fk, parent.primaryKeyValue)` with the FK column resolved from the
   * relation declaration. When `relation` is omitted, looks up the single
   * `belongsTo` relation pointing at `parent.constructor` and throws if zero
   * or more-than-one match.
   *
   * @example
   * await Post.whereBelongsTo(user).get()             // posts whose author belongsTo this user (single FK)
   * await Comment.whereBelongsTo(post, 'post').get()  // explicit relation name when ambiguous
   */
  static whereBelongsTo<T extends typeof Model>(
    this:      T,
    parent:    Model,
    relation?: string,
  ): HydratingQueryBuilder<InstanceType<T>> {
    return attachWhereBelongsTo(this as typeof Model, Model._q(this), parent, relation) as HydratingQueryBuilder<InstanceType<T>>
  }

  /**
   * Aggregate eager-loading — count related rows alongside the parent in a
   * single query. The result is stamped onto each parent under
   * `<relation>Count` (`postsCount` for `withCount('posts')`) without dropping
   * into the adapter.
   *
   * Three call shapes:
   *   - `withCount('posts')` — single relation, no constraint.
   *   - `withCount(['posts', 'comments'])` — multiple, no constraints.
   *   - `withCount({ posts: q => q.where('published', true).as('publishedPosts') })`
   *     — map form with `where` constraints + optional alias override.
   *
   * Closes the N+1 footgun for hot list pages. For a single instance use
   * `instance.loadCount('posts')` instead.
   *
   * @example
   * await User.query().withCount('posts').get()                                  // user.postsCount
   * await User.query().withCount({ posts: q => q.where('published', true) }).get()
   * await Post.query().withCount(['comments', 'tags']).paginate(1)
   */
  static withCount<T extends typeof Model>(
    this: T,
    arg:  string | readonly string[] | Record<string, AggregateConstraint>,
  ): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).withCount(arg)
  }

  /**
   * Boolean aggregate — stamps `<relation>Exists` (true/false) onto each
   * parent. Cheap on Prisma (translates to `_count > 0`) and Drizzle
   * (`EXISTS (...)` correlated subquery). Use this instead of `withCount`
   * when you only need presence, not the count.
   */
  static withExists<T extends typeof Model>(
    this: T,
    arg:  string | readonly string[],
  ): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).withExists(arg)
  }

  /**
   * Aggregate eager-loading — sum a column across the related rows.
   * Stamps `<relation>Sum<Column>` onto each parent (e.g.
   * `withSum('orders', 'total')` → `ordersSumTotal`).
   *
   * Map form supports per-relation constraints + alias overrides:
   *
   * ```ts
   * await User.query().withSum({
   *   orders: { column: 'total', constraint: q => q.where('status', 'paid') },
   * }).get()
   * ```
   */
  static withSum<T extends typeof Model>(
    this:    T,
    arg1:    string | Record<string, AggregateSumSpec>,
    column?: string,
  ): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).withSum(arg1, column)
  }

  /** Min of a column across the related rows. Stamps `<relation>Min<Column>`. */
  static withMin<T extends typeof Model>(
    this:    T,
    arg1:    string | Record<string, AggregateSumSpec>,
    column?: string,
  ): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).withMin(arg1, column)
  }

  /** Max of a column across the related rows. Stamps `<relation>Max<Column>`. */
  static withMax<T extends typeof Model>(
    this:    T,
    arg1:    string | Record<string, AggregateSumSpec>,
    column?: string,
  ): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).withMax(arg1, column)
  }

  /** Average of a column across the related rows. Stamps `<relation>Avg<Column>`. */
  static withAvg<T extends typeof Model>(
    this:    T,
    arg1:    string | Record<string, AggregateSumSpec>,
    column?: string,
  ): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).withAvg(arg1, column)
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

  static with<T extends typeof Model>(this: T, ...relations: string[]): HydratingQueryBuilder<InstanceType<T>> {
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
    const value = readField(this, ctor.primaryKey)
    if (value === undefined || value === null) return undefined
    return value as string | number
  }

  /**
   * @internal — current own-property column attributes, with framework `_`
   * keys + `undefined` placeholders dropped. Aggregate-injected keys (stamped
   * by `withCount` / `loadCount` etc.) are excluded — they're not real schema
   * columns and would be rejected by Prisma writes / Drizzle inserts.
   *
   * Single source of truth shared by `_toData()` and dirty-tracking baselines.
   */
  private _currentAttrs(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const aggregates = (this as unknown as Record<symbol, Set<string> | undefined>)[AGGREGATES_SYMBOL]
    for (const [k, v] of Object.entries(this)) {
      if (k.startsWith('_')) continue
      if (v === undefined) continue
      if (aggregates && aggregates.has(k)) continue
      out[k] = v
    }
    return out
  }

  /**
   * @internal — own enumerable data fields, with framework-internal `_` keys
   * stripped and `undefined` values dropped so a class-declared but never-set
   * field (`id!: number`) doesn't leak into a create/update payload.
   */
  private _toData(): Record<string, unknown> {
    return this._currentAttrs()
  }

  /**
   * @internal — return the dirty-tracking baseline, materializing the deferred
   * raw record from hydrate on first access. After materialization (or after
   * an explicit `_syncOriginal()` reset), subsequent calls return the cached
   * snapshot directly.
   */
  private _original(): Record<string, unknown> {
    if (this.#originalRaw === undefined) return this.#originalSnapshot
    const aggregates = (this as unknown as Record<symbol, Set<string> | undefined>)[AGGREGATES_SYMBOL]
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(this.#originalRaw)) {
      if (k.startsWith('_')) continue
      if (v === undefined) continue
      if (aggregates && aggregates.has(k)) continue
      out[k] = v
    }
    this.#originalSnapshot = out
    this.#originalRaw      = undefined
    return out
  }

  /** @internal — capture current attrs as the new dirty-tracking baseline. */
  private _syncOriginal(): void {
    this.#originalSnapshot = this._currentAttrs()
    this.#originalRaw      = undefined
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
    const next: Record<string, unknown> = this._currentAttrs()
    const prev = this._original()
    const diff: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(next), ...Object.keys(prev)])) {
      if (!attrEqual(next[k], prev[k])) diff[k] = next[k]
    }
    this.#changes          = diff
    this.#originalSnapshot = next
    this.#originalRaw      = undefined
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
      if (!k.startsWith('_')) deleteField(this, k)
    }
    Object.assign(this, fresh)
    this.#changes = {}
    this._syncOriginal()
    return this
  }

  /**
   * Delete this instance from the database. Soft-deletes when `static softDeletes`
   * is enabled. Routes through the static `delete()` so observers fire.
   *
   * On soft-delete, the instance's `deletedAt` is set locally and the
   * dirty-tracking baseline is refreshed — so `trashed()` returns `true`
   * and `isDirty()` returns `false` immediately after.
   */
  async delete(): Promise<void> {
    const ctor = this.constructor as typeof Model
    const id = this._getKey()
    if (id === undefined) {
      throw new Error(`[RudderJS ORM] Cannot delete a ${ctor.name} without a primary key.`)
    }
    await (ctor as typeof Model & { delete(i: string | number): Promise<void> }).delete(id)
    if (ctor.softDeletes) {
      writeField(this, 'deletedAt', new Date())
      this._syncOriginal()
    }
  }

  /**
   * Restore this soft-deleted instance — clears `deletedAt` and routes through
   * the static `restore()` so observers fire. Refreshes in-place with the
   * canonical row returned from the database.
   */
  async restore(): Promise<this> {
    const ctor = this.constructor as typeof Model
    const id = this._getKey()
    if (id === undefined) {
      throw new Error(`[RudderJS ORM] Cannot restore a ${ctor.name} without a primary key.`)
    }
    const restored = await (ctor as typeof Model & {
      restore(i: string | number): Promise<Model>
    }).restore(id)
    Object.assign(this, restored)
    this._syncOriginal()
    return this
  }

  /**
   * Persist this instance without firing observer / listener events.
   * Equivalent to `await Model.withoutEvents(() => instance.save())`.
   *
   * Per-class — observers cascading into child classes still fire normally.
   */
  async saveQuietly(): Promise<this> {
    const ctor = this.constructor as typeof Model
    return ctor.withoutEvents(() => this.save())
  }

  /** Delete this instance without firing observer / listener events. */
  async deleteQuietly(): Promise<void> {
    const ctor = this.constructor as typeof Model
    await ctor.withoutEvents(() => this.delete())
  }

  /** Restore this soft-deleted instance without firing observer / listener events. */
  async restoreQuietly(): Promise<this> {
    const ctor = this.constructor as typeof Model
    return ctor.withoutEvents(() => this.restore())
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
    this._syncOriginal()
    return this
  }

  /**
   * Aggregate-load related rows for this single instance. Mutates in place
   * by setting `this[<relation>Count]` (or the `.as(name)` override) and
   * returns `this` for chaining.
   *
   * One round-trip per call. For batched loads on a list, prefer
   * `Model.query().withCount(...)` on the parent query.
   *
   * @example
   * const user = await User.find(1)
   * await user!.loadCount('posts')
   * console.log(user!.postsCount)
   *
   * await user!.loadCount({ posts: q => q.where('published', true).as('publishedPosts') })
   * console.log(user!.publishedPostsCount)
   */
  async loadCount(arg: string | readonly string[] | Record<string, AggregateConstraint>): Promise<this> {
    await loadCountOrExists(this, 'count', arg)
    return this
  }

  /** Boolean aggregate — stamps `<relation>Exists` on the instance. */
  async loadExists(arg: string | readonly string[]): Promise<this> {
    await loadCountOrExists(this, 'exists', arg)
    return this
  }

  /** Sum of `column` across the related rows. Stamps `<relation>Sum<Column>`. */
  async loadSum(arg1: string | Record<string, AggregateSumSpec>, column?: string): Promise<this> {
    await loadNumericAggregate(this, 'sum', arg1, column)
    return this
  }

  /** Min of `column` across the related rows. Stamps `<relation>Min<Column>`. */
  async loadMin(arg1: string | Record<string, AggregateSumSpec>, column?: string): Promise<this> {
    await loadNumericAggregate(this, 'min', arg1, column)
    return this
  }

  /** Max of `column` across the related rows. Stamps `<relation>Max<Column>`. */
  async loadMax(arg1: string | Record<string, AggregateSumSpec>, column?: string): Promise<this> {
    await loadNumericAggregate(this, 'max', arg1, column)
    return this
  }

  /** Average of `column` across the related rows. Stamps `<relation>Avg<Column>`. */
  async loadAvg(arg1: string | Record<string, AggregateSumSpec>, column?: string): Promise<this> {
    await loadNumericAggregate(this, 'avg', arg1, column)
    return this
  }

  /**
   * Eager-load each named relation onto the instance only when the property
   * is currently `null` / `undefined`. Truthy properties are skipped — useful
   * after partial hydration to backfill the relations a downstream consumer
   * needs without refetching what's already there.
   *
   * @example
   * const user = await User.query().with('profile').first()
   * // profile already populated; only `posts` issues a query.
   * await user!.loadMissing('profile', 'posts')
   */
  async loadMissing(...relations: string[]): Promise<this> {
    await loadMissingRelations(this, relations)
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
    this._syncOriginal()
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
      writeField(clone, k, v)
    }
    return clone
  }

  // ── Dirty Tracking ─────────────────────────────────────

  /**
   * Whether any attribute (or the named attribute) has been changed since
   * the last save / load / refresh.
   */
  isDirty(key?: string): boolean {
    const dirty = this.getDirty()
    return key === undefined ? Object.keys(dirty).length > 0 : key in dirty
  }

  /** Inverse of {@link isDirty}. */
  isClean(key?: string): boolean {
    return !this.isDirty(key)
  }

  /**
   * Whether the named attribute (or any attribute) was actually changed on
   * the most recent {@link save}. Stays true until the next save or refresh.
   */
  wasChanged(key?: string): boolean {
    return key === undefined
      ? Object.keys(this.#changes).length > 0
      : key in this.#changes
  }

  /**
   * Snapshot value(s) as of the last save / load / refresh. With a key,
   * returns that single original value; without, returns the full snapshot.
   */
  getOriginal<T = unknown>(key: string): T
  getOriginal(): Record<string, unknown>
  getOriginal<T = unknown>(key?: string): T | Record<string, unknown> {
    const snap = this._original()
    if (key === undefined) return { ...snap }
    return snap[key] as T
  }

  /** Diff map of attributes that changed during the most recent {@link save}. */
  getChanges(): Record<string, unknown> {
    return { ...this.#changes }
  }

  /** Diff map of attributes currently dirty (unsaved). */
  getDirty(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const current = this._currentAttrs()
    const prev    = this._original()
    for (const k of new Set([...Object.keys(current), ...Object.keys(prev)])) {
      if (!attrEqual(current[k], prev[k])) out[k] = current[k]
    }
    return out
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
    const b = other._getKey()
    return a !== undefined && a === b
  }

  /** Inverse of `is()`. */
  isNot(other: Model | null | undefined): boolean {
    return !this.is(other)
  }

  /** True when this instance has been soft-deleted (its `deletedAt` is set). */
  trashed(): boolean {
    const v = readField(this, 'deletedAt')
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

    if (def.type === 'morphTo') {
      const idCol   = `${def.morphName}Id`
      const typeCol = `${def.morphName}Type`
      const idVal   = readField(this, idCol)
      const typeVal = readField(this, typeCol)
      if (idVal === undefined || idVal === null || typeVal === undefined || typeVal === null) {
        throw new Error(`[RudderJS ORM] Cannot resolve morphTo "${name}" on ${ctor.name} — ${idCol}/${typeCol} unset.`)
      }
      const targets = def.types()
      if (targets.length === 0) {
        throw new Error(`[RudderJS ORM] morphTo "${name}" on ${ctor.name}: \`types: () => [...]\` is empty — declare at least one allowed target class.`)
      }
      if (process.env['NODE_ENV'] !== 'production') {
        const seen = new Map<string, string>()
        for (const C of targets) {
          const key = C.morphAlias ?? C.name
          const prev = seen.get(key)
          if (prev) {
            throw new Error(`[RudderJS ORM] morphTo "${name}" on ${ctor.name}: duplicate discriminator "${key}" — both ${prev} and ${C.name} resolve to the same value. Set a distinct \`static morphAlias\` on one.`)
          }
          seen.set(key, C.name)
        }
      }
      const Target = targets.find(C => (C.morphAlias ?? C.name) === String(typeVal))
      if (!Target) {
        throw new Error(`[RudderJS ORM] morphTo "${name}" on ${ctor.name}: unknown ${typeCol} = ${JSON.stringify(typeVal)}. Allowed: ${targets.map(C => C.morphAlias ?? C.name).join(', ')}`)
      }
      return Target.where(Target.primaryKey, idVal) as QueryBuilder<Model>
    }

    // morphOne and morphMany share the same query — the difference is consumer
    // expectation (`first()` vs `get()`). Split into two ifs so TS can narrow
    // each tag literal out of the union for the fall-through branches below.
    if (def.type === 'morphMany') {
      return morphParentQuery(this, ctor, def, name)
    }
    if (def.type === 'morphOne') {
      return morphParentQuery(this, ctor, def, name)
    }

    const Related = def.model() as typeof Model
    const fkCamel = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)

    if (def.type === 'belongsToMany') {
      const meta = resolveBelongsToManyMeta(ctor, Related, def)
      const parentVal = readField(this, meta.parentKey)
      if (parentVal === undefined || parentVal === null) {
        throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${meta.parentKey} is unset.`)
      }
      return belongsToManyDeferredQb(Related, def, meta, parentVal) as QueryBuilder<Model>
    }

    if (def.type === 'morphToMany') {
      const meta = resolveMorphToManyMeta(ctor, Related, def)
      const parentVal = readField(this, meta.parentKey)
      if (parentVal === undefined || parentVal === null) {
        throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${meta.parentKey} is unset.`)
      }
      return morphToManyDeferredQb(Related, def, meta, parentVal) as QueryBuilder<Model>
    }

    if (def.type === 'morphedByMany') {
      const meta = resolveMorphedByManyMeta(ctor, Related, def)
      const parentVal = readField(this, meta.parentKey)
      if (parentVal === undefined || parentVal === null) {
        throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${meta.parentKey} is unset.`)
      }
      return morphedByManyDeferredQb(Related, def, meta, parentVal) as QueryBuilder<Model>
    }

    if (def.type === 'belongsTo') {
      // This model holds the FK; query the related model's PK.
      const fk        = def.foreignKey ?? `${fkCamel(Related.name)}Id`
      const localCol  = def.localKey   ?? fk
      const localVal  = readField(this, localCol)
      if (localVal === undefined || localVal === null) {
        throw new Error(`[RudderJS ORM] Cannot resolve belongsTo "${name}" — ${ctor.name}.${localCol} is unset.`)
      }
      return Related.where(Related.primaryKey, localVal) as QueryBuilder<Model>
    }

    // hasOne / hasMany — related model holds the FK pointing back to us.
    const fk       = def.foreignKey ?? `${fkCamel(ctor.name)}Id`
    const localCol = def.localKey   ?? ctor.primaryKey
    const localVal = readField(this, localCol)
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
    const meta = resolveBelongsToManyMeta(ctor, Related, def)
    const parentVal = readField(parent, meta.parentKey)
    if (parentVal === undefined || parentVal === null) {
      throw new Error(`[RudderJS ORM] Cannot use belongsToMany "${name}" on ${ctor.name} — ${meta.parentKey} is unset.`)
    }
    // Belt-and-suspenders: make sure the auto-method is installed even
    // for instances constructed before any query against this class.
    installBelongsToManyMethods(ctor)
    return makeBelongsToManyAccessor(ctor, Related, def, parentVal)
  }

  /**
   * Pivot-mutation accessor for a `morphToMany` relation (the polymorphic
   * owning side, e.g. `Post.tags()`). Same surface as `belongsToMany` —
   * `attach`/`detach`/`sync` — but every pivot row carries the parent's
   * discriminator (`{morphName}Type`) and every pivot query filters by it.
   *
   * @example
   * class Post extends Model {
   *   static override relations = {
   *     tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
   *   }
   *   tags() { return Model.morphToMany(this, 'tags') }
   * }
   */
  static morphToMany(parent: Model, name: string): MorphToManyAccessor {
    const ctor = parent.constructor as typeof Model
    const def = ctor.relations[name]
    if (!def) {
      throw new Error(`[RudderJS ORM] Relation "${name}" is not defined on ${ctor.name}.`)
    }
    if (def.type !== 'morphToMany') {
      throw new Error(`[RudderJS ORM] Relation "${name}" on ${ctor.name} is "${def.type}", not "morphToMany".`)
    }
    const Related = def.model() as typeof Model
    const meta = resolveMorphToManyMeta(ctor, Related, def)
    const parentVal = readField(parent, meta.parentKey)
    if (parentVal === undefined || parentVal === null) {
      throw new Error(`[RudderJS ORM] Cannot use morphToMany "${name}" on ${ctor.name} — ${meta.parentKey} is unset.`)
    }
    installMorphPivotMethods(ctor)
    return makeMorphToManyAccessor(ctor, Related, def, parentVal)
  }

  /**
   * Pivot-mutation accessor for a `morphedByMany` relation (the inverse
   * polymorphic side, e.g. `Tag.posts()`). Each `morphedByMany` declaration
   * targets one concrete inverse class; declare one relation per target.
   *
   * @example
   * class Tag extends Model {
   *   static override relations = {
   *     posts:  { type: 'morphedByMany' as const, model: () => Post,  pivotTable: 'taggable', morphName: 'taggable' },
   *     videos: { type: 'morphedByMany' as const, model: () => Video, pivotTable: 'taggable', morphName: 'taggable' },
   *   }
   *   posts()  { return Model.morphedByMany(this, 'posts') }
   *   videos() { return Model.morphedByMany(this, 'videos') }
   * }
   */
  static morphedByMany(parent: Model, name: string): MorphedByManyAccessor {
    const ctor = parent.constructor as typeof Model
    const def = ctor.relations[name]
    if (!def) {
      throw new Error(`[RudderJS ORM] Relation "${name}" is not defined on ${ctor.name}.`)
    }
    if (def.type !== 'morphedByMany') {
      throw new Error(`[RudderJS ORM] Relation "${name}" on ${ctor.name} is "${def.type}", not "morphedByMany".`)
    }
    const Related = def.model() as typeof Model
    const meta = resolveMorphedByManyMeta(ctor, Related, def)
    const parentVal = readField(parent, meta.parentKey)
    if (parentVal === undefined || parentVal === null) {
      throw new Error(`[RudderJS ORM] Cannot use morphedByMany "${name}" on ${ctor.name} — ${meta.parentKey} is unset.`)
    }
    installMorphPivotMethods(ctor)
    return makeMorphedByManyAccessor(ctor, Related, def, parentVal)
  }

  /**
   * Build the `{name}Id + {name}Type` payload for a polymorphic write.
   *
   * Spread into `Model.create()` (or any write) on the polymorphic side. The
   * parent must already have a primary-key value — save it first if needed.
   *
   * @example
   * await Comment.create({
   *   body: 'Nice post',
   *   ...Model.morph('commentable', post),
   * })
   * // → { body, commentableId: post.id, commentableType: 'Post' }
   */
  static morph(name: string, parent: Model): Record<string, unknown> {
    const ctor = parent.constructor as typeof Model
    const pk   = readField(parent, ctor.primaryKey)
    if (pk === undefined || pk === null) {
      throw new Error(`[RudderJS ORM] Model.morph("${name}", parent): parent.${ctor.primaryKey} is unset — save the parent first.`)
    }
    return {
      [`${name}Id`]:   pk,
      [`${name}Type`]: ctor.morphAlias ?? ctor.name,
    }
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

    // Fast path — when the model declares no casts / accessors / appends /
    // hidden / visible (the default state for most app Models), skip the
    // multi-pass transform and snapshot the own enumerable properties in a
    // single spread. JSON.stringify already does the equivalent enumeration
    // internally, so this puts model serialization within noise of plain
    // objects. Verified ~2.1× speedup on a 100-row Post.all() payload.
    if (
      this.#instanceVisible === undefined &&
      this.#instanceHidden  === undefined &&
      ctor.appends.length === 0 &&
      ctor.hidden.length  === 0 &&
      ctor.visible.length === 0 &&
      Object.keys(ctor.attributes).length === 0 &&
      Object.keys(ctor.casts).length      === 0
    ) {
      return { ...this } as Record<string, unknown>
    }

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


// ─── Compile-time contract check ───────────────────────────
// Asserts that `Model`'s static surface conforms to the `ModelLike`
// contract from `@rudderjs/contracts`. Downstream tools (admin panels
// with auto-wired CRUD, generic resource browsers, etc.) target
// `ModelLike` so they don't need to depend on `@rudderjs/orm` directly.
// This line will fail to compile if a future change to Model breaks
// that contract.
const _modelSatisfiesContract: ModelLike = Model
void _modelSatisfiesContract
