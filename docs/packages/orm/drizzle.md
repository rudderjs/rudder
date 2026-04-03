# @rudderjs/orm-drizzle

Drizzle ORM adapter for RudderJS — schema-first, multi-driver.

## Installation

```bash
pnpm add @rudderjs/orm-drizzle drizzle-orm
```

Then install the driver package for your database:

| Driver | Package | Install |
|---|---|---|
| SQLite | `better-sqlite3` | `pnpm add better-sqlite3` |
| libSQL / Turso | `@libsql/client` | `pnpm add @libsql/client` |
| PostgreSQL | `postgres` | `pnpm add postgres` |

## Schema Definition

Define tables using Drizzle's schema helpers. Create a file such as `database/schema.ts`:

```ts
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id:    text('id').primaryKey(),
  name:  text('name').notNull(),
  email: text('email').notNull().unique(),
  role:  text('role').notNull().default('user'),
})
```

For PostgreSQL, import from `drizzle-orm/pg-core` instead:

```ts
import { pgTable, text, varchar } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id:    text('id').primaryKey(),
  name:  varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  role:  varchar('role', { length: 50 }).notNull().default('user'),
})
```

## DatabaseServiceProvider

Wire the adapter in your `DatabaseServiceProvider`:

```ts
import { ServiceProvider } from '@rudderjs/core'
import { drizzle } from '@rudderjs/orm-drizzle'
import { ModelRegistry } from '@rudderjs/orm'
import { users } from '../database/schema.js'

export class DatabaseServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    const adapter = await drizzle({
      driver: 'sqlite',
      url:    'file:./dev.db',
      tables: { user: users },
    }).create()

    await adapter.connect()
    ModelRegistry.set(adapter)
    this.app.instance('db', adapter)
  }
}
```

## Model Definition

Set `static table` to match the key used in the `tables` object passed to `drizzle()`:

```ts
import { Model } from '@rudderjs/orm'

export class User extends Model {
  static table = 'user'   // must match the key in tables: { user: users }

  id!: string
  name!: string
  email!: string
  role!: string
}
```

## Pre-built Drizzle Instance

If you already have a configured Drizzle database instance, pass it via the `client` option:

```ts
import { drizzle } from '@rudderjs/orm-drizzle'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { users } from '../database/schema.js'

const sqlite = new Database('./dev.db')
const db     = drizzleSqlite(sqlite)

const adapter = await drizzle({
  client: db,
  tables: { user: users },
}).create()
```

## DrizzleTableRegistry

`DrizzleTableRegistry` is a global alternative to passing `tables` inline. Register tables once (e.g. in a provider) and they will be available to the adapter:

```ts
import { DrizzleTableRegistry } from '@rudderjs/orm-drizzle'
import { users } from '../database/schema.js'

// Register globally — no need to pass tables: {} to drizzle()
DrizzleTableRegistry.register('user', users)

// Later, retrieve a table reference:
const table = DrizzleTableRegistry.get('user')
```

This is useful in modular setups where different modules register their own tables independently.

## Drivers

### SQLite (`better-sqlite3`)

```ts
drizzle({
  driver: 'sqlite',
  url:    'file:./dev.db',   // file path relative to process.cwd()
  tables: { user: users },
})
```

### libSQL / Turso

```ts
drizzle({
  driver: 'libsql',
  url:    'libsql://your-db.turso.io',
  tables: { user: users },
})
```

Set `LIBSQL_AUTH_TOKEN` in your environment for authenticated Turso connections.

### PostgreSQL

```ts
drizzle({
  driver: 'postgresql',
  url:    'postgresql://user:pass@localhost:5432/mydb',
  tables: { user: users },
})
```

## API Reference

The Drizzle adapter supports the same `OrmAdapter` interface as other RudderJS ORM adapters. Behaviour differences are noted below:

| Method | Supported | Notes |
|---|---|---|
| `all()` | Yes | Fetches all rows |
| `find(id)` | Yes | Looks up by `id` column |
| `where(col, value)` | Yes | Equality filter |
| `where(col, op, value)` | Yes | Filter with operator |
| `create(data)` | Yes | Inserts and returns the new record |
| `update(id, data)` | Yes | Updates and returns the record |
| `delete(id)` | Yes | Deletes by `id` |
| `paginate(page, perPage?)` | Yes | Offset-based pagination |
| `count()` | Yes | Returns row count |
| `first()` | Yes | Returns first match |
| `get()` | Yes | Executes a pending query |
| `with(relation)` | No-op | Relation loading is not supported |
| `connect()` | No-op | Connection is established lazily |
| `disconnect()` | PostgreSQL only | Closes the connection pool |

## Known Limitations

- **`with()` is a no-op** — relation/eager loading is not implemented. Use raw Drizzle queries for joins.
- **No MySQL driver** — only `sqlite`, `libsql`, and `postgresql` are supported.
- **`connect()` is a no-op** — Drizzle establishes connections lazily on first query; calling `adapter.connect()` is safe but has no effect.
- **`disconnect()` PostgreSQL only** — for SQLite and libSQL drivers, `disconnect()` is also a no-op.

## Notes

- The key used in the `tables: {}` object (e.g. `'user'`) must exactly match `static table` on the corresponding Model class.
- `connect()` being a no-op means the adapter is always safe to call in `DatabaseServiceProvider.boot()` — no connection errors will be thrown at startup.
- For migrations, use the Drizzle Kit CLI directly (`drizzle-kit push`, `drizzle-kit generate`) — `@rudderjs/orm-drizzle` does not wrap migration tooling.
