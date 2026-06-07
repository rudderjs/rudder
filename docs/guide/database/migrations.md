# Migrations

Rudder unifies migration commands across all three engines — the [native engine](/guide/database/native)'s first-party migration runner and the Prisma/Drizzle adapters' tooling. The same `pnpm migrate` works everywhere; the active engine is auto-detected.

```bash
pnpm migrate              # apply pending migrations
pnpm migrate:fresh        # drop everything and re-run
pnpm migrate:status       # show what's applied
pnpm db:seed              # run database/seeders/DatabaseSeeder
```

On the **native engine** these run the built-in runner over `database/migrations/` — plus `migrate:rollback`, `migrate:reset`, and `migrate:refresh`, which exist only there (see [Rollbacks](#rollbacks)), and `--connection=<name>` / `--path=<dir>` for [multi-database apps](/guide/database/connections#multi-database-migrations). A successful run also regenerates the [typed model registry](/guide/database#typed-models-from-migrations-schema-types).

On **Prisma/Drizzle**, the commands delegate to the underlying tool:

| Command | Prisma (dev) | Prisma (prod) | Drizzle |
|---|---|---|---|
| `migrate` | `prisma migrate dev` | `prisma migrate deploy` | `drizzle-kit migrate` |
| `migrate:fresh` | `prisma migrate reset --force` | same | `drizzle-kit migrate --force` |
| `migrate:status` | `prisma migrate status` | same | `drizzle-kit check` |
| `make:migration <name>` | `prisma migrate dev --create-only --name <name>` | — | `drizzle-kit generate --name <name>` |
| `db:push` | `prisma db push` | same | `drizzle-kit push` |
| `db:generate` | `prisma generate` | same | (no-op) |
| `db:seed` | run `database/seeders/DatabaseSeeder.ts` | same | same |

`db:push` and `db:generate` are Prisma/Drizzle-only — the native engine has no push mode and no client to generate; every change is a tracked migration.

`make:migration` also takes a `--vector <table> <column> <dimensions>` flag (optional `--metric cosine|l2|inner-product`, default cosine) that scaffolds a pgvector migration — `CREATE EXTENSION`, the `vector(N)` column, and an HNSW index — in your ORM's migration format. Postgres only; see the `vector({ dimensions })` cast under [Models — Casts](/guide/database/models#casts) for the read/write side.

Production vs development is selected by `NODE_ENV`. In production, `migrate` runs `prisma migrate deploy` (apply only — never generate, never prompt) instead of `migrate dev`.

You can also run any of these via the `rudder` CLI directly: `pnpm rudder migrate`, `pnpm rudder db:seed`, etc.

## Adding a new table

The flow has engine-specific steps (describe the table) and one shared step (write the model).

### Native

```bash
# 1. Create + edit the migration
pnpm rudder make:migration create_posts_table
# 2. Apply — also regenerates the typed registry
pnpm rudder migrate

# 3. Create the Model class
pnpm rudder make:model Post
```

Fill in the generated stub with the Laravel-style blueprint:

```ts
// database/migrations/<timestamp>_create_posts_table.ts
import { Migration, Schema } from '@rudderjs/database'

export default class extends Migration {
  async up() {
    await Schema.create('posts', (t) => {
      t.id()
      t.string('title')
      t.text('body').nullable()
      t.timestamps()
    })
  }

  async down() {
    await Schema.dropIfExists('posts')
  }
}
```

Bind the model with `Model.for<'posts'>()` and the column types come from the migrated schema — no hand-declared fields. See the [Native Engine guide](/guide/database/native#migrations) for the full blueprint surface.

### Prisma

```bash
# 1. Edit prisma/schema/app.prisma — add the model
# 2. Apply
pnpm db:push                                  # dev: fast diff, no migration file
# OR
pnpm rudder make:migration create_posts_table
pnpm migrate                                  # production-track: versioned SQL

# 3. Generate the client
pnpm rudder db:generate

# 4. Create the Model class
pnpm rudder make:model Post
```

Edit `prisma/schema/app.prisma`:

```prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  body      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

::: tip make:model --migration
Combine steps with `pnpm rudder make:model Post --migration` — it creates the Model class **and** an empty `create_posts_table` migration in one shot. You still edit the Prisma schema yourself.
:::

### Drizzle

```bash
# 1. Edit db/schema.ts — add the table
# 2. Generate the migration SQL (Drizzle diffs the schema for you)
pnpm rudder make:migration create_posts_table
# 3. Apply
pnpm migrate

# 4. Create the Model class
pnpm rudder make:model Post
```

Edit `db/schema.ts`:

```ts
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const posts = sqliteTable('posts', {
  id:        text('id').primaryKey(),
  title:     text('title').notNull(),
  body:      text('body'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
```

## Adding a column to an existing table

Same flow as creating a table — describe the change, then apply it. The `make:model` step is skipped (the model already exists).

```bash
# Native
pnpm rudder make:migration add_excerpt_to_posts
#   → up(): await Schema.table('posts', (t) => { t.string('excerpt').nullable() })
pnpm rudder migrate
# Models bound with Model.for<'posts'>() pick up the new column's type
# automatically — the registry regenerated with the migrate.

# Prisma
# 1. Add `excerpt String?` to the Post model in app.prisma
pnpm db:push                                       # dev
# OR
pnpm rudder make:migration add_excerpt_to_posts
pnpm migrate                                       # versioned

# 2. Add `excerpt!: string | null` to app/Models/Post.ts

# Drizzle
# 1. Add `excerpt: text('excerpt')` to the posts table in schema.ts
pnpm rudder make:migration add_excerpt_to_posts    # auto-diffs
pnpm migrate

# 2. Add `excerpt!: string | null` to app/Models/Post.ts
```

## `db:push` vs `migrate`

Two workflows on Prisma/Drizzle. Pick one per project:

- **`db:push`** — fast prototype mode. Diffs your schema against the live database and applies the changes immediately. **No migration file.** No version history. Dev only.
- **`migrate`** — production track. Records every change as a versioned file (`prisma/migrations/`, `drizzle/migrations/`, or the native engine's `database/migrations/`). Reviewable, replayable, deployable.

Use `db:push` while you're modeling. Switch to `migrate` once the schema stabilizes and you need a paper trail. The **native engine** is migrate-only by design — there's no push mode, so the paper trail is always there.

## Seeders

Create `database/seeders/DatabaseSeeder.ts`:

```ts
import { Seeder } from '@rudderjs/orm'
import { User } from '../../app/Models/User.js'
import { Post } from '../../app/Models/Post.js'

export default class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    await User.create({ name: 'Alice', email: 'alice@example.com', role: 'admin' })
    await User.create({ name: 'Bob',   email: 'bob@example.com',   role: 'user'  })

    await Post.create({ title: 'First post', userId: 'alice' })
  }
}
```

Run it:

```bash
pnpm db:seed
```

For larger projects, split into separate seeders and call them from `DatabaseSeeder`:

```ts
import { Seeder } from '@rudderjs/orm'
import { UserSeeder } from './UserSeeder.js'
import { PostSeeder } from './PostSeeder.js'

export default class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    await this.call([UserSeeder, PostSeeder])
  }
}
```

```ts
// database/seeders/UserSeeder.ts
import { Seeder } from '@rudderjs/orm'
import { User } from '../../app/Models/User.js'

export class UserSeeder extends Seeder {
  async run(): Promise<void> {
    await User.create({ name: 'Alice', email: 'alice@example.com' })
  }
}
```

The `db:seed` runner accepts either a class extending `Seeder` (instantiates and calls `.run()`) or a plain async function (invokes it directly).

If you'd rather use Prisma's native seed integration, configure `prisma.seed` in `package.json` and skip the `DatabaseSeeder.ts` file — `db:seed` falls back to `prisma db seed` automatically.

## Rollbacks

Rollback support depends on whether the engine's migrations carry a `down()` method:

- **Native engine** — full Laravel parity. Migrations are classes with explicit `up()` / `down()`, so `migrate:rollback` (revert the last batch), `migrate:reset` (revert everything), and `migrate:refresh` (reset + re-run) all work, and batches are transactional where the driver supports it.
- **Prisma / Drizzle** — forward-only SQL files, no `down()`, so those commands don't exist there. In dev, `pnpm migrate:fresh` drops everything and re-runs all migrations. In production, write a new forward migration that reverses the change — the same advice Prisma's docs give for "rolling back" a deployed migration.

## Common pitfalls

- **`No ORM detected`** — the migrate commands look for the native engine (`engine: 'native'` on the default connection in `config/database.ts`) or an installed `@rudderjs/orm-prisma` / `@rudderjs/orm-drizzle`. Make sure one of the three is actually wired.
- **`db:push` in production** — don't. It bypasses the migrations folder and can silently drop columns. Use `migrate` for anything you ship.
- **Stale Prisma client** — after editing `schema.prisma`, run `pnpm rudder db:generate` (or it'll happen automatically as part of `migrate`) before importing new fields in TypeScript.
- **Drizzle `make:migration` produces an empty SQL file** — that means your `db/schema.ts` is identical to the last applied snapshot. Edit the schema first, then run `make:migration`.
