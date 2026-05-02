import { Env } from '@rudderjs/core'
import type { PulseConfig } from '@rudderjs/pulse'

export default {
  enabled:              Env.getBool('PULSE_ENABLED', true),
  path:                 'pulse',
  storage:              'sqlite',
  pruneAfterHours:      168,    // 7 days
  slowRequestThreshold: 1000,
  slowQueryThreshold:   100,
} satisfies PulseConfig
