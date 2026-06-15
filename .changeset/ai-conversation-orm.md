---
"@rudderjs/ai": minor
---

Add a first-party ORM-backed `ConversationStore` at `@rudderjs/ai/conversation-orm`.

`@rudderjs/ai` previously shipped only `MemoryConversationStore`, which is in-process and loses every thread on restart, so any production consumer had to hand-roll persistence against the `ConversationStore` interface. `OrmConversationStore` persists conversation threads and their messages through the registered `@rudderjs/orm` adapter (native, Prisma, or Drizzle), so threads survive restarts and are shared across web processes and queue workers. It mirrors the existing `@rudderjs/ai/memory-orm` and `@rudderjs/ai/budget-orm` pattern.

```ts
import { setConversationStore } from '@rudderjs/ai'
import { OrmConversationStore } from '@rudderjs/ai/conversation-orm'

setConversationStore(new OrmConversationStore())
```

Exports `OrmConversationStore`, the `ormConversationStore()` factory, the `AiConversationRecord` / `AiConversationMessageRecord` Models (for admin queries), and the `conversationOrmPrismaSchema` reference to copy into your schema. Messages carry a monotonic per-thread position so `load()` returns them in append order; `content` and `toolCalls` are JSON-encoded into portable text columns.
