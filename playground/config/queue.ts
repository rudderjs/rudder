import { Env } from '@forge/support'
import type { QueueConfig } from '@forge/queue'
import { WelcomeUserJob } from '../app/Jobs/WelcomeUserJob.js'

export default {
  default: Env.get('QUEUE_CONNECTION', 'sync'),

  connections: {
    sync: {
      driver: 'sync',
    },

    inngest: {
      driver:     'inngest',
      appId:      Env.get('INNGEST_APP_ID',      'forge-app'),
      eventKey:   Env.get('INNGEST_EVENT_KEY',   ''),
      signingKey: Env.get('INNGEST_SIGNING_KEY',  ''),
      // Job classes registered as Inngest functions.
      // Inngest calls back via POST /api/inngest to execute them.
      jobs: [WelcomeUserJob],
    },
  },
} satisfies QueueConfig
