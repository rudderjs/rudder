# @rudderjs/orm

ORM contracts and base Model abstraction for RudderJS adapters.

## Installation

```bash
pnpm add @rudderjs/orm
```

This package provides the `Model` base class, `ModelRegistry`, `QueryBuilder`, and the `OrmAdapter` interface. It does not include a database driver — pair it with an adapter such as `@rudderjs/orm-prisma` or `@rudderjs/orm-drizzle`.

## Defining a Model

Extend `Model` and set the static `table` property to the adapter-specific table or accessor name:

```ts
import { Model } from '@rudderjs/orm'

export class User extends Model {
  static table = 'user'

  id!: string
  name!: string
  email!: string
  role!: string
  createdAt!: Date
}
```

`Model.getTable()` defaults to the lowercase class name with a trailing `s` (e.g. `User` → `users`) if `static table` is not set. This is not snake_case — `UserProfile` becomes `userprofiles`. In practice you should always set `static table` explicitly, because adapters expect an adapter-specific key, not a raw database table name:

- **Prisma**: the value must match the Prisma client accessor (e.g. `user`, `blogPost`) — never pluralised
- **Drizzle**: the value must match the key you used in `tables: { myKey: myTable }` passed to `drizzle()`

## Model Static Methods

All query methods are available directly on the Model class. These delegate to the adapter's `QueryBuilder`:

| Method | Signature | Description |
|---|---|---|
| `query()` | `query(): QueryBuilder<T>` | Return a raw query builder for full chaining |
| `all()` | `all(): Promise<T[]>` | Fetch every row in the table |
| `find()` | `find(id: string \| number): Promise<T \| null>` | Find a single record by primary key |
| `where()` | `where(col: string, value: unknown): QueryBuilder<T>` | Equality filter — returns a chainable QueryBuilder |
| `create()` | `create(data: Partial<T>): Promise<T>` | Insert a new record and return it |
| `with()` | `with(...relations: string[]): QueryBuilder<T>` | Eager-load relations — returns a chainable QueryBuilder |

## QueryBuilder Chaining

`where()` and `with()` return a `QueryBuilder` that can be further chained before executing. The `QueryBuilder` exposes the full set of query operations:

```ts
import { User } from './app/Models/User.js'

// Simple equality (2-arg form on Model or QueryBuilder)
const admins = await User.where('role', 'admin').get()

// Operator form (3-arg — available on QueryBuilder)
const recent = await User.query().where('createdAt', '>', new Date('2024-01-01')).get()

// Chain multiple filters
const result = await User
  .where('role', 'admin')
  .where('name', 'LIKE', 'A%')
  .get()

// Paginate a filtered set
const page = await User.where('role', 'admin').paginate(1, 10)

// First match
const alice = await User.where('email', 'alice@example.com').first()

// Sort, limit, offset
const recent = await User.query()
  .orderBy('createdAt', 'DESC')
  .limit(10)
  .offset(20)
  .get()
```

### All QueryBuilder methods

| Method | Returns | Description |
|---|---|---|
| `where(col, value)` | `QueryBuilder` | Equality filter |
| `where(col, op, value)` | `QueryBuilder` | Filter with operator (`=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `IN`, `NOT IN`) |
| `orWhere(col, value)` | `QueryBuilder` | OR equality filter |
| `orderBy(col, dir?)` | `QueryBuilder` | Add ORDER BY (`'ASC'` or `'DESC'`) |
| `limit(n)` | `QueryBuilder` | Limit result count |
| `offset(n)` | `QueryBuilder` | Skip n rows |
| `with(...relations)` | `QueryBuilder` | Eager-load relations |
| `first()` | `Promise<T \| null>` | First matching row |
| `find(id)` | `Promise<T \| null>` | Find by primary key |
| `get()` | `Promise<T[]>` | All matching rows |
| `all()` | `Promise<T[]>` | All rows (no conditions) |
| `count()` | `Promise<number>` | Row count |
| `create(data)` | `Promise<T>` | Insert a new row |
| `update(id, data)` | `Promise<T>` | Update a row by primary key |
| `delete(id)` | `Promise<void>` | Delete a row by primary key |
| `paginate(page, perPage?)` | `Promise<PaginatedResult<T>>` | Paginated results (default `perPage` is 15) |

## Scopes

### Global Scopes

Global scopes are applied automatically to every query on a model. Define them in `static globalScopes` as a record of named scope functions:

```ts
import { Model } from '@rudderjs/orm'

export class Article extends Model {
  static table = 'article'

  static globalScopes = {
    ordered: (q) => q.orderBy('createdAt', 'DESC'),
    active: (q) => q.where('active', true),
  }
}

// Every query includes both scopes automatically
const articles = await Article.query().get()

// Bypass a specific global scope when needed
const allArticles = await Article.query().withoutGlobalScope('active').get()
```

`withoutGlobalScope(name)` rebuilds the query from scratch, applying all global scopes except the named one. You can chain it with other query methods normally.

### Local Scopes

Local scopes are reusable query fragments that you opt into via `.scope('name')`. Define them in `static scopes`:

```ts
export class Article extends Model {
  static table = 'article'

  static scopes = {
    published: (q) => q.where('draftStatus', 'published'),
    recent: (q) => q.where('createdAt', '>', new Date(Date.now() - 30 * 86400000).toISOString()),
    byAuthor: (q, authorId: string) => q.where('authorId', authorId),
  }
}

// Chain multiple local scopes
await Article.query().scope('published').scope('recent').get()

// Pass arguments to parameterised scopes
await Article.query().scope('byAuthor', userId).get()
```

Calling `.scope('name')` with an undefined scope name throws an error immediately, so typos are caught at runtime.

## Observers

Observers let you hook into model lifecycle events to transform data, enforce invariants, log activity, or cancel operations.

### Observer Class

Create a plain class with optional lifecycle methods and register it with `Model.observe()`:

```ts
class ArticleObserver {
  creating(data) {
    data.slug = slugify(data.title)
    return data  // returned data replaces the original
  }

  created(record) {
    console.log('Article created:', record.id)
  }

  updating(id, data) {
    return { ...data, updatedAt: new Date() }
  }

  deleting(id) {
    // return false to cancel the deletion
  }

  deleted(id) {
    console.log('Deleted:', id)
  }

  restoring(id) {
    // return false to cancel the restore
  }

  restored(record) {
    console.log('Restored:', record.id)
  }
}

Article.observe(ArticleObserver)
```

### Inline Listeners

For quick one-off hooks, use `Model.on()` instead of a full class:

```ts
Article.on('creating', (data) => {
  data.slug = slugify(data.title)
  return data
})

Article.on('deleting', (id) => {
  if (id === protectedId) return false  // cancel
})
```

### Event Reference

| Event | Arguments | Can cancel? | Can transform? |
|---|---|---|---|
| `creating` | `data` | Yes (return `false`) | Yes (return new data) |
| `created` | `record` | No | No |
| `updating` | `id, data` | Yes (return `false`) | Yes (return new data) |
| `updated` | `record` | No | No |
| `deleting` | `id` | Yes (return `false`) | No |
| `deleted` | `id` | No | No |
| `restoring` | `id` | Yes (return `false`) | No |
| `restored` | `record` | No | No |

- **Cancel**: returning `false` from a `*ing` event throws an error and aborts the operation.
- **Transform**: returning a new data object from `creating` or `updating` replaces the payload passed to the adapter.
- **Post-events** (`created`, `updated`, `deleted`, `restored`): fire after the operation succeeds. Return values are ignored.

### Static Methods with Events

Events only fire when you use the static convenience methods on the Model class:

```ts
Article.create(data)       // fires creating → created
Article.update(id, data)   // fires updating → updated
Article.delete(id)         // fires deleting → deleted
Article.restore(id)        // fires restoring → restored
Article.forceDelete(id)    // fires deleting → deleted
```

> **Important:** `Model.query().create()` does NOT fire events — it goes directly to the adapter. Always use `Model.create()` (and the other static methods) when you need observer hooks.

### Clearing Observers

In tests, call `clearObservers()` to remove all registered observers and inline listeners:

```ts
afterEach(() => {
  Article.clearObservers()
})
```

Observers are stored per model subclass, so clearing one model's observers does not affect another.

## PaginatedResult

`paginate()` returns a `PaginatedResult<T>` object:

```ts
interface PaginatedResult<T> {
  data:        T[]     // records for the current page
  total:       number  // total number of matching records
  currentPage: number  // current page number (1-based)
  perPage:     number  // page size
  lastPage:    number  // total number of pages
  from:        number  // index of the first record on this page
  to:          number  // index of the last record on this page
}
```

Example:

```ts
const result = await User.paginate(2, 20)

console.log(result.data)        // User[] — up to 20 records
console.log(result.total)       // e.g. 143
console.log(result.currentPage) // 2
console.log(result.perPage)     // 20
console.log(result.lastPage)    // 8
console.log(result.from)        // 21
console.log(result.to)          // 40
```

## ModelRegistry

`ModelRegistry` is the global registry that connects Model classes to a live adapter instance. It must be populated in your database provider before any model queries run.

```ts
import { ModelRegistry } from '@rudderjs/orm'

// Register the adapter (called inside DatabaseServiceProvider.boot())
ModelRegistry.set(adapter)

// Retrieve the current adapter or throw if none is registered
const adapter = ModelRegistry.getAdapter()

// Retrieve the current adapter without throwing (returns null if unset)
const adapter = ModelRegistry.get()

// Clear the adapter — useful in tests
ModelRegistry.reset()
```

The registry stores a single active adapter. Calling `ModelRegistry.set()` a second time replaces the previous one.

## OrmAdapter Interface

All adapters implement the `OrmAdapter` interface defined in this package:

```ts
interface OrmAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  query<T>(table: string): QueryBuilder<T>
}
```

Adapters may extend this interface with driver-specific methods (e.g. raw query access), but the Model class only relies on `query()`.

## Attribute Casts

Casts automatically transform attribute values when reading from and writing to the database.

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

Built-in cast types: `'string'`, `'integer'`, `'float'`, `'boolean'`, `'date'`, `'datetime'`, `'json'`, `'array'`, `'collection'`, `'encrypted'`, `'encrypted:array'`, `'encrypted:object'`.

Encrypted casts require `@rudderjs/crypt`.

### Custom Cast Classes

```ts
import type { CastUsing } from '@rudderjs/orm'

class MoneyCast implements CastUsing {
  get(key: string, value: unknown) { return Number(value) / 100 }
  set(key: string, value: unknown) { return Math.round(Number(value) * 100) }
}

class Product extends Model {
  static casts = { price: MoneyCast }
}
```

### `@Cast` Decorator

```ts
import { Model, Cast } from '@rudderjs/orm'

class User extends Model {
  @Cast('boolean') isAdmin = false
  @Cast('date')    createdAt = new Date()
}
```

---

## Accessors & Mutators

Define computed getters and write transformations using `Attribute.make()`:

```ts
import { Model, Attribute } from '@rudderjs/orm'

class User extends Model {
  static attributes = {
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
  static hidden  = ['password', 'rememberToken']  // denylist
}

class PublicUser extends Model {
  static visible = ['id', 'name', 'avatar']  // allowlist (takes precedence)
}
```

### `static appends`

Always include computed accessor values in JSON output:

```ts
class User extends Model {
  static appends    = ['fullName']
  static attributes = {
    fullName: Attribute.make({
      get: (_, attrs) => `${attrs['firstName']} ${attrs['lastName']}`,
    }),
  }
}
```

### Decorators

```ts
import { Model, Hidden, Visible, Appends } from '@rudderjs/orm'

class User extends Model {
  @Hidden   password = ''
  @Visible  id = 0
  @Visible  name = ''
  @Appends  fullName = ''
}
```

### Instance-level Overrides

```ts
const user = await User.find(1)

user.makeVisible(['password'])    // show hidden fields
user.makeHidden(['email'])        // hide fields
user.setVisible(['id', 'name'])   // replace visible list
user.setHidden(['password'])      // replace hidden list
user.mergeVisible(['avatar'])     // add to visible
user.mergeHidden(['ssn'])         // add to hidden

// All return `this` for chaining
user.makeVisible(['email']).makeHidden(['phone']).toJSON()
```

---

## API Resources

Transform model data for API responses with conditional fields:

```ts
import { JsonResource } from '@rudderjs/orm'

class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id:    this.resource.id,
      name:  this.resource.name,
      admin: this.when(this.resource.role === 'admin', true),
      bio:   this.whenNotNull(this.resource.bio, (b) => b.trim()),
      posts: this.whenLoaded('posts'),
      ...this.mergeWhen(this.resource.isAdmin, {
        permissions: this.resource.permissions,
      }),
    }
  }
}
```

### Single Resource

```ts
const json = new UserResource(user).toArray()
```

### Collection

```ts
const collection = UserResource.collection(users, {
  total: 100, page: 1, perPage: 15,
})
const response = await collection.toResponse()
// → { data: [...], meta: { total: 100, page: 1, perPage: 15 } }
```

### Conditional Helpers

| Method | Description |
|---|---|
| `when(condition, value, fallback?)` | Include `value` only when `condition` is true |
| `whenNotNull(value, then, fallback?)` | Include when `value` is not null/undefined |
| `whenLoaded(relation, value?, fallback?)` | Include when relation is loaded on resource |
| `mergeWhen(condition, attrs)` | Merge attributes into output conditionally |

---

## ModelCollection

Typed array wrapper with ORM-specific operations:

```ts
import { ModelCollection } from '@rudderjs/orm'

const users = ModelCollection.wrap(await User.all())

users.modelKeys()          // [1, 2, 3]
users.find(2)              // item with id 2
users.contains(2)          // true
users.except([1, 3])       // items not in list
users.only([1, 2])         // items in list
users.diff(otherUsers)     // items not in other
users.unique('email')      // deduplicated by key
users.makeVisible(['password'])
users.makeHidden(['email'])

// Async ORM operations
const fresh  = await users.fresh(User)
const loaded = await users.load(User, 'posts')
const query  = users.toQuery(User)
```

---

## Model Factories

Create model instances for testing:

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
    }
  }
}

// Usage
const user  = await UserFactory.new().create()
const admin = await UserFactory.new().state('admin').create()
const users = await UserFactory.new().create(5)
const dto   = await UserFactory.new().make()  // without saving
```

---

## Notes

- For a complete setup walkthrough including migrations and seeding, see the [Database & Models guide](/guide/database).
- `ModelRegistry.set()` must be called before any `Model.*` static method is invoked. Register the database provider first in `bootstrap/providers.ts`.
- `Model.getTable()` defaults to the lowercase class name followed by `s`. This is not snake_case and does not match most adapter conventions — always set `static table` explicitly.
- `@rudderjs/orm` contains no runtime database code. It is safe to list as a direct dependency alongside an adapter package.
- Casts and accessors apply in `toJSON()` (read side) and `Model.create()`/`Model.update()` (write side).
- `static visible` takes precedence over `static hidden` — when both are set, only `visible` is used.
- `@Cast`, `@Hidden`, `@Visible`, `@Appends` decorators require `experimentalDecorators: true`.
