import { Env } from '@rudderjs/core'
import type { SessionConfig } from '@rudderjs/session'

export default {
  driver:   Env.get('SESSION_DRIVER', 'cookie') as 'cookie' | 'redis',
  lifetime: 120,
  // Leave empty to sign with APP_KEY (the framework falls back automatically);
  // set SESSION_SECRET only to use a dedicated session key. Never ship the old
  // `change-me-in-production` placeholder — it is a public, forgeable key.
  secret:   Env.get('SESSION_SECRET', ''),
  cookie: {
    name:     'rudderjs_session',
    secure:   Env.getBool('SESSION_SECURE', false),
    httpOnly: true,
    sameSite: 'lax' as const,
    path:     '/',
  },
  redis: { prefix: 'session:', url: Env.get('REDIS_URL', '') },
} satisfies SessionConfig
