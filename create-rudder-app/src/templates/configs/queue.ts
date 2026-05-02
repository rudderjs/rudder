export function configQueue(): string {
  return `import { Env, isWebContainer } from '@rudderjs/support'
import type { QueueConfig } from '@rudderjs/queue'

// In WebContainer, BullMQ (Redis over raw TCP) doesn't work — fall back to
// the in-process \`sync\` driver.
const defaultConnection = isWebContainer() ? 'sync' : Env.get('QUEUE_CONNECTION', 'sync')

export default {
  default: defaultConnection,

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
`
}

