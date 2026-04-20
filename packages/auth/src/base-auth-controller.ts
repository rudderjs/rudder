import { Controller, Post } from '@rudderjs/router'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import { Auth } from './auth-manager.js'
import { toAuthenticatable } from './providers.js'
import type { PasswordBroker } from './password-reset.js'

// ─── Structural dependencies ──────────────────────────────
// We don't import from @rudderjs/orm or @rudderjs/hash to keep this package's
// surface area minimal — subclasses supply concrete references.

/** Minimal surface the controller needs from a user Model. */
export interface AuthUserModelLike {
  query(): { where(field: string, value: unknown): { first(): Promise<unknown> } }
  create(attrs: Record<string, unknown>): Promise<Record<string, unknown>>
  update(id: string | number, attrs: Record<string, unknown>): Promise<unknown>
}

/** Minimal surface matching the `Hash` facade from @rudderjs/hash. */
export interface AuthHashLike {
  make(plain: string): Promise<string>
  check(plain: string, hashed: string): Promise<boolean>
}

// ─── Base Controller ──────────────────────────────────────

/**
 * Laravel Breeze-style auth controller — subclass it and set `userModel` +
 * `hash` to get the five POST handlers wired to `/api/auth/*`.
 *
 * Subclasses can override any method to customize behavior. Class-level
 * middleware (e.g. rate limiting) applies to all handlers:
 *
 * ```ts
 * import { Middleware } from '@rudderjs/router'
 * import { RateLimit } from '@rudderjs/middleware'
 * import { BaseAuthController } from '@rudderjs/auth'
 * import { Hash } from '@rudderjs/hash'
 * import { User } from '../Models/User.js'
 *
 * const authLimit = RateLimit.perMinute(10).message('Too many attempts.')
 *
 * @Middleware([authLimit])
 * export class AuthController extends BaseAuthController {
 *   protected userModel = User
 *   protected hash      = Hash
 * }
 * ```
 *
 * Then in `routes/web.ts`:
 *
 * ```ts
 * import { AuthController } from '../app/Controllers/AuthController.js'
 * Route.registerController(AuthController)
 * ```
 *
 * Routes must be registered from the `web` group (`routes/web.ts`) so
 * `AuthMiddleware` + `SessionMiddleware` auto-install and `Auth.attempt/login`
 * can read and write the session.
 */
@Controller('/api/auth')
export abstract class BaseAuthController {
  protected abstract userModel: AuthUserModelLike
  protected abstract hash:      AuthHashLike

  /** Optional — set to enable `/request-password-reset` + `/reset-password`. */
  protected passwordBroker?: PasswordBroker

  @Post('/sign-in/email')
  async signIn(req: AppRequest, res: AppResponse): Promise<void> {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) {
      res.status(422).json({ message: 'Email and password are required.' })
      return
    }

    const success = await Auth.attempt({ email, password })
    if (!success) {
      res.status(401).json({ message: 'Invalid email or password.' })
      return
    }

    res.json({ ok: true })
  }

  @Post('/sign-up/email')
  async signUp(req: AppRequest, res: AppResponse): Promise<void> {
    const { name, email, password } = req.body as { name?: string; email?: string; password?: string }
    if (!email || !password) {
      res.status(422).json({ message: 'Email and password are required.' })
      return
    }
    if (password.length < 8) {
      res.status(422).json({ message: 'Password must be at least 8 characters.' })
      return
    }

    const existing = await this.userModel.query().where('email', email).first()
    if (existing) {
      res.status(409).json({ message: 'An account with this email already exists.' })
      return
    }

    const hashed = await this.hash.make(password)
    const user   = await this.userModel.create({ name: name ?? '', email, password: hashed })

    await Auth.login(toAuthenticatable(user as Record<string, unknown>))
    res.json({ ok: true })
  }

  @Post('/sign-out')
  async signOut(_req: AppRequest, res: AppResponse): Promise<void> {
    await Auth.logout()
    res.json({ ok: true })
  }

  @Post('/request-password-reset')
  async requestPasswordReset(req: AppRequest, res: AppResponse): Promise<void> {
    const { email } = req.body as { email?: string }
    if (!email) {
      res.status(422).json({ message: 'Email is required.' })
      return
    }

    if (!this.passwordBroker) {
      // No broker configured — return stub success to prevent email enumeration.
      // Subclasses should set `passwordBroker` to enable real reset emails.
      res.json({ status: 'sent' })
      return
    }

    await this.passwordBroker.sendResetLink({ email }, async (_user, token) => {
      await this.sendResetEmail(email, token)
    })

    res.json({ status: 'sent' })
  }

  @Post('/reset-password')
  async resetPassword(req: AppRequest, res: AppResponse): Promise<void> {
    const { token, email, newPassword } = req.body as {
      token?: string; email?: string; newPassword?: string
    }
    if (!token || !email || !newPassword) {
      res.status(422).json({ message: 'Token, email, and new password are required.' })
      return
    }

    if (!this.passwordBroker) {
      res.status(500).json({ message: 'Password reset not configured.' })
      return
    }

    const status = await this.passwordBroker.reset(
      { email, token, password: newPassword },
      async (user, password) => {
        const hashed = await this.hash.make(password)
        await this.userModel.update(user.getAuthIdentifier(), { password: hashed })
      },
    )

    if (status === 'PASSWORD_RESET') {
      res.json({ ok: true })
      return
    }
    if (status === 'TOKEN_EXPIRED') {
      res.status(400).json({ message: 'Reset token has expired.' })
      return
    }
    res.status(400).json({ message: 'Invalid or expired token.' })
  }

  /**
   * Override to send the reset-link email via your mail system. Default
   * writes to stdout so the scaffolded flow is testable without a mailer.
   */
  protected async sendResetEmail(email: string, token: string): Promise<void> {
    const baseUrl = process.env['APP_URL'] ?? 'http://localhost:3000'
    const url     = `${baseUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`
    console.log(`[RudderJS Auth] Password reset for ${email}: ${url}`)
  }
}
