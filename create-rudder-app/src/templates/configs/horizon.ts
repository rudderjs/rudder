export function configHorizon(): string {
  return `import { Env } from '@rudderjs/core'
import type { HorizonConfig } from '@rudderjs/horizon'

// Queue monitoring dashboard mounted at /horizon. Tracks job lifecycle,
// worker health, throughput, and supports retry/delete from the UI.
//
// When QUEUE_CONNECTION=bullmq, switch storage to 'redis' so the dashboard
// process and worker processes share state. With the sync driver both halves
// run in one process, so memory storage is fine.
const queueConnection = Env.get('QUEUE_CONNECTION', 'sync')

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
  metricsIntervalMs: 60_000,
} satisfies HorizonConfig
`
}
