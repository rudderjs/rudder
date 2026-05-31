# Database

Almost every modern web application talks to a database. Rudder makes that interaction painless through `@rudderjs/orm` — a unified `Model` base class that works with Prisma, Drizzle, or the **built-in native engine** as the adapter. The same model code runs against any of them; the adapter handles all SQL and connection pooling.

```
Model (from @rudderjs/orm)
  └── ModelRegistry.getAdapter()
        └── OrmAdapter (interface)
              ├── NativeAdapter   (@rudderjs/orm/native — built in)
              ├── PrismaAdapter   (@rudderjs/orm-prisma)
              └── DrizzleAdapter  (@rudderjs/orm-drizzle)
```

## Choosing an adapter

All three are first-party and feature-equivalent at the model layer. The choice comes down to schema preference and whether you want a zero-dependency query engine.

| | Native (built-in) | Prisma | Drizzle |
|---|---|---|---|
| Install | `@rudderjs/orm` + `better-sqlite3` | `@rudderjs/orm-prisma` | `@rudderjs/orm-drizzle` |
| Schema / migrations | **Bring your own** (no native migrations yet) | `prisma/schema/*.prisma` + `prisma migrate` | TS schema + `drizzle-kit` |
| Drivers | SQLite | SQLite, PostgreSQL, MySQL, libSQL | SQLite, PostgreSQL, libSQL |
| `whereHas` setup | None | needs a declared `@relation` | needs a table registry |
| Relations via `Model.with()` | Polymorphic only | Supported | No-op (use raw Drizzle) |
| Transactions (`transaction()`) | Supported | — | — |

For setup details see [Native Engine](#native-engine-built-in) below, [Prisma Adapter](/guide/database/prisma), or [Drizzle Adapter](/guide/database/drizzle). The rest of this guide is adapter-neutral.

## Native engine (built-in)

The native engine ships **inside `@rudderjs/orm`** at the node-only `@rudderjs/orm/native` subpath — a first-party SQL query engine that talks directly to `better-sqlite3`, no external ORM. It's **opt-in**: a connection selects it with `engine: 'native'`, and the built-in `NativeDatabaseProvider` (auto-discovered) wires it up. Without that flag it stays dormant, so installing it alongside Prisma/Drizzle is harmless.

```ts
// config/database.ts
export default {
  default: 'sqlite',
  connections: {
    sqlite: { engine: 'native', driver: 'sqlite', url: Env.get('DATABASE_URL', 'file:./dev.db') },
  },
}
```

```bash
pnpm add better-sqlite3   # the only peer; lazy-loaded, never in a client bundle
```

That's the whole setup — Models, relations, `whereHas`/aggregates, soft deletes, and [transactions](#transactions) all work. The `@rudderjs/orm` main entry stays client-bundle-safe; the native driver and provider live only under the `./native` subpath and are never reachable from a browser graph.

::: warning No native migrations yet
The native engine is a **query engine**, not a schema/migration tool — `rudder migrate` / `db:push` still delegate to Prisma/Drizzle only. A native app must create its tables some other way (raw `CREATE TABLE`, or keep Prisma/Drizzle installed purely for migrations). For that reason `create-rudder` still scaffolds Prisma/Drizzle by default; native is an opt-in engine until a native migration story lands. Postgres/MySQL are also not yet supported on native.
:::

To wire it explicitly instead of via auto-discovery:

```ts
// bootstrap/providers.ts
import { nativeDatabase } from '@rudderjs/orm/native'
export default [ ...(await defaultProviders()), nativeDatabase(), AppServiceProvider ]
```

## Quick start

Once a model is defined and the database provider is registered, querying is a one-liner:

```ts
import { User } from '../app/Models/User.js'

const all       = await User.all()
const alice     = await User.where('email', 'alice@example.com').first()
const admins    = await User.where('role', 'admin').orderBy('createdAt', 'DESC').get()
const created   = await User.create({ name: 'Bob', email: 'bob@example.com' })
```

The full Model API — defining models, mass assignment, hidden fields, custom scopes — lives in [Models](/guide/database/models).

## Configuration

`config/database.ts` describes the connection. The default driver is `sqlite` for local development:

```ts
import { Env } from '@rudderjs/support'

export default {
  default: Env.get('DB_DRIVER', 'sqlite') as 'sqlite' | 'postgresql' | 'mysql' | 'libsql',
  connections: {
    sqlite:     { driver: 'sqlite'     as const, url: Env.get('DATABASE_URL', 'file:./dev.db') },
    postgresql: { driver: 'postgresql' as const, url: Env.get('DATABASE_URL', '') },
    mysql:      { driver: 'mysql'      as const, url: Env.get('DATABASE_URL', '') },
    libsql:     { driver: 'libsql'     as const, url: Env.get('DATABASE_URL', '') },
  },
}
```

Most apps only set `DATABASE_URL` in `.env` and let the rest default.

## Unified rudder commands

The framework wraps both ORMs' migration tooling behind a uniform set of `rudder` commands. They auto-detect which adapter is in use and delegate to the underlying tool:

```bash
pnpm rudder migrate              # apply pending migrations (production-safe)
pnpm rudder migrate:fresh        # drop all tables and re-migrate from scratch (dev only)
pnpm rudder migrate:status       # show migration status
pnpm rudder make:migration <name>  # create a new migration file
pnpm rudder db:push              # push schema directly without a migration file (dev only)
pnpm rudder db:generate          # regenerate the Prisma client (no-op for Drizzle)
pnpm rudder db:seed              # run the seed command from routes/console.ts
```

A typical development loop:

```bash
# 1. Edit your schema (prisma/schema/*.prisma or database/schema.ts)
# 2. Quick sync — no migration file, good for fast iteration
pnpm rudder db:push
# 3. Regenerate Prisma client (Prisma only)
pnpm rudder db:generate
```

When the change is ready to ship, replace step 2 with a tracked migration:

```bash
pnpm rudder make:migration add_published_to_posts
pnpm rudder migrate
```

Production deploys run only `pnpm rudder migrate` — never `db:push` or `migrate:fresh`.

## Provider boot order

The database provider must boot **before any provider whose `boot()` queries models**. The auto-discovery system already orders this correctly — `orm-prisma` (or `orm-drizzle`) sits in the `infrastructure` stage and runs ahead of `feature` providers like queues and notifications. If you list providers manually, put the database first:

```ts
import { DatabaseProvider } from '@rudderjs/orm-prisma'

export default [
  DatabaseProvider,               // first
  AppServiceProvider,             // last
]
```

## Schema publishing

Packages that ship database tables publish their schema files into your project so Prisma's multi-file schema can pick them up:

```bash
pnpm rudder vendor:publish --tag=auth-schema          # → prisma/schema/auth.prisma
pnpm rudder vendor:publish --tag=notification-schema   # → prisma/schema/notification.prisma
```

After publishing, run `pnpm rudder db:push` or create a migration to apply the new tables. Each package's documentation lists the right tag.

## Seeding

Seed scripts live in `routes/console.ts` as rudder commands:

```ts
import { rudder } from '@rudderjs/console'
import { User } from '../app/Models/User.js'

rudder.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com', role: 'admin' })
  console.log('Database seeded.')
}).description('Seed the database with sample data')
```

Run with `pnpm rudder db:seed`.

## Transactions

Wrap a unit of work in a database transaction with `transaction()` (or the `Model.transaction()` alias). Every Model query issued inside the callback — across any model — runs on the transaction and commits together; if the callback throws, the whole unit rolls back and the error re-throws.

```ts
import { transaction } from '@rudderjs/orm'

await transaction(async () => {
  const user    = await User.create({ name: 'Ada', email: 'ada@example.com' })
  await Account.create({ userId: user.id, balance: 0 })
})  // both rows commit, or neither does
```

Queries join the transaction automatically — no handle to thread through. Nested `transaction()` calls map to **savepoints**: an inner failure rolls back only its own work while the outer transaction continues.

> Transactions are implemented on the **native engine** today. Against the Prisma/Drizzle adapters, `transaction()` throws a clear "not supported" error (their wiring is a follow-up). The capability is an optional part of the `OrmAdapter` contract.

## Pitfalls

- **`static table` mismatch.** For Prisma, the value is the **delegate** name (camelCase, e.g. `blogPost`) — not the SQL table name (`blog_posts`). For Drizzle, it's the key in the `tables: {}` object passed to the adapter.
- **Stale Prisma client after schema change.** Run `pnpm rudder db:generate` (or `pnpm exec prisma generate`) — the TypeScript types in your app go stale until you regenerate.
- **Query results are Model instances.** `find`/`first`/`all`/etc. return `instanceof Model` objects with prototype methods bound — call `await user.save()`, `user.is(other)`, `user.trashed()` directly. See [Models — Hydrated instances](/guide/database/models#hydrated-instances).
- **`db:push` in production.** Use tracked migrations (`pnpm rudder migrate`) — `db:push` can drop columns silently on destructive changes.
