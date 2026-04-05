import { SocialiteProvider } from '../provider.js'
import { SocialUser } from '../social-user.js'

export class AppleProvider extends SocialiteProvider {
  protected defaultScopes(): string[] { return ['name', 'email'] }
  protected authUrl():  string { return 'https://appleid.apple.com/auth/authorize' }
  protected tokenUrl(): string { return 'https://appleid.apple.com/auth/token' }
  protected userUrl():  string { return '' } // Apple sends user data in the callback, not a separate endpoint

  getRedirectUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id:     this.config.clientId,
      redirect_uri:  this.config.redirectUrl,
      response_type: 'code',
      response_mode: 'form_post',
      scope:         this.scopes.join(' '),
      ...(state ? { state } : {}),
    })
    return `${this.authUrl()}?${params.toString()}`
  }

  protected mapToUser(data: Record<string, unknown>, token: string, refreshToken: string | null): SocialUser {
    // Apple's id_token contains the user info as a JWT
    const sub   = (data['sub'] as string | undefined) ?? ''
    const email = (data['email'] as string | undefined) ?? null
    const name  = (data['name'] as { firstName?: string; lastName?: string } | undefined)

    return new SocialUser({
      id:       sub,
      name:     name ? [name.firstName, name.lastName].filter(Boolean).join(' ') || null : null,
      email,
      avatar:   null, // Apple doesn't provide avatars
      nickname: null,
      token,
      refreshToken,
      raw: data,
    })
  }

  /** Apple sends user data as form POST on callback. Parse the id_token JWT for user info. */
  async user(codeOrRequest: string | { query: Record<string, string>; body?: unknown }): Promise<SocialUser> {
    const code = typeof codeOrRequest === 'string'
      ? codeOrRequest
      : (codeOrRequest.query['code'] ?? (codeOrRequest.body as Record<string, string> | undefined)?.['code'])

    if (!code) throw new Error('[RudderJS Socialite] Missing authorization code.')

    const { accessToken, refreshToken } = await this.getAccessToken(code)

    // Decode id_token (JWT) for user info — no verification needed here,
    // Apple's token endpoint is trusted.
    const idToken = (await this.getIdToken(code)) ?? {}
    const userData: Record<string, unknown> = { ...idToken }

    // Apple sends user name only on first authorization (as form POST body)
    if (typeof codeOrRequest !== 'string' && codeOrRequest.body) {
      const body = codeOrRequest.body as Record<string, unknown>
      if (body['user']) {
        const user = typeof body['user'] === 'string' ? JSON.parse(body['user']) : body['user']
        userData['name'] = user
      }
    }

    return this.mapToUser(userData, accessToken, refreshToken)
  }

  private async getIdToken(code: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(this.tokenUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri:  this.config.redirectUrl,
          grant_type:    'authorization_code',
        }),
      })
      if (!res.ok) return null
      const data = await res.json() as { id_token?: string }
      if (!data.id_token) return null
      // Decode JWT payload (base64url)
      const payload = data.id_token.split('.')[1]
      if (!payload) return null
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  }
}
