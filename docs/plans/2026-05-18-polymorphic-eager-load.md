# Polymorphic eager-load — Model-layer fix

**Status:** Plan + implementation in flight
**Owner:** Suleiman
**Surfaced via:** [Perf bench session 2 (2026-05-17)](./../../README.md) — `Post.with('comments').all()` threw `Unknown field 'comments' for include statement on model 'Post'` in playground prod-bundle.

## Why this exists

`@rudderjs/orm`'s eager-load surface (`Model.with(...names)`) was deliberately thin per the architecture rule "*whole-row eager loading stays in the adapter — Prisma's `include` and Drizzle's `with()` handle it natively and type-safely.*"

That holds for **direct** relations (`hasOne` / `hasMany` / `belongsTo` / `belongsToMany`) because those are declared in `schema.prisma` / Drizzle's relations file. It **does not** hold for **polymorphic** relations (`morphOne` / `morphMany` / `morphTo` / `morphToMany` / `morphedByMany`) — these have no FK declared in `schema.prisma` (the discriminator is a string column), so Prisma can't represent them in its `include` graph.

Today every user with polymorphic relations on Prisma is forced into N+1.

## Bench evidence (from perf session 2)

100 `Post` instances, each with 5 polymorphic `Comment`s (morphMany), playground prod-bundle:

| | Time |
|---|---|
| `Post.all()` (no relations) | 0.29 ms |
| `Post.all()` + per-post `.related('comments').get()` (forced N+1) | **15.12 ms** |
| `Post.with('comments').all()` (today) | **throws** |
| `Post.with('comments').all()` (target after fix) | ~0.5 ms (1 IN-clause query) |

Expected speedup: ~30× on the canonical example, generalises to any list endpoint with polymorphic relations.

## Approach — Model-layer, not adapter

The naïve fix would be to extend the contract so `with()` accepts richer specs and let each adapter handle polymorphic shapes. But:

1. **Both adapters** (Prisma + Drizzle) have the same gap — polymorphic relations don't fit `include` / `with` semantics. Putting the fix in two adapters duplicates code.
2. The Model layer **already knows** the relation metadata (`static relations`) — it can detect polymorphic relations and resolve them itself.
3. There's a precedent: `whereHas` for polymorphic relations is resolved in the Model layer via a pre-step that turns the predicate into a flat `WHERE col IN (...)` clause the adapter never sees as polymorphic.

So the fix lives in `@rudderjs/orm`, in `HydratingQueryBuilder._hydratingQb()`:

1. **Intercept `with(...names)`** at the Proxy level (today it falls through to the adapter as a bare chainable).
2. **Partition** names into `adapterNames` (direct relations the adapter knows how to handle) and `polymorphicNames` (the 5 morph shapes).
3. Forward `adapterNames` to the adapter; capture `polymorphicNames` in proxy-scoped state.
4. **After the terminal call** (`find` / `first` / `get` / `all` / `paginate`) returns hydrated instances, run `attachPolymorphicRelations(instances, polymorphicNames)` which fetches + attaches each polymorphic relation in batch.

Every adapter benefits automatically. No contract change.

## Per-relation-shape resolution

For each polymorphic relation, after the parent rows are hydrated:

### `morphMany` / `morphOne` (e.g. `Post.with('comments')`)

```ts
// def: { type: 'morphMany', model: () => Comment, morphName: 'commentable' }
const parentIds = parents.map(p => p[parent.primaryKey])
const morphAlias = ParentClass.morphAlias ?? ParentClass.name
const children = await Comment
  .where(`${def.morphName}Id`, 'IN', parentIds)
  .where(`${def.morphName}Type`, morphAlias)
  .get()
// Group by commentableId; attach as parent[name] (array for morphMany, first or null for morphOne)
```

### `morphTo` (e.g. `Comment.with('commentable')`)

```ts
// def: { type: 'morphTo', morphName: 'commentable', types: () => [Post, Video] }
// Group children by commentableType:
//   { 'post': [c1, c3], 'video': [c2] }
// For each group, look up the target class from def.types(), then:
const targets = await TargetClass.where(TargetClass.primaryKey, 'IN', groupIds).get()
// Build id → target map and attach to each child's `commentable` field.
```

### `morphToMany` (e.g. `Post.with('tags')`)

```ts
// def: { type: 'morphToMany', model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' }
const parentIds = parents.map(p => p[parent.primaryKey])
// Step 1 — pivot rows for these parents under this morph alias
const pivotRows = await PivotQB.from('taggable')
  .where('taggableId', 'IN', parentIds)
  .where('taggableType', parentMorphAlias)
  .get()
// Step 2 — load tag rows for the collected tag ids
const tagIds = pivotRows.map(p => p.tagId)
const tags = await Tag.where('id', 'IN', tagIds).get()
// Group tags by parent via the pivot, attach as parent[name] array.
```

### `morphedByMany` (inverse — e.g. `Tag.with('posts')`)

Mirror of `morphToMany`, swapping the role of parent / related on the pivot.

## Edge cases

1. **Empty parent set** — short-circuit before issuing the IN query (matches what `whereHas`'s `_resolveDeferredIds` does already).
2. **Empty matching set** — children list is `[]` for `morphMany` / `morphToMany`; child[name] is `null` for `morphOne` / `morphTo`.
3. **Soft-deletes on the related table** — call the Model's query path which already applies `deletedAt IS NULL` automatically.
4. **`morphTo` with unknown discriminator** — surface the same error as `instance.related(name)` does today: "*unknown {morphName}Type = X. Allowed: ...*". Don't silently drop.
5. **Mixed `with()` call** — `Post.with('author', 'comments', 'tags')` where `author` is `belongsTo` (direct), `comments` is `morphMany`, `tags` is `morphToMany` → partition routes them appropriately, adapter sees only `with('author')`.
6. **`Post.with('comments').first()` / `.find(id)`** — instances pass through the same `attachPolymorphicRelations` helper; works for single-row terminals too.
7. **`paginate()`** — applies to `result.data`, not the pagination envelope.
8. **`withTrashed()` already chained** — respect on the related table by passing the flag through (the Model's query path checks `withTrashed` state via the standard adapter path — works for free).

## Out of scope (v1)

- **Nested polymorphic eager-load** — `Post.with('comments.author')` — defer. Single-level only this PR.
- **Constrained polymorphic eager-load** — `Post.with('comments', q => q.where(...))` — the contract already has `withConstrained` for direct relations; polymorphic constraint adds another factor. Defer to a follow-up.
- **`Model.load(name)` post-hoc on a single instance** — separate API; not needed by the prod-bundle bench finding.

## File layout

- New: `packages/orm/src/polymorphic-eager-load.ts` — `partitionEagerLoads(ModelClass, names)`, `attachPolymorphicRelations(instances, names)`. Pure logic, no Proxy/QB dependency.
- Modified: `packages/orm/src/index.ts` — `_hydratingQb()` intercepts `with()`, calls the helper on terminal results.
- New tests: `packages/orm/src/polymorphic-eager-load.test.ts` — pure unit tests against a fake adapter capturing the IN-clause queries fired per shape.

## Test plan

Unit (fake adapter captures issued queries):

- [ ] `morphMany`: 1 query per relation regardless of N parents (verify IN-clause + morph-type filter)
- [ ] `morphOne`: same as morphMany but result is first match or null per parent
- [ ] `morphTo`: groups by type, 1 query per distinct type, attaches as object (not array)
- [ ] `morphToMany`: 2 queries (pivot + related), attaches array; pivot type discriminator present
- [ ] `morphedByMany`: 2 queries with swapped pivot roles
- [ ] Mixed `with('author', 'comments')`: adapter sees `['author']`, polymorphic helper handles `['comments']`
- [ ] Empty parent set: zero queries fired (short-circuit)
- [ ] Soft-deleted children excluded by default (related Model's query applies `deletedAt IS NULL`)
- [ ] `morphTo` with unknown discriminator throws the helpful error

Integration (playground, prod-bundle):

- [ ] Re-run the `bench-orm-n1` route: `Post.with('comments').all()` returns 200 with the comments embedded; total time within noise of baseline + ~1 IN query.

## Definition of done

- [ ] Plan doc committed (this file)
- [ ] Helper module + Proxy intercept implemented
- [ ] 9 unit tests passing
- [ ] Existing 389 orm tests still pass
- [ ] Playground bench shows ~30× speedup
- [ ] Changeset (`@rudderjs/orm` minor — new behavior, no breaking change)
- [ ] PR opened with bench numbers
