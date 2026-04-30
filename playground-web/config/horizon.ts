import { Env } from '@rudderjs/core'
import type { HorizonConfig } from '@rudderjs/horizon'

export default {
  enabled:           Env.getBool('HORIZON_ENABLED', true),
  path:              'horizon',
  storage:           'memory',
  maxJobs:           1000,
  pruneAfterHours:   72,
  metricsIntervalMs: 60_000,
} satisfies HorizonConfig
