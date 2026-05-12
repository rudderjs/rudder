import type { AuthConfig } from '@rudderjs/auth'
import { User } from 'App/Models/User.js'

export default {
  defaults: {
    guard: 'web',
  },
  guards: {
    web: { driver: 'session', provider: 'users' },
  },
  providers: {
    users: { driver: 'eloquent', model: User },
  },
} satisfies AuthConfig
