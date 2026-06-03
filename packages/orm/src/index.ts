import type { AggregateRequest, QueryBuilder, OrmAdapter, PaginatedResult, ModelLike, WhereClause, WhereOperator, RelationExistencePredicate, JoinClause } from '@rudderjs/contracts'
// Type-only — erased at compile, so no runtime `node:async_hooks` import lands in
// the eval graph. The real module is lazy-imported in `ensureTxStorage()`, which
// only runs from `transaction()` — never reached in a client bundle. Keeps the
// Client Bundle Smoke gate green by construction (CLAUDE.md client-bundle rule).
import type { AsyncLocalStorage } from 'node:async_hooks'
import { castGet, castSet, type CastDefinition } from './cast.js'
import { generateUuid, generateUlid } from './keys.js'
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
import { attrEqual, readField, writeField, deleteField } from './utils.js'
// Type-only — `ModelFactory` is re-exported below from './factory.js'. The import
// is erased at compile time, so this does not introduce a runtime import cycle
// (factory.ts already imports types from this module).
import type { ModelFactory } from './factory.js'
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
  hasThroughDeferredQb,
} from './relations/pivot-deferred.js'
import { resolveHasThroughMeta } from './relations/has-through.js'
import { buildRelationDefault, wrapWithDefault, type RelationDefault } from './relations/with-default.js'
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
import { attachDirectRelations } from './direct-eager-load.js'
import {
  CursorPaginator,
  encodeCursor,
  decodeCursor,
  resolveCursorOrders,
  cursorValuesFor,
  applyKeysetFilter,
  type CursorOrder,
  type KeysetBuilder,
} from './cursor-paginator.js'

export type { QueryBuilder, OrmAdapter, OrmAdapterProvider, PaginatedResult, WhereOperator, WhereClause, OrderClause, QueryState, RelationExistencePredicate, AggregateFn, AggregateRequest, AggregateJoinShape, JoinClause } from '@rudderjs/contracts'
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
export { CursorPaginator, encodeCursor, decodeCursor } from './cursor-paginator.js'
export type { CursorOrder }                         from './cursor-paginator.js'
export type { BelongsToManyAccessor, MorphToManyAccessor, MorphedByManyAccessor } from './relations/pivot-accessors.js'
export type { RelationDefault } from './relations/with-default.js'
export type { PivotQueryBuilder } from './relations/pivot-deferred.js'

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
  /**
   * Holds the transaction-scoped adapter for the duration of a
   * `Model.transaction()` callback (see {@link ensureTxStorage}). Lazily created
   * on first use so `node:async_hooks` is never imported at module-eval time —
   * keeping the main entry client-bundle-safe. `null` until the first
   * transaction (and in non-Node runtimes that never call `transaction()`).
   */
  txStorage: AsyncLocalStorage<OrmAdapter> | null
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_orm_registry__']) {
  _g['__rudderjs_orm_registry__'] = {
    adapter:   null,
    models:    new Map(),
    listeners: new Set(),
    txStorage: null,
  } satisfies OrmRegistryStore
}
const _store = _g['__rudderjs_orm_registry__'] as OrmRegistryStore

// A pre-existing store from an older bundle of this module may lack `txStorage`
// (added in the transactions phase). Normalize so the field is always present.
_store.txStorage ??= null

/**
 * Lazily create the `AsyncLocalStorage` that scopes queries to an active
 * transaction. The `node:async_hooks` import is dynamic and only reached from
 * `transaction()`, so the main entry's eval graph stays free of `node:` imports
 * (Client Bundle Smoke gate). Idempotent and shared via `_store`.
 */
async function ensureTxStorage(): Promise<AsyncLocalStorage<OrmAdapter>> {
  if (_store.txStorage) return _store.txStorage
  const { AsyncLocalStorage } = await import('node:async_hooks')
  // Re-check after the await — a concurrent caller may have set it.
  _store.txStorage ??= new AsyncLocalStorage<OrmAdapter>()
  return _store.txStorage
}

/**
 * Run `fn` inside a database transaction. Every `Model` query issued within `fn`
 * (across any model) executes on the transaction's connection — the scoped
 * adapter is threaded through `AsyncLocalStorage`, so existing call sites need no
 * changes. Commits when `fn` resolves; rolls back and re-throws if it rejects.
 * Nested `transaction()` calls map to SAVEPOINTs (inner rollback leaves the outer
 * transaction intact).
 *
 * @example
 * import { transaction } from '@rudderjs/orm'
 * await transaction(async () => {
 *   const user = await User.create({ name: 'Ada' })
 *   await Account.create({ userId: user.id, balance: 0 })
 * }) // both rows commit together, or neither does
 *
 * @throws if the active adapter doesn't implement `transaction()` (capability is
 *   optional on the contract; the native engine supports it).
 */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  const adapter = ModelRegistry.getAdapter()
  if (typeof adapter.transaction !== 'function') {
    throw new Error(
      '[RudderJS ORM] The active database adapter does not support transactions. ' +
      'The native engine (@rudderjs/orm/native) implements them; the Prisma/Drizzle ' +
      'adapters do not expose `transaction()` yet.',
    )
  }
  const storage = await ensureTxStorage()
  return adapter.transaction((txAdapter) => storage.run(txAdapter, fn))
}

// ─── RUDDER_ORM_TRACE — dev diagnostic for the HMR re-boot wedge ──────────────
//
// Set RUDDER_ORM_TRACE=1 to trace the read path. Built to diagnose the
// "booted-ORM path returns empty after a dev re-boot, no error" residual
// (docs/plans/2026-05-24-hmr-reboot-window-...md, REOPEN #2). Three line types:
//   • `[orm] build …`  — at query CONSTRUCTION (query()/_q()), before scopes.
//                        Proves Model.query() was reached. Its ABSENCE for a
//                        request that rendered empty ⇒ the wedge is UPSTREAM of
//                        the ORM (route/resource never queried).
//   • `[orm] <term> … rows=N` — a read terminal (find/first/get/all/paginate)
//                        RESOLVED with N rows (0 = empty result).
//   • `[orm] THREW <term> … :: <err>` — the terminal's adapter call threw
//                        (re-thrown). The wedge is empty-not-error, so something
//                        swallows this upstream; the message names the failure.
// Fields on every line: `class=#N` (Model class IDENTITY — re-imported model =
// new tag), `table=` (class-name → table), `adapter=#M` (the adapter object the
// query was built from — increments per re-boot; a benign swap on its own),
// `softDeletes` / `scopes=[...]` (filters that could empty the set).
// NOTE: `getAdapter()` is NOT a null-throw suspect — nothing in the re-boot path
// calls `ModelRegistry.reset()`, so `_store.adapter` is never nulled.
// Zero overhead when the env var is off (every call early-returns). The class /
// adapter tag maps live in this module, which is externalized (not re-evaluated
// on HMR), so tags stay stable across re-boots — re-imported app/Models/* get
// fresh tags precisely because THEY are re-evaluated. That contrast is the point.
const _ormTrace = typeof process !== 'undefined' && process.env?.['RUDDER_ORM_TRACE'] === '1'
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
function _ormCtx(self: typeof Model, adapter: object | null): string {
  const scopes = Object.keys(self.globalScopes ?? {})
  return `model=${self.name} class=${_tagOf(_classTags, () => ++_classSeq, self)} ` +
    `table=${self.getTable()} adapter=${_tagOf(_adapterTags, () => ++_adapterSeq, adapter)} ` +
    `softDeletes=${self.softDeletes} scopes=[${scopes.join(',')}]`
}
/**
 * Logged at query CONSTRUCTION (in `query()`/`_q()`, right after the adapter
 * builder is obtained, before scopes/terminals). Its presence proves
 * `Model.query()` was actually reached; its ABSENCE for a request that rendered
 * empty means the wedge is *upstream of the ORM* (route handler / resource
 * never queried). This is the REOPEN #2 discriminator — there the wedged query
 * emits NO terminal line at all (plan doc "Probe results"). `getAdapter()`
 * cannot be the null-throw the agent suspected: nothing in the re-boot path
 * calls `ModelRegistry.reset()`, so `_store.adapter` is never nulled.
 */
function ormTraceBuild(self: typeof Model, adapter: object | null): void {
  if (!_ormTrace) return
  console.log(`[orm] build ${_ormCtx(self, adapter)}`)
}
/** Logged when a read terminal's adapter call THROWS (then re-thrown). The
 *  empty-not-error wedge means something swallows this upstream — capturing the
 *  message here names the actual failure (Prisma connection state, etc.). */
function ormTraceThrew(self: typeof Model, terminal: string, err: unknown, adapter: object | null): void {
  if (!_ormTrace) return
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  console.log(`[orm] THREW ${terminal} ${_ormCtx(self, adapter)} :: ${msg}`)
}
function ormTraceTerminal(self: typeof Model, terminal: string, rowCount: number, adapter: object | null): void {
  if (!_ormTrace) return
  console.log(`[orm] ${terminal} ${_ormCtx(self, adapter)} rows=${rowCount}`)
}

export class ModelRegistry {
  static set(adapter: OrmAdapter): void {
    _store.adapter = adapter
  }

  static get(): OrmAdapter | null {
    return _store.adapter
  }

  static getAdapter(): OrmAdapter {
    // Inside a `transaction()` callback, return the transaction-scoped adapter so
    // every query joins the open transaction. `getStore()` is sync and cheap;
    // it's `undefined` outside a transaction (and `txStorage` is `null` until the
    // first transaction ever runs), so the normal path is unaffected.
    const scoped = _store.txStorage?.getStore()
    if (scoped) return scoped
    if (!_store.adapter) {
      throw new Error('[RudderJS ORM] No ORM adapter registered. Did you add a database provider to your providers list?')
    }
    return _store.adapter
  }

  /**
   * Register a Model class so consumers (e.g. Telescope's model collector)
   * can discover it and attach lifecycle listeners.
   *
   * Keyed by `ModelClass.name`. Re-registering the EXACT same class is a no-op;
   * late listeners only fire on the first registration of a name.
   *
   * **Dev HMR re-import:** a re-boot re-evaluates `app/Models/*.ts`, producing a
   * NEW class identity with the same `name`. The old guard (`_store.models.has(name)`)
   * silently ignored it — leaving the registry pointed at the STALE class and the
   * fresh class's `belongsToMany` / morph accessors **never installed** on its
   * prototype. A consumer that introspects the model (e.g. a schema-builder
   * walking relations to render a resource table) then sees a half-wired model
   * and produces an incomplete schema — persistently, with no self-recovery
   * (docs/plans/2026-05-24-hmr-reboot-window-...md REOPEN #2). So a same-name but
   * DIFFERENT-identity class now re-points the registry and re-installs its
   * accessors on the fresh prototype. In production a model is imported once, so
   * `existing` is never a different identity and this never re-runs.
   *
   * Models are also registered lazily on first query (`query()` / `find()` /
   * `all()` / etc), but eager registration in an `AppServiceProvider` lets
   * observers attach before the first request hits.
   */
  static register(ModelClass: typeof Model): void {
    const name = ModelClass.name
    if (!name) return
    const existing = _store.models.get(name)
    if (existing === ModelClass) return // exact same class already registered
    const reimport = existing !== undefined // same name, fresh identity (dev HMR)
    _store.models.set(name, ModelClass)
    installBelongsToManyMethods(ModelClass)
    installMorphPivotMethods(ModelClass)
    // First registration → notify listeners (e.g. Telescope's model collector).
    // A dev re-import skips this: the name is already known, and re-firing risks
    // double-subscription in listeners. The accessors above are re-installed on
    // the fresh prototype regardless — that's what the re-imported identity needs.
    if (!reimport) for (const listener of _store.listeners) listener(name, ModelClass)
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
      /**
       * Null-object default for a `belongsTo` / `hasOne` that resolves to no
       * row (Laravel's `->withDefault()`). `true` → empty instance; an object →
       * instance with those attributes; a callback `(instance, parent) => void`
       * → customise per parent. Applies on both lazy (`related().first()`) and
       * eager (`with()`) reads. Ignored on `hasMany` (its default is `[]`).
       */
      withDefault?: RelationDefault
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
      /**
       * Reach a distant relation *through* an intermediate model.
       * `Country → hasManyThrough(Post, User)` walks `countries.id = users.countryId`
       * then `users.id = posts.userId`. `hasOneThrough` is the same join with a
       * single-row result.
       */
      type:            'hasOneThrough' | 'hasManyThrough'
      /** Lazy reference to the far/related model class (`Post`). */
      model:           () => typeof Model
      /** Lazy reference to the intermediate model class (`User`). */
      through:         () => typeof Model
      /** FK on the *through* table pointing at the parent. Default: `${camelCase(Parent)}Id` (`countryId`). */
      firstKey?:       string
      /** FK on the *related* table pointing at the through row. Default: `${camelCase(Through)}Id` (`userId`). */
      secondKey?:      string
      /** Local key on the parent joined against `firstKey`. Default: `Parent.primaryKey` (`id`). */
      localKey?:       string
      /** Local key on the through model joined against `secondKey`. Default: `Through.primaryKey` (`id`). */
      secondLocalKey?: string
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

/** Global-registry symbol the hydrating Proxy answers with its wrapped adapter
 *  QB. The native `union(other)` reads it to unwrap a passed proxy. Defined via
 *  `Symbol.for` in both places (here + the native QB) so no runtime value needs
 *  to cross the node-only/client-reachable module boundary. */
const QB_TARGET = Symbol.for('rudderjs.orm.qb.target')

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
  /** OR-rooted {@link whereHas} — `... OR EXISTS(relation)`. */
  orWhereHas(relation: string, constrain?: (q: QueryBuilder<Model>) => void): this
  /** OR-rooted {@link whereDoesntHave}. */
  orWhereDoesntHave(relation: string, constrain?: (q: QueryBuilder<Model>) => void): this
  /**
   * Count comparison on a relation — `has('posts', '>=', 3)` keeps rows whose
   * `posts` count satisfies the operator. Defaults to `>= 1` (≡ `whereHas`).
   * Native only; throws on Drizzle/Prisma (no count-filter in their query APIs).
   */
  has(relation: string, operator?: WhereOperator, count?: number, constrain?: (q: QueryBuilder<Model>) => void): this
  /** OR-rooted {@link has}. */
  orHas(relation: string, operator?: WhereOperator, count?: number, constrain?: (q: QueryBuilder<Model>) => void): this
  withWhereHas(relation: string, constrain?: (q: QueryBuilder<Model>) => void): this
  whereBelongsTo(parent: Model, relation?: string): this
  withCount(arg: string | readonly string[] | Record<string, AggregateConstraint>): this
  withExists(arg: string | readonly string[]): this
  withSum(arg1: string | Record<string, AggregateSumSpec>, arg2?: string): this
  withMin(arg1: string | Record<string, AggregateSumSpec>, arg2?: string): this
  withMax(arg1: string | Record<string, AggregateSumSpec>, arg2?: string): this
  withAvg(arg1: string | Record<string, AggregateSumSpec>, arg2?: string): this

  // ── where-sugar (Model-layer; composed from where/whereGroup/orderBy) ──
  /** `WHERE col IN (...)`. Sugar for `where(col, 'IN', values)`. */
  whereIn(column: string, values: readonly unknown[]): this
  /** `WHERE col NOT IN (...)`. */
  whereNotIn(column: string, values: readonly unknown[]): this
  /** OR-rooted `IN`. */
  orWhereIn(column: string, values: readonly unknown[]): this
  /** OR-rooted `NOT IN`. */
  orWhereNotIn(column: string, values: readonly unknown[]): this
  /** `WHERE col IS NULL`. */
  whereNull(column: string): this
  /** `WHERE col IS NOT NULL`. */
  whereNotNull(column: string): this
  /** OR-rooted `IS NULL`. */
  orWhereNull(column: string): this
  /** OR-rooted `IS NOT NULL`. */
  orWhereNotNull(column: string): this
  /** `WHERE col BETWEEN a AND b` (inclusive). Compiles to a grouped `>= a AND <= b`. */
  whereBetween(column: string, range: readonly [unknown, unknown]): this
  /** `WHERE col NOT BETWEEN a AND b`. Compiles to a grouped `< a OR > b`. */
  whereNotBetween(column: string, range: readonly [unknown, unknown]): this
  /** OR-rooted `BETWEEN`. */
  orWhereBetween(column: string, range: readonly [unknown, unknown]): this
  /** OR-rooted `NOT BETWEEN`. */
  orWhereNotBetween(column: string, range: readonly [unknown, unknown]): this
  /**
   * Compare two columns — `WHERE "a" = "b"`, both sides identifier-quoted per
   * dialect (unlike {@link whereRaw}, which is verbatim). Two-arg form is
   * equality; three-arg carries the operator. Throws on the Prisma adapter
   * (no column-vs-column in its query API) — use `whereRaw`/`DB.select` there.
   */
  whereColumn(left: string, right: string): this
  whereColumn(left: string, operator: WhereOperator, right: string): this
  /** OR-rooted {@link whereColumn}. */
  orWhereColumn(left: string, right: string): this
  orWhereColumn(left: string, operator: WhereOperator, right: string): this

  // ── joins + structured projection ──
  /**
   * Restrict the projection to specific columns — `select('users.id',
   * 'posts.title')`. Each is identifier-quoted (qualified `table.col` works) and
   * REPLACES the default `*`; accumulates with {@link QueryBuilder.selectRaw}.
   * **Native engine only** — throws on Drizzle/Prisma (their typed clients can't
   * map an arbitrary projection back to a model); use `DB.select(...)` there.
   */
  select(...columns: string[]): this
  /**
   * `SELECT DISTINCT` — de-duplicate the result rows. With `distinct()`,
   * `count()` / `paginate()` count the distinct rows. **Native engine only** —
   * throws on Drizzle/Prisma.
   */
  distinct(): this
  /**
   * `INNER JOIN`. Simple form `join('posts', 'posts.userId', '=', 'users.id')`
   * (operator defaults to `=` in the two-column form) or callback form
   * `join('posts', (j) => j.on(...).where(...))` for compound ON clauses.
   * **Native engine only** — throws on Drizzle/Prisma (use the native engine or
   * `DB.select(...)`).
   */
  join(table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): this
  /** `LEFT JOIN` — same call forms as {@link join}. Native engine only. */
  leftJoin(table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): this
  /** `RIGHT JOIN` — same call forms as {@link join}. Native engine only. */
  rightJoin(table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): this
  /** `CROSS JOIN` (Cartesian product, no ON). Native engine only. */
  crossJoin(table: string): this
  /**
   * `GROUP BY col [, …]` — columns identifier-quoted (qualified `table.col` ok).
   * With a GROUP BY present, `count()`/`paginate()` count the number of groups.
   * **Native engine only** — throws on Drizzle/Prisma.
   */
  groupBy(...columns: string[]): this
  /**
   * `HAVING col <op> value` — filter grouped rows (or a SELECT alias on engines
   * that allow it). Two-arg form is equality; the value binds. For an aggregate
   * predicate use {@link havingRaw}. **Native engine only.**
   */
  having(column: string, value: unknown): this
  having(column: string, operator: WhereOperator, value: unknown): this
  /** OR-rooted {@link having}. */
  orHaving(column: string, value: unknown): this
  orHaving(column: string, operator: WhereOperator, value: unknown): this
  /** `HAVING <raw>` — portable aggregate filter, e.g. `havingRaw('COUNT(*) > ?', [3])`. */
  havingRaw(sql: string, bindings?: readonly unknown[]): this
  /** OR-rooted {@link havingRaw}. */
  orHavingRaw(sql: string, bindings?: readonly unknown[]): this
  /**
   * `… UNION …` — combine this query with `other` (duplicate rows removed). The
   * combined result takes THIS query's `ORDER BY` / `LIMIT` / `OFFSET`; the
   * member's own are ignored. `other` is another native query (`Model.query()`).
   * **Native engine only** — throws on Drizzle/Prisma.
   */
  union(other: QueryBuilder<Model>): this
  /** `… UNION ALL …` — like {@link union} but keeps duplicate rows. */
  unionAll(other: QueryBuilder<Model>): this
  /**
   * Apply `callback` only when `value` is truthy (otherwise run `otherwise`, if
   * given). The callback receives this builder + the value, so clauses compose
   * conditionally without breaking the chain. Mirrors Laravel's `when`.
   *
   * ```ts
   * User.query().when(role, (q, r) => q.where('role', r)).get()
   * ```
   */
  when<V>(value: V, callback: (q: this, value: V) => void, otherwise?: (q: this, value: V) => void): this
  /** Inverse of {@link when} — runs `callback` when `value` is falsy. */
  unless<V>(value: V, callback: (q: this, value: V) => void, otherwise?: (q: this, value: V) => void): this
  /** `ORDER BY col DESC` (default column `createdAt`). */
  latest(column?: string): this
  /** `ORDER BY col ASC` (default column `createdAt`). */
  oldest(column?: string): this
  /** Resolve the query and return a flat array of one column's values. */
  pluck<K extends keyof T>(column: K): Promise<T[K][]>
  pluck(column: string): Promise<unknown[]>
  /** Resolve the first row and return one column's value (or `undefined`). */
  value<K extends keyof T>(column: K): Promise<T[K] | undefined>
  value(column: string): Promise<unknown>
  /** `SELECT SUM(col)` scalar terminal (0 on an empty set). */
  sum(column: string): Promise<number>
  /** `SELECT MAX(col)` scalar terminal (null on an empty set). */
  max(column: string): Promise<number | null>
  /** `SELECT MIN(col)` scalar terminal (null on an empty set). */
  min(column: string): Promise<number | null>
  /** `SELECT AVG(col)` scalar terminal (null on an empty set). */
  avg(column: string): Promise<number | null>
  /** Whether any row matches the current constraints. */
  exists(): Promise<boolean>
  /** Whether no row matches the current constraints. */
  doesntExist(): Promise<boolean>
  /**
   * Process the result set in memory-bounded pages. Re-runs the query with
   * `LIMIT size OFFSET n` per page and invokes `callback` with each page's
   * hydrated rows. Returning `false` from the callback stops early.
   * Resolves `true` if it ran to completion, `false` if the callback bailed.
   *
   * Like Laravel's `chunk`, results rely on a consistent sort — add an
   * `orderBy` (ideally on a unique column) so pages don't overlap or skip when
   * rows shift between pages. `chunk` overrides any `limit`/`offset` already on
   * the query.
   */
  chunk(size: number, callback: (rows: T[]) => void | boolean | Promise<void | boolean>): Promise<boolean>
  /**
   * Stream the result set one row at a time as an async iterator, fetching
   * `size` rows per underlying page (default 1000). Pairs with `chunk` as the
   * large-dataset pattern:
   *
   * ```ts
   * for await (const user of User.query().orderBy('id').lazy()) { … }
   * ```
   *
   * Same sort caveat as `chunk` — add an `orderBy` for stable paging.
   */
  lazy(size?: number): AsyncGenerator<T, void, undefined>
  /**
   * Keyset (cursor) pagination. Requires at least one `orderBy()` — throws
   * otherwise. Returns a {@link CursorPaginator} page; pass its `nextCursor`
   * back in to fetch the next page. Forward-only in v1 (`prevCursor` is null).
   */
  cursorPaginate(perPage?: number, cursor?: string | null): Promise<CursorPaginator<T>>
}

// ─── Generated schema registry (GATE 7-types) ──────────────

/**
 * Generated schema registry — table name → column types. Empty by default;
 * `rudder schema:types` (run automatically after `migrate`) emits
 * `app/Models/__schema/registry.d.ts`, which augments this interface via
 * `declare module '@rudderjs/orm'` with one entry per migrated table:
 *
 * ```ts
 * // AUTO-GENERATED — app/Models/__schema/registry.d.ts
 * declare module '@rudderjs/orm' {
 *   interface SchemaRegistry {
 *     users: { id: number; name: string; email: string; createdAt: Date | null }
 *   }
 * }
 * ```
 *
 * Columns become the single source of truth (the migration), so a model's field
 * types are generated rather than hand-maintained — they can't drift. Mirrors
 * `@rudderjs/vite`'s scanner emitting `pages/__view/registry.d.ts`. Until the
 * file exists this is empty and everything behaves exactly as before.
 *
 * Reference a generated table shape directly with {@link SchemaColumns} (e.g.
 * `SchemaColumns<'users'>`), or — the headline DX — bind it onto a model with
 * {@link Model.for} so the model needs ZERO hand-declared column fields:
 *
 * ```ts
 * export class User extends Model.for<'users'>() {
 *   static override table = 'users'
 *   // no id!/name!/email! — those come from the generated registry
 * }
 *
 * const u = await User.find(1)   // u.name, u.email, … fully typed
 * ```
 */
// Deliberately empty — this is the augmentation TARGET. The generated
// `app/Models/__schema/registry.d.ts` fills it in via `declare module`, exactly
// like @rudderjs/vite's RouteRegistry. An empty interface is the correct shape
// here (a type alias can't be augmented by module declaration merging).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SchemaRegistry {}

/** The generated column shape for a registry table name, or an empty shape when
 *  the table isn't in the registry yet (so references degrade gracefully
 *  pre-generation). */
export type SchemaColumns<TName extends string> =
  TName extends keyof SchemaRegistry ? SchemaRegistry[TName] : Record<string, never>

// ─── Model Base Class ──────────────────────────────────────

export abstract class Model {
  /** The table name — defaults to lowercase class name + 's' */
  static table: string

  /** Primary key column */
  static primaryKey = 'id'

  /**
   * Primary-key value type. `'int'` (the default) is a database-assigned
   * auto-increment — the ORM never sets it on insert. `'uuid'` and `'ulid'`
   * are application-generated: when the primary key is unset on
   * `Model.create()` / `instance.save()`, the ORM stamps a fresh value before
   * the insert (Laravel's `HasUuids` / `HasUlids` traits).
   *
   * ```ts
   * class ApiToken extends Model {
   *   static override keyType = 'ulid'   // sortable 26-char Crockford Base32
   * }
   * await ApiToken.create({ name: 'ci' })   // id auto-filled, no DB sequence
   * ```
   *
   * Pair with a matching schema column (`table.uuid('id').primary()` /
   * `table.ulid('id').primary()`); the value type here only governs generation.
   */
  static keyType: 'int' | 'uuid' | 'ulid' = 'int'

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

  /**
   * The factory class linked to this model, enabling the `Model.factory()`
   * entry point. Set it on the model subclass:
   *
   * ```ts
   * class User extends Model {
   *   static factoryClass = UserFactory
   * }
   * await User.factory().state('admin').create()   // ≡ UserFactory.new()...
   * ```
   *
   * Left unset, `factory()` throws a clear error pointing here.
   */
  // `ModelFactory<any>` (not `<Record<string, unknown>>`) so a concrete factory
  // like `UserFactory extends ModelFactory<{ name: string }>` assigns without
  // tripping the generic's invariant `states()`/`with()` parameter positions —
  // same reason the make:factory scaffolder stub uses `<any>`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static factoryClass?: { new (): ModelFactory<any> }

  /**
   * Return a fresh factory for this model — the Laravel-style entry point.
   * Equivalent to `<Model>Factory.new()` and chains the same verbs
   * (`.state()`, `.with()`, `.has()`, `.for()`, `.create()`, `.make()`).
   *
   * Requires `static factoryClass = <Model>Factory` on the subclass.
   */
  static factory<T extends typeof Model>(this: T): ModelFactory<Record<string, unknown>> {
    const Fc = (this as typeof Model).factoryClass
    if (!Fc) {
      throw new Error(`[RudderJS ORM] No factory linked to ${this.name}. Add \`static factoryClass = ${this.name}Factory\` to the model, or call ${this.name}Factory.new() directly.`)
    }
    return new Fc()
  }

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

  /**
   * Bind a generated table's column types onto a model (GATE 7-types). Extend the
   * returned base instead of `Model` directly and the model's **instances carry
   * the table's columns** — no hand-declared fields, no drift against the
   * migration:
   *
   * ```ts
   * export class User extends Model.for<'users'>() {
   *   static override table = 'users'
   * }
   *
   * const u = await User.find(1)               // u.id / u.name / u.email typed
   * await User.where('active', true).first()   // chains are typed too
   * await User.create({ name, email })         // unknown columns fail tsc
   * ```
   *
   * The column shape comes from {@link SchemaRegistry}, which the generated
   * `app/Models/__schema/registry.d.ts` augments (run `rudder schema:types`, or
   * let `migrate` do it). `static casts` refine the storage type — the generator
   * already folds them in, so a `boolean`/`date`/`json` cast surfaces as
   * `boolean`/`Date`/the cast's type rather than the raw column affinity.
   *
   * Purely additive and type-level: at runtime this returns the class unchanged,
   * so there is no behavioral difference from `extends Model`. Models that don't
   * call `.for()` (and the loose `extends Model` form) keep working exactly as
   * before — hand-declared fields are untouched.
   *
   * Resolves migrations-plan open-decision #1 in favour of the generic-style
   * binding (over `static table` inference) — it covers static finders AND
   * query-builder chains in one shape without touching the existing signatures.
   */
  static for<TName extends string>(
    this: typeof Model,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): (abstract new (...args: any[]) => Model & SchemaColumns<TName>) & typeof Model {
    // `any[]` (not `unknown[]`) in the construct signature is load-bearing: TS
    // requires a subclass's base constructor return type to match `Model`'s, and
    // only `any[]` args make the synthesized abstract ctor compatible (an
    // `unknown[]` ctor trips TS2510 "Base constructors must all have the same
    // return type"). The cast is contained to this one line.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this as unknown as (abstract new (...args: any[]) => Model & SchemaColumns<TName>) & typeof Model
  }

  /** @internal — wrap a QueryBuilder so its read methods return Model instances. */
  private static _hydratingQb<T extends typeof Model>(self: T, qb: QueryBuilder<InstanceType<T>>, traceAdapter?: object | null): HydratingQueryBuilder<InstanceType<T>> {
    const ModelClass  = self as typeof Model
    const _traceAdapter = traceAdapter ?? null
    /** Aliases stamped onto rows by the adapter for any aggregates registered
     *  on this QB. Tagged on each hydrated instance via `aggregateKeysOf` so
     *  `_toData()` excludes them on writes. */
    const aggregateAliases = new Set<string>()
    /** Eager-load names the Model layer resolves after the terminal returns
     *  hydrated parents (see `./polymorphic-eager-load.ts` +
     *  `./direct-eager-load.ts`). Polymorphic names always land here; direct
     *  relations land here only on a `'model-layer'` adapter (Drizzle), else
     *  they're forwarded to the adapter's native `with()` in the same call. */
    const polymorphicWiths: string[] = []
    const directWiths:      string[] = []
    /** `with()`'d single-result relations (`belongsTo`/`hasOne`) declaring a
     *  `withDefault` — applied after the terminal returns, substituting the
     *  null-object default for any parent whose relation came back null. Runs
     *  for every adapter strategy (the relation may be resolved natively by the
     *  adapter or by the Model-layer loader; either way the value lands on the
     *  instance before this post-pass inspects it). */
    const relationDefaults: Array<{ name: string; Related: typeof Model; spec: RelationDefault }> = []
    /** Order terms recorded as `orderBy()` is called on this proxy, in call
     *  order. The adapter QB exposes no public getter for its recorded sort, so
     *  `cursorPaginate` reads this to build the keyset WHERE. Each call is still
     *  forwarded to the underlying QB unchanged. */
    const recordedOrders: CursorOrder[] = []
    /** Adapter eager-load strategy. `'native'` (Prisma, or no adapter on a
     *  detached sub-builder) forwards direct relations to the adapter;
     *  `'model-layer'` (Drizzle) batches them here. */
    const eagerStrategy: 'native' | 'model-layer' =
      (_traceAdapter as { eagerLoadStrategy?: 'native' | 'model-layer' } | null)?.eagerLoadStrategy ?? 'native'
    const attachPoly = async (instances: InstanceType<T>[]): Promise<void> => {
      if (polymorphicWiths.length > 0) {
        await attachPolymorphicRelations(ModelClass, instances as ReadonlyArray<Model>, polymorphicWiths)
      }
      if (directWiths.length > 0) {
        await attachDirectRelations(ModelClass, instances as ReadonlyArray<Model>, directWiths)
      }
      if (relationDefaults.length > 0) {
        for (const inst of instances) {
          for (const { name, Related, spec } of relationDefaults) {
            if (readField(inst, name) == null) {
              writeField(inst, name, buildRelationDefault(Related, spec, inst as unknown as Model))
            }
          }
        }
      }
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
        // Unwrap to the underlying adapter QB — `union(otherQuery)` reads this on
        // the passed proxy so the native builder can splice the member's state.
        // Matches the `Symbol.for` the native QB uses (no cross-module import).
        if (prop === QB_TARGET) return target
        // ORM-side chainables that don't exist on the adapter QB itself —
        // intercept before the existence check below, since `whereHas` etc.
        // are added by this proxy, not by the adapter.
        // Keyset (cursor) pagination — an ORM-only terminal that isn't on the
        // adapter QB (built entirely on where/orderBy/limit/get at the Model
        // layer), so it must be intercepted before the `typeof value` guard
        // below. Forward-only in v1: nextCursor advances, prevCursor is always
        // null. See ./cursor-paginator.ts.
        if (prop === 'cursorPaginate') {
          return async (perPage = 15, cursor?: string | null): Promise<CursorPaginator<InstanceType<T>>> => {
            try {
              const { orders, appendedPrimaryKey } = resolveCursorOrders(recordedOrders, ModelClass.primaryKey)
              // The PK tiebreaker, when appended, must also land on the actual
              // query so the SQL sort matches the keyset predicate's column set.
              if (appendedPrimaryKey) (target as QueryBuilder<InstanceType<T>>).orderBy(ModelClass.primaryKey, 'ASC')
              if (cursor != null && cursor !== '') {
                const boundary = decodeCursor(cursor)
                for (const o of orders) {
                  if (!(o.column in boundary)) {
                    throw new Error(`[RudderJS ORM] cursorPaginate(): cursor is missing order column "${o.column}" — it was generated for a different orderBy() set.`)
                  }
                }
                applyKeysetFilter(target as unknown as KeysetBuilder, orders, boundary)
              }
              ;(target as QueryBuilder<InstanceType<T>>).limit(perPage + 1)
              const rows = (await (target as QueryBuilder<InstanceType<T>>).get()) as unknown[]
              const hasMore = rows.length > perPage
              const pageRows = hasMore ? rows.slice(0, perPage) : rows
              const data = wrapMany(pageRows)
              ormTraceTerminal(ModelClass, 'cursorPaginate', data.length, _traceAdapter)
              await attachPoly(data)
              const last = pageRows[pageRows.length - 1] as Record<string, unknown> | undefined
              const nextCursor = hasMore && last ? encodeCursor(cursorValuesFor(last, orders)) : null
              return new CursorPaginator<InstanceType<T>>(data, perPage, nextCursor, null, hasMore)
            } catch (e) { ormTraceThrew(ModelClass, 'cursorPaginate', e, _traceAdapter); throw e }
          }
        }
        // Record order terms so `cursorPaginate` can build a keyset WHERE — the
        // adapter QB has no public getter for its recorded sort. Still forwarded
        // to the underlying QB so every other terminal sorts identically.
        if (prop === 'orderBy') {
          return (column: string, direction?: 'ASC' | 'DESC'): QueryBuilder<InstanceType<T>> => {
            recordedOrders.push({ column, direction: direction === 'DESC' ? 'desc' : 'asc' })
            ;(target as QueryBuilder<InstanceType<T>>).orderBy(column, direction)
            return proxy
          }
        }
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
        if (prop === 'orWhereHas') {
          return (relation: string, constrain?: (q: QueryBuilder<Model>) => void): QueryBuilder<InstanceType<T>> => {
            attachWhereHas(ModelClass, target as QueryBuilder<Model>, relation, true, constrain, { boolean: 'OR' })
            return proxy
          }
        }
        if (prop === 'orWhereDoesntHave') {
          return (relation: string, constrain?: (q: QueryBuilder<Model>) => void): QueryBuilder<InstanceType<T>> => {
            attachWhereHas(ModelClass, target as QueryBuilder<Model>, relation, false, constrain, { boolean: 'OR' })
            return proxy
          }
        }
        if (prop === 'has' || prop === 'orHas') {
          const boolean = prop === 'orHas' ? 'OR' : 'AND'
          return (relation: string, operator: WhereOperator = '>=', count = 1, constrain?: (q: QueryBuilder<Model>) => void): QueryBuilder<InstanceType<T>> => {
            attachWhereHas(ModelClass, target as QueryBuilder<Model>, relation, true, constrain, { boolean, count: { operator, value: count } })
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
            const { adapter, polymorphic, direct } = partitionEagerLoads(ModelClass, names, eagerStrategy)
            for (const n of polymorphic) if (!polymorphicWiths.includes(n)) polymorphicWiths.push(n)
            for (const n of direct)      if (!directWiths.includes(n))      directWiths.push(n)
            if (adapter.length > 0) {
              ;(target as QueryBuilder<unknown>).with(...adapter)
            }
            // Record single-result `withDefault` relations for the post-terminal
            // null-object substitution (runs regardless of adapter strategy).
            for (const n of names) {
              const d = ModelClass.relations[n]
              if (!d || (d.type !== 'belongsTo' && d.type !== 'hasOne')) continue
              if (d.withDefault === undefined) continue
              if (relationDefaults.some(r => r.name === n)) continue
              relationDefaults.push({ name: n, Related: d.model(), spec: d.withDefault })
            }
            return proxy
          }
        }
        // where-sugar — named where variants + conditional clauses + scalar
        // terminals, composed from the adapter QB's existing primitives
        // (where/orWhere/whereGroup/orderBy/get/first/_aggregate). Implemented
        // here off the adapter contract so every adapter gets them for free.
        {
          const q = target as QueryBuilder<InstanceType<T>>
          switch (prop) {
            case 'whereIn':         return (c: string, v: readonly unknown[]) => { q.where(c, 'IN', v as unknown[]); return proxy }
            case 'whereNotIn':      return (c: string, v: readonly unknown[]) => { q.where(c, 'NOT IN', v as unknown[]); return proxy }
            case 'orWhereIn':       return (c: string, v: readonly unknown[]) => { q.orWhere(c, 'IN', v as unknown[]); return proxy }
            case 'orWhereNotIn':    return (c: string, v: readonly unknown[]) => { q.orWhere(c, 'NOT IN', v as unknown[]); return proxy }
            case 'whereNull':       return (c: string) => { q.where(c, '=', null); return proxy }
            case 'whereNotNull':    return (c: string) => { q.where(c, '!=', null); return proxy }
            case 'orWhereNull':     return (c: string) => { q.orWhere(c, '=', null); return proxy }
            case 'orWhereNotNull':  return (c: string) => { q.orWhere(c, '!=', null); return proxy }
            case 'whereBetween':    return (c: string, [a, b]: [unknown, unknown]) => { q.whereGroup(g => { g.where(c, '>=', a).where(c, '<=', b) }); return proxy }
            case 'whereNotBetween': return (c: string, [a, b]: [unknown, unknown]) => { q.whereGroup(g => { g.where(c, '<', a).orWhere(c, '>', b) }); return proxy }
            case 'orWhereBetween':  return (c: string, [a, b]: [unknown, unknown]) => { q.orWhereGroup(g => { g.where(c, '>=', a).where(c, '<=', b) }); return proxy }
            case 'orWhereNotBetween': return (c: string, [a, b]: [unknown, unknown]) => { q.orWhereGroup(g => { g.where(c, '<', a).orWhere(c, '>', b) }); return proxy }
            case 'latest':          return (c = 'createdAt') => { q.orderBy(c, 'DESC'); return proxy }
            case 'oldest':          return (c = 'createdAt') => { q.orderBy(c, 'ASC'); return proxy }
            case 'when':            return (val: unknown, cb: (q: unknown, v: unknown) => void, otherwise?: (q: unknown, v: unknown) => void) => { if (val) cb?.(proxy, val); else otherwise?.(proxy, val); return proxy }
            case 'unless':          return (val: unknown, cb: (q: unknown, v: unknown) => void, otherwise?: (q: unknown, v: unknown) => void) => { if (!val) cb?.(proxy, val); else otherwise?.(proxy, val); return proxy }
            case 'pluck':           return async (c: string): Promise<unknown[]> => wrapMany(await q.get()).map(r => (r as Record<string, unknown>)[c])
            case 'value':           return async (c: string): Promise<unknown> => { const r = wrapMaybe(await q.first()); return r ? (r as Record<string, unknown>)[c] : undefined }
            case 'sum':             return (c: string) => q._aggregate('sum', c)
            case 'max':             return (c: string) => q._aggregate('max', c)
            case 'min':             return (c: string) => q._aggregate('min', c)
            case 'avg':             return (c: string) => q._aggregate('avg', c)
            case 'exists':          return () => q._aggregate('exists')
            case 'doesntExist':     return async (): Promise<boolean> => !(await q._aggregate('exists'))
          }
        }
        // `chunk` / `lazy` — memory-bounded iteration. Both page the SAME query
        // via LIMIT/OFFSET (mutating `target`'s limit/offset each pass) and reuse
        // the `get` hydration path (wrapMany + attachPoly). Implemented here, off
        // the adapter contract, since they compose existing QB primitives.
        const fetchPage = async (size: number, offset: number): Promise<InstanceType<T>[]> => {
          ;(target as QueryBuilder<InstanceType<T>>).limit(size).offset(offset)
          const page = wrapMany(await (target as QueryBuilder<InstanceType<T>>).get())
          await attachPoly(page)
          return page
        }
        if (prop === 'chunk') {
          return async (
            size: number,
            callback: (rows: InstanceType<T>[]) => void | boolean | Promise<void | boolean>,
          ): Promise<boolean> => {
            if (!Number.isInteger(size) || size <= 0) {
              throw new Error('[RudderJS ORM] chunk(size, callback): size must be a positive integer.')
            }
            let offset = 0
            for (;;) {
              const page = await fetchPage(size, offset)
              ormTraceTerminal(ModelClass, 'chunk', page.length, _traceAdapter)
              if (page.length === 0) break
              const result = await callback(page)
              if (result === false) return false
              if (page.length < size) break
              offset += size
            }
            return true
          }
        }
        if (prop === 'lazy') {
          return (size = 1000): AsyncGenerator<InstanceType<T>, void, undefined> => {
            if (!Number.isInteger(size) || size <= 0) {
              throw new Error('[RudderJS ORM] lazy(size): size must be a positive integer.')
            }
            async function* generate(): AsyncGenerator<InstanceType<T>, void, undefined> {
              let offset = 0
              for (;;) {
                const page = await fetchPage(size, offset)
                ormTraceTerminal(ModelClass, 'lazy', page.length, _traceAdapter)
                if (page.length === 0) break
                for (const row of page) yield row
                if (page.length < size) break
                offset += size
              }
            }
            return generate()
          }
        }
        const value = Reflect.get(target, prop, receiver) as unknown
        if (typeof value !== 'function') return value

        switch (prop) {
          case 'find':
            return async (id: number | string): Promise<InstanceType<T> | null> => {
              try {
                const inst = wrapMaybe(await (target as QueryBuilder<InstanceType<T>>).find(id))
                ormTraceTerminal(ModelClass, 'find', inst ? 1 : 0, _traceAdapter)
                if (inst) await attachPoly([inst])
                return inst
              } catch (e) { ormTraceThrew(ModelClass, 'find', e, _traceAdapter); throw e }
            }
          case 'first':
            return async (): Promise<InstanceType<T> | null> => {
              try {
                const inst = wrapMaybe(await (target as QueryBuilder<InstanceType<T>>).first())
                ormTraceTerminal(ModelClass, 'first', inst ? 1 : 0, _traceAdapter)
                if (inst) await attachPoly([inst])
                return inst
              } catch (e) { ormTraceThrew(ModelClass, 'first', e, _traceAdapter); throw e }
            }
          case 'get':
            return async (): Promise<InstanceType<T>[]> => {
              try {
                const insts = wrapMany(await (target as QueryBuilder<InstanceType<T>>).get())
                ormTraceTerminal(ModelClass, 'get', insts.length, _traceAdapter)
                await attachPoly(insts)
                return insts
              } catch (e) { ormTraceThrew(ModelClass, 'get', e, _traceAdapter); throw e }
            }
          case 'all':
            return async (): Promise<InstanceType<T>[]> => {
              try {
                const insts = wrapMany(await (target as QueryBuilder<InstanceType<T>>).all())
                ormTraceTerminal(ModelClass, 'all', insts.length, _traceAdapter)
                await attachPoly(insts)
                return insts
              } catch (e) { ormTraceThrew(ModelClass, 'all', e, _traceAdapter); throw e }
            }
          case 'paginate':
            return async (page?: number, perPage?: number): Promise<PaginatedResult<InstanceType<T>>> => {
              try {
                const r = await (target as QueryBuilder<InstanceType<T>>).paginate(page ?? 1, perPage)
                const data = wrapMany(r.data)
                ormTraceTerminal(ModelClass, 'paginate', data.length, _traceAdapter)
                await attachPoly(data)
                return { ...r, data }
              } catch (e) { ormTraceThrew(ModelClass, 'paginate', e, _traceAdapter); throw e }
            }
          case 'count':
            // Traced so it doesn't fall through to `default` as an untraced
            // terminal: a list view's count query (total / badge) would otherwise
            // log a `build` with no matching terminal line and look like a
            // "dropped" paginate (REOPEN #2 rerun artifact). `rows=` is the count.
            return async (): Promise<number> => {
              try {
                const n = await (target as QueryBuilder<InstanceType<T>>).count()
                ormTraceTerminal(ModelClass, 'count', n, _traceAdapter)
                return n
              } catch (e) { ormTraceThrew(ModelClass, 'count', e, _traceAdapter); throw e }
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

  /**
   * Run `fn` inside a database transaction. Convenience alias for the exported
   * `transaction()` free function — `User.transaction(fn)` reads naturally at a
   * model call site. Every `Model` query inside `fn` (any model) joins the
   * transaction; commits on resolve, rolls back and re-throws on reject. Nested
   * calls map to SAVEPOINTs. Throws if the active adapter lacks transaction
   * support (native supports it).
   */
  static transaction<T>(fn: () => Promise<T>): Promise<T> {
    return transaction(fn)
  }

  static query<T extends typeof Model>(this: T): HydratingQueryBuilder<InstanceType<T>> & { scope(name: string, ...args: unknown[]): HydratingQueryBuilder<InstanceType<T>>; withoutGlobalScope(name: string): HydratingQueryBuilder<InstanceType<T>> } {
    ModelRegistry.register(this)
    const modelClass = this as typeof Model
    const localScopes = modelClass.scopes
    const globalScopes = modelClass.globalScopes
    const excludedScopes = new Set<string>()

    const buildScoped = (): HydratingQueryBuilder<InstanceType<T>> => {
      const adapter = ModelRegistry.getAdapter()
      ormTraceBuild(modelClass, adapter as object)
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
    ormTraceBuild(ModelClass, adapter as object)
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

  // ── where-sugar static entry points (mirror the HydratingQueryBuilder sugar) ──
  static whereIn<T extends typeof Model>(this: T, column: string, values: readonly unknown[]): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).whereIn(column, values)
  }
  static whereNotIn<T extends typeof Model>(this: T, column: string, values: readonly unknown[]): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).whereNotIn(column, values)
  }
  static whereNull<T extends typeof Model>(this: T, column: string): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).whereNull(column)
  }
  static whereNotNull<T extends typeof Model>(this: T, column: string): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).whereNotNull(column)
  }
  static whereBetween<T extends typeof Model>(this: T, column: string, range: readonly [unknown, unknown]): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).whereBetween(column, range)
  }
  static whereNotBetween<T extends typeof Model>(this: T, column: string, range: readonly [unknown, unknown]): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).whereNotBetween(column, range)
  }
  static whereColumn<T extends typeof Model>(this: T, left: string, right: string): HydratingQueryBuilder<InstanceType<T>>
  static whereColumn<T extends typeof Model>(this: T, left: string, operator: WhereOperator, right: string): HydratingQueryBuilder<InstanceType<T>>
  static whereColumn<T extends typeof Model>(this: T, left: string, operatorOrRight: WhereOperator | string, right?: string): HydratingQueryBuilder<InstanceType<T>> {
    return (right === undefined
      ? Model._q(this).whereColumn(left, operatorOrRight)
      : Model._q(this).whereColumn(left, operatorOrRight as WhereOperator, right))
  }
  // ── join / select entry points (native engine only) ──
  static select<T extends typeof Model>(this: T, ...columns: string[]): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).select(...columns)
  }
  static distinct<T extends typeof Model>(this: T): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).distinct()
  }
  static join<T extends typeof Model>(this: T, table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).join(table, first, operator, second)
  }
  static leftJoin<T extends typeof Model>(this: T, table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).leftJoin(table, first, operator, second)
  }
  static rightJoin<T extends typeof Model>(this: T, table: string, first: string | ((join: JoinClause) => void), operator?: WhereOperator, second?: string): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).rightJoin(table, first, operator, second)
  }
  static crossJoin<T extends typeof Model>(this: T, table: string): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).crossJoin(table)
  }
  static groupBy<T extends typeof Model>(this: T, ...columns: string[]): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).groupBy(...columns)
  }
  static having<T extends typeof Model>(this: T, column: string, value: unknown): HydratingQueryBuilder<InstanceType<T>>
  static having<T extends typeof Model>(this: T, column: string, operator: WhereOperator, value: unknown): HydratingQueryBuilder<InstanceType<T>>
  static having<T extends typeof Model>(this: T, column: string, operatorOrValue: WhereOperator | unknown, value?: unknown): HydratingQueryBuilder<InstanceType<T>> {
    return (value === undefined
      ? Model._q(this).having(column, operatorOrValue)
      : Model._q(this).having(column, operatorOrValue as WhereOperator, value))
  }
  static havingRaw<T extends typeof Model>(this: T, sql: string, bindings?: readonly unknown[]): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).havingRaw(sql, bindings)
  }
  static latest<T extends typeof Model>(this: T, column?: string): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).latest(column)
  }
  static oldest<T extends typeof Model>(this: T, column?: string): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).oldest(column)
  }
  static when<T extends typeof Model, V>(this: T, value: V, callback: (q: HydratingQueryBuilder<InstanceType<T>>, value: V) => void, otherwise?: (q: HydratingQueryBuilder<InstanceType<T>>, value: V) => void): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).when(value, callback, otherwise)
  }
  static unless<T extends typeof Model, V>(this: T, value: V, callback: (q: HydratingQueryBuilder<InstanceType<T>>, value: V) => void, otherwise?: (q: HydratingQueryBuilder<InstanceType<T>>, value: V) => void): HydratingQueryBuilder<InstanceType<T>> {
    return Model._q(this).unless(value, callback, otherwise)
  }
  static pluck<T extends typeof Model>(this: T, column: string): Promise<unknown[]> {
    return Model._q(this).pluck(column)
  }
  static value<T extends typeof Model>(this: T, column: string): Promise<unknown> {
    return Model._q(this).value(column)
  }
  static sum<T extends typeof Model>(this: T, column: string): Promise<number> {
    return Model._q(this).sum(column)
  }
  static max<T extends typeof Model>(this: T, column: string): Promise<number | null> {
    return Model._q(this).max(column)
  }
  static min<T extends typeof Model>(this: T, column: string): Promise<number | null> {
    return Model._q(this).min(column)
  }
  static avg<T extends typeof Model>(this: T, column: string): Promise<number | null> {
    return Model._q(this).avg(column)
  }
  static exists<T extends typeof Model>(this: T): Promise<boolean> {
    return Model._q(this).exists()
  }
  static doesntExist<T extends typeof Model>(this: T): Promise<boolean> {
    return Model._q(this).doesntExist()
  }

  /**
   * Keyset (cursor) pagination, Laravel-style. The bare static call orders by
   * the primary key so it has a deterministic sort; chain `.orderBy(...)` for a
   * custom sort (`Model.query().orderBy('createdAt', 'desc').cursorPaginate(...)`).
   * Returns a {@link CursorPaginator} — pass `result.nextCursor` back in to walk
   * forward. Forward-only in v1 (`prevCursor` is always null).
   */
  static async cursorPaginate<T extends typeof Model>(this: T, perPage = 15, cursor: string | null = null): Promise<CursorPaginator<InstanceType<T>>> {
    const self = this as typeof Model
    const result = await Model._q(this).orderBy(self.primaryKey, 'ASC').cursorPaginate(perPage, cursor)
    for (const r of result.data) await self._fireEvent('retrieved', r as Record<string, unknown>)
    return result
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

  /** OR-rooted {@link Model.whereHas}. */
  static orWhereHas<T extends typeof Model>(this: T, relation: string, constrain?: (q: QueryBuilder<Model>) => void): HydratingQueryBuilder<InstanceType<T>> {
    return attachWhereHas(this as typeof Model, Model._q(this), relation, true, constrain, { boolean: 'OR' }) as HydratingQueryBuilder<InstanceType<T>>
  }

  /** OR-rooted {@link Model.whereDoesntHave}. */
  static orWhereDoesntHave<T extends typeof Model>(this: T, relation: string, constrain?: (q: QueryBuilder<Model>) => void): HydratingQueryBuilder<InstanceType<T>> {
    return attachWhereHas(this as typeof Model, Model._q(this), relation, false, constrain, { boolean: 'OR' }) as HydratingQueryBuilder<InstanceType<T>>
  }

  /**
   * Count comparison on a relation — `Post.has('comments', '>=', 3)`. Defaults
   * to `>= 1` (≡ {@link Model.whereHas}). Native only; Drizzle/Prisma throw.
   */
  static has<T extends typeof Model>(this: T, relation: string, operator: WhereOperator = '>=', count = 1, constrain?: (q: QueryBuilder<Model>) => void): HydratingQueryBuilder<InstanceType<T>> {
    return attachWhereHas(this as typeof Model, Model._q(this), relation, true, constrain, { count: { operator, value: count } }) as HydratingQueryBuilder<InstanceType<T>>
  }

  /** OR-rooted {@link Model.has}. */
  static orHas<T extends typeof Model>(this: T, relation: string, operator: WhereOperator = '>=', count = 1, constrain?: (q: QueryBuilder<Model>) => void): HydratingQueryBuilder<InstanceType<T>> {
    return attachWhereHas(this as typeof Model, Model._q(this), relation, true, constrain, { boolean: 'OR', count: { operator, value: count } }) as HydratingQueryBuilder<InstanceType<T>>
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
   * Bulk insert-or-update — Laravel's `Model.upsert(values, uniqueBy, update)`.
   * Inserts every row; on a unique-key conflict (the `uniqueBy` columns) updates
   * the `update` columns from the incoming values instead of failing. Resolves to
   * the number of rows affected.
   *
   * - `uniqueBy` — a single column name or an array; a matching unique
   *   constraint/index must exist (the underlying `ON CONFLICT` / Prisma compound
   *   key requires it).
   * - `update` — columns to overwrite on conflict. Defaults to every inserted
   *   column except the `uniqueBy` keys. An empty list means insert-or-ignore.
   *
   * **No mass-assignment filtering** — like `insertMany`, this is a bulk
   * statement and `fillable`/`guarded` do **not** apply. Write-side casts and
   * attribute mutators (`boolean`/`date`/`json`, custom setters) ARE applied per
   * row. Observer events do **not** fire (pure data-plane, matching `insertMany`
   * / `increment`).
   *
   * One atomic statement on native + Drizzle (`ON CONFLICT … DO UPDATE` /
   * `ON DUPLICATE KEY UPDATE`); the Prisma adapter batches a per-row upsert in a
   * single transaction. Throws if the active adapter lacks `upsert`.
   *
   * @example
   * await User.upsert(
   *   [{ email: 'a@x.com', name: 'A' }, { email: 'b@x.com', name: 'B' }],
   *   'email',           // conflict target
   *   ['name'],          // overwrite name on conflict; leave the rest
   * )
   */
  static async upsert<T extends typeof Model>(
    this: T,
    rows: Array<Partial<InstanceType<T>>>,
    uniqueBy: string | string[],
    update?: string[],
  ): Promise<number> {
    const self = this as typeof Model
    if (rows.length === 0) return 0
    const keys = Array.isArray(uniqueBy) ? uniqueBy : [uniqueBy]

    // Apply write-time casts/mutators per row (no mass-assignment filter — bulk op).
    const prepared = rows.map(r => self._applyMutators(r as Record<string, unknown>))

    // Default update set = every inserted column except the conflict keys.
    let updateCols = update
    if (!updateCols) {
      const cols: string[] = []
      const seen = new Set<string>()
      for (const row of prepared) {
        for (const k of Object.keys(row)) {
          if (!seen.has(k)) { seen.add(k); cols.push(k) }
        }
      }
      updateCols = cols.filter(c => !keys.includes(c))
    }

    const q = Model._q(this) as QueryBuilder<InstanceType<T>>
    if (typeof q.upsert !== 'function') {
      throw new Error(`[RudderJS ORM] The active adapter does not support upsert() (called on ${self.name}).`)
    }
    return q.upsert(prepared as Partial<InstanceType<T>>[], keys, updateCols)
  }

  /**
   * Process every row in memory-bounded pages — `User.chunk(200, rows => …)`.
   * Convenience entry for `Model.query().chunk(...)`; see the QueryBuilder method
   * for paging semantics (add an `orderBy` for stable pages). Returning `false`
   * from the callback stops early.
   */
  static chunk<T extends typeof Model>(
    this: T,
    size: number,
    callback: (rows: InstanceType<T>[]) => void | boolean | Promise<void | boolean>,
  ): Promise<boolean> {
    return Model._q(this).chunk(size, callback)
  }

  /**
   * Stream every row one at a time — `for await (const u of User.lazy()) …`.
   * Convenience entry for `Model.query().lazy(size)` (default page size 1000).
   */
  static lazy<T extends typeof Model>(this: T, size?: number): AsyncGenerator<InstanceType<T>, void, undefined> {
    return Model._q(this).lazy(size)
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

  /**
   * @internal — stamp an application-generated primary key when `keyType` is
   * `'uuid'` / `'ulid'` and the key is unset. No-op for the default `'int'`
   * (database auto-increment) or when the caller already supplied a value.
   */
  private static _ensureGeneratedKey(payload: Record<string, unknown>): Record<string, unknown> {
    if (this.keyType !== 'uuid' && this.keyType !== 'ulid') return payload
    const pk = this.primaryKey
    const existing = payload[pk]
    if (existing !== undefined && existing !== null) return payload
    return { ...payload, [pk]: this.keyType === 'uuid' ? generateUuid() : generateUlid() }
  }

  /** @internal — create path that skips the fillable filter. Used by `save()`. */
  private static async _doCreate<T extends typeof Model>(this: T, data: Record<string, unknown>): Promise<InstanceType<T>> {
    const self = this as typeof Model
    let payload = self._applyMutators(data)
    payload = self._ensureGeneratedKey(payload)

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
      throw new Error(`[RudderJS ORM] Cannot refresh a ${ctor.name} without a primary key. Call .save() / Model.create() first so a primary key is assigned.`)
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
      throw new Error(`[RudderJS ORM] Cannot delete a ${ctor.name} without a primary key. Call .save() / Model.create() first so a primary key is assigned.`)
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
      throw new Error(`[RudderJS ORM] Cannot restore a ${ctor.name} without a primary key. Call .save() / Model.create() first so a primary key is assigned.`)
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
      throw new Error(`[RudderJS ORM] Cannot increment a ${ctor.name} without a primary key. Call .save() / Model.create() first so a primary key is assigned.`)
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
      throw new Error(`[RudderJS ORM] Cannot decrement a ${ctor.name} without a primary key. Call .save() / Model.create() first so a primary key is assigned.`)
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
        throw new Error(`[RudderJS ORM] Cannot resolve morphTo "${name}" on ${ctor.name} — ${idCol}/${typeCol} is null/undefined. Save the morph host first, or assign both columns before calling .related().`)
      }
      const targets = def.types()
      if (targets.length === 0) {
        throw new Error(`[RudderJS ORM] morphTo "${name}" on ${ctor.name}: \`types: () => [...]\` is empty — declare at least one allowed target class.`)
      }
      if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production') {
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
        throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${meta.parentKey} is null/undefined. Either save the parent first, or include that column in your select() list when reading the parent.`)
      }
      return belongsToManyDeferredQb(Related, def, meta, parentVal) as QueryBuilder<Model>
    }

    if (def.type === 'morphToMany') {
      const meta = resolveMorphToManyMeta(ctor, Related, def)
      const parentVal = readField(this, meta.parentKey)
      if (parentVal === undefined || parentVal === null) {
        throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${meta.parentKey} is null/undefined. Either save the parent first, or include that column in your select() list when reading the parent.`)
      }
      return morphToManyDeferredQb(Related, def, meta, parentVal) as QueryBuilder<Model>
    }

    if (def.type === 'morphedByMany') {
      const meta = resolveMorphedByManyMeta(ctor, Related, def)
      const parentVal = readField(this, meta.parentKey)
      if (parentVal === undefined || parentVal === null) {
        throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${meta.parentKey} is null/undefined. Either save the parent first, or include that column in your select() list when reading the parent.`)
      }
      return morphedByManyDeferredQb(Related, def, meta, parentVal) as QueryBuilder<Model>
    }

    if (def.type === 'hasOneThrough' || def.type === 'hasManyThrough') {
      const meta = resolveHasThroughMeta(ctor, def)
      const localVal = readField(this, meta.localKey)
      if (localVal === undefined || localVal === null) {
        throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${meta.localKey} is null/undefined. Either save the parent first, or include that column in your select() list when reading the parent.`)
      }
      return hasThroughDeferredQb(meta, localVal)
    }

    if (def.type === 'belongsTo') {
      // This model holds the FK; query the related model's PK.
      const fk        = def.foreignKey ?? `${fkCamel(Related.name)}Id`
      const localCol  = def.localKey   ?? fk
      const localVal  = readField(this, localCol)
      // A null FK is a legitimate "no related row" when `withDefault` is set —
      // the query yields nothing and the default takes over. `undefined` still
      // throws: it means the column wasn't loaded, a usage error either way.
      if (localVal === undefined || (localVal === null && def.withDefault === undefined)) {
        throw new Error(`[RudderJS ORM] Cannot resolve belongsTo "${name}" — ${ctor.name}.${localCol} is null/undefined. Either save the parent first, or include that column in your select() list when reading the parent.`)
      }
      const base = Related.where(Related.primaryKey, localVal) as QueryBuilder<Model>
      return def.withDefault === undefined
        ? base
        : wrapWithDefault(base, () => buildRelationDefault(Related, def.withDefault!, this))
    }

    // hasOne / hasMany — related model holds the FK pointing back to us.
    // (TS can't drop the two-literal `through` member via the early return above,
    // so narrow positively to the simple has/belongsTo shape.)
    const simpleDef = def as Extract<RelationDefinition, { type: 'hasOne' | 'hasMany' | 'belongsTo' }>
    const fk       = simpleDef.foreignKey ?? `${fkCamel(ctor.name)}Id`
    const localCol = simpleDef.localKey   ?? ctor.primaryKey
    const localVal = readField(this, localCol)
    if (localVal === undefined || localVal === null) {
      throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${localCol} is null/undefined. Either save the parent first, or include that column in your select() list when reading the parent.`)
    }
    const base = Related.where(fk, localVal) as QueryBuilder<Model>
    // `withDefault` only applies to the single-result `hasOne`; `hasMany`
    // ignores it (an empty list is its own null-object).
    return simpleDef.type === 'hasOne' && simpleDef.withDefault !== undefined
      ? wrapWithDefault(base, () => buildRelationDefault(Related, simpleDef.withDefault!, this))
      : base
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
