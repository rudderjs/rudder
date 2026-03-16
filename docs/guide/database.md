# Database & Models

BoostKit provides a unified `Model` base class that works with any ORM adapter. The adapter handles all database communication — your model code stays the same regardless of whether you use Prisma or Drizzle.

---

## Architecture

```
Model (from @boostkit/orm)
  └── ModelRegistry.getAdapter()
        └── OrmAdapter (interface)
              ├── PrismaAdapter  (@boostkit/orm-prisma)
              └── DrizzleAdapter (@boostkit/orm-drizzle)
```

`@boostkit/orm` defines the `Model` base class and `ModelRegistry`. The adapter packages implement the `OrmAdapter` interface and register themselves into the registry during the provider boot phase.

---

## Choosing a Provider

| | Prisma | Drizzle |
|---|---|---|
| **Schema** | `prisma/schema.prisma` (SDL) | TypeScript schema files |
| **Migrations** | `prisma migrate dev/deploy` | `drizzle-kit generate/migrate` |
| **Type safety** | Generated client types | Schema-inferred types |
| **Relations** | `with()` supported | `with()` is a no-op — use raw Drizzle |
| **Drivers** | SQLite, PostgreSQL, MySQL, libSQL | SQLite, PostgreSQL, libSQL |
| **Best for** | Full-featured apps, familiar SQL DX | Lightweight, schema-as-code preference |

Both adapters work identically from the Model layer. You can switch adapters without changing any Model code.

---

## Prisma Setup

### 1. Install

```bash
pnpm add @boostkit/orm @boostkit/orm-prisma @prisma/client
pnpm add -D prisma
```

For SQLite (local development), also install:

```bash
pnpm add better-sqlite3 @prisma/adapter-better-sqlite3
pnpm add -D @types/better-sqlite3
```

### 2. Multi-file Prisma Schema

BoostKit uses a **multi-file schema** layout. Instead of a single `prisma/schema.prisma`, schemas are split into separate files inside a `prisma/schema/` directory:

```
prisma/
├── schema/
│   ├── base.prisma          # generator + datasource
│   ├── user.prisma          # User model
│   ├── post.prisma          # Post model
│   ├── auth.prisma          # Auth models (published by @boostkit/auth)
│   └── notification.prisma  # Notification model (published by @boostkit/notification)
└── prisma.config.ts         # Points to prisma/schema directory
```

Each concern lives in its own file. BoostKit packages can publish their own schema files via `pnpm artisan vendor:publish --tag=<pkg>-schema` (see [Schema Publishing](#schema-publishing) below).

### 3. Configure prisma.config.ts

The `prisma.config.ts` file at the project root tells Prisma where to find the schema directory and how to connect:

```ts
// prisma.config.ts
import path from 'node:path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema'),
})
```

The datasource URL is configured in the `base.prisma` file inside the schema directory, not in `prisma.config.ts`.

### 4. Define your schema

```prisma
// prisma/schema/base.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["prismaSchemaFolder"]
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

```prisma
// prisma/schema/user.prisma
model User {
  id        String   @id @default(cuid())
  name      String
  email     String   @unique
  role      String   @default("user")
  createdAt DateTime @default(now())
}
```

```prisma
// prisma/schema/post.prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  body      String
  published Boolean  @default(false)
  createdAt DateTime @default(now())
  authorId  String
}
```

### 5. Push schema + generate client

```bash
pnpm artisan db:push            # sync schema to the database (no migration file)
pnpm artisan db:generate        # regenerate the Prisma client
```

### 5. Register the provider

```ts
// bootstrap/providers.ts
import { database } from '@boostkit/orm-prisma'
import configs from '../config/index.js'

export default [
  database(configs.database),   // first — sets up ModelRegistry before other providers boot
  // ...other providers
]
```

`database()` handles connection, `ModelRegistry.set()`, and DI binding (`'prisma'` key) in one call.

A typical `config/database.ts`:

```ts
import { Env } from '@boostkit/support'

export default {
  default: Env.get('DB_DRIVER', 'sqlite') as 'sqlite' | 'postgresql' | 'libsql',
  connections: {
    sqlite:     { driver: 'sqlite'     as const, url: Env.get('DATABASE_URL', 'file:./dev.db') },
    postgresql: { driver: 'postgresql' as const, url: Env.get('DATABASE_URL', '') },
    libsql:     { driver: 'libsql'     as const, url: Env.get('DATABASE_URL', '') },
  },
}
```

---

## Drizzle Setup

### 1. Install

```bash
pnpm add @boostkit/orm @boostkit/orm-drizzle drizzle-orm
pnpm add -D drizzle-kit
```

Then install the driver for your database:

```bash
# SQLite
pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3

# PostgreSQL
pnpm add postgres

# libSQL / Turso
pnpm add @libsql/client
```

### 2. Define your schema

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

export const posts = sqliteTable('posts', {
  id:        text('id').primaryKey(),
  title:     text('title').notNull(),
  body:      text('body').notNull(),
  published: integer('published', { mode: 'boolean' }).notNull().default(false),
  authorId:  text('author_id').notNull(),
  createdAt: text('created_at').notNull(),
})
```

### 3. Configure drizzle-kit

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema:    './database/schema.ts',
  out:       './database/migrations',
  dialect:   'sqlite',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'file:./dev.db' },
})
```

### 4. Push schema + generate

```bash
pnpm exec drizzle-kit push      # sync schema to the database (no migration file)
```

### 5. Register the provider

```ts
// app/Providers/DatabaseServiceProvider.ts
import { ServiceProvider } from '@boostkit/core'
import { drizzle } from '@boostkit/orm-drizzle'
import { ModelRegistry } from '@boostkit/orm'
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
  DatabaseServiceProvider,   // first — sets up ModelRegistry
  // ...other providers
]
```

---

## Defining Models

All models extend `Model` from `@boostkit/orm`:

```ts
import { Model } from '@boostkit/orm'

export class User extends Model {
  // Required: maps to the adapter-specific table/accessor
  static table = 'user'

  // Optional: primary key column (default: 'id')
  static primaryKey = 'id'

  // Optional: fields excluded from toJSON() output
  static hidden: string[] = ['password']

  // Optional: fields allowed for mass assignment
  static fillable: string[] = ['name', 'email', 'role']

  // Property declarations — define the shape of your data
  id!:        string
  name!:      string
  email!:     string
  role!:      string
  createdAt!: Date
}
```

### `static table` — adapter mapping

The `table` value means different things per adapter:

| Adapter | `static table` value | Reason |
|---|---|---|
| **Prisma** | Lowercase Prisma model name | Prisma accessor is the model name in camelCase/lowercase — `model User` → `prismaClient.user` |
| **Drizzle** | Key in the `tables: {}` object | The string key you used when registering tables with the adapter |

```ts
// Prisma: model User → accessor 'user'
static table = 'user'

// Prisma: model BlogPost → accessor 'blogPost'
static table = 'blogPost'

// Drizzle: tables: { post: postsTable }
static table = 'post'
```

If `static table` is not set, it defaults to the lowercase class name + `s` (e.g. `User` → `users`). Always set it explicitly to avoid surprises.

---

## Querying Models

### Fetch all records

```ts
const users = await User.all()
```

### Find by primary key

```ts
const user = await User.find('clx1234...')
// returns User | null
```

### Filter with where

```ts
// Equality
const admins = await User.where('role', 'admin').get()

// Operator form
const recent = await User.where('createdAt', '>', new Date('2024-01-01')).get()

// Chain filters
const result = await User
  .where('role', 'admin')
  .where('name', 'like', 'A%')
  .orderBy('createdAt', 'DESC')
  .limit(10)
  .get()

// First match
const alice = await User.where('email', 'alice@example.com').first()
```

### Create a record

```ts
const user = await User.create({
  id:    crypto.randomUUID(),
  name:  'Alice',
  email: 'alice@example.com',
  role:  'user',
})
```

### Update a record

```ts
const updated = await User.query().update('clx1234...', { role: 'admin' })
```

### Delete a record

```ts
await User.query().delete('clx1234...')
```

### Pagination

```ts
const page = await User.where('role', 'user').paginate(1, 20)

console.log(page.data)        // User[] — up to 20 records
console.log(page.total)       // total matching records
console.log(page.currentPage) // 1
console.log(page.lastPage)    // total pages
```

### Count

```ts
const total = await User.query().count()
```

---

## Unified Database Commands

BoostKit provides a unified set of artisan commands that work with both Prisma and Drizzle. The commands auto-detect which ORM is in use and delegate to the appropriate tool.

```bash
pnpm artisan migrate              # run pending migrations
pnpm artisan migrate:fresh        # drop all tables + re-migrate from scratch
pnpm artisan migrate:status       # show migration status
pnpm artisan make:migration <name> # create a new migration file
pnpm artisan db:push              # push schema directly (no migration file)
pnpm artisan db:generate          # regenerate client (Prisma only)
```

Under the hood, each command maps to the native ORM tool:

| Artisan Command | Prisma Equivalent | Drizzle Equivalent |
|---|---|---|
| `migrate` | `prisma migrate deploy` | `drizzle-kit migrate` |
| `migrate:fresh` | `prisma migrate reset` | drop all + `drizzle-kit migrate` |
| `migrate:status` | `prisma migrate status` | `drizzle-kit status` |
| `make:migration <name>` | `prisma migrate dev --name <name>` | `drizzle-kit generate` |
| `db:push` | `prisma db push` | `drizzle-kit push` |
| `db:generate` | `prisma generate` | *(no-op)* |

**Typical development workflow:**

```bash
# 1. Edit your schema files (prisma/schema/*.prisma or database/schema.ts)

# 2a. Quick sync (no history, good for local iteration)
pnpm artisan db:push

# 2b. OR create a tracked migration (use this when the change is ready)
pnpm artisan make:migration add_published_to_posts

# 3. Regenerate the client after schema changes (Prisma only)
pnpm artisan db:generate
```

**Production deployment:**

```bash
# Apply all pending migrations — safe to run in CI/CD
pnpm artisan migrate
```

Migration files are stored in `prisma/migrations/` (Prisma) or the `out` directory from `drizzle.config.ts` (Drizzle), and should be committed to version control.

---

## Schema Publishing

BoostKit packages that require database tables can publish their own schema files into your project. This keeps package schemas separate from your application schemas while still allowing Prisma's multi-file schema to merge them all.

```bash
pnpm artisan vendor:publish --tag=auth-schema          # publishes prisma/schema/auth.prisma
pnpm artisan vendor:publish --tag=notification-schema   # publishes prisma/schema/notification.prisma
```

After publishing, run `pnpm artisan db:push` or `pnpm artisan make:migration` to apply the new tables.

---

## Legacy Prisma/Drizzle Commands

You can still use the native Prisma and Drizzle CLI commands directly if you prefer, but the unified artisan commands are recommended for consistency.

### Prisma (direct)

| Command | When to use |
|---|---|
| `pnpm exec prisma db push` | Development — sync schema instantly |
| `pnpm exec prisma migrate dev` | Development — create a named migration + apply |
| `pnpm exec prisma migrate deploy` | Production — apply pending migrations |
| `pnpm exec prisma migrate reset` | Development — drop + re-migrate |

### Drizzle (direct)

| Command | When to use |
|---|---|
| `pnpm exec drizzle-kit push` | Development — sync schema instantly |
| `pnpm exec drizzle-kit generate` | Generate a migration SQL file |
| `pnpm exec drizzle-kit migrate` | Apply pending migrations |

---

## Seeding

Define seed commands using the artisan registry in `routes/console.ts`:

```ts
import { artisan } from '@boostkit/artisan'
import { User } from '../app/Models/User.js'
import { Post } from '../app/Models/Post.js'

artisan.command('db:seed', async () => {
  const alice = await User.create({
    id:    crypto.randomUUID(),
    name:  'Alice',
    email: 'alice@example.com',
    role:  'admin',
  })

  await Post.create({
    id:       crypto.randomUUID(),
    title:    'Hello World',
    body:     'My first post.',
    authorId: alice.id,
  })

  console.log('Database seeded.')
}).description('Seed the database with sample data')
```

Run it:

```bash
pnpm artisan db:seed
```

---

## Notes

- Always place the database provider **first** in `bootstrap/providers.ts` — other providers that query models depend on `ModelRegistry` being set during the boot phase.
- Run `pnpm exec prisma generate` after every schema change — the TypeScript types in your app will be stale until you regenerate the client.
- For Prisma, `static table` must match the **Prisma accessor name** — the lowercase version of the model name, not the table name in the database. `model BlogPost` → `blogPost`, not `blog_posts`.
- For Drizzle, `static table` must match the **key** in the `tables: {}` object you pass to `drizzle()`. The key can be anything, but keep it consistent with model names.
- In production, always use tracked migrations (`prisma migrate deploy` / `drizzle-kit migrate`) rather than push commands — push can cause data loss on destructive changes.
