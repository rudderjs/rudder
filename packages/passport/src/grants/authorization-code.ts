import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'
import type { AuthCode }    from '../models/AuthCode.js'
import { clientHelpers, authCodeHelpers } from '../models/helpers.js'
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
    if (params.codeChallengeMethod && params.codeChallengeMethod !== 'S256' && params.codeChallengeMethod !== 'plain') {
      throw new OAuthError('invalid_request', 'Unsupported code_challenge_method. Use S256 or plain.')
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

  // Validate client
  const client = await ClientCls.where('id', params.clientId).first() as OAuthClient | null
  if (!client || client.revoked) {
    throw new OAuthError('invalid_client', 'Client not found.')
  }

  // Confidential clients must provide a valid secret
  if (client.confidential) {
    if (!params.clientSecret) {
      throw new OAuthError('invalid_client', 'Client secret required.')
    }
    const { createHash } = await import('node:crypto')
    const hashed = createHash('sha256').update(params.clientSecret).digest('hex')
    if (hashed !== client.secret) {
      throw new OAuthError('invalid_client', 'Invalid client secret.')
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

    if (expected !== authCode.codeChallenge) {
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
