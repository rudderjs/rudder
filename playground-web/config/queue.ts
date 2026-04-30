import { Env } from '@rudderjs/core'
import { isWebContainer } from '@rudderjs/support'
import type { QueueConfig } from '@rudderjs/queue'
import { WelcomeUserJob } from '../app/Jobs/WelcomeUserJob.js'

// In WebContainer, BullMQ (Redis over raw TCP) doesn't work and isn't installed
// in this variant — fall back to the in-process `sync` driver.
const defaultConnection = isWebContainer() ? 'sync' : Env.get('QUEUE_CONNECTION', 'sync')

export default {
  default: defaultConnection,

  connections: {
    sync: {
      driver: 'sync',
    },

    inngest: {
      driver:     'inngest',
      appId:      Env.get('INNGEST_APP_ID',      'rudderjs-app'),
      eventKey:   Env.get('INNGEST_EVENT_KEY',   ''),
      signingKey: Env.get('INNGEST_SIGNING_KEY',  ''),
      // Job classes registered as Inngest functions.
      // Inngest calls back via POST /api/inngest to execute them.
      jobs: [WelcomeUserJob],
    },
  },
} satisfies QueueConfig
