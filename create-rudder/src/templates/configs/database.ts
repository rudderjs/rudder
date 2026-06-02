import type { TemplateContext } from '../../templates.js'

export function configDatabase(ctx: TemplateContext): string {
  // Native engine: the connection opts in with `engine: 'native'`, which the
  // built-in (auto-discovered) NativeDatabaseProvider gates on. SQLite only today.
  if (ctx.orm === 'native') {
    return `import { Env } from '@rudderjs/support'

export default {
  default: Env.get('DB_CONNECTION', 'sqlite'),

  connections: {
    sqlite: {
      engine: 'native' as const,
      driver: 'sqlite' as const,
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },
  },
}
`
  }

  const defaultConn = ctx.db
  const connections: Record<string, string> = {
    sqlite: `    sqlite: {
      driver: 'sqlite' as const,
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },`,
    postgresql: `    postgresql: {
      driver: 'postgresql' as const,
      url:    Env.get('DATABASE_URL', ''),
    },`,
    mysql: `    mysql: {
      driver: 'mysql' as const,
      url:    Env.get('DATABASE_URL', ''),
    },`,
  }

  return `import { Env } from '@rudderjs/support'

export default {
  default: Env.get('DB_CONNECTION', '${defaultConn}'),

  connections: {
${connections[ctx.db]}
  },
}
`
}

