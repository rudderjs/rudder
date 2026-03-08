# @boostkit/orm

ORM contracts and base Model abstraction for BoostKit adapters.

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
import { ModelRegistry } from '@boostkit/orm'

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

## Notes

- For a complete setup walkthrough including migrations and seeding, see the [Database & Models guide](/guide/database).
- `ModelRegistry.set()` must be called before any `Model.*` static method is invoked. Register the database provider first in `bootstrap/providers.ts`.
- `Model.getTable()` defaults to the lowercase class name followed by `s`. This is not snake_case and does not match most adapter conventions — always set `static table` explicitly.
- `@boostkit/orm` contains no runtime database code. It is safe to list as a direct dependency alongside an adapter package.
