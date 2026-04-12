import { Env } from '@rudderjs/core'
import type { TelescopeConfig } from '@rudderjs/telescope'

export default {
  enabled:            true,
  path:               'telescope',
  storage:            'memory',
  pruneAfterHours:    24,
  slowQueryThreshold: 100,
  ignoreRequests:     ['/telescope*', '/health', '/@*'],
} satisfies TelescopeConfig
