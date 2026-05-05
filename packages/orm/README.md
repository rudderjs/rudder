# @rudderjs/orm

ORM contract, `Model` base class, and `ModelRegistry` for RudderJS applications.

```bash
pnpm add @rudderjs/orm
```

This package provides the shared abstractions. For a working database connection use an adapter:

- `@rudderjs/orm-prisma` — Prisma adapter (SQLite, PostgreSQL, MySQL)
- `@rudderjs/orm-drizzle` — Drizzle adapter (SQLite, PostgreSQL, LibSQL)

---

## Setup

Register a database provider in `bootstrap/providers.ts`:

```ts
import { database } from '@rudderjs/orm-prisma'
import configs from '../config/index.js'

export default [
  database(configs.database),
  // ...other providers
]
```

The provider calls `ModelRegistry.set(adapter)` during boot — no manual wiring needed.

---

## Defining a Model

```ts
import { Model } from '@rudderjs/orm'

export class User extends Model {
  static override table    = 'users'   // optional — defaults to lowercase class name + 's'
  static override fillable = ['name', 'email', 'role']
  static override hidden   = ['password']

  declare id:       number
  declare name:     string
  declare email:    string
  declare password: string
}
```

---

## Querying

All static query methods delegate to the registered adapter's `QueryBuilder`.

```ts
// Find by primary key — returns null if not found
const user = await User.find(1)

// Fetch all rows
const users = await User.all()

// Static shortcuts for common queries (no builder needed)
const firstUser = await User.first()              // first row
const total     = await User.count()              // row count
const page      = await User.paginate(1, 15)      // { data, total, page, perPage, lastPage }

// Conditional query — returns a chainable QueryBuilder
const admins = await User.where('role', 'admin').get()

// Eager-load relations
const posts = await Post.with('author', 'tags').get()

// Raw query builder
const recent = await User.query()
  .orderBy('createdAt', 'desc')
  .limit(10)
  .get()
```

### QueryBuilder methods

| Method | Returns | Description |
|---|---|---|
| `where(col, val)` | `QueryBuilder` | Add a WHERE clause |
| `orWhere(col, val)` | `QueryBuilder` | Add an OR WHERE clause |
| `orderBy(col, dir)` | `QueryBuilder` | Add ORDER BY |
| `limit(n)` | `QueryBuilder` | Limit result count |
| `offset(n)` | `QueryBuilder` | Skip n rows |
| `with(...rels)` | `QueryBuilder` | Eager-load relations |
| `scope(name, ...args)` | `QueryBuilder` | Apply a local scope defined in `static scopes` |
| `withoutGlobalScope(name)` | `QueryBuilder` | Rebuild the query excluding a named global scope |
| `first()` | `Promise<T \| null>` | First matching row |
| `find(id)` | `Promise<T \| null>` | Find by primary key |
| `get()` | `Promise<T[]>` | All matching rows |
| `all()` | `Promise<T[]>` | All rows (no conditions) |
| `count()` | `Promise<number>` | Row count |
| `create(data)` | `Promise<T>` | Insert a new row |
| `update(id, data)` | `Promise<T>` | Update a row by primary key |
| `delete(id)` | `Promise<void>` | Delete a row by primary key |
| `paginate(page, perPage)` | `Promise<PaginatedResult<T>>` | Paginated results |

### Creating records

```ts
const user = await User.create({ name: 'Alice', email: 'alice@example.com' })
```

---

## Relations

Eager loading is delegated to the adapter — Prisma's `include` / `select` and Drizzle's `with()` are already type-safe and support depth, ordering, and selective columns. The ORM ships a thin **lazy fluent fetch** API on top: declare the relation on `static relations` and call `instance.related(name)` to get a chainable QueryBuilder scoped to the parent record.

```ts
class User extends Model {
  static override relations = {
    posts: { type: 'hasMany',       model: () => Post,  foreignKey: 'authorId' },
    team:  { type: 'belongsTo',     model: () => Team,  foreignKey: 'teamId' },
    phone: { type: 'hasOne',        model: () => Phone, foreignKey: 'userId' },
    roles: { type: 'belongsToMany', model: () => Role,  pivotTable: 'role_user' },
  } as const
}

const user = await User.find(1)
const recentPosts = await user!.related('posts').orderBy('createdAt', 'desc').limit(5).get()
const team        = await user!.related('team').first()

// Many-to-many: chainable read filtered through the pivot
const activeRoles = await user!.related('roles').where('active', true).get()

// Pivot mutations on the auto-generated per-relation accessor
await user!.roles().attach([1, 2, 3])
await user!.roles().attach([1], { addedBy: 'admin' })
await user!.roles().detach([2])
const result = await user!.roles().sync([1, 3, 5])
// → { attached: [3, 5], detached: [2] }
```

Supported types: `hasOne`, `hasMany`, `belongsTo`, `belongsToMany`, `morphMany`, `morphOne`, `morphTo`. Defaults: `foreignKey` → `<parentClassName>Id` for `hasOne`/`hasMany`, `<relatedClassName>Id` for `belongsTo`. For `belongsToMany`, `pivotTable` is required; `foreignPivotKey` / `relatedPivotKey` default to camelCase of each side's class name + `Id`. The `model: () => Class` thunk avoids circular-import issues.

### Polymorphic relations

`morphMany` / `morphOne` / `morphTo` let one related table belong to several parent types (Comments on Posts and Videos, Images on Users and Products, etc.). The polymorphic side carries two columns — `{morphName}Id` and `{morphName}Type` — written in **camelCase** for ORM consistency (a deliberate divergence from Laravel's snake_case).

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
      type: 'morphTo' as const,
      morphName: 'commentable',
      types: () => [Post, Video],   // closed list of allowed targets
    },
  }
  id!: number
  body!: string
  commentableId!: number
  commentableType!: string
}

class Post extends Model {
  static override relations = {
    comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
  }
}

// Reads
const post     = await Post.find(1)
const comments = await post!.related('comments').get()
const comment  = await Comment.find(1)
const owner    = await comment!.related('commentable').first()    // Post or Video

// Writes — Model.morph() builds the { id + type } payload
await Comment.create({
  body: 'Nice post',
  ...Model.morph('commentable', post!),
})
```

The discriminator stored in `{morphName}Type` defaults to the parent's class name (`'Post'`, `'Video'`). Override per-class with `static morphAlias = 'post'` to decouple persisted values from JS class names — useful for rename-safe storage. Once set and data exists, treat it as immutable. In dev mode (`NODE_ENV !== 'production'`), `morphTo` resolution checks the `types` list for duplicate discriminators and throws if two classes resolve to the same value.

`belongsToMany` and polymorphic v1 limitations: pivot columns are not surfaced on read results (write side only), no `withTimestamps`, no fluent eager-load (`User.with('comments.commentable')`) — drop to the adapter (Prisma `include`) for that. Mutations on the deferred read query (`create`/`update`/`delete`/`insertMany`/`deleteAll`) throw — write through the related model directly. `morphToMany` / `morphedByMany` are supported with the same `attach` / `detach` / `sync` accessor as `belongsToMany`, plus discriminator-scoped pivot reads/writes — see the [polymorphic many-to-many guide](https://rudderjs.com/docs/database/models#polymorphic-many-to-many-morphtomany-morphedbymany).

### Filtering by relation predicate — `whereHas` / `whereDoesntHave` / `withWhereHas` / `whereBelongsTo`

Filter a query by whether a relation has at least one matching row. The optional callback narrows the relation predicate further — chain plain `where()` calls inside it.

```ts
// Users with at least one post
await User.whereHas('posts').get()

// Users with at least one published post
await User.whereHas('posts', q => q.where('published', true)).get()

// Inverse — users with zero published posts
await User.whereDoesntHave('posts', q => q.where('published', true)).get()

// Filter AND eager-load under the same constraint (constrained eager-load
// via the adapter's `withConstrained` when supported, falls back to plain
// `with(relation)` otherwise — Drizzle today)
await User.withWhereHas('posts', q => q.where('published', true)).get()

// Sugar over `where(fk, parent.id)` — looks up the FK column from the
// belongsTo declaration. Pass the relation name when the calling class
// has multiple belongsTo to the same parent.
await Post.whereBelongsTo(user).get()
await Comment.whereBelongsTo(post, 'post').get()
```

Supported relation types: `hasMany`, `hasOne`, `belongsTo`, `belongsToMany`, `morphMany`, `morphOne`, `morphToMany`, `morphedByMany`. **`morphTo` is intentionally not supported** — the related table is dynamic, so a single subquery can't represent it. Filter on the `{morphName}Id` / `{morphName}Type` columns directly when you need that semantic.

**Adapter notes:**

- **Prisma** uses native `some` / `none` filters for direct relations (`hasMany`/`hasOne`/`belongsTo`) — those relations must be declared in `schema.prisma` with the same name. Polymorphic and pivot relations route through a 2-step lookup (related → pivot → IN list) so they work without a Prisma-declared relation.
- **Drizzle** uses correlated `EXISTS (...)` / `NOT EXISTS (...)` subqueries. Every related table referenced from a `whereHas` call must be registered via `tables: { ... }` on `drizzle()` config or `DrizzleTableRegistry.register(name, table)`.
- **`withWhereHas`** uses `withConstrained` when the adapter implements it (Prisma → nested `include: { rel: { where } }`). The Drizzle adapter doesn't yet — `withWhereHas` falls back to plain `with(relation)` there.
- **Nested `whereHas` inside the constrain callback throws** — recursive predicates are deferred to v2. Filter on flat columns inside the callback for now.
- **Soft deletes inside the relation predicate** — apply `q.where('deletedAt', null)` explicitly inside the constrain callback when needed.

### Aggregate eager loading — `withCount` / `withSum` / `withMin` / `withMax` / `withAvg` / `withExists`

Eager-load aggregates of related rows alongside the parent in a single query. The result is stamped onto each parent under a deterministic alias (`<relation><Verb><Column>`) so admin tables, dashboards, and any list page can render counts / sums next to each row without N+1.

```ts
// Counts: stamps user.postsCount on each row
await User.query().withCount('posts').get()

// Sum / min / max / avg of a related column — stamps postsSumViews etc.
await User.query().withSum('posts', 'views').get()
await Login.query().withMax('sessions', 'createdAt').get()

// Boolean — stamps subscriptionExists (true/false)
await User.query().withExists('subscription').get()

// Multiple at once
await User.query()
  .withCount('posts')
  .withSum('orders', 'total')
  .paginate(1)
```

**Constraint callbacks (map form)** — narrow what counts as a "matching" row, optionally aliasing the result key:

```ts
await User.query()
  .withCount({ posts: q => q.where('published', true).as('publishedPosts') })
  .get()
// → user.publishedPostsCount

await User.query()
  .withSum({
    orders: { column: 'total', constraint: q => q.where('status', 'paid') },
  })
  .get()
// → user.ordersSumTotal
```

**Per-instance variants** — `loadCount` / `loadExists` / `loadSum` / `loadMin` / `loadMax` / `loadAvg` mutate a single instance in place. Use these when you've already fetched one parent and need the aggregate on demand. For batched loads on a list, prefer `Model.query().withCount(...)` on the parent query.

```ts
const user = await User.find(1)
await user!.loadCount('posts')
console.log(user!.postsCount)
```

**`loadMissing(...names)`** — eager-load each named relation onto the instance only when the property is currently `null` / `undefined`. Skips relations that are already populated.

```ts
const user = await User.query().with('profile').first()
// profile is already populated; only `posts` issues a query
await user!.loadMissing('profile', 'posts')
```

**Notes:**

- Aggregate columns are enumerable own-properties — they appear in `JSON.stringify(row)`, `Object.entries(row)`, and `{ ...row }` spreads. They're tagged via a Symbol so `model.save()` strips them out before writing back to the DB.
- **`withCount` on `belongsTo` throws** (every parent matches exactly one row, so the count is always 0 or 1). Use `withExists('relation')` to test presence, or query the inverse `hasMany` side.
- **`withCount` on `morphTo` throws** — the related table is dynamic. Aggregate per-target by querying each target class separately.
- Results are typed `unknown` at the property-access site — cast at the call site (`(user as { postsCount: number }).postsCount`) since the QB type doesn't track the injected aliases. The instance load path doesn't need a cast at the access site.
- **Soft deletes** on the related model are applied automatically — the adapter ANDs `deleted_at IS NULL` into the aggregate subquery.
- **Adapter behavior**: Prisma uses `_count.select` for direct count/exists (round-trip-saving) and a second-batch `groupBy` for polymorphic / pivot / numeric aggregates. Drizzle emits one correlated subselect per aggregate in the SELECT list, joining through the pivot table when present.

---

## Route model binding

Models opt into route binding by exposing `static routeKey` (defaults to `'id'`) and `static findForRoute(value)`. The router's `router.bind(name, ModelClass)` API picks them up:

```ts
// Model
class Post extends Model {
  static override routeKey = 'slug'

  // Optional override — apply additional constraints.
  static override async findForRoute(value: string) {
    return await this.where('slug', value).where('publishedAt', '!=', null).first()
  }
}

// routes/web.ts
router.bind('post', Post)
router.get('/posts/:post', (req) => req.bound!['post'])
```

Returns `null` when not found — the router translates that into a `RouteModelNotFoundError`. See the [routing guide](https://github.com/rudderjs/rudder/blob/main/docs/guide/routing.md#route-model-binding) for the full router-side contract.

---

## Attribute Casts

Casts automatically transform attribute values when reading from and writing to the database.

```ts
import { Model } from '@rudderjs/orm'

class Post extends Model {
  static override casts = {
    isPublished: 'boolean',
    publishedAt: 'date',
    metadata:    'json',
    viewCount:   'integer',
    rating:      'float',
    tags:        'array',
  } as const

  declare isPublished: boolean
  declare publishedAt: Date
  declare metadata:    Record<string, unknown>
  declare viewCount:   number
  declare rating:      number
  declare tags:        string[]
}
```

### Built-in cast types

| Cast | Get (read) | Set (write) |
|---|---|---|
| `'string'` | `String(v)` | `String(v)` |
| `'integer'` | `parseInt(v)` | `parseInt(v)` |
| `'float'` | `parseFloat(v)` | `parseFloat(v)` |
| `'boolean'` | `true/false` from truthy values | `1` / `0` |
| `'date'` | `new Date(v)` | `toISOString().slice(0,10)` |
| `'datetime'` | `new Date(v)` | `toISOString()` |
| `'json'` | `JSON.parse(v)` | `JSON.stringify(v)` |
| `'array'` | `JSON.parse(v)` | `JSON.stringify(v)` |
| `'collection'` | `JSON.parse(v)` (as array) | `JSON.stringify(v)` |
| `'encrypted'` | Decrypts string | Encrypts string |
| `'encrypted:array'` | Decrypts + parses JSON | Encrypts JSON |
| `'encrypted:object'` | Decrypts + parses JSON | Encrypts JSON |

Encrypted casts require `@rudderjs/crypt` to be installed.

### Custom cast classes

```ts
import type { CastUsing } from '@rudderjs/orm'

class MoneyCast implements CastUsing {
  get(key: string, value: unknown) {
    return Number(value) / 100  // cents → dollars
  }
  set(key: string, value: unknown) {
    return Math.round(Number(value) * 100)  // dollars → cents
  }
}

class Product extends Model {
  static override casts = { price: MoneyCast }
}
```

### `@Cast` decorator

```ts
import { Model, Cast } from '@rudderjs/orm'

class User extends Model {
  @Cast('boolean') isAdmin = false
  @Cast('date')    createdAt = new Date()
  @Cast(MoneyCast) balance = 0
}
```

---

## Accessors & Mutators

Define computed getters and write transformations using `Attribute.make()`.

```ts
import { Model, Attribute } from '@rudderjs/orm'

class User extends Model {
  static override attributes = {
    // Accessor — transform on read
    firstName: Attribute.make({
      get: (value) => String(value).charAt(0).toUpperCase() + String(value).slice(1),
    }),

    // Computed from multiple columns
    fullName: Attribute.make({
      get: (_, attrs) => `${attrs['firstName']} ${attrs['lastName']}`,
    }),

    // Mutator — transform on write (create/update)
    password: Attribute.make({
      set: (value) => hashSync(String(value)),
    }),

    // Both accessor and mutator
    email: Attribute.make({
      get: (v) => String(v).toLowerCase(),
      set: (v) => String(v).toLowerCase().trim(),
    }),
  }
}
```

- **Accessors** run in `toJSON()` and transform the raw stored value.
- **Mutators** run in `Model.create()` and `Model.update()` before data hits the database.
- Attribute accessors take priority over casts for the same key.

---

## Serialization Controls

### `static hidden` / `static visible`

```ts
class User extends Model {
  static override hidden = ['password', 'rememberToken']  // denylist
}

class PublicUser extends Model {
  static override visible = ['id', 'name', 'avatar']  // allowlist (takes precedence)
}
```

### `static appends`

Always include computed accessor values in JSON output:

```ts
class User extends Model {
  static override appends = ['fullName']

  static override attributes = {
    fullName: Attribute.make({
      get: (_, attrs) => `${attrs['firstName']} ${attrs['lastName']}`,
    }),
  }
}

JSON.stringify(user) // includes "fullName" even though it's not a stored column
```

### Decorators

```ts
import { Model, Hidden, Visible, Appends } from '@rudderjs/orm'

class User extends Model {
  @Hidden   password = ''        // added to static hidden
  @Visible  id = 0               // added to static visible
  @Visible  name = ''
  @Appends  fullName = ''        // added to static appends
}
```

### Instance-level overrides

```ts
const user = await User.find(1)

// Temporarily show hidden fields
user.makeVisible(['password'])

// Temporarily hide fields
user.makeHidden(['email'])

// Replace the lists entirely
user.setVisible(['id', 'name'])
user.setHidden(['password', 'token'])

// Merge into existing lists
user.mergeVisible(['avatar'])
user.mergeHidden(['ssn'])

// All return `this` for chaining
user.makeVisible(['email']).makeHidden(['phone']).toJSON()
```

---

## API Resources

Transform model data for API responses with conditional fields and nested resources.

### `JsonResource`

```ts
import { JsonResource } from '@rudderjs/orm'

class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id:    this.resource.id,
      name:  this.resource.name,
      email: this.resource.email,

      // Only include when condition is true
      admin: this.when(this.resource.role === 'admin', true),

      // Only include when value is not null
      bio: this.whenNotNull(this.resource.bio, (b) => b.trim()),

      // Only include when relation is loaded
      posts: this.whenLoaded('posts'),

      // Merge multiple fields conditionally
      ...this.mergeWhen(this.resource.isAdmin, {
        permissions: this.resource.permissions,
        lastLogin:   this.resource.lastLogin,
      }),
    }
  }
}

// Single resource
const json = new UserResource(user).toArray()

// Collection
const collection = UserResource.collection(users)
const response = await collection.toResponse()
// → { data: [...] }
```

### `ResourceCollection`

```ts
import { ResourceCollection } from '@rudderjs/orm'

// With pagination metadata
const collection = UserResource.collection(users, {
  total: 100, page: 1, perPage: 15,
})
const response = await collection.toResponse()
// → { data: [...], meta: { total: 100, page: 1, perPage: 15 } }
```

---

## ModelCollection

Typed array wrapper with ORM-specific operations:

```ts
import { ModelCollection } from '@rudderjs/orm'

const users = ModelCollection.wrap(await User.all())

users.modelKeys()       // [1, 2, 3]
users.find(2)           // item with id 2
users.contains(2)       // true
users.contains(u => u.name === 'Alice')  // predicate
users.except([1, 3])    // items not in list
users.only([1, 2])      // items in list
users.diff(otherUsers)  // items not in other
users.unique('email')   // deduplicated by key
users.isEmpty()         // false
users.isNotEmpty()      // true
users.count()           // 3

// Serialization controls on each item
users.makeVisible(['password'])
users.makeHidden(['email'])

// Async ORM operations
const fresh = await users.fresh(User)           // reload from DB
const loaded = await users.load(User, 'posts')  // eager-load
const loaded2 = await users.loadMissing(User, 'posts')  // load if missing
const query = users.toQuery(User)               // query builder scoped to IDs
```

---

## Model Factories

Create model instances for testing with named states and sequences.

```ts
import { ModelFactory, sequence } from '@rudderjs/orm'

class UserFactory extends ModelFactory<{ name: string; email: string; role: string }> {
  protected modelClass = User

  definition() {
    return {
      name:  'Alice',
      email: sequence(i => `user${i}@example.com`)(),
      role:  'user',
    }
  }

  protected states() {
    return {
      admin: () => ({ role: 'admin' }),
      banned: () => ({ role: 'banned' }),
    }
  }
}

// Single record
const user = await UserFactory.new().create()

// With named state
const admin = await UserFactory.new().state('admin').create()

// Multiple records
const users = await UserFactory.new().create(5)

// Without saving to DB
const dto = await UserFactory.new().make()
const dtos = await UserFactory.new().make(3)

// With overrides
const custom = await UserFactory.new().create({ name: 'Bob' })

// Inline state
const mod = await UserFactory.new().with(() => ({ role: 'moderator' })).create()
```

### `sequence()`

Generates cycling or index-based values:

```ts
// Array cycling
sequence(['Alice', 'Bob', 'Carol'])  // returns a function: Alice → Bob → Carol → Alice → ...

// Index-based
sequence(i => `user${i}@example.com`)  // user0@... → user1@... → user2@...
```

---

## Scopes

### Global Scopes

Applied automatically to every query on the model:

```ts
export class Article extends Model {
  static globalScopes = {
    ordered: (q) => q.orderBy('createdAt', 'DESC'),
    active: (q) => q.where('active', true),
  }
}

await Article.query().get()  // ordered + active
await Article.query().withoutGlobalScope('active').get()  // ordered only
```

### Local Scopes

Reusable query fragments, opt-in via `.scope('name')`:

```ts
export class Article extends Model {
  static scopes = {
    published: (q) => q.where('draftStatus', 'published'),
    recent: (q) => q.where('createdAt', '>', new Date(Date.now() - 30 * 86400000).toISOString()),
    byAuthor: (q, authorId: string) => q.where('authorId', authorId),
  }
}

await Article.query().scope('published').scope('recent').get()
await Article.query().scope('byAuthor', userId).get()
```

---

## Dirty Tracking

Every Model instance keeps a snapshot of its attributes as of the last
`hydrate()` / `save()` / `refresh()`. Use it to inspect what changed before
or after persistence.

```ts
const user = await User.find(1)         // hydrated → not dirty
user.email = 'new@x.com'
user.isDirty()                          // → true
user.isDirty('email')                   // → true
user.isClean('name')                    // → true
user.getDirty()                         // → { email: 'new@x.com' }
user.getOriginal('email')               // → 'old@x.com'

await user.save()
user.isDirty()                          // → false (baseline reset)
user.wasChanged()                       // → true
user.wasChanged('email')                // → true
user.getChanges()                       // → { email: 'new@x.com', updatedAt: ... }
```

| Method | Returns |
|---|---|
| `isDirty(key?)` | true when any (or the named) attribute has changed since the last save / load / refresh. |
| `isClean(key?)` | inverse of `isDirty`. |
| `wasChanged(key?)` | true when the most recent `save()` actually persisted a change to that attribute. Stays true until the next save / refresh. |
| `getOriginal(key?)` | snapshot value(s) as of the last save / load / refresh. With a key, that single value; without, a full copy of the snapshot. |
| `getChanges()` | diff of attributes that changed during the most recent `save()`. |
| `getDirty()` | diff of attributes currently dirty (unsaved). |

**Equality semantics.** Primitives use `===`. Dates compare by `getTime()`.
Plain objects and arrays (typically `json` / `array` cast columns) compare
by `JSON.stringify` — key-order sensitive, so `{ a: 1, b: 2 }` and
`{ b: 2, a: 1 }` are considered different. This matches Eloquent's posture.

**`refresh()` discards pending writes.** A `refresh()` re-reads the row,
re-baselines `getOriginal()`, and clears `getChanges()`. Eloquent retains
`wasChanged` past a refresh; we don't — refresh is "throw away pending
state, re-read from DB."

**`increment()` / `decrement()` re-baseline.** After an instance counter
update, `isDirty('viewCount')` is `false` — the new value becomes the
baseline. Counter updates are pure data-plane and intentionally don't
fire observers (see `static increment` notes); dirty tracking matches.

**`replicate()` clones are unsaved.** A replicated instance has values
on it but an empty `getOriginal()`, so `isDirty()` is `true` until the
clone is saved.

---

## Soft Deletes

```ts
class Post extends Model {
  static override softDeletes = true
}

await Post.delete(1)        // sets deletedAt
await Post.restore(1)       // clears deletedAt
await Post.forceDelete(1)   // permanent delete

// Query helpers
Post.query().withTrashed().get()   // include soft-deleted
Post.query().onlyTrashed().get()   // only soft-deleted
```

---

## Pruning

Models can opt into `pnpm rudder model:prune` by declaring `static prunable()`. The runner walks the registered models and deletes everything the query returns, in chunks. Two modes:

```ts
import { Model } from '@rudderjs/orm'

// Per-instance — observers fire, soft-deletes honored
class Session extends Model {
  static override table = 'sessions'
  static prunable() { return this.where('expiresAt', '<', new Date()) }
  static pruning(s: Session) { /* optional pre-delete hook */ }
}

// Bulk — single deleteAll() per chunk; no observers, no pruning() hook,
// soft-deletes bypassed (mirrors the deleteAll() primitive)
class FailedJob extends Model {
  static override table = 'failed_jobs'
  static override pruneMode = 'mass' as const
  static prunable() { return this.where('failedAt', '<', new Date(Date.now() - 7 * 86_400_000)) }
}
```

Run from the CLI:

```bash
pnpm rudder model:prune                          # prune everything
pnpm rudder model:prune --pretend                # dry-run; runs count() only
pnpm rudder model:prune --model=Session,FailedJob
pnpm rudder model:prune --except=AuditLog
pnpm rudder model:prune --chunk=500
```

Or schedule it from `routes/console.ts`:

```ts
scheduler.command('model:prune').daily()
scheduler.command('model:prune --pretend').weeklyOn(0, '09:00')
```

`Prunable` (default) calls `instance.delete()` per row — observers fire, soft-deletes apply. `MassPrunable` (`pruneMode = 'mass'`) is faster but bypasses both. Index the columns your `prunable()` filter touches; the runner re-queries per chunk because deletions shift the offset. `pruning()` exceptions are logged and the run continues — one bad row doesn't abort the sweep.

For programmatic use, `pruneModels({ models, except, chunk, pretend })` returns one `{ model, mode, count }` report per pruned model.

---

## Observers

Register lifecycle hooks on a model to transform data, log events, or cancel operations.

### Observer Class

```ts
class ArticleObserver {
  creating(data) {
    data.slug = slugify(data.title)
    return data  // return transformed data
  }
  created(record) { console.log('Article created:', record.id) }
  updating(id, data) { return { ...data, updatedAt: new Date() } }
  deleting(id) { /* return false to cancel */ }
}

Article.observe(ArticleObserver)
```

### Inline Listeners

```ts
Article.on('creating', (data) => { data.slug = slugify(data.title); return data })
Article.on('deleting', (id) => { if (id === protectedId) return false })
```

### Events

| Event | Arguments | Can cancel? | Can transform? |
|---|---|---|---|
| `creating` | `data` | Yes | Yes |
| `created` | `record` | No | No |
| `updating` | `id, data` | Yes | Yes |
| `updated` | `record` | No | No |
| `deleting` | `id` | Yes | No |
| `deleted` | `id` | No | No |
| `restoring` | `id` | Yes | No |
| `restored` | `record` | No | No |

> Use `Model.create()`/`Model.update()`/`Model.delete()` to trigger events.
> `Model.query().create()` does NOT fire events.

### Quiet Events

Persist, delete, or restore an instance without firing observers or
listeners — useful inside seeders, observer cascades, or any path that
shouldn't trigger lifecycle work twice.

```ts
const user = await User.find(1)
user.email = 'new@x.com'
await user.saveQuietly()         // persists, observers silent

await user.deleteQuietly()       // removes / soft-deletes silently

const trashed = await User.withTrashed().find(2)
await trashed.restoreQuietly()   // clears deletedAt silently
```

Sugar over `Model.withoutEvents()` — `await ctor.withoutEvents(() => instance.save())`.

**Per-class isolation.** Quiet ops mute only the *current* class.
A `User.saveQuietly()` whose observer cascades into `Comment.delete()`
still fires `Comment` observers — same posture as Eloquent's
`saveQuietly`. Wrap the cascade in a broader `withoutEvents` block if
you need full silence.

`instance.restore()` (the non-quiet form) is also available — symmetric
to `instance.delete()` — and fires `restoring` / `restored` normally.

---

## toJSON()

`toJSON()` applies casts, accessors, visible/hidden filtering, and appends:

```ts
class User extends Model {
  static override hidden   = ['password']
  static override casts    = { isAdmin: 'boolean' }
  static override appends  = ['fullName']
  static override attributes = {
    fullName: Attribute.make({ get: (_, a) => `${a['firstName']} ${a['lastName']}` }),
  }
}

JSON.stringify(user)
// { "name": "Alice", "isAdmin": true, "fullName": "Alice Smith" }
// password excluded, isAdmin cast to boolean, fullName computed
```

---

## ModelRegistry

Low-level registry used by adapters and the ORM itself.

```ts
import { ModelRegistry } from '@rudderjs/orm'

// Adapter surface
ModelRegistry.set(adapter)     // called by provider packages
ModelRegistry.get()            // current adapter (null if none)
ModelRegistry.getAdapter()     // adapter or throw
ModelRegistry.reset()          // clear (for tests)

// Model discovery — models self-register on first query
ModelRegistry.register(User)                          // manual registration
ModelRegistry.all()                                   // Map<name, ModelClass> of every registered model
ModelRegistry.onRegister((name, cls) => { /* ... */ }) // subscribe to new registrations (returns unsubscribe)
```

`ModelRegistry.all()` + `onRegister()` are how downstream packages (factories, telescope, CLI introspection) enumerate models without needing explicit imports.

---

## API Reference

| Export | Kind | Description |
|---|---|---|
| `Model` | Abstract class | Base class for all models |
| `ModelRegistry` | Class | Global ORM adapter registry |
| `Attribute` | Class | Accessor/mutator definition |
| `JsonResource` | Abstract class | API resource transformation |
| `ResourceCollection` | Class | Collection of resources with pagination |
| `ModelCollection` | Class | Typed array wrapper with ORM operations |
| `ModelFactory` | Abstract class | Factory for testing |
| `sequence` | Function | Cycling/indexed value generator |
| `Hidden` | Decorator | Mark property as hidden |
| `Visible` | Decorator | Mark property as visible |
| `Appends` | Decorator | Append accessor to JSON output |
| `Cast` | Decorator | Apply a cast type to a property |
| `CastUsing` | Interface | Custom cast class contract |
| `CastDefinition` | Type | Built-in cast name or custom cast class |
| `QueryBuilder<T>` | Interface | Fluent query builder contract |
| `OrmAdapter` | Interface | Adapter contract |
| `PaginatedResult<T>` | Interface | Paginated result shape |
| `ModelEvent` | Type | Observer event names |
| `ModelObserver` | Interface | Observer class contract |
