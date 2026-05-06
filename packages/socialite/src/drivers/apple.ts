import { SocialiteDriver, type SocialiteDriverConfig, type SocialiteCallbackRequest } from '../driver.js'
import { SocialUser } from '../social-user.js'

/**
 * Apple-specific config. The base `clientSecret` field is unused — Apple
 * requires a freshly-signed ES256 JWT as `client_secret` on each token
 * exchange. Provide `teamId`, `keyId`, and `privateKey` (PEM contents of the
 * `.p8` file downloaded from the Apple Developer portal); the driver mints
 * the JWT just-in-time.
 */
export interface AppleSocialiteConfig extends SocialiteDriverConfig {
  /** Apple Developer Team ID (10 chars). Used as the `iss` claim. */
  teamId?:     string
  /** Sign-in-with-Apple Key ID (10 chars). Embedded in the JWT header as `kid`. */
  keyId?:      string
  /** PEM-encoded EC P-256 private key (the `.p8` file contents). */
  privateKey?: string
  /** Override the JWT lifetime in seconds. Apple max is 6 months; default 5 minutes. */
  clientSecretTtl?: number
}

interface AppleIdTokenClaims {
  sub:    string
  email?: string
  iss?:   string
  aud?:   string | string[]
  exp?:   number
  iat?:   number
  nonce?: string
}

interface AppleJwk {
  kid: string
  kty: string
  alg: string
  n:   string
  e:   string
  use: string
}

const APPLE_ISSUER = 'https://appleid.apple.com'
const APPLE_JWKS   = 'https://appleid.apple.com/auth/keys'
const JWKS_TTL_MS  = 60 * 60 * 1000  // 1 hour
const DEFAULT_JWT_TTL_SECONDS = 5 * 60

interface JwksCacheEntry {
  fetchedAt: number
  keys:      Map<string, AppleJwk>
}

export class AppleProvider extends SocialiteDriver {
  // Process-wide cache shared across AppleProvider instances. JWKS is small
  // and Apple's keys rotate slowly, so a 1h cache is well within their guidance.
  private static _jwksCache: JwksCacheEntry | null = null

  constructor(config: AppleSocialiteConfig) {
    super(config)
  }

  protected defaultScopes(): string[] { return ['name', 'email'] }
  protected authUrl():  string { return 'https://appleid.apple.com/auth/authorize' }
  protected tokenUrl(): string { return 'https://appleid.apple.com/auth/token' }
  // Apple sends user data in the id_token + first-auth form_post body, never a separate user endpoint.
  protected userUrl():  string { return '' }

  protected override extraAuthParams(): Record<string, string> {
    // Apple requires form_post when the requested scopes include `name` or
    // `email` (anything beyond `openid`) — the user-info payload is sent as
    // a POST body, not a query.
    return { response_mode: 'form_post' }
  }

  protected mapToUser(data: Record<string, unknown>, token: string, refreshToken: string | null): SocialUser {
    const sub   = (data['sub'] as string | undefined) ?? ''
    const email = (data['email'] as string | undefined) ?? null
    const name  = data['name'] as { firstName?: string; lastName?: string } | undefined

    return new SocialUser({
      id:       sub,
      name:     name ? [name.firstName, name.lastName].filter(Boolean).join(' ') || null : null,
      email,
      avatar:   null,  // Apple doesn't provide avatars
      nickname: null,
      token,
      refreshToken,
      raw: data,
    })
  }

  /**
   * Exchange the auth code with Apple in a single POST, verify the returned
   * id_token, and merge any first-authorization user details from the
   * form_post body. Apple's auth codes are single-use, so this driver does
   * NOT call the inherited `getAccessToken` — the token endpoint is hit
   * exactly once per callback.
   */
  override async user(codeOrRequest: string | SocialiteCallbackRequest): Promise<SocialUser> {
    if (typeof codeOrRequest !== 'string') {
      // Apple's `state` arrives in the form_post body, not the query — the
      // base validator already checks both, no Apple-specific override needed.
      this.validateRequestState(codeOrRequest)
    }

    const code = typeof codeOrRequest === 'string'
      ? codeOrRequest
      : (codeOrRequest.query['code'] ?? (codeOrRequest.body as Record<string, string> | undefined)?.['code'])

    if (!code) throw new Error('[RudderJS Socialite] Missing authorization code.')

    const { accessToken, refreshToken, idToken } = await this._exchange(code)
    const claims = await this._verifyIdToken(idToken)

    const userData: Record<string, unknown> = { ...claims }

    // First authorization only — Apple sends `name` once, in the form_post body.
    if (typeof codeOrRequest !== 'string' && codeOrRequest.body) {
      const body = codeOrRequest.body as Record<string, unknown>
      const userField = body['user']
      if (userField !== undefined) {
        try {
          const parsed = typeof userField === 'string' ? JSON.parse(userField) : userField
          if (parsed && typeof parsed === 'object' && 'name' in (parsed as Record<string, unknown>)) {
            userData['name'] = (parsed as Record<string, unknown>)['name']
          }
        } catch {
          // Malformed body.user — ignore, name simply won't be set.
        }
      }
    }

    return this.mapToUser(userData, accessToken, refreshToken)
  }

  // ─── Token exchange ────────────────────────────────────

  private async _exchange(code: string): Promise<{ accessToken: string; refreshToken: string | null; idToken: string }> {
    const clientSecret = await this._buildClientSecret()

    const res = await this.fetchWithTimeout(this.tokenUrl(), {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept':       'application/json',
      },
      body: new URLSearchParams({
        client_id:     this.config.clientId,
        client_secret: clientSecret,
        code,
        redirect_uri:  this.config.redirectUrl,
        grant_type:    'authorization_code',
      }),
    })

    if (!res.ok) {
      throw await this.httpError('Apple token exchange failed', res)
    }

    const data = await res.json() as Record<string, unknown>

    const accessToken  = data['access_token']
    const refreshToken = data['refresh_token']
    const idToken      = data['id_token']

    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('[RudderJS Socialite] Apple token-exchange response missing access_token.')
    }
    if (typeof idToken !== 'string' || idToken.length === 0) {
      throw new Error('[RudderJS Socialite] Apple token-exchange response missing id_token.')
    }

    return {
      accessToken,
      refreshToken: typeof refreshToken === 'string' && refreshToken.length > 0 ? refreshToken : null,
      idToken,
    }
  }

  // ─── O2: ES256 client_secret JWT ───────────────────────

  /**
   * Build a freshly-signed ES256 JWT to use as `client_secret` for Apple's
   * token endpoint. Apple requires JWS spec signatures — IEEE P-1363 raw
   * (r||s, 64 bytes), NOT DER. node:crypto's `createSign` defaults to DER
   * for EC keys, so `dsaEncoding: 'ieee-p1363'` is mandatory.
   */
  private async _buildClientSecret(): Promise<string> {
    const cfg = this.config as AppleSocialiteConfig
    if (!cfg.teamId || !cfg.keyId || !cfg.privateKey) {
      throw new Error(
        '[RudderJS Socialite] Apple requires `teamId`, `keyId`, and `privateKey` ' +
        'in config to sign the client_secret JWT. See https://developer.apple.com/sign-in-with-apple/.',
      )
    }

    const { createPrivateKey, createSign } = await import('node:crypto')

    const now = Math.floor(Date.now() / 1000)
    const ttl = cfg.clientSecretTtl ?? DEFAULT_JWT_TTL_SECONDS

    const header  = { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' }
    const payload = {
      iss: cfg.teamId,
      iat: now,
      exp: now + ttl,
      aud: APPLE_ISSUER,
      sub: this.config.clientId,
    }

    const headerB64    = Buffer.from(JSON.stringify(header)).toString('base64url')
    const payloadB64   = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signingInput = `${headerB64}.${payloadB64}`

    let key
    try {
      key = createPrivateKey({ key: cfg.privateKey, format: 'pem' })
    } catch (err) {
      throw new Error(
        '[RudderJS Socialite] Apple `privateKey` is not a valid PEM-encoded EC private key. ' +
        '(See `.p8` file from Apple Developer portal.)',
        { cause: err },
      )
    }
    if (key.asymmetricKeyType !== 'ec') {
      throw new Error(
        `[RudderJS Socialite] Apple expects an EC P-256 private key; got ${key.asymmetricKeyType ?? 'unknown'}.`,
      )
    }

    const signer = createSign('SHA256')
    signer.update(signingInput)
    const signature = signer.sign({ key, dsaEncoding: 'ieee-p1363' }, 'base64url')

    return `${signingInput}.${signature}`
  }

  // ─── O3: id_token verification ─────────────────────────

  /**
   * Verify Apple's id_token: signature against the JWKS-resolved public key,
   * then issuer / audience / expiration claims. Throws on any failure —
   * never returns unverified data.
   */
  private async _verifyIdToken(idToken: string): Promise<AppleIdTokenClaims> {
    const parts = idToken.split('.')
    if (parts.length !== 3) {
      throw new Error('[RudderJS Socialite] Apple id_token: malformed (expected 3 segments).')
    }
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string]

    let header: { alg?: string; kid?: string }
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as { alg?: string; kid?: string }
    } catch {
      throw new Error('[RudderJS Socialite] Apple id_token: header is not valid JSON.')
    }

    if (header.alg !== 'RS256') {
      throw new Error(`[RudderJS Socialite] Apple id_token: unexpected alg "${header.alg ?? ''}" (expected RS256).`)
    }
    if (typeof header.kid !== 'string' || header.kid.length === 0) {
      throw new Error('[RudderJS Socialite] Apple id_token: header missing `kid`.')
    }

    const jwk = await this._resolveAppleJwk(header.kid)
    if (!jwk) {
      throw new Error(`[RudderJS Socialite] Apple id_token: no signing key for kid "${header.kid}".`)
    }

    const { createPublicKey, createVerify } = await import('node:crypto')

    let publicKey
    try {
      // node:crypto's createPublicKey accepts a JsonWebKey from lib.dom; this
      // package targets Node and doesn't include DOM lib, so widen via
      // `as never` (bottom type, assignable to the parameter's expected type).
      publicKey = createPublicKey({ key: jwk as never, format: 'jwk' })
    } catch (err) {
      throw new Error('[RudderJS Socialite] Apple id_token: failed to import JWKS public key.', { cause: err })
    }

    const verifier = createVerify('SHA256')
    verifier.update(`${headerB64}.${payloadB64}`)
    if (!verifier.verify(publicKey, signatureB64, 'base64url')) {
      throw new Error('[RudderJS Socialite] Apple id_token: signature verification failed.')
    }

    let claims: AppleIdTokenClaims
    try {
      claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as AppleIdTokenClaims
    } catch {
      throw new Error('[RudderJS Socialite] Apple id_token: payload is not valid JSON.')
    }

    if (claims.iss !== APPLE_ISSUER) {
      throw new Error(`[RudderJS Socialite] Apple id_token: iss "${claims.iss ?? ''}" does not match "${APPLE_ISSUER}".`)
    }

    const expectedAud = this.config.clientId
    const audMatches = Array.isArray(claims.aud)
      ? claims.aud.includes(expectedAud)
      : claims.aud === expectedAud
    if (!audMatches) {
      throw new Error('[RudderJS Socialite] Apple id_token: aud does not match clientId.')
    }

    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
      throw new Error('[RudderJS Socialite] Apple id_token: token expired or missing exp.')
    }

    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new Error('[RudderJS Socialite] Apple id_token: missing sub.')
    }

    return claims
  }

  private async _resolveAppleJwk(kid: string): Promise<AppleJwk | undefined> {
    const cache = AppleProvider._jwksCache
    if (cache && Date.now() - cache.fetchedAt < JWKS_TTL_MS) {
      const hit = cache.keys.get(kid)
      if (hit) return hit
      // Fall through — kid not in cache. Apple may have rotated; refetch.
    }

    const res = await this.fetchWithTimeout(APPLE_JWKS, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      throw await this.httpError('Apple JWKS fetch failed', res)
    }

    const body = await res.json() as { keys?: AppleJwk[] }
    const keys = Array.isArray(body.keys) ? body.keys : []
    const map  = new Map<string, AppleJwk>()
    for (const k of keys) {
      if (typeof k.kid === 'string') map.set(k.kid, k)
    }

    AppleProvider._jwksCache = { fetchedAt: Date.now(), keys: map }
    return map.get(kid)
  }

  /** @internal — testing only. */
  static _resetJwksCache(): void {
    AppleProvider._jwksCache = null
  }
}
