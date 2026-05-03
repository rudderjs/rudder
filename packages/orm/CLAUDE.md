# @rudderjs/orm

Eloquent-style ORM — Model base class, casts, attributes, scopes, observers, factories, and API resources.

## Key Files

- `src/index.ts` — `Model` base class (query, CRUD, scopes, observers, serialization), decorators, `ModelRegistry`, `ModelNotFoundError`
- `src/cast.ts` — Built-in casts (string, integer, float, boolean, date, json, encrypted) + custom `CastUsing`
- `src/attribute.ts` — `Attribute.make({ get, set })` for computed accessors/mutators
- `src/collection.ts` — `ModelCollection` typed array wrapper with ORM operations
- `src/factory.ts` — `ModelFactory` for testing with states and sequences
- `src/resource.ts` — `JsonResource` / `ResourceCollection` for API response transformation
- `src/seeder.ts` — `Seeder` base class for `db:seed` runner

## Architecture Rules

- **Adapter pattern**: `ModelRegistry.set(adapter)` plugs in the actual DB driver (Prisma adapter lives in playground)
- **Event lifecycle**: `Model.create/update/delete()` trigger observer events; `query().create()` bypasses them. Events: `retrieved`, `creating`/`created`, `updating`/`updated`, `saving`/`saved` (fire on both create+update), `deleting`/`deleted`, `restoring`/`restored`. `Model.withoutEvents(fn)` mutes per-class. **`increment`/`decrement` deliberately do NOT fire observer events** — they're a pure data-plane operation; the observer payload would have to be either the delta or the resolved value, both of which conflict with atomic SQL semantics.
- **Serialization order**: casts (get) → attributes (getter) → appends → visible/hidden filtering → `toJSON()`
- **Mass assignment**: `static fillable` (allowlist) and `static guarded` (denylist; `['*']` locks all) are enforced on `Model.create()`, `Model.update()`, and `instance.fill()` — keys outside the policy are silently dropped. Both default to `[]` (no enforcement, back-compat). `fillable` wins when both are set. Bypass paths: `instance.forceFill(data)` and direct property assignment + `instance.save()` (data set property-by-property is not mass-assignment, so `save()` skips the filter via internal `_doCreate`/`_doUpdate`).
- **Soft deletes**: `delete()` sets `deletedAt`; use `forceDelete()` for real removal
- **Hydration**: every read path (`find`/`first`/`all`/`paginate`/`where(...).get()`/etc.) returns Model instances, not plain records. Instance methods (`save`/`fill`/`refresh`/`delete`/`replicate`/`is`/`isNot`/`trashed`/`related`) work directly on those instances. Use `Model.hydrate(record)` to wrap an external plain record (cached JSON, fixture). Adapters still return plain records — the hydrating QueryBuilder Proxy wraps them at the Model boundary.
- **Relations are deliberately thin**: `static relations` + `instance.related(name)` return a chainable QueryBuilder pre-filtered to the parent record. We do *not* shim eager loading — Prisma's `include` and Drizzle's `with()` already do that natively and type-safely. Relation types: `hasOne`, `hasMany`, `belongsTo`, `belongsToMany`. Polymorphic relations stay out of scope (every Prisma feature we don't shim becomes a gap). The `model: () => Class` thunk is mandatory to dodge circular imports.
- **`belongsToMany`** ships pivot mutations on a per-relation accessor: `attach(ids | {id: pivotData}, flatPivot?)`, `detach(ids?)`, `sync(ids, flatPivot?)`. The accessor auto-installs on the parent prototype on first query (`user.roles().attach(...)`); call `Model.belongsToMany(parent, name)` directly for typed wrappers. Reads via `parent.related('roles')` use a deferred QueryBuilder Proxy — chains stay sync, the pivot lookup runs on terminal evaluation, and mutation methods (`create`/`update`/`delete`/`insertMany`/`deleteAll`) throw with a helpful pointer. v1 deliberately does not surface pivot columns on reads or auto-stamp pivot timestamps; both are gated on real demand. Adapter contract: `QueryBuilder.insertMany(rows)` and `deleteAll()` (returns count) are the generic primitives the M2M layer composes — every adapter implements them.
- **Route model binding**: `static routeKey` (defaults to `'id'`) + `static findForRoute(value)` are the duck-typed surface that `@rudderjs/router`'s `router.bind(name, ModelClass)` consumes. The router doesn't depend on `@rudderjs/orm` — anything with these statics works. Default `findForRoute` runs `Model.where(routeKey, value).first()`; subclasses override the static signature as `Promise<Model | null>` (looser than `InstanceType<T>` so subclass overrides type-check under `exactOptionalPropertyTypes`).
- **Internal fields are `#`-private**: serialization overrides (`#instanceHidden`/`#instanceVisible`) use ECMAScript private syntax so they never appear in `Object.entries`, object spread, or `JSON.stringify` — keeps hydrated instances wire-format clean for Prisma writes and Telescope serialization.
- **`_toData()` filters `undefined`**: a class field declared `id!: number` becomes an enumerable `undefined` own property at construction time; `save()`/`replicate()` drop those so Prisma never sees `id: undefined` on inserts.

## Conventions

- Table name defaults to lowercase class name + `'s'` (User → users)
- Primary key defaults to `'id'`
- `@Hidden`, `@Visible`, `@Appends`, `@Cast` decorators configure serialization
- Only depends on `@rudderjs/contracts` — no runtime DB driver dependency

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
pnpm test       # tsx --test
```
