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

/**
 * Shared singleton store routed through `globalThis` so the configuration
 * survives the case where `@rudderjs/passport` is loaded twice — typical in a
 * Vite-bundled server where the framework bundles `@rudderjs/passport` inline
 * but `PassportProvider.boot()` (and `Passport.tokensCan()` /
 * `Passport.tokensExpireIn()` calls in `AppServiceProvider.boot()`) runs from
 * a `node_modules` copy resolved via the provider auto-discovery manifest.
 * Without a shared store, scopes / lifetimes / RSA keys configured from the
 * externalized copy would never be visible to grant handlers reading the
 * bundled copy — every `/oauth/*` request would behave as if Passport was
 * never configured.
 *
 * Defensive migration per the #499 static-state singleton audit. Same pattern
 * as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500–#505 (pennant, cache,
 * queue, mail, storage, hash).
 */
interface PassportConfigStore {
  scopes: Map<string, string>
  tokenLifetime: number
  refreshTokenLifetime: number
  personalTokenLifetime: number
  keyPath: string
  privateKey: string | null
  publicKey: string | null
  previousPublicKey: string | null
  clientModel: typeof OAuthClient | null
  tokenModel: typeof AccessToken | null
  refreshTokenModel: typeof RefreshToken | null
  authCodeModel: typeof AuthCode | null
  deviceCodeModel: typeof DeviceCode | null
  authorizationView: AuthorizationViewFn | null
  routesIgnored: boolean
  issuer: string | null
  deviceMaxInterval: number
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_passport_config__']) {
  _g['__rudderjs_passport_config__'] = {
    scopes: new Map<string, string>(),
    tokenLifetime:         15 * 24 * 60 * 60 * 1000,
    refreshTokenLifetime:  30 * 24 * 60 * 60 * 1000,
    personalTokenLifetime: 6 * 30 * 24 * 60 * 60 * 1000,
    keyPath: 'storage',
    privateKey: null,
    publicKey: null,
    previousPublicKey: null,
    clientModel: null,
    tokenModel: null,
    refreshTokenModel: null,
    authCodeModel: null,
    deviceCodeModel: null,
    authorizationView: null,
    routesIgnored: false,
    issuer: null,
    deviceMaxInterval: 60,
  } satisfies PassportConfigStore
}
const _store = _g['__rudderjs_passport_config__'] as PassportConfigStore

export class Passport {
  // ── Scopes ──────────────────────────────────────────────

  /** Define available OAuth scopes. */
  static tokensCan(scopes: Record<string, string>): void {
    for (const [id, description] of Object.entries(scopes)) {
      _store.scopes.set(id, description)
    }
  }

  /** Check if a scope is defined. */
  static hasScope(id: string): boolean {
    return _store.scopes.has(id)
  }

  /** Get all defined scopes. */
  static scopes(): PassportScope[] {
    return [..._store.scopes.entries()].map(([id, description]) => ({ id, description }))
  }

  /** Validate a list of scopes — returns only the valid ones. */
  static validScopes(requested: string[]): string[] {
    return requested.filter(s => _store.scopes.has(s) || s === '*')
  }

  // ── Lifetimes ───────────────────────────────────────────

  static tokensExpireIn(ms: number): void { _store.tokenLifetime = ms }
  static refreshTokensExpireIn(ms: number): void { _store.refreshTokenLifetime = ms }
  static personalAccessTokensExpireIn(ms: number): void { _store.personalTokenLifetime = ms }

  static tokenLifetime(): number { return _store.tokenLifetime }
  static refreshTokenLifetime(): number { return _store.refreshTokenLifetime }
  static personalTokenLifetime(): number { return _store.personalTokenLifetime }

  // ── Keys ────────────────────────────────────────────────

  /** Set the directory where RSA keys are stored. */
  static loadKeysFrom(path: string): void { _store.keyPath = path }

  /** Get the configured key path. */
  static keyPath(): string { return _store.keyPath }

  /** Set keys directly (from environment variables). */
  static setKeys(privateKey: string, publicKey: string): void {
    _store.privateKey = privateKey
    _store.publicKey = publicKey
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
    _store.previousPublicKey = publicKey && publicKey.length > 0 ? publicKey : null
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
    if (_store.privateKey && _store.publicKey) return true

    const { stat } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const privatePath = join(process.cwd(), _store.keyPath, 'oauth-private.key')
    const publicPath  = join(process.cwd(), _store.keyPath, 'oauth-public.key')

    const [priv, pub] = await Promise.all([
      stat(privatePath).then(() => true, () => false),
      stat(publicPath).then(() => true, () => false),
    ])
    return priv && pub
  }

  /** Load keys from files or env. Returns { privateKey, publicKey }. */
  static async keys(): Promise<{ privateKey: string; publicKey: string }> {
    // Prefer explicitly set keys (from env vars)
    if (_store.privateKey && _store.publicKey) {
      return { privateKey: _store.privateKey, publicKey: _store.publicKey }
    }

    // Load from filesystem
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const privatePath = join(process.cwd(), _store.keyPath, 'oauth-private.key')
    const publicPath  = join(process.cwd(), _store.keyPath, 'oauth-public.key')

    const [privateKey, publicKey] = await Promise.all([
      readFile(privatePath, 'utf8'),
      readFile(publicPath, 'utf8'),
    ])

    _store.privateKey = privateKey
    _store.publicKey = publicKey

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

    if (_store.previousPublicKey) {
      keys.push(_store.previousPublicKey)
      return keys
    }

    // Filesystem fallback — `oauth-previous-public.key` is written by
    // `generateKeys({ force: true })` during a rotation, alongside the
    // timestamped audit backup.
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const previousPath = join(process.cwd(), _store.keyPath, 'oauth-previous-public.key')
    try {
      const previous = await readFile(previousPath, 'utf8')
      _store.previousPublicKey = previous
      keys.push(previous)
    } catch {
      // No previous key on disk — first rotation hasn't happened yet, or
      // the operator deleted the file to drop the grace window.
    }

    return keys
  }

  /** Get the configured previous public key, if any. */
  static previousPublicKey(): string | null {
    return _store.previousPublicKey
  }

  // ── Custom Models ───────────────────────────────────────

  static useClientModel(cls: typeof OAuthClient):        void { _store.clientModel = cls }
  static useTokenModel(cls: typeof AccessToken):         void { _store.tokenModel = cls }
  static useRefreshTokenModel(cls: typeof RefreshToken): void { _store.refreshTokenModel = cls }
  static useAuthCodeModel(cls: typeof AuthCode):         void { _store.authCodeModel = cls }
  static useDeviceCodeModel(cls: typeof DeviceCode):     void { _store.deviceCodeModel = cls }

  static async clientModel(): Promise<typeof OAuthClient> {
    if (_store.clientModel) return _store.clientModel
    return (await import('./models/OAuthClient.js')).OAuthClient
  }
  static async tokenModel(): Promise<typeof AccessToken> {
    if (_store.tokenModel) return _store.tokenModel
    return (await import('./models/AccessToken.js')).AccessToken
  }
  static async refreshTokenModel(): Promise<typeof RefreshToken> {
    if (_store.refreshTokenModel) return _store.refreshTokenModel
    return (await import('./models/RefreshToken.js')).RefreshToken
  }
  static async authCodeModel(): Promise<typeof AuthCode> {
    if (_store.authCodeModel) return _store.authCodeModel
    return (await import('./models/AuthCode.js')).AuthCode
  }
  static async deviceCodeModel(): Promise<typeof DeviceCode> {
    if (_store.deviceCodeModel) return _store.deviceCodeModel
    return (await import('./models/DeviceCode.js')).DeviceCode
  }

  // ── Consent screen hook ─────────────────────────────────

  /**
   * Register a custom consent screen renderer for GET /oauth/authorize.
   * Return a ViewResponse (from @rudderjs/view) or any value the router accepts.
   * When unset, GET /oauth/authorize returns JSON with the validated request.
   */
  static authorizationView(fn: AuthorizationViewFn): void {
    _store.authorizationView = fn
  }

  static authorizationViewFn(): AuthorizationViewFn | null {
    return _store.authorizationView
  }

  // ── Route auto-registration toggle ──────────────────────

  /**
   * Disable route registration. When set, registerPassportRoutes() is a no-op,
   * letting the application wire OAuth routes manually.
   */
  static ignoreRoutes(): void {
    _store.routesIgnored = true
  }

  static routesIgnored(): boolean {
    return _store.routesIgnored
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
  static useIssuer(url: string): void { _store.issuer = url || null }
  static issuer(): string | null { return _store.issuer }

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
    _store.deviceMaxInterval = Math.max(5, Math.floor(seconds))
  }

  /** Current cap on `oauth_device_codes.interval` (seconds). */
  static deviceMaxIntervalSeconds(): number {
    return _store.deviceMaxInterval
  }

  // ── Reset (testing) ─────────────────────────────────────

  /** @internal */
  static reset(): void {
    _store.scopes.clear()
    _store.tokenLifetime         = 15 * 24 * 60 * 60 * 1000
    _store.refreshTokenLifetime  = 30 * 24 * 60 * 60 * 1000
    _store.personalTokenLifetime = 6 * 30 * 24 * 60 * 60 * 1000
    _store.keyPath    = 'storage'
    _store.privateKey = null
    _store.publicKey  = null
    _store.previousPublicKey = null
    _store.clientModel       = null
    _store.tokenModel        = null
    _store.refreshTokenModel = null
    _store.authCodeModel     = null
    _store.deviceCodeModel   = null
    _store.authorizationView = null
    _store.routesIgnored     = false
    _store.issuer            = null
    _store.deviceMaxInterval = 60
  }
}
