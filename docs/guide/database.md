# Database

Almost every modern web application talks to a database. Rudder makes that interaction painless through `@rudderjs/orm` — a unified `Model` base class that works with Prisma, Drizzle, or the **built-in native engine** as the adapter. The same model code runs against any of them; the adapter handles all SQL and connection pooling.

```
Model (from @rudderjs/orm)
  └── ModelRegistry.getAdapter()
        └── OrmAdapter (interface)
              ├── NativeAdapter   (@rudderjs/database — built in)
              ├── PrismaAdapter   (@rudderjs/orm-prisma)
              └── DrizzleAdapter  (@rudderjs/orm-drizzle)
```

## Choosing an adapter

All three are first-party and feature-equivalent at the model layer. The choice comes down to schema preference and whether you want a zero-dependency query engine.

| | Native (built-in) | Prisma | Drizzle |
|---|---|---|---|
| Install | `@rudderjs/orm` + a driver (`better-sqlite3` / `postgres` / `mysql2`) | `@rudderjs/orm-prisma` | `@rudderjs/orm-drizzle` |
| Schema / migrations | **Built-in** (`Schema` builder + `migrate`) | `prisma/schema/*.prisma` + `prisma migrate` | TS schema + `drizzle-kit` |
| Drivers | SQLite, PostgreSQL, MySQL | SQLite, PostgreSQL, MySQL, libSQL | SQLite, PostgreSQL, MySQL, libSQL |
| `whereHas` setup | None | needs a declared `@relation` | needs a table registry |
| Relations via `Model.with()` | Supported | Supported | Supported |
| Transactions (`transaction()`) | Supported | Supported | Supported |
| Read/write split + sticky | Supported | — ([extension](/guide/database/connections#adapter-support)) | Supported |

For setup details see [Native Engine](#native-engine-built-in) below, [Prisma Adapter](/guide/database/prisma), or [Drizzle Adapter](/guide/database/drizzle). The rest of this guide is adapter-neutral.

## Native engine (built-in)

The native engine lives in **`@rudderjs/database`** — the SQL data-layer foundation `@rudderjs/orm` is built on (installed automatically as orm's dependency; the historical `@rudderjs/orm/native` subpath still works as a re-export alias). It's a first-party SQL query engine that talks directly to the database driver (`better-sqlite3`, `postgres`, or `mysql2`), no external ORM. It's **opt-in**: a connection selects it with `engine: 'native'`, and the built-in `NativeDatabaseProvider` (auto-discovered) wires it up. Without that flag it stays dormant, so installing it alongside Prisma/Drizzle is harmless.

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
pnpm add better-sqlite3   # or `postgres` / `mysql2`, per driver; lazy-loaded, never in a client bundle
```

That's the whole setup — Models, relations, `whereHas`/aggregates, soft deletes, and [transactions](#transactions) all work. The `@rudderjs/orm` main entry stays client-bundle-safe; the native driver and provider live only under the `./native` subpath and are never reachable from a browser graph.

::: tip Native migrations
The native engine ships its own Laravel-style schema builder + migration runner — `Schema.create` / `Schema.table`, `make:migration`, `migrate`, `migrate:rollback` / `migrate:refresh` / `migrate:fresh`, foreign keys, and transactional batches — on **all three drivers** (SQLite, Postgres, MySQL; a column-type `.change()` rebuild is SQLite-only). Native is the **default engine scaffolded by `create-rudder`**. See the dedicated [Native Engine](/guide/database/native) guide, and [Typed models from migrations](#typed-models-from-migrations-schema-types) for the headline feature: column types generated from your migrations.
:::

### Typed models from migrations (`schema:types`)

The native engine's headline feature: **a model's column types are generated from the migrated schema, not hand-maintained — so they can't drift.** Write the migration once; the model's field types come for free.

After a `migrate`, the engine introspects the live database and writes `app/Models/__schema/registry.d.ts`, which augments an internal `SchemaRegistry` with one entry per table. Bind it onto a model with `Model.for<'table'>()` and the model needs **zero** hand-declared column fields:

```ts
// app/Models/User.ts — you write only intent + behavior
import { Model } from '@rudderjs/orm'

export class User extends Model.for<'users'>() {
  static override table = 'users'
  // no id!/name!/email! — those come from the generated registry
}
```

Everything resolves off that one binding — direct finders, query-builder chains, and writes:

```ts
const u = await User.find(1)                  // u.id / u.name / u.email all typed
await User.where('active', true).first()       // chained results typed too
await User.create({ name, email })             // unknown columns fail `tsc`
```

**Generation runs automatically** after a successful native `migrate`, `migrate:fresh`, `migrate:refresh`, or `migrate:rollback`. Regenerate on demand without a full migrate:

```bash
pnpm rudder schema:types     # rewrite app/Models/__schema/registry.d.ts from the live schema
```

A few rules worth knowing:

- **`casts` refine the generated type.** The generator emits the column's storage type, then folds in any string `static casts` — so a `boolean`/`date`/`json` cast surfaces as `boolean`/`Date`/the cast's type rather than the raw column affinity. Class-based casts (custom `CastUsing`, `vector(...)`) keep the storage type.
- **Nullable columns widen to `T | null`;** the primary key and `NOT NULL` columns stay non-null.
- **Commit the generated file.** Treat `app/Models/__schema/registry.d.ts` as checked-in (like Drizzle's schema, not Prisma's gitignored client) so `tsc`/CI is green without a generate step. It's never hand-edited — `migrate` / `schema:types` overwrite it.
- **Opt-in and additive.** Plain `extends Model` (with or without hand-declared fields) keeps working exactly as before; `.for()` is the only thing that pulls in generated columns. At runtime `.for()` returns the class unchanged.
- **prisma/drizzle apps** already generate a typed client (`db:generate`) / infer from their TS schema, so `schema:types` is a friendly no-op there.

To wire it explicitly instead of via auto-discovery:

```ts
// bootstrap/providers.ts
import { nativeDatabase } from '@rudderjs/orm/native/provider'
export default [ ...(await defaultProviders()), nativeDatabase(), AppServiceProvider ]
```

### Standalone — `@rudderjs/orm` in any Node app

The native engine is decoupled from the Rudder framework: `@rudderjs/orm` is a plain library, and nothing on the query path imports `@rudderjs/core`. You can use the `Model` layer in any Node project — a script, a worker, a non-Rudder server — by wiring the adapter yourself with two packages and no providers:

```bash
npm install @rudderjs/orm better-sqlite3
```

`@rudderjs/core` and `@rudderjs/console` are **not** pulled in — they're optional peers, used only by the framework provider and the CLI subpaths. A standalone install is just `@rudderjs/orm` + its two runtime deps (`@rudderjs/contracts` and `@rudderjs/database`, the engine's home) + the `better-sqlite3` peer.

```ts
import { Model, ModelRegistry } from '@rudderjs/orm'
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/database'

class Todo extends Model {
  static table = 'todos'
  static casts = { done: 'boolean' }
}

// No migrations under the SQLite engine, so create tables via the driver,
// then hand the open driver to the adapter (you own its lifecycle).
const driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
await driver.execute(
  'CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, done INTEGER)',
  [],
)
ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))

// From here, the full Model API works — no Rudder bootstrap required.
await Todo.create({ title: 'first', done: false })
const done = await Todo.query().where('done', true).get()
const todo = await Todo.find(1)
console.log(todo?.toJSON()) // { id: 1, title: 'first', done: false }  ← boolean cast round-trips

await driver.close()
```

The key call is `ModelRegistry.set(adapter)` — the same thing the framework provider does during `boot()`. `NativeAdapter.make({ driverInstance })` takes a driver you opened (so you control `CREATE TABLE` and `close()`); pass `{ url: 'file:./dev.db' }` instead to let the adapter open and own the connection.

> This exact flow is certified on every CI run by `scripts/orm-standalone-smoke.mjs`, which `pnpm pack`s `@rudderjs/orm`, installs it into a throwaway project **outside** the workspace, asserts `@rudderjs/console` was not dragged in, and runs the round-trip above. If the install grows a hard framework dependency, that job goes red.

## Quick start

Once a model is defined and the database provider is registered, querying is a one-liner:

```ts
import { User } from '../app/Models/User.js'

const all       = await User.all()
const alice     = await User.where('email', 'alice@example.com').first()
const admins    = await User.where('role', 'admin').orderBy('createdAt', 'DESC').get()
const created   = await User.create({ name: 'Bob', email: 'bob@example.com' })
```

The full Model API — defining models, mass assignment, hidden fields, custom scopes — lives in [Models](/guide/database/models). To shape what your API returns per endpoint (envelopes, conditional fields, pagination meta), see [API Resources](/guide/database/resources).

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

The `connections` map is a **menu** — entries are lazy, and an unused named connection never opens a socket or even imports its driver. For multiple databases, per-model connections (`static connection` / `Model.on()`), and read/write replica splitting with sticky reads, see [Connections](/guide/database/connections).

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

Transactions work on all three adapters — native, Prisma, and Drizzle. To run one against a [named connection](/guide/database/connections#transactions-on-a-named-connection), pass `{ connection: 'name' }` as the second argument.

### Isolation levels

Pass `isolationLevel` to run the transaction at a specific SQL isolation level — `'read uncommitted'`, `'read committed'`, `'repeatable read'`, or `'serializable'`:

```ts
await transaction(async () => {
  // runs under SERIALIZABLE — concurrent conflicting commits fail fast
  const total = await Account.sum('balance')
  await AuditLog.create({ total })
}, { isolationLevel: 'serializable' })
```

All three adapters support it on Postgres and MySQL — the native engine emits `SET TRANSACTION ISOLATION LEVEL …` at transaction start, Drizzle receives it via its transaction config, and Prisma via `$transaction`'s `isolationLevel` option. Two constraints:

- **Outermost call only.** A nested `transaction()` maps to a savepoint, whose isolation can't diverge from the enclosing transaction's — passing `isolationLevel` there throws.
- **SQLite throws.** SQLite has no isolation levels (its single-writer model is already serializable), so requesting one fails loudly instead of silently meaning nothing.

## Pessimistic locking

Lock the selected rows for the rest of the transaction with `lockForUpdate()` (writers and locking readers block) or `sharedLock()` (writers block, readers proceed). Only meaningful inside a `transaction()`:

```ts
await transaction(async () => {
  const job = await Job.query()
    .where('status', 'pending')
    .orderBy('id')
    .lockForUpdate({ skipLocked: true })   // skip rows another worker holds
    .first()
  if (job) await Job.update(job.id, { status: 'running' })
})
```

Both methods take an optional wait-behavior argument — **mutually exclusive, both set throws**:

- `{ skipLocked: true }` — skip rows another transaction has locked instead of waiting (`FOR UPDATE SKIP LOCKED`). *The* pattern for concurrent job reservation: each worker grabs only unclaimed rows.
- `{ noWait: true }` — fail immediately with a lock-conflict error instead of blocking (`NOWAIT`).

Adapter support: **native** and **Drizzle** emit the real clauses on Postgres and MySQL 8; on SQLite the lock (options included) is a no-op — there are no row locks, and its single-writer transaction already serializes. **Prisma** throws — its query API has no `FOR UPDATE`; run the locking read raw inside a transaction (`DB.transaction(() => DB.select('SELECT … FOR UPDATE SKIP LOCKED', binds))`) or use the native engine.

## Pitfalls

- **`static table` mismatch.** For Prisma, the value is the **delegate** name (camelCase, e.g. `blogPost`) — not the SQL table name (`blog_posts`). For Drizzle, it's the key in the `tables: {}` object passed to the adapter.
- **Stale Prisma client after schema change.** Run `pnpm rudder db:generate` (or `pnpm exec prisma generate`) — the TypeScript types in your app go stale until you regenerate.
- **Query results are Model instances.** `find`/`first`/`all`/etc. return `instanceof Model` objects with prototype methods bound — call `await user.save()`, `user.is(other)`, `user.trashed()` directly. See [Models — Hydrated instances](/guide/database/models#hydrated-instances).
- **`db:push` in production.** Use tracked migrations (`pnpm rudder migrate`) — `db:push` can drop columns silently on destructive changes.
