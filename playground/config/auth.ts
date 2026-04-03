import { Env } from '@rudderjs/core'
import { dispatch } from '@rudderjs/core'
import type { BetterAuthConfig } from '@rudderjs/auth'
import { UserRegistered } from '../app/Events/UserRegistered.js'

export default {
  secret:           Env.get('AUTH_SECRET', 'please-set-AUTH_SECRET-min-32-chars!!'),
  baseUrl:          Env.get('APP_URL', 'http://localhost:3000'),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      // In production, send a real email via @rudderjs/mail
      // For development, just log the reset URL
      console.log(`[Auth] Password reset for ${user.email}: ${url}`)
    },
  },

  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'user', input: false },
    },
  },

  onUserCreated: async (user) => {
    await dispatch(new UserRegistered(user.id, user.name, user.email))
  },
} satisfies BetterAuthConfig
