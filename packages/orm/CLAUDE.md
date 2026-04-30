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
- **Hydration**: every read path (`find`/`first`/`all`/`paginate`/`where(...).get()`/etc.) returns Model instances, not plain records. Instance methods (`save`/`fill`/`refresh`/`delete`/`replicate`/`is`/`isNot`/`trashed`) work directly on those instances. Use `Model.hydrate(record)` to wrap an external plain record (cached JSON, fixture). Adapters still return plain records — the hydrating QueryBuilder Proxy wraps them at the Model boundary.
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
