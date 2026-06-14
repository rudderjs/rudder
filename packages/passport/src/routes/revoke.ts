import type { MiddlewareHandler } from '@rudderjs/contracts'
import { Passport } from '../Passport.js'
import type { AccessToken } from '../models/AccessToken.js'
import type { RefreshToken } from '../models/RefreshToken.js'
import { RequireBearer } from '../middleware/bearer.js'
import { revokeFamily } from '../grants/refresh-token.js'
import type { Router } from './types.js'
import { requesterIdFrom } from './helpers.js'

/**
 * Register `DELETE /oauth/tokens/:id` — revoke a specific access token.
 *
 * Requires a valid bearer token AND ownership of the token being revoked.
 * Token ids appear in JWT `jti` claims (semi-public), so without an
 * ownership check anyone with a single captured JWT could DoS arbitrary
 * users. Returns 404 (not 403) on ownership mismatch to avoid leaking
 * whether a given id exists.
 *
 * `mw` is the `authorizeMiddleware` array — typically empty or CSRF when
 * the app doesn't mount CSRF at the web-group level.
 */
export function registerRevokeRoute(router: Router, prefix: string, mw: MiddlewareHandler[]): void {
  router.delete(`${prefix}/tokens/:id`, async (req: any, res: any) => {
    const tokenId = req.params?.['id'] ?? ''
    const AccessTokenCls = await Passport.tokenModel()
    const token = await AccessTokenCls.where('id', tokenId).first() as AccessToken | null

    const requesterId = requesterIdFrom(req)
    if (!token || !requesterId || token.userId !== requesterId) {
      res.status(404).json({ error: 'not_found', error_description: 'Token not found.' })
      return
    }

    // QueryBuilder.updateAll() bypasses the mass-assignment filter;
    // `revoked` is no longer in `AccessToken.fillable`.
    await AccessTokenCls.where('id', token.id)
      .updateAll({ revoked: true } as Record<string, unknown>)

    // RFC 7009 §2.1: revoking an access token MUST also invalidate the refresh
    // token issued with it — otherwise the holder of the refresh token just
    // mints a fresh pair and the revocation is moot. Revoke the directly-paired
    // refresh token(s), and if any belong to a rotation family, kill the whole
    // chain so an earlier-rotated refresh token can't resurrect the session.
    const RefreshTokenCls = await Passport.refreshTokenModel()
    const paired = await RefreshTokenCls.where('accessTokenId', token.id).get() as RefreshToken[]
    await RefreshTokenCls.where('accessTokenId', token.id)
      .updateAll({ revoked: true } as Record<string, unknown>)
    const familyIds = [...new Set(paired.map(rt => rt.familyId).filter((f): f is string => !!f))]
    for (const familyId of familyIds) {
      await revokeFamily(RefreshTokenCls, AccessTokenCls, familyId)
    }

    res.status(204).send()
  }, [RequireBearer(), ...mw])
}
