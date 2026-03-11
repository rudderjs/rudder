import { Env } from '@boostkit/core'
import { dispatch } from '@boostkit/core'
import type { BetterAuthConfig } from '@boostkit/auth'
import { UserRegistered } from '../app/Events/UserRegistered.js'

export default {
  secret:           Env.get('AUTH_SECRET', 'please-set-AUTH_SECRET-min-32-chars!!'),
  baseUrl:          Env.get('APP_URL', 'http://localhost:3000'),
  emailAndPassword: { enabled: true },

  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'user', input: false },
    },
  },

  onUserCreated: async (user) => {
    await dispatch(new UserRegistered(user.id, user.name, user.email))
  },
} satisfies BetterAuthConfig
