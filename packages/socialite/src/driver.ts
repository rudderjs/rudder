import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Session } from '@rudderjs/session'
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
const STATE_BYTES        = 20

/** Detail attached to OAuth provider errors via `Error.cause`. */
export interface SocialiteHttpErrorCause {
  status: number
  body:   string
}

/**
 * Thrown when an OAuth callback's `state` parameter is missing, doesn't
 * match the value the framework stored before redirect, or arrives without
 * a session in context. Indicates a CSRF / state-fixation attempt — apps
 * should treat as auth failure.
 */
export class InvalidStateException extends Error {
  constructor(message = 'OAuth state mismatch — possible CSRF attack.') {
    super(`[RudderJS Socialite] ${message}`)
    this.name = 'InvalidStateException'
  }
}

/** Shape of the request object accepted by `user()` and `validateRequestState`. */
export interface SocialiteCallbackRequest {
  query: Record<string, string>
  body?: unknown
}

export abstract class SocialiteDriver {
  protected scopes: string[]
  private _stateless = false

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

  /**
   * Provider key used to namespace the session state slot. Defaults to the
   * lowercase class name with a trailing `provider` stripped (e.g. `GitHubProvider`
   * → `github`). Override on a subclass if a custom key is preferred.
   */
  protected providerName(): string {
    return this.constructor.name.toLowerCase().replace(/provider$/, '')
  }

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

  /**
   * Disable state generation + validation (Laravel `->stateless()`).
   *
   * Use for OAuth flows that can't reach the session — e.g. mobile clients,
   * machine-to-machine auth, or token grants where the round-trip happens
   * entirely server-to-server. The default (stateful) generates a CSPRNG
   * `state` on redirect, stores it in the session, and validates it on
   * callback to prevent CSRF / state-fixation.
   */
  stateless(): this {
    this._stateless = true
    return this
  }

  isStateless(): boolean {
    return this._stateless
  }

  /**
   * Provider-specific extra params to merge into the authorize URL. Apple
   * needs `response_mode=form_post`; other drivers may want `prompt=consent`
   * etc. Override on subclasses — base returns `{}`.
   */
  protected extraAuthParams(): Record<string, string> {
    return {}
  }

  /** Get the redirect URL to the OAuth provider. */
  getRedirectUrl(state?: string): string {
    // Caller-supplied state always wins (test-friendly + advanced override).
    // When stateful and no state is supplied, generate + persist one.
    const stateValue = state ?? (this._stateless ? undefined : this.generateAndStoreState())

    const params = new URLSearchParams({
      client_id:     this.config.clientId,
      redirect_uri:  this.config.redirectUrl,
      response_type: 'code',
      scope:         this.scopes.join(' '),
      ...(stateValue ? { state: stateValue } : {}),
      ...this.extraAuthParams(),
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
  async user(codeOrRequest: string | SocialiteCallbackRequest): Promise<SocialUser> {
    if (typeof codeOrRequest !== 'string') {
      this.validateRequestState(codeOrRequest)
    }

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

  // ─── State (CSRF defense) ───────────────────────────────

  private get stateKey(): string {
    return `socialite_state:${this.providerName()}`
  }

  /**
   * Generate a CSPRNG state token, store it on the session, and return the
   * value to embed in the authorize URL. Throws when no session is in
   * context — the caller can opt out via `.stateless()`.
   */
  private generateAndStoreState(): string {
    if (!Session.active()) {
      throw new Error(
        '[RudderJS Socialite] Cannot generate OAuth state: no session in context. ' +
        'Register session middleware (auto-installed on the web group), or call ' +
        '`.stateless()` on the driver if state validation is intentionally skipped.',
      )
    }
    const value = randomBytes(STATE_BYTES).toString('hex')
    Session.put(this.stateKey, value)
    return value
  }

  /**
   * Validate the `state` carried in a callback request against what was
   * stored at redirect time. Pulls from `query.state` first, falling back
   * to the request body's `state` (used by Apple's `form_post` callback).
   * Always forgets the stored value after validation — the state is
   * one-time use, so a leaked state can't be replayed.
   */
  protected validateRequestState(req: SocialiteCallbackRequest): void {
    if (this._stateless) return

    if (!Session.active()) {
      throw new InvalidStateException(
        'No session in context for state validation. Register session middleware ' +
        'or use `.stateless()` if state validation is intentionally skipped.',
      )
    }

    const stored = Session.get<string>(this.stateKey)
    Session.forget(this.stateKey)

    const provided = this.extractState(req)

    if (
      typeof stored   !== 'string' || stored.length   === 0 ||
      typeof provided !== 'string' || provided.length === 0 ||
      !this.constantTimeStringEqual(stored, provided)
    ) {
      throw new InvalidStateException()
    }
  }

  private extractState(req: SocialiteCallbackRequest): string | undefined {
    const fromQuery = req.query['state']
    if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery

    const body = req.body
    if (body && typeof body === 'object') {
      const fromBody = (body as Record<string, unknown>)['state']
      if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody
    }
    return undefined
  }

  private constantTimeStringEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    const ab = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    return timingSafeEqual(ab, bb)
  }

  /**
   * Build an Error whose `message` carries only status + statusText (safe to
   * surface in logs), with the response body attached on `cause` so callers
   * that need it can still inspect — without leaking provider-echoed
   * client_id / hints / PII into top-level error tracking.
   */
  protected async httpError(prefix: string, res: Response): Promise<Error> {
    const body = await res.text().catch(() => '')
    const cause: SocialiteHttpErrorCause = { status: res.status, body }
    return new Error(`[RudderJS Socialite] ${prefix}: ${res.status} ${res.statusText}`.trimEnd(), { cause })
  }
}
