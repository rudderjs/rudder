import { SocialUser } from './social-user.js'

// ─── Driver Contract ──────────────────────────────────────

export interface SocialiteDriverConfig {
  clientId:     string
  clientSecret: string
  redirectUrl:  string
  scopes?:      string[]
  /** Per-request HTTP timeout in milliseconds (default 10_000). */
  timeout?:     number
}

const DEFAULT_TIMEOUT_MS = 10_000

/** Detail attached to OAuth provider errors via `Error.cause`. */
export interface SocialiteHttpErrorCause {
  status: number
  body:   string
}

export abstract class SocialiteDriver {
  protected scopes: string[]

  constructor(protected readonly config: SocialiteDriverConfig) {
    this.scopes = config.scopes ?? this.defaultScopes()
  }

  /** Default scopes for this provider. */
  protected abstract defaultScopes(): string[]

  /** OAuth authorize URL (e.g. https://github.com/login/oauth/authorize). */
  protected abstract authUrl(): string

  /** OAuth token URL (e.g. https://github.com/login/oauth/access_token). */
  protected abstract tokenUrl(): string

  /** User info URL (e.g. https://api.github.com/user). */
  protected abstract userUrl(): string

  /** Parse the provider's user API response into a SocialUser. */
  protected abstract mapToUser(data: Record<string, unknown>, token: string, refreshToken: string | null): SocialUser

  /** Add extra scopes. */
  withScopes(scopes: string[]): this {
    this.scopes = [...new Set([...this.scopes, ...scopes])]
    return this
  }

  /** Set scopes (replacing defaults). */
  setScopes(scopes: string[]): this {
    this.scopes = scopes
    return this
  }

  /** Get the redirect URL to the OAuth provider. */
  getRedirectUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id:     this.config.clientId,
      redirect_uri:  this.config.redirectUrl,
      response_type: 'code',
      scope:         this.scopes.join(' '),
      ...(state ? { state } : {}),
    })
    return `${this.authUrl()}?${params.toString()}`
  }

  /** Redirect the response to the OAuth provider. */
  redirect(state?: string): Response {
    return Response.redirect(this.getRedirectUrl(state), 302)
  }

  /**
   * Wrapper around `fetch` that injects an `AbortSignal.timeout` so a hung
   * provider endpoint can't keep the request handler alive indefinitely.
   * Subclasses (Apple, GitHub) call this for their own provider fetches.
   */
  protected fetchWithTimeout(
    input: Parameters<typeof fetch>[0],
    init: RequestInit = {},
  ): Promise<Response> {
    const timeoutMs = this.config.timeout ?? DEFAULT_TIMEOUT_MS
    return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) })
  }

  /** Exchange the authorization code for an access token. */
  async getAccessToken(code: string): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number | null }> {
    // RFC 6749 §4.1.3 mandates `application/x-www-form-urlencoded` for the
    // token endpoint. GitHub, Google, and Facebook all reject JSON bodies
    // (or accept them inconsistently); Apple's override already form-encodes.
    const res = await this.fetchWithTimeout(this.tokenUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept':       'application/json',
      },
      body: new URLSearchParams({
        client_id:     this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri:  this.config.redirectUrl,
        grant_type:    'authorization_code',
      }),
    })

    if (!res.ok) {
      throw await this.httpError('Token exchange failed', res)
    }

    const data = await res.json() as Record<string, unknown>

    // Provider response is JSON of unknown shape — type-check before trusting.
    // Some providers use snake_case, some camelCase; either is fine, but the
    // value must be a non-empty string. Anything else (number, null, object,
    // empty string) is treated as a missing token.
    const rawToken      = data['access_token']  ?? data['accessToken']
    const rawRefresh    = data['refresh_token'] ?? data['refreshToken']
    const rawExpiresIn  = data['expires_in']    ?? data['expiresIn']

    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new Error('[RudderJS Socialite] No access_token in token-exchange response.')
    }

    const refreshToken = typeof rawRefresh   === 'string' && rawRefresh.length > 0 ? rawRefresh   : null
    const expiresIn    = typeof rawExpiresIn === 'number' && Number.isFinite(rawExpiresIn) ? rawExpiresIn : null

    return { accessToken: rawToken, refreshToken, expiresIn }
  }

  /** Get the authenticated user from the OAuth callback. */
  async user(codeOrRequest: string | { query: Record<string, string> }): Promise<SocialUser> {
    const code = typeof codeOrRequest === 'string'
      ? codeOrRequest
      : codeOrRequest.query['code']

    if (!code) throw new Error('[RudderJS Socialite] Missing authorization code.')

    const { accessToken, refreshToken } = await this.getAccessToken(code)
    return this.getUserByToken(accessToken, refreshToken)
  }

  /** Get the user directly from an access token (e.g. for mobile apps). */
  async getUserByToken(token: string, refreshToken?: string | null): Promise<SocialUser> {
    const res = await this.fetchWithTimeout(this.userUrl(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/json',
      },
    })

    if (!res.ok) {
      throw await this.httpError('User info request failed', res)
    }

    const data = await res.json() as Record<string, unknown>
    return this.mapToUser(data, token, refreshToken ?? null)
  }

  /**
   * Build an Error whose `message` carries only status + statusText (safe to
   * surface in logs), with the response body attached on `cause` so callers
   * that need it can still inspect — without leaking provider-echoed
   * client_id / hints / PII into top-level error tracking.
   */
  private async httpError(prefix: string, res: Response): Promise<Error> {
    const body = await res.text().catch(() => '')
    const cause: SocialiteHttpErrorCause = { status: res.status, body }
    return new Error(`[RudderJS Socialite] ${prefix}: ${res.status} ${res.statusText}`.trimEnd(), { cause })
  }
}
