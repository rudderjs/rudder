import { Env } from '@rudderjs/core'
import { syncPrisma } from '@rudderjs/sync'
import type { SyncConfig } from '@rudderjs/sync'

export default {
  path: Env.get('SYNC_PATH', '/ws-sync'),

  // Server-side persistence — Y.Docs survive server restarts
  persistence: syncPrisma(),

  // Client-side providers
  providers: ['websocket', 'indexeddb'],
} satisfies SyncConfig
