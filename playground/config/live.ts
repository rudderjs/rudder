import { Env } from '@boostkit/core'
import { livePrisma } from '@boostkit/live'
import type { LiveConfig } from '@boostkit/live'

export default {
  path: Env.get('LIVE_PATH', '/ws-live'),

  // Server-side persistence — Y.Docs survive server restarts
  persistence: livePrisma(),

  // Client-side providers
  providers: ['websocket', 'indexeddb'],
} satisfies LiveConfig
