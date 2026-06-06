import { Env } from '@rudderjs/core'
import { syncDatabase } from '@rudderjs/sync'
import type { SyncConfig } from '@rudderjs/sync'

export default {
  path: Env.get('SYNC_PATH', '/ws-sync'),

  // Server-side persistence: the native engine's syncDocument table (see
  // database/migrations/0001_01_01_000600). Rides the app's existing ORM
  // adapter — no second connection. playground-prisma uses syncPrisma()
  // against the same table layout.
  persistence: syncDatabase(),

  // Client-side providers
  providers: ['websocket', 'indexeddb'],
} satisfies SyncConfig
