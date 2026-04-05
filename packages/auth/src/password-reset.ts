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
}

// ─── Password Broker ──────────────────────────────────────

export class PasswordBroker {
  private readonly expire: number
  private readonly throttle: number

  constructor(
    private readonly tokens: TokenRepository,
    private readonly users: UserProvider,
    private readonly config: PasswordResetConfig = {},
  ) {
    this.expire   = config.expire   ?? 60
    this.throttle = config.throttle ?? 60
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
    return createHmac('sha256', 'password-reset').update(token).digest('hex')
  }

  private verifyToken(plain: string, hashed: string): boolean {
    const computed = Buffer.from(this.hashToken(plain), 'hex')
    const stored   = Buffer.from(hashed, 'hex')
    if (computed.length !== stored.length) return false
    return timingSafeEqual(computed, stored)
  }
}

// ─── In-Memory Token Repository (for testing / dev) ───────

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
