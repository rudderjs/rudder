# Models

A model represents one row in a database table. Every model extends `Model` from `@rudderjs/orm` — that gives you a fluent query API, mass assignment, attribute casting, lifecycle hooks, and serialization controls in one class.

```ts
import { Model } from '@rudderjs/orm'

export class User extends Model {
  static table       = 'user'
  static primaryKey  = 'id'
  static fillable    = ['name', 'email', 'role']
  static hidden      = ['password']

  id!:        string
  name!:      string
  email!:     string
  role!:      string
  password!:  string
  createdAt!: Date
}
```

Generate stubs with `pnpm rudder make:model User`.

## `static table`

`static table` tells the adapter which delegate or table key to query. The value is **adapter-specific**:

- **Prisma:** the camelCase Prisma client delegate (`user`, `blogPost`) — never the SQL table name.
- **Drizzle:** the key in the `tables: {}` object passed to `drizzle()`.

Setting `static table` is effectively required — the default (lowercase class name + `s`) does not match either adapter's convention.

## Querying

`where()` returns a chainable `QueryBuilder`. `first()`, `count()`, and `paginate()` are static shortcuts for the no-conditions case. Beyond the basics here, the builder speaks joins, grouping, unions, CTEs, EXISTS subqueries, JSON paths, and row locking — see the [Query Builder](/guide/database/query-builder) guide.

```ts
await User.all()
await User.find('clx1234...')
await User.first()
await User.count()

await User.where('role', 'admin').get()
await User.where('createdAt', '>', new Date('2024-01-01')).get()

const recent = await User
  .where('role', 'admin')
  .where('name', 'LIKE', 'A%')
  .orderBy('createdAt', 'DESC')
  .limit(10)
  .get()

const page = await User.where('role', 'user').paginate(1, 20)
// { data, total, currentPage, perPage, lastPage, from, to }
```

### Throwing on miss — `findOrFail` / `firstOrFail`

`find()` and `first()` return `null` when no record matches. The `*OrFail` variants throw `ModelNotFoundError` instead — catch it for a 404 or let it bubble:

```ts
import { ModelNotFoundError } from '@rudderjs/orm'

const user = await User.findOrFail(id)              // throws if missing
const admin = await User.where('role', 'admin').firstOrFail()
```

### Upserting — `firstOrCreate` / `updateOrCreate`

```ts
// Find by email, or create with email + name
const user = await User.firstOrCreate(
  { email: 'a@x.com' },
  { name: 'Alice', role: 'user' },
)

// Find by email; if found update with values, else create with merge
const user = await User.updateOrCreate(
  { email: 'a@x.com' },
  { name: 'Alice', role: 'admin' },
)
```

`firstOrCreate` filters by all keys in the first argument; the second argument is only used when creating. `updateOrCreate` always writes the second argument (whether updating or creating).

Both are single-row, select-then-write. For **bulk, atomic** insert-or-update use `upsert`:

### Bulk insert-or-update — `upsert`

```ts
// Insert each row; on a unique conflict (email), overwrite only `name`.
await User.upsert(
  [{ email: 'a@x.com', name: 'Alice' }, { email: 'b@x.com', name: 'Bob' }],
  'email',            // uniqueBy — a single column or string[] (a matching UNIQUE index must exist)
  ['name'],           // columns to overwrite on conflict; omit → all inserted columns except uniqueBy
)
```

- One atomic statement on the native + Drizzle adapters (`ON CONFLICT … DO UPDATE` on SQLite/Postgres, `ON DUPLICATE KEY UPDATE` on MySQL). The Prisma adapter batches a per-row `upsert` in a single transaction (no portable bulk ON CONFLICT). Returns the number of rows affected.
- An **empty `update` list** means insert-or-ignore (`DO NOTHING`).
- Like `insertMany`, `upsert` is a **bulk write — `fillable`/`guarded` do not apply** (write-side casts/mutators still do), and **observer events do not fire**.
- A matching UNIQUE constraint on `uniqueBy` must exist, exactly as the SQL clause / Prisma compound key requires.
- **MySQL quirk:** the returned count is rows-*touched* (MySQL counts 1 per insert and 2 per updated row), not rows-distinct.

| QueryBuilder method | Description |
|---|---|
| `where(col, value)` / `where(col, op, value)` | Filter (operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `IN`, `NOT IN`) |
| `orWhere(col, value)` | OR equality |
| `orderBy(col, dir?)` | Sort |
| `limit(n)` / `offset(n)` | Paging primitives |
| `with(...rels)` | Eager-load relations (Prisma) |
| `first()` / `find(id)` / `get()` | Read |
| `create(data)` / `update(id, data)` / `delete(id)` | Write |
| `upsert(rows, uniqueBy, update?)` | Bulk insert-or-update (atomic ON CONFLICT) |
| `chunk(size, cb)` / `lazy(size?)` | Memory-bounded iteration over large result sets |
| `whereIn`/`whereNotIn`/`whereNull`/`whereNotNull`/`whereBetween`/`whereNotBetween` (+ `orWhere*`) | Named `where` sugar (see below) |
| `when(v, cb, else?)` / `unless(...)` | Conditional clauses |
| `latest(col?)` / `oldest(col?)` | `ORDER BY col DESC`/`ASC` (default `createdAt`) |
| `pluck(col)` / `value(col)` | One column → array / first row's value |
| `sum`/`max`/`min`/`avg`/`exists`/`doesntExist` | Scalar terminals |
| `selectRaw(sql, b?)` / `whereRaw(sql, b?)` / `orWhereRaw(sql, b?)` / `orderByRaw(sql, b?)` | Raw-SQL escape hatch (see below) |
| `increment(id, col, n?, extra?)` / `decrement(id, col, n?, extra?)` | Atomic counter delta (default `n`: 1) |
| `paginate(page, perPage?)` | Paginated result (default `perPage`: 15) |

### Iterating large result sets — `chunk` / `lazy`

Loading millions of rows into memory at once is a footgun. `chunk` and `lazy` page the query under the hood (`LIMIT size OFFSET n`) so only one page is resident at a time.

```ts
// Process the table in pages of 200. Return false from the callback to stop early.
await User.query().orderBy('id').chunk(200, async (users) => {
  for (const user of users) await sendDigest(user)
})

// Stream rows one at a time (async iterator); pages of 1000 by default.
for await (const user of User.query().where('active', true).orderBy('id').lazy()) {
  await reindex(user)
}
```

- Both are also available as Model statics: `User.chunk(200, cb)` / `User.lazy()`.
- **Add an `orderBy`** (ideally on a unique column such as the primary key) — offset paging relies on a consistent sort, or rows can overlap/skip between pages. Same caveat as Laravel's `chunk`.
- `chunk` resolves `true` if it ran to completion, `false` if the callback bailed. `lazy(size?)` returns an async generator, so `break` stops fetching.
- They override any `limit`/`offset` already on the query.

### Query sugar — named `where`s, conditionals, and terminals

Laravel's everyday query-builder shortcuts. Each is also a `Model` static entry point (`User.whereIn(...)`, `User.sum(...)`, …).

```ts
// Named where variants (+ orWhere* forms).
await User.query().whereIn('role', ['admin', 'editor']).get()
await User.query().whereNotNull('verifiedAt').whereBetween('age', [18, 65]).get()
await User.query().whereNull('deletedAt').get()

// Conditional clauses — build queries without if-ladders.
await User.query().when(role, (q, r) => q.where('role', r)).get()
await User.query().unless(includeArchived, (q) => q.whereNull('deletedAt')).get()

// Ordering shortcuts.
await User.query().latest('createdAt').limit(10).get()   // ORDER BY createdAt DESC
await User.query().oldest().get()                         // defaults to the createdAt column

// Terminals.
const emails = await User.query().where('active', true).pluck('email')   // string[]
const name   = await User.query().latest().value('name')                 // first row's column, or undefined
const total  = await User.query().where('role', 'admin').sum('credits')  // also max/min/avg
if (await User.query().where('email', e).exists()) { /* … */ }            // + doesntExist()
```

- `whereBetween` is inclusive (`>= a AND <= b`); `whereNotBetween` is `< a OR > b`. `whereNull`/`whereNotNull` map to `IS [NOT] NULL`.
- `when`/`unless` pass `(queryBuilder, value)` to the callback and only run it on a truthy/falsy `value`; both take an optional `otherwise` callback.
- These live entirely at the Model layer (composed from the core `where`/`orderBy`/aggregate primitives), so they work identically on the native, Drizzle, and Prisma adapters.

### Raw SQL — `selectRaw` / `whereRaw` / `orderByRaw` + `DB.raw(...)`

When the structured builder is too narrow, drop to raw SQL. Bound values travel as `?` placeholders + a positional `bindings` array (rebound to the dialect's form — `$n` on Postgres):

```ts
// Bound — the value is parameterized, never interpolated.
const adults = await User.query().whereRaw('age > ?', [18]).get()

// Composes with structured wheres; orWhereRaw adds an OR alternative.
await User.query().where('active', true).orWhereRaw('age > ?', [65]).get()

// Raw ORDER BY and a raw projection.
await User.query().orderByRaw('field(status, ?, ?)', ['urgent', 'high']).get()
await User.query().selectRaw('count(*) as total, max(createdAt) as latest').get()

// DB.raw(...) splices a fragment verbatim as a where value or an order column.
import { DB } from '@rudderjs/database'
await User.query().where('createdAt', '>', DB.raw('NOW()')).orderBy(DB.raw('age asc')).get()
```

- **Adapter support:** the **native engine** supports all of the above. **Drizzle** supports `whereRaw`/`orWhereRaw`/`orderByRaw` + `orderBy(DB.raw(...))` + a raw value, but **`selectRaw` throws** (its typed select can't map an arbitrary projection back to a model — run such queries via the `DB` facade: `DB.select(sql, bindings)`). **Prisma** throws on every raw method — its structured client can't splice raw SQL; use `DB.select(sql, bindings)` instead.
- **`?` count must match `bindings.length`** or the call throws. A literal `?` inside a string literal in the fragment is counted as a placeholder (same limitation as Laravel) — prefer a bound value.
- Raw SQL is spliced **verbatim** — identifiers are not quoted and values in the fragment text are not escaped. Always pass user input through `?` bindings, never string-concatenate it into the fragment.

### Precedence in mixed `where` + `orWhere` chains

The chain reads left-associative, like Eloquent: `where('a').where('b').orWhere('c')` is `(a AND b) OR c`, not `a AND b AND c`. Each `.orWhere()` introduces a top-level alternative that escapes the prior AND chain:

```ts
Post
  .where('status', 'active')
  .where('priority', 'high')
  .orWhere('priority', 'low')
  .get()
// SQL: WHERE (status = 'active' AND priority = 'high') OR priority = 'low'
// Matches every active-and-high row plus every low-priority row regardless of status.
```

This is identical on both `@rudderjs/orm-prisma` (≥ 2.0.0) and `@rudderjs/orm-drizzle` — queries port between adapters without changing meaning.

When you actually want the OR alternative constrained by some shared filter, group it explicitly:

```ts
// "active rows where priority is high OR starred is true"
Post
  .where('status', 'active')
  .whereGroup(g => g.where('priority', 'high').orWhere('starred', true))
  .get()
// SQL: WHERE status = 'active' AND (priority = 'high' OR starred = true)
```

> **Upgrading from `@rudderjs/orm-prisma@1.x`?** This precedence is the breaking change in 2.0. The 1.x Prisma adapter constrained every `.orWhere()` by the prior AND chain (so the first example above returned no rows — `priority = 'high' AND priority = 'low'` is empty). Review queries that mix `.where()` and `.orWhere()` for the new shape; in most cases the new behaviour matches what the code looks like it should mean. The Drizzle adapter was always Laravel-parity, so cross-adapter portable apps already had the new shape.

A few edge cases worth knowing:

- **Soft deletes** join the AND alternative — when you mix `.orWhere()` with a soft-deleted model, the soft-delete filter only applies to the AND side of the OR. Keep `.orWhere()` chains AND-only or wrap them in a `whereGroup` if you need the soft-delete to apply across every alternative.
- **`whereGroup` / `orWhereGroup`** compose recursively — the precedence rule applies at every nesting level.

## Hydrated instances

Every read path returns Model instances — `find`, `first`, `all`, `paginate`, `where(...).first()`, `where(...).get()`, `create`, `update`, `restore`, `firstOrCreate`, `updateOrCreate`. The result is `instanceof Model` with the prototype chain bound, so instance methods you define on the class work directly:

```ts
class User extends Model {
  isAdmin() { return this.role === 'admin' }
}

const user = await User.find(id)
if (user?.isAdmin()) { /* ... */ }
```

The base `Model` ships with the persistence and identity methods you'd expect from Eloquent:

| Method | What it does |
|---|---|
| `save()` | Inserts when the primary key is unset; otherwise updates. Routes through the static path so observers fire. |
| `fill(data)` | Mass-assigns attributes without persisting. |
| `refresh()` | Re-reads the row and replaces fields in place. Throws `ModelNotFoundError` if the row is gone. |
| `delete()` | Soft-deletes when `static softDeletes = true`; otherwise hard-deletes. |
| `replicate(except?)` | Clones the instance without primary key + `createdAt`/`updatedAt`/`deletedAt` (and any extra keys). |
| `is(other)` / `isNot(other)` | Identity by table + primary key. |
| `trashed()` | True when `deletedAt` is set. |
| `increment(col, n?, extra?)` / `decrement(col, n?, extra?)` | Atomic SQL counter update; merges the new value back onto the instance. |

`Model.hydrate(record)` is the escape hatch when you need to wrap a plain record from outside the ORM (cached JSON, fixtures, an external API response).

## Dirty tracking

Every hydrated instance keeps an "original" snapshot of the row as loaded. After mutating fields you can ask whether anything changed, what changed, and what the previous values were:

```ts
const user = await User.find(id)
user.name  = 'Sue'
user.email = 'sue@example.com'

user.isDirty()                  // true
user.isDirty('name')            // true
user.isClean('role')            // true (role is unchanged)

user.getDirty()                 // { name: 'Sue', email: 'sue@example.com' }
user.getOriginal('name')        // the original name as loaded
user.getOriginal()              // full original snapshot

await user.save()

user.isDirty()                  // false — original snapshot now reflects post-save state
user.wasChanged()               // true — fields changed during the just-completed save
user.wasChanged('name')         // true
user.getChanges()               // { name: 'Sue', email: 'sue@example.com' }
```

`isDirty()` / `getDirty()` reflect **pending** changes that haven't been persisted yet. `wasChanged()` / `getChanges()` reflect changes that were just persisted by the most recent `save()` / `update()` — useful in observers' `*ed` hooks (e.g. `userObserver.updated(user)` checking `user.wasChanged('email')` before re-sending verification mail).

Both surfaces compare with `Object.is`, so coercion-equal values (`1 === '1'`) are treated as different. Date columns are compared by reference identity from the original snapshot — if the adapter returns a fresh `Date` per read, an unset field can still appear dirty. Pass an explicit key (`isDirty('name')`) when you want a precise check.

## Timestamps

Models stamp `createdAt` / `updatedAt` automatically (Laravel's `$timestamps`, on by default):

- **`create()`** (and the `save()` insert path) stamps both columns when you didn't pass them.
- **`Model.update()`** stamps `updatedAt` when absent — an explicitly-passed value is respected (backfills).
- **`instance.save()`** always bumps `updatedAt`.

Stamps are ISO-8601 UTC strings; add a `'date'` cast to read them back as `Date` objects (the [typed registry](/guide/database#typed-models-from-migrations-schema-types) then emits `Date` for the column too).

The stamping is **schema-gated, so the default is safe everywhere**: the Model layer checks the table's real columns first (via the adapter's introspection capability), and a table without `createdAt`/`updatedAt` — pivots, lookup tables — is silently skipped, never an unknown-column error. On **Prisma/Drizzle** the schema owns timestamp defaults (`@default(now())` / `@updatedAt` / `.defaultNow()`), so Model-layer stamping stays out of the way there; on the **native engine** this is what populates timestamps (there's no schema default unless your migration adds one).

```ts
class AuditEvent extends Model {
  static table = 'audit_events'
  static timestamps = false   // opt out — rows must never look "updated"
}
```

**Bulk paths don't stamp** — `updateAll()`, `upsert()`, `insertMany()`, `increment`/`decrement` are pure data-plane, same as they bypass observers.

## Counters: increment / decrement

For counter columns, `Model.increment()` / `Model.decrement()` issue a single SQL `UPDATE col = col ± amount` so the change is atomic — safe under concurrent writes, no read-modify-write race. Prisma maps to `{ increment: n }` / `{ decrement: n }`; Drizzle to a `sql\`${col} + ${n}\`` expression.

```ts
// Static — atomic delta, returns the updated record (hydrated)
await Post.increment(postId, 'viewCount')              // +1
await Post.increment(postId, 'viewCount', 5)           // +5
await Post.decrement(userId, 'credits', 10)            // -10

// With extras — set other columns in the same UPDATE
await User.increment(id, 'balance', 25, { lastSeen: new Date() })

// Instance — same SQL, merges the new value back so `post.viewCount` reflects it
await post.increment('viewCount')
```

**Caveat — observers don't fire.** `increment` / `decrement` deliberately skip the `updating` / `updated` / `saving` / `saved` lifecycle. They're a pure data-plane operation: the observer payload would have to be either the delta (confusing) or the resolved value (would require a read, breaking atomicity). If you need observer hooks, read the row, set the resolved value, and call `Model.update()` instead.

## Optimistic locking

For read-modify-write cycles where two writers may race — admin form edits, status transitions, anything where "last write wins" silently loses data — enable optimistic locking with `static version`. Unlike a pessimistic `lockForUpdate()` (which holds a row lock for the transaction's duration), optimistic locking costs nothing until a conflict actually happens. TypeORM's `@VersionColumn` / MikroORM's version property are the same idea.

```ts
class Doc extends Model {
  static version = true        // integer column named `version`
  // static version = 'lockVersion'  — or name your own column
  id!: number
  title!: string
  version!: number
}
```

Add the column to your schema as an integer defaulting to `1` (`table.integer('version').notNull().default(1)`). With versioning on:

- **`create()`** stamps the column with `1` when you didn't set it.
- **`save()`** carries the version the instance was hydrated with and updates conditionally — `UPDATE ... SET version = v + 1 WHERE id = ? AND version = v`. Zero rows touched means another writer bumped it first: the save throws `OptimisticLockError` and **nothing is written**.
- **`Model.update(id, data)`** with the version column in `data` does the same conditional check against that value. Without it there's no baseline to compare, so the column is bumped atomically (`version = version + 1`, via the same primitive as `increment`) with no stale check.

```ts
import { OptimisticLockError } from '@rudderjs/orm'

const doc = await Doc.findOrFail(id)   // version 3
doc.title = 'mine'

try {
  await doc.save()                     // ... WHERE id = ? AND version = 3 → version 4
} catch (e) {
  if (e instanceof OptimisticLockError) {
    // e.code = 'OPTIMISTIC_LOCK', e.expectedVersion = 3, e.actualVersion = 4
    await doc.refresh()                // re-read the winning row
    doc.title = 'mine'                 // re-apply (or merge / surface a conflict UI)
    await doc.save()                   // retry at the new version
  } else throw e
}
```

`OptimisticLockError` carries a stable `code: 'OPTIMISTIC_LOCK'`, the `model` / `id`, `expectedVersion` / `actualVersion`, and a duck-typed `httpStatus = 409` — unhandled, the framework's exception handler renders it as HTTP 409 Conflict. A conflicting write whose row was deleted outright throws `ModelNotFoundError` instead.

Works identically on all three adapters — the conditional write is built on the `where().updateAll()` count primitive (Prisma `updateMany`, Drizzle/native `UPDATE ... WHERE`), so no adapter-specific support is needed.

Notes:

- The version column is **lock metadata, not data**: it survives a `fillable` list that omits it, `replicate()` strips it so clones start back at 1, and you never set it by hand after creation.
- Mismatched expectations surface before any observer fires — `updated` / `saved` only run for writes that actually landed.
- Bulk paths (`updateAll`, `upsert`, `increment` / `decrement` called directly) are data-plane and skip the version machinery, same as they skip observers.

## Relations

For **direct** eager loading (`hasOne` / `hasMany` / `belongsTo` / `belongsToMany`), prefer your adapter's native relation engine — Prisma's `include` / `select`, Drizzle's `with()`. They're already type-safe and handle joins, depth, ordering, and selective columns out of the box.

For **polymorphic** eager loading (`morphMany` / `morphOne` / `morphTo` / `morphToMany` / `morphedByMany`), use `Model.with(...)` — the ORM resolves those in batched IN-queries because they have no FK declared in the underlying schema and so can't go through `include` / `with` natively. See [Eager loading polymorphic relations](#eager-loading-polymorphic-relations) below.

For the *lazy fluent fetch* case — "give me a chainable QueryBuilder scoped to this parent record" — declare the relation on `static relations` and call `instance.related(name)`:

```ts
class Post extends Model {}

class User extends Model {
  static override relations = {
    posts: { type: 'hasMany',       model: () => Post,  foreignKey: 'authorId' },
    team:  { type: 'belongsTo',     model: () => Team,  foreignKey: 'teamId' },
    phone: { type: 'hasOne',        model: () => Phone, foreignKey: 'userId' },
    roles: { type: 'belongsToMany', model: () => Role,  pivotTable: 'role_user' },
  } as const
}

const user = await User.find(1)

// Chainable QueryBuilder filtered to this user
const recent = await user!.related('posts')
  .orderBy('createdAt', 'desc')
  .limit(5)
  .get()

// belongsTo fetches the single related row
const team = await user!.related('team').first()
```

**Supported types:** `hasOne`, `hasMany`, `belongsTo`, `belongsToMany`, `morphTo`, `morphMany`, `morphOne`, `morphToMany`, `morphedByMany`. Polymorphic columns use camelCase (`commentableId` / `commentableType`) — a deliberate divergence from Laravel's snake_case.

**Defaults:** `foreignKey` defaults to `<parentClassName>Id` (camelCase) for `hasOne` / `hasMany`, and `<relatedClassName>Id` for `belongsTo`. `localKey` defaults to the parent's primary key (or the FK on `belongsTo`). Override either when your schema diverges.

The `model: () => Post` thunk is mandatory — relation declarations sit on each side of the relationship, and a direct reference would create a circular import at module evaluation time.

### Many-to-many (`belongsToMany`)

Many-to-many relations route through a pivot table. `pivotTable` is required; the two pivot columns default to camelCase of each side's class name + `Id` (`User` ⇄ `Role` → `userId` / `roleId`). Override either with `foreignPivotKey` / `relatedPivotKey` when your schema differs.

```ts
class User extends Model {
  static override relations = {
    roles: {
      type:             'belongsToMany',
      model:            () => Role,
      pivotTable:       'role_user',
      // foreignPivotKey: 'userId',        // default
      // relatedPivotKey: 'roleId',        // default
    },
  } as const
}
```

**Reading.** `related('roles')` returns a chainable QueryBuilder on the *related* model — the pivot stays invisible. The pivot lookup runs on terminal evaluation (`.get()`, `.first()`, `.paginate()`), so chaining stays synchronous.

```ts
const user = await User.find(1)
const active = await user!.related('roles')
  .where('active', true)
  .orderBy('name')
  .get()
```

**Writing.** Pivot mutations live on a separate accessor — `user.roles()` (auto-generated when the parent model is first queried) — exposing `attach`, `detach`, `sync`:

```ts
// Attach by id list. Optional pivot data is written to every new row.
await user!.roles().attach([1, 2, 3])
await user!.roles().attach([1, 2], { addedBy: 'admin' })

// Per-id pivot data — different columns per row.
await user!.roles().attach({
  1: { addedBy: 'admin' },
  2: { addedBy: 'system' },
})

// Detach. With ids, removes only those pivot rows; with no args, removes all.
await user!.roles().detach([1])      // returns count of rows removed
await user!.roles().detach()         // detaches everything for this user

// Sync = diff: attach the missing, detach what's no longer present.
const result = await user!.roles().sync([1, 3, 5])
// → { attached: [3, 5], detached: [2] }
```

For TypeScript users who want strongly-typed accessors, define the method explicitly — it dispatches to the same helper:

```ts
class User extends Model {
  static override relations = { /* ... */ }
  // Same behavior as the auto-installed method, with your own type signature.
  roles() { return Model.belongsToMany(this, 'roles') }
}
```

**v1 limitations:**

- Pivot columns are not surfaced on read results — `related('roles').get()` returns clean `Role` instances without `_pivot` fields. Pivot data round-trips through `attach`/`sync` on the write side.
- No `withTimestamps` — apps that want `createdAt` on the pivot can write it via `attach(ids, { createdAt: new Date() })` or schema-level defaults.
- Mutations (`create`, `update`, `delete`, `insertMany`, `deleteAll`) on the deferred query throw — write the pivot via the accessor and write the related rows via the related model directly.

### Polymorphic one-to-many (`morphTo` / `morphMany` / `morphOne`)

A single related table belongs to several parent types — `Comment` on `Post` *and* `Video`, `Image` on `User` *and* `Product`, etc. The polymorphic side carries two columns: `{morphName}Id` and `{morphName}Type`, written in **camelCase** for ORM consistency (a deliberate divergence from Laravel's snake_case).

```prisma
model Comment {
  id              Int    @id @default(autoincrement())
  body            String
  commentableId   Int
  commentableType String
}

model Post  { id Int @id @default(autoincrement()); title String }
model Video { id Int @id @default(autoincrement()); url   String }
```

```ts
class Post  extends Model { static override table = 'post';  id!: number; title!: string }
class Video extends Model { static override table = 'video'; id!: number; url!:   string }

class Comment extends Model {
  static override relations = {
    commentable: {
      type:      'morphTo',
      morphName: 'commentable',
      types:     () => [Post, Video],   // closed list of allowed targets
    },
  } as const
  id!: number
  body!: string
  commentableId!: number
  commentableType!: string
}

class Post extends Model {
  static override relations = {
    comments: { type: 'morphMany', model: () => Comment, morphName: 'commentable' },
  } as const
}
```

**Reads** route through `instance.related(name)` like any other relation:

```ts
const post     = await Post.find(1)
const comments = await post!.related('comments').get()

const comment = await Comment.find(1)
const owner   = await comment!.related('commentable').first()   // Post or Video, resolved via commentableType
```

**Writes** to the polymorphic side use `Model.morph()` to stamp the discriminator pair from a parent instance:

```ts
await Comment.create({
  body: 'Nice post',
  ...Model.morph('commentable', post!),     // → { commentableId: post.id, commentableType: 'Post' }
})
```

The discriminator stored in `{morphName}Type` defaults to the parent's `Class.name`. Override per-class with `static morphAlias = 'post'` to decouple persisted values from JS class names — useful for rename-safe storage. Treat the alias as immutable once data exists. In dev mode (`NODE_ENV !== 'production'`), `morphTo` resolution checks the `types` list for duplicate discriminators and throws if two classes resolve to the same value.

`morphOne` is identical to `morphMany` except `related('image').first()` returns a single row instead of a collection.

### Polymorphic many-to-many (`morphToMany` / `morphedByMany`)

A taggable system is the canonical example: `Post` and `Video` both share a single `Tag` table through one shared pivot. The pivot carries the strong-side FK (`tagId`) plus a polymorphic pair (`taggableId` + `taggableType`).

```prisma
model Tag      { id Int @id @default(autoincrement()); name String @unique }
model Post     { id Int @id @default(autoincrement()); title String }
model Video    { id Int @id @default(autoincrement()); url   String }

model Taggable {
  tagId         Int
  taggableId    Int
  taggableType  String
  @@id([tagId, taggableId, taggableType])
  @@index([taggableId, taggableType])
}
```

Owning side (`morphToMany`) — the model that *has* tags:

```ts
class Post extends Model {
  static override relations = {
    tags: {
      type:       'morphToMany',
      model:      () => Tag,
      pivotTable: 'taggable',
      morphName:  'taggable',     // → taggableId / taggableType columns on the pivot
    },
  } as const
}

const post = await Post.find(1)
const tags = await post!.related('tags').orderBy('name').get()
await post!.tags().attach([3, 5])
```

Inverse side (`morphedByMany`) — the strong-side model walking back to each owning class. Each declaration targets one concrete inverse class, so a single `Tag` declares `posts` and `videos` separately:

```ts
class Tag extends Model {
  static override relations = {
    posts:  {
      type:       'morphedByMany',
      model:      () => Post,
      pivotTable: 'taggable',
      morphName:  'taggable',
    },
    videos: {
      type:       'morphedByMany',
      model:      () => Video,
      pivotTable: 'taggable',
      morphName:  'taggable',
    },
  } as const
}

const tag = await Tag.find(7)
const taggedPosts  = await tag!.related('posts').get()
const taggedVideos = await tag!.related('videos').get()
await tag!.posts().attach([1, 2])
```

The discriminator written to `taggableType` defaults to the owning class's `Class.name`; override per-class via `static morphAlias = 'post'`. Once data exists, treat `morphAlias` as immutable storage.

For typed accessors, define the method explicitly — same idiom as `belongsToMany`:

```ts
class Post extends Model {
  static override relations = { /* ... */ }
  tags() { return Model.morphToMany(this, 'tags') }
}
```

Don't use a class-field annotation (`tags!: () => ...`) — it creates an own property at construction that shadows the prototype-installed accessor.

**v1 limitations** (mirror `belongsToMany`):

- Pivot columns are not surfaced on read.
- No `withTimestamps` — pass `attach(ids, { createdAt: new Date() })` or use schema defaults.
- Each `morphedByMany` relation targets one concrete inverse class. To query *every* taggable for a tag, declare one relation per concrete class and merge results in app code (or drop to the adapter).

### Eager loading polymorphic relations

`Model.with(...)` resolves polymorphic relations in batched IN-queries — one query per `morphOne` / `morphMany` relation, one per distinct discriminator for `morphTo`, two (pivot + related) for `morphToMany` / `morphedByMany`. The N+1 path is gone:

```ts
// Single batched query for the comments — one round-trip, not N
const posts = await Post.with('comments').all()

posts[0]!.comments       // Comment[]  (morphMany → array)
posts[0]!.comments[0]    // Comment instance

// morphOne — single instance or null per parent
const users = await User.with('avatar').all()
users[0]!.avatar         // Image | null

// morphTo — the inverse direction; grouped by `{morphName}Type` so each
// concrete target table is hit once, not once per child
const comments = await Comment.with('commentable').all()
comments[0]!.commentable // Post | Video — the resolved parent instance

// morphToMany — pivot lookup + IN-clause on the related table
const post = (await Post.with('tags').get())[0]
post!.tags               // Tag[]
```

Mix freely with direct relations — names are partitioned automatically:

```ts
// 'author' goes through Prisma's `include`; 'comments' + 'tags' route
// through the polymorphic batch path. Single chain, all attached.
const posts = await Post.with('author', 'comments', 'tags').get()
```

Soft-deletes on the related table are respected — queries go through the related Model's own query path which already filters `deletedAt IS NULL`.

::: tip Single-instance + paginate
`.with()` works on every terminal — `.find(id)`, `.first()`, `.get()`, `.all()`, `.paginate()`. For pagination, the polymorphic load runs against the current page's rows only, so a single batched query per relation regardless of page size.
:::

**Not yet supported** (v1):

- **Nested** polymorphic eager-load — `Post.with('comments.author')`. Single level only for now.
- **Constrained** polymorphic eager-load — `Post.with('comments', (q) => q.where('approved', true))`. The constrain-callback form on `with()` is direct-relation only today; use `whereHas` + a second `with(...)` chain as a workaround, or load + filter in app code.

### Querying parents by related rows

Filter parent records by the existence (or absence) of a related row, optionally with a constraint on the relation:

```ts
// Posts that have at least one comment
const commented = await Post.whereHas('comments').get()

// Posts whose comments include one approved by Alice
const aliceApproved = await Post.whereHas('comments', (q) =>
  q.where('approved', true).where('authorId', alice.id)
).get()

// Posts that have NO comments
const lonely = await Post.whereDoesntHave('comments').get()

// withWhereHas — same constraint applied to BOTH the parent filter and the eager-loaded relation
const recentlyActive = await Post.withWhereHas('comments', (q) =>
  q.where('createdAt', '>', last24h)
).get()

// whereBelongsTo — inverse of whereHas for belongsTo relations
const myPosts = await Post.whereBelongsTo(currentUser).get()
// shorthand for Post.where('userId', currentUser.id)
```

`whereHas` works on every relation type; **on Prisma**, direct `hasMany` / `hasOne` / `belongsTo` relations need an `@relation` declared in `schema.prisma` so the adapter can use native `some` / `none`. Polymorphic and pivot relations route through a 2-step lookup so they work without a Prisma-declared relation. **On Drizzle**, every related table referenced from `whereHas` must be registered via `tables: { ... }` on `drizzle()` config or `DrizzleTableRegistry.register(name, table)` — missing tables surface a clear error.

`whereHas` has two limitations in v1: nested `whereHas` inside a constrain callback throws (deferred), and `morphTo` cannot be used with `whereHas` since the related table is dynamic — filter on `{morphName}Id` / `{morphName}Type` directly instead. `withWhereHas` falls back to plain `with(relation)` on adapters that don't yet implement constrained eager loading (Drizzle today).

### Aggregate eager loading

Stamp counts, sums, or existence flags from related rows onto each parent without loading the full collection:

```ts
const posts = await Post
  .withCount('comments')
  .withSum('comments', 'helpfulVotes')
  .withExists('comments')           // boolean — does this post have any comments?
  .get()

posts[0].commentsCount               // number
posts[0].commentsSumHelpfulVotes     // number
posts[0].commentsExists              // boolean
```

The full set: `withCount`, `withSum`, `withMin`, `withMax`, `withAvg`, `withExists`. Each returns a derived column on the parent: `<relation>Count`, `<relation>Sum<Column>`, `<relation>Exists`, etc. (camelCase). The aggregates are enumerable on the instance for `JSON.stringify` / `Object.entries`, but tagged so they don't reach `save()` / `update()` writes.

For per-instance loading after the fact, use `loadCount` / `loadSum` / `loadMissing`:

```ts
const post = await Post.find(id)
await post.loadCount('comments')           // sets post.commentsCount
await post.loadSum('comments', 'votes')    // sets post.commentsSumVotes
await post.loadMissing('author', 'tags')   // load only relations not already eager-loaded
```

`loadMissing` is the lazy companion to `with()`: skip what's already there, fetch what isn't.

## Route model binding

Routes that resolve a parameter into a Model instance (`/users/:user`, `/posts/:post`) can opt in to automatic resolution via `router.bind(name, ModelClass)`. The router's per-route binding middleware reads `req.params.user`, calls `User.findForRoute(value)`, and exposes the result as `req.bound!.user`. A 404-equivalent `RouteModelNotFoundError` is thrown when no record matches.

```ts
// routes/web.ts
import { router } from '@rudderjs/router'
import { User } from '../app/Models/User.js'
import { Post } from '../app/Models/Post.js'

router.bind('user', User)   // resolves /users/:user by id
router.bind('post', Post)   // routeKey on Post determines the column

router.get('/users/:user', (req) => {
  const user = req.bound!['user'] as User
  return user.toJSON()
})
```

By default `findForRoute(value)` runs `Model.where('id', value).first()`. Override the column with `static routeKey`, or override the resolver entirely to apply additional constraints:

```ts
class Post extends Model {
  // Resolve by slug instead of id.
  static override routeKey = 'slug'

  // Only published posts are bindable.
  static override async findForRoute(value: string) {
    return await this.where('slug', value)
      .where('publishedAt', '!=', null)
      .first()
  }
}
```

`router.bind(name, Model, { optional: true })` flips the missing-record behaviour — `req.bound!.name` is set to `null` instead of throwing. The raw string remains available at `req.params.name` regardless.

## Mass assignment

`static fillable` is an allowlist of columns that may be set from `Model.create()`, `Model.update()`, or `instance.fill()`. Any other key in the payload is silently dropped before the data reaches the adapter — so attacker-controlled fields like `isAdmin` can't sneak in through a form post.

```ts
class User extends Model {
  static fillable = ['name', 'email']
}

// `isAdmin` is silently dropped:
await User.create({ name: 'Alice', email: 'a@b.com', isAdmin: true })
```

`static guarded` is the inverse — a denylist. Use `['*']` to forbid every key (the most restrictive setting). When both are set, `fillable` wins.

```ts
class User extends Model {
  static guarded = ['isAdmin', 'role']
}
```

Both empty (the default) means no enforcement — every key passes through. Setting either opts in.

### Bypassing the filter

- **`instance.forceFill(data)`** — mass-assign without the filter. Use for trusted sources (factories, internal sync, fixtures).
- **Direct property assignment + `save()`** — `user.isAdmin = true; await user.save()` works regardless of `fillable`. The protection only applies to bulk-assignment paths; properties set one-by-one are intentional.

```ts
const u = new User()
u.forceFill({ name: 'Alice', isAdmin: true })  // both fields set
await u.save()
```

### Lookup attrs in `firstOrCreate`

`firstOrCreate(attrs, values)` routes through `create()` for the create branch, so `attrs` keys must be fillable too — otherwise the lookup column won't be set on the new record. If `email` is your lookup attr, include it in `fillable`.

## Casts

`static casts` transforms attribute values when reading from and writing to the database:

```ts
class Post extends Model {
  static casts = {
    isPublished: 'boolean',
    publishedAt: 'date',
    metadata:    'json',
    viewCount:   'integer',
    tags:        'array',
  } as const
}
```

Built-in casts: `'string'`, `'integer'`, `'float'`, `'boolean'`, `'date'`, `'datetime'`, `'json'`, `'array'`, `'collection'`, `'encrypted'`, `'encrypted:array'`, `'encrypted:object'`. Encrypted casts require `@rudderjs/crypt`.

For custom transforms, implement `CastUsing` — see the [@rudderjs/orm README](https://github.com/rudderjs/rudder/tree/main/packages/orm) for examples.

### `vector({ dimensions })` — pgvector

For pgvector columns, use the `vector` cast factory. Writes validate length and finiteness; reads return a `number[]`:

```ts
import { Model, vector } from '@rudderjs/orm'

class Document extends Model {
  static casts = {
    embedding: vector({ dimensions: 1536 }),
  }
  declare embedding: number[]
}
```

Pair with `whereVectorSimilarTo()` on the QueryBuilder for similarity search:

```ts
const matches = await Document
  .where('tenantId', tenantId)
  .whereVectorSimilarTo('embedding', queryEmbedding, { metric: 'cosine', limit: 10 })
  .get()
```

Postgres + the pgvector extension required. Scaffold the migration with `pnpm rudder make:migration --vector <table> <column> <dimensions>` (e.g. `--vector documents embedding 1536`; optional `--metric cosine|l2|inner-product`, default cosine) — it generates the `CREATE EXTENSION`, column add, and HNSW index in your ORM's migration format. See [Vector stores](/guide/vector-stores) for hosted-vector-store integration with `@rudderjs/ai`.

## Accessors and mutators

Use `Attribute.make()` for computed reads and write transforms:

```ts
import { Model, Attribute } from '@rudderjs/orm'

class User extends Model {
  static attributes = {
    fullName: Attribute.make({
      get: (_, attrs) => `${attrs.firstName} ${attrs.lastName}`,
    }),
    password: Attribute.make({
      set: (value) => hashSync(String(value)),
    }),
  }
}
```

Accessors run in `toJSON()`. Mutators run inside `Model.create()` / `Model.update()` before data hits the adapter. Add computed accessors to JSON output with `static appends = ['fullName']`.

## Scopes

Pull common query fragments into named scopes:

```ts
class Article extends Model {
  static globalScopes = {
    ordered: (q) => q.orderBy('createdAt', 'DESC'),
    active:  (q) => q.where('active', true),
  }

  static scopes = {
    published: (q) => q.where('status', 'published'),
    byAuthor:  (q, id: string) => q.where('authorId', id),
  }
}

await Article.query().get()                          // both global scopes apply
await Article.query().withoutGlobalScope('active').get()
await Article.query().scope('published').scope('byAuthor', userId).get()
```

Calling `.scope('name')` with an unknown name throws — typos surface immediately.

## Hidden and visible fields

Control what appears in `toJSON()`:

```ts
class User extends Model {
  static hidden  = ['password', 'rememberToken']  // denylist
}

class PublicUser extends Model {
  static visible = ['id', 'name', 'avatar']       // allowlist (takes precedence)
}
```

Per-instance overrides: `user.makeVisible(['email']).makeHidden(['phone'])`. Decorators (`@Hidden`, `@Visible`, `@Appends`) work too if you prefer property-level annotations.

`hidden`/`visible` are model-wide. When different endpoints need different shapes of the same model — or conditional fields, relation guards, pagination envelopes — reach for [API Resources](/guide/database/resources) instead.

## Observers

Hook into model lifecycle events to enforce invariants, transform data, or cancel operations:

```ts
class ArticleObserver {
  creating(data) { data.slug = slugify(data.title); return data }
  deleting(id)   { if (id === protectedId) return false }
}

Article.observe(ArticleObserver)
```

Events:

- `retrieved` — fires after `find` / `first` / `all` / `paginate` returns a non-null record (once per record).
- `creating` / `created`
- `updating` / `updated`
- `saving` / `saved` — fire on **both** create and update. `saving` runs after the `creating` / `updating` handler; `saved` runs after `created` / `updated`. Use these when the same hook applies to inserts and modifications (e.g. recomputing a slug, audit logging).
- `deleting` / `deleted`
- `restoring` / `restored`

The `*ing` events (and `saving`) can return a new value to transform the payload, or `false` to cancel the operation. Post-events fire after the operation succeeds. Observers fire only for static methods (`Model.create()`, `Model.update()`); `Model.query().create()` bypasses them. For inline hooks use `Model.on('creating', fn)`.

### Muting events

`Model.withoutEvents(fn)` runs the callback with all observers and listeners muted for that model class. Useful for bulk seeding or tests:

```ts
await User.withoutEvents(async () => {
  for (const row of bigDataset) {
    await User.create(row)   // no creating/saving/created/saved fire
  }
})
```

The mute is class-scoped and restored even if `fn` throws.

For one-off operations, instances expose `*Quietly` variants that mute events for that single call without wrapping a callback:

```ts
await user.saveQuietly()      // skip saving/saved/updating/updated
await user.deleteQuietly()    // skip deleting/deleted
await user.restoreQuietly()   // skip restoring/restored
```

Quiet ops route through the same `withoutEvents` machinery — observers, instance-level `Model.on(...)` listeners, and dispatched event-bus events are all suppressed. They're the right tool for audit-log writes, soft cascade cleanup, and other "I know what I'm doing — please don't recursively fire observers" cases. For static-method paths (`Model.create`, `Model.update`, etc.), wrap the call in `Model.withoutEvents(() => ...)`.

## Pruning

Models that accumulate stale rows — read notifications, expired tokens, soft-deleted records past retention — can declare a pruning policy and let `pnpm rudder model:prune` sweep them on a schedule.

Declare a static `prunable()` returning a query builder for stale rows. The optional static `pruning(model)` hook fires per row before each delete:

```ts
import { Model } from '@rudderjs/orm'

class Notification extends Model {
  static prunable() {
    return Notification.where('readAt', '<', sub30d())
  }

  static pruning(record: Notification) {
    // Optional: per-row hook — log, archive, fire an observer-equivalent
  }
}
```

`pnpm rudder model:prune` calls `prunable()`, walks the result in chunks (default 1000), and deletes each row through the normal `Model.delete()` path so observers fire and soft-delete semantics apply. Pass `--pretend` for a dry-run, `--chunk` to tune batch size, `--model` / `--except` to scope:

```bash
pnpm rudder model:prune                         # all Prunable models
pnpm rudder model:prune --pretend               # dry-run
pnpm rudder model:prune --model Notification    # one model
pnpm rudder model:prune --except User           # everything except User
pnpm rudder model:prune --chunk 500             # smaller batches
```

For high-volume tables where firing observers per row is too expensive, opt into mass-pruning — `pruning()` is skipped, soft-deletes are bypassed, and the runner issues a single bulk `DELETE` per chunk against the `prunable()` query:

```ts
import { Model } from '@rudderjs/orm'

class WebhookDelivery extends Model {
  static override pruneMode = 'mass' as const

  static prunable() {
    return WebhookDelivery.where('completedAt', '<', sub7d())
  }
}
```

`pruneMode` defaults to `'instance'` on the base `Model`. The runtime mode is read from this static field; the `Prunable` and `MassPrunable` interfaces exported from `@rudderjs/orm` are typing aids if you want to assert intent at the class level.

Schedule daily pruning in `routes/console.ts`:

```ts
import { schedule } from '@rudderjs/schedule'
import { pruneModels } from '@rudderjs/orm'

schedule.call(() => pruneModels()).daily().description('Prune stale rows')
```

## Pitfalls

- **`assert.deepStrictEqual(result, plainObject)` after a query.** Query results are now Model instances — node's `deepStrictEqual` checks the prototype, so this assertion fails against a plain literal. Compare via `{ ...result }` or assert `result instanceof Model`. See [Hydrated instances](#hydrated-instances).
- **`firstOrCreate` lookup column missing on the created row.** The lookup attrs go through `create()`, which respects `fillable`. If your lookup column isn't in `fillable`, the new row will be missing it. Add it to `fillable`, or use `forceFill()` on a manual `new Model().forceFill(...).save()`. See [Mass assignment — Lookup attrs](#lookup-attrs-in-firstorcreate).
- **Forgetting to register the adapter.** `Model.*` static methods throw `[RudderJS ORM] No adapter registered`. The database provider must boot before any model query runs — see [Database](/guide/database).
- **`Model.query().create()` skipping observers.** Use `Model.create()` (and the other static methods) when you need observer hooks.
- **Using the SQL table name as `static table` on Prisma.** `static table` must be the Prisma **client delegate** (singular camelCase — e.g. `user`, `blogPost`, `oAuthClient`), not the `@@map`'d SQL table (`users`, `blog_posts`, `oauth_clients`). The adapter dispatches as `prisma[Model.table]`. Wrong name surfaces as `[RudderJS ORM] Prisma has no delegate for table "<x>"`.
