import { Passport } from '../Passport.js'
import type { RefreshToken } from '../models/RefreshToken.js'
import { revokeFamily } from '../grants/refresh-token.js'

/**
 * Revoke an access token by id AND cascade to the refresh token(s) issued with
 * it (plus any rotation family), so the revocation can't be undone by minting a
 * fresh pair from a still-live refresh token.
 *
 * RFC 7009 §2.1: "If the particular token is a refresh token and the
 * authorization server supports the revocation of access tokens, then the
 * authorization server SHOULD also invalidate all access tokens based on the
 * same authorization grant. If the token passed to the request is an access
 * token, the server [...] MAY revoke the respective refresh token as well."
 * Rudder takes the stronger position in both directions: revoking either half
 * kills the whole grant.
 *
 * Shared by `DELETE /oauth/tokens/:id` (the bearer-authenticated, by-id route)
 * and `POST /oauth/revoke` (the RFC 7009, by-value route) so the cascade logic
 * lives in exactly one place.
 *
 * `updateAll()` bypasses the mass-assignment filter — `revoked` is intentionally
 * not in `AccessToken.fillable` / `RefreshToken.fillable`.
 */
export async function revokeAccessTokenChain(accessTokenId: string): Promise<void> {
  const AccessTokenCls  = await Passport.tokenModel()
  const RefreshTokenCls = await Passport.refreshTokenModel()

  await AccessTokenCls.where('id', accessTokenId)
    .updateAll({ revoked: true } as Record<string, unknown>)

  const paired = await RefreshTokenCls.where('accessTokenId', accessTokenId).get() as RefreshToken[]
  await RefreshTokenCls.where('accessTokenId', accessTokenId)
    .updateAll({ revoked: true } as Record<string, unknown>)

  const familyIds = [...new Set(paired.map(rt => rt.familyId).filter((f): f is string => !!f))]
  for (const familyId of familyIds) {
    await revokeFamily(RefreshTokenCls, AccessTokenCls, familyId)
  }
}
