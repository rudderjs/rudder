import { Env } from '@boostkit/core'
import type { QueueConfig } from '@boostkit/queue'
import { WelcomeUserJob } from '../app/Jobs/WelcomeUserJob.js'

export default {
  default: Env.get('QUEUE_CONNECTION', 'bullmq'),

  connections: {
    sync: {
      driver: 'sync',
    },

    inngest: {
      driver:     'inngest',
      appId:      Env.get('INNGEST_APP_ID',      'boostkit-app'),
      eventKey:   Env.get('INNGEST_EVENT_KEY',   ''),
      signingKey: Env.get('INNGEST_SIGNING_KEY',  ''),
      // Job classes registered as Inngest functions.
      // Inngest calls back via POST /api/inngest to execute them.
      jobs: [WelcomeUserJob],
    },

    bullmq: {
      driver:   'bullmq',
      url:      Env.get('REDIS_URL', ''),
      host:     Env.get('REDIS_HOST',     '127.0.0.1'),
      port:     Env.getNumber('REDIS_PORT', 6379),
      password: Env.get('REDIS_PASSWORD', ''),
      prefix:   'boostkit',
      // Job classes the worker can execute — add yours here.
      // Run the worker: pnpm artisan queue:work
      jobs: [WelcomeUserJob],
    },
  },
} satisfies QueueConfig
