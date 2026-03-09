import { ServiceProvider, type Application, app } from '@boostkit/core'
import type { MiddlewareHandler } from '@boostkit/contracts'

// ─── Module Augmentation ───────────────────────────────────

declare module '@boostkit/contracts' {
  interface AppRequest {
    user?: AuthUser
  }
}

// ─── Shared Auth Types ─────────────────────────────────────

export interface AuthUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string
  createdAt: Date
  updatedAt: Date
}

export interface AuthSession {
  id: string
  userId: string
  token: string
  expiresAt: Date
  ipAddress?: string
  userAgent?: string
  createdAt: Date
  updatedAt: Date
}

export interface AuthResult {
  user: AuthUser
  session: AuthSession
}

// ─── Config ────────────────────────────────────────────────

export interface BetterAuthConfig {
  /** 32+ character secret. Falls back to process.env.AUTH_SECRET */
  secret?: string
  /** App base URL. Falls back to process.env.APP_URL */
  baseUrl?: string
  emailAndPassword?: { enabled?: boolean; requireEmailVerification?: boolean }
  socialProviders?: Record<string, { clientId: string; clientSecret: string }>
  trustedOrigins?: string[]
  /** Called after a new user is successfully created — ideal for dispatching jobs or events */
  onUserCreated?: (user: { id: string; name: string; email: string }) => void | Promise<void>
}

export interface AuthDbConfig {
  driver?: 'postgresql' | 'sqlite' | 'libsql' | 'mysql'
  url?: string
}

// ─── Internal helpers ──────────────────────────────────────

async function createPrismaClient(config: AuthDbConfig): Promise<unknown> {
  const opts: Record<string, unknown> = {}

  if (config.driver === 'postgresql' && config.url) {
    const { Pool }     = await import('pg') as any
    const { PrismaPg } = await import('@prisma/adapter-pg') as any
    opts['adapter'] = new PrismaPg(new Pool({ connectionString: config.url }))
  } else if (config.driver === 'libsql' && config.url) {
    const { createClient }    = await import('@libsql/client') as any
    const { PrismaLibSql }    = await import('@prisma/adapter-libsql') as any
    opts['adapter'] = new PrismaLibSql(createClient({ url: config.url }))
  } else {
    const dbUrl = config.url ?? process.env['DATABASE_URL'] ?? 'file:./dev.db'
    const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3') as any
    opts['adapter'] = new PrismaBetterSqlite3({ url: dbUrl })
  }

  const mod = await import('@prisma/client') as any
  const PC  = mod.PrismaClient ?? mod.default?.PrismaClient ?? mod.default
  return new PC(opts)
}

function mapDriver(driver?: string): 'sqlite' | 'postgresql' | 'mysql' {
  if (driver === 'postgresql') return 'postgresql'
  if (driver === 'mysql') return 'mysql'
  return 'sqlite'
}

// ─── betterAuth() Factory ──────────────────────────────────

/**
 * Returns a ServiceProvider constructor that configures better-auth and
 * binds the auth instance to the DI container in boot().
 *
 * Pass the database connection config as the second argument — betterAuth
 * creates its own PrismaClient internally (separate from the ORM's client).
 *
 * Usage in bootstrap/providers.ts:
 *   import { betterAuth } from '@boostkit/auth'
 *   import configs from '../config/index.ts'
 *   export default [
 *     betterAuth(configs.auth, configs.database.connections[configs.database.default]),
 *     ...
 *   ]
 */
export function auth(
  config: BetterAuthConfig,
  dbConfig?: AuthDbConfig,
): new (app: Application) => ServiceProvider {
  class BetterAuthProvider extends ServiceProvider {
    register(): void {
      this.publishes({ from: new URL('../pages/react', import.meta.url).pathname, to: 'pages', tag: 'auth-pages' })
      this.publishes({ from: new URL('../pages/react', import.meta.url).pathname, to: 'pages', tag: 'auth-pages-react' })
      this.publishes({ from: new URL('../pages/vue',   import.meta.url).pathname, to: 'pages', tag: 'auth-pages-vue' })
      this.publishes({ from: new URL('../pages/solid', import.meta.url).pathname, to: 'pages', tag: 'auth-pages-solid' })
    }

    async boot(): Promise<void> {
      const { betterAuth: createAuth }  = await import('better-auth')
      const { prismaAdapter }           = await import('better-auth/adapters/prisma')

      // Use prismaProvider's client if available (boot order: prismaProvider → betterAuth),
      // otherwise create a dedicated client from dbConfig.
      let prisma: unknown
      try {
        prisma = this.app.make('prisma')
      } catch {
        prisma = await createPrismaClient(dbConfig ?? {})
      }
      const database = prismaAdapter(prisma as any, { provider: mapDriver(dbConfig?.driver) })

      const auth = createAuth({
        secret:   config.secret  ?? process.env['AUTH_SECRET'] ?? '',
        baseURL:  config.baseUrl ?? process.env['APP_URL'] ?? 'http://localhost:3000',
        database,
        emailAndPassword: {
          enabled: config.emailAndPassword?.enabled ?? true,
          ...(config.emailAndPassword?.requireEmailVerification !== undefined
            ? { requireEmailVerification: config.emailAndPassword.requireEmailVerification }
            : {}),
        },
        ...(config.socialProviders && { socialProviders: config.socialProviders }),
        ...(config.trustedOrigins  && { trustedOrigins:  config.trustedOrigins  }),
        ...(config.onUserCreated && {
          databaseHooks: {
            user: {
              create: {
                after: async (user: { id: string; name: string; email: string }) => {
                  await config.onUserCreated!(user)
                },
              },
            },
          },
        }),
      })

      this.app.instance('auth', auth)
    }
  }

  return BetterAuthProvider
}

/** @deprecated use `auth()` instead */
export const betterAuth = auth

export type BetterAuthInstance = Awaited<ReturnType<typeof import('better-auth').betterAuth>>

// ─── Auth Middleware ───────────────────────────────────────

/**
 * Verifies the session via better-auth and attaches the authenticated user
 * to the request as `req.user`. Returns 401 if no valid session exists.
 *
 * Requires betterAuth() provider to be registered in bootstrap/providers.ts.
 *
 * Usage in routes:
 *   import { AuthMiddleware } from '@boostkit/auth'
 *   const authMw = AuthMiddleware()
 *   Route.post('/api/posts', handler, [authMw])
 */
export function AuthMiddleware(): MiddlewareHandler {
  return async function AuthMiddleware(req, res, next) {
    const auth    = app().make<BetterAuthInstance>('auth')
    const session = await auth.api.getSession({
      headers: new Headers(req.headers as Record<string, string>),
    })

    if (!session?.user) {
      res.status(401).json({ message: 'Unauthorized.' })
      return
    }

    ;(req.raw as Record<string, unknown>)['__bk_user'] = session.user
    await next()
  }
}
