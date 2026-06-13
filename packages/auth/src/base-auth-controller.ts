import { Controller, Post } from '@rudderjs/router'
import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import { RateLimit } from '@rudderjs/middleware'
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

// ─── Default rate-limits ──────────────────────────────────
//
// Credential-stuffing + email-flood protection applied to the controller's
// POST handlers by default. Sized to be tight enough to deter abuse but loose
// enough that a real user fat-fingering a password doesn't get locked out.
//
// `signIn` / `signUp` key by IP — IP is the strongest available signal in
// the unauthenticated path. `requestPasswordReset` keys by the submitted
// email (falling back to IP) so a single attacker cannot drain the per-IP
// limit on an arbitrary victim's behalf; a stuffing attacker iterating
// emails costs them one bucket per email rather than one shared bucket.

/** Per-method rate-limit middleware applied to `BaseAuthController` POST handlers. */
export interface AuthRateLimits {
  signIn?:               MiddlewareHandler | null
  signUp?:               MiddlewareHandler | null
  requestPasswordReset?: MiddlewareHandler | null
}

export const DEFAULT_AUTH_RATE_LIMITS: Readonly<Required<AuthRateLimits>> = Object.freeze({
  signIn: RateLimit.perMinute(10)
    .message('Too many sign-in attempts. Please try again later.'),
  signUp: RateLimit.perMinute(5)
    .message('Too many sign-up attempts. Please try again later.'),
  requestPasswordReset: RateLimit.perMinute(3)
    .by((req) => {
      const body = req.body as { email?: unknown } | null | undefined
      const email = typeof body?.email === 'string' ? body.email : undefined
      return email ?? (req as unknown as { ip?: string }).ip ?? 'unknown'
    })
    .message('Too many password reset requests. Please try again later.'),
})

// Tracks subclasses that have already had their rate-limit middleware injected
// so re-constructing the controller (`registerController` does `new Ctor()`)
// doesn't stack the same limiters repeatedly. Each subclass mutates only its
// own prototype's route metadata — siblings are isolated by the per-subclass
// metadata clone below.
const RATE_LIMITS_APPLIED = new WeakSet<{ rateLimits: AuthRateLimits }>()

// Mirrors the private `ROUTE_DEFINITIONS` key in `@rudderjs/router`. Kept in
// sync deliberately so we can clone route metadata onto the subclass prototype
// without dragging a wider public surface through the router package. If the
// router renames this constant, the subclass test below catches the drift
// (routes would land on the wrong prototype and registerController would see
// the unmodified base routes).
const ROUTE_DEFINITIONS_KEY = 'rudderjs:route:definitions'

interface ControllerRouteMeta {
  method:     string
  path:       string
  handlerKey: string | symbol
  middleware: MiddlewareHandler[]
}

// ─── Base Controller ──────────────────────────────────────

/**
 * Laravel Breeze-style auth controller — subclass it and set `userModel` +
 * `hash` to get the five POST handlers wired to `/auth/*`.
 *
 * The controller is mounted under `/auth/*` (not `/api/auth/*`) because
 * session-based auth lives on the `web` group, matching Laravel's `/login`
 * convention. The `/api/*` namespace is reserved for token-based API auth
 * (Sanctum / Passport bearer routes).
 *
 * **Default rate-limits** apply to `signIn` / `signUp` / `requestPasswordReset`
 * out of the box (see {@link DEFAULT_AUTH_RATE_LIMITS}). Override per-method
 * via the static `rateLimits` field on the subclass — or set it to `{}` to
 * disable entirely (e.g. internal admin panels behind VPN auth):
 *
 * ```ts
 * import { RateLimit } from '@rudderjs/middleware'
 * import { BaseAuthController } from '@rudderjs/auth'
 *
 * export class AuthController extends BaseAuthController {
 *   protected userModel = User
 *   protected hash      = Hash
 *
 *   // Tighten one method, accept defaults for the rest.
 *   static override rateLimits = {
 *     ...DEFAULT_AUTH_RATE_LIMITS,
 *     signIn: RateLimit.perMinute(3).message('Too many login attempts.'),
 *   }
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
@Controller('/auth')
export abstract class BaseAuthController {
  protected abstract userModel: AuthUserModelLike
  protected abstract hash:      AuthHashLike

  /** Optional — set to enable `/request-password-reset` + `/reset-password`. */
  protected passwordBroker?: PasswordBroker

  /**
   * Per-method rate-limit middleware. Defaults to {@link DEFAULT_AUTH_RATE_LIMITS}
   * (credential-stuffing + email-flood protection). Override on the subclass
   * to tighten / loosen individual methods, or set to `{}` to disable entirely.
   *
   * Read once when the controller's first instance is constructed (i.e. when
   * `Route.registerController()` runs). Mutating after registration has no
   * effect — re-mount the controller on a fresh `Router` if needed.
   */
  static rateLimits: AuthRateLimits = DEFAULT_AUTH_RATE_LIMITS

  constructor() {
    const ctor = this.constructor as typeof BaseAuthController
    if (RATE_LIMITS_APPLIED.has(ctor)) return
    RATE_LIMITS_APPLIED.add(ctor)

    // `@Post` decorators on this class populate `ROUTE_DEFINITIONS` on
    // `BaseAuthController.prototype`. `Reflect.getMetadata` walks the
    // prototype chain, so subclasses inherit those routes — but they're
    // the SAME array, by reference. If two subclasses with different
    // `rateLimits` both mutated that shared array, the second's limiters
    // would stack on top of the first's. Clone the route definitions onto
    // each subclass's own prototype (shallow-clone routes + their middleware
    // arrays) before injecting so siblings stay isolated.
    const baseRoutes = (Reflect.getMetadata(
      ROUTE_DEFINITIONS_KEY,
      BaseAuthController.prototype,
    ) as ControllerRouteMeta[] | undefined) ?? []
    const cloned: ControllerRouteMeta[] = baseRoutes.map((r) => ({
      ...r,
      middleware: [...r.middleware],
    }))

    for (const route of cloned) {
      const key = String(route.handlerKey) as keyof AuthRateLimits
      const limiter = ctor.rateLimits[key]
      if (!limiter) continue
      // Prepend the configured limiter onto the cloned route's middleware
      // array. `registerController` reads route.middleware verbatim — so the
      // limiter ends up first in the chain, ahead of any per-route middleware
      // a subclass adds and ahead of the handler. Mutation is local to the
      // cloned route (subclass-owned), so sibling subclasses stay isolated.
      route.middleware = [limiter, ...route.middleware]
    }

    Reflect.defineMetadata(ROUTE_DEFINITIONS_KEY, cloned, ctor.prototype)
  }

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

    // The broker's status (RESET_LINK_SENT / INVALID_USER / THROTTLED) is
    // intentionally NOT surfaced. We always return `{ status: 'sent' }` to
    // avoid an email-enumeration oracle: THROTTLED is only ever returned for a
    // registered user (sendResetLink returns INVALID_USER first when no user
    // exists), so exposing a distinct 429 on throttle would leak registration
    // exactly the way exposing INVALID_USER would. Keep the response constant.
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
