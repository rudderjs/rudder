# @rudderjs/orm-prisma

Prisma adapter for `@rudderjs/orm`.

```bash
pnpm add @rudderjs/orm-prisma @prisma/client prisma
```

> Picking a generator? RudderJS supports both Prisma generator paths:
>
> | Generator | Schema declaration | When to use |
> |---|---|---|
> | `prisma-client-js` (legacy default) | `provider = "prisma-client-js"` | Standard Node.js apps that don't care about the engine binary download |
> | `prisma-client` (Prisma 7+, recommended) | `provider = "prisma-client"` + custom `output` path | Self-contained ESM client, no engine binaries downloaded at install time. **Required** for WebContainer / StackBlitz / Bolt.new and other browser-sandboxed runtimes — the legacy generator's `prisma generate` postinstall fails because `binaries.prisma.sh` doesn't ship CORS headers. See [Prisma's docs](https://www.prisma.io/docs/orm/prisma-schema/overview/generators) for the output structure. |

---

## Setup

### Option A — Legacy `prisma-client-js` generator

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
}
```

```ts
// config/database.ts
import { Env } from '@rudderjs/support'

export default {
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite',
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },
  },
}
```

The framework loads `PrismaClient` from `@prisma/client` automatically.

### Option B — New `prisma-client` generator (Prisma 7+)

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

The new generator emits a self-contained ESM client at the configured `output` path. Pass the generated `PrismaClient` class explicitly so the adapter doesn't fall back to importing `@prisma/client`:

```ts
// config/database.ts
import { Env } from '@rudderjs/support'
import { PrismaClient } from '../prisma/generated/prisma/client.js'

export default {
  default: 'sqlite',
  PrismaClient,
  connections: {
    sqlite: {
      driver: 'sqlite',
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },
  },
}
```

Add a `postinstall` script so fresh clones generate the client automatically, and gitignore `prisma/generated/` — the path is reproducible from the schema:

```json
{
  "scripts": {
    "postinstall": "prisma generate"
  }
}
```

### Wiring the provider

```ts
// bootstrap/providers.ts
import { database } from '@rudderjs/orm-prisma'
import configs from '../config/index.js'

export default [database(configs.database)]
```

The `database()` provider connects to the database on boot, registers the adapter with `ModelRegistry`, and binds it to the DI container as `'db'` and `'prisma'`.

---

## Drivers

| Driver | Optional dependency |
|---|---|
| `sqlite` (default) | `better-sqlite3` + `@prisma/adapter-better-sqlite3` |
| `postgresql` | `pg` + `@prisma/adapter-pg` |
| `libsql` | `@libsql/client` + `@prisma/adapter-libsql` |

Install only the driver you need:

```bash
# SQLite
pnpm add better-sqlite3 @prisma/adapter-better-sqlite3

# PostgreSQL
pnpm add pg @prisma/adapter-pg

# LibSQL / Turso
pnpm add @libsql/client @prisma/adapter-libsql
```

---

## Manual Usage

```ts
import { prisma } from '@rudderjs/orm-prisma'
import { ModelRegistry } from '@rudderjs/orm'

const adapter = await prisma({ driver: 'sqlite', url: 'file:./dev.db' }).create()
await adapter.connect()
ModelRegistry.set(adapter)
```

---

## `PrismaConfig`

| Option | Type | Description |
|---|---|---|
| `client` | `PrismaClient` | Pre-built Prisma client instance — bypasses all driver logic |
| `PrismaClient` | `PrismaClient` class | Constructor reference — required for the new `prisma-client` generator since the adapter can't find the class via `import('@prisma/client')`. The adapter calls `new PrismaClient({ adapter, log })` internally. |
| `driver` | `'sqlite' \| 'postgresql' \| 'libsql' \| 'mysql'` | Database driver |
| `url` | `string` | Connection URL |

---

## `DatabaseConfig`

| Option | Type | Description |
|---|---|---|
| `default` | `string` | Key of the default connection |
| `connections` | `Record<string, { driver, url? }>` | Named connection configs |

---

## Query Builder

All queries go through `Model.query()` which returns a `QueryBuilder`. Methods are chainable and the query is executed lazily on the terminal call.

```ts
// AND conditions
const users = await User.query()
  .where('role', 'admin')
  .where('createdAt', '>=', new Date('2024-01-01'))
  .orderBy('name', 'ASC')
  .get()

// OR conditions — orWhere adds to a separate OR clause
const results = await Article.query()
  .where('title', 'LIKE', '%typescript%')    // AND (title LIKE ...)
  .orWhere('body', 'LIKE', '%typescript%')   // OR (body LIKE ...)
  .limit(10)
  .get()

// Paginated
const page = await User.query()
  .where('role', 'admin')
  .orderBy('createdAt', 'DESC')
  .paginate(1, 15)
// → { data, total, perPage, currentPage, lastPage, from, to }
```

| Method | Description |
|---|---|
| `.where(col, value)` | AND `col = value` |
| `.where(col, op, value)` | AND `col op value` — operators: `=` `!=` `>` `>=` `<` `<=` `LIKE` `IN` `NOT IN` |
| `.orWhere(col, value)` | OR `col = value` |
| `.orWhere(col, op, value)` | OR `col op value` — same operators as `where` |
| `.orderBy(col, dir?)` | `ORDER BY col ASC\|DESC` |
| `.limit(n)` | Limit rows returned |
| `.offset(n)` | Skip rows |
| `.with(...relations)` | Eager-load Prisma relations |
| `.get()` | Execute — returns `T[]` (applies WHERE, ORDER, LIMIT, OFFSET) |
| `.all()` | Execute — returns `T[]` (applies WHERE, ORDER, LIMIT, OFFSET) |
| `.first()` | Execute — returns first match or `null` |
| `.find(id)` | Fetch by primary key — returns `T \| null` |
| `.count()` | Returns `number` of matching rows |
| `.paginate(page, perPage?)` | Returns `PaginatedResult<T>` |

> **`LIKE` with Prisma**: pass SQL-style wildcards (`%value%`). The adapter strips them and maps to Prisma's `contains`, `startsWith`, or `endsWith` filter automatically.

> **`orWhere` semantics**: multiple `orWhere` calls are combined as Prisma `OR: [...]`. `where` calls are combined as top-level AND conditions. The two compose naturally: `WHERE (and1 AND and2 AND ...) AND (OR: [or1, or2, ...])`.

---

## Notes

- Run `pnpm exec prisma generate` after any schema change. If you forget, RudderJS throws a clear error: `Prisma has no delegate for table "x". Did you run prisma generate?`
- The `client` option takes precedence — driver/url are ignored when a client is provided.
- The adapter is bound in the DI container as `'db'` (OrmAdapter) and `'prisma'` (raw PrismaClient).
