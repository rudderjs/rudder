import { Env } from '@boostkit/support'
import type { QueueConfig } from '@boostkit/queue'

export default {
  default: Env.get('QUEUE_CONNECTION', 'sync'),

  connections: {
    sync: {
      driver: 'sync',
    },

    inngest: {
      driver:     'inngest',
      appId:      Env.get('INNGEST_APP_ID',      'my-app'),
      eventKey:   Env.get('INNGEST_EVENT_KEY',   ''),
      signingKey: Env.get('INNGEST_SIGNING_KEY',  ''),
      jobs: [],
    },
  },
} satisfies QueueConfig
