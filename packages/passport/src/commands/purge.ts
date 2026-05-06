import { Passport } from '../Passport.js'

/**
 * Remove expired and revoked tokens from the database.
 *
 * Each model is purged with a single bulk `deleteAll()` against the
 * QueryBuilder — one round-trip per model regardless of row count. No
 * hydration, no per-row delete calls, no observers (counter-style data plane).
 *
 * Returns the number of rows deleted per model.
 */
export async function purgeTokens(): Promise<{
  accessTokens:  number
  refreshTokens: number
  authCodes:     number
  deviceCodes:   number
}> {
  const now = new Date()

  const AccessTokenCls  = await Passport.tokenModel()
  const RefreshTokenCls = await Passport.refreshTokenModel()
  const AuthCodeCls     = await Passport.authCodeModel()
  const DeviceCodeCls   = await Passport.deviceCodeModel()

  const accessTokens = await AccessTokenCls.query()
    .where('expiresAt', '<', now)
    .orWhere('revoked', true)
    .deleteAll()

  const refreshTokens = await RefreshTokenCls.query()
    .where('expiresAt', '<', now)
    .orWhere('revoked', true)
    .deleteAll()

  const authCodes = await AuthCodeCls.query()
    .where('expiresAt', '<', now)
    .deleteAll()

  const deviceCodes = await DeviceCodeCls.query()
    .where('expiresAt', '<', now)
    .deleteAll()

  return { accessTokens, refreshTokens, authCodes, deviceCodes }
}
