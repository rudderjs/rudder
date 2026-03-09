import { Env } from '@boostkit/support'
import type { SessionConfig } from '@boostkit/session'

export default {
  driver:   Env.get('SESSION_DRIVER', 'cookie') as 'cookie' | 'redis',
  lifetime: 120,
  secret:   Env.get('SESSION_SECRET', 'change-me-in-production'),
  cookie: {
    name:     'boostkit_session',
    secure:   Env.getBool('SESSION_SECURE', false),
    httpOnly: true,
    sameSite: 'lax' as const,
    path:     '/',
  },
  redis: { prefix: 'session:', url: Env.get('REDIS_URL', '') },
} satisfies SessionConfig
