import { Env } from '@rudderjs/core'
import type { TelescopeConfig } from '@rudderjs/telescope'

export default {
  enabled:            Env.getBool('TELESCOPE_ENABLED', true),
  path:               'telescope',
  storage:            'memory',
  pruneAfterHours:    24,
  slowQueryThreshold: 100,
  ignoreRequests:     ['/telescope*', '/health', '/@*'],
} satisfies TelescopeConfig
