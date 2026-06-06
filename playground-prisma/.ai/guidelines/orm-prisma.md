# @rudderjs/orm-prisma

## Overview

Prisma adapter implementing the `OrmAdapter` contract from `@rudderjs/orm`. Compiles QueryBuilder calls into Prisma's fluent client. Supports both the legacy `prisma-client-js` generator and the new self-contained `prisma-client` generator (Prisma 7+). Uses Prisma's native `include` for eager loading, falls back to second-batch lookups for polymorphic / pivot relations.

## Key Patterns

### Configure (`config/database.ts`)

```ts
import type { DatabaseConfig } from '@rudderjs/orm-prisma'

export default {
  default: 'primary',
  connections: {
    primary: {
      driver: 'prisma',
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },
  },
} satisfies DatabaseConfig
```

`DatabaseProvider` is auto-discovered. Boot wires `ModelRegistry.set(new PrismaAdapter(config))`.

### Prisma 7+ "new generator"

The new `prisma-client` generator emits a fully-typed client into your project. Pass it explicitly:

```ts
// config/database.ts
import { PrismaClient } from '../prisma/generated/client/index.js'

export default {
  default: 'primary',
  connections: {
    primary: { driver: 'prisma', PrismaClient, url: Env.get('DATABASE_URL', '...') },
  },
} satisfies DatabaseConfig
```

Add `"postinstall": "prisma generate"` to `package.json` so fresh clones auto-generate.

The legacy `prisma-client-js` generator auto-discovers `@prisma/client` — no explicit class needed.

### Eager loading

```ts
await Post.with('author', 'comments').all()                     // include: { author: true, comments: true }
await Post.with({ author: q => q.where('isActive', true) }).all() // include with where
await Post.withWhereHas('comments', q => q.where('flagged', true)).all()
```

Direct relations (`hasMany`/`hasOne`/`belongsTo`) need an `@relation` declared in `schema.prisma` with the same name. Polymorphic and pivot relations route through 2-step lookup so they work without a Prisma-declared relation.

### Vector queries (pgvector)

```ts
await Embedding.query()
  .whereVectorSimilarTo('embedding', queryVec, { limit: 5 })
  .all()
```

The adapter switches to a raw SQL path when vector queries are present. **Combining vector queries with grouped conditions (`whereGroup` / `whereHas`) throws** — keep them flat.

### Telescope integration

The adapter listens to Prisma's `$on('query', …)` and emits duration + model context to `queryObservers`. `@rudderjs/telescope`'s `QueryCollector` consumes it automatically when both packages are installed.

## Common Pitfalls

- **`Prisma has no delegate for table "X"`**: schema changed, client wasn't regenerated. Run `pnpm exec prisma generate` after any `schema.prisma` change.
- **`static table` must be the Prisma client delegate, not the `@@map`'d SQL name**: use `oAuthClient` (camelCase of model name), not `oauth_clients`.
- **`whereHas` on a Prisma relation that isn't declared in schema**: throws. Add `@relation` to `schema.prisma`. Polymorphic / pivot relations don't need this — they route differently.
- **Multiple `.withCount('rel')` on the same relation lose all but the last**: Prisma's `_count.select.{relation}` is a flat object. Use distinct aliases if you need both: `.withCount('comments as commentCount').withCount('comments as activeCommentCount', q => q.where('active', true))`.
- **`morphTo` cannot be used with `whereHas`**: the related table is dynamic. Filter on `{morphName}Id` / `{morphName}Type` directly.
- **New generator `PrismaClient` must be imported, not auto-discovered**: the legacy generator works without the explicit import; new generator doesn't.

## Key Imports

```ts
import {
  prisma,                  // factory — returns DatabaseServiceProvider class
  PrismaAdapter,           // OrmAdapter implementation (rarely needed directly)
  DatabaseProvider,        // service provider class
} from '@rudderjs/orm-prisma'

import type {
  DatabaseConfig,
  PrismaConfig,
} from '@rudderjs/orm-prisma'
```
