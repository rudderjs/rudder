---
"@rudderjs/orm": minor
---

Hydrate query results into Model instances. Every read path (`find`/`first`/`all`/`paginate`/`where(...).first()`/`where(...).get()`/`create`/`update`/`restore`/`firstOrCreate`/`updateOrCreate`) now returns objects that are `instanceof Model` and carry the prototype chain. Adapters still return plain records — the Model wraps the QueryBuilder via a Proxy, so Prisma and Drizzle adapters didn't change.

New instance methods on every hydrated record:

- `save()` — inserts when the primary key is unset, otherwise updates. Routes through the static path so observers fire.
- `fill(data)` — mass-assigns without persisting.
- `refresh()` — re-reads the row and replaces fields in place. Throws `ModelNotFoundError` when the row is gone.
- `delete()` — routes through the static so soft deletes and `deleting`/`deleted` observers behave the same as `Model.delete(id)`.
- `replicate(except?)` — clones the instance without the primary key, `createdAt`/`updatedAt`/`deletedAt`, or any extra keys passed in.
- `is(other)` / `isNot(other)` — identity by table + primary key.
- `trashed()` — true when `deletedAt` is set.

`Model.hydrate(record)` is the public escape hatch for wrapping plain records that didn't come through the adapter (cached JSON, fixtures).

Internal serialization overrides moved from `_instanceHidden`/`_instanceVisible` to ECMAScript private (`#instanceHidden`/`#instanceVisible`) so they never appear in `Object.entries`, object spread, or `JSON.stringify`. `JSON.stringify(user)` and `Object.entries(user)` now produce wire-format-clean output suitable for direct Prisma writes and Telescope serialization.

Note for downstream tests: assertions like `assert.deepStrictEqual(result, plainObject)` no longer hold for query results — node's `deepStrictEqual` checks prototypes. Compare via `{ ...result }` or assert `result instanceof Model`.
