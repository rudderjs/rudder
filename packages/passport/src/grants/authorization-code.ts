import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'
import type { AuthCode }    from '../models/AuthCode.js'
import { clientHelpers, authCodeHelpers } from '../models/helpers.js'
import { safeCompare } from './safe-compare.js'
import { verifyClientSecret } from '../client-secret.js'
import { hashOpaqueToken, newOpaqueToken } from '../opaque-token.js'
import { issueTokens, type IssuedTokens } from './issue-tokens.js'

// ─── Authorization Request Validation ─────────────────────

export interface AuthorizationRequest {
  clientId:      string
  redirectUri:   string
  responseType:  string
  scope:         string
  state?:        string
  codeChallenge?: string
  codeChallengeMethod?: string
}

export interface ValidatedAuthRequest {
  client:        OAuthClient
  redirectUri:   string
  scopes:        string[]
  state?:        string
  codeChallenge?: string
  codeChallengeMethod?: string
}

/**
 * Validate an authorization request (GET /oauth/authorize).
 * Returns the validated request or throws with an error message.
 */
export async function validateAuthorizationRequest(params: AuthorizationRequest): Promise<ValidatedAuthRequest> {
  if (params.responseType !== 'code') {
    throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported.')
  }

  const ClientCls = await Passport.clientModel()
  const client = await ClientCls.where('id', params.clientId).first() as OAuthClient | null
  if (!client || client.revoked) {
    throw new OAuthError('invalid_client', 'Client not found.')
  }

  if (!clientHelpers.hasGrantType(client, 'authorization_code')) {
    throw new OAuthError('unauthorized_client', 'Client is not authorized for authorization_code grant.')
  }

  if (!clientHelpers.hasRedirectUri(client, params.redirectUri)) {
    throw new OAuthError('invalid_request', 'Invalid redirect_uri.')
  }

  // PKCE validation
  if (params.codeChallenge) {
    const method = params.codeChallengeMethod ?? 'S256'
    if (method !== 'S256' && method !== 'plain') {
      throw new OAuthError('invalid_request', 'Unsupported code_challenge_method. Use S256 or plain.')
    }
    // Public clients must use S256. RFC 7636 §4.4.1 + OAuth 2.0 BCP recommend
    // S256 over `plain` because `plain` makes verifier == challenge — a stolen
    // authorization code is already enough to mint tokens, defeating PKCE's
    // entire purpose. Confidential clients keep the `plain` option for
    // backward-compat with non-RFC-7636-compliant integrations.
    if (method === 'plain' && clientHelpers.isPublic(client)) {
      throw new OAuthError('invalid_request', 'Public clients must use code_challenge_method=S256.')
    }
  } else if (clientHelpers.isPublic(client)) {
    // Public clients MUST use PKCE
    throw new OAuthError('invalid_request', 'Public clients must use PKCE (code_challenge required).')
  }

  const scopes = params.scope ? params.scope.split(' ').filter(Boolean) : []
  validateScopes(client, scopes)

  const result: ValidatedAuthRequest = {
    client,
    redirectUri: params.redirectUri,
    scopes,
  }
  if (params.state !== undefined) result.state = params.state
  if (params.codeChallenge !== undefined) result.codeChallenge = params.codeChallenge
  const method = params.codeChallengeMethod ?? (params.codeChallenge ? 'S256' : undefined)
  if (method !== undefined) result.codeChallengeMethod = method

  return result
}

// ─── Issue Authorization Code ─────────────────────────────

/**
 * Create an authorization code after user approval.
 * The code is short-lived (10 minutes) and single-use.
 */
export async function issueAuthCode(opts: {
  userId:    string
  clientId:  string
  scopes:    string[]
  redirectUri: string
  codeChallenge?: string
  codeChallengeMethod?: string
}): Promise<string> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  // M5/P6: the plaintext returned to the redirect URI is freshly generated
  // CSPRNG hex; only its SHA-256 is persisted. The previous shape returned
  // the row's cuid `id` directly, so a DB read leak handed every in-flight
  // auth code to anyone with `SELECT * ON oauth_auth_codes` privilege.
  const codePlaintext = await newOpaqueToken()
  const codeHash      = await hashOpaqueToken(codePlaintext)

  const AuthCodeCls = await Passport.authCodeModel()
  await AuthCodeCls.create({
    userId:              opts.userId,
    clientId:            opts.clientId,
    tokenHash:           codeHash,
    scopes:              JSON.stringify(opts.scopes),
    revoked:             false,
    expiresAt,
    redirectUri:         opts.redirectUri,
    codeChallenge:       opts.codeChallenge ?? null,
    codeChallengeMethod: opts.codeChallengeMethod ?? null,
  } as Record<string, unknown>)

  return codePlaintext
}

// ─── Exchange Authorization Code for Tokens ───────────────

export interface TokenExchangeRequest {
  grantType:    string
  code:         string
  clientId:     string
  clientSecret?: string
  redirectUri:  string
  codeVerifier?: string
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeAuthCode(params: TokenExchangeRequest): Promise<IssuedTokens> {
  if (params.grantType !== 'authorization_code') {
    throw new OAuthError('unsupported_grant_type', 'Expected grant_type=authorization_code.')
  }

  const ClientCls   = await Passport.clientModel()
  const AuthCodeCls = await Passport.authCodeModel()

  // Validate client. RFC 6749 §5.2 — client authentication failures at
  // the token endpoint MUST return HTTP 401 with a `WWW-Authenticate`
  // header (the latter is set in routes.ts on 401 responses). The
  // refresh-token and client-credentials grants already return 401 here
  // — auth-code was the inconsistent outlier.
  const client = await ClientCls.where('id', params.clientId).first() as OAuthClient | null
  if (!client || client.revoked) {
    throw new OAuthError('invalid_client', 'Client not found.', 401)
  }

  // Confidential clients must provide a valid secret
  if (client.confidential) {
    if (!params.clientSecret) {
      throw new OAuthError('invalid_client', 'Client secret required.', 401)
    }
    // Schema allows `client.secret` to be null; explicit guard so a future
    // refactor can't mask `secret = null` as authenticating. See
    // `client-credentials.ts` for the longer-form rationale.
    if (client.secret == null) {
      throw new OAuthError('invalid_client', 'Confidential client has no secret on file.', 401)
    }
    if (!(await verifyClientSecret(params.clientSecret, client.secret))) {
      throw new OAuthError('invalid_client', 'Invalid client secret.', 401)
    }
  }

  // Validate auth code by hashed plaintext (M5/P6) — the row's `id` is no
  // longer the bearer secret. Pre-migration codes won't match because their
  // hashed form was never persisted; affected exchanges fall through to the
  // 10-minute TTL drain window and the user simply re-clicks "Authorize".
  const codeHash = await hashOpaqueToken(params.code)
  const authCode = await AuthCodeCls.where('tokenHash', codeHash).first() as AuthCode | null
  if (!authCode) {
    throw new OAuthError('invalid_grant', 'Authorization code not found.')
  }
  if (authCode.revoked) {
    throw new OAuthError('invalid_grant', 'Authorization code has been revoked.')
  }
  if (authCodeHelpers.isExpired(authCode)) {
    throw new OAuthError('invalid_grant', 'Authorization code has expired.')
  }
  if (authCode.clientId !== params.clientId) {
    throw new OAuthError('invalid_grant', 'Authorization code was not issued to this client.')
  }

  // RFC 6749 §4.1.3 — if a redirect_uri was bound at issuance, the exchange
  // MUST present an identical value. Without this binding, an auth code
  // obtained through one approved redirect can be exchanged via any other
  // redirect registered to the same client, breaking the OAuth threat model.
  // `redirectUri` is null only for codes issued before this column existed
  // (≤10-minute legacy compat window after the migration lands).
  if (authCode.redirectUri !== null && authCode.redirectUri !== undefined) {
    if (!params.redirectUri) {
      throw new OAuthError('invalid_grant', 'redirect_uri is required for this authorization code.')
    }
    if (authCode.redirectUri !== params.redirectUri) {
      throw new OAuthError('invalid_grant', 'redirect_uri does not match the value used at authorization time.')
    }
  }

  // PKCE verification
  if (authCode.codeChallenge) {
    if (!params.codeVerifier) {
      throw new OAuthError('invalid_grant', 'PKCE code_verifier required.')
    }

    const { createHash } = await import('node:crypto')
    let expected: string

    if (authCode.codeChallengeMethod === 'S256') {
      expected = createHash('sha256')
        .update(params.codeVerifier)
        .digest('base64url')
    } else {
      // plain
      expected = params.codeVerifier
    }

    // Constant-time compare; both sides are equal-length encodings (S256 →
    // base64url SHA-256, plain → identity). On mismatch the helper short-
    // circuits the length check first, but the equal-length common path
    // runs the full timingSafeEqual.
    if (!(await safeCompare(expected, authCode.codeChallenge))) {
      throw new OAuthError('invalid_grant', 'PKCE code_verifier does not match.')
    }
  }

  // Atomically consume the auth code (M3). RFC 6749 §4.1.2 requires
  // single-use codes. Without a conditional update, two concurrent
  // exchanges of the same code can BOTH read `revoked=false`, BOTH pass
  // PKCE / redirect_uri / client checks, and BOTH issue tokens. The
  // unconditional update used previously was idempotent at the SQL level,
  // so the second writer didn't see any error. We use a conditional
  // `where('revoked', false).updateAll(...)` instead — the underlying
  // `UPDATE ... WHERE revoked = false` is atomic in every SQL backend, so
  // exactly one caller observes `count === 1`; the rest see `count === 0`
  // and surface `invalid_grant`. (Tokens already minted from a prior
  // successful exchange of the same code are NOT retroactively revoked
  // here — that's a separate hardening, RFC §4.1.2's SHOULD clause.)
  const consumed = await AuthCodeCls
    .where('id', authCode.id)
    .where('revoked', false)
    .updateAll({ revoked: true } as Record<string, unknown>)
  if (consumed === 0) {
    throw new OAuthError('invalid_grant', 'Authorization code has already been used.')
  }

  // Issue tokens
  return issueTokens({
    userId:   authCode.userId,
    clientId: params.clientId,
    scopes:   authCodeHelpers.getScopes(authCode),
    includeRefresh: true,
  })
}

// ─── Scope validation ─────────────────────────────────────

/**
 * Validate requested scopes against two gates and throw `invalid_scope` per
 * RFC 6749 §3.3 if any requested scope fails either:
 *
 *   1. **Global registry** — declared via `Passport.tokensCan({...})`.
 *      Rejects scopes the operator hasn't acknowledged exist.
 *   2. **Per-client allow-list** — `client.scopes`. Rejects scopes outside
 *      the operator-configured subset for this specific client.
 *
 * Each gate is **only enforced when populated**:
 *   - Empty global registry → no global gate (treated as "scopes not yet
 *     declared"). Matches Laravel Passport's "no scopes defined → permissive"
 *     default; existing apps that haven't called `tokensCan()` won't break.
 *   - Empty `client.scopes` → no per-client gate ("client may request any
 *     globally-known scope"). The vast majority of clients leave this empty.
 *
 * Used by the auth-code, device-code, and client-credentials grants. Refresh
 * token already has its own narrowing logic (can only narrow vs. the original
 * issuance, never widen) and skips this helper.
 *
 * The `*` wildcard is always allowed — same convention as `Passport.validScopes()`.
 */
export function validateScopes(client: OAuthClient, requested: string[]): void {
  if (requested.length === 0) return

  const registered = Passport.scopes()
  if (registered.length > 0) {
    const validIds = new Set(registered.map(s => s.id))
    const unknown = requested.filter(s => s !== '*' && !validIds.has(s))
    if (unknown.length > 0) {
      throw new OAuthError(
        'invalid_scope',
        `The requested scope is invalid, unknown, or malformed: ${unknown.join(' ')}.`,
      )
    }
  }

  const clientScopes = clientHelpers.getScopes(client)
  if (clientScopes.length > 0) {
    const allow = new Set(clientScopes)
    const denied = requested.filter(s => s !== '*' && !allow.has(s))
    if (denied.length > 0) {
      throw new OAuthError(
        'invalid_scope',
        `The requested scope is not authorized for this client: ${denied.join(' ')}.`,
      )
    }
  }
}

// ─── OAuth Error ──────────────────────────────────────────

export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly errorDescription: string,
    public readonly statusCode: number = 400,
  ) {
    super(errorDescription)
    this.name = 'OAuthError'
  }

  toJSON(): Record<string, string> {
    return {
      error: this.error,
      error_description: this.errorDescription,
    }
  }
}
