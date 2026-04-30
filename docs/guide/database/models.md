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
| `paginate(page, perPage?)` | Paginated result (default `perPage`: 15) |

## Records vs. instances

Query results are **plain data objects**, not Model instances. Prototype methods don't survive — `(await User.find(id)).hasGrantType('foo')` throws "is not a function".

The convention is to put behavior in standalone helpers:

```ts
// app/Models/helpers/userHelpers.ts
export const userHelpers = {
  hasRole(user: User, role: string) { return user.role === role },
  isAdmin(user: User)               { return user.role === 'admin' },
}
```

```ts
const user = await User.find(id)
if (userHelpers.isAdmin(user)) { /* ... */ }
```

For mutations, call the static method: `await User.update(id, { role: 'admin' })`.

## Mass assignment

`static fillable` documents which fields are intended to be settable from request data. Use it as an explicit list when accepting `Model.create()` / `Model.update()` payloads from forms or APIs:

```ts
class User extends Model {
  static fillable = ['name', 'email', 'role']
}

await User.create({ name: 'Alice', email: 'a@b.com', role: 'user' })
```

Today `fillable` is a documentation hint — the ORM does not yet filter unfillable keys at the boundary. Filter request data yourself with a `FormRequest`'s `validated()` shape, or pick keys explicitly before calling `create()`/`update()`. A future release will enforce `fillable` at the model layer (and add a `static guarded` denylist + `forceCreate()` escape hatch); for now treat it as the contract you commit to in your own code.

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

- **Calling methods on query results.** Records are plain objects without prototype. `record.column` works; `record.method()` doesn't. Put behavior in helpers (see [Records vs. instances](#records-vs-instances)).
- **`fillable` is a documentation hint, not an enforced filter** (today). The ORM doesn't yet drop keys outside the list — filter user input with a `FormRequest` or explicit picks before passing to `create()` / `update()`. See [Mass assignment](#mass-assignment).
- **Forgetting to register the adapter.** `Model.*` static methods throw `[RudderJS ORM] No adapter registered`. The database provider must boot before any model query runs — see [Database](/guide/database).
- **`Model.query().create()` skipping observers.** Use `Model.create()` (and the other static methods) when you need observer hooks.
