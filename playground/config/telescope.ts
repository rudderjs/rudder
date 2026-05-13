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
  // Demo the SSE push transport — flip to 'polling' to fall back to the
  // default 2s fetch-poll behavior.
  updates:            'stream',
} satisfies TelescopeConfig
