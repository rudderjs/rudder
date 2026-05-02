import type { TemplateContext } from '../../templates.js'

export function configAuth(_ctx: TemplateContext): string {
  return `import type { AuthConfig } from '@rudderjs/auth'
import { User } from '../app/Models/User.js'

export default {
  defaults: { guard: 'web' },
  guards: {
    web: { driver: 'session', provider: 'users' },
  },
  providers: {
    users: { driver: 'eloquent', model: User },
  },
} satisfies AuthConfig
`
}

