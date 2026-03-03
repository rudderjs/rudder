# @forge/orm-prisma

Prisma-backed ORM adapter for Forge.

## Installation

```bash
pnpm add @forge/orm-prisma @prisma/client
```

After adding Prisma, initialise the schema and generate the client:

```bash
pnpm exec prisma init          # creates prisma/schema.prisma and .env
pnpm exec prisma db push       # sync schema to database (dev, no migration file)
pnpm exec prisma generate      # regenerate the Prisma client after schema changes
```

## DatabaseServiceProvider

Wire the adapter in your `DatabaseServiceProvider`:

```ts
import { ServiceProvider } from '@forge/core'
import { prisma } from '@forge/orm-prisma'
import { ModelRegistry } from '@forge/orm'

export class DatabaseServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    const adapter = await prisma().create()
    await adapter.connect()
    ModelRegistry.set(adapter)
    this.app.instance('db', adapter)
  }
}
```

Register it first in `bootstrap/providers.ts` so the registry is ready before other providers boot:

```ts
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  DatabaseServiceProvider,
  AppServiceProvider,
]
```

## PrismaConfig Options

Pass options to `prisma()` if you need to override defaults:

```ts
prisma({
  driver: 'postgresql',
  url:    'postgresql://user:pass@localhost:5432/mydb',
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `client` | `PrismaClient` | auto-created | Provide a pre-built `PrismaClient` instance |
| `driver` | `'postgresql' \| 'sqlite' \| 'mysql'` | auto-detected from `DATABASE_URL` | Explicit driver hint |
| `url` | `string` | `DATABASE_URL` env var | Database connection string |

When no `client` is provided, the adapter constructs one automatically using the `url` and `driver` values.

## Supported Drivers

| Driver | Required packages | Notes |
|---|---|---|
| `sqlite` | `better-sqlite3` | Local file-based database; ideal for development |
| `postgresql` | `pg` or native bindings | Standard PostgreSQL connection |
| `libsql` | `@libsql/client` | Turso / libSQL — compatible with SQLite schema |

The adapter auto-detects the driver from the `DATABASE_URL` scheme (`file:` → sqlite, `postgresql:`/`postgres:` → postgresql, `libsql:` → libsql) unless you set `driver` explicitly.

## API

### `prisma(config?)`

Returns an `OrmAdapterProvider` with a single `create()` method that resolves the Prisma client and returns a live `OrmAdapter`.

```ts
import { prisma } from '@forge/orm-prisma'

const provider = prisma({ driver: 'sqlite', url: 'file:./dev.db' })
const adapter  = await provider.create()
await adapter.connect()
```

## Prisma Schema Example

A minimal `prisma/schema.prisma` for SQLite:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  name      String
  email     String   @unique
  role      String   @default("user")
  createdAt DateTime @default(now())
}
```

The Forge `User` model sets `static table = 'user'` to match the Prisma accessor name (lowercase model name):

```ts
import { Model } from '@forge/orm'

export class User extends Model {
  static table = 'user'   // matches Prisma accessor — prismaClient.user

  id!: string
  name!: string
  email!: string
  role!: string
  createdAt!: Date
}
```

## Notes

- `@prisma/client` is a required peer dependency — install it alongside `@forge/orm-prisma`.
- Run `pnpm exec prisma generate` from the project root (or `playground/`) whenever you change `schema.prisma`.
- Use `pnpm exec prisma db push` during development to sync schema changes to the database without creating migration files.
- Use `pnpm exec prisma migrate dev` when you want tracked migration files for production deployments.
- The `static table` on a Model must match the Prisma accessor name, which is the lowercase version of the Prisma model name (e.g. model `User` → accessor `user`, model `BlogPost` → accessor `blogPost`).
