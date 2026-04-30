# Database

Almost every modern web application talks to a database. RudderJS makes that interaction painless through `@rudderjs/orm` — a unified `Model` base class that works with either Prisma or Drizzle as the adapter. The same model code runs against either; the adapter handles all SQL and connection pooling.

```
Model (from @rudderjs/orm)
  └── ModelRegistry.getAdapter()
        └── OrmAdapter (interface)
              ├── PrismaAdapter   (@rudderjs/orm-prisma)
              └── DrizzleAdapter  (@rudderjs/orm-drizzle)
```

## Choosing an adapter

Both adapters are first-party and feature-equivalent at the model layer. The choice comes down to schema preference.

| | Prisma | Drizzle |
|---|---|---|
| Schema | `prisma/schema/*.prisma` (SDL) | TypeScript schema files |
| Migrations | `prisma migrate dev/deploy` | `drizzle-kit generate/migrate` |
| Type safety | Generated client | Schema-inferred |
| Relations via `Model.with()` | Supported | No-op (use raw Drizzle) |
| Drivers | SQLite, PostgreSQL, MySQL, libSQL | SQLite, PostgreSQL, libSQL |

For setup details see [Prisma Adapter](/guide/database/prisma) or [Drizzle Adapter](/guide/database/drizzle). The rest of this guide is adapter-neutral.

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
  default: Env.get('DB_DRIVER', 'sqlite') as 'sqlite' | 'postgresql' | 'libsql',
  connections: {
    sqlite:     { driver: 'sqlite'     as const, url: Env.get('DATABASE_URL', 'file:./dev.db') },
    postgresql: { driver: 'postgresql' as const, url: Env.get('DATABASE_URL', '') },
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
export default [
  database(configs.database),    // first
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

## Pitfalls

- **`static table` mismatch.** For Prisma, the value is the **delegate** name (camelCase, e.g. `blogPost`) — not the SQL table name (`blog_posts`). For Drizzle, it's the key in the `tables: {}` object passed to the adapter.
- **Stale Prisma client after schema change.** Run `pnpm rudder db:generate` (or `pnpm exec prisma generate`) — the TypeScript types in your app go stale until you regenerate.
- **Query results are Model instances.** `find`/`first`/`all`/etc. return `instanceof Model` objects with prototype methods bound — call `await user.save()`, `user.is(other)`, `user.trashed()` directly. See [Models — Hydrated instances](/guide/database/models#hydrated-instances).
- **`db:push` in production.** Use tracked migrations (`pnpm rudder migrate`) — `db:push` can drop columns silently on destructive changes.
