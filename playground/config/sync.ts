import { Env } from '@rudderjs/core'
import type { SyncConfig } from '@rudderjs/sync'

export default {
  path: Env.get('SYNC_PATH', '/ws-sync'),

  // Server-side persistence: in-memory (the default — docs reset on restart).
  // The persistence adapters are `syncPrisma()` (see playground-prisma) and
  // `syncRedis()`; there is no native-engine adapter yet, so the native
  // playground runs without durable sync persistence.
  // TODO(follow-up): ORM-agnostic sync persistence over the Model API so the
  // native engine can back it too.

  // Client-side providers
  providers: ['websocket', 'indexeddb'],
} satisfies SyncConfig
