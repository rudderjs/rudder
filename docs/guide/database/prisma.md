# Prisma Adapter

`@rudderjs/orm-prisma` is the Prisma-backed adapter for `@rudderjs/orm`. It wraps a `PrismaClient`, registers itself with `ModelRegistry`, and binds the raw client into the DI container so other packages (`@rudderjs/auth`, `@rudderjs/notification`) can consume it without further wiring.

## Install

```bash
pnpm add @rudderjs/orm @rudderjs/orm-prisma @prisma/client
pnpm add -D prisma
```

::: tip Prisma 7+ — pick a generator
Prisma 7 ships two client generators. Rudder supports both, but they're not interchangeable in browser-sandboxed environments:

| Generator | Schema declaration | When to use |
|---|---|---|
| `prisma-client-js` (legacy default) | `provider = "prisma-client-js"` | Standard Node.js apps. The framework imports `PrismaClient` from `@prisma/client` automatically. |
| `prisma-client` (Prisma 7+) | `provider = "prisma-client"` + custom `output` | Self-contained ESM client, **no engine binaries** downloaded by `prisma generate`. **Required** for WebContainer / StackBlitz / Bolt.new — the legacy generator's postinstall fails because `binaries.prisma.sh` doesn't ship CORS headers. |

The new-generator setup is documented under [Browser-sandboxed runtimes (WebContainer)](#browser-sandboxed-runtimes-webcontainer) below.
:::

For SQLite (local development) also install:

```bash
pnpm add better-sqlite3 @prisma/adapter-better-sqlite3
pnpm add -D @types/better-sqlite3
```

| Driver | Required packages | Notes |
|---|---|---|
| `sqlite` | `better-sqlite3` | Local file-based database; default for development |
| `postgresql` | `pg` or native bindings | Standard PostgreSQL |
| `mysql` | `mysql2` | MySQL / MariaDB |
| `libsql` | `@libsql/client` | Turso / libSQL — SQLite-compatible schema |

The adapter auto-detects the driver from the `DATABASE_URL` scheme (`file:` → sqlite, `postgresql:` → postgresql, `mysql:` → mysql, `libsql:` → libsql) unless you set `driver` explicitly.

MySQL uses `@prisma/adapter-mariadb` under the hood (wire-compatible with both MySQL 5.7+ and MariaDB 10.x), so a single `'mysql'` driver value covers both engines. Install the adapter once: `pnpm add mariadb @prisma/adapter-mariadb`. Available in `@rudderjs/orm-prisma` 1.8.0+.

## Multi-file schema

Rudder uses Prisma's multi-file schema feature: instead of one `prisma/schema.prisma`, schemas live in `prisma/schema/*.prisma`. Each concern gets its own file, and packages can publish their own schema shards.

```
prisma/
├── schema/
│   ├── base.prisma           # generator + datasource
│   ├── user.prisma           # User model
│   ├── auth.prisma           # published by @rudderjs/auth
│   └── notification.prisma   # published by @rudderjs/notification
└── prisma.config.ts          # points to prisma/schema/
```

```ts
// prisma.config.ts
import path from 'node:path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema'),
})
```

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

After editing the schema:

```bash
pnpm rudder db:push        # sync to database
pnpm rudder db:generate    # regenerate the Prisma client
```

## Register the provider

`DatabaseProvider` handles connection, `ModelRegistry.set()`, and DI binding:

```ts
// bootstrap/providers.ts
import { DatabaseProvider } from '@rudderjs/orm-prisma'

export default [
  DatabaseProvider,    // first
  // ...other providers
]
```

`DatabaseProvider` binds the raw `PrismaClient` to DI as `'prisma'` so other packages (`@rudderjs/auth`, `@rudderjs/notification`) can auto-discover it. Auto-discovery picks up `DatabaseProvider` automatically when `@rudderjs/orm-prisma` is installed — the explicit import is only needed when you skip auto-discovery.

## The `User` model

```ts
import { Model } from '@rudderjs/orm'

export class User extends Model {
  static table = 'user'   // matches the Prisma accessor — prismaClient.user

  id!: string
  name!: string
  email!: string
  role!: string
  createdAt!: Date
}
```

`static table` is **the Prisma accessor**, not the SQL table name:

| Prisma model | Accessor (`static table`) |
|---|---|
| `model User` | `'user'` |
| `model BlogPost` | `'blogPost'` |
| `model Customer @@map("customers")` | `'customer'` (the model name, not the `@@map` value) |

## Cross-repo client (advanced)

For cross-repo workspaces where `@prisma/client` is generated in a different package, pass a pre-built client via the `PrismaClient` option:

```ts
import { PrismaClient } from '@my-org/database'
import { database } from '@rudderjs/orm-prisma'

database({
  ...configs.database,
  PrismaClient,       // forwarded to the adapter
})
```

This is the path the Pilotiq playgrounds use to consume their own generated client across pnpm-linked workspaces.

## Browser-sandboxed runtimes (WebContainer)

To boot a Rudder app inside StackBlitz / Bolt.new / any WebContainer-backed environment, switch to Prisma 7's new `prisma-client` generator. The legacy `prisma-client-js` generator is incompatible with WebContainer because its `prisma generate` step downloads the schema-engine binary from `https://binaries.prisma.sh`, which doesn't ship CORS headers — the install hangs with `socket hang up`.

The new generator emits a self-contained ESM client with no engine binary downloads at install time:

```prisma
// prisma/schema/base.prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"   // relative to schema file → prisma/generated/prisma/
  runtime      = "nodejs"
  moduleFormat = "esm"
}

datasource db {
  provider = "sqlite"
}
```

Pass the generated `PrismaClient` class via the database config (the framework can't find it at `@prisma/client` since the new generator emits to a custom path):

```ts
// config/database.ts
import { Env } from '@rudderjs/support'
import { PrismaClient } from '../prisma/generated/prisma/client.js'

export default {
  default: 'libsql',
  PrismaClient,
  connections: {
    libsql: {
      driver: 'libsql' as const,
      url:    Env.get('DATABASE_URL', 'file:./prisma/dev.db'),
    },
  },
}
```

```json
// package.json
{
  "scripts": {
    "postinstall": "prisma generate"
  }
}
```

Add `prisma/generated/` to `.gitignore` — the path is reproducible from the schema and regenerated on every `pnpm install`.

Pair the new generator with a JS driver adapter (`@prisma/adapter-libsql` + `@libsql/client`) so SQL execution stays in pure JS. The Rust query engine is never loaded; the WASM query compiler shipped in `@prisma/client/runtime/client` handles query planning at request time.

For the canonical reference, see the `playground-web/` variant in the framework repo — a sibling of `playground/` that runs end-to-end inside StackBlitz.

## Upgrading to `@rudderjs/orm-prisma@2.0`

The 2.0 release changes the precedence semantics of mixed `.where()` + `.orWhere()` chains. The 1.x adapter constrained every `.orWhere()` alternative by the prior AND chain — opposite of Eloquent and out of step with `@rudderjs/orm-drizzle`. The 2.0 adapter emits the Laravel-parity shape, so the same chain now means what it syntactically looks like:

```ts
Post.where('a').where('b').orWhere('c').get()
// 1.x on Prisma:  WHERE a AND b AND c          ← constrained, often 0 rows
// 2.0 on Prisma:  WHERE (a AND b) OR c          ← Laravel parity
```

This affects both regular queries and vector-search queries built with `whereVectorSimilarTo()`. AND-only chains and OR-only chains are unaffected — only mixed AND+OR queries change.

If you rely on the 1.x behaviour for a specific query, restructure it with `whereGroup`:

```ts
// 2.0 equivalent of the 1.x constrained semantics:
Post.where('a').where('b').whereGroup(g => g.orWhere('c')).get()
```

There is no compatibility flag — the long-deprecation strategy is the major-version bump itself. Apps still on `@rudderjs/orm-prisma@1.x` keep the legacy behaviour until they upgrade. See [Precedence in mixed `where` + `orWhere` chains](/guide/database/models#precedence-in-mixed-where-orwhere-chains) for the full semantics + edge cases (soft-delete interaction, nested `whereGroup`).

## Pitfalls

- **`Prisma has no delegate for table "x"`.** You set `static table` to the SQL table name (e.g. `'oauth_clients'`) instead of the accessor (`'oAuthClient'`). Use the accessor.
- **Stale client after schema edit.** Run `pnpm rudder db:generate`. TypeScript types in your app go stale until the client is regenerated.
- **`db:push` in production.** Push can drop columns silently. Use `pnpm rudder migrate` (which delegates to `prisma migrate deploy`) for tracked migrations.
- **Multi-file schema not detected.** Confirm `previewFeatures = ["prismaSchemaFolder"]` is in your generator block, and that `prisma.config.ts` points to the directory.
