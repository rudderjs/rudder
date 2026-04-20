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

---

## Defining a Drizzle Schema

Unlike Prisma, Drizzle is schema-first in TypeScript. You define table objects that the adapter uses to build queries.

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

## Wiring in DatabaseServiceProvider

Pass your table schemas to the `drizzle()` factory via the `tables` map:

```ts
// app/Providers/DatabaseServiceProvider.ts
import { ServiceProvider }    from '@rudderjs/core'
import { drizzle }            from '@rudderjs/orm-drizzle'
import { ModelRegistry }      from '@rudderjs/orm'
import { users, posts }       from '../schema.js'

export class DatabaseServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    const adapter = await drizzle({
      driver: 'sqlite',            // 'sqlite' | 'postgresql' | 'libsql'
      url:    process.env['DATABASE_URL'] ?? 'file:./dev.db',
      tables: {
        users,   // tableName used in Model.table → drizzle table object
        posts,
      },
    }).create()

    await adapter.connect()       // no-op — Drizzle connects lazily
    ModelRegistry.set(adapter)
    this.app.instance('db', adapter)
  }
}
```

### Model definition

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

## Using a Pre-built Drizzle Instance

If you already have a Drizzle `db` instance (e.g. from a custom setup), pass it directly:

```ts
import { drizzle as dzCreate } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { users } from '../schema.js'

const db = dzCreate(new Database('./dev.db'))

const adapter = await drizzle({
  client: db,
  tables: { users },
}).create()
```

---

## Global Table Registry

As an alternative to passing `tables` in config, register tables globally — useful when tables are defined across multiple modules:

```ts
// bootstrap/app.ts or a service provider
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
drizzle({ driver: 'sqlite', url: 'file:./dev.db', tables })
// url defaults to DATABASE_URL env var, then 'file:./dev.db'
```

### LibSQL / Turso

```ts
drizzle({ driver: 'libsql', url: 'libsql://your-db.turso.io?authToken=...', tables })
```

### PostgreSQL

```ts
drizzle({ driver: 'postgresql', url: 'postgres://user:pass@localhost/mydb', tables })
```

---

## API Reference

All methods mirror the `@rudderjs/orm` `QueryBuilder<T>` contract:

| Method | Description |
|--------|-------------|
| `where(col, value)` | Equality filter |
| `where(col, op, value)` | Filter with operator (`=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `IN`, `NOT IN`) |
| `orWhere(col, value)` | Appends additional equality filter (joined with `AND` internally) |
| `orderBy(col, dir?)` | Sort by column (`ASC` / `DESC`) |
| `limit(n)` | Max rows to return |
| `offset(n)` | Skip rows |
| `with(...relations)` | **No-op** — see known limitations |
| `first()` | First matching row or `null` |
| `find(id)` | Row by primary key or `null` |
| `get()` | All matching rows |
| `all()` | All rows in the table |
| `count()` | Row count matching current filters |
| `create(data)` | Insert a row, returns the inserted row |
| `update(id, data)` | Update by primary key, returns the updated row |
| `delete(id)` | Delete by primary key |
| `paginate(page, perPage?)` | Paginated result with metadata |

---

## Known Limitations

### `with()` is a no-op

Drizzle relational queries require a fully pre-defined relation schema passed to the drizzle factory (`relations()` declarations). Because `adapter.query(tableName)` works with a dynamic string key, the adapter cannot access those pre-defined relations.

Use `with()` as a pass-through (it will silently be ignored) and load relations manually via separate queries when needed.

### No MySQL support

`mysql2` does not support `.returning()`, which is required for `create()` and `update()`. MySQL support is not planned for v1.

### `connect()` is a no-op

Drizzle establishes connections lazily on the first query. Calling `adapter.connect()` does nothing.

### `disconnect()` — PostgreSQL only

For PostgreSQL, `disconnect()` ends the `postgres-js` connection pool via `$client.end()`. For SQLite and LibSQL, it is a no-op.
