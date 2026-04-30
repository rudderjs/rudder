# Migrations

RudderJS unifies migration commands across the Prisma and Drizzle adapters. The same `pnpm migrate` works for both — the active ORM is auto-detected from your `package.json`.

```bash
pnpm migrate              # apply pending migrations
pnpm migrate:fresh        # drop everything and re-run
pnpm migrate:status       # show what's applied
pnpm db:seed              # run database/seeders/DatabaseSeeder
```

The full command list:

| Command | Prisma (dev) | Prisma (prod) | Drizzle |
|---|---|---|---|
| `migrate` | `prisma migrate dev` | `prisma migrate deploy` | `drizzle-kit migrate` |
| `migrate:fresh` | `prisma migrate reset --force` | same | `drizzle-kit migrate --force` |
| `migrate:status` | `prisma migrate status` | same | `drizzle-kit check` |
| `make:migration <name>` | `prisma migrate dev --create-only --name <name>` | — | `drizzle-kit generate --name <name>` |
| `db:push` | `prisma db push` | same | `drizzle-kit push` |
| `db:generate` | `prisma generate` | same | (no-op) |
| `db:seed` | run `database/seeders/DatabaseSeeder.ts` | same | same |

Production vs development is selected by `NODE_ENV`. In production, `migrate` runs `prisma migrate deploy` (apply only — never generate, never prompt) instead of `migrate dev`.

You can also run any of these via the `rudder` CLI directly: `pnpm rudder migrate`, `pnpm rudder db:seed`, etc.

## Adding a new table

The flow has two adapter-specific steps (edit the schema, generate or push) and one shared step (write the model).

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

Same flow as creating a table — edit the schema, then `db:push` or `make:migration` + `migrate`. The `make:model` step is skipped (model already exists, just add the field to the class).

```bash
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

Two workflows. Pick one per project:

- **`db:push`** — fast prototype mode. Diffs your schema against the live database and applies the changes immediately. **No migration file.** No version history. Dev only.
- **`migrate`** — production track. Records every change as a versioned SQL file in `prisma/migrations/` or `drizzle/migrations/`. Reviewable, replayable, deployable.

Use `db:push` while you're modeling. Switch to `migrate` once the schema stabilizes and you need a paper trail.

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

## Why no `migrate:rollback`

Laravel ships `migrate:rollback`, `migrate:reset`, and `migrate:refresh` because Laravel migrations have explicit `up()` and `down()` methods. Prisma and Drizzle don't — both produce forward-only SQL files.

In dev: `pnpm migrate:fresh` drops everything and re-runs all migrations.

In production: write a new forward migration that reverses the change. This is the same advice Prisma's docs give for "rolling back" a deployed migration.

## Common pitfalls

- **`No ORM detected`** — install `@rudderjs/orm-prisma` or `@rudderjs/orm-drizzle` as a dependency. The migrate commands check `package.json`, not the installed runtime.
- **`db:push` in production** — don't. It bypasses the migrations folder and can silently drop columns. Use `migrate` for anything you ship.
- **Stale Prisma client** — after editing `schema.prisma`, run `pnpm rudder db:generate` (or it'll happen automatically as part of `migrate`) before importing new fields in TypeScript.
- **Drizzle `make:migration` produces an empty SQL file** — that means your `db/schema.ts` is identical to the last applied snapshot. Edit the schema first, then run `make:migration`.
