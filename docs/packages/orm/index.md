# @boostkit/orm

ORM contracts and base Model abstraction for Forge adapters.

## Installation

```bash
pnpm add @boostkit/orm
```

This package provides the `Model` base class, `ModelRegistry`, `QueryBuilder`, and the `OrmAdapter` interface. It does not include a database driver — pair it with an adapter such as `@boostkit/orm-prisma` or `@boostkit/orm-drizzle`.

## Defining a Model

Extend `Model` and set the static `table` property to the adapter-specific table or accessor name:

```ts
import { Model } from '@boostkit/orm'

export class User extends Model {
  static table = 'user'

  id!: string
  name!: string
  email!: string
  role!: string
  createdAt!: Date
}
```

`Model.getTable()` defaults to the lowercase class name with a trailing `s` (e.g. `UserProfile` → `user_profiles`) if `static table` is not set. The explicit `table` property always takes precedence.

## Model Static Methods

All query methods are available directly on the Model class:

| Method | Signature | Description |
|---|---|---|
| `all()` | `all(): Promise<T[]>` | Fetch every row in the table |
| `find()` | `find(id: string \| number): Promise<T \| null>` | Find a single record by primary key |
| `where()` | `where(col, value): QueryBuilder<T>` | Equality filter |
| `where()` | `where(col, op, value): QueryBuilder<T>` | Filter with operator (`=`, `>`, `<`, `like`, …) |
| `create()` | `create(data: Partial<T>): Promise<T>` | Insert a new record and return it |
| `update()` | `update(id, data: Partial<T>): Promise<T>` | Update a record by primary key and return it |
| `delete()` | `delete(id: string \| number): Promise<void>` | Delete a record by primary key |
| `paginate()` | `paginate(page: number, perPage?: number): Promise<PaginatedResult<T>>` | Paginate results (default `perPage` is 15) |
| `count()` | `count(): Promise<number>` | Count all rows in the table |
| `first()` | `first(): Promise<T \| null>` | Return the first matching row |
| `get()` | `get(): Promise<T[]>` | Execute a pending QueryBuilder and return results |

## QueryBuilder Chaining

`where()` returns a `QueryBuilder` that can be further chained before executing:

```ts
import { User } from './app/Models/User.js'

// simple equality
const admins = await User.where('role', 'admin').get()

// operator form
const recent = await User.where('createdAt', '>', new Date('2024-01-01')).get()

// chain multiple filters
const result = await User
  .where('role', 'admin')
  .where('name', 'like', 'A%')
  .get()

// paginate a filtered set
const page = await User.where('role', 'admin').paginate(1, 10)

// first match
const alice = await User.where('email', 'alice@example.com').first()
```

## PaginatedResult

`paginate()` returns a `PaginatedResult<T>` object:

```ts
interface PaginatedResult<T> {
  data:     T[]     // records for the current page
  total:    number  // total number of matching records
  page:     number  // current page number (1-based)
  perPage:  number  // page size
  lastPage: number  // total number of pages
}
```

Example:

```ts
const result = await User.paginate(2, 20)

console.log(result.data)      // User[] — up to 20 records
console.log(result.total)     // e.g. 143
console.log(result.page)      // 2
console.log(result.perPage)   // 20
console.log(result.lastPage)  // 8
```

## ModelRegistry

`ModelRegistry` is the global registry that connects Model classes to a live adapter instance. It must be called in your `DatabaseServiceProvider` before any model queries run.

```ts
import { ModelRegistry } from '@boostkit/orm'

// Register the adapter (called inside DatabaseServiceProvider.boot())
ModelRegistry.set(adapter)

// Retrieve the current adapter (useful in advanced scenarios)
const adapter = ModelRegistry.getAdapter()
```

The registry stores a single active adapter. Calling `ModelRegistry.set()` a second time replaces the previous one.

## OrmAdapter Interface

All adapters implement the `OrmAdapter` interface defined in this package:

```ts
interface OrmAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  query(table: string): QueryBuilder<unknown>
}
```

Adapters may extend this interface with driver-specific methods (e.g. raw query access), but the Model class only relies on `query()`.

## Notes

- `ModelRegistry.set()` must be called before any `Model.*` static method is invoked. Place it in your `DatabaseServiceProvider.boot()` method.
- `Model.getTable()` defaults to the lowercase class name followed by `s`. Override it with `static table` when the table name does not follow this convention (e.g. Prisma uses the lowercase model name without pluralisation).
- `@boostkit/orm` contains no runtime database code. It is safe to list as a direct dependency alongside an adapter package.
