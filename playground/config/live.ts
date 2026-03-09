import { Env } from '@boostkit/core'
import type { LiveConfig } from '@boostkit/live'

export default {
  path: Env.get('LIVE_PATH', '/ws-live'),

  // persistence: liveRedis({ url: Env.get('REDIS_URL', '') }),
  // persistence: livePrisma({ model: 'liveDocument' }),
} satisfies LiveConfig
