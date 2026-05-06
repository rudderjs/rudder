import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'
import type { AuthCode }    from '../models/AuthCode.js'
import { clientHelpers, authCodeHelpers } from '../models/helpers.js'
import { safeCompare } from './safe-compare.js'
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

  if (!clientHelpers.hasGrantType(client as any, 'authorization_code')) {
    throw new OAuthError('unauthorized_client', 'Client is not authorized for authorization_code grant.')
  }

  if (!clientHelpers.hasRedirectUri(client as any, params.redirectUri)) {
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
    if (method === 'plain' && clientHelpers.isPublic(client as any)) {
      throw new OAuthError('invalid_request', 'Public clients must use code_challenge_method=S256.')
    }
  } else if (clientHelpers.isPublic(client as any)) {
    // Public clients MUST use PKCE
    throw new OAuthError('invalid_request', 'Public clients must use PKCE (code_challenge required).')
  }

  const scopes = params.scope ? params.scope.split(' ').filter(Boolean) : []

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

  const AuthCodeCls = await Passport.authCodeModel()
  const code = await AuthCodeCls.create({
    userId:              opts.userId,
    clientId:            opts.clientId,
    scopes:              JSON.stringify(opts.scopes),
    revoked:             false,
    expiresAt,
    redirectUri:         opts.redirectUri,
    codeChallenge:       opts.codeChallenge ?? null,
    codeChallengeMethod: opts.codeChallengeMethod ?? null,
  } as Record<string, unknown>) as AuthCode

  return (code as any).id as string
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
    const { createHash } = await import('node:crypto')
    const hashed = createHash('sha256').update(params.clientSecret).digest('hex')
    if (!(await safeCompare(hashed, client.secret))) {
      throw new OAuthError('invalid_client', 'Invalid client secret.', 401)
    }
  }

  // Validate auth code
  const authCode = await AuthCodeCls.where('id', params.code).first() as AuthCode | null
  if (!authCode) {
    throw new OAuthError('invalid_grant', 'Authorization code not found.')
  }
  if (authCode.revoked) {
    throw new OAuthError('invalid_grant', 'Authorization code has been revoked.')
  }
  if (authCodeHelpers.isExpired(authCode as any)) {
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

  // Revoke the auth code (single-use)
  await AuthCodeCls.update((authCode as any).id as string, { revoked: true } as any)

  // Issue tokens
  return issueTokens({
    userId:   authCode.userId,
    clientId: params.clientId,
    scopes:   authCodeHelpers.getScopes(authCode as any),
    includeRefresh: true,
  })
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
