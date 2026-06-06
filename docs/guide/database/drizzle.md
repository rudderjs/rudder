# Drizzle Adapter

`@rudderjs/orm-drizzle` is the Drizzle-backed adapter for `@rudderjs/orm`. Unlike Prisma, schemas are TypeScript code — `drizzle-kit` reads your schema file directly and generates migrations from it. The model API is identical to the Prisma adapter.

## Install

```bash
pnpm add @rudderjs/orm @rudderjs/orm-drizzle drizzle-orm
pnpm add -D drizzle-kit
```

Plus the driver for your database:

| Driver | Package | Install |
|---|---|---|
| SQLite | `better-sqlite3` | `pnpm add better-sqlite3` and `pnpm add -D @types/better-sqlite3` |
| libSQL / Turso | `@libsql/client` | `pnpm add @libsql/client` |
| PostgreSQL | `postgres` | `pnpm add postgres` |
| MySQL | `mysql2` | `pnpm add mysql2` |

For PostgreSQL, import from `drizzle-orm/pg-core` (`pgTable`); for MySQL, import from `drizzle-orm/mysql-core` (`mysqlTable`).

## Define the schema

```ts
// database/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  email:     text('email').notNull().unique(),
  role:      text('role').notNull().default('user'),
  createdAt: text('created_at').notNull(),
})
```

For PostgreSQL, import from `drizzle-orm/pg-core` and use `pgTable` instead.

## Configure drizzle-kit

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema:        './database/schema.ts',
  out:           './database/migrations',
  dialect:       'sqlite',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'file:./dev.db' },
})
```

Then sync the schema:

```bash
pnpm rudder db:push     # delegates to drizzle-kit push
```

For tracked migrations:

```bash
pnpm rudder make:migration add_users_table   # delegates to drizzle-kit generate
pnpm rudder migrate                           # delegates to drizzle-kit migrate
```

## Register the provider

```ts
// app/Providers/DatabaseServiceProvider.ts
import { ServiceProvider } from '@rudderjs/core'
import { drizzle } from '@rudderjs/orm-drizzle'
import { ModelRegistry } from '@rudderjs/orm'
import * as schema from '../../database/schema.js'

export class DatabaseServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    const adapter = await drizzle({
      driver: 'sqlite',
      url:    process.env.DATABASE_URL ?? 'file:./dev.db',
      tables: {
        user: schema.users,
        post: schema.posts,
      },
    }).create()

    await adapter.connect()
    ModelRegistry.set(adapter)
    this.app.instance('db', adapter)
  }
}
```

```ts
// bootstrap/providers.ts
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'

export default [
  DatabaseServiceProvider,    // first
  // ...
]
```

The keys in the `tables: {}` object are the values you'll set on each Model's `static table`.

## The `User` model

```ts
import { Model } from '@rudderjs/orm'

export class User extends Model {
  static table = 'user'   // matches the key in tables: { user: users }

  id!:    string
  name!:  string
  email!: string
  role!:  string
}
```

## Pre-built Drizzle instance

If you already have a configured Drizzle database (e.g. shared across packages), pass it via `client`:

```ts
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { drizzle } from '@rudderjs/orm-drizzle'

const sqlite = new Database('./dev.db')
const db     = drizzleSqlite(sqlite)

const adapter = await drizzle({
  client: db,
  tables: { user: users },
}).create()
```

## Global table registry

For modular apps where different modules register their own tables, use `DrizzleTableRegistry` instead of inline `tables: {}`:

```ts
import { DrizzleTableRegistry } from '@rudderjs/orm-drizzle'
import { users } from '../database/schema.js'

DrizzleTableRegistry.register('user', users)
const table = DrizzleTableRegistry.get('user')
```

## What's supported

The Drizzle adapter implements the same `OrmAdapter` interface as Prisma. The full Model API works — `where`, `orderBy`, `limit`, `paginate`, `create`, `update`, `delete`, `count`, `find`, `first`, `all`, **and eager loading via `with(relation)`**.

`Model.with('posts')` works for the direct relation types (`hasOne`, `hasMany`, `belongsTo`, `belongsToMany`): the ORM resolves them in its Model layer with one batched `WHERE … IN` query per relation, so you don't need to declare a Drizzle `relations()` graph. Make sure any related table (and pivot table) is registered via `tables: { ... }` or `DrizzleTableRegistry.register(name, table)`.

```ts
const users = await User.query().with('posts', 'profile', 'roles').get()
users[0].posts   // Post[]  — eagerly loaded
```

| Method | Notes |
|---|---|
| `with(relation)` | Supported for `hasOne` / `hasMany` / `belongsTo` / `belongsToMany` (Model-layer batched load) |
| `connect()` | No-op — Drizzle connects lazily |
| `disconnect()` | PostgreSQL and MySQL — closes the pool; no-op on SQLite/libSQL |

For nested eager loads (`'a.b'`) or constrained eager loading (`withWhereHas`), drop down to raw Drizzle queries or the `related()` accessor — see the [drizzle-orm docs](https://orm.drizzle.team/docs/rqb).

## Pitfalls

- **`static table` mismatch.** It must match the key in `tables: {}`, not the SQL table name. `tables: { user: users }` → `static table = 'user'` (even though the SQL table is `users`).
- **Eager loading needs the related table registered.** `User.with('posts')` fires a query against the `posts` table — register it via `tables: { posts }` or `DrizzleTableRegistry.register('posts', posts)`, or you'll get a clear "No table schema registered" error. (This is the same registry `whereHas` uses.)
- **`withWhereHas` still throws on Drizzle.** Plain `with()` works, but the *constrained*-eager variant (`withWhereHas`) routes through a code path Drizzle can't satisfy. Use `whereHas(relation)` to filter (it never eager-loads) and load the constrained children explicitly via `parent.related(relation).where(...).get()`.
