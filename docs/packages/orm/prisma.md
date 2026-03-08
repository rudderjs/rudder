# @boostkit/orm-prisma

Prisma-backed ORM adapter for BoostKit.

## Installation

```bash
pnpm add @boostkit/orm-prisma @prisma/client
```

After adding Prisma, initialise the schema and generate the client:

```bash
pnpm exec prisma init          # creates prisma/schema.prisma and .env
pnpm exec prisma db push       # sync schema to database (dev, no migration file)
pnpm exec prisma generate      # regenerate the Prisma client after schema changes
```

## `database()` (Recommended)

The simplest way to wire Prisma is the `database()` factory. It handles connection, ModelRegistry setup, and DI binding in one call:

```ts
// bootstrap/providers.ts
import { database } from '@boostkit/orm-prisma'
import configs from '../config/index.js'

export default [
  database(configs.database),  // connect + ModelRegistry.set() + bind 'prisma' to DI
  // ...
]
```

`database()` binds the raw `PrismaClient` to the DI container as `'prisma'`. This lets `auth()` from `@boostkit/auth` auto-discover it — no need to pass database config to `auth()` separately.

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

## DatabaseServiceProvider

Wire the adapter in your `DatabaseServiceProvider`:

```ts
import { ServiceProvider } from '@boostkit/core'
import { prisma } from '@boostkit/orm-prisma'
import { ModelRegistry } from '@boostkit/orm'

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
| `driver` | `'postgresql' \| 'sqlite' \| 'libsql'` | auto-detected from `DATABASE_URL` | Explicit driver hint |
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

### `database(config)`

The high-level factory for `bootstrap/providers.ts`. Accepts the same config shape as `prisma()` but returns a `ServiceProvider` class that handles the full lifecycle:

```ts
import { database } from '@boostkit/orm-prisma'

export default [
  database({ driver: 'sqlite', url: 'file:./dev.db' }),
]
```

On `boot()`, it:
1. Creates and connects a `PrismaClient`
2. Calls `ModelRegistry.set(adapter)` so all `Model.*` static methods work
3. Binds the raw `PrismaClient` to DI as `'prisma'` (used by `auth()`)

### `prisma(config?)`

Returns an `OrmAdapterProvider` with a single `create()` method that resolves the Prisma client and returns a live `OrmAdapter`.

```ts
import { prisma } from '@boostkit/orm-prisma'

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

The BoostKit `User` model sets `static table = 'user'` to match the Prisma accessor name (lowercase model name):

```ts
import { Model } from '@boostkit/orm'

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

- `@prisma/client` is a required peer dependency — install it alongside `@boostkit/orm-prisma`.
- Run `pnpm exec prisma generate` from the project root (or `playground/`) whenever you change `schema.prisma`.
- Use `pnpm exec prisma db push` during development to sync schema changes to the database without creating migration files.
- Use `pnpm exec prisma migrate dev` when you want tracked migration files for production deployments.
- The `static table` on a Model must match the Prisma accessor name. Single-word models are lowercase (e.g. model `User` → accessor `user`). Multi-word models use camelCase (e.g. model `BlogPost` → accessor `blogPost`). Always verify the accessor against the generated `PrismaClient` type.
