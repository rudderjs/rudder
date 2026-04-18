import { Passport } from '../Passport.js'
import type { AccessToken }  from '../models/AccessToken.js'
import type { RefreshToken } from '../models/RefreshToken.js'
import { createToken } from '../token.js'

export interface IssuedTokens {
  access_token:  string
  token_type:    'Bearer'
  expires_in:    number
  refresh_token?: string
}

/**
 * Issue an access token (+ optional refresh token) and persist to DB.
 */
export async function issueTokens(opts: {
  userId:       string | null
  clientId:     string
  scopes:       string[]
  includeRefresh?: boolean
  /** Override access token lifetime in ms */
  lifetime?:    number
}): Promise<IssuedTokens> {
  const lifetime = opts.lifetime ?? Passport.tokenLifetime()
  const expiresAt = new Date(Date.now() + lifetime)

  const AccessTokenCls  = await Passport.tokenModel()
  const RefreshTokenCls = await Passport.refreshTokenModel()

  // Create DB record
  const tokenRecord = await AccessTokenCls.create({
    userId:    opts.userId,
    clientId:  opts.clientId,
    scopes:    JSON.stringify(opts.scopes),
    revoked:   false,
    expiresAt,
  } as Record<string, unknown>) as AccessToken

  const tokenId = (tokenRecord as any).id as string

  // Sign JWT
  const jwt = await createToken({
    tokenId,
    userId:   opts.userId,
    clientId: opts.clientId,
    scopes:   opts.scopes,
    expiresAt,
  })

  const result: IssuedTokens = {
    access_token: jwt,
    token_type:   'Bearer',
    expires_in:   Math.floor(lifetime / 1000),
  }

  // Issue refresh token
  if (opts.includeRefresh !== false) {
    const refreshExpiresAt = new Date(Date.now() + Passport.refreshTokenLifetime())
    const refreshRecord = await RefreshTokenCls.create({
      accessTokenId: tokenId,
      revoked:       false,
      expiresAt:     refreshExpiresAt,
    } as Record<string, unknown>) as RefreshToken

    result.refresh_token = (refreshRecord as any).id as string
  }

  return result
}
