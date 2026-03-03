import { ServiceProvider, type Application } from '@boostkit/core'

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

/**
 * Returns a ServiceProvider constructor that configures better-auth and
 * binds the auth instance to the DI container in boot().
 *
 * The /api/auth/* route must be registered separately in routes/api.ts
 * using app().make('auth') to get the handler.
 *
 * Usage in bootstrap/providers.ts:
 *   import { betterAuth } from '@boostkit/auth-better-auth'
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
