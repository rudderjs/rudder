---
"@rudderjs/sanctum": minor
---

Add `OrmTokenRepository`, a durable ORM-backed token store, from the new `@rudderjs/sanctum/orm` subpath. Previously only the in-memory `MemoryTokenRepository` shipped, so every production app had to write its own persistence layer before issuing real tokens.

`OrmTokenRepository` is a drop-in `TokenRepository` backed by a `PersonalAccessTokenModel` (string ULID primary key) that runs unchanged on the native engine, Prisma, and Drizzle. `@rudderjs/orm` is an optional peer dependency — install it only when you opt into durable storage. Pass an instance as the second argument to `sanctum()`:

```ts
import { sanctum } from '@rudderjs/sanctum'
import { OrmTokenRepository } from '@rudderjs/sanctum/orm'

export default [auth(configs.auth), sanctum(config, new OrmTokenRepository())]
```

See the README for the matching migration.
