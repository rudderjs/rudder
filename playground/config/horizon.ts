import { Env } from '@rudderjs/core'
import type { HorizonConfig } from '@rudderjs/horizon'

// When QUEUE_CONNECTION=bullmq, default to Redis storage so the dashboard
// process and the worker process share state. With the database/sync drivers
// both halves run against one local store, so MemoryStorage is fine.
const queueConnection = Env.get('QUEUE_CONNECTION', 'database')

export default {
  enabled:           Env.getBool('HORIZON_ENABLED', true),
  path:              'horizon',
  storage:           queueConnection === 'bullmq' ? 'redis' : 'memory',
  redis: {
    url:      Env.get('REDIS_URL', ''),
    host:     Env.get('REDIS_HOST', '127.0.0.1'),
    port:     Env.getNumber('REDIS_PORT', 6379),
    password: Env.get('REDIS_PASSWORD', ''),
    prefix:   'rudderjs',
  },
  maxJobs:           1000,
  pruneAfterHours:   72,
  // 5s in dev so browser-verify cycles don't have to wait a minute. Production
  // default in framework code is still 60_000 ms.
  metricsIntervalMs: 5_000,
} satisfies HorizonConfig
