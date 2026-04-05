import { SocialUser } from './social-user.js'

// ─── Provider Contract ────────────────────────────────────

export interface SocialiteProviderConfig {
  clientId:     string
  clientSecret: string
  redirectUrl:  string
  scopes?:      string[]
}

export abstract class SocialiteProvider {
  protected scopes: string[]

  constructor(protected readonly config: SocialiteProviderConfig) {
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

  /** Exchange the authorization code for an access token. */
  async getAccessToken(code: string): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number | null }> {
    const res = await fetch(this.tokenUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
      body: JSON.stringify({
        client_id:     this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri:  this.config.redirectUrl,
        grant_type:    'authorization_code',
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`[RudderJS Socialite] Token exchange failed: ${res.status} ${text}`)
    }

    const data = await res.json() as Record<string, unknown>

    // Some providers return access_token, others return it in different shapes
    const accessToken  = (data['access_token']  ?? data['accessToken']) as string | undefined
    const refreshToken = (data['refresh_token'] ?? data['refreshToken']) as string | undefined
    const expiresIn    = (data['expires_in']    ?? data['expiresIn']) as number | undefined

    if (!accessToken) {
      throw new Error(`[RudderJS Socialite] No access_token in response: ${JSON.stringify(data)}`)
    }

    return { accessToken, refreshToken: refreshToken ?? null, expiresIn: expiresIn ?? null }
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
    const res = await fetch(this.userUrl(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/json',
      },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`[RudderJS Socialite] User info request failed: ${res.status} ${text}`)
    }

    const data = await res.json() as Record<string, unknown>
    return this.mapToUser(data, token, refreshToken ?? null)
  }
}
