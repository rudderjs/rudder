import { Env } from '@boostkit/support'

export default {
  default: Env.get('DB_CONNECTION', 'sqlite'),

  connections: {
    sqlite: {
      driver: 'sqlite' as const,
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },
  },
}
