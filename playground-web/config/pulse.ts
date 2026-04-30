import { Env } from '@rudderjs/core'
import type { PulseConfig } from '@rudderjs/pulse'

export default {
  enabled:              Env.getBool('PULSE_ENABLED', true),
  path:                 'pulse',
  storage:              'memory',
  pruneAfterHours:      168,    // 7 days
  slowRequestThreshold: 1000,
  slowQueryThreshold:   100,
} satisfies PulseConfig
