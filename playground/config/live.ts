import { Env } from '@rudderjs/core'
import { livePrisma } from '@rudderjs/live'
import type { LiveConfig } from '@rudderjs/live'

export default {
  path: Env.get('LIVE_PATH', '/ws-live'),

  // Server-side persistence — Y.Docs survive server restarts
  persistence: livePrisma(),

  // Client-side providers
  providers: ['websocket', 'indexeddb'],
} satisfies LiveConfig
