import { Env } from '@rudderjs/support'
import type { CacheConfig } from '@rudderjs/cache'

export default {
  default: Env.get('CACHE_STORE', 'memory'),

  stores: {
    memory: {
      driver: 'memory',
    },

    redis: {
      driver:   'redis',
      url:      Env.get('REDIS_URL', ''),
      host:     Env.get('REDIS_HOST', '127.0.0.1'),
      port:     Env.getNumber('REDIS_PORT', 6379),
      password: Env.get('REDIS_PASSWORD', ''),
      prefix:   Env.get('CACHE_PREFIX', 'rudderjs:'),
    },
  },
} satisfies CacheConfig
