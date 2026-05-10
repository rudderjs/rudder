---
"@rudderjs/ai": minor
---

**A4 Phase 4 — `OrmUserMemory` production backend.** A new subpath at `@rudderjs/ai/memory-orm` ships an ORM-backed `UserMemory` that persists facts via the registered `@rudderjs/orm` adapter — drop-in alongside Phase 1's in-process `MemoryUserMemory`, but durable across restarts and queryable from outside the framework.

- `OrmUserMemory` — implements the `UserMemory` interface against the `@rudderjs/orm` `Model` API. Works on Prisma today; Drizzle works the moment the user's tables are wired (`tables: { userMemory: <table> }` on the `drizzle()` config).
- `UserMemoryRecord` — the `Model` row backing the store. Exposed so apps that want their own queries (admin views, audit dumps) don't have to route everything through the `UserMemory` interface.
- `userMemoryPrismaSchema` — exported reference Prisma schema string. Also dropped into `playground/prisma/schema/ai.prisma` for the demo. Includes a deliberately-nullable `embedding Bytes?` column so Phase 5's `EmbeddingUserMemory` lands as additive — no follow-up migration when you upgrade.
- New peer dep `@rudderjs/orm` (optional) — only consumers of the `/memory-orm` subpath pull it in.

```ts
// config/ai.ts
import { OrmUserMemory } from '@rudderjs/ai/memory-orm'
import type { AiConfig } from '@rudderjs/ai'

export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: { /* ... */ },
  memory: new OrmUserMemory(),
} satisfies AiConfig
```

**Recall semantics:** case-insensitive **OR-of-LIKE token overlap** on the `fact` column — mirrors `MemoryUserMemory.recall()` so the two backends are swap-compatible. Query tokenizes on non-alphanumeric boundaries (≥3-char tokens) and any row matching at least one token via `LIKE %tok%` is returned.

**Tags:** persist as JSON-encoded `String?`. Tag-filter recall happens JS-side after fetch — pushing array filtering into the WHERE is adapter-specific (Postgres `String[]`, SQLite JSON contains) and lands in a follow-up. Same trade-off Prisma shows you when you pick `String?` over `String[]` for portability.

19 new tests covering `remember` round-trip, `list` (insertion order, tag intersection, limit), `recall` (single-token + multi-token OR-of-LIKE, tag scope, limit, empty/no-match), `forget` (owner check + idempotent on unknown id), `forgetAll`, plus `UserMemoryRecord.getTags()` JSON parsing edge cases and the schema snapshot. Test fixture is a Map-backed in-process adapter that satisfies the `OrmAdapter` interface — no real DB required.
