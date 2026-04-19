import { Env } from '@rudderjs/core'
import type { TelescopeConfig } from '@rudderjs/telescope'

export default {
  enabled:            true,
  path:               'telescope',
  storage:            'sqlite',
  pruneAfterHours:    24,
  slowQueryThreshold: 100,
  ignoreRequests:     ['/telescope*', '/health', '/@*'],
  recordAi:           true,
} satisfies TelescopeConfig
