import { Env } from '@boostkit/support'
import type { BetterAuthConfig } from '@boostkit/auth'

export default {
  secret:           Env.get('AUTH_SECRET', 'please-set-AUTH_SECRET-min-32-chars!!'),
  baseUrl:          Env.get('APP_URL', 'http://localhost:3000'),
  emailAndPassword: { enabled: true },
} satisfies BetterAuthConfig
