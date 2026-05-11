# @rudderjs/orm-drizzle

## Overview

Drizzle ORM adapter implementing the `OrmAdapter` contract from `@rudderjs/orm`. Drizzle is schema-first: tables are defined in TypeScript with `pgTable` / `sqliteTable` and the adapter compiles `@rudderjs/orm` query-builder calls into Drizzle's fluent API. Supports SQLite (`better-sqlite3`, `libsql`) and PostgreSQL (`postgres-js`, `node-postgres`).

## Key Patterns

### Configure (`config/database.ts`)

```ts
import type { DatabaseConfig } from '@rudderjs/orm-drizzle'
import { users, posts } from '../drizzle/schema.js'

export default {
  default: 'pg',
  connections: {
    pg: {
      driver: 'drizzle',
      dialect: 'postgres-js',
      url:     Env.get('DATABASE_URL', 'postgres://localhost/app'),
    },
  },
  tables: { users, posts },     // register every table you'll query against
} satisfies DatabaseConfig
```

`DatabaseProvider` is auto-discovered. Boot calls `ModelRegistry.set(new DrizzleAdapter(config))`.

### Register tables outside config

For tables only used at runtime (modules, dynamic loaders), register via the global registry:

```ts
import { DrizzleTableRegistry } from '@rudderjs/orm-drizzle'
import { auditLogs } from './drizzle/audit.js'

DrizzleTableRegistry.register('auditLogs', auditLogs)
```

Every table referenced by `whereHas` / `withCount` / model `static table` must be registered — otherwise the adapter throws with the missing table name.

### Vector queries

```ts
await Embedding.query()
  .whereVectorSimilarTo('embedding', queryVec, { limit: 5 })
  .all()
```

Routes through raw SQL using pgvector's `<=>` operator. Drizzle's fluent API doesn't expose pgvector operators directly, so the adapter shells out to `db.execute()` under the hood.

### Soft deletes

```ts
export class Post extends Model { static softDeletes = true }
```

The adapter applies `WHERE deletedAt IS NULL` automatically on every read path. `withTrashed()` / `onlyTrashed()` disable / invert it.

## Common Pitfalls

- **`.with('relation')` is a no-op on Drizzle**: Drizzle's relation API requires pre-declared relations on the table object, and the adapter has no portable way to resolve them dynamically. Load relations via separate queries or use the framework's `loadCount`/`loadSum` aggregate helpers — those route through `whereIn`-style batch SQL the adapter does support.
- **MySQL is not supported**: Drizzle's MySQL dialect doesn't implement `returning()`, which the adapter relies on. Use SQLite or Postgres.
- **`connect()` is a no-op**: Drizzle connects lazily on first query. `disconnect()` only does work on the `postgres-js` dialect. Tests that depend on a teardown step should call `client.end()` directly on the underlying driver.
- **Missing `whereHas` table**: `await Comment.whereHas('post', q => q.where('isPublished', true))` throws if the `posts` table isn't in `tables: {}` or in `DrizzleTableRegistry`. Error message names the missing table.
- **pgvector extension missing**: vector queries surface as `VectorStorageUnsupportedError` — install the extension (`CREATE EXTENSION vector;`) and re-run the migration.
- **Drizzle `eq(col, null)` never matches**: use `isNull(col)` / `isNotNull(col)` for null comparisons. The adapter does this correctly internally; only matters if you drop down to raw Drizzle SQL.

## Key Imports

```ts
import {
  drizzle,                  // factory function — registers DatabaseProvider config
  DrizzleAdapter,           // the OrmAdapter implementation (rarely instantiated directly)
  DrizzleTableRegistry,     // runtime table registration
} from '@rudderjs/orm-drizzle'

import type {
  DatabaseConfig,
  DrizzleConfig,
  DrizzleDialect,           // 'better-sqlite3' | 'libsql' | 'postgres-js' | 'node-postgres'
} from '@rudderjs/orm-drizzle'
```
