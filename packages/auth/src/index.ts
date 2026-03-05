import { ServiceProvider, type Application, app } from '@boostkit/core'
import type { MiddlewareHandler } from '@boostkit/contracts'

// ─── Module Augmentation ───────────────────────────────────

declare module '@boostkit/contracts' {
  interface AppRequest {
    user: AuthUser
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

// ─── better-auth Config ────────────────────────────────────

export interface BetterAuthConfig {
  /** 32+ character secret. Falls back to process.env.AUTH_SECRET */
  secret?: string
  /** App base URL. Falls back to process.env.APP_URL */
  baseUrl?: string
  /**
   * Pass a PrismaClient instance — auto-wrapped with prismaAdapter internally.
   * Or pass a pre-built better-auth database adapter for advanced use.
   */
  database: unknown
  /** Required when passing a PrismaClient. Default: 'sqlite' */
  databaseProvider?: 'sqlite' | 'postgresql' | 'mysql'
  emailAndPassword?: { enabled?: boolean; requireEmailVerification?: boolean }
  socialProviders?: Record<string, { clientId: string; clientSecret: string }>
  trustedOrigins?: string[]
  /** Called after a new user is successfully created — ideal for dispatching jobs or events */
  onUserCreated?: (user: { id: string; name: string; email: string }) => void | Promise<void>
}

// ─── betterAuth() Factory ──────────────────────────────────

/**
 * Returns a ServiceProvider constructor that configures better-auth and
 * binds the auth instance to the DI container in boot().
 *
 * Usage in bootstrap/providers.ts:
 *   import { betterAuth } from '@boostkit/auth'
 *   import configs from '../config/index.ts'
 *   export default [..., betterAuth(configs.auth), ...]
 */
export function betterAuth(config: BetterAuthConfig): new (app: Application) => ServiceProvider {
  class BetterAuthProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      const { betterAuth: createAuth } = await import('better-auth')

      // Resolve database if it's a Promise (supports async factory pattern)
      let database = config.database instanceof Promise ? await config.database : config.database
      if (database && typeof (database as Record<string, unknown>)['$connect'] === 'function') {
        const { prismaAdapter } = await import('better-auth/adapters/prisma')
        database = prismaAdapter(database, {
          provider: config.databaseProvider ?? 'sqlite',
        })
      }

      const auth = createAuth({
        secret:  config.secret  ?? process.env['AUTH_SECRET'] ?? '',
        baseURL: config.baseUrl ?? process.env['APP_URL'] ?? 'http://localhost:3000',
        database: database as Parameters<typeof createAuth>[0]['database'],
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

      // Bind into DI container
      this.app.instance('auth', auth)

      console.log('[BetterAuthServiceProvider] booted — auth instance bound to DI container')
    }
  }

  return BetterAuthProvider
}

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
  return async (req, res, next) => {
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
