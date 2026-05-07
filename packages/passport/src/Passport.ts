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
  /**
   * Previous public key, retained for verification only after a `passport:keys
   * --force` rotation. Tokens minted before the rotation keep verifying via
   * this slot during the grace window; new tokens are signed by the current
   * private key. Single-slot — one rotation deep — by design (operators who
   * need a longer history should stage rotations to land outside the
   * configured access-token lifetime). See JWKS verifier design notes in
   * `verificationKeys()` below.
   */
  private static _previousPublicKey: string | null = null

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

  // JWT issuer URL — when set, createToken stamps `iss` on the payload and
  // verifyToken can validate it via `expectedIssuer`. Optional per RFC 7519
  // but recommended by RFC 8725 §3.10 once the deployment has more than one
  // possible issuer (e.g. multi-tenant or staging vs prod sharing keys).
  private static _issuer: string | null = null

  /**
   * Maximum value (in seconds) the per-row `oauth_device_codes.interval` is
   * allowed to grow to via repeated `slow_down` escalations (RFC 8628 §3.5
   * doesn't specify a cap; we add one to keep degenerate clients from
   * pushing the interval to absurd values). 60 seconds is the default — long
   * enough to make a misbehaving client back off meaningfully, short enough
   * that a legitimate user typing the user_code never hits it.
   */
  private static _deviceMaxInterval = 60

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

  /**
   * Stamp the previous public key for verification grace after a key
   * rotation. Tokens carrying `kid` for this key — or any token whose
   * signature happens to verify against it — keep working until they
   * naturally expire. Pair with the env var `PASSPORT_PREVIOUS_PUBLIC_KEY`
   * if you don't want to rely on the on-disk `oauth-previous-public.key`
   * convention. Pass `null` to clear.
   */
  static setPreviousPublicKey(publicKey: string | null): void {
    this._previousPublicKey = publicKey && publicKey.length > 0 ? publicKey : null
  }

  /**
   * Probe whether an RSA keypair is reachable — either explicitly set via
   * `setKeys()` (env vars) or readable on disk under the configured key path.
   * Used by `PassportProvider.boot()` to surface a startup warning when keys
   * are missing, before the first `/oauth/*` request fails with a confusing
   * file-not-found error.
   *
   * Does NOT load or cache the keys; it only stats the files.
   */
  static async keysAvailable(): Promise<boolean> {
    if (this._privateKey && this._publicKey) return true

    const { stat } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const privatePath = join(process.cwd(), this._keyPath, 'oauth-private.key')
    const publicPath  = join(process.cwd(), this._keyPath, 'oauth-public.key')

    const [priv, pub] = await Promise.all([
      stat(privatePath).then(() => true, () => false),
      stat(publicPath).then(() => true, () => false),
    ])
    return priv && pub
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

  /**
   * All public keys that should be considered for JWT signature verification,
   * ordered current-first. After `passport:keys --force` rotates the
   * keypair, the previous public key lingers in this list (loaded from
   * `oauth-previous-public.key` on disk or set via `setPreviousPublicKey()`)
   * so JWTs signed before the rotation keep verifying during their natural
   * lifetime — `verifyToken()` walks the list and accepts a match against
   * any entry. Without this, every rotation forced an immediate global
   * sign-out.
   *
   * Tokens minted by recent versions also carry a `kid` JWT header equal to
   * the SHA-256 of the public key that signed them, so the verifier can
   * pick the right key directly without trial-and-error. Legacy tokens with
   * no `kid` fall through to "try each in order".
   *
   * Single previous-slot is intentional: one rotation deep. Operators who
   * need a multi-step grace should stage rotations to land outside the
   * configured access-token lifetime — at that point old tokens have
   * expired anyway and a longer history buys nothing.
   */
  static async verificationKeys(): Promise<string[]> {
    const { publicKey } = await this.keys()
    const keys: string[] = [publicKey]

    if (this._previousPublicKey) {
      keys.push(this._previousPublicKey)
      return keys
    }

    // Filesystem fallback — `oauth-previous-public.key` is written by
    // `generateKeys({ force: true })` during a rotation, alongside the
    // timestamped audit backup.
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const previousPath = join(process.cwd(), this._keyPath, 'oauth-previous-public.key')
    try {
      const previous = await readFile(previousPath, 'utf8')
      this._previousPublicKey = previous
      keys.push(previous)
    } catch {
      // No previous key on disk — first rotation hasn't happened yet, or
      // the operator deleted the file to drop the grace window.
    }

    return keys
  }

  /** Get the configured previous public key, if any. */
  static previousPublicKey(): string | null {
    return this._previousPublicKey
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

  // ── JWT issuer ──────────────────────────────────────────

  /**
   * Configure the JWT `iss` claim that `createToken()` stamps on every new
   * access token, and that `verifyToken()` validates when called with
   * `expectedIssuer: Passport.issuer()` (BearerMiddleware does this
   * automatically). Typically set to the canonical app URL — e.g.
   * `Passport.useIssuer('https://app.example.com')`.
   *
   * RFC 8725 §3.10 recommends issuer validation once a deployment has more
   * than one possible signer (multi-tenant, staging+prod sharing keys, etc.).
   * Tokens minted before this is configured carry no `iss` claim and are
   * exempt during the migration window — same pattern as redirect_uri (P1)
   * and familyId (P4).
   */
  static useIssuer(url: string): void { this._issuer = url || null }
  static issuer(): string | null { return this._issuer }

  // ── Device flow polling cap (RFC 8628 §3.5) ─────────────

  /**
   * Configure the maximum value (in seconds) the per-row device-code
   * polling interval is allowed to grow to via repeated `slow_down`
   * escalations. Must be >= 5 (the initial interval) and >= the increment
   * step (5s) to make sense; values smaller than that disable escalation
   * entirely and are clamped at 5.
   *
   * Defaults to 60 seconds. Raise it for niche flows where a misbehaving
   * client should be backed off more aggressively (e.g. a daemon polling
   * with no human in the loop). Lower it if your device-flow consumers can
   * tolerate a quicker authorization handshake — but lowering below ~30
   * gives legitimate users a small window to enter the user_code.
   */
  static deviceMaxInterval(seconds: number): void {
    // Never below the floor — escalation is by 5s, so a cap below 5
    // would prevent any escalation from ever taking effect.
    this._deviceMaxInterval = Math.max(5, Math.floor(seconds))
  }

  /** Current cap on `oauth_device_codes.interval` (seconds). */
  static deviceMaxIntervalSeconds(): number {
    return this._deviceMaxInterval
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
    this._previousPublicKey = null
    this._clientModel       = null
    this._tokenModel        = null
    this._refreshTokenModel = null
    this._authCodeModel     = null
    this._deviceCodeModel   = null
    this._authorizationView = null
    this._routesIgnored     = false
    this._issuer            = null
    this._deviceMaxInterval = 60
  }
}
