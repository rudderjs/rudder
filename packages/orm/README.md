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

## toJSON()

`toJSON()` strips any fields listed in `static hidden` before serialization:

```ts
class User extends Model {
  static override hidden = ['password', 'rememberToken']
  name     = 'Alice'
  password = 'secret'
}

const user = new User()
JSON.stringify(user)  // { "name": "Alice" }
```

---

## Scopes

### Global Scopes

Applied automatically to every query on the model. Define them in `static globalScopes`:

```ts
export class Article extends Model {
  static table = 'article'

  static globalScopes = {
    ordered: (q) => q.orderBy('createdAt', 'DESC'),
    active: (q) => q.where('active', true),
  }
}

// All queries automatically ordered and filtered
await Article.query().get()  // ordered + active

// Bypass a specific global scope
await Article.query().withoutGlobalScope('active').get()
```

### Local Scopes

Reusable query fragments, opt-in via `.scope('name')`:

```ts
export class Article extends Model {
  static table = 'article'

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

## Observers

Register lifecycle hooks on a model to transform data, log events, or cancel operations.

### Observer Class

```ts
class ArticleObserver {
  creating(data) {
    data.slug = slugify(data.title)
    return data  // return transformed data
  }

  created(record) {
    console.log('Article created:', record.id)
  }

  updating(id, data) {
    return { ...data, updatedAt: new Date() }
  }

  deleting(id) {
    // return false to cancel deletion
  }

  deleted(id) {
    console.log('Deleted:', id)
  }

  restoring(id) {
    // return false to cancel restore
  }

  restored(record) {
    console.log('Restored:', record.id)
  }
}

Article.observe(ArticleObserver)
```

### Inline Listeners

Quick event handlers without a full class:

```ts
Article.on('creating', (data) => {
  data.slug = slugify(data.title)
  return data
})

Article.on('deleting', (id) => {
  if (id === protectedId) return false  // cancel
})
```

### Events

| Event | Arguments | Can cancel? | Can transform? |
|---|---|---|---|
| `creating` | `data` | Yes (return false) | Yes (return new data) |
| `created` | `record` | No | No |
| `updating` | `id, data` | Yes | Yes |
| `updated` | `record` | No | No |
| `deleting` | `id` | Yes | No |
| `deleted` | `id` | No | No |
| `restoring` | `id` | Yes | No |
| `restored` | `record` | No | No |

### Static Methods with Events

Use these instead of `Model.query().create()` to trigger events:

```ts
Article.create(data)       // fires creating → created
Article.update(id, data)   // fires updating → updated
Article.delete(id)         // fires deleting → deleted
Article.restore(id)        // fires restoring → restored
Article.forceDelete(id)    // fires deleting → deleted
```

> **Note:** `Model.query().create()` does NOT fire events — use `Model.create()` instead.

### Testing

```ts
// Clear all observers between tests
Article.clearObservers()
```

---

## ModelRegistry

Low-level registry used by adapters and the ORM itself.

```ts
import { ModelRegistry } from '@rudderjs/orm'

// Set an adapter (called by provider packages — rarely needed directly)
ModelRegistry.set(adapter)

// Retrieve the current adapter (null if none registered)
ModelRegistry.get()

// Retrieve the adapter or throw if none is registered
ModelRegistry.getAdapter()

// Clear the adapter (useful in tests)
ModelRegistry.reset()
```

---

## API Reference

| Export | Kind | Description |
|---|---|---|
| `Model` | Abstract class | Base class for all application models. |
| `ModelRegistry` | Class | Global registry holding the active ORM adapter. |
| `QueryBuilder<T>` | Interface | Fluent query builder contract implemented by adapters. |
| `OrmAdapter` | Interface | Adapter contract — `query(table)`, `connect()`, `disconnect()`. |
| `OrmAdapterProvider` | Interface | Service provider contract for adapter packages. |
| `PaginatedResult<T>` | Interface | Shape returned by `paginate()`. |
| `ModelEvent` | Type | Union of observer event names (`'creating' \| 'created' \| ...`). |
| `ModelObserver` | Interface | Observer class contract with optional lifecycle methods. |
| `ScopeFn` | Type | Scope function signature `(query, ...args) => QueryBuilder`. |
| `WhereOperator` | Type | Allowed comparison operators for where clauses. |
| `WhereClause` | Interface | Internal where clause shape. |
| `OrderClause` | Interface | Internal order clause shape. |
| `QueryState` | Interface | Full query builder state. |
