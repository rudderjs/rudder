import type { OAuthClient }  from './models/OAuthClient.js'
import type { AccessToken }  from './models/AccessToken.js'
import type { RefreshToken } from './models/RefreshToken.js'
import type { AuthCode }     from './models/AuthCode.js'
import type { DeviceCode }   from './models/DeviceCode.js'

// ─── Passport Configuration Singleton ─────────────────────

export interface PassportScope {
  id:          string
  description: string
}

export interface AuthorizationViewContext {
  client: { id: string; name: string }
  scopes: string[]
  redirectUri: string
  state?: string
  codeChallenge?: string
  codeChallengeMethod?: string
  request: unknown
}

export type AuthorizationViewFn = (ctx: AuthorizationViewContext) => unknown | Promise<unknown>

export class Passport {
  private static _scopes = new Map<string, string>()
  private static _tokenLifetime       = 15 * 24 * 60 * 60 * 1000   // 15 days
  private static _refreshTokenLifetime = 30 * 24 * 60 * 60 * 1000  // 30 days
  private static _personalTokenLifetime = 6 * 30 * 24 * 60 * 60 * 1000 // ~6 months
  private static _keyPath = 'storage'
  private static _privateKey: string | null = null
  private static _publicKey: string | null = null

  // Custom model overrides (lazy — resolved at use-site so the defaults aren't eagerly loaded).
  private static _clientModel:       typeof OAuthClient  | null = null
  private static _tokenModel:        typeof AccessToken  | null = null
  private static _refreshTokenModel: typeof RefreshToken | null = null
  private static _authCodeModel:     typeof AuthCode     | null = null
  private static _deviceCodeModel:   typeof DeviceCode   | null = null

  // Consent screen hook
  private static _authorizationView: AuthorizationViewFn | null = null

  // Route auto-registration toggle
  private static _routesIgnored = false

  // ── Scopes ──────────────────────────────────────────────

  /** Define available OAuth scopes. */
  static tokensCan(scopes: Record<string, string>): void {
    for (const [id, description] of Object.entries(scopes)) {
      this._scopes.set(id, description)
    }
  }

  /** Check if a scope is defined. */
  static hasScope(id: string): boolean {
    return this._scopes.has(id)
  }

  /** Get all defined scopes. */
  static scopes(): PassportScope[] {
    return [...this._scopes.entries()].map(([id, description]) => ({ id, description }))
  }

  /** Validate a list of scopes — returns only the valid ones. */
  static validScopes(requested: string[]): string[] {
    return requested.filter(s => this._scopes.has(s) || s === '*')
  }

  // ── Lifetimes ───────────────────────────────────────────

  static tokensExpireIn(ms: number): void { this._tokenLifetime = ms }
  static refreshTokensExpireIn(ms: number): void { this._refreshTokenLifetime = ms }
  static personalAccessTokensExpireIn(ms: number): void { this._personalTokenLifetime = ms }

  static tokenLifetime(): number { return this._tokenLifetime }
  static refreshTokenLifetime(): number { return this._refreshTokenLifetime }
  static personalTokenLifetime(): number { return this._personalTokenLifetime }

  // ── Keys ────────────────────────────────────────────────

  /** Set the directory where RSA keys are stored. */
  static loadKeysFrom(path: string): void { this._keyPath = path }

  /** Get the configured key path. */
  static keyPath(): string { return this._keyPath }

  /** Set keys directly (from environment variables). */
  static setKeys(privateKey: string, publicKey: string): void {
    this._privateKey = privateKey
    this._publicKey = publicKey
  }

  /** Load keys from files or env. Returns { privateKey, publicKey }. */
  static async keys(): Promise<{ privateKey: string; publicKey: string }> {
    // Prefer explicitly set keys (from env vars)
    if (this._privateKey && this._publicKey) {
      return { privateKey: this._privateKey, publicKey: this._publicKey }
    }

    // Load from filesystem
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const privatePath = join(process.cwd(), this._keyPath, 'oauth-private.key')
    const publicPath  = join(process.cwd(), this._keyPath, 'oauth-public.key')

    const [privateKey, publicKey] = await Promise.all([
      readFile(privatePath, 'utf8'),
      readFile(publicPath, 'utf8'),
    ])

    this._privateKey = privateKey
    this._publicKey = publicKey

    return { privateKey, publicKey }
  }

  // ── Custom Models ───────────────────────────────────────

  static useClientModel(cls: typeof OAuthClient):        void { this._clientModel = cls }
  static useTokenModel(cls: typeof AccessToken):         void { this._tokenModel = cls }
  static useRefreshTokenModel(cls: typeof RefreshToken): void { this._refreshTokenModel = cls }
  static useAuthCodeModel(cls: typeof AuthCode):         void { this._authCodeModel = cls }
  static useDeviceCodeModel(cls: typeof DeviceCode):     void { this._deviceCodeModel = cls }

  static async clientModel(): Promise<typeof OAuthClient> {
    if (this._clientModel) return this._clientModel
    return (await import('./models/OAuthClient.js')).OAuthClient
  }
  static async tokenModel(): Promise<typeof AccessToken> {
    if (this._tokenModel) return this._tokenModel
    return (await import('./models/AccessToken.js')).AccessToken
  }
  static async refreshTokenModel(): Promise<typeof RefreshToken> {
    if (this._refreshTokenModel) return this._refreshTokenModel
    return (await import('./models/RefreshToken.js')).RefreshToken
  }
  static async authCodeModel(): Promise<typeof AuthCode> {
    if (this._authCodeModel) return this._authCodeModel
    return (await import('./models/AuthCode.js')).AuthCode
  }
  static async deviceCodeModel(): Promise<typeof DeviceCode> {
    if (this._deviceCodeModel) return this._deviceCodeModel
    return (await import('./models/DeviceCode.js')).DeviceCode
  }

  // ── Consent screen hook ─────────────────────────────────

  /**
   * Register a custom consent screen renderer for GET /oauth/authorize.
   * Return a ViewResponse (from @rudderjs/view) or any value the router accepts.
   * When unset, GET /oauth/authorize returns JSON with the validated request.
   */
  static authorizationView(fn: AuthorizationViewFn): void {
    this._authorizationView = fn
  }

  static authorizationViewFn(): AuthorizationViewFn | null {
    return this._authorizationView
  }

  // ── Route auto-registration toggle ──────────────────────

  /**
   * Disable route registration. When set, registerPassportRoutes() is a no-op,
   * letting the application wire OAuth routes manually.
   */
  static ignoreRoutes(): void {
    this._routesIgnored = true
  }

  static routesIgnored(): boolean {
    return this._routesIgnored
  }

  // ── Reset (testing) ─────────────────────────────────────

  /** @internal */
  static reset(): void {
    this._scopes.clear()
    this._tokenLifetime         = 15 * 24 * 60 * 60 * 1000
    this._refreshTokenLifetime  = 30 * 24 * 60 * 60 * 1000
    this._personalTokenLifetime = 6 * 30 * 24 * 60 * 60 * 1000
    this._keyPath    = 'storage'
    this._privateKey = null
    this._publicKey  = null
    this._clientModel       = null
    this._tokenModel        = null
    this._refreshTokenModel = null
    this._authCodeModel     = null
    this._deviceCodeModel   = null
    this._authorizationView = null
    this._routesIgnored     = false
  }
}
