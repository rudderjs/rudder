import { createHash, randomBytes } from 'node:crypto'
import { ServiceProvider, type Application, app } from '@rudderjs/core'
import type { MiddlewareHandler } from '@rudderjs/contracts'
import type { Authenticatable, Guard, UserProvider } from '@rudderjs/auth'

// ─── Types ────────────────────────────────────────────────

export interface PersonalAccessToken {
  id:          string
  userId:      string
  name:        string
  token:       string   // SHA-256 hash
  abilities:   string[] | null
  lastUsedAt:  Date | null
  expiresAt:   Date | null
  createdAt:   Date
}

export interface NewAccessToken {
  accessToken: PersonalAccessToken
  /** The plain-text token — shown once, never stored. Format: `{id}|{plainToken}` */
  plainTextToken: string
}

// ─── Token Repository ─────────────────────────────────────

export interface TokenRepository {
  create(data: {
    userId:     string
    name:       string
    token:      string
    abilities?: string[] | null
    expiresAt?: Date | null
  }): Promise<PersonalAccessToken>

  findByToken(hashedToken: string): Promise<PersonalAccessToken | null>
  findByUserId(userId: string): Promise<PersonalAccessToken[]>
  updateLastUsed(id: string, date: Date): Promise<void>
  delete(id: string): Promise<void>
  deleteByUserId(userId: string): Promise<void>
}

// ─── In-Memory Token Repository (dev/testing) ─────────────

export class MemoryTokenRepository implements TokenRepository {
  private store = new Map<string, PersonalAccessToken>()
  private counter = 0

  async create(data: {
    userId: string; name: string; token: string;
    abilities?: string[] | null; expiresAt?: Date | null
  }): Promise<PersonalAccessToken> {
    const id = String(++this.counter)
    const token: PersonalAccessToken = {
      id,
      userId:     data.userId,
      name:       data.name,
      token:      data.token,
      abilities:  data.abilities ?? null,
      lastUsedAt: null,
      expiresAt:  data.expiresAt ?? null,
      createdAt:  new Date(),
    }
    this.store.set(id, token)
    return token
  }

  async findByToken(hashedToken: string): Promise<PersonalAccessToken | null> {
    for (const t of this.store.values()) {
      if (t.token === hashedToken) return t
    }
    return null
  }

  async findByUserId(userId: string): Promise<PersonalAccessToken[]> {
    return [...this.store.values()].filter(t => t.userId === userId)
  }

  async updateLastUsed(id: string, date: Date): Promise<void> {
    const t = this.store.get(id)
    if (t) t.lastUsedAt = date
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id)
  }

  async deleteByUserId(userId: string): Promise<void> {
    for (const [id, t] of this.store) {
      if (t.userId === userId) this.store.delete(id)
    }
  }
}

// ─── Sanctum ──────────────────────────────────────────────

export class Sanctum {
  constructor(
    private readonly tokens: TokenRepository,
    private readonly users: UserProvider,
    private readonly config: SanctumConfig = {},
  ) {}

  /** Hash a plain token using SHA-256. */
  static hashToken(plainToken: string): string {
    return createHash('sha256').update(plainToken).digest('hex')
  }

  /** Generate a random plain token. */
  static generateToken(): string {
    return randomBytes(32).toString('hex')
  }

  /**
   * Create a new personal access token for a user.
   * Returns the plain-text token (shown once) and the persisted token record.
   */
  async createToken(
    userId: string,
    name: string,
    abilities?: string[],
    expiresAt?: Date,
  ): Promise<NewAccessToken> {
    const plain  = Sanctum.generateToken()
    const hashed = Sanctum.hashToken(plain)

    const prefix = this.config.tokenPrefix ?? ''
    const accessToken = await this.tokens.create({
      userId,
      name,
      token: hashed,
      abilities: abilities ?? null,
      expiresAt: expiresAt ?? null,
    })

    return {
      accessToken,
      plainTextToken: `${prefix}${accessToken.id}|${plain}`,
    }
  }

  /**
   * Validate a token from a request header.
   * Returns the user if valid, null otherwise.
   */
  async validateToken(bearerToken: string): Promise<{ user: Authenticatable; token: PersonalAccessToken } | null> {
    const prefix = this.config.tokenPrefix ?? ''
    const raw = bearerToken.startsWith('Bearer ')
      ? bearerToken.slice(7).trim()
      : bearerToken.trim()

    const unprefixed = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw

    const pipeIdx = unprefixed.indexOf('|')
    if (pipeIdx === -1) return null

    const id    = unprefixed.slice(0, pipeIdx)
    const plain = unprefixed.slice(pipeIdx + 1)
    if (!id || !plain) return null

    const hashed = Sanctum.hashToken(plain)
    const token = await this.tokens.findByToken(hashed)
    if (!token) return null
    if (token.id !== id) return null

    // Check expiry
    if (token.expiresAt && token.expiresAt.getTime() < Date.now()) return null

    // Resolve user
    const user = await this.users.retrieveById(token.userId)
    if (!user) return null

    // Update last used
    await this.tokens.updateLastUsed(token.id, new Date())

    return { user, token }
  }

  /** Check if a token has a specific ability. */
  tokenCan(token: PersonalAccessToken, ability: string): boolean {
    if (!token.abilities) return true // null = all abilities
    return token.abilities.includes('*') || token.abilities.includes(ability)
  }

  /** Get all tokens for a user. */
  userTokens(userId: string): Promise<PersonalAccessToken[]> {
    return this.tokens.findByUserId(userId)
  }

  /** Revoke a specific token. */
  revokeToken(tokenId: string): Promise<void> {
    return this.tokens.delete(tokenId)
  }

  /** Revoke all tokens for a user. */
  revokeAllTokens(userId: string): Promise<void> {
    return this.tokens.deleteByUserId(userId)
  }
}

// ─── Token Guard ──────────────────────────────────────────

export class TokenGuard implements Guard {
  private _user: Authenticatable | null | undefined = undefined
  private _token: PersonalAccessToken | null = null

  constructor(private readonly sanctum: Sanctum, private readonly bearerToken: string | null) {}

  async user(): Promise<Authenticatable | null> {
    if (this._user !== undefined) return this._user
    if (!this.bearerToken) { this._user = null; return null }

    const result = await this.sanctum.validateToken(this.bearerToken)
    if (result) {
      this._user  = result.user
      this._token = result.token
    } else {
      this._user = null
    }
    return this._user
  }

  async id(): Promise<string | null> {
    const u = await this.user()
    return u ? u.getAuthIdentifier() : null
  }

  async check(): Promise<boolean> { return (await this.user()) !== null }
  async guest(): Promise<boolean> { return (await this.user()) === null }

  /** Get the current token (after user() has been called). */
  currentToken(): PersonalAccessToken | null { return this._token }

  /** Check if the current token has a specific ability. */
  tokenCan(ability: string): boolean {
    if (!this._token) return false
    return this.sanctum.tokenCan(this._token, ability)
  }

  // Not applicable for token auth
  async attempt(): Promise<boolean> { return false }
  async login(): Promise<void> {}
  async logout(): Promise<void> {}
}

// ─── Middleware ────────────────────────────────────────────

/**
 * Middleware that authenticates via Bearer token.
 * Attaches user + token to the request. Does not block unauthenticated requests.
 */
export function SanctumMiddleware(): MiddlewareHandler {
  return async function SanctumMiddleware(req, res, next) {
    const sanctum = app().make<Sanctum>('sanctum')
    const authHeader = req.headers['authorization'] as string | undefined
    if (authHeader) {
      const result = await sanctum.validateToken(authHeader)
      if (result) {
        const plain: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(result.user as unknown as Record<string, unknown>)) {
          if (typeof v !== 'function' && k !== 'password') plain[k] = v
        }
        plain['id'] = result.user.getAuthIdentifier()
        ;(req.raw as Record<string, unknown>)['__rjs_user']  = plain
        ;(req.raw as Record<string, unknown>)['__rjs_token'] = result.token
        try { (req as unknown as Record<string, unknown>)['user'] = plain } catch { /* read-only */ }
      }
    }
    await next()
  }
}

/**
 * Middleware that requires a valid Bearer token. Returns 401 if missing/invalid.
 * Optionally checks for specific abilities.
 */
export function RequireToken(...abilities: string[]): MiddlewareHandler {
  return async function RequireToken(req, res, next) {
    const sanctum = app().make<Sanctum>('sanctum')
    const authHeader = req.headers['authorization'] as string | undefined

    if (!authHeader) {
      res.status(401).json({ message: 'Unauthenticated.' })
      return
    }

    const result = await sanctum.validateToken(authHeader)
    if (!result) {
      res.status(401).json({ message: 'Unauthenticated.' })
      return
    }

    // Check abilities
    for (const ability of abilities) {
      if (!sanctum.tokenCan(result.token, ability)) {
        res.status(403).json({ message: `Token does not have the "${ability}" ability.` })
        return
      }
    }

    const plain: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(result.user as unknown as Record<string, unknown>)) {
      if (typeof v !== 'function' && k !== 'password') plain[k] = v
    }
    plain['id'] = result.user.getAuthIdentifier()
    ;(req.raw as Record<string, unknown>)['__rjs_user']  = plain
    ;(req.raw as Record<string, unknown>)['__rjs_token'] = result.token
    try { (req as unknown as Record<string, unknown>)['user'] = plain } catch { /* read-only */ }

    await next()
  }
}

// ─── Config ───────────────────────────────────────────────

export interface SanctumConfig {
  /** Domains allowed for SPA cookie auth (default: []) */
  stateful?: string[]
  /** Token expiration in minutes (null = no expiry, default: null) */
  expiration?: number | null
  /** Prefix for generated tokens (default: '') */
  tokenPrefix?: string
}

// ─── Service Provider Factory ─────────────────────────────

/**
 * Returns a SanctumServiceProvider configured for API token auth.
 *
 * Usage in bootstrap/providers.ts:
 *   import { sanctum } from '@rudderjs/sanctum'
 *   export default [auth(configs.auth), sanctum(configs.sanctum), ...]
 */
export function sanctum(
  config: SanctumConfig = {},
  tokenRepository?: TokenRepository,
): new (app: Application) => ServiceProvider {
  class SanctumServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      // Resolve user provider from auth config
      let users: UserProvider
      try {
        const manager = this.app.make<{ guard(): { ['provider']: UserProvider } }>('auth.manager')
        // Access the provider from the default guard
        const guard = manager.guard() as unknown as { provider: UserProvider }
        users = guard.provider
      } catch {
        throw new Error(
          '[RudderJS Sanctum] No auth manager found. Register auth() provider before sanctum().',
        )
      }

      const repo = tokenRepository ?? new MemoryTokenRepository()
      const instance = new Sanctum(repo, users, config)
      this.app.instance('sanctum', instance)
    }
  }

  return SanctumServiceProvider
}
