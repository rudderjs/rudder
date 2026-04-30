import { Env } from '@rudderjs/core'
import { isWebContainer } from '@rudderjs/support'
import type { SessionConfig } from '@rudderjs/session'

// In WebContainer, raw Redis (TCP) doesn't work — pin the session driver to
// `cookie` so sessions survive without a Redis backend.
const defaultDriver = isWebContainer()
  ? 'cookie'
  : (Env.get('SESSION_DRIVER', 'cookie') as 'cookie' | 'redis')

export default {
  driver:   defaultDriver,
  lifetime: 120,
  secret:   Env.get('SESSION_SECRET', 'change-me-in-production'),
  cookie: {
    name:     'rudderjs_session',
    secure:   Env.getBool('SESSION_SECURE', false),
    httpOnly: true,
    sameSite: 'lax' as const,
    path:     '/',
  },
  redis: { prefix: 'session:', url: Env.get('REDIS_URL', '') },
} satisfies SessionConfig
