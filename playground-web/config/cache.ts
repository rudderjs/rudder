import { Env } from '@rudderjs/core'
import { isWebContainer } from '@rudderjs/support'
import type { CacheConfig } from '@rudderjs/cache'

// In WebContainer, native Redis (raw TCP) doesn't work — fall back to memory.
const defaultStore = isWebContainer() ? 'memory' : Env.get('CACHE_STORE', 'memory')

export default {
  default: defaultStore,

  stores: {
    memory: {
      driver: 'memory',
    },

    redis: {
      driver:  'redis',
      url:     Env.get('REDIS_URL', ''),
      host:    Env.get('REDIS_HOST', '127.0.0.1'),
      port:    Env.getNumber('REDIS_PORT', 6379),
      password: Env.get('REDIS_PASSWORD', ''),
      prefix:  Env.get('CACHE_PREFIX', "rudderjs:"),
    },
  },
} satisfies CacheConfig
