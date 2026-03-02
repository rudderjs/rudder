import { Env } from '@forge/support'
import type { BetterAuthConfig } from '@forge/auth-better-auth'
import { dispatch } from '@forge/events'
import { UserRegistered } from '../app/Events/UserRegistered.js'

async function createDatabase(): Promise<unknown> {
  const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3') as any
  const { PrismaClient } = await import('@prisma/client') as any
  const url = Env.get('DATABASE_URL', 'file:./dev.db')
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
}

// Dedicated PrismaClient for better-auth's own tables.
// Forge's ORM uses its own client in DatabaseServiceProvider — keep them separate.
const _prisma = createDatabase()

export default {
  secret:           Env.get('AUTH_SECRET', 'please-set-AUTH_SECRET-min-32-chars!!'),
  baseUrl:          Env.get('APP_URL', 'http://localhost:3000'),
  database:         _prisma,
  databaseProvider: 'sqlite' as const,
  emailAndPassword: { enabled: true },

  onUserCreated: async (user) => {
    await dispatch(new UserRegistered(user.id, user.name, user.email))
  },
} satisfies BetterAuthConfig
