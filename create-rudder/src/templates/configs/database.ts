import type { TemplateContext } from '../../templates.js'

export function configDatabase(ctx: TemplateContext): string {
  // Native engine: the connection opts in with `engine: 'native'`, which the
  // built-in (auto-discovered) NativeDatabaseProvider gates on. Driver names
  // are the native engine's `sqlite` / `pg` / `mysql` (NOT `postgresql` — an
  // unknown driver fails fast at first query).
  if (ctx.orm === 'native') {
    const nativeConnections: Record<TemplateContext['db'], { key: string; body: string }> = {
      sqlite: {
        key: 'sqlite',
        body: `    sqlite: {
      engine: 'native' as const,
      driver: 'sqlite' as const,
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },`,
      },
      postgresql: {
        key: 'pg',
        body: `    pg: {
      engine: 'native' as const,
      driver: 'pg' as const,
      url:    Env.get('DATABASE_URL', ''),
    },`,
      },
      mysql: {
        key: 'mysql',
        body: `    mysql: {
      engine: 'native' as const,
      driver: 'mysql' as const,
      url:    Env.get('DATABASE_URL', ''),
    },`,
      },
    }
    const conn = nativeConnections[ctx.db]
    return `import { Env } from '@rudderjs/support'

export default {
  default: Env.get('DB_CONNECTION', '${conn.key}'),

  connections: {
${conn.body}
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

