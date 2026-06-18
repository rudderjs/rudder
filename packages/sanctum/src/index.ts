import { createHash, randomBytes } from 'node:crypto'
import { ServiceProvider, type Application, app } from '@rudderjs/core'
import type { AppRequest, MiddlewareHandler } from '@rudderjs/contracts'
import { userToPlain } from '@rudderjs/auth'
import type { Authenticatable, AuthManager, Guard, UserProvider } from '@rudderjs/auth'

// ─── Module Augmentation ──────────────────────────────────

// Adds `req.token` so handlers stacked behind `SanctumMiddleware()` /
// `RequireToken(...)` can read the active personal access token without
// poking at `req.raw['__rjs_token']`. Server adapters expose this via a
// getter on the normalized request object.
declare module '@rudderjs/contracts' {
  interface AppRequest {
    token?: PersonalAccessToken
  }
}

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

// ─── Transient Token (testing) ────────────────────────────

/**
 * A fake personal access token used by {@link Sanctum.actingAs} in tests.
 *
 * It carries the same shape as a persisted {@link PersonalAccessToken} so it can
 * be attached to `req.token` and read by `tokenCan()` / `RequireToken`, but it is
 * never stored in any repository. `abilities: null` (the default) grants every
 * ability, mirroring Laravel's `TransientToken`; pass a subset to scope it.
 */
export class TransientToken implements PersonalAccessToken {
  readonly id         = 'transient'
  readonly name       = 'transient'
  readonly token      = ''
  readonly lastUsedAt: Date | null = null
  readonly expiresAt:  Date | null = null
  readonly createdAt:  Date

  constructor(
    readonly userId: string,
    readonly abilities: string[] | null = null,
  ) {
    this.createdAt = new Date()
  }

  /**
   * Whether this transient token grants `ability`. Mirrors `Sanctum.tokenCan`:
   * `null` abilities = all access, `'*'` = all access, `[]` = nothing.
   */
  can(ability: string): boolean {
    if (!this.abilities) return true
    return this.abilities.includes('*') || this.abilities.includes(ability)
  }
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

/**
 * In-memory token store for development and testing only.
 * Do NOT use in production: the store is process-local (not shared across
 * instances) and provides no durability — use `OrmTokenRepository` from
 * `@rudderjs/sanctum/orm` instead.
 */
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
    // Full scan without early return to avoid a timing side-channel that would
    // let an attacker distinguish existing tokens from non-existing ones.
    let found: PersonalAccessToken | null = null
    for (const t of this.store.values()) {
      if (t.token === hashedToken) found = t
    }
    return found
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
    const toDelete = [...this.store.entries()]
      .filter(([, t]) => t.userId === userId)
      .map(([id]) => id)
    toDelete.forEach(id => this.store.delete(id))
  }
}

// ─── Sanctum.actingAs state (testing) ─────────────────────

interface ActingAsState {
  user:  Authenticatable
  token: TransientToken
}

// Process-global, set by `Sanctum.actingAs()` and cleared by
// `Sanctum.actingAsGuest()`. Honored by `SanctumMiddleware` / `RequireToken`
// only on a non-production runtime (see `Sanctum.currentActingAs`) — the same
// production backstop as @rudderjs/auth's test-user bypass (#1236), so a stray
// `actingAs()` left in shipped code can never authenticate a real request.
let _actingAs: ActingAsState | null = null

let _warnedActingAsInProd = false
function warnActingAsInProd(): void {
  if (_warnedActingAsInProd) return
  _warnedActingAsInProd = true
  console.warn(
    '[Rudder Sanctum] Sanctum.actingAs() was called on a production runtime ' +
    '(NODE_ENV=production). The test-only auth bypass is disabled here and the ' +
    'call has no effect. Remove actingAs() from non-test code.',
  )
}

/** Wrap a plain user record as an `Authenticatable` if it isn't already one. */
function toAuthenticatable(user: Authenticatable | Record<string, unknown>): Authenticatable {
  if (typeof (user as Authenticatable).getAuthIdentifier === 'function') {
    return user as Authenticatable
  }
  const plain = user as Record<string, unknown>
  return {
    ...plain,
    getAuthIdentifier: () => String(plain['id'] ?? ''),
  } as Authenticatable
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
   * Authenticate as `user` for subsequent requests in a test, without seeding a
   * token row or crafting a `Authorization: Bearer …` header. Mirrors Laravel's
   * `Sanctum::actingAs($user, $abilities, $guard)`.
   *
   * Installs a {@link TransientToken} that `SanctumMiddleware` / `RequireToken`
   * pick up in place of header validation, so `req.user`, `req.token`, and
   * `tokenCan()` all resolve to the synthetic user — even one that doesn't exist
   * in the database. `actingAs()` takes precedence over any Bearer header on the
   * request.
   *
   * `abilities` defaults to `['*']` (all abilities); pass a subset (e.g.
   * `['posts:create']`) to scope the token and exercise 403 paths. The `guard`
   * argument is accepted for Laravel API compatibility but is unused — Sanctum
   * has a single token guard.
   *
   * Test-only: honored on a non-production runtime, ignored (and warned about)
   * under `NODE_ENV=production`. Clear with {@link Sanctum.actingAsGuest} — call
   * it in your test teardown so the acting-as user doesn't leak into later tests.
   *
   * @returns the resolved `Authenticatable` (the same user, wrapped if needed).
   */
  static actingAs(
    user: Authenticatable | Record<string, unknown>,
    abilities: string[] = ['*'],
    _guard?: string,
  ): Authenticatable {
    if (process.env.NODE_ENV === 'production') warnActingAsInProd()
    const authUser = toAuthenticatable(user)
    _actingAs = { user: authUser, token: new TransientToken(authUser.getAuthIdentifier(), abilities) }
    return authUser
  }

  /** Clear the acting-as user set by {@link Sanctum.actingAs}. */
  static actingAsGuest(): void {
    _actingAs = null
  }

  /**
   * The active acting-as state, or `null` when none is set. Returns `null` on a
   * production runtime regardless of state — the security backstop that keeps a
   * stray `actingAs()` from authenticating real traffic.
   */
  static currentActingAs(): ActingAsState | null {
    if (process.env.NODE_ENV === 'production') return null
    return _actingAs
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
    // Case-insensitive Bearer match per RFC 6750 §2.1 — some HTTP libraries
    // lowercase header values, and "bearer"/"BEARER" are both legitimate.
    const bearerMatch = /^bearer\s+/i.exec(bearerToken)
    const raw = bearerMatch
      ? bearerToken.slice(bearerMatch[0].length).trim()
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

    // Check expiry. `<=` rejects a token whose expiry is exactly `now` (the
    // millisecond it expires it's no longer valid). The previous `<` allowed
    // a one-millisecond window of "expired but still accepted" use, which
    // was both technically wrong and a source of flaky millisecond-boundary
    // tests.
    if (this.isExpired(token)) return null

    // Resolve user
    const user = await this.users.retrieveById(token.userId)
    if (!user) return null

    // Update last used
    await this.tokens.updateLastUsed(token.id, new Date())

    return { user, token }
  }

  /**
   * Whether a token has expired. A per-token `expiresAt` is an explicit
   * override and always wins; otherwise the global `config.expiration`
   * (minutes from `createdAt`) applies, Laravel Sanctum-style. With neither set
   * the token never expires.
   */
  isExpired(token: PersonalAccessToken): boolean {
    if (token.expiresAt) return token.expiresAt.getTime() <= Date.now()

    const minutes = this.config.expiration
    if (minutes != null && minutes > 0) {
      return token.createdAt.getTime() + minutes * 60_000 <= Date.now()
    }

    return false
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

  // Not applicable for token auth (stateless bearer): no credentials, no
  // session, no primary-key login. Stubbed for `Guard` conformance, same as
  // attempt/login/logout.
  async attempt(): Promise<boolean> { return false }
  async login(): Promise<void> {}
  async logout(): Promise<void> {}
  async loginUsingId(): Promise<boolean> { return false }
  async once(): Promise<boolean> { return false }
  async onceUsingId(): Promise<boolean> { return false }
}

// ─── Middleware ────────────────────────────────────────────

// `AppRequest.raw` is typed `unknown` because it's whichever native request the
// adapter is built around (Hono Context, Node IncomingMessage, etc). We stash
// `__rjs_user` and `__rjs_token` on it so every layer behind the middleware can
// read the same record without re-validating. Centralizing the cast here keeps
// the `as Record<string, unknown>` to one site.
function rawBag(req: AppRequest): Record<string, unknown> {
  return req.raw as Record<string, unknown>
}

function attachUserAndToken(req: AppRequest, user: Authenticatable, token: PersonalAccessToken): void {
  // Use the shared serializer so sanctum and `@rudderjs/auth` agree on which
  // columns are sensitive (password, remember_token, plus anything the user
  // model lists via `getHidden()`).
  const plain = userToPlain(user)
  const bag = rawBag(req)
  bag['__rjs_user']  = plain
  bag['__rjs_token'] = token
  // Direct property set is a fallback for adapters that don't install a getter
  // for `req.user` / `req.token`. server-hono installs both getters in
  // normalizeRequest(), so this branch is a no-op there. The try/catch handles
  // adapters that expose these as read-only getters.
  try { req.user  = plain } catch { /* read-only */ }
  try { req.token = token } catch { /* read-only */ }
}

/**
 * Middleware that authenticates via Bearer token.
 * Attaches user + token to the request. Does not block unauthenticated requests.
 */
export function SanctumMiddleware(): MiddlewareHandler {
  return async function SanctumMiddleware(req, res, next) {
    // Test-mode short-circuit — `Sanctum.actingAs(user)` wins over any Bearer
    // header and needs no token store. Inert on a production runtime.
    const acting = Sanctum.currentActingAs()
    if (acting) {
      attachUserAndToken(req, acting.user, acting.token)
      await next()
      return
    }

    const sanctum = app().make<Sanctum>('sanctum')
    const authHeader = req.headers['authorization']
    if (authHeader) {
      const result = await sanctum.validateToken(authHeader)
      if (result) attachUserAndToken(req, result.user, result.token)
    }
    await next()
  }
}

function unauthenticated(res: Parameters<MiddlewareHandler>[1]): void {
  res.status(401).json({ message: 'Unauthenticated.' })
}

/**
 * Middleware that requires a valid Bearer token. Returns 401 if missing/invalid.
 * Optionally checks for specific abilities.
 */
export function RequireToken(...abilities: string[]): MiddlewareHandler {
  return async function RequireToken(req, res, next) {
    // Test-mode short-circuit — `Sanctum.actingAs(user, abilities)` authenticates
    // without a token store. Ability checks still run against the transient
    // token's abilities so scoped-token 403 paths are exercisable in tests.
    const acting = Sanctum.currentActingAs()
    if (acting) {
      attachUserAndToken(req, acting.user, acting.token)
      for (const ability of abilities) {
        if (!acting.token.can(ability)) {
          const message = app().isDevelopment()
            ? `Token does not have the "${ability}" ability.`
            : 'Insufficient token permissions.'
          res.status(403).json({ message })
          return
        }
      }
      await next()
      return
    }

    const sanctum = app().make<Sanctum>('sanctum')
    const authHeader = req.headers['authorization']

    if (!authHeader) {
      unauthenticated(res)
      return
    }

    // Reuse a token already validated by SanctumMiddleware on the same request.
    // Without this, stacks like `[SanctumMiddleware(), RequireToken('write')]`
    // run validateToken() twice — and each call writes lastUsedAt, doubling
    // every authenticated request's DB writes. The Bearer header is the same
    // for both middlewares, so trusting the prior result is safe.
    let token = rawBag(req)['__rjs_token'] as PersonalAccessToken | undefined

    if (!token) {
      const result = await sanctum.validateToken(authHeader)
      if (!result) {
        unauthenticated(res)
        return
      }
      attachUserAndToken(req, result.user, result.token)
      token = result.token
    }

    for (const ability of abilities) {
      if (!sanctum.tokenCan(token, ability)) {
        const message = app().isDevelopment()
          ? `Token does not have the "${ability}" ability.`
          : 'Insufficient token permissions.'
        res.status(403).json({ message })
        return
      }
    }

    await next()
  }
}

// ─── Config ───────────────────────────────────────────────

export interface SanctumConfig {
  /** Domains allowed for SPA cookie auth (default: []) */
  stateful?: string[]
  /**
   * Global token lifetime in minutes, measured from each token's `createdAt`.
   * A per-token `expiresAt` passed to `createToken()` overrides this. `null` or
   * a non-positive value means no global expiry (default: null).
   */
  expiration?: number | null
  /** Prefix for generated tokens (default: '') */
  tokenPrefix?: string
  /**
   * Name of the user provider to resolve from `auth.providers`. Defaults to
   * the default guard's provider. Set this in pure-API apps that don't
   * configure a session guard.
   */
  provider?: string
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
      // Resolve the auth manager from DI. Only catch the "binding not found"
      // case — provider resolution errors below should propagate verbatim.
      let manager: AuthManager
      try {
        manager = this.app.make<AuthManager>('auth.manager')
      } catch {
        throw new Error(
          '[Rudder Sanctum] No auth manager found. Register auth() provider before sanctum().',
        )
      }

      // Resolve the user provider directly — does NOT instantiate a
      // SessionGuard, so pure-API apps can use Sanctum without registering
      // `@rudderjs/session`. Falls back to the default guard's provider when
      // `config.provider` is unset.
      const users: UserProvider = manager.createProvider(config.provider)

      const repo = tokenRepository ?? new MemoryTokenRepository()
      const instance = new Sanctum(repo, users, config)
      this.app.instance('sanctum', instance)
    }
  }

  return SanctumServiceProvider
}
