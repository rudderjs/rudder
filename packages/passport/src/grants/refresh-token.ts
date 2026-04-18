import { Passport } from '../Passport.js'
import type { OAuthClient }  from '../models/OAuthClient.js'
import type { AccessToken }  from '../models/AccessToken.js'
import type { RefreshToken } from '../models/RefreshToken.js'
import { accessTokenHelpers, refreshTokenHelpers } from '../models/helpers.js'
import { issueTokens, type IssuedTokens } from './issue-tokens.js'
import { OAuthError } from './authorization-code.js'

export interface RefreshTokenRequest {
  grantType:    string
  refreshToken: string
  clientId:     string
  clientSecret?: string
  scope?:       string
}

/**
 * Refresh token grant — exchange a refresh token for a new access + refresh token pair.
 * The old refresh token is revoked.
 */
export async function refreshTokenGrant(params: RefreshTokenRequest): Promise<IssuedTokens> {
  if (params.grantType !== 'refresh_token') {
    throw new OAuthError('unsupported_grant_type', 'Expected grant_type=refresh_token.')
  }

  const ClientCls       = await Passport.clientModel()
  const RefreshTokenCls = await Passport.refreshTokenModel()
  const AccessTokenCls  = await Passport.tokenModel()

  // Validate client
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
    if (hashed !== client.secret) {
      throw new OAuthError('invalid_client', 'Invalid client secret.', 401)
    }
  }

  // Find refresh token
  const refreshToken = await RefreshTokenCls.where('id', params.refreshToken).first() as RefreshToken | null
  if (!refreshToken) {
    throw new OAuthError('invalid_grant', 'Refresh token not found.')
  }
  if (refreshToken.revoked) {
    throw new OAuthError('invalid_grant', 'Refresh token has been revoked.')
  }
  if (refreshTokenHelpers.isExpired(refreshToken as any)) {
    throw new OAuthError('invalid_grant', 'Refresh token has expired.')
  }

  // Find the access token this refresh token belongs to
  const accessToken = await AccessTokenCls.where('id', refreshToken.accessTokenId).first() as AccessToken | null
  if (!accessToken) {
    throw new OAuthError('invalid_grant', 'Associated access token not found.')
  }
  if (accessToken.clientId !== params.clientId) {
    throw new OAuthError('invalid_grant', 'Refresh token was not issued to this client.')
  }

  // Determine scopes — can only narrow, not widen
  const originalScopes = accessTokenHelpers.getScopes(accessToken as any)
  let scopes = originalScopes
  if (params.scope) {
    const requested = params.scope.split(' ').filter(Boolean)
    const invalid = requested.filter(s => !originalScopes.includes(s) && !originalScopes.includes('*'))
    if (invalid.length > 0) {
      throw new OAuthError('invalid_scope', `Cannot request scopes not in original token: ${invalid.join(', ')}`)
    }
    scopes = requested
  }

  // Revoke old tokens
  await RefreshTokenCls.update((refreshToken as any).id, { revoked: true } as any)
  await AccessTokenCls.update((accessToken as any).id, { revoked: true } as any)

  // Issue new pair
  return issueTokens({
    userId:         accessToken.userId,
    clientId:       params.clientId,
    scopes,
    includeRefresh: true,
  })
}
