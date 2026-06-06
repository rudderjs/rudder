---
name: orm-models
description: Creating Eloquent-style models, queries, relationships, casts, factories, and API resources in RudderJS
license: MIT
appliesTo:
  - '@rudderjs/orm'
  - '@rudderjs/orm-prisma'
trigger: creating or editing a `Model` class under `app/Models/`, writing queries / relationships, defining casts / accessors / factories, or building `JsonResource` API resources
skip: a route handler that only reads a model — controller-views is enough
metadata:
  author: rudderjs
---

# ORM Models

## When to use this skill

Load when you're creating or editing a `Model` class under `app/Models/`, writing queries, defining casts / accessors / factories, or building `JsonResource` API resources. For depth, open the rule file matching your task.

## Quick Reference

| Task | Open |
|---|---|
| Define a model — `static table`, `fillable`, `hidden`, `casts`, soft deletes, decorators, custom casts | `rules/defining-models.md` |
| Query the database — `find` / `where` / `paginate`, eager loading, scopes, soft-delete filters | `rules/querying.md` |
| CRUD + observers — `create` / `update` / `delete`, observer lifecycle, atomic counters | `rules/crud-and-observers.md` |
| Test data — `ModelFactory`, `sequence`, states, `.make()` vs `.create()` | `rules/factories.md` |
| API output — `JsonResource`, `ResourceCollection`, `when` / `whenLoaded` / `mergeWhen` | `rules/resources.md` |

## Key concepts (load once)

- **Adapter pattern** — `ModelRegistry.set(adapter)` plugs in the DB driver. `@rudderjs/orm` has no runtime DB dependency.
- **Hydration** — every read (`find`/`first`/`all`/`where(...).get()`/`paginate`) returns Model instances, not plain records. Use `Model.hydrate(record)` to wrap external data (cached JSON, fixtures).
- **Mass assignment** — `static fillable` (allowlist) / `static guarded` (denylist; `['*']` locks all) drop keys outside policy on `create` / `update` / `fill`. `instance.forceFill` bypasses.
- **Observers** — `Model.create/update/delete` fire lifecycle events. `query().create()` bypasses them. `increment` / `decrement` deliberately do **not** fire — pure data-plane operations.
- **Built-in casts**: `'string'`, `'integer'`, `'float'`, `'boolean'`, `'date'`, `'datetime'`, `'json'`, `'array'`, `'collection'`, `'encrypted'`, `'encrypted:array'`, `'encrypted:object'`. Encrypted casts need `@rudderjs/crypt`.

## Examples

See `playground/app/Models/User.ts` for a working model and `playground/routes/console.ts` for factory-based seeding.
