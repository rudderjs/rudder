# @boostkit/orm

ORM contract, `Model` base class, and `ModelRegistry` for BoostKit applications.

```bash
pnpm add @boostkit/orm
```

This package provides the shared abstractions. For a working database connection use an adapter:

- `@boostkit/orm-prisma` — Prisma adapter (SQLite, PostgreSQL, MySQL)
- `@boostkit/orm-drizzle` — Drizzle adapter (SQLite, PostgreSQL, LibSQL)

---

## Setup

Register a database provider in `bootstrap/providers.ts`:

```ts
import { prismaProvider } from '@boostkit/orm-prisma'
import configs from '../config/index.js'

export default [
  prismaProvider(configs.database),
  // ...other providers
]
```

The provider calls `ModelRegistry.set(adapter)` during boot — no manual wiring needed.

---

## Defining a Model

```ts
import { Model } from '@boostkit/orm'

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

## ModelRegistry

Low-level registry used by adapters and the ORM itself.

```ts
import { ModelRegistry } from '@boostkit/orm'

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
| `WhereOperator` | Type | Allowed comparison operators for where clauses. |
| `WhereClause` | Interface | Internal where clause shape. |
| `OrderClause` | Interface | Internal order clause shape. |
| `QueryState` | Interface | Full query builder state. |
