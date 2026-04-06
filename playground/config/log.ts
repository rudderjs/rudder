import { Env } from '@rudderjs/core'
import type { LogConfig } from '@rudderjs/log'

export default {
  default: Env.get('LOG_CHANNEL', 'stack'),

  channels: {
    stack: {
      driver:           'stack',
      channels:         ['console', 'daily'],
      ignoreExceptions: false,
    },

    console: {
      driver: 'console',
      level:  Env.get('LOG_LEVEL', 'debug') as 'debug',
    },

    single: {
      driver: 'single',
      path:   'storage/logs/rudderjs.log',
      level:  Env.get('LOG_LEVEL', 'debug') as 'debug',
    },

    daily: {
      driver: 'daily',
      path:   'storage/logs/rudderjs.log',
      days:   14,
      level:  Env.get('LOG_LEVEL', 'debug') as 'debug',
    },

    null: {
      driver: 'null',
    },
  },
} satisfies LogConfig
