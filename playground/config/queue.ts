import { Env } from '@forge/support'

export default {
  default: Env.get('QUEUE_CONNECTION', 'inngest'),

  connections: {
    sync: {
      driver: 'sync',
    },

    inngest: {
      driver:      'inngest',
      eventKey:    Env.get('INNGEST_EVENT_KEY',    ''),
      signingKey:  Env.get('INNGEST_SIGNING_KEY',  ''),
      serveHost:   Env.get('INNGEST_SERVE_HOST',   'http://localhost:3000'),
    },
  },
}
