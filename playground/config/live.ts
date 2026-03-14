import { Env } from '@boostkit/core'
import type { LiveConfig } from '@boostkit/live'

export default {
  path: Env.get('LIVE_PATH', '/ws-live'),

  // Server-side persistence (default: in-memory, resets on restart)
  // persistence: liveRedis({ url: Env.get('REDIS_URL', '') }),
  // persistence: livePrisma({ model: 'liveDocument' }),

  // Client-side providers
  providers: ['websocket', 'indexeddb'],
} satisfies LiveConfig
