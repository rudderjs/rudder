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

`Model.hydrate(record)` is the escape hatch when you need to wrap a plain record from outside the ORM (cached JSON, fixtures, an external API response).

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

- **`assert.deepStrictEqual(result, plainObject)` after a query.** Query results are now Model instances — node's `deepStrictEqual` checks the prototype, so this assertion fails against a plain literal. Compare via `{ ...result }` or assert `result instanceof Model`. See [Hydrated instances](#hydrated-instances).
- **`fillable` is a documentation hint, not an enforced filter** (today). The ORM doesn't yet drop keys outside the list — filter user input with a `FormRequest` or explicit picks before passing to `create()` / `update()`. See [Mass assignment](#mass-assignment).
- **Forgetting to register the adapter.** `Model.*` static methods throw `[RudderJS ORM] No adapter registered`. The database provider must boot before any model query runs — see [Database](/guide/database).
- **`Model.query().create()` skipping observers.** Use `Model.create()` (and the other static methods) when you need observer hooks.
