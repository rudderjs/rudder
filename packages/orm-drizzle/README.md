# @rudderjs/orm-drizzle

Drizzle ORM adapter for RudderJS. Implements the `OrmAdapterProvider` / `OrmAdapter` / `QueryBuilder<T>` contract using Drizzle's SQL-like fluent API.

---

## Installation

```bash
pnpm add @rudderjs/orm-drizzle drizzle-orm
```

Install the driver for your database:

| Driver | Package |
|--------|---------|
| SQLite (default) | `better-sqlite3` + `@types/better-sqlite3` |
| LibSQL / Turso | `@libsql/client` |
| PostgreSQL | `postgres` |

```bash
# SQLite
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3

# LibSQL / Turso
pnpm add @libsql/client

# PostgreSQL
pnpm add postgres
```

After installing, refresh the provider manifest so the bundled `DatabaseProvider` gets picked up by `defaultProviders()`:

```bash
pnpm rudder providers:discover
```

---

## Defining a Drizzle Schema

Drizzle is schema-first in TypeScript — define table objects that the adapter uses to build queries.

```ts
// app/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id:    text('id').primaryKey(),
  name:  text('name').notNull(),
  email: text('email').notNull().unique(),
  role:  text('role').notNull().default('user'),
})

export const posts = sqliteTable('posts', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  title:   text('title').notNull(),
  userId:  text('user_id').notNull(),
})
```

---

## Configuration

Define your database config in `config/database.ts`:

```ts
// config/database.ts
import type { DatabaseConfig } from '@rudderjs/orm-drizzle'
import { users, posts } from '../app/schema.js'

const config: DatabaseConfig = {
  default: 'sqlite',
  connections: {
    sqlite:     { driver: 'sqlite',     url: process.env['DATABASE_URL'] ?? 'file:./dev.db' },
    postgresql: { driver: 'postgresql', url: process.env['DATABASE_URL'] ?? '' },
  },
  tables: { users, posts },
}

export default config
```

`DatabaseProvider` reads this config automatically via `defaultProviders()` — no manual provider class needed.

If you have multiple ORM adapters installed (e.g. `@rudderjs/orm-prisma` + `@rudderjs/orm-drizzle`), set `database.driver` to disambiguate. Otherwise the first installed wins.

---

## Model definition

```ts
// app/Models/User.ts
import { Model } from '@rudderjs/orm'

export class User extends Model {
  static table = 'users'   // must match the key in tables: {}
  id!: string
  name!: string
  email!: string
  role!: string
}
```

---

## Manual wiring (advanced)

To bypass the bundled provider — for tests, custom drivers, or pre-built drizzle instances — use the `drizzle()` factory directly:

```ts
import { drizzle as dzCreate } from 'drizzle-orm/better-sqlite3'
import Database                from 'better-sqlite3'
import { drizzle }             from '@rudderjs/orm-drizzle'
import { users }               from '../schema.js'

const db = dzCreate(new Database('./dev.db'))

const adapter = await drizzle({
  client: db,
  tables: { users },
}).create()
```

Then either pass `client` to `DatabaseProvider` via `config('database').client`, or skip the provider entirely and call `ModelRegistry.set(adapter)` from your own service provider.

---

## Global Table Registry

As an alternative to passing `tables` in config, register tables globally — useful when tables are defined across multiple modules:

```ts
import { DrizzleTableRegistry } from '@rudderjs/orm-drizzle'
import { users, posts }         from '../app/schema.js'

DrizzleTableRegistry.register('users', users)
DrizzleTableRegistry.register('posts', posts)
```

The adapter checks `tables` config first, then falls back to `DrizzleTableRegistry`.

---

## Drivers

### SQLite (default)

```ts
{ driver: 'sqlite', url: 'file:./dev.db' }
// url defaults to DATABASE_URL env var, then 'file:./dev.db'
```

### LibSQL / Turso

```ts
{ driver: 'libsql', url: 'libsql://your-db.turso.io?authToken=...' }
```

### PostgreSQL

```ts
{ driver: 'postgresql', url: 'postgres://user:pass@localhost/mydb' }
```

---

## API Reference

All methods mirror the `@rudderjs/orm` `QueryBuilder<T>` contract:

| Method | Description |
|--------|-------------|
| `where(col, value)` | Equality filter (AND) |
| `where(col, op, value)` | Filter with operator (`=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `IN`, `NOT IN`) |
| `orWhere(col, value)` | Equality filter joined with `OR` |
| `orWhere(col, op, value)` | Operator filter joined with `OR` |
| `orderBy(col, dir?)` | Sort by column (`ASC` / `DESC`) |
| `limit(n)` | Max rows to return |
| `offset(n)` | Skip rows |
| `with(...relations)` | **No-op** — see known limitations |
| `withTrashed()` | Include soft-deleted rows in results |
| `onlyTrashed()` | Return only soft-deleted rows |
| `first()` | First matching row or `null` |
| `find(id)` | Row by primary key or `null` (respects soft-delete filter) |
| `get()` | All matching rows |
| `all()` | All matching rows (alias of `get()`) |
| `count()` | Row count matching current filters |
| `create(data)` | Insert a row, returns the inserted row |
| `update(id, data)` | Update by primary key, returns the updated row |
| `delete(id)` | Delete by primary key (soft-deletes when enabled by Model) |
| `restore(id)` | Clear `deletedAt` to undo a soft delete |
| `forceDelete(id)` | Hard-delete the row even with soft deletes enabled |
| `increment(id, col, n?, extra?)` | Atomic `col = col + n` via SQL |
| `decrement(id, col, n?, extra?)` | Atomic `col = col - n` via SQL |
| `paginate(page, perPage?)` | Paginated result with metadata |

---

## Soft Deletes

When the Model enables soft deletes (via `_enableSoftDeletes()` on the QueryBuilder), all read paths (`get`, `first`, `find`, `all`, `count`, `paginate`) filter out rows where `deletedAt IS NOT NULL`. `delete()` updates `deletedAt = now()` instead of issuing a `DELETE`. `restore()` clears `deletedAt`. `forceDelete()` always issues a hard `DELETE`.

`withTrashed()` includes soft-deleted rows; `onlyTrashed()` returns only the soft-deleted ones.

---

## Known Limitations

### `with()` is a no-op

Drizzle relational queries require a fully pre-defined relation schema passed to the drizzle factory (`relations()` declarations). Because `adapter.query(tableName)` works with a dynamic string key, the adapter cannot access those pre-defined relations.

Use `with()` as a pass-through (it will silently be ignored) and load relations manually via separate queries when needed.

### No MySQL support

`mysql2` does not support `.returning()`, which is required for `create()` and `update()`. MySQL support is not planned.

### `connect()` is a no-op

Drizzle establishes connections lazily on the first query. Calling `adapter.connect()` does nothing.

### `disconnect()` — PostgreSQL only

For PostgreSQL, `disconnect()` ends the `postgres-js` connection pool via `$client.end()`. For SQLite and LibSQL, it is a no-op.
