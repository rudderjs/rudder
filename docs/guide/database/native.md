# Native Engine

The **native engine** is RudderJS's built-in, first-party SQL query engine. It lives in **`@rudderjs/database`** — the SQL data-layer foundation `@rudderjs/orm` is built on, installed automatically as its dependency (the historical `@rudderjs/orm/native` subpath keeps working as a re-export alias) — no external ORM, no separate adapter package. It talks directly to the database driver (`better-sqlite3`, `postgres`, or `mysql2`), brings its own Laravel-style schema builder and migration runner, and **generates your models' column types from the migrated schema** so they can't drift.

It's the default engine scaffolded by `create-rudder`. Pick it when you want a first-party data layer with no external ORM; reach for the [Prisma](/guide/database/prisma) or [Drizzle](/guide/database/drizzle) adapters when you want their schema tooling or ecosystem.

::: tip Three drivers
The native engine supports **`sqlite`** (better-sqlite3), **`pg`** (postgres), and **`mysql`** (mysql2). Each is an optional peer, lazy-loaded only when a connection selects it — the `Model` API is identical across all three, so switching is a config change, not a rewrite.
:::

## Install

Install `@rudderjs/orm` plus the driver for your database — each is an optional peer, lazy-loaded and never reaching a client bundle. No `@rudderjs/orm-*` adapter package is needed.

::: code-group

```bash [SQLite]
pnpm add @rudderjs/orm better-sqlite3
pnpm add -D @types/better-sqlite3
```

```bash [Postgres]
pnpm add @rudderjs/orm postgres
```

```bash [MySQL]
pnpm add @rudderjs/orm mysql2
```

:::

With `create-rudder`, choose **Native** at the Database prompt (it's the default), then pick SQLite, PostgreSQL, or MySQL at the driver prompt — the driver dependency, `config/database.ts`, `.env`, and a starter migration are all wired for you. Non-interactively: `--orm=native --db=postgresql|mysql` (or just `--db=…` — native is the default engine).

## Configure

A connection opts into the native engine with `engine: 'native'`. The built-in `NativeDatabaseProvider` is auto-discovered and stays **inert** unless the default connection sets that flag — so it's harmless to have `@rudderjs/orm` installed alongside Prisma/Drizzle.

```ts
// config/database.ts
import { Env } from '@rudderjs/support'

export default {
  default: Env.get('DB_CONNECTION', 'sqlite'),

  connections: {
    sqlite: {
      engine: 'native' as const,
      driver: 'sqlite' as const,
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },
    // Postgres and MySQL use the same shape — just swap the driver:
    pg: {
      engine: 'native' as const,
      driver: 'pg' as const,
      url:    Env.get('DATABASE_URL', 'postgres://user:pass@localhost:5432/app'),
    },
    mysql: {
      engine: 'native' as const,
      driver: 'mysql' as const,
      url:    Env.get('DATABASE_URL', 'mysql://user:pass@localhost:3306/app'),
    },
  },
}
```

For sqlite, `url` accepts a `file:` path, a bare path, or `:memory:`; pg/mysql take a standard connection string. Most apps just set `DATABASE_URL` in `.env`. A native connection can also declare [read/write splitting and sticky reads](/guide/database/connections#read-write-splitting) — read replicas round-robin per query while writes (and everything inside a transaction) go to the primary.

### Register the provider

Auto-discovery handles this — after installing, run `pnpm rudder providers:discover` and the native provider boots when the config opts in. To wire it explicitly instead:

```ts
// bootstrap/providers.ts
import { nativeDatabase } from '@rudderjs/orm/native/provider'

export default [ ...(await defaultProviders()), nativeDatabase(), AppServiceProvider ]
```

## Migrations

Unlike Prisma (`.prisma` files) and Drizzle (a TS schema + `drizzle-kit`), the native engine ships its **own** schema builder and migration runner. Migration files live in `database/migrations/` and run in filename order.

```bash
pnpm rudder make:migration create_posts_table   # writes a timestamped stub
pnpm rudder migrate                               # apply pending migrations
pnpm rudder migrate:status                        # show ran / pending
pnpm rudder migrate:rollback                      # revert the last batch
pnpm rudder migrate:refresh                       # rollback all + re-run
pnpm rudder migrate:fresh                         # drop all tables + re-run
```

A migration is a class with `up()` / `down()` using the `Schema` facade (`make:migration` stubs import from `@rudderjs/orm/native`, which re-exports the same classes — both forms are equivalent):

```ts
// database/migrations/2026_06_02_120000_create_posts_table.ts
import { Migration, Schema } from '@rudderjs/database'

export default class extends Migration {
  async up() {
    await Schema.create('posts', (t) => {
      t.id()
      t.string('title')
      t.text('body').nullable()
      t.foreignId('userId').constrained()   // → users.id, FK
      t.boolean('published').default(false)
      t.timestamps()
    })
  }

  async down() {
    await Schema.dropIfExists('posts')
  }
}
```

The blueprint mirrors Laravel — `t.id()`, `t.string(name, len?)`, `t.text()`, `t.integer()`, `t.bigInteger()`, `t.foreignId()`, `t.uuid()`, `t.decimal()`, `t.float()`, `t.boolean()`, `t.dateTime()`, `t.timestamp()`, `t.json()`, `t.binary()`, plus the `t.timestamps()` / `t.softDeletes()` clusters. Column modifiers chain: `.nullable()`, `.unique()`, `.index()`, `.primary()`, `.default(v)`, `.unsigned()`, `.constrained(table?, col?)`. Constraints: `t.primary()`, `t.unique()`, `t.index()`, `t.foreign(cols).references(col).on(table).onDelete(action)`.

Altering an existing table uses `Schema.table(...)` with the same blueprint — add/drop/rename columns, add/drop indexes and foreign keys, and **modify a column in place with `.change()`**:

```ts
await Schema.table('users', (t) => {
  t.string('email', 100).nullable().change()   // new definition REPLACES the old one
})
```

`.change()` semantics mirror Laravel: the chained definition is the column's **complete** new spec — omit `.default(...)` and any existing default is dropped, omit `.nullable()` and the column becomes `NOT NULL`. On Postgres this compiles to one comma-joined `ALTER TABLE … ALTER COLUMN` statement (type relies on pg's implicit casts — an incompatible conversion needs a raw `USING` via `DB.statement(...)`); on MySQL to a single `MODIFY` carrying the full spec (positional `.after(...)`/`.first()` compose). On SQLite, which can't alter a column in place, `.change()` triggers the table-rebuild dance and must be the only operation in its `Schema.table` call.

::: tip camelCase columns
Native columns are **camelCase** (`createdAt`, `userId`, `commentableType`) — a deliberate divergence from Laravel's snake_case, matching the ORM's polymorphic-column and soft-delete defaults.
:::

`t.timestamps()` columns are populated by the **Model layer**, Laravel-style: `create()` stamps `createdAt` + `updatedAt`, `update()`/`save()` bumps `updatedAt` — see [Models — Timestamps](/guide/database/models#timestamps). No `DEFAULT CURRENT_TIMESTAMP` needed (a `.useCurrent()` DB-level backstop is harmless); rows written outside the Model layer (raw `DB.insert`, bulk ops) only get values the database itself defaults.

> There's no `db:push` or `db:generate` for the native engine — those are Prisma/Drizzle commands. Native uses tracked migration files for every change.

Multi-database apps can run a suite against a named connection with `migrate --connection=<name>` (state table included; pair with `--path=<dir>` for per-database migration sets), or scope one DDL operation with `Schema.connection('reporting').create(…)` — see [Connections — Multi-database migrations](/guide/database/connections#multi-database-migrations).

## Typed models from migrations

The native engine's headline feature: **a model's column types are generated from the migrated schema, so they can't drift.** After a `migrate`, the engine introspects the live database and writes `.rudder/types/models.d.ts`. Bind it with `Model.for<'table'>()` and the model needs zero hand-declared fields:

```ts
import { Model } from '@rudderjs/orm'

export class Post extends Model.for<'posts'>() {
  static override table = 'posts'
  // columns (id, title, body, userId, published, …) come from the generated registry
}
```

Regenerate without a full migrate via `pnpm rudder schema:types`. Commit the generated `models.d.ts` (like Drizzle's schema, not Prisma's gitignored client) so CI is green without a generate step. See [Database — Typed models from migrations](/guide/database#typed-models-from-migrations-schema-types) for the full rules.

A scaffolded `app/Models/User.ts` starts with hand-declared fields (so `tsc` is green before the first `migrate`); switch it to `extends Model.for<'users'>()` once you've run `migrate` and want the columns to track the schema automatically.

## Transactions

The native engine implements cross-model [transactions](/guide/database#transactions) today — `transaction()` (and the `Model.transaction()` alias) commit every query in the callback together, with nested calls mapping to savepoints.

```ts
import { transaction } from '@rudderjs/orm'

await transaction(async () => {
  const user = await User.create({ name: 'Ada', email: 'ada@example.com' })
  await Post.create({ userId: user.id, title: 'Hello' })
})
```

## Inspecting the database

Laravel's `db:show` / `db:table`, over the native engine's live connection:

```bash
pnpm rudder db:show              # overview — dialect, version, every table + on-disk size
pnpm rudder db:show --counts     # add row counts (runs one COUNT(*) per table)
pnpm rudder db:show --views      # add the view list
pnpm rudder db:table users      # one table — columns, indexes, foreign keys, row count
pnpm rudder db:query "SELECT id, title FROM posts LIMIT 5"   # one-off SELECT → JSON rows
```

`db:query` is the odd one out: it rides the `DB` facade rather than the native catalog, so it works on **every** adapter (native, Prisma, Drizzle) — and it's deliberately SELECT-only.

```
  posts  1 row · 4.0 KB

  COLUMN  TYPE     NULLABLE  DEFAULT
  ──────  ───────  ────────  ───────
  id      INTEGER  yes       —
  title   TEXT     no        —
  userId  INTEGER  no        0

  INDEX              COLUMNS  ATTRIBUTES
  ─────────────────  ───────  ──────────
  PRIMARY            id       primary, unique
  posts_title_index  title    —

  Foreign Keys
  userId → users (id)  on update NO ACTION · on delete CASCADE
```

Both take `--json` for machine-readable output. Notes:

- **Native engine only** — Prisma and Drizzle apps are pointed at their own inspectors (`prisma studio` / `drizzle-kit studio`).
- Per-table sizes come from `pg_total_relation_size` (Postgres) and `data_length + index_length` (MySQL). On SQLite they need the optional `dbstat` module — sizes show `—` on builds without it.
- `db:table <name>` only ever inspects a name the catalog itself reports — an unknown table errors with the available-tables list.

## Standalone — without the framework

`@rudderjs/orm` is a plain library; nothing on the query path imports `@rudderjs/core`. You can wire the native adapter by hand in any Node project — see [Database — Standalone](/guide/database#standalone-rudderjs-orm-in-any-node-app).

## What's supported

The native adapter implements the same `OrmAdapter` interface as Prisma/Drizzle — `where`, `orderBy`, `limit`, `paginate`, `find`, `first`, `all`, `count`, `create`, `update`, `delete`, scopes, casts, observers, soft deletes, aggregates (`withCount`/`withSum`/…), and `whereHas` / `whereDoesntHave`.

| Feature | Native | Notes |
|---|---|---|
| Drivers | SQLite, Postgres, MySQL | Optional peers: `better-sqlite3` / `postgres` / `mysql2` |
| Read/write split | Supported | Replica round-robin + [sticky reads](/guide/database/connections#read-write-splitting) |
| Migrations | Built-in | `Schema` builder + `migrate` family of commands |
| Typed columns | Generated | `Model.for<'table'>()` from `schema:types` |
| `transaction()` | Supported | Savepoint-nested |
| `with(relation)` | Supported | Model-layer batched WHERE-IN, all relation types |
| `db:push` / `db:generate` | n/a | Prisma/Drizzle only — native uses migrations |

## Pitfalls

- **`static table` is the SQL table name.** Native queries the table directly — `static table = 'users'`, not the Prisma delegate (`'user'`) or a Drizzle registry key.
- **`engine: 'native'` is required.** Without it on the default connection the provider stays inert and Models have no adapter — the first query throws. (This is the collision guard that lets `@rudderjs/orm` ship in every app.)
- **Driver names are `sqlite` / `pg` / `mysql`.** An unknown name (e.g. `postgresql`) fails fast with a pointer to the supported list — it is not silently downgraded.
- **Commit `.rudder/types/models.d.ts`.** It's generated, never hand-edited, and checked in so `tsc`/CI stays green.
