import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Authenticatable, UserProvider } from './contracts.js'

// ─── Token Repository Contract ────────────────────────────

export interface TokenRepository {
  create(email: string, token: string, expiresAt: Date): Promise<void>
  find(email: string): Promise<{ token: string; createdAt: Date } | null>
  delete(email: string): Promise<void>
  deleteExpired(): Promise<void>
}

// ─── Password Reset Status ────────────────────────────────

export type PasswordResetStatus =
  | 'RESET_LINK_SENT'
  | 'PASSWORD_RESET'
  | 'INVALID_USER'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'THROTTLED'

// ─── Config ───────────────────────────────────────────────

export interface PasswordResetConfig {
  /** Minutes before a reset token expires (default: 60) */
  expire?: number
  /** Seconds between reset requests for the same email (default: 60) */
  throttle?: number
  /**
   * HMAC secret for hashing stored reset tokens. **Required in production**
   * — the broker throws on construction when `NODE_ENV === 'production'`
   * and this is unset. In dev/test, an unset secret falls back to a
   * hardcoded placeholder with a one-time `console.warn`, so apps boot
   * without configuration but the gap is visible.
   *
   * Set this to your `APP_KEY` (or a value derived from it) so stored token
   * hashes are bound to your app instance.
   */
  secret?: string
}

// ─── Password Broker ──────────────────────────────────────

let _devSecretWarned = false

export class PasswordBroker {
  private readonly expire: number
  private readonly throttle: number
  private readonly secret: string

  constructor(
    private readonly tokens: TokenRepository,
    private readonly users: UserProvider,
    private readonly config: PasswordResetConfig = {},
  ) {
    this.expire   = config.expire   ?? 60
    this.throttle = config.throttle ?? 60
    if (config.secret) {
      this.secret = config.secret
    } else if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        '[@rudderjs/auth] PasswordBroker requires `secret` in production. ' +
        'Set auth.passwords.secret in your config (typically derived from APP_KEY).'
      )
    } else {
      if (!_devSecretWarned) {
        console.warn(
          '[@rudderjs/auth] PasswordBroker is using a hardcoded dev secret. ' +
          'Set auth.passwords.secret for production.'
        )
        _devSecretWarned = true
      }
      this.secret = 'password-reset'
    }
  }

  /**
   * Send a password reset link.
   * @param credentials - must include `email`
   * @param sendLink - callback to actually send the email/notification
   */
  async sendResetLink(
    credentials: { email: string },
    sendLink: (user: Authenticatable, token: string) => Promise<void>,
  ): Promise<PasswordResetStatus> {
    const user = await this.users.retrieveByCredentials({ email: credentials.email })
    if (!user) return 'INVALID_USER'

    // Throttle check
    const existing = await this.tokens.find(credentials.email)
    if (existing) {
      const elapsed = (Date.now() - existing.createdAt.getTime()) / 1000
      if (elapsed < this.throttle) return 'THROTTLED'
    }

    // Generate token
    const plainToken = randomBytes(32).toString('hex')
    const hashedToken = this.hashToken(plainToken)
    const expiresAt = new Date(Date.now() + this.expire * 60_000)

    // Delete old token, create new one
    await this.tokens.delete(credentials.email)
    await this.tokens.create(credentials.email, hashedToken, expiresAt)

    // Send the link with the plain token
    await sendLink(user, plainToken)

    return 'RESET_LINK_SENT'
  }

  /**
   * Reset the user's password.
   * @param credentials - must include `email`, `token`, `password`
   * @param callback - receives the user and new password to perform the actual update
   */
  async reset(
    credentials: { email: string; token: string; password: string },
    callback: (user: Authenticatable, password: string) => Promise<void>,
  ): Promise<PasswordResetStatus> {
    const user = await this.users.retrieveByCredentials({ email: credentials.email })
    if (!user) return 'INVALID_USER'

    const record = await this.tokens.find(credentials.email)
    if (!record) return 'INVALID_TOKEN'

    // Verify token
    if (!this.verifyToken(credentials.token, record.token)) return 'INVALID_TOKEN'

    // Check expiry
    const age = (Date.now() - record.createdAt.getTime()) / 60_000
    if (age > this.expire) {
      await this.tokens.delete(credentials.email)
      return 'TOKEN_EXPIRED'
    }

    // Reset
    await callback(user, credentials.password)
    await this.tokens.delete(credentials.email)

    return 'PASSWORD_RESET'
  }

  private hashToken(token: string): string {
    return createHmac('sha256', this.secret).update(token).digest('hex')
  }

  private verifyToken(plain: string, hashed: string): boolean {
    const computed = Buffer.from(this.hashToken(plain), 'hex')
    const stored   = Buffer.from(hashed, 'hex')
    if (computed.length !== stored.length) return false
    return timingSafeEqual(computed, stored)
  }
}

// ─── In-Memory Token Repository (for testing / dev) ───────

/**
 * Process-local token store backed by a `Map`. **Not for production.**
 * Pending reset tokens are lost on every restart, and the store is invisible
 * to other processes (a multi-worker app would issue a token from one worker
 * and reject it from another). Use a database-backed `TokenRepository` —
 * `@rudderjs/orm` ships one — for any real deployment.
 */
export class MemoryTokenRepository implements TokenRepository {
  private store = new Map<string, { token: string; createdAt: Date; expiresAt: Date }>()

  async create(email: string, token: string, expiresAt: Date): Promise<void> {
    this.store.set(email, { token, createdAt: new Date(), expiresAt })
  }

  async find(email: string): Promise<{ token: string; createdAt: Date } | null> {
    const entry = this.store.get(email)
    return entry ? { token: entry.token, createdAt: entry.createdAt } : null
  }

  async delete(email: string): Promise<void> {
    this.store.delete(email)
  }

  async deleteExpired(): Promise<void> {
    const now = Date.now()
    for (const [email, entry] of this.store) {
      if (entry.expiresAt.getTime() < now) this.store.delete(email)
    }
  }
}
