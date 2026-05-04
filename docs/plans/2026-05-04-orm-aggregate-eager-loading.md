# `@rudderjs/orm` — Aggregate Eager Loading (`withCount` / `withSum` / `loadCount` …)

**Status:** PROPOSED — design + implementation contract.
**Author handoff:** filed for the next rudder agent. Self-contained.
**Scope:** v1 = `withCount`, `withSum`, `withMin`, `withMax`, `withAvg`, `withExists` on the QueryBuilder + `loadCount`/`loadSum`/etc. and `loadMissing` on instances. Closure constraints supported. Nested-relation aggregates (`withCount('posts.comments')`) deferred.

---

## Why this exists

`packages/orm/CLAUDE.md` line 23 currently says:

> Relations are deliberately thin … We do *not* shim eager loading — Prisma's `include` and Drizzle's `with()` already do that natively and type-safely.

That stays true for **whole-row eager loading**. Aggregate eager loading is a different shape: the parent gets a single scalar column (`postsCount`, `commentsSumScore`, `lastSeenMaxLoggedAt`) rather than an array of nested rows. Two reasons that's worth shimming:

1. **Hot list pages.** Admin tables, dashboards, mailbox-style indexes — every row needs `replies_count` / `unread_sum` next to it. The N+1 pattern (`for (const p of posts) p.replyCount = await Reply.where('post_id', p.id).count()`) is the single most common ORM perf cliff in Laravel apps; `withCount` is the canonical fix.
2. **Adapter divergence is too wide to push to userland.** Prisma exposes `_count` / `_sum` natively in `select`/`include`. Drizzle has no such sugar — you write a correlated subselect by hand. A `User.query().withCount('posts')` call that *just works* across both adapters is the entire payoff. Without the shim, half of `@rudderjs/orm`'s premise (adapter portability for fluent reads) leaks.

Pilotiq's table widgets and Telescope's user/job lists already want this; both currently work around it by issuing a second query per row. Existing memo `feedback_use_framework_packages.md` says: improve framework packages instead of reinventing — that's the trigger here.

---

## Naming convention (matches Laravel exactly)

Aggregate columns are stamped onto the parent record under deterministic, framework-owned names. **Snake_case is a deliberate Laravel-parity exception** — these are framework-injected attribute names users will type literally; matching the Laravel name buys docs/grep-ability for migrating users without touching any user-defined column. (Aside: this is not the polymorphic-column situation where the column lives in the schema and the user picks the name; here the framework owns the namespace.)

| Method | Column | Example |
|---|---|---|
| `withCount('posts')` | `postsCount` | snake-equivalent: `posts_count` |
| `withSum('posts', 'views')` | `postsSumViews` | `posts_sum_views` |
| `withMin('orders', 'total')` | `ordersMinTotal` | `orders_min_total` |
| `withMax('logins', 'createdAt')` | `loginsMaxCreatedAt` | `logins_max_created_at` |
| `withAvg('reviews', 'rating')` | `reviewsAvgRating` | `reviews_avg_rating` |
| `withExists('subscription')` | `subscriptionExists` (bool) | `subscription_exists` |

**Decision: camelCase**, mirroring the polymorphic-relations rule already in the codebase (`commentableId`, `commentableType`). Single naming convention for ORM-injected columns. The Laravel snake form appears only in CHANGELOG migration notes.

**Aliasing.** Constraint-form callers can override the suffix when they need to:

```ts
// "publishedPostsCount" instead of "postsCount"
await User.query()
  .withCount({ posts: q => q.where('published', true).as('publishedPosts') })
  .get()
```

The `.as(name)` setter on the constraint builder rewrites the suffix only — the verb segment (`Count`/`SumX`/etc.) is preserved so `publishedPosts` becomes `publishedPostsCount`.

---

## Public API

### Query-builder methods (six)

```ts
// In @rudderjs/contracts QueryBuilder<T>:
withCount(relation: string): this
withCount(relations: readonly string[]): this
withCount(relations: Record<string, AggregateConstraint>): this

withSum(relation: string, column: string): this
withSum(relations: Record<string, { column: string; constraint?: AggregateConstraint }>): this

withMin(relation: string, column: string): this
withMax(relation: string, column: string): this
withAvg(relation: string, column: string): this

withExists(relation: string): this
withExists(relations: readonly string[]): this
```

`AggregateConstraint` is `(q: QueryBuilder<unknown>) => QueryBuilder<unknown>` — receives a fresh builder for the related table that the caller chains `where`/`whereNot`/etc. on. Plus an optional `.as(name)` extension that mutates the alias prefix.

### Instance methods (three families)

```ts
// On Model.prototype:
async loadCount(relation: string | string[] | Record<string, AggregateConstraint>): Promise<this>
async loadSum  (relation: string, column: string): Promise<this>
async loadMin  (relation: string, column: string): Promise<this>
async loadMax  (relation: string, column: string): Promise<this>
async loadAvg  (relation: string, column: string): Promise<this>
async loadExists(relation: string | string[]): Promise<this>

async loadMissing(...relations: string[]): Promise<this>
```

`loadCount` and friends mutate the instance in place: after `await user.loadCount('posts')`, `user.postsCount` is set. Returns `this` for chainability.

`loadMissing(name)` is the only one that loads *full relations* (not aggregates) — it's grouped here because the cross-cut "load this if I haven't already" use case is the same. Skips the load if `this[name]` is already populated (truthy and non-null).

### Type signatures (Model statics)

`Model.query()` is already typed `QueryBuilder<InstanceType<T>>`. The new methods extend that interface; `T` does NOT widen to include the injected columns — they're typed as `Record<string, unknown>` lookups on the result. Tightening the result type would require either a fluent type parameter (`.withCount<'posts'>(...)`) or a const-generics lift the type system can't cleanly support today without breaking the existing `QueryBuilder<T>` shape. Leave it loose; document it.

```ts
const users = await User.query().withCount('posts').get()
const u     = users[0]!
const n     = (u as unknown as Record<string, number>)['postsCount']  // typed any/unknown — needs cast
```

Acceptable: matches how Prisma's untyped `include` payloads work in non-generated callers, and `instance.loadCount('posts')` then `instance.postsCount` doesn't require any cast at the property-access site (it's just `unknown` until first read).

---

## QueryBuilder contract additions (`@rudderjs/contracts`)

Add to `QueryBuilder<T>` interface:

```ts
withCount(relation: string | readonly string[] | Record<string, AggregateConstraint>): this
withSum  (relation: string, column: string): this
withSum  (relations: Record<string, AggregateSumSpec>): this
withMin  (relation: string, column: string): this
withMax  (relation: string, column: string): this
withAvg  (relation: string, column: string): this
withExists(relation: string | readonly string[]): this
```

Plus the supporting types:

```ts
export type AggregateConstraint = (q: AggregateConstraintBuilder) => AggregateConstraintBuilder

export interface AggregateConstraintBuilder {
  where  (column: string, value: unknown): this
  where  (column: string, operator: WhereOperator, value: unknown): this
  orWhere(column: string, value: unknown): this
  orWhere(column: string, operator: WhereOperator, value: unknown): this
  /** Override the column-suffix used to stamp the result (default = relation name). */
  as(alias: string): this
}

export interface AggregateSumSpec {
  column:      string
  constraint?: AggregateConstraint
}

export interface AggregateRequest {
  relation:   string                // e.g. 'posts'
  alias:      string                // e.g. 'posts'  (after .as() if any)
  fn:         'count' | 'sum' | 'min' | 'max' | 'avg' | 'exists'
  column?:    string                // required for sum/min/max/avg
  constraint?: AggregateConstraint  // recorded for the adapter to replay
}
```

Extend `QueryState`:

```ts
export interface QueryState {
  // … existing …
  aggregates: AggregateRequest[]
}
```

The ORM layer normalizes every `withCount(...)` overload into one or more `AggregateRequest` entries pushed to `state.aggregates` before handing off to the adapter. Adapters consume `state.aggregates` directly — no overload parsing in the adapter layer.

---

## Resolution path

The ORM (`@rudderjs/orm`) doesn't run aggregates itself; it only normalizes and stamps. Three jobs:

1. **Normalize.** Translate the three call shapes into `AggregateRequest[]`. Look up `static relations[relation]` to figure out the join shape (foreign key, pivot table, polymorphic columns) and pass that to the adapter via the `AggregateRequest`.
2. **Forward.** Adapter implementations consume `state.aggregates` and inject SELECT-list expressions as part of the same query.
3. **Stamp.** When the adapter returns rows with extra `__agg_xxx` keys (or names matching the alias convention), the hydrating QB Proxy maps them to the instance under the canonical name (`postsCount` etc).

The hydrating QB layer (`Model._hydratingQb`, `index.ts:641`) already wraps adapter rows. Add a thin step after `wrap(record)` that copies aggregate columns into the instance and tags them so `toJSON()` always emits them.

### Treatment as appended/computed

Aggregate columns are **enumerable own properties** on the instance — they appear in `Object.entries(user)`, `JSON.stringify(user)`, and `{ ...user }` spreads, exactly like database columns do today. They're NOT registered in `static appends` (which reserve a separate accessor-based path).

Why enumerable: rate-limit policies, panel cell renderers, and any consumer that does `for (const [k, v] of Object.entries(row))` should see `postsCount` without a special case. Cost: `_toData()` (`index.ts:1027`) needs an explicit skip-list for aggregate-injected keys when building the **write payload** to Prisma (otherwise Prisma rejects on the unknown column). Implementation: tag injected keys on a private symbol field at hydration time:

```ts
// On the Model instance after hydration:
this[Symbol.for('rudderjs.orm.aggregates')] = new Set(['postsCount', 'commentsSumScore'])
```

`_toData()` reads the set and excludes those keys from the Prisma write. `toJSON()` ignores the set entirely (aggregates *should* appear in JSON output).

---

## Adapter — `@rudderjs/orm-prisma`

Use Prisma's native `_count` / `_sum` / `_min` / `_max` / `_avg` selectors. They live in `select` (or `include`) with two distinct shapes:

### Count + exists
```ts
// AggregateRequest { relation: 'posts', fn: 'count' }
//   →
prisma.user.findMany({
  include: {
    _count: { select: { posts: true } },
    // existing includes from .with(...) keep working alongside
  },
})
// Returns rows with `_count: { posts: number }`.
// Adapter post-processes: row.postsCount = row._count.posts; delete row._count
```

For `withExists`, Prisma has no native `_exists` — implement as `_count` + boolean coerce in the adapter (`row.postsExists = row._count.posts > 0`). Cheap; no perf hit vs the equivalent subquery.

### Sum / min / max / avg

Prisma's per-relation `_sum`/`_min`/`_max`/`_avg` only ships on newer relational-aggregate schemas. Portable path: **second query batch via `groupBy` on the related delegate**.

```ts
const users = await prisma.user.findMany({ where, include, take, skip })  // step 1
const sums  = await prisma.post.groupBy({                                  // step 2: one round-trip per aggregate
  by:    ['authorId'],
  where: { authorId: { in: users.map(u => u.id) }, ...constraintWhere },
  _sum:  { views: true },
})
// step 3: stamp onto users by matching authorId
```

One round-trip per `withSum/Min/Max/Avg` request total (not per-row). Constant N+0.

### Polymorphic relations

`withCount('comments')` where `comments` is `morphMany` works the same way. The adapter reads `morphName` from the relation def, adds `commentableType: 'Post'` to the `_count`/`groupBy` filter alongside the foreign-key match. No special API.

`withCount` on `belongsToMany` joins through the pivot — same `_count` selector works on Prisma when the relation is declared in the schema. When the pivot is `@rudderjs/orm`-managed (no Prisma relation array), fall through to the second-query batch path with a pivot subselect. Document that `withCount('roles')` requires a Prisma-declared relation; if missing, throw with `[RudderJS ORM Prisma] withCount("roles") requires a Prisma relation declaration. Add a relation field to your User model in schema.prisma.`

### Constraints

`AggregateConstraint` records `where`/`orWhere` calls into a small `[op, args]` log. The adapter replays the log against a Prisma `where` object (it already knows how to build `where` from the QB's main wheres).

---

## Adapter — `@rudderjs/orm-drizzle`

Drizzle has no relational aggregate sugar. Two strategies; we pick **correlated subselects** as the v1 default because they compose with the existing `select().from().where()` pipeline without restructuring it.

### Shape: correlated subselect in the SELECT list

```sql
-- User.query().withCount('posts')
SELECT users.*,
       (SELECT COUNT(*) FROM posts
        WHERE posts.author_id = users.id
          AND posts.deleted_at IS NULL) AS posts_count
FROM users
WHERE …
```

Drizzle lets you build that with `sql<number>` and a correlated reference:

```ts
import { sql } from 'drizzle-orm'

const subquery = sql<number>`(
  SELECT COUNT(*)
    FROM ${posts}
   WHERE ${posts.authorId} = ${users.id}
     AND ${posts.deletedAt} IS NULL
)`.as('postsCount')

const rows = await db
  .select({ ...getTableColumns(users), postsCount: subquery })
  .from(users)
  .where(...)
```

The Drizzle adapter changes its `get()` / `first()` / `paginate()` to:

1. Build the existing `select()` from `getTableColumns(this.table)`.
2. For each `AggregateRequest` in `state.aggregates`, append `[alias]: sql<...>(...)` to the select object.
3. Execute as one query.

### Per-aggregate SQL shape (alias names shown snake; emitted as quoted camelCase)

```sql
-- withCount('posts')        →  (SELECT COUNT(*) FROM posts WHERE posts.author_id = users.id) AS posts_count
-- withSum('posts','views')  →  (SELECT COALESCE(SUM(views),0) FROM posts WHERE posts.author_id = users.id) AS posts_sum_views
-- withMin('orders','total') →  (SELECT MIN(total) FROM orders WHERE orders.user_id = users.id) AS orders_min_total
-- withExists('subscription')→  EXISTS (SELECT 1 FROM subscriptions WHERE subscriptions.user_id = users.id) AS subscription_exists
-- withCount('comments')  morphMany:
--   (SELECT COUNT(*) FROM comments WHERE comments.commentableId = posts.id AND comments.commentableType = 'Post') AS comments_count
-- withCount('roles')  belongsToMany pivot:
--   (SELECT COUNT(*) FROM role_user WHERE role_user.user_id = users.id) AS roles_count
-- withCount({ posts: q => q.where('published', true) }):
--   (SELECT COUNT(*) FROM posts WHERE posts.author_id = users.id AND posts.published = true) AS posts_count
```

Adapter emits camelCase aliases (`postsCount`) via Drizzle's `.as('postsCount')` — quoted identifier, portable across SQLite/Postgres. Snake form above is illustrative only.

### Why not lateral joins?

LATERAL is Postgres-only (and MySQL 8+), and the SELECT-list correlated-subquery shape is universally supported (SQLite included). v1 ships the portable shape. If a perf bottleneck shows up on `withCount` for huge fanouts (LATERAL with `LIMIT 1` is sometimes faster), revisit per-driver in v2.

### Soft deletes

Each correlated subquery applies the related model's soft-delete filter automatically (`AND deleted_at IS NULL`). The adapter checks `Related.softDeletes` on the relation target's model class — same logic as the main query.

### Constraints

Constraint replay against a fresh `AggregateConstraintBuilder` produces a `WhereClause[]` that the adapter ANDs into the subselect's `WHERE` alongside the foreign-key join.

---

## Polymorphic-relation interaction

`withCount` / `withSum` / etc. resolve uniformly across `hasMany` / `belongsTo` / `belongsToMany` / `morphMany` / `morphOne`. The relation-def lookup (`Parent.relations[name]`) tells the adapter which join shape to build:

| Relation type | What the adapter does |
|---|---|
| `hasMany` / `hasOne` | One subselect joining `Related.{foreignKey}` to `Parent.{localKey}`. |
| `belongsTo` | Subselect joining `Related.{primaryKey}` to `Parent.{foreignKey}`. |
| `belongsToMany` | Subselect against the pivot table; counts pivot rows. For `withSum`, joins pivot → related to sum a related column. |
| `morphMany` / `morphOne` | Like `hasMany` plus an extra `AND {morphName}Type = 'Parent'` filter. |
| `morphTo` | **Unsupported in v1.** The "type" varies per row, so a single subselect can't enumerate. Throw `[RudderJS ORM] withCount() on morphTo "${name}" is not supported — aggregate per-target by querying each target class.` |
| `morphToMany` / `morphedByMany` | Same as `belongsToMany` plus `morphName_type` filter on the pivot. |

`latestOfMany`/`oldestOfMany` (Laravel patterns for "the latest related row") are NOT in scope; track separately if requested. The aggregate methods here are the prerequisite for `latestOfMany('createdAt')` to compose cleanly later (it would build on `withMax` + a JOIN), but v1 doesn't ship the sugar.

---

## `loadCount` / `loadSum` / etc. — instance code path

Instance variants don't piggyback on `withCount` (the parent row already exists). Implementation:

```ts
async loadCount(this: Model, relation: string | string[] | Record<string, AggregateConstraint>): Promise<this> {
  const ctor = this.constructor as typeof Model
  const reqs = normalize(relation)  // → AggregateRequest[]
  for (const req of reqs) {
    const def = ctor.relations[req.relation]
    if (!def) throw new Error(`[RudderJS ORM] No relation "${req.relation}" on ${ctor.name}.`)
    // Reuse this.related(name) to build a builder filtered to this row,
    // then either count() / sum() / etc. directly.
    let qb = this.related(req.relation) as QueryBuilder<Model>
    if (req.constraint) qb = applyConstraint(qb, req.constraint)
    const value = await runAggregate(qb, req)
    ;(this as Record<string, unknown>)[req.alias + suffixFor(req.fn, req.column)] = value
    aggregateKeysOf(this).add(req.alias + suffixFor(req.fn, req.column))
  }
  return this
}
```

Cost: one round-trip per `loadCount` call (acceptable on the instance API). For batched loads on a *list*, use `.withCount(...)` on the parent query — that's why both APIs exist.

`loadSum`/`loadMin`/`loadMax`/`loadAvg` use the same code path with a different terminal. The QueryBuilder contract gains an internal `__rawAggregate(fn, column)` helper (`@internal`) called only by the aggregate path — keeping the public contract minimal. No public `.sum()`/`.avg()` terminals.

### `loadMissing`

```ts
async loadMissing(this: Model, ...relations: string[]): Promise<this> {
  const toLoad = relations.filter(r => {
    const v = (this as Record<string, unknown>)[r]
    return v === undefined || v === null
  })
  for (const r of toLoad) {
    (this as Record<string, unknown>)[r] = await this.related(r).get()
  }
  return this
}
```

No aggregate behavior — pure "load these relations into properties iff they aren't already there." Ships in the same PR because it pairs naturally with `loadCount` in docs/examples.

---

## Constraining aggregate loads

Three call sites across the API support constraints:

```ts
// 1. Map form on withCount
await User.query().withCount({
  posts: q => q.where('published', true),
}).get()

// 2. Map form on withSum
await User.query().withSum({
  posts: { column: 'views', constraint: q => q.where('published', true) },
}).get()

// 3. Instance form
await user.loadCount({ posts: q => q.where('published', true) })
```

Constraints **always run against the related table**, never the parent. The closure receives `AggregateConstraintBuilder`, not a full `QueryBuilder<T>` — it's intentionally narrow (where/orWhere/as only). Larger surface (orderBy/limit) would have ambiguous semantics in an aggregate context.

``.as(name)` overrides the alias prefix (`.as('publishedPosts')` → `publishedPostsCount`). Required when calling the same aggregate twice with different constraints — map keys must be real relation names, so use `.withCount({ posts: q => q.where('published',true).as('publishedPosts') }).withCount('posts')` to get both `publishedPostsCount` + `postsCount`. Multiple `withCount('posts')` calls accumulate — distinct aliases are required to avoid clobbering.

---

## Implementation tasks

Each is independently committable.

### Task 1 — Contract additions
- Extend `QueryBuilder<T>` in `packages/contracts/src/index.ts` with the six aggregate methods.
- Add `AggregateConstraint`, `AggregateConstraintBuilder`, `AggregateSumSpec`, `AggregateRequest` types.
- Extend `QueryState.aggregates: AggregateRequest[]`.
- Build + typecheck. No behavior change yet.

### Task 2 — ORM Model normalization layer
- Add `withCount` etc. to `Model.query()`'s returned hydrating Proxy. They normalize args into `AggregateRequest[]` and call into the underlying adapter QB's `withCount(state.aggregates)` (single-shape contract method on the adapter side — overloads collapse to `AggregateRequest[]`).
- Implementation note: the contract overloads above are the public API; internally adapters only see `withCount(reqs: AggregateRequest[])`. Keep the multiple overloads in the contract for ergonomics but document that the adapter consumes the normalized form.
- Add `loadCount`/`loadSum`/`loadMin`/`loadMax`/`loadAvg`/`loadExists`/`loadMissing` to `Model.prototype`.
- Hook the hydrating QB to copy aggregate keys onto the instance + add to the `Symbol.for('rudderjs.orm.aggregates')` set.
- Update `_toData()` to skip aggregate keys.

### Task 3 — Prisma adapter
- Implement the count/exists path via `_count` selector.
- Implement sum/min/max/avg via second-batch `groupBy` on the related delegate.
- Implement constraint replay → Prisma `where`.
- Polymorphic relation → add `{morphName}Type` filter.
- belongsToMany without Prisma-declared relation → throw with the helpful message.
- Tests in `packages/orm-prisma/src/index.test.ts`.

### Task 4 — Drizzle adapter
- Implement the correlated-subselect path. Build the SELECT-list block per `AggregateRequest`.
- Inject into `select()` columns map + execute as one query in `get`/`first`/`paginate`.
- Constraint replay → AND into subselect WHERE.
- Soft-delete filter on the related table.
- Polymorphic + belongsToMany subselect shapes.
- Tests in `packages/orm-drizzle/src/index.test.ts` (assert SQL via `.toSQL()`).

### Task 5 — Tests (orm package)
Add `packages/orm/src/aggregate.test.ts`. Use the in-memory adapter mock pattern from existing tests — record the `withCount(reqs)` call into a stub and assert request shape.

| Scenario | Assert |
|---|---|
| `withCount('posts')` / `[…]` / `{…}` overloads | normalize to expected `AggregateRequest[]` shape |
| `withCount({ posts: q => q.where('published', true) })` | constraint replays correctly |
| `withSum('orders', 'total')` + `withExists('subscription')` | request shape (`fn`, `column`) |
| `instance.loadCount('posts')` | stamps `instance.postsCount` |
| `instance.loadCount(['posts','comments'])` | stamps both |
| `instance.loadMissing('posts')` when `instance.posts` truthy | no query issued (mock) |
| `instance.loadMissing('posts')` when null/undefined | query issued, property set |
| `_toData()` skips aggregate-stamped keys | write payload clean |
| `toJSON()` includes aggregate-stamped keys | output has `postsCount` |
| `withCount('unknown')` | throws naming relation + Model |
| `.as('publishedPosts')` | column = `publishedPostsCount` |
| `withCount('commentable')` on a morphTo | throws mentioning `morphTo` |

### Task 6 — README + CHANGELOG
- `packages/orm/README.md`: new "Aggregate eager loading" section after the Relations section. Six examples (one per method) + a constraint example + an instance example + the `loadMissing` note.
- `packages/orm/CLAUDE.md`: amend the "Relations are deliberately thin" sentence to carve out aggregates as the deliberate exception, with one-line rationale (adapter divergence too wide). List the new methods.
- `packages/orm-prisma/CHANGELOG.md`: minor — adds aggregate support.
- `packages/orm-drizzle/CHANGELOG.md`: minor — adds aggregate support.
- `packages/orm/CHANGELOG.md`: minor — adds aggregate normalization layer + instance methods.
- `packages/contracts/CHANGELOG.md`: minor — extends QueryBuilder + adds aggregate types.

### Task 7 — Cut a changeset
```bash
pnpm changeset
# minor bump for orm, orm-prisma, orm-drizzle, contracts. Additive only.
```

Body: "Add aggregate eager loading (`withCount`/`withSum`/`withMin`/`withMax`/`withAvg`/`withExists`) on the QueryBuilder + `loadCount`/`loadMissing` on instances. Closes the N+1 footgun for hot list pages without dropping into the adapter."

---

## What this plan deliberately doesn't do

- **No nested aggregates** (`withCount('posts.comments')`) — path parsing + double-join SQL earns its own plan.
- **No `withCountIf` / scoped variants** — closure constraints cover it.
- **No order-by-aggregate sugar** — `.orderBy('postsCount')` works on PG/MySQL when the alias is in SELECT; Drizzle's raw-`sql` escape covers SQLite.
- **No `withAggregate(custom_sql)`** — drop to the adapter for raw SQL.
- **No `morphTo` aggregate** — per-target enumeration undefined; throw.
- **No type-level inference of injected columns** — see "Type signatures"; kept loose to avoid breaking QB shape.
- **No batched aggregate loading on instance lists** — `users.forEach(u => u.loadCount('posts'))` issues N round-trips by design; use the QB form for batched.
- **No public `.sum('col')` / `.avg('col')` terminals** — internal helpers only; only `withX` / `loadX` are public.

---

## Open questions for the implementer

1. **Constraint builder shape** — separate class (recommend) vs runtime-guarded QB. Separate class gives compile-time error on `.orderBy()`; minor `where`/`orWhere` duplication pays for itself.
2. **Sum/avg null handling** — coerce to `0` for `sum`/`count`/`exists`; leave `null` for `min`/`max`/`avg` (avg-of-nothing genuinely undefined). Document.
3. **Decimal columns** — `withSum` over a Prisma `Decimal` returns a `Decimal`. Pass through; user casts via existing `static casts`.
4. **Aggregate-vs-schema column collision** — schema column wins on hydration order, aggregates would overwrite. Scan the model's column list at adapter-build time, throw on collision: `postsCount conflicts with a column on User. Use .as(...) to alias the aggregate.` Cache the column list per Model.
5. **`belongsTo` aggregate semantics** — ambiguous (presence boolean vs always 1). Throw: `withCount on belongsTo "${name}" is ambiguous; use withExists to test presence, or query the inverse hasMany.`

---

## File touch list (final)

- `packages/contracts/src/index.ts` — extend `QueryBuilder<T>`, `QueryState`, add aggregate types
- `packages/orm/src/index.ts` — normalization layer, `loadCount`/`loadMissing`/etc., aggregate-key tracking, `_toData()` skip
- `packages/orm/src/aggregate.test.ts` — new
- `packages/orm-prisma/src/index.ts` — `_count` selector + `groupBy` second-batch + constraint replay
- `packages/orm-prisma/src/index.test.ts` — additions
- `packages/orm-drizzle/src/index.ts` — correlated-subselect SELECT-list injection + constraint replay
- `packages/orm-drizzle/src/index.test.ts` — additions (use `.toSQL()` for assertions)
- `packages/orm/README.md` — new section
- `packages/orm/CLAUDE.md` — amend the "deliberately thin" paragraph
- `packages/orm/CHANGELOG.md` + `packages/orm-prisma/CHANGELOG.md` + `packages/orm-drizzle/CHANGELOG.md` + `packages/contracts/CHANGELOG.md` — minor entries
- `.changeset/<random>.md` — generated

Estimated: 1.5 days for impl + tests + docs. The contract widening + ORM normalization is mechanical; both adapters are net-new code paths but small (Prisma reuses native `_count`; Drizzle's correlated subselect is ~40 lines).
