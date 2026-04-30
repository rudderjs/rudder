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

`where()` returns a chainable `QueryBuilder`. `first()`, `count()`, and `paginate()` are static shortcuts for the no-conditions case.

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

| QueryBuilder method | Description |
|---|---|
| `where(col, value)` / `where(col, op, value)` | Filter (operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `IN`, `NOT IN`) |
| `orWhere(col, value)` | OR equality |
| `orderBy(col, dir?)` | Sort |
| `limit(n)` / `offset(n)` | Paging primitives |
| `with(...rels)` | Eager-load relations (Prisma) |
| `first()` / `find(id)` / `get()` | Read |
| `create(data)` / `update(id, data)` / `delete(id)` | Write |
| `increment(id, col, n?, extra?)` / `decrement(id, col, n?, extra?)` | Atomic counter delta (default `n`: 1) |
| `paginate(page, perPage?)` | Paginated result (default `perPage`: 15) |

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

## Relations

For eager loading, prefer your adapter's native relation engine — Prisma's `include` / `select`, Drizzle's `with()`. They're already type-safe and handle joins, depth, ordering, and selective columns out of the box.

For the *lazy fluent fetch* case — "give me a chainable QueryBuilder scoped to this parent record" — declare the relation on `static relations` and call `instance.related(name)`:

```ts
class Post extends Model {}

class User extends Model {
  static override relations = {
    posts: { type: 'hasMany',   model: () => Post, foreignKey: 'authorId' },
    team:  { type: 'belongsTo', model: () => Team, foreignKey: 'teamId' },
    phone: { type: 'hasOne',    model: () => Phone, foreignKey: 'userId' },
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

**Supported types:** `hasOne`, `hasMany`, `belongsTo`. Polymorphic and many-to-many are intentionally out of scope — reach for the adapter directly when you need them.

**Defaults:** `foreignKey` defaults to `<parentClassName>Id` (camelCase) for `hasOne` / `hasMany`, and `<relatedClassName>Id` for `belongsTo`. `localKey` defaults to the parent's primary key (or the FK on `belongsTo`). Override either when your schema diverges.

The `model: () => Post` thunk is mandatory — relation declarations sit on each side of the relationship, and a direct reference would create a circular import at module evaluation time.

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

## Pitfalls

- **`assert.deepStrictEqual(result, plainObject)` after a query.** Query results are now Model instances — node's `deepStrictEqual` checks the prototype, so this assertion fails against a plain literal. Compare via `{ ...result }` or assert `result instanceof Model`. See [Hydrated instances](#hydrated-instances).
- **`firstOrCreate` lookup column missing on the created row.** The lookup attrs go through `create()`, which respects `fillable`. If your lookup column isn't in `fillable`, the new row will be missing it. Add it to `fillable`, or use `forceFill()` on a manual `new Model().forceFill(...).save()`. See [Mass assignment — Lookup attrs](#lookup-attrs-in-firstorcreate).
- **Forgetting to register the adapter.** `Model.*` static methods throw `[RudderJS ORM] No adapter registered`. The database provider must boot before any model query runs — see [Database](/guide/database).
- **`Model.query().create()` skipping observers.** Use `Model.create()` (and the other static methods) when you need observer hooks.
