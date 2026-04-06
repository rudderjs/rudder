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

ModelRegistry.set(adapter)     // called by provider packages
ModelRegistry.get()            // current adapter (null if none)
ModelRegistry.getAdapter()     // adapter or throw
ModelRegistry.reset()          // clear (for tests)
```

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
